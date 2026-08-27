import { agglomerative, labelsOf } from './cluster';
import type { Segment } from '../vad/segments';

/**
 * Separar hablantes: la tubería del producto.
 *
 * `tramos de voz (E2) → un embedding por tramo → agrupamiento → una etiqueta por tramo`.
 *
 * ── Lo que está medido y dónde ──
 *
 * Todo lo que hay acá salió de la fase A de E4, en `docs/E4-ESTADO.md`:
 *
 * - El modelo es `onnx-community/wespeaker-voxceleb-resnet34-LM`, CC-BY-4.0 y sin gate. 25 MB
 *   junto a los ~800 MB de Whisper: no se nota.
 * - El umbral **0,475** no está puesto a ojo: el barrido sobre el conjunto de elección da una
 *   meseta plana entre 0,35 y 0,50, y se tomó su centro. Sobre voces que no participaron de
 *   esa elección, el DER quedó en 2,8 % y 2,3 %.
 * - `MIN_SEC` descarta los tramos demasiado cortos para dar un embedding confiable. Esos
 *   tramos **no se pierden**: heredan el hablante del vecino más cercano, porque un tramo sin
 *   atribuir en la pantalla se lee como un error.
 *
 * ── Lo que no hace ──
 *
 * No detecta habla solapada: cada tramo tiene un hablante. Donde hablan dos a la vez, uno se
 * pierde. Y tiende a partir de más — en la medición encontró cuatro grupos donde había tres.
 */

/** Cosa mínima que hace falta del modelo, para poder probar esto sin cargarlo. */
export interface EmbeddingModel {
  (audio: Float32Array): Promise<Float32Array>;
}

/**
 * Umbral de coseno para decidir que dos tramos son la misma persona.
 *
 * Medido, no elegido a ojo: es el centro de la meseta del barrido de la fase A.
 */
export const SPEAKER_THRESHOLD = 0.475;

/** Un tramo más corto que esto no da un embedding en el que se pueda confiar. */
export const MIN_SEC = 0.6;

/**
 * Tope de hablantes.
 *
 * No es una limitación del modelo sino una decisión de producto: si el agrupamiento devuelve
 * quince personas en una reunión de cuatro, el resultado es peor que inútil — hay que
 * corregirlo tramo por tramo. Prefiere juntar de más a inventar gente.
 */
export const MAX_SPEAKERS = 8;

export interface DiarizeOptions {
  audio: Float32Array;
  segments: readonly Segment[];
  sampleRate: number;
  embed: EmbeddingModel;
  threshold?: number;
  maxSpeakers?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface DiarizeResult {
  /** Una etiqueta por tramo de entrada, en el mismo orden. */
  speakers: string[];
  /** Cuántas personas distintas se encontraron. */
  count: number;
}

/**
 * Etiqueta cada tramo con quién habla.
 *
 * Devuelve etiquetas neutras —`0`, `1`, `2`— y no nombres: ponerles nombre es cosa de quien
 * mira la pantalla, no del modelo.
 */
export async function diarize(opts: DiarizeOptions): Promise<DiarizeResult> {
  const { audio, segments, sampleRate, embed } = opts;
  if (segments.length === 0) return { speakers: [], count: 0 };

  // Sólo los tramos largos entran al agrupamiento; los cortos se reparten después.
  const indicesLargos: number[] = [];
  for (const [i, s] of segments.entries()) {
    if (s.endSec - s.startSec >= MIN_SEC) indicesLargos.push(i);
  }

  // Sin ninguno largo no hay nada que separar: todo es la misma persona, que es lo más
  // parecido a la verdad que se puede afirmar con esa evidencia.
  if (indicesLargos.length === 0) {
    return { speakers: segments.map(() => '0'), count: 1 };
  }

  const embs: Float32Array[] = [];
  for (const [k, i] of indicesLargos.entries()) {
    if (opts.signal?.aborted) throw new Error('Cancelado');
    const s = segments[i];
    const trozo = audio.slice(
      Math.round(s.startSec * sampleRate),
      Math.min(audio.length, Math.round(s.endSec * sampleRate)),
    );
    embs.push(await embed(trozo));
    opts.onProgress?.(k + 1, indicesLargos.length);
  }

  const grupos = agglomerative(embs, {
    threshold: opts.threshold ?? SPEAKER_THRESHOLD,
    maxClusters: opts.maxSpeakers ?? MAX_SPEAKERS,
  });
  const etiquetasLargos = labelsOf(grupos, embs.length);

  // Los tramos cortos heredan del vecino más cercano en el tiempo. Dejarlos sin atribuir
  // sería más honesto en abstracto, pero en pantalla un tramo sin nombre entre dos con
  // nombre se lee como un error del programa, no como una duda.
  const speakers = new Array<string>(segments.length);
  for (const [k, i] of indicesLargos.entries()) speakers[i] = etiquetasLargos[k];

  for (let i = 0; i < segments.length; i++) {
    if (speakers[i] !== undefined) continue;
    let mejor = -1;
    let distancia = Infinity;
    for (const j of indicesLargos) {
      const d = Math.abs(segments[j].startSec - segments[i].startSec);
      if (d < distancia) {
        distancia = d;
        mejor = j;
      }
    }
    speakers[i] = mejor >= 0 ? speakers[mejor] : '0';
  }

  return { speakers, count: new Set(speakers).size };
}

/** Nombre por defecto de un hablante, para mostrar. */
export function defaultSpeakerName(label: string, plantilla: (n: number) => string): string {
  const n = Number(label);
  return Number.isFinite(n) ? plantilla(n + 1) : label;
}
