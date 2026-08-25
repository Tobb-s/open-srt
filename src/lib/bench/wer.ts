/**
 * Word Error Rate con desglose de sustituciones, borrados e inserciones.
 *
 * El desglose no es adorno. Las alucinaciones de Whisper en silencio aparecen como
 * INSERCIONES, no como sustituciones: un WER agregado de 8 % no distingue un modelo
 * que confunde palabras de uno que inventa frases enteras en los silencios, y el
 * segundo caso es mucho más grave para una herramienta de transcripción. Con `ins` a
 * la vista, el problema que E2 va a atacar con el VAD ya se ve desde E0.
 *
 * Especificación: `docs/NORMALIZACION-WER.md`.
 */

export interface WerResult {
  /** (sub + del + ins) / refWords. Puede superar 1 si el modelo alucina largo. */
  wer: number;
  sub: number;
  del: number;
  ins: number;
  /** Palabras de la referencia — el denominador. */
  refWords: number;
  /** Palabras de la hipótesis. Informativo: si supera mucho a refWords, hay alucinación. */
  hypWords: number;
}

/**
 * Distancia de edición a nivel palabra, con el desglose del alineamiento óptimo.
 *
 * Memoria O(m) — dos filas, no la matriz entera. Un audio de 120 min ronda las 20.000
 * palabras, y la matriz completa serían 400 M celdas; con dos filas son ~640 KB.
 * El tiempo sigue siendo O(n·m), unos segundos en ese caso extremo. Es un banco
 * offline, así que se acepta.
 *
 * Desempates: cuando dos caminos cuestan lo mismo, se prefiere sustitución/coincidencia,
 * luego borrado, luego inserción. La elección no cambia el WER total, sólo cómo se
 * reparte entre las tres categorías. Se fija acá para que el desglose sea reproducible.
 */
export function wer(reference: string[], hypothesis: string[]): WerResult {
  const n = reference.length;
  const m = hypothesis.length;

  // Casos borde, antes de tocar la matriz.
  if (n === 0) {
    // Sin referencia no hay denominador. Todo lo que diga el modelo es inserción.
    return {
      wer: m === 0 ? 0 : Number.POSITIVE_INFINITY,
      sub: 0,
      del: 0,
      ins: m,
      refWords: 0,
      hypWords: m,
    };
  }
  if (m === 0) {
    return { wer: 1, sub: 0, del: n, ins: 0, refWords: n, hypWords: 0 };
  }

  const width = m + 1;
  let prevCost = new Int32Array(width);
  let prevSub = new Int32Array(width);
  let prevDel = new Int32Array(width);
  let prevIns = new Int32Array(width);
  let curCost = new Int32Array(width);
  let curSub = new Int32Array(width);
  let curDel = new Int32Array(width);
  let curIns = new Int32Array(width);

  // Fila 0: la hipótesis entera es inserción.
  for (let j = 0; j <= m; j++) {
    prevCost[j] = j;
    prevIns[j] = j;
  }

  for (let i = 1; i <= n; i++) {
    const refWord = reference[i - 1];

    // Columna 0: la referencia consumida hasta acá es todo borrado.
    curCost[0] = i;
    curSub[0] = 0;
    curDel[0] = i;
    curIns[0] = 0;

    for (let j = 1; j <= m; j++) {
      const match = refWord === hypothesis[j - 1];
      const costDiag = prevCost[j - 1] + (match ? 0 : 1);
      const costDel = prevCost[j] + 1; // consumir referencia sin hipótesis
      const costIns = curCost[j - 1] + 1; // consumir hipótesis sin referencia

      // Orden de preferencia: diagonal, borrado, inserción.
      if (costDiag <= costDel && costDiag <= costIns) {
        curCost[j] = costDiag;
        curSub[j] = prevSub[j - 1] + (match ? 0 : 1);
        curDel[j] = prevDel[j - 1];
        curIns[j] = prevIns[j - 1];
      } else if (costDel <= costIns) {
        curCost[j] = costDel;
        curSub[j] = prevSub[j];
        curDel[j] = prevDel[j] + 1;
        curIns[j] = prevIns[j];
      } else {
        curCost[j] = costIns;
        curSub[j] = curSub[j - 1];
        curDel[j] = curDel[j - 1];
        curIns[j] = curIns[j - 1] + 1;
      }
    }

    // Intercambiar filas sin reasignar memoria.
    [prevCost, curCost] = [curCost, prevCost];
    [prevSub, curSub] = [curSub, prevSub];
    [prevDel, curDel] = [curDel, prevDel];
    [prevIns, curIns] = [curIns, prevIns];
  }

  const sub = prevSub[m];
  const del = prevDel[m];
  const ins = prevIns[m];

  return {
    wer: (sub + del + ins) / n,
    sub,
    del,
    ins,
    refWords: n,
    hypWords: m,
  };
}

/**
 * WER de un conjunto de ítems.
 *
 * Se suman errores y palabras por separado y recién ahí se divide. NO es el promedio de
 * los WER individuales: promediar sobrepondera los clips cortos, donde un solo error
 * puede valer 20 %, frente a los largos. Con corpus de duraciones mezcladas —1, 5, 30 y
 * 120 min— la diferencia entre ambas cuentas es grande.
 */
export function aggregateWer(results: WerResult[]): WerResult {
  let sub = 0;
  let del = 0;
  let ins = 0;
  let refWords = 0;
  let hypWords = 0;

  for (const r of results) {
    sub += r.sub;
    del += r.del;
    ins += r.ins;
    refWords += r.refWords;
    hypWords += r.hypWords;
  }

  return {
    wer: refWords === 0 ? (sub + del + ins === 0 ? 0 : Number.POSITIVE_INFINITY)
                        : (sub + del + ins) / refWords,
    sub,
    del,
    ins,
    refWords,
    hypWords,
  };
}
