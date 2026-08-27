import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { toSegments, WINDOW_SAMPLES, type Segment } from '../vad/segments';
import { agglomerative, labelsOf } from './cluster';
import { computeDer, type Turn } from './der';
import { readWav } from '../../../scripts/lib/wav.mjs';

/**
 * Elegir el umbral del agrupamiento, sin elegirlo sobre el examen.
 *
 * ── El problema con afinar un parámetro ──
 *
 * El umbral decide cuándo dos tramos son la misma persona. Es un número y hay que ponerlo
 * midiendo. Pero si se barre sobre los mismos ítems con los que después se reporta el
 * resultado, el número que sale es **el mejor posible para ese audio**, y no dice nada sobre
 * lo que va a pasar con una reunión ajena.
 *
 * Por eso hay dos conjuntos, y son de **voces distintas**:
 *
 * - Elección: `es-multi-3min` (`arm_00610`, `arm_01523`, `arm_02484`) y `en-multi-3min`.
 * - Reporte: `es-multi-holdout` (`arm_03397`, `arm_04310`, `arm_05223`) y `en-multi-holdout`.
 *   Nadie que haya participado de la elección.
 *
 * El split `validacion` del corpus **no servía** para esto: son clips distintos de los mismos
 * hablantes. Para un umbral de «cuánto se parecen dos voces», lo que hay que probar es que
 * generalice a voces nuevas, no a frases nuevas de voces conocidas.
 *
 * ── Por qué el centro de la meseta y no el mínimo ──
 *
 * El barrido no tiene un pico: tiene una **meseta** donde varios umbrales dan lo mismo.
 * Quedarse con el primer mínimo deja el valor pegado a un borde, y del otro lado del borde el
 * resultado se cae. El centro es el que más margen deja para audio que no se midió.
 */

const ROOT = path.resolve(import.meta.dirname, '../../..');
const VAD = path.join(ROOT, '.vad-tmp/silero_vad.onnx');
const PRINCIPAL = path.join(ROOT, 'public/corpus/speaker-timeline.json');
const HOLDOUT = path.join(ROOT, 'public/corpus-holdout/speaker-timeline.json');
const disponible = existsSync(VAD) && existsSync(PRINCIPAL) && existsSync(HOLDOUT);

const MODELO = 'onnx-community/wespeaker-voxceleb-resnet34-LM';
const RATE = 16000;
const MIN_TRAMO_SEC = 0.6;
const COLLAR_SEC = 0.25;
const UMBRALES = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8];

/**
 * Con qué precisión corre el modelo de embeddings.
 *
 * Se puede cambiar por entorno —`OPENSRT_DIAR_DTYPE=q8 npm test`— porque **la medición hay
 * que poder repetirla con el dtype que use el producto**. El producto lleva `q8` por tamaño,
 * y la regla que dejó E0 es que un cambio de dtype exige volver a medir, nunca «probar si
 * anda»: las combinaciones rotas cargan sin error y devuelven basura con aplomo.
 *
 * El valor por defecto es `fp32` para que la corrida de referencia siga siendo la misma.
 */
const DTYPE = (process.env.OPENSRT_DIAR_DTYPE ?? 'fp32') as 'fp32' | 'q8' | 'fp16';

interface Preparado {
  id: string;
  turns: Turn[];
  refHablantes: number;
  tramos: Segment[];
  embs: Float32Array[];
}

interface Medida {
  der: number;
  confusion: number;
  grupos: number;
}

async function detectar(audio: Float32Array, durationSec: number): Promise<Segment[]> {
  const ort = (await import('onnxruntime-node')).default;
  const sess = await ort.InferenceSession.create(VAD);
  let state = new ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
  const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(RATE)]), []);
  const probs: number[] = [];
  for (let i = 0; i + WINDOW_SAMPLES <= audio.length; i += WINDOW_SAMPLES) {
    const r = await sess.run({
      input: new ort.Tensor('float32', audio.slice(i, i + WINDOW_SAMPLES), [1, WINDOW_SAMPLES]),
      state,
      sr,
    });
    probs.push(r.output.data[0] as number);
    state = r.stateN as typeof state;
  }
  return toSegments(probs, durationSec);
}

/**
 * Mide con un umbral dado. Los embeddings ya están: barrer es sólo reagrupar.
 *
 * Devuelve `null` cuando el DER no se puede calcular porque el agrupamiento devolvió más
 * grupos de los que la búsqueda exhaustiva de correspondencias admite. Es una limitación real
 * del instrumento y se anota como tal, en vez de inventar un número.
 */
function medir(p: Preparado, umbral: number): Medida | null {
  const etiquetas = labelsOf(agglomerative(p.embs, { threshold: umbral }), p.embs.length);
  const hip: Turn[] = p.tramos.map((t, i) => ({
    speaker: etiquetas[i],
    startSec: t.startSec,
    endSec: t.endSec,
  }));
  const grupos = new Set(etiquetas).size;
  try {
    const r = computeDer(p.turns, hip, { collarSec: COLLAR_SEC });
    return { der: r.der, confusion: r.confusionSec / r.totalRefSec, grupos };
  } catch {
    return null;
  }
}

const principal: Preparado[] = [];
const holdout: Preparado[] = [];
let barrido: Array<{ umbral: number; der: number | null; conf: number; grupos: string }> = [];
let elegido = 0;
let fallo: string | null = null;

beforeAll(async () => {
  if (!disponible) return;
  try {
    const { AutoModel, AutoProcessor } = await import('@huggingface/transformers');
    const proc = await AutoProcessor.from_pretrained(MODELO);
    const modelo = await AutoModel.from_pretrained(MODELO, { dtype: DTYPE, device: 'cpu' });

    const cargar = async (linea: string, dir: string, destino: Preparado[]) => {
      const datos = JSON.parse(readFileSync(linea, 'utf8')) as {
        items: Array<{ id: string; durationSec: number; turns: Turn[] }>;
      };
      for (const item of datos.items) {
        const wav = path.join(dir, `${item.id}.wav`);
        if (!existsSync(wav)) continue;
        const { samples } = readWav(readFileSync(wav));
        const tramos = (await detectar(samples, item.durationSec)).filter(
          (s) => s.endSec - s.startSec >= MIN_TRAMO_SEC,
        );
        const embs: Float32Array[] = [];
        for (const t of tramos) {
          const trozo = samples.slice(
            Math.round(t.startSec * RATE),
            Math.min(samples.length, Math.round(t.endSec * RATE)),
          );
          const out = await modelo(await proc(trozo));
          embs.push(Float32Array.from(out.last_hidden_state.data as Float32Array));
        }
        destino.push({
          id: item.id,
          turns: item.turns,
          refHablantes: new Set(item.turns.map((t) => t.speaker)).size,
          tramos,
          embs,
        });
      }
    };

    await cargar(PRINCIPAL, path.join(ROOT, 'public/corpus'), principal);
    await cargar(HOLDOUT, path.join(ROOT, 'public/corpus-holdout'), holdout);

    // El barrido y la elección se hacen una sola vez, acá: si vivieran dentro de un test,
    // el siguiente dependería de que ese haya corrido y de que no haya fallado.
    barrido = UMBRALES.map((umbral) => {
      const ms = principal.map((p) => medir(p, umbral));
      const validas = ms.filter((m): m is Medida => m !== null);
      const completo = validas.length === ms.length && ms.length > 0;
      return {
        umbral,
        der: completo ? validas.reduce((a, m) => a + m.der, 0) / validas.length : null,
        conf: completo ? validas.reduce((a, m) => a + m.confusion, 0) / validas.length : NaN,
        grupos: ms.map((m) => (m ? String(m.grupos) : '—')).join('/'),
      };
    });

    const medibles = barrido.filter((b) => b.der !== null);
    const mejor = Math.min(...medibles.map((b) => b.der as number));
    const meseta = medibles.filter((b) => (b.der as number) <= mejor + 0.005);
    elegido = Number(((meseta[0].umbral + meseta[meseta.length - 1].umbral) / 2).toFixed(3));
  } catch (e) {
    fallo = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
}, 1_800_000);

describe.skipIf(!disponible)('umbral del agrupamiento', () => {
  it('se elige barriendo sobre el conjunto principal', () => {
    expect(fallo, `falló: ${fallo}`).toBeNull();
    expect(principal.length).toBeGreaterThan(0);

    const refs = principal.map((p) => p.refHablantes).join('/');
    console.log('umbral   DER medio   confusión   grupos encontrados');
    for (const b of barrido) {
      const der = b.der === null ? '     —' : `${(b.der * 100).toFixed(1).padStart(6)} %`;
      const conf = Number.isNaN(b.conf) ? '     —' : `${(b.conf * 100).toFixed(2).padStart(6)} %`;
      console.log(
        `${b.umbral.toFixed(2)}     ${der}    ${conf}    ${b.grupos} (reales ${refs})`,
      );
    }
    console.log(`elegido: ${elegido} — centro de la meseta de mejor DER`);
    expect(elegido).toBeGreaterThan(0.3);
    expect(elegido).toBeLessThan(0.8);
  }, 1_800_000);

  it('el umbral elegido se reporta sobre voces que no participaron', () => {
    expect(holdout.length).toBeGreaterThan(0);
    console.log(`HOLDOUT con umbral ${elegido} — voces nuevas:`);
    for (const p of holdout) {
      const m = medir(p, elegido);
      expect(m, `${p.id}: el DER no se pudo calcular`).not.toBeNull();
      console.log(
        `  ${p.id}: DER ${(m!.der * 100).toFixed(1)} % · ` +
          `confusión ${(m!.confusion * 100).toFixed(2)} % · ` +
          `${m!.grupos} grupos (reales ${p.refHablantes}) · ${p.tramos.length} tramos`,
      );
      // Lo que se afirma es la confusión, por la misma razón que en `der.integration.test.ts`:
      // las otras dos partes del DER miden dónde empieza el habla, no quién habla.
      expect(m!.confusion, `${p.id}`).toBeLessThan(0.15);
    }
  }, 1_800_000);

  it('CONTROL: un umbral malo empeora el resultado en el holdout', () => {
    // Sin esto, «el holdout sale bien» no distinguiría un umbral bien elegido de un problema
    // tan fácil que cualquier umbral sirve.
    for (const p of holdout) {
      const bueno = medir(p, elegido)!;
      const todoJunto = medir(p, -1)!;
      // Un umbral demasiado alto da tantos grupos que el DER no se puede calcular. Se usa
      // uno apenas por encima de la meseta, que sí se puede medir.
      const alto = medir(p, 0.7);
      console.log(
        `  ${p.id}: elegido ${(bueno.der * 100).toFixed(1)} % · ` +
          `todo junto ${(todoJunto.der * 100).toFixed(1)} % · ` +
          `umbral alto ${alto ? `${(alto.der * 100).toFixed(1)} %` : 'no medible (demasiados grupos)'}`,
      );
      expect(bueno.der).toBeLessThan(todoJunto.der);
      if (alto) expect(bueno.der).toBeLessThanOrEqual(alto.der);
    }
  }, 1_800_000);
});
