import { env } from '@huggingface/transformers';
import { WINDOW_SAMPLES, SAMPLE_RATE, toSegments, DEFAULT_OPTIONS, type Segment, type SegmentOptions } from './segments';

/**
 * Silero VAD en el navegador.
 *
 * ── Decisiones ──
 *
 * **Reutiliza el onnxruntime que ya trae transformers.js** en vez de cargar el suyo. Son
 * varios megabytes de WebAssembly y dos runtimes compitiendo por los mismos hilos; además,
 * transformers ya dejó configuradas las rutas de los `.wasm`, que es la parte que más
 * cuesta hacer andar por separado.
 *
 * **El modelo son 2,2 MB**, contra los 850 MB del de transcripción. Junto a eso no se nota,
 * y es lo que permite que los subtítulos tengan tiempos sin pedírselos al modelo grande
 * —que costaría 1,5 puntos de WER, medido en `benchmarks/resultados-timestamps.md`—.
 *
 * Licencia MIT, verificada contra la API de Hugging Face.
 */

const MODEL_URL = 'https://huggingface.co/onnx-community/silero-vad/resolve/main/onnx/model.onnx';

/** Estado recurrente de Silero v5: dos capas, un lote, 128 dimensiones. */
const STATE_SHAPE = [2, 1, 128] as const;

/**
 * Superficie mínima de onnxruntime, declarada acá a mano.
 *
 * El paquete `onnxruntime-web` tiene sus tipos en `types.d.ts` pero su `package.json` no
 * los resuelve por `exports`, así que importarlo da TS7016. Declarar sólo lo que se usa es
 * más robusto que esperar a que lo arreglen, y deja a la vista lo poco que hace falta:
 * crear una sesión, correrla y liberarla.
 */
interface OrtTensor {
  data: Float32Array | BigInt64Array;
}
interface OrtSession {
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
  release?(): Promise<void>;
}
interface Ort {
  Tensor: new (
    type: 'float32' | 'int64',
    data: Float32Array | BigInt64Array,
    dims: readonly number[],
  ) => OrtTensor;
  InferenceSession: {
    create(model: Uint8Array, options?: Record<string, unknown>): Promise<OrtSession>;
  };
}
type Session = OrtSession;

export interface DetectProgress {
  processedSec: number;
  durationSec: number;
}

export class SpeechDetector {
  private session: Session | null = null;
  private ort: Ort | null = null;

  get loaded(): boolean {
    return this.session !== null;
  }

  async load(onDownload?: (loaded: number, total: number) => void): Promise<void> {
    if (this.session) return;

    // La misma instancia que usa transformers, ya con sus rutas de WASM resueltas.
    const ort =
      (env.backends?.onnx as unknown as Ort | undefined) ??
      ((await import('onnxruntime-web')) as unknown as Ort);
    this.ort = ort;

    // Se descarga a mano en vez de dejárselo a onnxruntime para poder informar el avance:
    // son 2,2 MB, poco, pero en una conexión lenta un silencio de varios segundos parece
    // que la herramienta se colgó.
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`No se pudo descargar el detector de voz: HTTP ${res.status}`);

    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body?.getReader();
    let bytes: Uint8Array;

    if (reader && total > 0 && onDownload) {
      const trozos: Uint8Array[] = [];
      let leidos = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        trozos.push(value);
        leidos += value.length;
        onDownload(leidos, total);
      }
      bytes = new Uint8Array(leidos);
      let off = 0;
      for (const t of trozos) {
        bytes.set(t, off);
        off += t.length;
      }
    } else {
      bytes = new Uint8Array(await res.arrayBuffer());
    }

    this.session = await ort.InferenceSession.create(bytes, {
      executionProviders: ['wasm'],
      // Un modelo de 2 MB no gana nada con varios hilos y evita pedir aislamiento
      // cross-origin, que es lo que rompería la descarga del modelo grande.
      graphOptimizationLevel: 'all',
    });
  }

  /**
   * Devuelve los tramos donde hay voz.
   *
   * Procesa el audio en ventanas de 512 muestras arrastrando el estado recurrente: **el
   * orden importa y no se puede paralelizar**, porque cada ventana depende de la anterior.
   */
  async detect(
    samples: Float32Array,
    durationSec: number,
    opts: SegmentOptions = DEFAULT_OPTIONS,
    onProgress?: (p: DetectProgress) => void,
  ): Promise<{ segments: Segment[]; probs: number[] }> {
    if (!this.session || !this.ort) throw new Error('El detector de voz no está cargado');
    const ort = this.ort;

    let state = new ort.Tensor('float32', new Float32Array(2 * 128), [...STATE_SHAPE]);
    const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(SAMPLE_RATE)]), []);
    const probs: number[] = [];

    // Avisar cada ~2 s de audio: más seguido satura el hilo con actualizaciones de interfaz.
    const cada = Math.max(1, Math.round((2 * SAMPLE_RATE) / WINDOW_SAMPLES));

    for (let i = 0, n = 0; i + WINDOW_SAMPLES <= samples.length; i += WINDOW_SAMPLES, n++) {
      const input = new ort.Tensor(
        'float32',
        samples.subarray(i, i + WINDOW_SAMPLES),
        [1, WINDOW_SAMPLES],
      );
      const out = await this.session.run({ input, state, sr });
      probs.push((out.output.data as Float32Array)[0]);
      state = out.stateN as typeof state;

      if (onProgress && n % cada === 0) {
        onProgress({ processedSec: i / SAMPLE_RATE, durationSec });
      }
    }

    return { segments: toSegments(probs, durationSec, opts), probs };
  }

  async dispose(): Promise<void> {
    await this.session?.release?.();
    this.session = null;
  }
}

/** Extrae las muestras de un tramo. Se usa para transcribir bloque por bloque. */
export function sliceSamples(
  samples: Float32Array,
  startSec: number,
  endSec: number,
): Float32Array {
  const a = Math.max(0, Math.floor(startSec * SAMPLE_RATE));
  const b = Math.min(samples.length, Math.ceil(endSec * SAMPLE_RATE));
  return samples.slice(a, b);
}
