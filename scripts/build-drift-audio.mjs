/**
 * Arma el audio de 30 minutos con el que se comprueba que los tiempos no se corren.
 *
 * ── Por qué un archivo aparte y no el corpus ──
 *
 * El corpus de E0 declara cuántas frases tiene cada ítem, pero **no en qué segundo empieza
 * cada una**. Para medir desfase hace falta exactamente eso: la posición exacta de cada
 * frase, sabida por construcción y no derivada de ningún detector. Este script las coloca
 * él mismo, así que las conoce.
 *
 * ── Cómo se arma ──
 *
 * `[2 s de silencio][frase][1,2 s][frase][1,2 s]…` hasta pasar los 30 minutos.
 *
 * El hueco es de 1,2 s, tres veces el del corpus, y es a propósito: acá no se está midiendo
 * si el detector separa frases pegadas —eso ya lo prueba `vad.integration.test.ts`— sino si
 * el tiempo que reporta se corresponde con el real. Con huecos amplios la correspondencia
 * entre lo detectado y lo colocado es uno a uno y sin ambigüedad, que es lo que permite
 * medir el error frase por frase.
 *
 * ── El recorte de los bordes ──
 *
 * Las grabaciones de OpenSLR traen silencio antes y después de la frase. Si se colocaran
 * tal cual, el detector marcaría el habla más tarde que la posición declarada y el error
 * mediría ese silencio, no el desfase. Se recortan los bordes por **amplitud**, un criterio
 * independiente del detector: si se recortaran con el propio Silero, el test estaría
 * comparando el detector consigo mismo.
 *
 * Uso:  node scripts/build-drift-audio.mjs
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readWav, writeWav, resample, silence, concat } from './lib/wav.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, '.corpus-src/extracted/es');
const OUT = path.join(ROOT, '.vad-tmp');
const RATE = 16000;

const LEAD_SEC = 2.0;
const GAP_SEC = 1.2;
const TARGET_SEC = 1800;

/** Umbral de recorte, relativo al pico de la frase. Por debajo de esto no hay voz. */
const TRIM_REL = 0.02;

function trimEdges(samples) {
  let pico = 0;
  for (const x of samples) pico = Math.max(pico, Math.abs(x));
  if (pico === 0) return samples;
  const umbral = pico * TRIM_REL;

  let a = 0;
  while (a < samples.length && Math.abs(samples[a]) < umbral) a++;
  let b = samples.length - 1;
  while (b > a && Math.abs(samples[b]) < umbral) b--;
  return samples.subarray(a, b + 1);
}

async function main() {
  if (!existsSync(SRC)) {
    console.error(`Falta ${SRC}. Corré antes: npm run corpus:build`);
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });

  // Orden alfabético y paso fijo: el mismo archivo sale igual cada vez que se corre.
  const archivos = (await readdir(SRC)).filter((f) => f.endsWith('.wav')).sort();
  if (archivos.length < 100) {
    console.error(`Sólo hay ${archivos.length} clips en ${SRC}`);
    process.exit(1);
  }

  const trozos = [silence(LEAD_SEC, RATE)];
  const clips = [];
  let cursor = LEAD_SEC * RATE;
  let i = 0;

  while (cursor / RATE < TARGET_SEC && i < archivos.length) {
    const file = archivos[i++];
    const wav = readWav(await readFile(path.join(SRC, file)));
    const a16 = wav.sampleRate === RATE ? wav.samples : resample(wav.samples, wav.sampleRate, RATE);
    const voz = trimEdges(a16);
    // Una frase de menos de medio segundo no da margen para medir nada.
    if (voz.length < RATE * 0.5) continue;

    clips.push({
      index: clips.length,
      file,
      startSec: cursor / RATE,
      endSec: (cursor + voz.length) / RATE,
    });
    trozos.push(voz);
    cursor += voz.length;

    const hueco = silence(GAP_SEC, RATE);
    trozos.push(hueco);
    cursor += hueco.length;
  }

  const audio = concat(trozos);
  const durationSec = audio.length / RATE;

  await writeFile(path.join(OUT, 'drift-30min.wav'), writeWav(audio, RATE));
  await writeFile(
    path.join(OUT, 'drift-30min.json'),
    JSON.stringify(
      {
        note:
          'Verdad de referencia por construcción: cada frase se colocó en el segundo que ' +
          'dice startSec. Los bordes se recortaron por amplitud, no con un detector de voz.',
        sampleRate: RATE,
        durationSec,
        leadSec: LEAD_SEC,
        gapSec: GAP_SEC,
        trimRelative: TRIM_REL,
        source: 'OpenSLR SLR61 — Argentinian Spanish (CC BY-SA 4.0)',
        clips,
      },
      null,
      1,
    ),
  );

  console.log(
    `drift-30min.wav — ${(durationSec / 60).toFixed(1)} min, ${clips.length} frases, ` +
      `hueco de ${GAP_SEC} s`,
  );
}

await main();
