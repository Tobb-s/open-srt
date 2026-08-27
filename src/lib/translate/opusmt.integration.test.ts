import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { wer } from '../bench/wer';
import { normalizeToWords } from '../bench/normalize';

/**
 * ¿Alcanza Opus-MT para subtitular?
 *
 * El plan de E5 lo dejó anotado como **hipótesis**, y con dos supuestos que resultaron
 * inexactos:
 *
 * 1. «Opus-MT es Apache 2.0». El original de Helsinki-NLP sí, pero **no publica ONNX**. El
 *    puerto que se puede usar en el navegador es `onnx-community`, que es **CC-BY-4.0** —
 *    sirve igual, pero es otra licencia y pide atribución.
 * 2. «Son modelos chicos». Son **213 MB** por par de idiomas en fp16, un tercio de lo que pesa
 *    Whisper-turbo. Y hace falta uno por dirección.
 *
 * ── Qué se puede medir sin corpus paralelo ──
 *
 * No hay traducciones de referencia: el corpus de medición tiene español e inglés, pero de
 * **clips distintos**, no del mismo contenido. Así que un BLEU contra referencia humana no se
 * puede calcular acá, y este archivo **no lo calcula ni lo estima**.
 *
 * Lo que sí se mide:
 *
 * - **Ida y vuelta** (es→en→es) contra el original, con la misma maquinaria de WER de E0. Es
 *   un proxy **débil** y hay que decir por qué: acumula dos traducciones, castiga
 *   reformulaciones que son correctas, y un modelo que tradujera mal de forma simétrica
 *   podría volver bien. Sirve para detectar desastres, no para afirmar calidad.
 * - **Cuánto se alarga el texto**, que para subtítulos no es cosmético: la velocidad de
 *   lectura de `toCues` parte un subtítulo que no entra en su tiempo, así que una traducción
 *   sistemáticamente más larga produce más cortes.
 * - **Los peores casos, a la vista**, para poder mirarlos en vez de confiar en un promedio.
 */

const ROOT = path.resolve(import.meta.dirname, '../../..');
const CORPUS = path.join(ROOT, 'public/corpus/manifest.json');
const disponible = existsSync(CORPUS) && process.env.OPENSRT_TRADUCCION === '1';

const MODELO_IDA = 'onnx-community/opus-mt-es-en';
const MODELO_VUELTA = 'onnx-community/opus-mt-en-es';
const DTYPE = 'q8';

interface Caso {
  original: string;
  ingles: string;
  /** Sólo si el modelo de vuelta pudo cargarse. */
  vuelta?: string;
  werIdaVuelta?: number;
  razonLargo: number;
}

const casos: Caso[] = [];
let msPorFrase = 0;
/**
 * Si la ida y vuelta pudo medirse.
 *
 * Son otros 200 MB de descarga y la primera corrida se cortó con `ECONNRESET` a los veinte
 * minutos. Lo que **no** puede pasar es que un problema de red haga desaparecer en silencio
 * las mediciones que sí se hicieron, así que la vuelta es opcional y se declara.
 */
let hayVuelta = false;

beforeAll(async () => {
  if (!disponible) return;
  const { pipeline } = await import('@huggingface/transformers');
  const manifiesto = JSON.parse(readFileSync(CORPUS, 'utf8')) as {
    items: Array<{ id: string; lang: string; reference: string }>;
  };
  // Las frases del corpus, que son las mismas que el modelo de transcripción produce.
  const item = manifiesto.items.find((i) => i.id === 'es-clean-5min')!;
  const frases = item.reference
    .split(/(?<=[.!?])\s+/)
    .map((f) => f.trim())
    .filter((f) => f.split(/\s+/).length >= 5)
    .slice(0, 30);

  const ida = await pipeline('translation', MODELO_IDA, { dtype: DTYPE, device: 'cpu' });

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const t0 = performance.now();
  for (const original of frases) {
    const en = (await (ida as any)(original))[0].translation_text as string;
    casos.push({ original, ingles: en, razonLargo: en.length / Math.max(1, original.length) });
  }
  msPorFrase = (performance.now() - t0) / frases.length;

  // La vuelta es otro modelo y otros 200 MB. Si no se puede bajar, lo que ya se midió queda.
  try {
    const vuelta = await pipeline('translation', MODELO_VUELTA, { dtype: DTYPE, device: 'cpu' });
    for (const c of casos) {
      c.vuelta = (await (vuelta as any)(c.ingles))[0].translation_text as string;
      c.werIdaVuelta = wer(
        normalizeToWords(c.original, 'es'),
        normalizeToWords(c.vuelta, 'es'),
      ).wer;
    }
    hayVuelta = true;
  } catch (e) {
    console.log(`ida y vuelta NO medida: ${e instanceof Error ? e.message : String(e)}`);
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}, 1_800_000);

describe.skipIf(!disponible)('Opus-MT para subtítulos', () => {
  it('traduce: la ida y vuelta se parece al original', (ctx) => {
    // El salteo va acá adentro y no en `it.skipIf`: eso se evalúa al recolectar los tests,
    // antes de que `beforeAll` haya intentado bajar el segundo modelo, así que siempre
    // habría dado «saltear».
    if (!hayVuelta) return ctx.skip();
    const conVuelta = casos.filter((c) => c.werIdaVuelta !== undefined);
    const medio = conVuelta.reduce((a, c) => a + c.werIdaVuelta!, 0) / conVuelta.length;
    console.log(`\nWER de ida y vuelta (proxy DÉBIL): ${(medio * 100).toFixed(1)} %`);
    console.log(`ms por traducción: ${msPorFrase.toFixed(0)}`);

    // Un umbral flojo a propósito: esto detecta desastres, no afirma calidad. Con el modelo
    // roto o cargado a medias, la ida y vuelta se dispara muy por encima de esto.
    expect(medio).toBeLessThan(0.6);
  }, 1_800_000);

  it('el inglés no se alarga tanto como para romper los subtítulos', () => {
    const razon = casos.reduce((a, c) => a + c.razonLargo, 0) / casos.length;
    console.log(`largo en inglés / largo en español: ${razon.toFixed(2)}`);
    // Si el texto creciera mucho, `toCues` partiría más subtítulos por velocidad de lectura
    // y aparecerían cortes donde antes no había.
    expect(razon).toBeLessThan(1.3);
  }, 1_800_000);

  it('deja TODAS las traducciones a la vista, para poder mirarlas', () => {
    // Sin aserción sobre el contenido: el punto es que queden impresas. Un promedio esconde
    // justo el caso que importa —una traducción fluida y falsa— y este proyecto ya se comió
    // esa lección con las omisiones de Whisper en E1.
    const orden = hayVuelta
      ? [...casos].sort((a, b) => (b.werIdaVuelta ?? 0) - (a.werIdaVuelta ?? 0))
      : casos;
    console.log(`
traducciones (${hayVuelta ? 'peores primero' : 'sin ida y vuelta'}):`);
    for (const c of orden) {
      const w = c.werIdaVuelta !== undefined ? ` — ida y vuelta ${(c.werIdaVuelta * 100).toFixed(0)} %` : '';
      console.log(`  ES  ${c.original}${w}`);
      console.log(`  EN  ${c.ingles}`);
      if (c.vuelta) console.log(`  ES' ${c.vuelta}`);
    }
    expect(casos.length).toBeGreaterThan(10);
  }, 1_800_000);
});
