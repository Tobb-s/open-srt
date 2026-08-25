/**
 * Construye el corpus de E0 y su manifiesto.
 *
 * Uso:  node scripts/build-corpus.mjs
 *
 * Entra: los zips de OpenSLR en `.corpus-src/`.
 * Sale:  WAV 16 kHz mono en `public/corpus/` y `public/corpus/manifest.json`.
 *
 * ── Por qué el corpus está estratificado ────────────────────────────────────────────
 *
 * El plan de E0 pedía ítems de 1, 5, 30 y 120 minutos para la matriz completa. Medido el
 * costo, eso es impracticable: 312 min de audio × 12 combinaciones son entre 19 y 125
 * horas de corrida según el RTF. Así que los ítems llevan **nivel**:
 *
 *   A — matriz completa (6 modelos × 2 backends). Ítems cortos y las tres condiciones.
 *   B — sólo los modelos que pasen el primer corte. El ítem de 30 min.
 *
 * El ítem de 120 min del plan queda fuera: no aporta a la decisión —que es qué modelo va
 * por defecto— y multiplicaría la corrida. Cuando haga falta medir resistencia con audio
 * largo, es una prueba puntual sobre el modelo ganador, no una celda de la matriz.
 *
 * ── Qué es natural y qué está construido ───────────────────────────────────────────
 *
 * El habla es real y su transcripción es la del corpus original. Lo construido, y por eso
 * declarado en el manifiesto:
 *
 *   · Los ítems son concatenaciones de frases sueltas separadas por silencio. Los corpus
 *     de OpenSLR son grabaciones para TTS, no habla continua: no hay coarticulación entre
 *     frases ni la prosodia de un discurso seguido.
 *   · `noisy` es murmullo de fondo mezclado a una SNR exacta, hecho con hablantes del
 *     propio corpus que no aparecen en la señal.
 *   · `multi` alterna hablantes con solapamiento medido en las transiciones.
 *
 * Todo con semilla fija: dos corridas de este script dan bytes idénticos, que es lo que
 * hace que el SHA-256 del manifiesto sirva para algo.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  readWav, writeWav, resample, mixAtSnr, silence, concat,
} from './lib/wav.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, '.corpus-src');
const EXTRACT = path.join(SRC, 'extracted');
const OUT = path.join(ROOT, 'public', 'corpus');

const TARGET_RATE = 16000;
const GAP_SEC = 0.4;      // silencio entre frases
const OVERLAP_SEC = 0.25; // solapamiento en `multi`
const SNR_DB = 10;        // relación señal/ruido de `noisy`
const SEED = 20260823;    // fija: el corpus tiene que ser reproducible byte a byte

/** mulberry32: PRNG con semilla, para que la selección de clips sea reproducible. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Identificador de hablante: **prefijo y número juntos**.
 *
 * Costó dos intentos y conviene dejar por qué. Los ids son `<dialecto><género>_<n>_<línea>`.
 *
 * - Usar sólo el número (`split('_')[1]`) **mezcla dialectos**: `irm_02484`, `mif_02484` y
 *   `mim_02484` son la misma frase leída por tres personas distintas —irlandés varón,
 *   Midlands mujer, Midlands varón— y las tres daban «02484». El número es local a cada
 *   dialecto, no global.
 * - Usar sólo el prefijo también está mal, y fue el primer arreglo: colapsaría los tres
 *   hablantes irlandeses (`irm_02484`, `irm_03397`, `irm_04310`) en uno solo.
 *
 * La combinación da los hablantes reales: 8 en inglés y 13 en español. El español tiene un
 * único prefijo (`arm`), así que ahí la combinación equivale al número —por eso el error
 * pasó inadvertido: sólo se manifestaba en inglés—.
 */
const speakerId = (id) => id.split('_').slice(0, 2).join('_') || 'x';

const SOURCES = {
  es: {
    lang: 'es',
    name: 'OpenSLR SLR61 — Argentinian Spanish',
    url: 'https://www.openslr.org/61/',
    license: 'CC BY-SA 4.0',
    note: 'Español rioplatense. Frases leídas para TTS, no habla continua.',
    zips: ['es_ar_male.zip'],
    index: 'line_index_male_es.tsv',
    parseIndex: (text) =>
      text.split(/\r?\n/).filter(Boolean).map((l) => {
        const [id, ...rest] = l.split('\t');
        return { id: id.trim(), text: rest.join('\t').trim() };
      }),
    speakerOf: speakerId,
  },
  en: {
    lang: 'en',
    name: 'OpenSLR SLR83 — UK/Ireland English dialects',
    url: 'https://www.openslr.org/83/',
    license: 'CC BY-SA 4.0',
    note: 'Acentos irlandés y de Midlands, ambos géneros. Frases leídas para TTS.',
    zips: [
      'irish_english_male.zip',
      'midlands_english_female.zip',
      'midlands_english_male.zip',
    ],
    index: 'line_index_all_en.csv',
    parseIndex: (text) =>
      text.split(/\r?\n/).filter(Boolean).map((l) => {
        // SLR83 trae TRES campos: `<idPrompt>, <idArchivo>, <texto>`. El nombre del wav
        // es el segundo, no el primero. Y el texto puede llevar comas, así que se corta
        // sólo en las dos primeras.
        const a = l.indexOf(',');
        const b = l.indexOf(',', a + 1);
        if (a < 0 || b < 0) return null;
        return {
          id: l.slice(a + 1, b).trim(),
          text: l.slice(b + 1).trim().replace(/^"|"$/g, ''),
        };
      }).filter((x) => x && x.id && x.text),
    speakerOf: speakerId,
  },
};

async function extract(spec) {
  const dir = path.join(EXTRACT, spec.lang);
  if (existsSync(dir) && (await readdir(dir)).length > 0) {
    console.log(`  ya extraído: ${spec.lang}`);
    return dir;
  }
  await mkdir(dir, { recursive: true });
  for (const zip of spec.zips) {
    const zipPath = path.join(SRC, zip);
    if (!existsSync(zipPath)) throw new Error(`falta ${zip} en .corpus-src/`);
    process.stdout.write(`  extrayendo ${zip} … `);
    execFileSync('unzip', ['-q', '-o', '-j', zipPath, '-d', dir], { stdio: 'pipe' });
    console.log('ok');
  }
  return dir;
}

/** Carga los clips que existen en disco y tienen transcripción. */
async function loadClips(spec, dir) {
  const index = spec.parseIndex(await readFile(path.join(SRC, spec.index), 'utf8'));
  const present = new Set((await readdir(dir)).filter((f) => f.endsWith('.wav')));

  const clips = [];
  for (const { id, text } of index) {
    const file = `${id}.wav`;
    if (!present.has(file) || !text) continue;
    clips.push({ id, text, file: path.join(dir, file), speaker: spec.speakerOf(id) });
  }
  // Orden estable antes de barajar: `readdir` no garantiza el mismo orden entre equipos.
  clips.sort((a, b) => (a.id < b.id ? -1 : 1));
  return clips;
}

const cache = new Map();
async function samplesOf(clip) {
  if (cache.has(clip.file)) return cache.get(clip.file);
  const { samples, sampleRate } = readWav(await readFile(clip.file));
  const out = resample(samples, sampleRate, TARGET_RATE);
  if (cache.size < 400) cache.set(clip.file, out); // techo para no comerse la memoria
  return out;
}

/** Toma clips hasta llegar a la duración pedida. */
async function takeUntil(pool, targetSec, gapSec = GAP_SEC) {
  const chunks = [];
  const texts = [];
  const used = [];
  let secs = 0;

  for (const clip of pool) {
    if (secs >= targetSec) break;
    const s = await samplesOf(clip);
    if (s.length < TARGET_RATE * 0.5) continue; // descartar recortes muy cortos
    chunks.push(s, silence(gapSec, TARGET_RATE));
    texts.push(clip.text);
    used.push(clip.id);
    secs += s.length / TARGET_RATE + gapSec;
  }

  return { audio: concat(chunks), reference: texts.join(' '), used, seconds: secs };
}

/** Murmullo de fondo: varios hablantes sumados y desfasados. */
async function buildBabble(pool, seconds, rand) {
  const layers = [];
  for (let i = 0; i < 6; i++) {
    const start = Math.floor(rand() * Math.max(1, pool.length - 40));
    const { audio } = await takeUntil(pool.slice(start, start + 40), seconds, 0.05);
    layers.push(audio);
  }

  const len = Math.round(seconds * TARGET_RATE);
  const out = new Float32Array(len);
  for (const [k, layer] of layers.entries()) {
    if (layer.length === 0) continue;
    const offset = Math.floor((k / layers.length) * layer.length); // desfase por capa
    for (let i = 0; i < len; i++) out[i] += layer[(i + offset) % layer.length];
  }
  for (let i = 0; i < len; i++) out[i] /= layers.length;
  return out;
}

/**
 * Elige hasta `n` hablantes maximizando la diversidad de grupo.
 *
 * El grupo es el prefijo del id —dialecto y género—, así que primero toma uno de cada
 * grupo y sólo después repite. Con `irm`, `mif` y `mim` disponibles, devuelve uno de cada
 * uno en vez de tres del mismo.
 */
function pickDiverse(speakers, n) {
  const porGrupo = new Map();
  for (const s of speakers) {
    const grupo = s.split('_')[0];
    if (!porGrupo.has(grupo)) porGrupo.set(grupo, []);
    porGrupo.get(grupo).push(s);
  }
  const grupos = [...porGrupo.keys()].sort();
  const out = [];
  for (let ronda = 0; out.length < n; ronda++) {
    let agregado = false;
    for (const g of grupos) {
      const lista = porGrupo.get(g);
      if (ronda < lista.length && out.length < n) {
        out.push(lista[ronda]);
        agregado = true;
      }
    }
    if (!agregado) break; // no quedan hablantes
  }
  return out;
}

/** Alterna hablantes con solapamiento en las transiciones. */
async function buildMulti(bySpeaker, speakers, targetSec, rand) {
  const overlap = Math.round(OVERLAP_SEC * TARGET_RATE);
  const cursors = new Map(speakers.map((s) => [s, 0]));
  const pieces = [];
  const texts = [];
  const used = [];
  let secs = 0;
  let turn = 0;

  while (secs < targetSec) {
    const sp = speakers[turn % speakers.length];
    const list = bySpeaker.get(sp);
    const at = cursors.get(sp);
    if (!list || at >= list.length) {
      turn++;
      if (turn > speakers.length * 200) break;
      continue;
    }
    // Uno o dos clips por turno, para que los turnos no sean todos iguales.
    const n = 1 + Math.floor(rand() * 2);
    const take = list.slice(at, at + n);
    cursors.set(sp, at + n);

    for (const clip of take) {
      const s = await samplesOf(clip);
      if (s.length < TARGET_RATE * 0.5) continue;
      pieces.push(s);
      texts.push(clip.text);
      used.push(clip.id);
      secs += s.length / TARGET_RATE;
    }
    turn++;
  }

  // Unir con solapamiento: el final de un turno pisa el arranque del siguiente.
  const total = pieces.reduce((a, p) => a + p.length, 0) - overlap * (pieces.length - 1);
  const out = new Float32Array(Math.max(0, total));
  let pos = 0;
  for (const [i, p] of pieces.entries()) {
    for (let j = 0; j < p.length; j++) {
      const k = pos + j;
      if (k < out.length) out[k] += p[j];
    }
    pos += p.length - (i < pieces.length - 1 ? overlap : 0);
  }
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.99) for (let i = 0; i < out.length; i++) out[i] *= 0.99 / peak;

  return { audio: out, reference: texts.join(' '), used, seconds: out.length / TARGET_RATE };
}

async function emit(items, id, lang, condition, level, built, extra = {}, split = 'principal') {
  const wav = writeWav(built.audio, TARGET_RATE);
  await writeFile(path.join(OUT, `${id}.wav`), wav);
  const sha256 = createHash('sha256').update(wav).digest('hex');

  items.push({
    id,
    url: `/corpus/${id}.wav`,
    lang,
    condition,
    level,
    split,
    durationSec: Number((built.audio.length / TARGET_RATE).toFixed(3)),
    reference: built.reference,
    sha256,
    clips: built.used.length,
    ...extra,
  });
  console.log(
    `  ${id.padEnd(22)} ${(built.audio.length / TARGET_RATE / 60).toFixed(1).padStart(5)} min` +
      `  ${String(built.used.length).padStart(4)} clips  ${sha256.slice(0, 12)}…`,
  );
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const items = [];
  const sources = [];

  for (const spec of Object.values(SOURCES)) {
    console.log(`\n${spec.lang.toUpperCase()} — ${spec.name}`);
    const dir = await extract(spec);
    const clips = await loadClips(spec, dir);
    console.log(`  ${clips.length} clips con transcripción`);
    if (clips.length === 0) throw new Error(`sin clips para ${spec.lang}`);

    const sourceEntry = {
      lang: spec.lang, name: spec.name, url: spec.url,
      license: spec.license, note: spec.note,
      speakers: 0, sharedNoiseSpeakers: false,
    };
    sources.push(sourceEntry);

    const bySpeaker = new Map();
    for (const c of clips) {
      if (!bySpeaker.has(c.speaker)) bySpeaker.set(c.speaker, []);
      bySpeaker.get(c.speaker).push(c);
    }
    const speakers = [...bySpeaker.keys()].sort();
    console.log(`  ${speakers.length} hablantes`);
    sourceEntry.speakers = speakers.length;

    const rand = rng(SEED + spec.lang.charCodeAt(0));

    // Reparto de hablantes.
    //
    // Lo ideal es disjunto: el murmullo de `noisy` sale de hablantes que no aparecen en
    // la señal, para que "con ruido" no mida en parte el mismo audio que "limpio".
    //
    // Pero eso sólo se puede si hay hablantes de sobra. SLR83 trae **3 hablantes**, uno
    // por archivo; partirlos por la mitad dejaba la señal con uno solo y —peor— el ítem
    // `multi` con un único hablante, es decir sin nada que separar. Cuando no alcanzan,
    // se usan todos para las dos cosas y el manifiesto lo declara, que es preferible a
    // emitir en silencio un ítem que no es lo que su nombre dice.
    const SPLIT_MIN = 6;
    const canSplit = speakers.length >= SPLIT_MIN;
    const half = Math.floor(speakers.length / 2);
    const mainSpeakers = canSplit ? speakers.slice(0, half) : speakers;
    const noiseSpeakers = canSplit ? speakers.slice(half) : speakers;
    if (!canSplit) {
      console.log(
        `  aviso: sólo ${speakers.length} hablantes; el murmullo comparte hablantes con la señal`,
      );
      sourceEntry.sharedNoiseSpeakers = true;
    }

    const mainPool = mainSpeakers.flatMap((s) => bySpeaker.get(s));
    const noisePool = noiseSpeakers.flatMap((s) => bySpeaker.get(s));

    let cursor = 0;
    const nextPool = () => mainPool.slice(cursor);
    const advance = (n) => { cursor += n; };

    // ── Nivel A ──────────────────────────────────────────────────────────────
    const a1 = await takeUntil(nextPool(), 60);
    advance(a1.used.length);
    await emit(items, `${spec.lang}-clean-1min`, spec.lang, 'clean', 'A', a1);

    const a5 = await takeUntil(nextPool(), 300);
    advance(a5.used.length);
    await emit(items, `${spec.lang}-clean-5min`, spec.lang, 'clean', 'A', a5);

    const n3 = await takeUntil(nextPool(), 180);
    advance(n3.used.length);
    const babble = await buildBabble(noisePool.length > 40 ? noisePool : mainPool, n3.seconds, rand);
    await emit(
      items, `${spec.lang}-noisy-3min`, spec.lang, 'noisy', 'A',
      { ...n3, audio: mixAtSnr(n3.audio, babble, SNR_DB) },
      { snrDb: SNR_DB, noiseType: 'babble de 6 hablantes ajenos a la señal' },
    );

    // `multi` toma del conjunto COMPLETO de hablantes, no de la mitad de la señal: con 3
    // hablantes en total, partir primero dejaba el ítem con uno solo.
    //
    // Y elige voces lo más DISTINTAS posible: un hablante por dialecto/género antes de
    // repetir grupo. Tomar los tres primeros por orden alfabético daba `irm_02484`,
    // `irm_03397` e `irm_04310` — tres irlandeses varones—, que es justo lo que un ítem
    // multi-hablante no debería tener: si las voces se parecen, separar hablantes es
    // artificialmente fácil y el ítem deja de medir lo que dice medir.
    const multiSpeakers = pickDiverse(speakers, 3);
    if (multiSpeakers.length < 2) {
      console.log('  (sin hablantes suficientes para el ítem multi: se omite)');
    } else {
      const m3 = await buildMulti(bySpeaker, multiSpeakers, 180, rand);
      // Contar los hablantes que de verdad entraron, en vez de anotar los que se
      // pidieron: si un hablante se queda sin clips, el ítem tiene menos de los previstos
      // y el manifiesto estaría mintiendo.
      const actual = new Set(m3.used.map((id) => spec.speakerOf(id))).size;
      if (actual < 2) throw new Error(`el ítem multi de ${spec.lang} quedó con ${actual} hablante(s)`);
      await emit(
        items, `${spec.lang}-multi-3min`, spec.lang, 'multi', 'A', m3,
        { speakers: actual, overlapSec: OVERLAP_SEC },
      );
    }

    // ── Nivel B ──────────────────────────────────────────────────────────────
    const b30 = await takeUntil(nextPool(), 1800);
    advance(b30.used.length);
    if (b30.seconds > 300) {
      await emit(items, `${spec.lang}-clean-30min`, spec.lang, 'clean', 'B', b30);
    } else {
      console.log(`  (sin audio suficiente para el ítem de 30 min: ${b30.seconds.toFixed(0)} s)`);
    }

    // ── Validación ────────────────────────────────────────────────────────────
    //
    // Disjunto del principal **por construcción**: el cursor siguió avanzando, así que
    // estos clips son los que quedaron después de los que usó el nivel A. No se comprueba
    // la disjunción a posteriori —se garantiza—, que es más fuerte y no puede fallar en
    // silencio.
    //
    // Existe para validar el rango de RTF del catálogo contra archivos que NO
    // participaron en definirlo. Evaluar el rango con las mismas mediciones que lo
    // produjeron no es validación, es tautología.
    const VALIDACION = [
      { dur: 60, cond: 'clean' },
      { dur: 120, cond: 'clean' },
      { dur: 180, cond: 'clean' },
      { dur: 90, cond: 'clean' },
      { dur: 150, cond: 'clean' },
    ];
    for (const [k, v] of VALIDACION.entries()) {
      const built = await takeUntil(nextPool(), v.dur);
      advance(built.used.length);
      if (built.seconds < v.dur * 0.6) {
        console.log(`  (sin audio suficiente para validación ${k + 1}: se omite)`);
        continue;
      }
      await emit(
        items, `${spec.lang}-val-${k + 1}`, spec.lang, v.cond, 'V', built, {}, 'validacion',
      );
    }

    cache.clear();
  }

  const manifest = {
    version: '1.0.0',
    createdAt: new Date().toISOString().slice(0, 10),
    seed: SEED,
    targetSampleRate: TARGET_RATE,
    builtBy: 'scripts/build-corpus.mjs',
    levels: {
      A: 'Matriz completa: 6 modelos × 2 backends.',
      B: 'Sólo los modelos que pasen el primer corte.',
      V: 'Validación: NO se usa para elegir ni para calibrar nada.',
    },
    splits: {
      principal: 'Define los parámetros del catálogo (RTF, WER).',
      validacion:
        'Comprueba esos parámetros contra audio que no participó en definirlos. Disjunto ' +
        'por construcción: son los clips que quedaron después de los del conjunto ' +
        'principal, no una selección verificada a posteriori.',
    },
    construction: {
      note:
        'El habla y sus transcripciones son del corpus original. Los ítems son ' +
        'concatenaciones de frases sueltas separadas por silencio: los corpus de OpenSLR ' +
        'son grabaciones para TTS, así que no hay habla continua ni prosodia de discurso.',
      gapSec: GAP_SEC,
      noisy:
        `murmullo mezclado a ${SNR_DB} dB de SNR exacta. Sale de hablantes ajenos a la ` +
        'señal cuando el corpus tiene suficientes; ver `sharedNoiseSpeakers` por idioma.',
      multi: `hablantes alternados con ${OVERLAP_SEC} s de solapamiento en las transiciones`,
      omitted:
        'El ítem de 120 min del plan queda fuera: no aporta a la decisión de qué modelo ' +
        'va por defecto y llevaría la matriz a decenas de horas. La resistencia con audio ' +
        'largo se prueba aparte, sobre el modelo ganador.',
    },
    sources,
    items,
  };

  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  const totalMin = items.reduce((a, i) => a + i.durationSec, 0) / 60;
  const levelA = items.filter((i) => i.level === 'A');
  console.log(`\n${items.length} ítems, ${totalMin.toFixed(1)} min de audio.`);
  console.log(
    `Nivel A: ${levelA.length} ítems, ${(levelA.reduce((a, i) => a + i.durationSec, 0) / 60).toFixed(1)} min ` +
      `→ ${((levelA.reduce((a, i) => a + i.durationSec, 0) / 60) * 12 / 60).toFixed(1)} h de matriz con RTF 1.`,
  );
  console.log(`Manifiesto en public/corpus/manifest.json`);
}

main().catch((e) => {
  console.error(`\nFalló: ${e.message}`);
  process.exit(1);
});
