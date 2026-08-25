/**
 * Verifica el corpus construido.
 *
 * Uso:  node scripts/verify-corpus.mjs
 *
 * El corpus es la base de todas las mediciones de E0: si está mal, la tabla entera está
 * mal y nada falla por su cuenta. Así que no alcanza con que el script de construcción
 * haya terminado sin error — hay que mirar los archivos que produjo.
 *
 * Cada comprobación se pregunta **qué no podría ver**:
 *
 *   · Comparar el SHA-256 detecta que el archivo cambió, pero no que su contenido sea
 *     audio con voz: un WAV de silencio puro tiene un hash perfectamente válido.
 *   · Medir la duración detecta un archivo truncado, pero no uno lleno de ruido.
 *   · Por eso hay controles de energía, y por eso `noisy` se compara **contra** `clean`:
 *     un cero aislado no distingue "salió bien" de "la medición está rota".
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readWav, rms } from './lib/wav.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'public', 'corpus');

let problems = 0;
let checks = 0;

function check(ok, label, detail = '') {
  checks++;
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    problems++;
    console.log(`  FALLA ${label}${detail ? `\n          ${detail}` : ''}`);
  }
}

/**
 * Nivel de fondo: la mediana de las ventanas más silenciosas.
 *
 * En un ítem `clean` los huecos entre frases son silencio digital, así que este número
 * es prácticamente cero. En uno `noisy` los huecos llevan murmullo, así que sube. Es la
 * forma de comprobar que el ruido se mezcló de verdad y no que sólo lo dice el nombre.
 */
function backgroundLevel(samples, sampleRate) {
  const win = Math.round(0.1 * sampleRate);
  const levels = [];
  for (let i = 0; i + win < samples.length; i += win) {
    levels.push(rms(samples.subarray(i, i + win)));
  }
  levels.sort((a, b) => a - b);
  const lowest = levels.slice(0, Math.max(1, Math.floor(levels.length * 0.1)));
  return lowest[Math.floor(lowest.length / 2)] ?? 0;
}

async function main() {
  const manifest = JSON.parse(await readFile(path.join(OUT, 'manifest.json'), 'utf8'));
  console.log(`Corpus ${manifest.version}, ${manifest.items.length} ítems\n`);

  const byId = new Map();

  for (const item of manifest.items) {
    console.log(`${item.id}`);
    const file = path.join(OUT, path.basename(item.url));
    const buf = await readFile(file);

    // 1. Integridad
    const sha = createHash('sha256').update(buf).digest('hex');
    check(sha === item.sha256, 'sha256 coincide con el manifiesto',
      sha !== item.sha256 ? `manifiesto ${item.sha256.slice(0, 16)} · archivo ${sha.slice(0, 16)}` : '');

    // 2. Formato: es lo que el modelo espera, no lo que el nombre promete
    const { samples, sampleRate, sourceChannels } = readWav(buf);
    check(sampleRate === 16000, `16 kHz (vino ${sampleRate})`);
    check(sourceChannels === 1, `mono (vino ${sourceChannels} canal/es)`);

    // 3. Duración real contra la declarada. El RTF se divide por este número:
    //    una duración mentida da un RTF mentido, y encima plausible.
    const realSec = samples.length / sampleRate;
    const drift = Math.abs(realSec - item.durationSec);
    check(drift < 0.05, `duración real ${realSec.toFixed(2)} s ≈ declarada ${item.durationSec} s`,
      drift >= 0.05 ? `difieren en ${drift.toFixed(3)} s` : '');

    // 4. Control de contenido: que haya señal. Un WAV de silencio pasa los tres
    //    controles anteriores sin despeinarse.
    const level = rms(samples);
    check(level > 0.005, `tiene señal (RMS ${level.toFixed(4)})`);

    // 5. Que no esté saturado: el recorte suena a chasquido y el modelo lo transcribe
    //    como algo que nadie dijo.
    let clipped = 0;
    for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) >= 0.999) clipped++;
    const clipPct = (clipped / samples.length) * 100;
    check(clipPct < 0.1, `sin saturación (${clipPct.toFixed(3)} % de muestras al tope)`);

    // 6. Referencia utilizable
    check(item.reference.trim().length > 20, `referencia con ${item.reference.split(/\s+/).length} palabras`);

    // 7. Lo que el nombre del ítem promete
    if (item.condition === 'multi') {
      check((item.speakers ?? 0) >= 2, `multi tiene ${item.speakers ?? 0} hablantes`);
    }

    byId.set(item.id, { item, samples, sampleRate, background: backgroundLevel(samples, sampleRate) });
    console.log('');
  }

  // 8. El control comparativo: `noisy` contra su `clean` del mismo idioma.
  //    Medir el fondo de `noisy` por sí solo no dice nada — no hay con qué comparar.
  console.log('Control comparativo ruido / limpio');
  for (const lang of ['es', 'en']) {
    const noisy = byId.get(`${lang}-noisy-3min`);
    const clean = byId.get(`${lang}-clean-5min`);
    if (!noisy || !clean) continue;
    const ratio = noisy.background / (clean.background || 1e-9);
    check(
      ratio > 5,
      `${lang}: el fondo de noisy es ${ratio.toFixed(0)}× el de clean ` +
        `(${noisy.background.toFixed(5)} vs ${clean.background.toFixed(5)})`,
      ratio <= 5 ? 'el murmullo no se mezcló, o se mezcló demasiado bajo' : '',
    );
  }

  console.log(`\n${checks - problems}/${checks} comprobaciones en verde.`);
  if (problems > 0) {
    console.log(`${problems} problema(s). El corpus NO está listo para medir.`);
    process.exit(1);
  }
  console.log('Corpus verificado.');
}

main().catch((e) => {
  console.error(`\nFalló: ${e.message}`);
  process.exit(1);
});
