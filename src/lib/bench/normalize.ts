/**
 * Normalización de texto para el cálculo de WER.
 *
 * La especificación vive en `docs/NORMALIZACION-WER.md` y se fijó ANTES de correr
 * ninguna medición. Este módulo la implementa; si hay discrepancia entre ambos, el
 * documento manda y el código está mal.
 *
 * El orden de las reglas importa y no es intercambiable: eliminar puntuación antes de
 * expandir contracciones destruiría los apóstrofos que la expansión necesita.
 */

export type Lang = 'es' | 'en';

/* ------------------------------------------------------------------ *
 * Regla 3 — contracciones del inglés
 *
 * Lista cerrada y explícita, no una regla general sobre apóstrofos: `it's` puede ser
 * "it is" o "it has", y adivinarlo metería más error del que corrige. Los ambiguos se
 * expanden a la lectura más frecuente, anotada al lado.
 * ------------------------------------------------------------------ */
const CONTRACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bcan't\b/g, 'cannot'],
  [/\bwon't\b/g, 'will not'],
  [/\bshan't\b/g, 'shall not'],
  // Sin \b delante: en `don't` la n va precedida de o, que es carácter de palabra, así
  // que ahí NO hay límite y la regla no matchearía nunca. Debe ir después de can't /
  // won't / shan't, que son irregulares y ya se consumieron arriba.
  [/n't\b/g, ' not'], // doesn't, isn't, haven't, didn't…
  [/\bi'm\b/g, 'i am'],
  [/\bi've\b/g, 'i have'],
  [/\bi'll\b/g, 'i will'],
  [/\bi'd\b/g, 'i would'], // ambiguo: también "i had"
  [/\b(\w+)'re\b/g, '$1 are'],
  [/\b(\w+)'ve\b/g, '$1 have'],
  [/\b(\w+)'ll\b/g, '$1 will'],
  [/\b(\w+)'d\b/g, '$1 would'], // ambiguo: también "…had"
  [/\bit's\b/g, 'it is'], // ambiguo: también "it has"
  [/\bthat's\b/g, 'that is'],
  [/\bthere's\b/g, 'there is'],
  [/\bhere's\b/g, 'here is'],
  [/\bwhat's\b/g, 'what is'],
  [/\bwho's\b/g, 'who is'],
  [/\bhe's\b/g, 'he is'],
  [/\bshe's\b/g, 'she is'],
  [/\blet's\b/g, 'let us'],
];

/* ------------------------------------------------------------------ *
 * Regla 6 — números en palabras a dígitos
 *
 * Se convierte HACIA el dígito porque un número tiene una sola forma en dígitos y
 * muchas en palabras. Las claves van sin acentos porque para cuando corre esta regla
 * los diacríticos ya se quitaron (regla 5).
 * ------------------------------------------------------------------ */
const UNITS: Record<string, number> = {
  // español
  cero: 0, uno: 1, una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
  siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14,
  quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiuno: 21, veintiun: 21, veintiuna: 21, veintidos: 22,
  veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26,
  veintisiete: 27, veintiocho: 28, veintinueve: 29,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70,
  ochenta: 80, noventa: 90,
  // inglés
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const HUNDREDS: Record<string, number> = {
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300,
  trescientas: 300, cuatrocientos: 400, cuatrocientas: 400, quinientos: 500,
  quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700,
  setecientas: 700, ochocientos: 800, ochocientas: 800, novecientos: 900,
  novecientas: 900,
};

const HUNDRED_MULT = new Set(['hundred']);
const THOUSAND_MULT = new Set(['mil', 'thousand']);
const JOINERS = new Set(['y', 'and']);

function isNumberToken(t: string): boolean {
  return (
    t in UNITS ||
    t in HUNDREDS ||
    HUNDRED_MULT.has(t) ||
    THOUSAND_MULT.has(t)
  );
}

/**
 * Convierte secuencias de palabras numéricas en dígitos.
 *
 * Cubre enteros hasta 999.999. Fuera de ese rango, ordinales, fracciones, números
 * romanos y años leídos partidos ("diecinueve ochenta y cuatro") NO se normalizan y
 * quedan como diferencia contable — limitación declarada en la especificación.
 */
export function wordsToDigits(tokens: string[]): string[] {
  const out: string[] = [];
  let i = 0;

  while (i < tokens.length) {
    if (!isNumberToken(tokens[i])) {
      out.push(tokens[i]);
      i++;
      continue;
    }

    // Acumula la corrida numérica más larga que empiece acá.
    let total = 0;
    let current = 0;
    let consumed = 0;
    let sawAny = false;
    let j = i;

    while (j < tokens.length) {
      const t = tokens[j];

      if (JOINERS.has(t)) {
        // "y"/"and" sólo une donde la gramática lo permite. No alcanza con que a los
        // lados haya números: en "tengo cinco y seis manzanas" son dos cantidades
        // distintas, no un once. En español la conjunción une decena + unidad
        // (`treinta y cuatro`); en inglés, centena + resto (`three hundred and forty`).
        const next = tokens[j + 1];
        const nextVal = next !== undefined ? UNITS[next] : undefined;

        // `% 100` para que funcione dentro de un número mayor: en
        // "mil novecientos ochenta y cuatro" el acumulado es 980 y la decena es 80.
        const tens = current % 100;
        const tensPlusUnit =
          tens >= 30 && tens <= 90 && tens % 10 === 0 &&
          nextVal !== undefined && nextVal >= 1 && nextVal <= 9;
        const hundredsPlusRest =
          current >= 100 && current % 100 === 0 &&
          next !== undefined && isNumberToken(next);

        if (sawAny && (tensPlusUnit || hundredsPlusRest)) {
          j++;
          continue;
        }
        break;
      }

      if (t in UNITS) {
        current += UNITS[t];
      } else if (t in HUNDREDS) {
        current += HUNDREDS[t];
      } else if (HUNDRED_MULT.has(t)) {
        current = (current || 1) * 100;
      } else if (THOUSAND_MULT.has(t)) {
        total += (current || 1) * 1000;
        current = 0;
      } else {
        break;
      }

      sawAny = true;
      j++;
      consumed = j - i;
    }

    if (!sawAny) {
      out.push(tokens[i]);
      i++;
      continue;
    }

    out.push(String(total + current));
    i += consumed;
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Regla 5 — diacríticos, preservando la ñ
 * ------------------------------------------------------------------ */

// Carácter de uso privado: no puede aparecer en texto real, así que sirve de refugio
// para la ñ mientras NFD descompone todo lo demás.
const N_TILDE_SLOT = '';

function stripDiacritics(s: string): string {
  // La ñ NO es un diacrítico a efectos del español: `año` y `ano` son palabras
  // distintas. Se aparta antes de NFD y se restaura después. La ü de `pingüino`
  // sí se reduce a u.
  return s
    .replace(/ñ/g, N_TILDE_SLOT)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(new RegExp(N_TILDE_SLOT, 'g'), 'ñ');
}

/* ------------------------------------------------------------------ *
 * Regla 4 — puntuación
 * ------------------------------------------------------------------ */

// Guiones y barras dentro de palabra pasan a espacio: la segmentación de compuestos
// es convención escrita, no acústica (`ex-presidente` → `ex presidente`).
const TO_SPACE = /[-–—/_]+/g;
// Todo lo demás que no sea letra, dígito o espacio se elimina. Incluye ¿ ¡ y comillas
// de cualquier tipo. \p{L} cubre la ñ y las letras acentuadas que aún queden.
const TO_DROP = /[^\p{L}\p{N}\s]/gu;

/**
 * Aplica la normalización completa. El resultado es apto para dividir por espacios
 * y contar palabras.
 */
export function normalize(text: string, lang: Lang): string {
  let s = text;

  // 1 y 2 — espacios y minúsculas (minúsculas primero: las contracciones se buscan así)
  s = s.toLowerCase();

  // 3 — contracciones, sólo inglés y antes de tocar la puntuación
  if (lang === 'en') {
    for (const [re, rep] of CONTRACTIONS) s = s.replace(re, rep);
  }

  // 4 — puntuación
  s = s.replace(TO_SPACE, ' ').replace(TO_DROP, '');

  // 5 — diacríticos, salvo la ñ
  s = stripDiacritics(s);

  // 1 otra vez — colapsar los espacios que los pasos anteriores dejaron
  s = s.replace(/\s+/g, ' ').trim();

  if (s === '') return '';

  // 6 — números
  return wordsToDigits(s.split(' ')).join(' ');
}

/** Normaliza y devuelve las palabras, que es lo que consume el cálculo de WER. */
export function normalizeToWords(text: string, lang: Lang): string[] {
  const s = normalize(text, lang);
  return s === '' ? [] : s.split(' ');
}
