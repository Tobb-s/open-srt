import {
  pipeline,
  WhisperTextStreamer,
  type AutomaticSpeechRecognitionPipeline,
} from '@huggingface/transformers';
import { assertCombinationSafe, type Dtype } from './models';

/**
 * La lógica de transcripción, sin nada de mensajería.
 *
 * Está separada del worker a propósito: el mismo código corre dentro del worker y —si el
 * worker no arranca— en el hilo principal. Duplicarla en dos lugares garantizaría que un
 * arreglo se aplique sólo en uno, que es la clase de error que no falla, sólo empeora un
 * camino y nadie lo nota.
 */

export interface DownloadProgress {
  file: string;
  loaded: number;
  total: number;
}

export interface TranscribeProgress {
  /**
   * Segundos de audio efectivamente procesados.
   *
   * `undefined` cuando no se pidieron timestamps, que es el caso por defecto: sin ellos
   * el modelo no informa en qué segundo va. La interfaz **no debe inventar un porcentaje**
   * en ese caso — ver `benchmarks/resultados-timestamps.md`.
   */
  processedSec?: number;
  durationSec: number;
  /** El texto que va apareciendo. Funciona con o sin timestamps. */
  partialText: string;
}

export interface TranscribeResult {
  text: string;
  inferMs: number;
}

export interface LoadOptions {
  hfId: string;
  device: 'webgpu' | 'wasm';
  dtype: Dtype;
  onDownload?: (p: DownloadProgress) => void;
}

export interface TranscribeOptions {
  audio: Float32Array;
  durationSec: number;
  /**
   * Idioma del audio. `undefined` deja que el modelo lo detecte.
   *
   * **Conviene fijarlo cuando se sabe.** Sin idioma, cada ventana de 30 s detecta por su
   * cuenta, así que un archivo puede salir mitad en un idioma y mitad en otro —pasó con
   * audio ruidoso en español—. Fijarlo también evita que la detección falle en los
   * primeros segundos, que suelen ser los peores.
   */
  language?: string;
  onProgress?: (p: TranscribeProgress) => void;
  /**
   * Pedir timestamps al modelo. **Apagado por defecto**, y no por comodidad.
   *
   * Medido sobre el nivel A completo (`benchmarks/resultados-timestamps.md`): no cuestan
   * velocidad —RTF 0,565 contra 0,570— pero suben el WER de **3,03 % a 4,52 %**. Y el daño
   * se concentra en audio con ruido y varios hablantes: los cinco ítems limpios no cambian
   * ni una décima, mientras que `en-noisy` pasa de 6,0 % a 11,7 %.
   *
   * Las sustituciones quedan iguales (63 contra 64), así que el modelo no reconoce peor:
   * lo que se rompe es el **pegado de las ventanas**, que usa los timestamps para saber
   * dónde solapan. Con audio difícil el modelo los emite poco fiables y se pierden o
   * duplican fragmentos enteros.
   *
   * Como el audio difícil es el caso de uso real de una herramienta de transcripción,
   * cambiar 1,5 puntos de WER por una barra de progreso más precisa es un mal negocio.
   */
  returnTimestamps?: boolean;
}

/**
 * Fragmentación, con los números que usa transformers.js por dentro.
 *
 * El avance real por ventana **no** es `CHUNK_SEC`: el pipeline calcula
 * `jump = window - 2 * stride`, porque el solapamiento se descuenta de los dos lados.
 * Con 30 y 5, cada ventana adelanta 20 segundos, no 30 ni 25.
 */
export const CHUNK_SEC = 30;
export const STRIDE_SEC = 5;
export const JUMP_SEC = CHUNK_SEC - 2 * STRIDE_SEC;

/** Cuántas ventanas hacen falta para cubrir un audio. */
export function windowCount(durationSec: number): number {
  if (durationSec <= CHUNK_SEC) return 1;
  return Math.ceil((durationSec - CHUNK_SEC) / JUMP_SEC) + 1;
}

/**
 * Convierte los tiempos que emite el streamer en segundos absolutos del archivo.
 *
 * Está afuera de la clase para poder probarlo: el bug que corrige —el progreso
 * retrocediendo de 28 s a 6 s a la vista del usuario— no se veía en ningún test porque la
 * lógica vivía dentro de un callback dentro de un método que necesita un modelo cargado.
 */
export function createProgressTracker(durationSec: number) {
  let windowIndex = 0;
  let lastTime = -1;
  let maxSeen = 0;

  return {
    /** Segundos absolutos, monótonos, acotados a la duración real. */
    absolute(t: number): number {
      // Un tiempo menor que el anterior sólo puede significar que empezó una ventana
      // nueva: dentro de una, los timestamps crecen.
      if (t < lastTime) windowIndex++;
      lastTime = t;
      const abs = Math.min(windowIndex * JUMP_SEC + t, durationSec);

      // Monótono a la fuerza. Acumular las ventanas no alcanza: las ventanas se solapan
      // 10 s, así que el primer timestamp de una ventana nueva cae ANTES del último de la
      // anterior —de 28 s a 22 s— y la barra volvía atrás igual. Es correcto en
      // aritmética, porque el modelo reprocesa esa zona, pero como progreso es inaceptable:
      // el trabajo hecho no se deshace.
      maxSeen = Math.max(maxSeen, abs);
      return maxSeen;
    },
    get window(): number {
      return windowIndex;
    },
  };
}

/**
 * Si se piden timestamps al modelo. **Por defecto no.**
 *
 * Está en una función aparte para poder fijarlo con un test: dentro de `transcribe()` el
 * default no se podía comprobar sin cargar un modelo, y una prueba de mutación mostró que
 * invertirlo no rompía nada. Medido en `benchmarks/resultados-timestamps.md`: encenderlos
 * sube el WER de 3,03 % a 4,52 % en audio con ruido y varios hablantes.
 */
export function resolveTimestamps(requested?: boolean): boolean {
  return requested ?? false;
}

export class Transcriber {
  private asr: AutomaticSpeechRecognitionPipeline | null = null;

  async load(opts: LoadOptions): Promise<number> {
    // Guarda contra las combinaciones que E0 midió rotas. Va en el borde porque el modo
    // de fallo es silencioso: el modelo carga, transcribe y devuelve basura sin avisar.
    assertCombinationSafe(opts.hfId, opts.device, opts.dtype);

    const t0 = performance.now();
    const load = pipeline as unknown as (
      task: string,
      model: string,
      options: Record<string, unknown>,
    ) => Promise<unknown>;

    this.asr = (await load('automatic-speech-recognition', opts.hfId, {
      device: opts.device,
      dtype: opts.dtype,
      progress_callback: (p: unknown) => {
        const x = p as { status?: string; file?: string; loaded?: number; total?: number };
        if (x.status === 'progress' && x.total) {
          opts.onDownload?.({ file: x.file ?? '', loaded: x.loaded ?? 0, total: x.total });
        }
      },
    })) as AutomaticSpeechRecognitionPipeline;

    return performance.now() - t0;
  }

  get loaded(): boolean {
    return this.asr !== null;
  }

  async transcribe(opts: TranscribeOptions): Promise<TranscribeResult> {
    if (!this.asr) throw new Error('Se pidió transcribir sin modelo cargado');

    let processedSec = 0;
    let partial = '';
    const tracker = createProgressTracker(opts.durationSec);

    // El progreso sale de los timestamps del modelo: es audio **efectivamente
    // procesado**, no una barra que avanza sola. Si el modelo se traba, la barra se queda
    // quieta, que es justo lo que el usuario necesita ver.
    //
    // Ojo con la trampa que esto tuvo: `on_chunk_start` NO da el segundo absoluto del
    // archivo. Da el tiempo **dentro de la ventana de 30 s**, así que se reinicia cada
    // vez que el pipeline pasa a la siguiente y el progreso **retrocedía** a la vista del
    // usuario —de 28 s a 6 s—. Hay que acumular el desplazamiento de las ventanas ya
    // pasadas, y ese desplazamiento es JUMP_SEC (20 s), no los 30 de la ventana.
    // El pipeline expone su tokenizer como `PreTrainedTokenizer`, el tipo general. Con un
    // modelo Whisper lo que hay en tiempo de ejecución es un `WhisperTokenizer`, que es lo
    // que el streamer necesita; el tipo declarado es sólo más ancho que la realidad. Si
    // alguna vez se cargara un modelo que no es Whisper, esto fallaría — por eso el
    // catálogo de `models.ts` sólo tiene modelos Whisper.
    const tokenizer = this.asr.tokenizer as unknown as ConstructorParameters<
      typeof WhisperTextStreamer
    >[0];

    const wantTimestamps = resolveTimestamps(opts.returnTimestamps);

    // El streamer se arma igual sin timestamps: `callback_function` emite el texto a
    // medida que se genera, y eso es prueba real de avance —si el modelo se traba, el
    // texto se detiene—. Lo que no se puede sin timestamps es saber en qué SEGUNDO va,
    // así que `on_chunk_start` simplemente no se dispara y `processedSec` queda undefined.
    const streamer = opts.onProgress
      ? new WhisperTextStreamer(tokenizer, {
          time_precision: 0.02,
          on_chunk_start: (t: number) => {
            processedSec = tracker.absolute(t);
          },
          callback_function: (text: string) => {
            partial += text;
            opts.onProgress?.({
              // Sin timestamps no hay segundo que informar. Se manda `undefined` en vez
              // de un cero o una cuenta inventada: la interfaz tiene que poder distinguir
              // «va por el segundo 0» de «no se sabe».
              processedSec: wantTimestamps ? processedSec : undefined,
              durationSec: opts.durationSec,
              partialText: partial,
            });
          },
          on_chunk_end: (t: number) => {
            processedSec = tracker.absolute(t);
          },
        })
      : undefined;

    const t0 = performance.now();
    const call = this.asr as unknown as (
      audio: Float32Array,
      options: Record<string, unknown>,
    ) => Promise<unknown>;

    const out = await call(opts.audio, {
      // Whisper fue entrenado sobre ventanas de 30 s: el audio más largo hay que
      // fragmentarlo, y el solapamiento evita cortar palabras en los bordes. El pegado de
      // las ventanas lo hace la librería, que es donde está probado.
      chunk_length_s: CHUNK_SEC,
      stride_length_s: STRIDE_SEC,
      language: opts.language,
      // `transcribe`, NUNCA `translate`. Sin esto explícito, cada ventana de 30 s decide
      // por su cuenta qué hacer y algunas eligen traducir: un archivo en español salía
      // como «The theater of the Flautista, a great success» y a mitad de camino volvía
      // al español solo. Whisper puede traducir, pero eso es otra función y se pide aparte.
      task: 'transcribe',
      // Hacen falta para que el streamer sepa en qué segundo va. E2 los va a usar de
      // verdad; acá se piden sólo para el progreso y se descartan.
      return_timestamps: wantTimestamps,
      streamer,
    });

    const inferMs = performance.now() - t0;
    return { text: ((out as { text?: string }).text ?? '').trim(), inferMs };
  }

  async dispose(): Promise<void> {
    await this.asr?.dispose?.();
    this.asr = null;
  }
}
