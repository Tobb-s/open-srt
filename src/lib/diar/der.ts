/**
 * DER — la medida estándar de qué tan mal se separó a los hablantes.
 *
 * ── Qué mide, en criollo ──
 *
 * Se recorre el audio y en cada instante se compara **quiénes hablan según la referencia**
 * contra **quiénes hablan según el sistema**. La diferencia se reparte en tres:
 *
 * - **Omitido**: había alguien hablando y el sistema no puso a nadie.
 * - **Falsa alarma**: el sistema puso a alguien donde no hablaba nadie.
 * - **Confusión**: había alguien y el sistema puso a alguien, pero a la persona equivocada.
 *
 * `DER = (omitido + falsa alarma + confusión) / tiempo total de habla de la referencia`
 *
 * Puede pasar de 1: con mucha falsa alarma el numerador supera al denominador.
 *
 * ── La correspondencia de etiquetas ──
 *
 * El sistema no sabe los nombres: devuelve «grupo 0», «grupo 1». Que llame «0» a quien la
 * referencia llama `arm_00610` **no es un error**. Por eso antes de contar hay que elegir la
 * correspondencia entre etiquetas que minimiza el error, y recién ahí medir. Sin ese paso,
 * un sistema perfecto que numeró distinto daría 100 % de error.
 *
 * ── El collar ──
 *
 * Los bordes de un turno son ambiguos: nadie sabe con precisión de milisegundos dónde deja
 * de hablar uno y empieza el otro, y la referencia de este corpus los define por
 * construcción. La convención de NIST es **descontar un collar** alrededor de cada cambio.
 * Se reporta con y sin collar, porque son números distintos y confundirlos es la forma más
 * fácil de parecer mejor de lo que se es.
 */

export interface Turn {
  speaker: string;
  startSec: number;
  endSec: number;
}

export interface DerResult {
  der: number;
  /** Segundos de cada clase de error, para poder discutir de dónde sale el número. */
  missedSec: number;
  falseAlarmSec: number;
  confusionSec: number;
  /** Denominador: suma del tiempo de habla de la referencia, contando solapes dos veces. */
  totalRefSec: number;
  /** Qué etiqueta del sistema quedó asignada a cada hablante de la referencia. */
  mapping: Record<string, string>;
  /** Segundos descartados por el collar. */
  collarSec: number;
}

/** Resolución del recorrido. 10 ms es la convención y da 100 puntos por segundo. */
export const FRAME_SEC = 0.01;

function etiquetas(turns: readonly Turn[]): string[] {
  return [...new Set(turns.map((t) => t.speaker))].sort();
}

/** Quiénes hablan en cada cuadro, según una lista de turnos. */
function porCuadro(turns: readonly Turn[], cuadros: number): Set<string>[] {
  const out: Set<string>[] = Array.from({ length: cuadros }, () => new Set<string>());
  for (const t of turns) {
    const desde = Math.max(0, Math.round(t.startSec / FRAME_SEC));
    const hasta = Math.min(cuadros, Math.round(t.endSec / FRAME_SEC));
    for (let i = desde; i < hasta; i++) out[i].add(t.speaker);
  }
  return out;
}

/**
 * Cuadros que caen dentro del collar de un cambio de hablante.
 *
 * Un cambio es cualquier instante donde el conjunto de hablantes de la **referencia** cambia.
 */
function cuadrosDelCollar(ref: Set<string>[], collarSec: number): boolean[] {
  const fuera = new Array<boolean>(ref.length).fill(false);
  if (collarSec <= 0) return fuera;
  const radio = Math.round(collarSec / FRAME_SEC);

  const mismo = (a: Set<string>, b: Set<string>) =>
    a.size === b.size && [...a].every((x) => b.has(x));

  for (let i = 1; i < ref.length; i++) {
    if (mismo(ref[i - 1], ref[i])) continue;
    for (let j = Math.max(0, i - radio); j < Math.min(ref.length, i + radio); j++) fuera[j] = true;
  }
  return fuera;
}

/** Todas las formas de asignar etiquetas del sistema a hablantes de la referencia. */
function* asignaciones(refs: string[], hyps: string[]): Generator<Map<string, string>> {
  // Se permuta la lista más corta sobre la más larga; una etiqueta puede quedar sin pareja.
  const k = Math.min(refs.length, hyps.length);
  const elegir = function* (i: number, usados: Set<number>, acc: Array<[string, string]>): Generator<Array<[string, string]>> {
    if (i === refs.length || acc.length === k) {
      yield [...acc];
      return;
    }
    // Este hablante de la referencia puede quedar sin pareja…
    yield* elegir(i + 1, usados, acc);
    // …o tomar cualquier etiqueta del sistema todavía libre.
    for (let j = 0; j < hyps.length; j++) {
      if (usados.has(j)) continue;
      usados.add(j);
      acc.push([refs[i], hyps[j]]);
      yield* elegir(i + 1, usados, acc);
      acc.pop();
      usados.delete(j);
    }
  };
  for (const pares of elegir(0, new Set(), [])) yield new Map(pares);
}

/**
 * Calcula el DER de una hipótesis contra una referencia.
 *
 * La búsqueda de la mejor correspondencia es exhaustiva. Con la cantidad de hablantes de una
 * reunión —dos, tres, cinco— eso son unas pocas decenas de combinaciones; con veinte sería
 * inviable y habría que ir a un algoritmo de asignación. Está acotado a propósito y falla
 * ruidosamente si se pasa, en vez de tardar para siempre.
 */
export function computeDer(
  reference: readonly Turn[],
  hypothesis: readonly Turn[],
  opts: { collarSec?: number; maxSpeakers?: number } = {},
): DerResult {
  const collarSec = opts.collarSec ?? 0;
  const maxSpeakers = opts.maxSpeakers ?? 8;

  const refs = etiquetas(reference);
  const hyps = etiquetas(hypothesis);
  if (refs.length > maxSpeakers || hyps.length > maxSpeakers) {
    throw new Error(
      `Demasiados hablantes para probar todas las correspondencias ` +
        `(${refs.length} en la referencia, ${hyps.length} en la hipótesis, tope ${maxSpeakers}).`,
    );
  }

  const finSec = Math.max(
    0,
    ...reference.map((t) => t.endSec),
    ...hypothesis.map((t) => t.endSec),
  );
  const cuadros = Math.ceil(finSec / FRAME_SEC);
  const R = porCuadro(reference, cuadros);
  const H = porCuadro(hypothesis, cuadros);
  const fuera = cuadrosDelCollar(R, collarSec);

  let totalRef = 0;
  let collar = 0;
  for (let i = 0; i < cuadros; i++) {
    if (fuera[i]) {
      collar += R[i].size * FRAME_SEC;
      continue;
    }
    totalRef += R[i].size * FRAME_SEC;
  }

  let mejor: DerResult | null = null;
  for (const mapa of asignaciones(refs, hyps)) {
    let omitido = 0;
    let falsa = 0;
    let confusion = 0;

    for (let i = 0; i < cuadros; i++) {
      if (fuera[i]) continue;
      const nRef = R[i].size;
      const nHyp = H[i].size;
      // Cuántos coinciden bajo esta correspondencia.
      let correctos = 0;
      for (const r of R[i]) {
        const h = mapa.get(r);
        if (h !== undefined && H[i].has(h)) correctos++;
      }
      omitido += Math.max(0, nRef - nHyp) * FRAME_SEC;
      falsa += Math.max(0, nHyp - nRef) * FRAME_SEC;
      confusion += (Math.min(nRef, nHyp) - correctos) * FRAME_SEC;
    }

    const total = omitido + falsa + confusion;
    if (!mejor || total < mejor.missedSec + mejor.falseAlarmSec + mejor.confusionSec) {
      mejor = {
        der: totalRef > 0 ? total / totalRef : total > 0 ? Infinity : 0,
        missedSec: omitido,
        falseAlarmSec: falsa,
        confusionSec: confusion,
        totalRefSec: totalRef,
        mapping: Object.fromEntries(mapa),
        collarSec: collar,
      };
    }
  }

  return (
    mejor ?? {
      der: 0,
      missedSec: 0,
      falseAlarmSec: 0,
      confusionSec: 0,
      totalRefSec: totalRef,
      mapping: {},
      collarSec: collar,
    }
  );
}
