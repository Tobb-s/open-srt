import { describe, it, expect } from 'vitest';
import { MODELS, shouldRun, modelByKey } from './models';
import { validateManifest, describeCorpus, type CorpusManifest } from './corpus';
import { summarize, buildReport } from './report';
import { decisionFor, DECISION_THRESHOLDS, MAX_RTF } from './policy';
import type { BenchRun, RunResult } from './types';

const baseResult = (over: Partial<RunResult>): RunResult => ({
  modelKey: 'whisper-tiny',
  backend: 'wasm',
  itemId: 'i1',
  status: 'ok',
  startedAt: '2026-08-23T00:00:00.000Z',
  ...over,
});

describe('catálogo de modelos', () => {
  it('las claves no se repiten', () => {
    const keys = MODELS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('toda licencia dice de dónde salió', () => {
    // Las licencias ya descartaron a Sortformer y condicionaron a Moonshine. Una
    // licencia sin procedencia es una licencia que nadie verificó.
    for (const m of MODELS) {
      expect(m.license, m.key).toBeTruthy();
      expect(m.licenseFrom, m.key).toBeTruthy();
    }
  });

  it('ninguna licencia del catálogo es no comercial', () => {
    // El filtro que mantiene fuera a Sortformer (CC-BY-NC) y al Moonshine multilingüe.
    for (const m of MODELS) {
      expect(m.license.toLowerCase(), m.key).not.toContain('nc');
      expect(m.license.toLowerCase(), m.key).not.toContain('noncommercial');
    }
  });

  it('modelByKey encuentra y no inventa', () => {
    expect(modelByKey('whisper-turbo')?.hfId).toContain('whisper-large-v3-turbo');
    expect(modelByKey('no-existe')).toBeUndefined();
  });
});

describe('shouldRun — la licencia decide qué se corre', () => {
  const moonshine = MODELS.find((m) => m.key === 'moonshine-base')!;
  const turbo = MODELS.find((m) => m.key === 'whisper-turbo')!;

  it('Moonshine NO corre sobre español', () => {
    // No porque ande mal: el modelo multilingüe tiene licencia no comercial. Medirlo
    // daría un número que no se puede usar para decidir nada.
    expect(shouldRun(moonshine, 'es')).toBe(false);
  });

  it('Moonshine sí corre sobre inglés', () => {
    expect(shouldRun(moonshine, 'en')).toBe(true);
  });

  it('los multilingües corren sobre los dos', () => {
    expect(shouldRun(turbo, 'es')).toBe(true);
    expect(shouldRun(turbo, 'en')).toBe(true);
  });
});

describe('validateManifest — atrapa los errores silenciosos', () => {
  const ok = (): CorpusManifest => ({
    version: '1',
    createdAt: '2026-08-23',
    sources: [],
    items: [
      {
        id: 'a',
        url: '/corpus/a.wav',
        lang: 'es',
        durationSec: 10,
        condition: 'clean',
        reference: 'hola mundo',
        sha256: 'a'.repeat(64),
      },
    ],
  });

  it('acepta un manifiesto correcto', () => {
    expect(() => validateManifest(ok())).not.toThrow();
  });

  it('rechaza una referencia vacía', () => {
    // Sin referencia el WER daría 1 o infinito, y parecería un modelo malísimo.
    const m = ok();
    m.items[0].reference = '   ';
    expect(() => validateManifest(m)).toThrow(/referencia vacía/);
  });

  it('rechaza una duración no positiva', () => {
    // El RTF se divide por este número: una duración mentida da un RTF mentido,
    // y encima plausible.
    const m = ok();
    m.items[0].durationSec = 0;
    expect(() => validateManifest(m)).toThrow(/durationSec/);
  });

  it('rechaza un sha256 mal formado', () => {
    const m = ok();
    m.items[0].sha256 = 'abc';
    expect(() => validateManifest(m)).toThrow(/sha256/);
  });

  it('rechaza ids repetidos', () => {
    const m = ok();
    m.items.push({ ...m.items[0] });
    expect(() => validateManifest(m)).toThrow(/repetido/);
  });

  it('acumula todos los problemas, no sólo el primero', () => {
    const m = ok();
    m.items[0].reference = '';
    m.items[0].sha256 = 'x';
    expect(() => validateManifest(m)).toThrow(/referencia vacía[\s\S]*sha256/);
  });

  it('describeCorpus cuenta ítems y minutos', () => {
    expect(describeCorpus(ok())).toContain('1 ítems');
    expect(describeCorpus(ok())).toContain('0.2 min');
  });
});

describe('summarize — agrega el RTF ponderando por duración', () => {
  it('NO promedia los RTF por ítem', () => {
    // Ítem corto (1 s de audio, RTF 4) e ítem largo (100 s de audio, RTF 1).
    // Promediar daría 2,5; ponderar por duración da ~1,03, que es la verdad:
    // se procesaron 101 s de audio en 104 s.
    const rs = [
      baseResult({ inferMs: 4000, rtf: 4, wer: { wer: 0, sub: 0, del: 0, ins: 0, refWords: 5, hypWords: 5 } }),
      baseResult({ itemId: 'i2', inferMs: 100_000, rtf: 1, wer: { wer: 0, sub: 0, del: 0, ins: 0, refWords: 500, hypWords: 500 } }),
    ];
    const c = summarize(rs);
    expect(c.rtf!).toBeCloseTo(104_000 / 101_000, 3);
    expect(c.rtf!).toBeLessThan(2);
  });

  it('ignora los resultados fallidos al agregar', () => {
    const rs = [
      baseResult({ inferMs: 1000, rtf: 1, wer: { wer: 0, sub: 0, del: 0, ins: 0, refWords: 10, hypWords: 10 } }),
      baseResult({ itemId: 'i2', status: 'timeout' }),
    ];
    expect(summarize(rs).n).toBe(1);
  });

  it('un par sin ningún ok reporta el peor estado, no "vacío"', () => {
    expect(summarize([baseResult({ status: 'timeout' })]).status).toBe('timeout');
    expect(summarize([baseResult({ status: 'error' })]).status).toBe('error');
    expect(summarize([baseResult({ status: 'skipped' })]).status).toBe('skipped');
    expect(summarize([]).status).toBe('missing');
  });

  it('propaga las inserciones, que son la señal de alucinación', () => {
    const rs = [
      baseResult({
        inferMs: 1000, rtf: 1,
        wer: { wer: 2, sub: 0, del: 0, ins: 20, refWords: 10, hypWords: 30 },
      }),
    ];
    expect(summarize(rs).ins).toBe(20);
  });
});

describe('decisionFor — el criterio fijado antes de medir', () => {
  it('aplica los tres tramos', () => {
    expect(decisionFor(0.3)).toBe('turbo');
    expect(decisionFor(0.6)).toBe('smaller');
    expect(decisionFor(1.2)).toBe('server');
  });

  it('los bordes caen del lado documentado', () => {
    expect(decisionFor(DECISION_THRESHOLDS.turboKeeps)).toBe('smaller');
    expect(decisionFor(DECISION_THRESHOLDS.fallbackToSmaller)).toBe('smaller');
    expect(decisionFor(DECISION_THRESHOLDS.fallbackToSmaller + 0.01)).toBe('server');
  });
});

describe('buildReport — el entregable de E0', () => {
  const run: BenchRun = {
    runId: 'test-1',
    startedAt: '2026-08-23T00:00:00.000Z',
    device: {
      userAgent: 'test',
      webgpuAvailable: false,
      crossOriginIsolated: false,
      label: 'modesto',
    },
    results: [
      baseResult({ inferMs: 1000, rtf: 0.5, wer: { wer: 0.1, sub: 1, del: 0, ins: 0, refWords: 10, hypWords: 10 }, memPeak: { mb: 300, source: 'performance.memory' } }),
      baseResult({ modelKey: 'whisper-turbo', backend: 'webgpu', status: 'timeout' }),
    ],
  };

  it('incluye todos los modelos del catálogo, medidos o no', () => {
    const md = buildReport(run);
    for (const m of MODELS) expect(md).toContain(m.key);
  });

  it('advierte que el WER no es comparable con la literatura', () => {
    // La advertencia tiene que viajar con la tabla: un número suelto se cita mal.
    expect(buildReport(run)).toMatch(/no contra cifras publicadas/);
  });

  it('advierte que la memoria no incluye la GPU', () => {
    expect(buildReport(run)).toMatch(/No incluye la memoria de la\s+GPU/);
  });

  it('lista los fallos en vez de esconderlos', () => {
    const md = buildReport(run);
    expect(md).toContain('## Fallos');
    expect(md).toContain('timeout');
  });

  it('explica que el timeout es una decisión y no un fallo técnico', () => {
    expect(buildReport(run)).toContain(`>${MAX_RTF}×`);
  });

  it('deja la decisión pendiente en vez de inventarla', () => {
    expect(buildReport(run)).toContain('_(pendiente)_');
  });
});
