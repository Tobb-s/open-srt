import type { Lang } from './normalize';
import type { WerResult } from './wer';

export type Backend = 'webgpu' | 'wasm';

/** Condición acústica del ítem. Se mide por separado porque el ruido y el solapamiento
 *  degradan de forma muy distinta según el modelo. */
export type Condition = 'clean' | 'noisy' | 'multi';

export interface ModelSpec {
  /** Clave corta y estable: es la que va en los resultados y en la tabla final. */
  key: string;
  /** Id en Hugging Face, verificado contra su API el 23/08/2026. */
  hfId: string;
  family: 'whisper' | 'moonshine';
  params: string;
  /** Descarga aproximada en MB. Se confirma midiendo, no se toma como dato. */
  approxMB: number;
  /**
   * Licencia efectiva, verificada contra `cardData.license` de la API de Hugging Face.
   * Los repos de `onnx-community` no declaran licencia propia: heredan la del modelo
   * base, así que acá va la del base y `licenseFrom` dice de dónde sale.
   */
  license: string;
  licenseFrom: string;
  /** `multi` sirve para español; `en` sólo para inglés. */
  coverage: 'multi' | 'en';
  /**
   * Si se le puede pasar `language` al generar.
   *
   * Parece redundante con `coverage` y no lo es: `lite-whisper-large-v3-turbo` **es**
   * multilingüe —`vocab_size` 51866, el de large-v3— pero su `generation_config.json`
   * no trae el mapa `lang_to_id`, y sin ese mapa transformers.js lo trata como
   * sólo-inglés y **rechaza** el parámetro. Es un empaquetado incompleto del repo ONNX,
   * no una propiedad del modelo. Sin este campo, sus 16 mediciones salen en error.
   */
  acceptsLanguage?: boolean;
  note?: string;
}

/**
 * Nivel de un ítem del corpus.
 *
 * A — entra en la matriz completa (6 modelos × 2 backends).
 * B — sólo para los modelos que pasen el primer corte.
 * V — **validación**: no participa en elegir ni calibrar nada. Sirve para comprobar los
 *     parámetros del catálogo contra audio que no ayudó a definirlos.
 *
 * Existe porque la matriz completa con todas las duraciones son decenas de horas: medido,
 * 312 min de audio × 12 combinaciones dan entre 19 y 125 h según el RTF.
 */
export type Level = 'A' | 'B' | 'V';

export interface CorpusItem {
  id: string;
  /** Ruta servida al audio, relativa a /public. */
  url: string;
  lang: Lang;
  durationSec: number;
  condition: Condition;
  /** Transcripción de referencia, sin normalizar. La normalización la hace el runner. */
  reference: string;
  /** SHA-256 del archivo de audio, del manifiesto del corpus. */
  sha256: string;
  level?: Level;
  /**
   * `principal` define los parámetros del catálogo; `validacion` los comprueba.
   *
   * Están separados **por construcción**, no por una comprobación posterior: los clips de
   * validación son los que quedaron después de los que usó el conjunto principal.
   */
  split?: 'principal' | 'validacion';
  /** Sólo en `noisy`: la SNR exacta a la que se mezcló el murmullo. */
  snrDb?: number;
  /** Sólo en `multi`: hablantes que de verdad entraron, contados del resultado. */
  speakers?: number;
}

export type RunStatus =
  | 'ok'
  | 'error'
  /** El worker no respondió a tiempo: casi siempre, la GPU se cayó. */
  | 'timeout'
  /** Combinación no aplicable, p. ej. Moonshine sobre un ítem en español. */
  | 'skipped';

export interface MemorySample {
  /** MB medidos. */
  mb: number;
  /**
   * Qué API dio el número. Importa para saber qué NO se está viendo:
   * ninguna de las disponibles mide la memoria de la GPU.
   */
  source: 'measureUserAgentSpecificMemory' | 'performance.memory' | 'unavailable';
}

export interface RunResult {
  modelKey: string;
  backend: Backend;
  itemId: string;
  status: RunStatus;
  /** Precisión con la que se midió. Sin esto, dos filas no son comparables. */
  dtype?: string;
  /** Si se pidieron timestamps. Cambia RTF y puede cambiar WER. */
  returnTimestamps?: boolean;

  /** Carga del modelo: descarga más inicialización. Sólo la primera vez es real. */
  loadMs?: number;
  /** Sólo la inferencia. Es lo que entra en el RTF. */
  inferMs?: number;
  /** inferMs / (durationSec * 1000). Menor que 1 es más rápido que tiempo real. */
  rtf?: number;

  memBefore?: MemorySample;
  memPeak?: MemorySample;

  wer?: WerResult;
  /** La transcripción cruda, para poder auditar un WER sospechoso a mano. */
  hypothesis?: string;

  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface DeviceInfo {
  userAgent: string;
  /** GB declarados por el navegador. Es aproximado y puede venir capado. */
  deviceMemoryGB?: number;
  hardwareConcurrency?: number;
  webgpuAvailable: boolean;
  /** Adaptador de WebGPU, cuando el navegador lo expone. */
  gpuAdapter?: string;
  crossOriginIsolated: boolean;
  label?: string;
}

export interface BenchRun {
  /** Identificador de la corrida, para no pisar resultados entre equipos. */
  runId: string;
  device: DeviceInfo;
  startedAt: string;
  results: RunResult[];
}

/**
 * Precisión de los pesos. Puede ser un único valor o uno por componente.
 *
 * No es un detalle de afinado: cambia velocidad, memoria **y calidad**. La primera
 * corrida lo dejó a la vista — el mismo modelo dio 33 % de WER con el encoder en `fp32`
 * y 79 % con el encoder en `q8`, alucinando masivamente. Por eso el dtype se puede forzar
 * y queda escrito en cada resultado, en vez de deducirse del backend.
 */
export type DtypeSpec =
  | string
  | { encoder_model: string; decoder_model_merged: string };

/** Mensajes hacia el worker. */
export type WorkerRequest =
  | {
      type: 'load';
      hfId: string;
      backend: Backend;
      family: ModelSpec['family'];
      /** Si es false, no se le pasa `language` al generar. */
      acceptsLanguage?: boolean;
      /** Fuerza la precisión en vez de usar la que corresponde al backend. */
      dtype?: DtypeSpec;
    }
  | {
      type: 'transcribe';
      audio: Float32Array;
      lang: Lang;
      sampleRate: number;
      /** Pedir timestamps al modelo. Cuesta tokens extra; se mide su efecto. */
      returnTimestamps?: boolean;
    }
  | { type: 'dispose' };

/** Mensajes desde el worker. */
export type WorkerResponse =
  | { type: 'progress'; stage: string; loaded?: number; total?: number; file?: string }
  | { type: 'loaded'; loadMs: number; dtype: string }
  | { type: 'result'; text: string; inferMs: number }
  | { type: 'error'; message: string };
