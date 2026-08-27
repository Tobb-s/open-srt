import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { readWav, resample } from '../../../scripts/lib/wav.mjs';

/**
 * Fase A de E4: ¿se pueden sacar embeddings de hablante en el navegador?
 *
 * ── Lo que esta prueba tiene que responder ──
 *
 * El plan daba por hecho que el obstáculo de esta etapa era **de licencia**: pyannote con
 * gate, Sortformer con CC-BY-NC, y ECAPA de SpeechBrain como única salida pero sin ONNX.
 *
 * El inventario contra la API de Hugging Face dice otra cosa:
 *
 * | repo | licencia | gate | onnx |
 * |---|---|---|---|
 * | `onnx-community/pyannote-segmentation-3.0` | MIT | no | sí |
 * | `onnx-community/wespeaker-voxceleb-resnet34-LM` | CC-BY-4.0 | no | sí |
 *
 * Son los dos modelos de la tubería de pyannote 3.1, portados y sin gate, y transformers.js
 * ya trae las clases para correrlos. Así que la pregunta deja de ser «¿se puede por
 * licencia?» y pasa a ser **«¿los embeddings separan hablantes?»**, que es lo que se mide acá.
 *
 * ── Por qué no alcanza con que el modelo corra ──
 *
 * Un modelo mal alimentado —número de bandas equivocado, sin normalizar— **igual devuelve
 * 256 números**. No falla. La única forma de saber que la tubería está bien armada es
 * comprobar que los embeddings **separan**: que dos clips del mismo hablante se parecen más
 * entre sí que dos de hablantes distintos.
 *
 * Y para que ese número signifique algo hace falta el control: barajar las etiquetas de
 * hablante y ver que la separación **desaparece**. Si con etiquetas al azar la separación
 * fuera parecida, la medición no estaría midiendo hablantes.
 */

const ROOT = path.resolve(import.meta.dirname, '../../..');
const CLIPS = path.join(ROOT, '.corpus-src/extracted/es');
const disponible = existsSync(CLIPS);

const MODELO = 'onnx-community/wespeaker-voxceleb-resnet34-LM';
const RATE = 16000;
/** Cuántos hablantes y cuántos clips de cada uno. Poco, porque es en tiempo de CPU. */
const HABLANTES = 4;
const POR_HABLANTE = 3;

/**
 * De qué hablante es un clip.
 *
 * Prefijo **más número**: `arm_00610_...` y `arm_04310_...` son personas distintas. Quedarse
 * sólo con el prefijo fundiría los ocho hablantes en tres — es el error que E0 ya cometió
 * una vez, al construir el corpus.
 */
function hablanteDe(archivo: string): string {
  return archivo.split('_').slice(0, 2).join('_');
}

function coseno(a: Float32Array, b: Float32Array): number {
  let p = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    p += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return p / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

interface Muestra {
  hablante: string;
  archivo: string;
  emb: Float32Array;
}

const muestras: Muestra[] = [];
let dims = 0;
let fallo: string | null = null;

beforeAll(async () => {
  if (!disponible) return;
  try {
    const { AutoModel, AutoProcessor } = await import('@huggingface/transformers');
    const procesador = await AutoProcessor.from_pretrained(MODELO);
    const modelo = await AutoModel.from_pretrained(MODELO, { dtype: 'fp32', device: 'cpu' });

    // Elegir hablantes con suficientes clips, en orden alfabético para que sea reproducible.
    const porHablante = new Map<string, string[]>();
    for (const f of readdirSync(CLIPS).filter((x) => x.endsWith('.wav')).sort()) {
      const h = hablanteDe(f);
      const lista = porHablante.get(h) ?? [];
      if (lista.length < POR_HABLANTE) lista.push(f);
      porHablante.set(h, lista);
    }
    const elegidos = [...porHablante.entries()]
      .filter(([, v]) => v.length === POR_HABLANTE)
      .slice(0, HABLANTES);

    for (const [hablante, archivos] of elegidos) {
      for (const archivo of archivos) {
        const wav = readWav(readFileSync(path.join(CLIPS, archivo)));
        const a16 =
          wav.sampleRate === RATE ? wav.samples : resample(wav.samples, wav.sampleRate, RATE);
        const entrada = await procesador(a16);
        const salida = await modelo(entrada);
        // La salida se llama `last_hidden_state` y no `embeddings`: el modelo es un
        // `WeSpeakerResNetModel` y devuelve el vector por el nombre genérico de la clase.
        const emb = Float32Array.from(salida.last_hidden_state.data as Float32Array);
        dims = emb.length;
        muestras.push({ hablante, archivo, emb });
      }
    }
  } catch (e) {
    fallo = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
}, 900_000);

describe.skipIf(!disponible)('embeddings de hablante con WeSpeaker', () => {
  it('el modelo carga y produce embeddings', () => {
    expect(fallo, `no se pudo correr el modelo: ${fallo}`).toBeNull();
    expect(muestras.length).toBe(HABLANTES * POR_HABLANTE);
    console.log(`${muestras.length} embeddings de ${HABLANTES} hablantes · ${dims} dimensiones`);
    expect(dims).toBeGreaterThan(100);
  }, 900_000);

  it('separa hablantes: el mismo se parece más a sí mismo que a otro', () => {
    const dentro: number[] = [];
    const fuera: number[] = [];
    for (let i = 0; i < muestras.length; i++) {
      for (let j = i + 1; j < muestras.length; j++) {
        const s = coseno(muestras[i].emb, muestras[j].emb);
        (muestras[i].hablante === muestras[j].hablante ? dentro : fuera).push(s);
      }
    }
    const prom = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    const dm = prom(dentro);
    const fm = prom(fuera);
    console.log(
      `mismo hablante ${dm.toFixed(3)} (n=${dentro.length}) · ` +
        `distinto ${fm.toFixed(3)} (n=${fuera.length}) · brecha ${(dm - fm).toFixed(3)}`,
    );
    console.log(`  peor par del mismo hablante: ${Math.min(...dentro).toFixed(3)}`);
    console.log(`  mejor par de distintos:      ${Math.max(...fuera).toFixed(3)}`);

    expect(dm).toBeGreaterThan(fm);
    // Una brecha chica no serviría para agrupar. Se pide que sea holgada.
    expect(dm - fm).toBeGreaterThan(0.15);
  }, 900_000);

  it('CONTROL: con las etiquetas barajadas, la separación desaparece', () => {
    // Sin esto, la brecha de arriba no distingue «el modelo separa hablantes» de «los
    // embeddings de clips consecutivos se parecen por cualquier otra razón».
    const etiquetas = muestras.map((m) => m.hablante);
    // Barajado determinista: el test no puede depender del azar.
    let s = 12345;
    for (let i = etiquetas.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const j = s % (i + 1);
      [etiquetas[i], etiquetas[j]] = [etiquetas[j], etiquetas[i]];
    }

    const dentro: number[] = [];
    const fuera: number[] = [];
    for (let i = 0; i < muestras.length; i++) {
      for (let j = i + 1; j < muestras.length; j++) {
        const sim = coseno(muestras[i].emb, muestras[j].emb);
        (etiquetas[i] === etiquetas[j] ? dentro : fuera).push(sim);
      }
    }
    const prom = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    const brecha = prom(dentro) - prom(fuera);
    console.log(`[control] brecha con etiquetas al azar: ${brecha.toFixed(3)}`);
    expect(Math.abs(brecha)).toBeLessThan(0.15);
  }, 900_000);
});

describe('el dtype del modelo de embeddings', () => {
  /**
   * El producto corre este modelo en `q8` y la fase A lo midió en `fp32`.
   *
   * La regla que dejó E0 es que **un cambio de dtype exige volver a medir**, nunca «probar si
   * anda»: las combinaciones rotas cargan sin error y devuelven basura con aplomo. Este test
   * es la mitad barata de esa medición — la cara está en `umbral.integration.test.ts`, que
   * rehace el barrido y el holdout con `OPENSRT_DIAR_DTYPE=q8`.
   *
   * Lo que se comprueba acá son dos cosas, y la primera es un **control**: que el parámetro
   * de dtype haga algo. Sin él, «q8 da el mismo resultado que fp32» no distinguiría una
   * cuantización inofensiva de un parámetro que transformers.js ignoró en silencio.
   */
  let a: Float32Array;
  let b: Float32Array;

  beforeAll(async () => {
    if (!disponible) return;
    const { AutoModel, AutoProcessor } = await import('@huggingface/transformers');
    const { readWav: leer } = await import('../../../scripts/lib/wav.mjs');
    const wav = leer(readFileSync(path.join(ROOT, 'public/corpus/es-multi-3min.wav')));
    const trozo = wav.samples.slice(RATE * 5, RATE * 8);
    const proc = await AutoProcessor.from_pretrained(MODELO);
    const vector = async (dtype: 'fp32' | 'q8') => {
      const m = await AutoModel.from_pretrained(MODELO, { dtype, device: 'cpu' });
      const out = await m(await proc(trozo));
      return Float32Array.from(out.last_hidden_state.data as Float32Array);
    };
    a = await vector('fp32');
    b = await vector('q8');
  }, 900_000);

  it('CONTROL: el dtype se aplica de verdad — q8 y fp32 NO dan lo mismo', () => {
    // Si transformers.js ignorara el parámetro y cargara siempre el mismo archivo, los dos
    // vectores serían idénticos bit a bit y toda la comparación de abajo no probaría nada.
    expect(a.length).toBe(b.length);
    const identicas = a.reduce((n, x, i) => n + (x === b[i] ? 1 : 0), 0);
    expect(identicas, 'q8 devolvió exactamente lo mismo que fp32: el dtype no se aplicó').
      toBeLessThan(a.length / 2);
  });

  it('pero la diferencia es mucho menor que el ancho de la meseta del umbral', () => {
    // Medido: coseno 0,9949 entre el mismo audio en fp32 y en q8. El umbral vive en una
    // meseta de 0,35 a 0,50 —0,15 de ancho— así que una perturbación de 0,005 no puede
    // mover ninguna decisión de agrupamiento. Eso es lo que explica que el barrido y el
    // holdout den exactamente los mismos números con los dos dtypes.
    let d = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      d += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    const coseno = d / (Math.sqrt(na) * Math.sqrt(nb));
    console.log(`coseno fp32 ↔ q8: ${coseno.toFixed(6)}`);
    expect(coseno).toBeGreaterThan(0.98);
  });
});
