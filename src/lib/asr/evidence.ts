import type { Backend, Dtype } from './models';

/**
 * Lo que E0 midió sobre combinaciones de modelo, backend y precisión.
 *
 * ── Por qué es una tabla y no una regla ──
 *
 * El primer intento fue una regla general: «el encoder en `q8` está roto, el decoder en
 * `fp16` está roto». Un test de consistencia la tumbó — prohibía perfiles del propio
 * catálogo que **están medidos y funcionan**. Mirando todo lo medido junto:
 *
 * | modelo | backend | encoder `q8` | WER |
 * |---|---|---|---|
 * | turbo | webgpu | q8 | **100 % — roto** |
 * | turbo | wasm | q8 | 1,8 % — bien |
 * | small | wasm | q8 | 19,5 % — bien |
 * | base | wasm | q8 | 29,6 % — bien |
 * | tiny | wasm | q8 | **87,7 % — roto** |
 *
 * `q8` no está roto en general: está roto **en WebGPU**, y en WASM sólo falla en `tiny`.
 * Lo mismo con `fp32`, que no «es demasiado grande» sino que no entra **para large-v3**:
 * con `small` carga y da 20,5 %.
 *
 * Así que acá no hay reglas sobre precisiones: hay **combinaciones medidas**. Una que no
 * figura no es segura ni insegura — es desconocida, y el código lo dice en esos términos
 * en vez de inventar una generalización.
 *
 * El modo de fallo hace que esto importe: las combinaciones rotas **cargan sin error y
 * transcriben con aplomo**, devolviendo basura. No hay excepción que atrapar.
 */

export type Verdict = 'ok' | 'broken' | 'unusable';

export interface Measurement {
  /** Fragmento identificatorio del `hfId`, p. ej. `whisper-large-v3-turbo`. */
  model: string;
  backend: Backend;
  encoder: Dtype['encoder_model'];
  decoder: Dtype['decoder_model_merged'];
  /** WER medido. `null` cuando no llegó a transcribir. */
  wer: number | null;
  verdict: Verdict;
  note: string;
}

export const MEASUREMENTS: readonly Measurement[] = [
  // ── large-v3-turbo ────────────────────────────────────────────────────────
  {
    model: 'whisper-large-v3-turbo', backend: 'webgpu', encoder: 'fp16', decoder: 'q4',
    wer: 0.0298, verdict: 'ok',
    note:
      'El perfil elegido. 8 ítems del nivel A sobre el corpus corregido, RTF 0,457. ' +
      'Validado con 10 archivos independientes: WER 0,78 % en español y 12,2 % en inglés, ' +
      'diferencia causada por omisiones del modelo (ver resultados-revalidacion.md).',
  },
  {
    model: 'whisper-large-v3-turbo', backend: 'webgpu', encoder: 'q4', decoder: 'q4',
    wer: 0.018, verdict: 'ok',
    note: 'Misma calidad que fp16 pero el doble de lento (RTF 0,97). Medido sobre 1 ítem.',
  },
  {
    model: 'whisper-large-v3-turbo', backend: 'webgpu', encoder: 'q8', decoder: 'q4',
    wer: 1.0, verdict: 'broken',
    note: 'Sale roto: 100 % de WER. Carga sin error y transcribe basura.',
  },
  {
    model: 'whisper-large-v3-turbo', backend: 'webgpu', encoder: 'fp32', decoder: 'q4',
    wer: null, verdict: 'broken',
    note:
      'No carga: el encoder de large-v3 en fp32 (~2,5 GB) excede el maxBufferSize de 2 GB. ' +
      'Se manifiesta como timeout de 900 s, sin ningún error que lo explique.',
  },
  {
    model: 'whisper-large-v3-turbo', backend: 'wasm', encoder: 'q8', decoder: 'q8',
    wer: 0.018, verdict: 'unusable',
    note: 'Transcribe bien pero a RTF 4,74: una hora de audio son casi cinco de espera.',
  },

  // ── small ─────────────────────────────────────────────────────────────────
  {
    model: 'whisper-small', backend: 'webgpu', encoder: 'fp16', decoder: 'fp16',
    wer: 5.806, verdict: 'broken',
    note: '580 % de WER, 14 120 inserciones. El decoder en fp16 destruye el modelo.',
  },
  {
    model: 'whisper-small', backend: 'webgpu', encoder: 'fp32', decoder: 'q4',
    wer: 0.205, verdict: 'ok',
    note: 'fp32 sí entra para small: el problema de 2 GB era específico de large-v3.',
  },
  {
    model: 'whisper-small', backend: 'wasm', encoder: 'q8', decoder: 'q8',
    wer: 0.195, verdict: 'ok',
    note: 'Lento (RTF 1,248) pero correcto. La alternativa precisa sin GPU.',
  },

  // ── base ──────────────────────────────────────────────────────────────────
  {
    model: 'whisper-base', backend: 'wasm', encoder: 'q8', decoder: 'q8',
    wer: 0.296, verdict: 'ok',
    note: 'El respaldo sin GPU. RTF 0,445.',
  },
  {
    model: 'whisper-base', backend: 'webgpu', encoder: 'fp32', decoder: 'q4',
    wer: 0.366, verdict: 'ok',
    note: 'Funciona, pero peor que small y turbo.',
  },

  // ── tiny ──────────────────────────────────────────────────────────────────
  {
    model: 'whisper-tiny', backend: 'wasm', encoder: 'q8', decoder: 'q8',
    wer: 0.877, verdict: 'broken',
    note:
      '87,7 % de WER con 1079 inserciones: alucina masivamente. El mismo q8 que en base y ' +
      'small funciona bien, así que es una fragilidad de tiny, no de la cuantización.',
  },
  {
    model: 'whisper-tiny', backend: 'webgpu', encoder: 'fp32', decoder: 'q4',
    wer: 0.332, verdict: 'ok',
    note: 'Funciona, pero con el peor WER utilizable de la matriz.',
  },
];

function modelKeyOf(hfId: string): string {
  return hfId.split('/').pop() ?? hfId;
}

/**
 * Busca una medición.
 *
 * `table` existe para poder probar el filtro de backend. Hoy ninguna combinación de
 * modelo y dtype está medida en los dos backends, así que con la tabla real ese filtro
 * no se ejercita nunca —una prueba de mutación lo demostró: quitarlo no rompía nada—.
 * Pero hace falta igual: `q8` está roto en WebGPU y bien en WASM, así que el día que se
 * mida un mismo dtype en ambos, confundirlos daría por buena una configuración rota.
 */
export function lookup(
  hfId: string,
  backend: Backend,
  dtype: Dtype,
  table: readonly Measurement[] = MEASUREMENTS,
): Measurement | undefined {
  const model = modelKeyOf(hfId);
  return table.find(
    (m) =>
      m.model === model &&
      m.backend === backend &&
      m.encoder === dtype.encoder_model &&
      m.decoder === dtype.decoder_model_merged,
  );
}

export class BrokenCombinationError extends Error {
  constructor(readonly measurement: Measurement) {
    super(
      `Combinación medida rota en E0: ${measurement.model} / ${measurement.backend} / ` +
        `enc:${measurement.encoder}/dec:${measurement.decoder}. ${measurement.note}`,
    );
    this.name = 'BrokenCombinationError';
  }
}

/**
 * Rechaza lo que E0 midió roto o inservible.
 *
 * Sobre una combinación que no está en la tabla **no afirma nada**: la deja pasar y la
 * marca como no verificada. Bloquear lo desconocido impediría probar configuraciones
 * nuevas; afirmar que es segura sería mentir. Quien la use tiene que medir el WER, no
 * «ver si anda» — porque anda igual estando rota.
 */
export function checkCombination(
  hfId: string,
  backend: Backend,
  dtype: Dtype,
  table: readonly Measurement[] = MEASUREMENTS,
): { status: 'measured-ok' | 'unverified'; measurement?: Measurement } {
  const m = lookup(hfId, backend, dtype, table);
  if (!m) return { status: 'unverified' };
  if (m.verdict === 'broken' || m.verdict === 'unusable') throw new BrokenCombinationError(m);
  return { status: 'measured-ok', measurement: m };
}
