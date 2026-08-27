import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { toSegments, WINDOW_SAMPLES, type Segment } from '../vad/segments';
import { agglomerative, labelsOf } from './cluster';
import { computeDer, type Turn } from './der';
import { readWav } from '../../../scripts/lib/wav.mjs';

/**
 * Fase A de E4, la medición que decide: **¿cuánto se equivoca la diarización local?**
 *
 * ── La tubería ──
 *
 * `Silero (E2) → un embedding por tramo → agrupamiento aglomerativo → DER`.
 *
 * Las tres primeras piezas ya existen: el detector de voz viene de E2, los embeddings son de
 * `onnx-community/wespeaker-voxceleb-resnet34-LM` (CC-BY-4.0, sin gate) y el agrupamiento
 * está escrito a mano en `cluster.ts`. Esto las junta y mide.
 *
 * ── Contra qué se mide ──
 *
 * `public/corpus/speaker-timeline.json`: quién habla en qué segundo de los ítems
 * multi-hablante. **No es una estimación**: sale del mismo lugar donde el constructor coloca
 * los trozos de audio, y cada ítem se verificó recalculando su SHA-256 contra el manifiesto.
 * Si el hash no coincidiera, la referencia no correspondería a ese audio.
 *
 * ── Por qué se reporta con y sin collar ──
 *
 * Los bordes de un turno son ambiguos incluso en una referencia construida. La convención de
 * NIST descuenta un collar alrededor de cada cambio. Los dos números son distintos y
 * confundirlos es la forma más fácil de parecer mejor de lo que se es, así que van los dos.
 *
 * ── Y por qué lo que se afirma es la CONFUSIÓN, no el DER a secas ──
 *
 * El DER suma tres cosas y sólo una mide separar hablantes. Las otras dos miden **dónde
 * empieza y termina el habla**, que es una discusión entre el detector de voz y la
 * definición de la referencia, no un error de atribución.
 *
 * Se vio con dos referencias distintas, y el resultado es el argumento:
 *
 * | referencia | omitido | falsa alarma | **confusión** |
 * |---|---|---|---|
 * | turno entero (marca 100 % del archivo) | 65,5 s | 0 s | **0,0 s** |
 * | sólo regiones con voz (marca 55 %) | 0,2 s | 18,2 s | **0,0 s** |
 *
 * Las dos primeras columnas se dieron vuelta por completo al cambiar la definición; la
 * tercera no se movió. O sea: **la atribución de hablante es correcta**, y el DER que se
 * reporte depende de dónde se ponga la frontera del habla. Por eso lo que se afirma acá es
 * la confusión, y el DER va acompañado de su desglose.
 */

const ROOT = path.resolve(import.meta.dirname, '../../..');
const VAD = path.join(ROOT, '.vad-tmp/silero_vad.onnx');
const LINEA = path.join(ROOT, 'public/corpus/speaker-timeline.json');
const CORPUS = path.join(ROOT, 'public/corpus');
const disponible = existsSync(VAD) && existsSync(LINEA);

const MODELO = 'onnx-community/wespeaker-voxceleb-resnet34-LM';
const RATE = 16000;
/**
 * Umbral de coseno para unir dos tramos.
 *
 * **Elegido midiendo**, en `umbral.integration.test.ts`: el barrido sobre el conjunto
 * principal da una meseta plana entre 0,35 y 0,50 —mismo DER, cero confusión, la cantidad
 * exacta de hablantes— y 0,475 es su centro, que es el punto que más margen deja.
 *
 * El 0,55 que se usó primero estaba elegido a ojo y ya partía al inglés en 5 grupos.
 */
const UMBRAL = 0.475;
/** Un tramo más corto que esto no da un embedding confiable. */
const MIN_TRAMO_SEC = 0.6;

interface ItemLinea {
  id: string;
  durationSec: number;
  overlapSec: number;
  turns: Turn[];
}

interface Medicion {
  id: string;
  refHablantes: number;
  hipHablantes: number;
  tramos: number;
  sinCollar: ReturnType<typeof computeDer>;
  conCollar: ReturnType<typeof computeDer>;
  /** El DER de un sistema que pone a todos en un solo grupo. El piso a superar. */
  derTrivial: number;
}

const mediciones: Medicion[] = [];
let fallo: string | null = null;

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

beforeAll(async () => {
  if (!disponible) return;
  try {
    const { AutoModel, AutoProcessor } = await import('@huggingface/transformers');
    const proc = await AutoProcessor.from_pretrained(MODELO);
    const modelo = await AutoModel.from_pretrained(MODELO, { dtype: 'fp32', device: 'cpu' });
    const linea = JSON.parse(readFileSync(LINEA, 'utf8')) as { items: ItemLinea[] };

    for (const item of linea.items) {
      const wavPath = path.join(CORPUS, `${item.id}.wav`);
      if (!existsSync(wavPath)) continue;
      const { samples } = readWav(readFileSync(wavPath));

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

      const etiquetas = labelsOf(agglomerative(embs, { threshold: UMBRAL }), embs.length);
      const hipotesis: Turn[] = tramos.map((t, i) => ({
        speaker: etiquetas[i],
        startSec: t.startSec,
        endSec: t.endSec,
      }));

      // El piso: atribuir todo a un único hablante. Cualquier sistema que no lo supere no
      // está aportando nada, por bueno que suene su número.
      const trivial: Turn[] = tramos.map((t) => ({
        speaker: 'unico',
        startSec: t.startSec,
        endSec: t.endSec,
      }));

      mediciones.push({
        id: item.id,
        refHablantes: new Set(item.turns.map((t) => t.speaker)).size,
        hipHablantes: new Set(etiquetas).size,
        tramos: tramos.length,
        sinCollar: computeDer(item.turns, hipotesis),
        conCollar: computeDer(item.turns, hipotesis, { collarSec: 0.25 }),
        derTrivial: computeDer(item.turns, trivial, { collarSec: 0.25 }).der,
      });
    }
  } catch (e) {
    fallo = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
}, 1_800_000);

describe.skipIf(!disponible)('DER de la diarización local', () => {
  it('la tubería corre de punta a punta', () => {
    expect(fallo, `falló: ${fallo}`).toBeNull();
    expect(mediciones.length).toBeGreaterThan(0);

    for (const m of mediciones) {
      console.log(
        `${m.id}: ${m.tramos} tramos · ${m.refHablantes} hablantes reales, ` +
          `${m.hipHablantes} encontrados`,
      );
      console.log(
        `  DER sin collar ${(m.sinCollar.der * 100).toFixed(1)} % ` +
          `(omitido ${m.sinCollar.missedSec.toFixed(1)} s · ` +
          `falsa alarma ${m.sinCollar.falseAlarmSec.toFixed(1)} s · ` +
          `confusión ${m.sinCollar.confusionSec.toFixed(1)} s)`,
      );
      console.log(
        `  DER con collar de 0,25 s: ${(m.conCollar.der * 100).toFixed(1)} % ` +
          `· piso trivial ${(m.derTrivial * 100).toFixed(1)} %`,
      );
    }
  }, 1_800_000);

  it('encuentra aproximadamente la cantidad de hablantes que hay', () => {
    for (const m of mediciones) {
      expect(m.hipHablantes, `${m.id} encontró ${m.hipHablantes}`).toBeGreaterThanOrEqual(2);
      expect(m.hipHablantes).toBeLessThanOrEqual(m.refHablantes + 2);
    }
  }, 1_800_000);

  it('la confusión de hablante es mínima', () => {
    // Es la parte del DER que de verdad mide separar hablantes. Las otras dos miden dónde
    // empieza el habla, que cambia con la definición de la referencia — y de hecho cambió
    // por completo entre dos definiciones sin mover esta.
    for (const m of mediciones) {
      const fraccion = m.sinCollar.confusionSec / m.sinCollar.totalRefSec;
      console.log(`${m.id}: confusión ${(fraccion * 100).toFixed(2)} % del habla`);
      expect(fraccion, `${m.id}`).toBeLessThan(0.05);
    }
  }, 1_800_000);

  it('supera con holgura al sistema trivial de un solo hablante', () => {
    // El control que da sentido al número. Un DER del 35 % suena mal en abstracto, pero si
    // el trivial da 60 %, el sistema **sí** está separando. Y si el trivial diera lo mismo,
    // toda la tubería no estaría aportando nada.
    for (const m of mediciones) {
      expect(m.conCollar.der, `${m.id}`).toBeLessThan(m.derTrivial);
    }
  }, 1_800_000);
});
