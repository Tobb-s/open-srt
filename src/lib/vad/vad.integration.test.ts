import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { toSegments, toBlocks, totalSpeechSec, WINDOW_SAMPLES, MAX_BLOCK_SEC } from './segments';
// Módulo JS compartido con el constructor del corpus: un solo remuestreador para el banco,
// el producto y las pruebas.
import { readWav } from '../../../scripts/lib/wav.mjs';

/**
 * El detector de voz contra el corpus real.
 *
 * Los tests de `segments.test.ts` usan series construidas a mano: prueban la lógica, no el
 * detector. Éste comprueba las dos cosas juntas sobre audio de verdad, y puede hacerlo
 * porque **el corpus se construyó con una estructura conocida**: frases separadas por
 * silencios de 0,4 s, y el manifiesto declara cuántas frases tiene cada ítem. Esa es la
 * verdad contra la que se mide.
 *
 * Necesita el modelo en `.vad-tmp/` y el corpus generado. Si falta alguno, se saltea: es
 * una verificación que vale la pena tener escrita aunque no corra en cada commit.
 */

const ROOT = path.resolve(import.meta.dirname, '../../..');
const MODELO = path.join(ROOT, '.vad-tmp/silero_vad.onnx');
const CORPUS = path.join(ROOT, 'public/corpus/manifest.json');
const disponible = existsSync(MODELO) && existsSync(CORPUS);

interface Item { id: string; durationSec: number; clips: number; condition: string; lang: string }

let probsDe: (id: string) => Promise<{ probs: number[]; item: Item }>;
let items: Item[] = [];

beforeAll(async () => {
  if (!disponible) return;
  const ort = (await import('onnxruntime-node')).default;
  const sess = await ort.InferenceSession.create(MODELO);
  items = JSON.parse(readFileSync(CORPUS, 'utf8')).items;

  probsDe = async (id: string) => {
    const item = items.find((i) => i.id === id)!;
    const { samples, sampleRate } = readWav(readFileSync(path.join(ROOT, `public/corpus/${id}.wav`)));
    let state = new ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
    const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(sampleRate)]), []);
    const probs: number[] = [];
    for (let i = 0; i + WINDOW_SAMPLES <= samples.length; i += WINDOW_SAMPLES) {
      const r = await sess.run({
        input: new ort.Tensor('float32', samples.slice(i, i + WINDOW_SAMPLES), [1, WINDOW_SAMPLES]),
        state,
        sr,
      });
      probs.push(r.output.data[0] as number);
      state = r.stateN as typeof state;
    }
    return { probs, item };
  };
}, 120_000);

describe.skipIf(!disponible)('detector de voz sobre el corpus real', () => {
  it('encuentra aproximadamente tantos segmentos como frases tiene el ítem', async () => {
    // El control fuerte: el corpus son frases sueltas separadas por 0,4 s de silencio, y
    // el manifiesto dice cuántas hay. Un detector que funcione tiene que encontrarlas.
    // El margen es amplio a propósito: una frase con una pausa interna larga puede partirse
    // en dos, y dos frases muy pegadas pueden fusionarse.
    const { probs, item } = await probsDe('es-clean-1min');
    const segs = toSegments(probs, item.durationSec);
    expect(segs.length).toBeGreaterThan(item.clips * 0.6);
    expect(segs.length).toBeLessThan(item.clips * 1.8);
  }, 120_000);

  it('el habla detectada es una fracción sensata del audio', async () => {
    // El corpus tiene 0,4 s de silencio entre frases de ~5 s, así que el habla debería
    // rondar el 80-95 %. Muy por debajo significa que el detector se está comiendo voz;
    // el 100 % significa que no detecta los silencios.
    const { probs, item } = await probsDe('es-clean-5min');
    const frac = totalSpeechSec(toSegments(probs, item.durationSec)) / item.durationSec;
    expect(frac).toBeGreaterThan(0.5);
    expect(frac).toBeLessThan(0.98);
  }, 120_000);

  it('detecta el silencio del principio', async () => {
    // Los ítems arrancan con silencio antes de la primera frase.
    const { probs, item } = await probsDe('es-clean-1min');
    const segs = toSegments(probs, item.durationSec);
    expect(segs[0].startSec).toBeGreaterThan(0.1);
  }, 120_000);

  it('sobre audio con ruido sigue encontrando habla', async () => {
    // El caso que importa: con murmullo de fondo a 10 dB el detector no puede rendirse.
    const { probs, item } = await probsDe('es-noisy-3min');
    const segs = toSegments(probs, item.durationSec);
    expect(segs.length).toBeGreaterThan(5);
    expect(totalSpeechSec(segs) / item.durationSec).toBeGreaterThan(0.4);
  }, 120_000);

  it('los bloques cortan en silencio y caben en la ventana del modelo', async () => {
    const { probs, item } = await probsDe('es-clean-5min');
    const segs = toSegments(probs, item.durationSec);
    const bloques = toBlocks(segs);

    expect(bloques.length).toBeGreaterThan(1);
    for (const b of bloques) {
      // Los bordes coinciden con bordes de segmento: nunca parten una palabra.
      expect(segs.some((s) => s.startSec === b.startSec)).toBe(true);
      expect(segs.some((s) => s.endSec === b.endSec)).toBe(true);
      // Salvo un segmento suelto más largo que el máximo, el bloque entra en la ventana.
      if (b.segments.length > 1) expect(b.endSec - b.startSec).toBeLessThanOrEqual(MAX_BLOCK_SEC);
    }
  }, 120_000);

  it('CONTROL: el ruido NO vocal no se toma por habla', async () => {
    // Sin este control, «detecta habla» no distingue un detector que funciona de uno que
    // dice que sí a todo.
    //
    // El primer intento usó el murmullo del ítem con ruido como ejemplo de «no habla» y
    // falló con 0,92 de probabilidad. **La suposición era la equivocada**: ese murmullo
    // está construido con voces del propio corpus, así que el detector acierta al marcarlo
    // como habla. De ahí sale una limitación real que conviene tener presente: en una
    // grabación con conversaciones de fondo, el detector no distingue la voz principal del
    // murmullo — sólo sabe si hay voz humana.
    //
    // El control válido es ruido sin voz.
    const ort = (await import('onnxruntime-node')).default;
    const sess = await ort.InferenceSession.create(MODELO);
    const n = WINDOW_SAMPLES * 60; // ~2 s
    const ruido = new Float32Array(n);
    // Ruido determinista, para que el test no dependa del azar.
    let semilla = 12345;
    for (let i = 0; i < n; i++) {
      semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
      ruido[i] = ((semilla / 0x7fffffff) * 2 - 1) * 0.3;
    }

    let state = new ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
    const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(16000)]), []);
    const probs: number[] = [];
    for (let i = 0; i + WINDOW_SAMPLES <= n; i += WINDOW_SAMPLES) {
      const r = await sess.run({
        input: new ort.Tensor('float32', ruido.slice(i, i + WINDOW_SAMPLES), [1, WINDOW_SAMPLES]),
        state,
        sr,
      });
      probs.push(r.output.data[0] as number);
      state = r.stateN as typeof state;
    }

    const promedio = probs.reduce((a, b) => a + b, 0) / probs.length;
    expect(promedio, `el detector tomó ruido blanco por habla (${promedio.toFixed(2)})`)
      .toBeLessThan(0.3);
    expect(toSegments(probs, 2)).toHaveLength(0);
  }, 120_000);
});
