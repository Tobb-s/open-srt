import { MODELS, modelByKey } from './models';
import { aggregateWer } from './wer';
import { MAX_RTF } from './policy';
import type { BenchRun, Backend, RunResult } from './types';
import type { CorpusManifest } from './corpus';

/**
 * Genera `benchmarks/resultados.md` a partir de una corrida.
 *
 * El reporte es el entregable de E0, así que arrastra consigo todo lo que hace falta
 * para leerlo sin equivocarse: qué equipo, qué corpus, qué mide y qué **no** mide la
 * columna de memoria, y por qué un `timeout` no es lo mismo que un error.
 */

interface Cell {
  rtf?: number;
  wer?: number;
  ins?: number;
  peakMB?: number;
  loadMs?: number;
  status: 'ok' | 'timeout' | 'error' | 'skipped' | 'missing';
  n: number;
}

function fmt(n: number | undefined, digits = 2): string {
  return n === undefined || Number.isNaN(n) ? '—' : n.toFixed(digits);
}

function fmtPct(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return n === undefined ? '—' : '∞';
  return `${(n * 100).toFixed(1)} %`;
}

/** Agrupa los resultados de un par (modelo, backend) en una celda de la tabla. */
export function summarize(results: RunResult[]): Cell {
  const ok = results.filter((r) => r.status === 'ok');
  if (ok.length === 0) {
    const status = results.some((r) => r.status === 'timeout')
      ? 'timeout'
      : results.some((r) => r.status === 'error')
        ? 'error'
        : results.some((r) => r.status === 'skipped')
          ? 'skipped'
          : 'missing';
    return { status, n: results.length };
  }

  // El RTF se agrega ponderando por duración, no promediando los RTF por ítem: un clip
  // de un minuto no debe pesar lo mismo que uno de dos horas.
  const totalInfer = ok.reduce((a, r) => a + (r.inferMs ?? 0), 0);
  const totalAudioMs = ok.reduce(
    (a, r) => a + (r.inferMs && r.rtf ? r.inferMs / r.rtf : 0),
    0,
  );

  const werAgg = aggregateWer(ok.map((r) => r.wer!).filter(Boolean));
  const peak = Math.max(...ok.map((r) => r.memPeak?.mb ?? 0));
  const load = ok.find((r) => r.loadMs !== undefined)?.loadMs;

  return {
    rtf: totalAudioMs > 0 ? totalInfer / totalAudioMs : undefined,
    wer: werAgg.wer,
    ins: werAgg.ins,
    peakMB: peak > 0 ? peak : undefined,
    loadMs: load,
    status: 'ok',
    n: ok.length,
  };
}

function cellText(c: Cell): string {
  switch (c.status) {
    case 'timeout':
      return `⏱ >${MAX_RTF}×`;
    case 'error':
      return '✕ error';
    case 'skipped':
      return 'n/a';
    case 'missing':
      return '—';
    default:
      return `**${fmt(c.rtf)}** · ${fmtPct(c.wer)}`;
  }
}

export function buildReport(run: BenchRun, manifest?: CorpusManifest): string {
  const L: string[] = [];
  const d = run.device;

  L.push('# E0 — resultados medidos');
  L.push('');
  L.push(`Corrida \`${run.runId}\` · ${run.startedAt}`);
  L.push('');
  L.push('> Generado por `src/lib/bench/report.ts`. No editar a mano: se regenera.');
  L.push('');

  L.push('## Equipo');
  L.push('');
  L.push('| | |');
  L.push('|---|---|');
  if (d.label) L.push(`| Etiqueta | ${d.label} |`);
  L.push(`| Navegador | \`${d.userAgent}\` |`);
  L.push(`| WebGPU | ${d.webgpuAvailable ? 'sí' : '**no**'} |`);
  if (d.gpuAdapter) L.push(`| Adaptador | ${d.gpuAdapter} |`);
  L.push(`| Núcleos | ${d.hardwareConcurrency ?? '—'} |`);
  L.push(`| Memoria declarada | ${d.deviceMemoryGB ? `${d.deviceMemoryGB} GB` : '—'} |`);
  L.push(`| Aislamiento cross-origin | ${d.crossOriginIsolated ? 'sí' : 'no'} |`);
  L.push('');

  if (manifest) {
    L.push('## Corpus');
    L.push('');
    L.push(`Versión \`${manifest.version}\`, creado ${manifest.createdAt}.`);
    L.push('');
    L.push('| Fuente | Licencia | Nota |');
    L.push('|---|---|---|');
    for (const s of manifest.sources) {
      L.push(`| [${s.name}](${s.url}) | ${s.license} | ${s.note ?? ''} |`);
    }
    L.push('');
  }

  const backends: Backend[] = ['webgpu', 'wasm'];

  L.push('## Matriz');
  L.push('');
  L.push('Cada celda: **RTF** · WER. RTF menor que 1 es más rápido que tiempo real.');
  L.push('');
  L.push(`| Modelo | ${backends.map((b) => b.toUpperCase()).join(' | ')} | Licencia |`);
  L.push(`|---|${backends.map(() => '---').join('|')}|---|`);

  for (const m of MODELS) {
    const cells = backends.map((b) =>
      cellText(summarize(run.results.filter((r) => r.modelKey === m.key && r.backend === b))),
    );
    L.push(`| \`${m.key}\` | ${cells.join(' | ')} | ${m.license} |`);
  }
  L.push('');

  L.push('## Detalle por par');
  L.push('');
  L.push('| Modelo | Backend | n | RTF | WER | Inserciones | Pico CPU | Carga |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const m of MODELS) {
    for (const b of backends) {
      const rs = run.results.filter((r) => r.modelKey === m.key && r.backend === b);
      if (rs.length === 0) continue;
      const c = summarize(rs);
      if (c.status !== 'ok') {
        L.push(`| \`${m.key}\` | ${b} | ${c.n} | ${cellText(c)} | | | | |`);
        continue;
      }
      L.push(
        `| \`${m.key}\` | ${b} | ${c.n} | ${fmt(c.rtf)} | ${fmtPct(c.wer)} | ${c.ins ?? '—'} | ` +
          `${c.peakMB ? `${c.peakMB.toFixed(0)} MB` : '—'} | ` +
          `${c.loadMs ? `${(c.loadMs / 1000).toFixed(1)} s` : '—'} |`,
      );
    }
  }
  L.push('');

  L.push('## Cómo leer esta tabla');
  L.push('');
  L.push(
    '- **RTF** es tiempo de inferencia sobre duración del audio, agregado ponderando por ' +
      'duración —no promediando los RTF de cada ítem, que sobrepondera los clips cortos—. ' +
      'No incluye la carga del modelo, que va en su propia columna.',
  );
  L.push(
    `- **⏱ >${MAX_RTF}×** no es un fallo técnico sino una decisión: un modelo que tarda más ` +
      'de cinco veces la duración del audio es inservible acá, así que se corta y se ' +
      'registra. Medir su valor exacto no cambiaría ninguna decisión.',
  );
  L.push(
    '- **✕ error** sí es un fallo, y la causa más frecuente esperada es la caída del ' +
      'proceso de GPU. Cada resultado se guardó apenas terminó, así que una caída no se ' +
      'lleva la corrida: la fila queda y se puede reintentar.',
  );
  L.push(
    '- **Inserciones** es la parte del WER que son palabras inventadas. Es la señal de ' +
      'alucinación: dos modelos con el mismo WER pero distinta cantidad de inserciones no ' +
      'fallan igual, y el que inventa es peor para transcribir.',
  );
  L.push(
    '- **Pico CPU** mide el heap del lado del procesador. **No incluye la memoria de la ' +
      'GPU**, que con el backend WebGPU es justamente donde viven los pesos del modelo. ' +
      'Además es un pico muestreado, así que es una cota inferior. Para WebGPU, la ' +
      'evidencia de que un equipo no da es indirecta: aparece como error o timeout.',
  );
  L.push(
    '- **WER**: comparable **entre modelos de esta tabla**, no contra cifras publicadas ' +
      'afuera. La normalización está en `docs/NORMALIZACION-WER.md` y cada trabajo usa la ' +
      'suya; esas diferencias son del mismo orden que las diferencias entre modelos.',
  );
  L.push('');

  const failures = run.results.filter((r) => r.status === 'error' || r.status === 'timeout');
  if (failures.length > 0) {
    L.push('## Fallos');
    L.push('');
    L.push('| Modelo | Backend | Ítem | Estado | Motivo |');
    L.push('|---|---|---|---|---|');
    for (const f of failures) {
      L.push(
        `| \`${f.modelKey}\` | ${f.backend} | ${f.itemId} | ${f.status} | ${f.error ?? ''} |`,
      );
    }
    L.push('');
  }

  L.push('## Decisión');
  L.push('');
  L.push(
    'Se completa a mano una vez leída la tabla, contra el criterio fijado **antes** de ' +
      'medir en `docs/ETAPAS.md` §E0: RTF < 0,4 mantiene turbo por defecto; 0,4–0,8 baja a ' +
      '`small` o `base`; > 0,8 obliga a adelantar el camino de servidor.',
  );
  L.push('');
  L.push('Modelo por defecto elegido: _(pendiente)_');
  L.push('');

  return L.join('\n');
}

/** Nombre de archivo sugerido, con la etiqueta del equipo para no pisar corridas. */
export function reportFilename(run: BenchRun): string {
  const label = run.device.label?.replace(/[^a-z0-9]+/gi, '-').toLowerCase() ?? 'equipo';
  return `resultados-${label}-${run.runId}.md`;
}

export function modelLicenseNote(): string {
  return MODELS.map((m) => `- \`${m.key}\`: ${m.license} (${m.licenseFrom})`).join('\n');
}

export { modelByKey };
