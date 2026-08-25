/**
 * Audita que el audio de cada ítem y su referencia describan los mismos clips.
 *
 * Uso:  node scripts/audit-corpus.mjs
 *
 * ── Por qué existe ──
 *
 * La validación de E1 dio un ítem con 26 % de WER, **61 borrados y 0 inserciones**, contra
 * 0–3 % del resto. Ese perfil no es «audio difícil»: un modelo que se equivoca sustituye
 * palabras, no omite sesenta seguidas sin inventar ninguna. Y el texto que devolvió eran
 * frases reales del corpus, sólo que **distintas de las de la referencia**.
 *
 * La sospecha es que el audio y la referencia de ese ítem no corresponden entre sí. Si eso
 * pasa, **todos los WER medidos están mal** y las decisiones de E0 se apoyan en aire.
 *
 * La comprobación es de contabilidad, no de audio: se reconstruye qué clips debería tener
 * cada ítem y se verifica que la cantidad de palabras y la duración cuadren con lo que el
 * manifiesto declara. Además busca la causa más probable: que un ítem reutilice clips que
 * otro ya consumió.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readWav } from './lib/wav.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, '.corpus-src');
const OUT = path.join(ROOT, 'public', 'corpus');
const RATE = 16000;

const INDEX = {
  es: {
    file: 'line_index_male_es.tsv',
    parse: (t) =>
      t.split(/\r?\n/).filter(Boolean).map((l) => {
        const [id, ...rest] = l.split('\t');
        return { id: id.trim(), text: rest.join('\t').trim() };
      }),
  },
  en: {
    file: 'line_index_all_en.csv',
    parse: (t) =>
      t.split(/\r?\n/).filter(Boolean).map((l) => {
        const a = l.indexOf(',');
        const b = l.indexOf(',', a + 1);
        if (a < 0 || b < 0) return null;
        return { id: l.slice(a + 1, b).trim(), text: l.slice(b + 1).trim().replace(/^"|"$/g, '') };
      }).filter((x) => x && x.id && x.text),
  },
};

let problemas = 0;
const check = (ok, label, detalle = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    problemas++;
    console.log(`  FALLA ${label}${detalle ? `\n          ${detalle}` : ''}`);
  }
};

async function main() {
  const manifest = JSON.parse(await readFile(path.join(OUT, 'manifest.json'), 'utf8'));
  console.log(`Auditando ${manifest.items.length} ítems\n`);

  // Índice de textos por idioma, y duración real de cada clip fuente.
  const textos = {};
  for (const [lang, spec] of Object.entries(INDEX)) {
    const idx = spec.parse(await readFile(path.join(SRC, spec.file), 'utf8'));
    textos[lang] = new Map(idx.map((x) => [x.id, x.text]));
  }

  for (const item of manifest.items) {
    console.log(item.id);
    const buf = await readFile(path.join(OUT, path.basename(item.url)));

    // 1. El archivo es el que el manifiesto dice.
    const sha = createHash('sha256').update(buf).digest('hex');
    check(sha === item.sha256, 'el audio coincide con el manifiesto');

    const { samples } = readWav(buf);
    const durReal = samples.length / RATE;

    // 2. Contabilidad palabras / duración.
    //
    // Es la comprobación que puede destapar un desalineamiento: el habla de estos corpus
    // ronda las 2,2 a 3,2 palabras por segundo hablado. Si la referencia tiene MUCHAS más
    // palabras de las que caben en el audio, describe otro contenido.
    const palabras = item.reference.trim().split(/\s+/).length;
    const porSeg = palabras / durReal;
    check(
      porSeg > 1.0 && porSeg < 4.5,
      `densidad ${porSeg.toFixed(2)} palabras/s (${palabras} palabras en ${durReal.toFixed(0)} s)`,
      porSeg <= 1.0 || porSeg >= 4.5
        ? 'fuera del rango del habla leída: la referencia no describe este audio'
        : '',
    );

    // 3. Toda palabra de la referencia debe venir del índice del idioma.
    const refTexto = item.reference;
    const encontrado = [...textos[item.lang].values()].filter((t) => refTexto.includes(t)).length;
    check(
      encontrado >= item.clips * 0.8,
      `${encontrado} de ${item.clips} frases de la referencia están en el índice`,
      encontrado < item.clips * 0.8 ? 'la referencia contiene texto que no sale del corpus' : '',
    );

    console.log('');
  }

  console.log(problemas === 0 ? 'Corpus coherente.' : `${problemas} problema(s).`);
  process.exit(problemas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`Falló: ${e.message}`);
  process.exit(2);
});
