import {
  Transcriber,
  type DownloadProgress,
  type TranscribeProgress,
  type SegmentedProgress,
  type SegmentedResult,
} from './transcriber';
import { SpeechDetector } from '../vad/silero';
import { toBlocks, totalSpeechSec, type Segment } from '../vad/segments';
import { detectCapabilities, selectProfile, type DeviceCapabilities, type Selection } from './capabilities';
import type { ModelProfile } from './models';
import type { WorkerRequest, WorkerResponse } from './asr.worker';

/**
 * La API pública del motor.
 *
 * Se encarga de tres cosas que la interfaz no debería tener que saber: elegir el modelo
 * según lo que aguante el equipo, correr la inferencia fuera del hilo principal, y
 * seguir funcionando —peor, pero funcionando— cuando el worker no arranca.
 */

export type EngineMode = 'worker' | 'main-thread';

export interface EngineStatus {
  mode: EngineMode;
  profile: ModelProfile;
  /**
   * Por qué se cayó al hilo principal, si pasó. La interfaz **tiene que** mostrarlo: en
   * ese modo la pestaña se congela durante la transcripción, y un usuario que no sabe por
   * qué la página dejó de responder asume que se rompió.
   */
  degradedReason?: string;
}

export interface TranscribeCallbacks {
  onProgress?: (p: TranscribeProgress) => void;
  onDownload?: (p: DownloadProgress) => void;
}

/** Etapas del camino con tiempos, para que la interfaz pueda decir qué está pasando. */
export type TimedPhase = 'detector' | 'detecting' | 'transcribing';

export interface TimedCallbacks {
  onDownload?: (p: DownloadProgress) => void;
  onPhase?: (phase: TimedPhase) => void;
  /** Avance del detector de voz, en segundos de audio. */
  onDetectProgress?: (p: { processedSec: number; durationSec: number }) => void;
  /** Avance de la transcripción, **por bloques**: exacto, no estimado. */
  onBlockProgress?: (p: SegmentedProgress) => void;
}

export interface TimedResult extends SegmentedResult {
  /** Los tramos de voz que encontró el detector, antes de agruparlos en bloques. */
  speechSegments: Segment[];
  speechSec: number;
}

/** Cuánto esperar a que el worker conteste antes de darlo por muerto. */
const LOAD_TIMEOUT_MS = 20 * 60 * 1000;

export class AsrEngine {
  private worker: Worker | null = null;
  private fallback: Transcriber | null = null;
  private fallbackDetector: SpeechDetector | null = null;
  private mode: EngineMode = 'worker';
  private degradedReason?: string;
  private profile?: ModelProfile;

  /** Qué puede este equipo y qué modelo le toca. No carga nada todavía. */
  static async inspect(): Promise<{ caps: DeviceCapabilities; selection: Selection }> {
    const caps = await detectCapabilities();
    return { caps, selection: selectProfile(caps) };
  }

  get status(): EngineStatus | undefined {
    return this.profile
      ? { mode: this.mode, profile: this.profile, degradedReason: this.degradedReason }
      : undefined;
  }

  async load(profile: ModelProfile, onDownload?: (p: DownloadProgress) => void): Promise<EngineStatus> {
    this.profile = profile;

    try {
      this.worker = new Worker(new URL('./asr.worker.ts', import.meta.url), {
        type: 'module',
      });
      await this.request(
        { type: 'load', hfId: profile.hfId, device: profile.backend, dtype: profile.dtype },
        LOAD_TIMEOUT_MS,
        onDownload,
      );
      this.mode = 'worker';
    } catch (err) {
      // El worker no sirve. Antes de rendirse, se intenta en el hilo principal: es peor
      // —congela la pestaña— pero es la diferencia entre una herramienta lenta y ninguna.
      this.worker?.terminate();
      this.worker = null;
      this.degradedReason = err instanceof Error ? err.message : String(err);
      this.mode = 'main-thread';

      this.fallback = new Transcriber();
      await this.fallback.load({
        hfId: profile.hfId,
        device: profile.backend,
        dtype: profile.dtype,
        onDownload,
      });
    }

    return this.status!;
  }

  async transcribe(
    audio: Float32Array,
    durationSec: number,
    opts: { language?: string; returnTimestamps?: boolean } & TranscribeCallbacks = {},
  ): Promise<{ text: string; inferMs: number }> {
    if (this.mode === 'main-thread') {
      if (!this.fallback) throw new Error('Motor no cargado');
      return this.fallback.transcribe({
        audio,
        durationSec,
        language: opts.language,
        returnTimestamps: opts.returnTimestamps,
        onProgress: opts.onProgress,
      });
    }

    // Copia: el buffer se transfiere al worker y quedaría inutilizable de este lado,
    // pero quien llamó puede necesitar el audio otra vez (reintento, cambio de idioma).
    const copy = new Float32Array(audio);
    // Sin plazo: un archivo largo puede tardar horas legítimamente, y cortar por reloj
    // mataría trabajo válido. Lo que protege acá es el progreso — si se detiene, el
    // usuario lo ve y puede cancelar.
    const res = await this.request(
      {
        type: 'transcribe',
        audio: copy,
        durationSec,
        language: opts.language,
        returnTimestamps: opts.returnTimestamps,
        withProgress: !!opts.onProgress,
      },
      0,
      undefined,
      opts.onProgress,
      undefined,
      [copy.buffer],
    );

    if (res.type !== 'done') throw new Error('Respuesta inesperada del worker');
    return { text: res.text, inferMs: res.inferMs };
  }

  /**
   * Transcribe con tiempos: detecta voz, arma bloques y transcribe bloque por bloque.
   *
   * Es el camino de E2 y el que hay que usar para todo lo que necesite subtítulos. Lo que
   * lo distingue del de E1 no es sólo que devuelve tiempos:
   *
   * - **Los tiempos son del detector, no del modelo.** Pedírselos al modelo sube el WER de
   *   3,03 % a 4,52 % en audio con ruido y varias voces.
   * - **El progreso es exacto**: bloques terminados sobre bloques totales.
   * - **Detecta omisiones.** El detector sabe cuántos segundos de voz hay; si salieron
   *   muchas menos palabras de las que caben en ese tiempo, algo se perdió — y eso es
   *   justamente lo que E1 midió y no podía ver.
   */
  async transcribeTimed(
    audio: Float32Array,
    durationSec: number,
    opts: { language?: string } & TimedCallbacks = {},
  ): Promise<TimedResult> {
    if (this.mode === 'main-thread') {
      if (!this.fallback) throw new Error('Motor no cargado');
      this.fallbackDetector ??= new SpeechDetector();

      opts.onPhase?.('detector');
      await this.fallbackDetector.load((loaded, total) =>
        opts.onDownload?.({ file: 'detector de voz', loaded, total }),
      );

      opts.onPhase?.('detecting');
      const { segments } = await this.fallbackDetector.detect(
        audio, durationSec, undefined, opts.onDetectProgress,
      );

      opts.onPhase?.('transcribing');
      const r = await this.fallback.transcribeSegmented({
        audio,
        durationSec,
        blocks: toBlocks(segments),
        language: opts.language,
        onProgress: opts.onBlockProgress,
      });
      return { ...r, speechSegments: segments, speechSec: totalSpeechSec(segments) };
    }

    // Camino con worker. El audio se manda UNA vez: detectar y transcribir lo comparten,
    // y transferirlo dos veces dejaría el buffer inutilizable del lado de acá.
    opts.onPhase?.('detector');
    await this.request({ type: 'loadDetector' }, LOAD_TIMEOUT_MS, opts.onDownload);

    const copia = new Float32Array(audio);
    await this.request({ type: 'setAudio', audio: copia, durationSec }, 0, undefined, undefined, undefined, [
      copia.buffer,
    ]);

    opts.onPhase?.('detecting');
    const det = await this.request(
      { type: 'detect' }, 0, undefined, undefined, opts.onDetectProgress,
    );
    if (det.type !== 'detected') throw new Error('Respuesta inesperada al detectar voz');

    opts.onPhase?.('transcribing');
    const res = await this.request(
      { type: 'transcribeSegmented', segments: det.segments, language: opts.language },
      0,
      undefined,
      undefined,
      undefined,
      undefined,
      opts.onBlockProgress,
    );
    if (res.type !== 'segmented') throw new Error('Respuesta inesperada al transcribir');

    return {
      segments: res.segments,
      text: res.text,
      inferMs: res.inferMs,
      coverage: res.coverage,
      speechSegments: det.segments,
      speechSec: det.speechSec,
    };
  }

  async dispose(): Promise<void> {
    this.worker?.postMessage({ type: 'dispose' } satisfies WorkerRequest);
    this.worker?.terminate();
    this.worker = null;
    await this.fallback?.dispose();
    this.fallback = null;
    await this.fallbackDetector?.dispose();
    this.fallbackDetector = null;
  }

  /** Un intercambio con el worker, con plazo opcional y reenvío de eventos intermedios. */
  private request(
    req: WorkerRequest,
    timeoutMs: number,
    onDownload?: (p: DownloadProgress) => void,
    onProgress?: (p: TranscribeProgress) => void,
    onDetect?: (p: { processedSec: number; durationSec: number }) => void,
    transfer?: Transferable[],
    onBlock?: (p: SegmentedProgress) => void,
  ): Promise<WorkerResponse> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('No hay worker'));

    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              cleanup();
              reject(new Error(`El worker no respondió en ${Math.round(timeoutMs / 60000)} min`));
            }, timeoutMs)
          : undefined;

      const onMessage = (ev: MessageEvent<WorkerResponse>) => {
        const msg = ev.data;
        if (msg.type === 'download') {
          onDownload?.(msg);
          return; // evento intermedio: no resuelve
        }
        if (msg.type === 'progress') {
          onProgress?.(msg);
          return;
        }
        if (msg.type === 'detectProgress') {
          onDetect?.(msg);
          return;
        }
        if (msg.type === 'blockProgress') {
          onBlock?.(msg);
          return;
        }
        cleanup();
        if (msg.type === 'error') reject(new Error(msg.message));
        else resolve(msg);
      };

      // Un worker que muere por una caída del proceso de GPU no siempre emite 'error';
      // por eso el plazo de carga existe además de este manejador.
      const onError = () => {
        cleanup();
        reject(new Error('El worker se cerró de forma inesperada'));
      };

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      };

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.postMessage(req, transfer ?? []);
    });
  }
}
