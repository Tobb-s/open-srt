import type { CorpusItem } from './types';

/**
 * Carga del corpus a partir de su manifiesto.
 *
 * El manifiesto vive en `public/corpus/manifest.json` y es la única fuente de verdad
 * sobre qué se mide. Lleva el SHA-256 de cada audio por el mismo motivo que los
 * manifiestos de los repos de trading: sin él, una tabla de resultados de hoy y otra de
 * la semana que viene no son comparables, y no hay forma de notarlo.
 */

export interface CorpusManifest {
  /** Versión del corpus. Cambiarla invalida la comparación con corridas anteriores. */
  version: string;
  createdAt: string;
  /** Semilla del generador. Con ella, reconstruir da los mismos bytes. */
  seed?: number;
  targetSampleRate?: number;
  builtBy?: string;
  levels?: Record<string, string>;
  /**
   * Qué del corpus es habla natural y qué está construido.
   *
   * Viaja con el manifiesto a propósito: los ítems son frases de TTS concatenadas, no
   * habla continua, y el ruido y el solapamiento están fabricados a valores exactos. Sin
   * eso escrito, alguien lee un WER de este corpus como si fuera de audio real.
   */
  construction?: {
    note: string;
    gapSec?: number;
    noisy?: string;
    multi?: string;
    omitted?: string;
  };
  /** De dónde salió cada fuente y bajo qué licencia. */
  sources: Array<{
    name: string;
    url: string;
    license: string;
    note?: string;
    lang?: string;
    speakers?: number;
    /** Si el murmullo de `noisy` comparte hablantes con la señal por falta de material. */
    sharedNoiseSpeakers?: boolean;
  }>;
  items: CorpusItem[];
}

export const MANIFEST_URL = '/corpus/manifest.json';

export async function loadCorpus(url = MANIFEST_URL): Promise<CorpusManifest> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `No hay manifiesto de corpus en ${url} (HTTP ${res.status}). ` +
        'Armarlo es el primer paso de E0: ver docs/E0-ESTADO.md.',
    );
  }
  const manifest = (await res.json()) as CorpusManifest;
  validateManifest(manifest);
  return manifest;
}

/**
 * Comprueba el manifiesto antes de medir nada.
 *
 * Vale la pena porque los errores que atrapa son silenciosos: un ítem sin referencia
 * daría WER 1 o infinito y parecería un modelo malísimo; una duración mal declarada
 * daría un RTF mentido, que es peor porque parece plausible.
 */
export function validateManifest(m: CorpusManifest): void {
  const problems: string[] = [];

  if (!m.version) problems.push('falta `version`');
  if (!Array.isArray(m.items) || m.items.length === 0) problems.push('no hay ítems');

  const seen = new Set<string>();
  for (const [i, item] of (m.items ?? []).entries()) {
    const where = `ítem ${i}${item?.id ? ` (${item.id})` : ''}`;
    if (!item.id) problems.push(`${where}: falta id`);
    else if (seen.has(item.id)) problems.push(`${where}: id repetido`);
    else seen.add(item.id);

    if (!item.url) problems.push(`${where}: falta url`);
    if (!item.reference?.trim()) problems.push(`${where}: referencia vacía`);
    if (!item.sha256 || !/^[0-9a-f]{64}$/.test(item.sha256))
      problems.push(`${where}: sha256 ausente o mal formado`);
    if (!(item.durationSec > 0)) problems.push(`${where}: durationSec debe ser > 0`);
    if (item.lang !== 'es' && item.lang !== 'en')
      problems.push(`${where}: lang debe ser 'es' o 'en'`);
    if (item.level !== undefined && !['A', 'B', 'V'].includes(item.level))
      problems.push(`${where}: level debe ser 'A', 'B' o 'V'`);
    if (item.split !== undefined && !['principal', 'validacion'].includes(item.split))
      problems.push(`${where}: split debe ser 'principal' o 'validacion'`);
    // Un ítem que dice ser multi con menos de dos hablantes no es multi. Pasó de verdad:
    // el corpus en inglés tiene 3 hablantes y el reparto inicial dejó el ítem con uno.
    if (item.condition === 'multi' && (item.speakers ?? 0) < 2)
      problems.push(`${where}: condition 'multi' con ${item.speakers ?? 0} hablante(s)`);
    if (item.condition === 'noisy' && item.snrDb === undefined)
      problems.push(`${where}: condition 'noisy' sin snrDb declarado`);
  }

  if (problems.length > 0) {
    throw new Error(`Manifiesto de corpus inválido:\n  - ${problems.join('\n  - ')}`);
  }
}

/** Resumen del corpus, para el encabezado del reporte. */
export function describeCorpus(m: CorpusManifest): string {
  const byLang = new Map<string, number>();
  let totalSec = 0;
  for (const i of m.items) {
    byLang.set(i.lang, (byLang.get(i.lang) ?? 0) + 1);
    totalSec += i.durationSec;
  }
  const langs = [...byLang.entries()].map(([l, n]) => `${n} ${l}`).join(', ');
  return `${m.items.length} ítems (${langs}), ${(totalSec / 60).toFixed(1)} min de audio`;
}
