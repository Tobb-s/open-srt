import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { validateManifest, describeCorpus, type CorpusManifest } from './corpus';
import { normalizeToWords } from './normalize';
import { MODELS, shouldRun } from './models';

/**
 * Test de integración contra el corpus **real** construido en `public/corpus/`.
 *
 * Los tests de `bench.test.ts` usan manifiestos inventados a mano, así que sólo prueban
 * que el validador funciona sobre lo que el propio test imagina. Este prueba lo otro: que
 * el corpus que de verdad se va a medir pasa esa validación. Las dos mitades hacen falta
 * — un validador correcto sobre un corpus que nadie validó no sirve de nada.
 *
 * Si el corpus no está construido, los tests se saltean con un aviso en vez de fallar:
 * el audio no se versiona (son 155 MB) y se regenera con `npm run corpus:build`.
 */

const MANIFEST = path.resolve(process.cwd(), 'public', 'corpus', 'manifest.json');
const built = existsSync(MANIFEST);

const manifest: CorpusManifest | null = built
  ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as CorpusManifest)
  : null;

describe.skipIf(!built)('corpus real', () => {
  it('pasa el validador que usa el runner', () => {
    expect(() => validateManifest(manifest!)).not.toThrow();
  });

  it('cubre los dos idiomas', () => {
    const langs = new Set(manifest!.items.map((i) => i.lang));
    expect(langs).toContain('es');
    expect(langs).toContain('en');
  });

  it('cubre las tres condiciones acústicas', () => {
    const conds = new Set(manifest!.items.map((i) => i.condition));
    expect(conds).toContain('clean');
    expect(conds).toContain('noisy');
    expect(conds).toContain('multi');
  });

  it('todo ítem multi tiene al menos dos hablantes', () => {
    // Lo que falló al construirlo: el corpus en inglés tiene 3 hablantes y el reparto
    // inicial dejó el ítem `multi` con uno solo, o sea sin nada que separar.
    for (const i of manifest!.items.filter((x) => x.condition === 'multi')) {
      expect(i.speakers ?? 0, i.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('todo ítem noisy declara su SNR', () => {
    // Sin el número, "con ruido" no significa nada y dos corpus no son comparables.
    for (const i of manifest!.items.filter((x) => x.condition === 'noisy')) {
      expect(i.snrDb, i.id).toBeTypeOf('number');
    }
  });

  it('las referencias normalizan a algo con palabras suficientes para un WER estable', () => {
    for (const i of manifest!.items) {
      const words = normalizeToWords(i.reference, i.lang);
      // Con menos de 50 palabras, un solo error mueve el WER más de dos puntos.
      expect(words.length, i.id).toBeGreaterThan(50);
    }
  });

  it('las duraciones declaradas son coherentes con la cantidad de palabras', () => {
    // Control cruzado: un ítem cuya referencia no guarde relación con su duración
    // significa que audio y texto se desalinearon al construirlo. El habla ronda las
    // 2 a 4 palabras por segundo; se acepta un rango ancho por los silencios.
    for (const i of manifest!.items) {
      const wps = normalizeToWords(i.reference, i.lang).length / i.durationSec;
      expect(wps, `${i.id}: ${wps.toFixed(2)} palabras/s`).toBeGreaterThan(0.5);
      expect(wps, `${i.id}: ${wps.toFixed(2)} palabras/s`).toBeLessThan(6);
    }
  });

  it('declara qué está construido y qué no', () => {
    // La honestidad del corpus viaja con él: son frases de TTS concatenadas, no habla
    // continua, y eso cambia cómo se leen los WER.
    expect(manifest!.construction).toBeDefined();
    expect(JSON.stringify(manifest!.construction)).toMatch(/TTS|continua/);
  });

  it('cada fuente declara licencia', () => {
    expect(manifest!.sources.length).toBeGreaterThan(0);
    for (const s of manifest!.sources) {
      expect(s.license, s.name).toBeTruthy();
      expect(s.url, s.name).toMatch(/^https?:\/\//);
    }
  });

  it('el nivel A tiene un costo de corrida razonable', () => {
    const a = manifest!.items.filter((i) => i.level === 'A');
    const minutes = a.reduce((acc, i) => acc + i.durationSec, 0) / 60;
    const combos = MODELS.length * 2;
    const hoursAtRtf1 = (minutes * combos) / 60;
    // Si esto se dispara, la matriz dejó de ser corrible en una tarde y hay que
    // recortar el corpus, no descubrirlo a las seis horas de corrida.
    expect(hoursAtRtf1, `${hoursAtRtf1.toFixed(1)} h con RTF 1`).toBeLessThan(8);
  });

  it('Moonshine sólo se correría sobre los ítems en inglés', () => {
    const moon = MODELS.find((m) => m.key === 'moonshine-base')!;
    const runnable = manifest!.items.filter((i) => shouldRun(moon, i.lang));
    expect(runnable.length).toBeGreaterThan(0);
    for (const i of runnable) expect(i.lang).toBe('en');
  });

  it('describeCorpus resume sin romperse', () => {
    expect(describeCorpus(manifest!)).toMatch(/ítems/);
  });
});

describe.skipIf(built)('corpus real', () => {
  it('no está construido — correr `npm run corpus:build`', () => {
    expect(built).toBe(false);
  });
});
