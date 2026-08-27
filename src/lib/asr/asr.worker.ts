/// <reference lib="webworker" />
import { Transcriber } from './transcriber';
import { SpeechDetector } from '../vad/silero';
import { SpeakerEmbedder } from '../diar/embedder';
import { Translator, type Par } from '../translate/translator';
import { diarize } from '../diar/diarize';
import { toBlocks, type Segment } from '../vad/segments';
import type { Dtype } from './models';
import type { TimedText, CoverageCheck } from '../vad/align';

/**
 * Envoltorio de mensajería sobre `Transcriber` y `SpeechDetector`.
 *
 * Acá no hay lógica de transcripción ni de detección: sólo traduce mensajes. Todo lo que
 * decide *cómo* se hace vive en los módulos que también usa el camino sin worker — así un
 * arreglo se aplica a los dos a la vez.
 *
 * **El audio se manda una sola vez** y queda guardado acá. Detectar voz y transcribir lo
 * necesitan los dos, y transferirlo dos veces no sólo duplicaría la copia: la primera
 * transferencia deja el buffer del otro lado inutilizable.
 */

export type WorkerRequest =
  | { type: 'load'; hfId: string; device: 'webgpu' | 'wasm'; dtype: Dtype }
  | { type: 'loadDetector' }
  | { type: 'setAudio'; audio: Float32Array; durationSec: number }
  | { type: 'detect' }
  | { type: 'loadEmbedder' }
  | { type: 'diarize'; segments: Segment[] }
  | {
      type: 'transcribeSegmented';
      segments: Segment[];
      language?: string;
      /** Lo que ya estaba hecho, si se esta retomando una corrida interrumpida. */
      resume?: { doneBlocks: number; segments: TimedText[]; speechSec: number };
    }
  | {
      type: 'transcribe';
      audio: Float32Array;
      durationSec: number;
      language?: string;
      returnTimestamps?: boolean;
      withProgress: boolean;
    }
  | { type: 'loadTranslator'; par: Par }
  | { type: 'translate'; segments: TimedText[] }
  | { type: 'dispose' };

export type WorkerResponse =
  | { type: 'download'; file: string; loaded: number; total: number }
  | { type: 'ready'; loadMs: number }
  | { type: 'detectorReady' }
  | { type: 'audioSet' }
  | { type: 'detectProgress'; processedSec: number; durationSec: number }
  | { type: 'detected'; segments: Segment[]; speechSec: number }
  | { type: 'embedderReady' }
  | { type: 'diarizeProgress'; done: number; total: number }
  | { type: 'diarized'; speakers: string[]; count: number }
  | { type: 'blockProgress'; done: number; total: number; processedSec: number; durationSec: number; partialText: string }
  /**
   * Un bloque termino, con lo que produjo **ese** bloque.
   *
   * Sólo lo suyo, no el acumulado: en un archivo de dos horas son unos quinientos bloques, y
   * remandar la lista completa en cada uno serian megabytes de mensajes para nada.
   */
  | { type: 'blockDone'; index: number; segments: TimedText[]; speechSec: number }
  | { type: 'segmented'; segments: TimedText[]; text: string; inferMs: number; coverage: CoverageCheck }
  | { type: 'progress'; processedSec?: number; durationSec: number; partialText: string }
  | { type: 'done'; text: string; inferMs: number }
  | { type: 'translatorReady' }
  | { type: 'translateProgress'; done: number; total: number }
  | { type: 'translated'; segments: TimedText[] }
  | { type: 'error'; message: string; fatal: boolean };

const transcriber = new Transcriber();
const detector = new SpeechDetector();
const translator = new Translator();
const embedder = new SpeakerEmbedder();

/** El audio de la sesión, guardado para que detectar y transcribir lo compartan. */
let audio: Float32Array | null = null;
let durationSec = 0;

function post(msg: WorkerResponse) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;

  try {
    if (req.type === 'load') {
      const loadMs = await transcriber.load({
        hfId: req.hfId,
        device: req.device,
        dtype: req.dtype,
        onDownload: (p) => post({ type: 'download', ...p }),
      });
      post({ type: 'ready', loadMs });
      return;
    }

    if (req.type === 'loadDetector') {
      await detector.load((loaded, total) =>
        post({ type: 'download', file: 'detector de voz', loaded, total }),
      );
      post({ type: 'detectorReady' });
      return;
    }

    if (req.type === 'setAudio') {
      audio = req.audio;
      durationSec = req.durationSec;
      post({ type: 'audioSet' });
      return;
    }

    if (req.type === 'detect') {
      if (!audio) throw new Error('No hay audio cargado');
      const { segments } = await detector.detect(audio, durationSec, undefined, (p) =>
        post({ type: 'detectProgress', ...p }),
      );
      const speechSec = segments.reduce((a, s) => a + (s.endSec - s.startSec), 0);
      post({ type: 'detected', segments, speechSec });
      return;
    }

    if (req.type === 'loadEmbedder') {
      await embedder.load({ onDownload: (p) => post({ type: 'download', ...p }) });
      post({ type: 'embedderReady' });
      return;
    }

    if (req.type === 'diarize') {
      if (!audio) throw new Error('No hay audio cargado');
      const r = await diarize({
        audio,
        segments: req.segments,
        sampleRate: 16000,
        embed: (trozo) => embedder.embed(trozo),
        onProgress: (done, total) => post({ type: 'diarizeProgress', done, total }),
      });
      post({ type: 'diarized', ...r });
      return;
    }

    if (req.type === 'transcribeSegmented') {
      if (!audio) throw new Error('No hay audio cargado');
      const r = await transcriber.transcribeSegmented({
        audio,
        durationSec,
        blocks: toBlocks(req.segments),
        language: req.language,
        resumeFrom: req.resume,
        onBlockDone: (p) => post({ type: 'blockDone', ...p, segments: [...p.segments] }),
        onProgress: (p) => post({ type: 'blockProgress', ...p }),
      });
      post({ type: 'segmented', ...r });
      return;
    }

    if (req.type === 'transcribe') {
      const r = await transcriber.transcribe({
        audio: req.audio,
        durationSec: req.durationSec,
        language: req.language,
        returnTimestamps: req.returnTimestamps,
        onProgress: req.withProgress ? (p) => post({ type: 'progress', ...p }) : undefined,
      });
      post({ type: 'done', text: r.text, inferMs: r.inferMs });
      return;
    }

    if (req.type === 'loadTranslator') {
      await translator.load(req.par, (p) => post({ type: 'download', ...p }));
      post({ type: 'translatorReady' });
      return;
    }

    if (req.type === 'translate') {
      const segments = await translator.translate(req.segments, (p) =>
        post({ type: 'translateProgress', ...p }),
      );
      post({ type: 'translated', segments });
      return;
    }

    if (req.type === 'dispose') {
      await transcriber.dispose();
      await detector.dispose();
      await translator.dispose();
      await embedder.dispose();
      audio = null;
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Un fallo al cargar deja el worker inservible; uno al transcribir, no.
    post({
      type: 'error',
      message,
      // Un fallo al cargar el modelo de hablantes NO es fatal: la transcripcion sigue
      // sirviendo sin saber quien habla, que es lo que la herramienta hacia hasta ayer.
      fatal: req.type === 'load' || req.type === 'loadDetector',
    });
  }
});
