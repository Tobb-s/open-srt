import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { toSegments, toBlocks, WINDOW_SAMPLES, type Segment } from './segments';
import { transcribeBlocks, type ModelCall } from '../asr/transcriber';
import { wer } from '../bench/wer';
import { normalizeToWords } from '../bench/normalize';
import { readWav, resample } from '../../../scripts/lib/wav.mjs';

/**
 * El test de alucinación: ¿qué escribe el modelo donde no hay nadie hablando?
 *
 * ── Qué se construye ──
 *
 * `[30 s de sala vacía][una frase conocida][30 s de sala vacía]`.
 *
 * «Sala vacía» no es silencio digital sino ruido de fondo muy bajo, que es lo que tiene
 * cualquier grabación real. El silencio de ceros exactos casi no existe fuera de un test.
 *
 * ── Las dos mitades ──
 *
 * El test comprueba **dos** cosas, no una:
 *
 * 1. que no aparece texto que no esté en la frase, y
 * 2. que **sí** aparece la frase conocida.
 *
 * Sin la segunda, un resultado vacío no distingue «el detector hizo su trabajo» de «la
 * transcripción está rota». Es la regla que ya había hecho falta en OpenPDF.
 *
 * ── Por qué se miden inserciones y no «palabras que sobran» ──
 *
 * El primer intento buscaba fragmentos con marca de tiempo caídos en la zona sin voz.
 * **No sirve**: medido acá, el modelo devuelve el archivo entero como un solo fragmento
 * `0 → 62,5 s`, así que sus tiempos no localizan nada.
 *
 * El segundo intento contaba las palabras del resultado que no estuvieran en la frase, y
 * **tampoco sirve**: eso mezcla dos cosas distintas. Con `whisper-base`, que tiene 29,6 %
 * de WER, el modelo escribió `favoritos` donde la frase decía `favorito` y `písama` donde
 * decía `pijama`. Eso es error de reconocimiento, no invención: el modelo oyó mal una
 * palabra que **sí se dijo**.
 *
 * La distinción la da el alineamiento del WER, que ya está medido y probado en
 * `src/lib/bench/wer.ts`: `favoritos` por `favorito` es una **sustitución**; `[Música]`
 * donde no habló nadie es una **inserción**. Lo que este test mide son las inserciones.
 *
 * ── Qué código se ejercita ──
 *
 * El camino con detector usa `transcribeBlocks`, **la función del producto**, no una copia
 * del bucle escrita para el test. Si fuera una copia, un error en el recorte de los bloques
 * o en el reparto del texto pasaría el test y llegaría igual al usuario.
 *
 * El modelo se le pasa como parámetro porque en Node transformers.js sólo acepta `cpu` o
 * `dml`, mientras que el producto usa `wasm` o `webgpu`. Lo que cambia es el backend de
 * ONNX; el bucle, el recorte de los bloques y el reparto del texto son exactamente los
 * mismos.
 *
 * ── El control ──
 *
 * El mismo audio se transcribe también **sin** el detector. Si por ese camino también
 * saliera limpio, este test no estaría midiendo el aporte del detector: estaría midiendo
 * que el audio es fácil. La comprobación es la misma función en los dos caminos —
 * `inventadas()` — y tiene que dar cero con detector y distinto de cero sin él.
 */

const ROOT = path.resolve(import.meta.dirname, '../../..');
const VAD = path.join(ROOT, '.vad-tmp/silero_vad.onnx');
const CLIPS = path.join(ROOT, '.corpus-src/extracted/es');
const INDEX = path.join(ROOT, '.corpus-src/line_index_male_es.tsv');
const disponible = existsSync(VAD) && existsSync(CLIPS) && existsSync(INDEX);

const RATE = 16000;
const SILENCIO_SEC = 30;
/** Amplitud del ruido de sala. ~-60 dBFS: siseo apenas audible, muy por debajo de la voz. */
const RUIDO = 0.001;
/** Cuántas frases distintas se prueban. Una sola no distingue el caso del hallazgo. */
const CASOS = 3;

/** Ruido determinista: el test no puede depender del azar. */
function ruidoDeSala(segundos: number, semillaInicial: number): Float32Array {
  const n = Math.round(segundos * RATE);
  const out = new Float32Array(n);
  let s = semillaInicial;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] = ((s / 0x7fffffff) * 2 - 1) * RUIDO;
  }
  return out;
}

/**
 * Recorta el silencio de los bordes por amplitud.
 *
 * Por amplitud y no con el detector: recortar con Silero para después evaluar a Silero
 * sería compararlo consigo mismo.
 */
function recortar(x: Float32Array, rel = 0.02): Float32Array {
  let pico = 0;
  for (const v of x) pico = Math.max(pico, Math.abs(v));
  const u = pico * rel;
  let a = 0;
  while (a < x.length && Math.abs(x[a]) < u) a++;
  let b = x.length - 1;
  while (b > a && Math.abs(x[b]) < u) b--;
  return x.subarray(a, b + 1);
}

function normalizar(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Cuántas palabras inventó el modelo.
 *
 * Inserciones del alineamiento contra la frase de referencia. Se usa la misma función en
 * los dos caminos —con detector y sin él— para que la comparación signifique algo.
 */
function inventadas(referencia: string, obtenido: string): number {
  return wer(normalizeToWords(referencia, 'es'), normalizeToWords(obtenido, 'es')).ins;
}

/** Las palabras del resultado que no están en la frase. Sólo para poder mirarlas. */
function sobran(referencia: string, obtenido: string): string[] {
  const ref = new Set(normalizar(referencia));
  return normalizar(obtenido).filter((w) => !ref.has(w));
}

/** Qué fracción de la frase de referencia aparece en el texto obtenido. */
function cubre(referencia: string, obtenido: string): number {
  const ref = normalizar(referencia);
  const got = new Set(normalizar(obtenido));
  return ref.length === 0 ? 0 : ref.filter((w) => got.has(w)).length / ref.length;
}

interface Escena {
  id: string;
  audio: Float32Array;
  durationSec: number;
  frase: string;
  vozDesdeSec: number;
  vozHastaSec: number;
}

/** Los primeros `CASOS` clips con transcripción de al menos seis palabras. */
function elegirClips(): Array<{ id: string; texto: string }> {
  const out: Array<{ id: string; texto: string }> = [];
  for (const linea of readFileSync(INDEX, 'utf8').split('\n')) {
    const [id, texto] = linea.split('\t');
    if (!id || !texto) continue;
    if (!existsSync(path.join(CLIPS, `${id}.wav`))) continue;
    // Una frase corta —«Sí»— no permitiría distinguir acierto de casualidad.
    if (texto.trim().split(/\s+/).length < 6) continue;
    out.push({ id, texto: texto.trim() });
    if (out.length === CASOS) break;
  }
  return out;
}

function construirEscena(
  clip: { id: string; texto: string },
  relleno: 'ruido' | 'ceros',
  semilla: number,
): Escena {
  const wav = readWav(readFileSync(path.join(CLIPS, `${clip.id}.wav`)));
  // Los originales de OpenSLR vienen a 48 kHz. Se remuestrean con el mismo módulo que usa
  // el constructor del corpus y el producto: un solo remuestreador para todo.
  const a16 = wav.sampleRate === RATE ? wav.samples : resample(wav.samples, wav.sampleRate, RATE);
  const voz = recortar(a16);

  const vacio = (s: number) =>
    relleno === 'ceros' ? new Float32Array(Math.round(s * RATE)) : ruidoDeSala(s, semilla);
  const antes = vacio(SILENCIO_SEC);
  const despues = vacio(SILENCIO_SEC * 2);

  const audio = new Float32Array(antes.length + voz.length + antes.length);
  audio.set(antes, 0);
  // La voz se suma al fondo, no lo reemplaza: en una grabación real el ruido de sala no se
  // corta cuando alguien habla.
  for (let i = 0; i < voz.length; i++) audio[antes.length + i] = voz[i] + despues[i];
  audio.set(despues.subarray(0, antes.length), antes.length + voz.length);

  return {
    id: clip.id,
    audio,
    durationSec: audio.length / RATE,
    frase: clip.texto,
    vozDesdeSec: antes.length / RATE,
    vozHastaSec: (antes.length + voz.length) / RATE,
  };
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

let clips: Array<{ id: string; texto: string }> = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let asr: any;

beforeAll(async () => {
  if (!disponible) return;
  clips = elegirClips();
  const { pipeline } = await import('@huggingface/transformers');
  // Los mismos pesos y el mismo dtype que el perfil `base-wasm` del catálogo.
  asr = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base', {
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
    device: 'cpu',
  });
}, 900_000);

/** El camino del producto, tal cual: detector → bloques → `transcribeBlocks`. */
async function conDetector(e: Escena) {
  const segs = await detectar(e.audio, e.durationSec);
  const r = await transcribeBlocks(
    { audio: e.audio, durationSec: e.durationSec, blocks: toBlocks(segs), language: 'es' },
    asr as ModelCall,
  );
  return { segs, texto: r.text, tramos: r.segments, coverage: r.coverage };
}

/** El camino sin detector: el archivo entero de una, como en E1. */
async function sinDetector(e: Escena) {
  const out = await asr(e.audio, {
    language: 'es',
    task: 'transcribe',
    return_timestamps: false,
    chunk_length_s: 30,
    stride_length_s: 5,
  });
  return ((out.text ?? '') as string).trim();
}

describe.skipIf(!disponible)('alucinación en los tramos sin voz', () => {
  it('CON detector: transcribe la frase y no inventa nada', async () => {
    for (const clip of clips) {
      const e = construirEscena(clip, 'ruido', 20260826);
      const { segs, texto, tramos } = await conDetector(e);

      console.log(`[con VAD] ${e.id}`);
      console.log(
        `  tramos: ${segs.map((s) => `${s.startSec.toFixed(1)}-${s.endSec.toFixed(1)}`).join(' ')}` +
          `  (la voz está en ${e.vozDesdeSec.toFixed(1)}-${e.vozHastaSec.toFixed(1)})`,
      );
      console.log(`  texto: ${JSON.stringify(texto)}`);
      console.log(
        `  inserciones: ${inventadas(e.frase, texto)} · fuera de la frase: ` +
          JSON.stringify(sobran(e.frase, texto)),
      );

      // 1. La frase está. Sin esto, un resultado vacío pasaría por «funcionó».
      expect(cubre(e.frase, texto), `no transcribió la frase de ${e.id}`).toBeGreaterThan(0.6);

      // 2. Cero invención. Las sustituciones no se cuentan: que `whisper-base` escriba
      //    `favoritos` por `favorito` es su 29,6 % de WER, no una alucinación.
      expect(inventadas(e.frase, texto), `inventó palabras en ${e.id}`).toBe(0);

      // 3. Y todo lo transcrito cae donde hay voz.
      for (const s of tramos.filter((x) => x.text.trim())) {
        expect(s.startSec).toBeGreaterThan(e.vozDesdeSec - 0.5);
        expect(s.endSec).toBeLessThan(e.vozHastaSec + 0.5);
      }
    }
  }, 900_000);

  it('CONTROL: sin detector, el modelo sí inventa', async () => {
    // Si esto pasara limpio, el test de arriba no estaría probando que el detector sirve:
    // estaría probando que el audio era fácil.
    let totalInventadas = 0;
    for (const clip of clips) {
      const e = construirEscena(clip, 'ruido', 20260826);
      const texto = await sinDetector(e);
      const ins = inventadas(e.frase, texto);
      totalInventadas += ins;
      console.log(`[sin VAD] ${e.id}: ${JSON.stringify(texto)}`);
      console.log(`  inserciones: ${ins} · fuera de la frase: ${JSON.stringify(sobran(e.frase, texto))}`);
    }

    // Dos por caso: el modelo pone algo en cada uno de los dos tramos sin voz.
    expect(
      totalInventadas,
      'sin detector el modelo salió limpio: este audio no distingue los dos caminos',
    ).toBeGreaterThanOrEqual(CASOS * 2);
  }, 900_000);

  it('con ceros exactos en vez de ruido: queda registrado qué hace', async () => {
    // El silencio digital es un caso distinto del ruido de sala y conviene tenerlo medido
    // aparte, aunque casi no aparezca en grabaciones reales.
    const e = construirEscena(clips[0], 'ceros', 0);
    const conVad = await conDetector(e);
    const sinVad = await sinDetector(e);
    console.log(`[ceros · con VAD] ${JSON.stringify(conVad.texto)}`);
    console.log(`[ceros · sin VAD] ${JSON.stringify(sinVad)}`);
    console.log(`[ceros · sin VAD] inserciones: ${inventadas(e.frase, sinVad)}`);

    // Lo único que se afirma acá es lo mismo de siempre por el camino del producto.
    expect(inventadas(e.frase, conVad.texto)).toBe(0);
    expect(cubre(e.frase, conVad.texto)).toBeGreaterThan(0.6);
  }, 900_000);
});
