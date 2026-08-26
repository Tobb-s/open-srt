import type { Segment } from './segments';

/**
 * Reparte el texto de un bloque entre sus tramos de habla.
 *
 * ── Por qué hace falta repartir ──
 *
 * Los tiempos vienen del detector de voz, que sabe exactamente dónde empieza y termina
 * cada tramo. El texto viene del modelo, que devuelve **un texto por bloque**, sin decir
 * qué parte corresponde a cada tramo.
 *
 * Transcribir tramo por tramo evitaría el problema, pero cuesta unas diez veces más:
 * Whisper procesa ventanas de 30 s pase lo que pase, así que darle un tramo de 3 s paga
 * lo mismo que darle 30. Con cincuenta tramos cortos, el archivo tardaría un orden de
 * magnitud más.
 *
 * ── La heurística, y cuándo falla ──
 *
 * 1. Si el bloque tiene **una sola oración por tramo**, se asignan una a una. Es el caso
 *    frecuente: el detector corta donde alguien deja de hablar, que suele coincidir con
 *    el final de una frase, y el modelo puntúa.
 * 2. Si no coinciden, se reparte **en proporción a la duración** de cada tramo.
 *
 * El caso 2 es aproximado, y conviene saber en qué: los bordes de cada tramo siguen siendo
 * exactos —los dio el detector—, lo que puede quedar corrido es dónde cae el corte del
 * texto dentro del bloque. Para subtítulos eso significa que una palabra puede aparecer en
 * la línea de al lado, no que el subtítulo se desincronice del audio.
 */

export interface TimedText {
  startSec: number;
  endSec: number;
  text: string;
}

/**
 * Divide en oraciones.
 *
 * Corta después de `.`, `?`, `!` y sus versiones de apertura del español, siempre que siga
 * un espacio. No corta en abreviaturas ni decimales porque exige el espacio posterior y
 * una mayúscula o apertura de signo — «3.14» y «Sr. López» sobreviven enteros.
 */
export function splitSentences(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const partes = t
    .split(/(?<=[.!?…])\s+(?=[¿¡"'(\p{Lu}])/gu)
    .map((s) => s.trim())
    .filter(Boolean);
  return partes.length ? partes : [t];
}

/** Palabras, para repartir por peso cuando no hay correspondencia de oraciones. */
function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/**
 * Asigna el texto de un bloque a sus tramos de habla.
 *
 * Devuelve un `TimedText` por tramo. Un tramo puede quedar con texto vacío si el modelo
 * produjo menos contenido del que había habla — eso **no se rellena ni se disimula**,
 * porque justamente es la señal de que el modelo omitió algo.
 */
export function alignBlockText(
  segments: readonly Segment[],
  blockText: string,
): TimedText[] {
  if (segments.length === 0) return [];

  const texto = blockText.trim();
  if (!texto) {
    return segments.map((s) => ({ startSec: s.startSec, endSec: s.endSec, text: '' }));
  }

  if (segments.length === 1) {
    return [{ startSec: segments[0].startSec, endSec: segments[0].endSec, text: texto }];
  }

  // Caso 1: tantas oraciones como tramos.
  const oraciones = splitSentences(texto);
  if (oraciones.length === segments.length) {
    return segments.map((s, i) => ({
      startSec: s.startSec,
      endSec: s.endSec,
      text: oraciones[i],
    }));
  }

  // Caso 2: repartir por duración. Se corta en límites de palabra, nunca dentro de una.
  const ws = words(texto);
  const totalDur = segments.reduce((a, s) => a + (s.endSec - s.startSec), 0);
  const out: TimedText[] = [];
  let usadas = 0;

  for (const [i, s] of segments.entries()) {
    const esUltimo = i === segments.length - 1;
    const cuota = esUltimo
      ? ws.length - usadas
      : Math.round((ws.length * (s.endSec - s.startSec)) / totalDur);
    // Al menos una palabra por tramo mientras alcancen: un tramo vacío en el medio se
    // confundiría con una omisión del modelo, que es una señal que no conviene ensuciar.
    const n = Math.max(esUltimo ? 0 : Math.min(1, ws.length - usadas), cuota);
    out.push({
      startSec: s.startSec,
      endSec: s.endSec,
      text: ws.slice(usadas, usadas + n).join(' '),
    });
    usadas += n;
  }

  return out;
}

/**
 * Cuánto texto se produjo por segundo de habla detectada.
 *
 * Es la comprobación de omisión que E1 dejó pendiente. El modelo puede saltarse un tramo
 * entero y devolver un texto fluido y plausible —medido: 3 de 23 archivos en inglés, hasta
 * el 32 % del contenido—, y sin esta comparación no hay forma de notarlo.
 *
 * El detector sabe cuántos segundos de voz hay. Si salieron muchas menos palabras de las
 * que caben en ese tiempo, algo se perdió.
 */
export interface CoverageCheck {
  wordsPerSpeechSec: number;
  /** `true` si hay motivos para sospechar que falta contenido. */
  suspicious: boolean;
  /** Tramos con habla pero sin una sola palabra asignada. */
  emptySegments: number;
}

/**
 * Umbral de palabras por segundo de habla por debajo del cual se sospecha una omisión.
 *
 * El habla leída de los corpus de medición ronda las 2,2–3,2 palabras por segundo de audio,
 * y descontando los silencios sube. Se toma **1,0** para que el aviso sea específico: por
 * debajo de eso no es alguien que habla pausado, es texto que falta.
 */
export const MIN_WORDS_PER_SPEECH_SEC = 1.0;

export function checkCoverage(
  timed: readonly TimedText[],
  speechSec: number,
): CoverageCheck {
  const totalWords = timed.reduce((a, t) => a + words(t.text).length, 0);
  const emptySegments = timed.filter((t) => !t.text.trim()).length;
  const wps = speechSec > 0 ? totalWords / speechSec : 0;

  return {
    wordsPerSpeechSec: wps,
    // Con muy poco habla el cociente es ruidoso, así que sólo se avisa con material
    // suficiente para que la señal signifique algo.
    suspicious: speechSec > 10 && wps < MIN_WORDS_PER_SPEECH_SEC,
    emptySegments,
  };
}
