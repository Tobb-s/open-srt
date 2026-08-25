/**
 * Catálogo de modelos del producto.
 *
 * No es el catálogo del banco (`src/lib/bench/models.ts`), que existía para *comparar*
 * seis candidatos. Éste tiene sólo los que sobrevivieron a E0, y cada número de acá está
 * **medido**, no estimado: sale de `benchmarks/resultados-principal.md` y
 * `benchmarks/resultados-controles.md`.
 *
 * La decisión y su razonamiento, en `docs/E0-DECISION.md`.
 */

import { checkCombination } from './evidence';

export type Backend = 'webgpu' | 'wasm';

/**
 * Precisión por componente.
 *
 * **No hay reglas generales sobre qué precisión sirve.** El primer intento de escribirlas
 * («el encoder en q8 está roto») lo tumbó un test de consistencia: prohibía perfiles del
 * propio catálogo que están medidos y funcionan. Lo que vale es la tabla de combinaciones
 * efectivamente medidas, en `evidence.ts`, porque el mismo `q8` que rompe a turbo en
 * WebGPU funciona bien en base y small sobre WASM.
 *
 * Cambiar el dtype de un perfil exige **volver a medir el WER**, nunca «probar si anda»:
 * las combinaciones rotas cargan sin error y transcriben con aplomo, devolviendo basura.
 */
export interface Dtype {
  encoder_model: 'fp32' | 'fp16' | 'q8' | 'q4';
  decoder_model_merged: 'fp32' | 'fp16' | 'q8' | 'q4';
}

export interface ModelProfile {
  key: string;
  hfId: string;
  backend: Backend;
  dtype: Dtype;
  /** Descarga aproximada, en MB. Se muestra al usuario antes de bajarla. */
  downloadMB: number;
  /**
   * Bytes que el buffer más grande necesita en la GPU. Es lo que decide si un adaptador
   * puede con este perfil: en E0 el encoder en `fp32` (~2,5 GB) no entraba en el
   * `maxBufferSize` de 2 GB y daba **timeout de carga a los 900 s**, sin ningún error que
   * dijera «no entra».
   */
  peakBufferBytes: number;
  /**
   * RTF medido **por archivo**, no un número escrito a mano ni un promedio de corrida.
   *
   * La unidad importa y costó un error: antes esto guardaba los RTF **agregados** de cada
   * corrida (el promedio ponderado de ocho archivos). Con esos números el rango salía
   * [0,451, 0,565], pero al comprobarlo contra archivos individuales **sólo 8 de 16 caían
   * dentro**. Es que el usuario transcribe *un archivo*, no un corpus: los archivos cortos
   * pagan más calentamiento y los difíciles generan más tokens, así que su RTF se dispersa
   * mucho más que el de un promedio. Predecir un archivo con la variabilidad de un
   * promedio subestima el error por construcción.
   *
   * La mediana y el rango se derivan con `rtfMedian` y `rtfRange`. Está así para que sea
   * imposible declarar un RTF que nadie observó — ya pasó una vez con un WER copiado.
   */
  rtfSamples: readonly number[];
  /** WER medido en E0. */
  measuredWer: number;
  /**
   * Sobre cuántos ítems se midió ese WER.
   *
   * No es contabilidad: un 1,8 % sobre **un** ítem y un 3,0 % sobre **ocho** no son
   * comparables, y el más bajo no es necesariamente el mejor. Sin este campo, el perfil
   * `q4` parecía mejor que el `fp16` cuando en realidad está menos medido. Declararlo
   * evita elegir por un número que no tiene respaldo.
   */
  werSamples: number;
  /** Cómo describirle al usuario qué calidad esperar. */
  quality: 'alta' | 'media' | 'baja';
}

const GB = 1024 ** 3;

/**
 * Perfiles ordenados por preferencia. El primero que el equipo aguante, gana.
 */
export const PROFILES: readonly ModelProfile[] = [
  {
    key: 'turbo-webgpu',
    hfId: 'onnx-community/whisper-large-v3-turbo',
    backend: 'webgpu',
    // El ganador de E0. Más rápido Y siete veces más preciso que `small`.
    dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' },
    downloadMB: 850,
    // Encoder de large-v3 (~635 M parámetros) en fp16 ≈ 1,27 GB.
    peakBufferBytes: 1.3 * GB,
    // Veinticuatro mediciones POR ARCHIVO, del conjunto principal (nivel A) en tres
    // corridas. Se excluyen las del conjunto de validación —no puede definir el rango que
    // luego lo comprueba— y las contaminadas por el bug de traducción.
    //
    // La cantidad importa y costó descubrirlo: con las 8 muestras de una sola corrida el
    // rango salía [0,435, 0,488] y **cubría 2 de 10** archivos de validación. Ocho
    // mediciones no describen la variabilidad; con 24, p10–p90 da [0,428, 0,599] y cubre
    // 8 de 10. Un rango estrecho no es un rango preciso: es uno mal medido.
    rtfSamples: [
      0.419, 0.422, 0.426, 0.434, 0.436, 0.440, 0.441, 0.444,
      0.445, 0.449, 0.461, 0.461, 0.463, 0.475, 0.478, 0.509,
      0.511, 0.514, 0.524, 0.542, 0.555, 0.618, 0.646, 0.675,
    ],
    measuredWer: 0.0298,
    werSamples: 8,
    quality: 'alta',
  },
  {
    key: 'turbo-webgpu-q4',
    hfId: 'onnx-community/whisper-large-v3-turbo',
    backend: 'webgpu',
    // Para adaptadores que no dan para fp16. Mismo WER que fp16 en el control
    // (1,8 % sobre un ítem) pero el doble de lento: RTF 0,97.
    dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' },
    downloadMB: 420,
    peakBufferBytes: 0.4 * GB,
    // Una sola medición, sobre un ítem: el rango es desconocido.
    rtfSamples: [0.969],
    // 1,8 % pero sobre UN ítem, no los ocho: menos respaldo que el perfil fp16.
    measuredWer: 0.018,
    werSamples: 1,
    quality: 'alta',
  },
  {
    key: 'base-wasm',
    hfId: 'onnx-community/whisper-base',
    backend: 'wasm',
    // Sin WebGPU. Turbo en WASM es inviable: RTF 4,74 y un ítem cortado por el tope.
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
    downloadMB: 145,
    peakBufferBytes: 0,
    rtfSamples: [0.445],
    measuredWer: 0.296,
    werSamples: 8,
    quality: 'baja',
  },
];

/**
 * Alternativa para quien, sin WebGPU, prefiera esperar el triple a cambio de un tercio
 * menos de errores. No es el defecto porque RTF 1,248 significa que una hora de audio
 * tarda una hora y cuarto: mucha gente abandona antes.
 */
export const SLOW_ACCURATE: ModelProfile = {
  key: 'small-wasm',
  hfId: 'onnx-community/whisper-small',
  backend: 'wasm',
  dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
  downloadMB: 480,
  peakBufferBytes: 0,
  rtfSamples: [1.248],
  measuredWer: 0.195,
  werSamples: 8,
  quality: 'media',
};

/** Mediana de las mediciones. Es el valor central, sin dejarse arrastrar por una anómala. */
export function rtfMedian(profile: ModelProfile): number {
  const xs = [...profile.rtfSamples].sort((a, b) => a - b);
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

/** Percentil por interpolación lineal. */
function percentile(sorted: readonly number[], p: number): number {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/**
 * Rango observado, para decir «entre X e Y» en vez de un número falso-preciso.
 *
 * Usa **percentiles 10 y 90**, no el mínimo y el máximo. Con min/max el rango se ensancha
 * cada vez que se agrega una medición —basta un archivo raro para arruinarlo— y termina
 * siendo tan ancho que no informa nada. Los percentiles describen dónde cae la mayoría y
 * se estabilizan a medida que hay más datos.
 *
 * Con una sola medición el rango es degenerado y `single` lo declara: no es que el equipo
 * sea consistente, es que se midió una vez.
 */
export function rtfRange(profile: ModelProfile): { min: number; max: number; single: boolean } {
  const xs = [...profile.rtfSamples].sort((a, b) => a - b);
  if (xs.length < 2) return { min: xs[0], max: xs[0], single: true };
  return { min: percentile(xs, 0.1), max: percentile(xs, 0.9), single: false };
}

export function profileByKey(key: string): ModelProfile | undefined {
  return [...PROFILES, SLOW_ACCURATE].find((p) => p.key === key);
}

/** Etiqueta del dtype, para registrar con qué se midió. */
export function dtypeLabel(d: Dtype): string {
  return `enc:${d.encoder_model}/dec:${d.decoder_model_merged}`;
}

/**
 * Guarda antes de cargar un modelo.
 *
 * Delega en `evidence.ts`, que sabe qué combinaciones se midieron y con qué resultado.
 * Se llama en el borde —justo antes de cargar— porque el fallo es silencioso: sin esto,
 * una configuración rota transcribe basura sin que nada falle.
 */
export function assertCombinationSafe(hfId: string, backend: Backend, dtype: Dtype): void {
  checkCombination(hfId, backend, dtype);
}
