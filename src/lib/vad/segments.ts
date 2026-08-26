/**
 * De probabilidades de habla a segmentos, y de segmentos a bloques transcribibles.
 *
 * ── Por qué esto existe y qué resuelve ──
 *
 * E1 dejó dos problemas abiertos que parecían no tener relación, y el detector de voz
 * resuelve los dos:
 *
 * 1. **Los subtítulos necesitan tiempos, pero pedírselos al modelo cuesta calidad.**
 *    Medido en `benchmarks/resultados-timestamps.md`: activar `return_timestamps` sube el
 *    WER de 3,03 % a 4,52 %, y el daño se concentra en audio con ruido y varios hablantes.
 *    La salida es no pedírselos: **si el audio se corta por habla detectada, los tiempos
 *    los da el detector**, que sabe exactamente dónde empieza y termina cada tramo.
 * 2. **El modelo omite tramos enteros sin avisar** — 3 de 23 archivos en inglés, hasta el
 *    32 % del texto (`benchmarks/resultados-revalidacion.md`). Con el detector se puede
 *    contrastar cuánto habla hay contra cuánto texto salió, y avisar cuando no cuadran.
 *
 * La lógica está separada del modelo a propósito: acá viven las decisiones —y los bugs—,
 * y así se prueban sin cargar 2 MB de red neuronal.
 */

/** Silero v5 trabaja con ventanas de 512 muestras. A 16 kHz son 32 ms. */
export const WINDOW_SAMPLES = 512;
export const SAMPLE_RATE = 16000;
export const WINDOW_MS = (WINDOW_SAMPLES / SAMPLE_RATE) * 1000;

export interface Segment {
  startSec: number;
  endSec: number;
}

export interface SegmentOptions {
  /** Por encima de esto, la ventana es habla. */
  threshold: number;
  /**
   * Un silencio más corto que esto **no** corta el segmento.
   *
   * Sin esta holgura, cada pausa entre palabras partiría el habla en fragmentos y los
   * subtítulos quedarían picados. Las pausas naturales dentro de una frase rondan los
   * 100–200 ms.
   */
  minSilenceMs: number;
  /** Un tramo de habla más corto que esto se descarta: casi siempre es un ruido. */
  minSpeechMs: number;
  /**
   * Margen que se agrega a cada lado del segmento.
   *
   * El detector marca el habla con precisión, pero recortar justo en el borde se come el
   * arranque de la primera consonante y el final de la última. Un poco de aire mejora la
   * transcripción y hace que los subtítulos no aparezcan tarde.
   */
  padMs: number;
}

export const DEFAULT_OPTIONS: SegmentOptions = {
  threshold: 0.5,
  minSilenceMs: 200,
  minSpeechMs: 250,
  padMs: 100,
};

/**
 * Convierte la serie de probabilidades en segmentos de habla.
 *
 * El orden importa: primero se cierran los silencios cortos, después se descartan los
 * tramos de habla demasiado breves. Al revés, un tramo corto rodeado de silencios cortos
 * se eliminaría antes de poder fusionarse con sus vecinos.
 */
export function toSegments(
  probs: readonly number[],
  durationSec: number,
  opts: SegmentOptions = DEFAULT_OPTIONS,
): Segment[] {
  const msPerWindow = WINDOW_MS;
  const bruto: Segment[] = [];

  let inicio: number | null = null;
  for (let i = 0; i < probs.length; i++) {
    const hayHabla = probs[i] > opts.threshold;
    if (hayHabla && inicio === null) inicio = i;
    if (!hayHabla && inicio !== null) {
      bruto.push({ startSec: (inicio * msPerWindow) / 1000, endSec: (i * msPerWindow) / 1000 });
      inicio = null;
    }
  }
  if (inicio !== null) {
    bruto.push({ startSec: (inicio * msPerWindow) / 1000, endSec: durationSec });
  }

  // 1. Fusionar los que están separados por un silencio demasiado corto.
  const fusionados: Segment[] = [];
  for (const s of bruto) {
    const ultimo = fusionados[fusionados.length - 1];
    if (ultimo && (s.startSec - ultimo.endSec) * 1000 < opts.minSilenceMs) {
      ultimo.endSec = s.endSec;
    } else {
      fusionados.push({ ...s });
    }
  }

  // 2. Descartar los tramos demasiado breves para ser habla.
  const filtrados = fusionados.filter(
    (s) => (s.endSec - s.startSec) * 1000 >= opts.minSpeechMs,
  );

  // 3. Agregar aire a los lados, sin pisar los límites del archivo ni solaparse.
  const pad = opts.padMs / 1000;
  return filtrados.map((s, i, arr) => {
    const anterior = arr[i - 1];
    const siguiente = arr[i + 1];
    return {
      startSec: Math.max(anterior ? (anterior.endSec + s.startSec) / 2 : 0, s.startSec - pad),
      endSec: Math.min(
        siguiente ? (s.endSec + siguiente.startSec) / 2 : durationSec,
        s.endSec + pad,
      ),
    };
  });
}

export interface Block {
  /** Segmentos de habla que entran en este bloque. */
  segments: Segment[];
  startSec: number;
  endSec: number;
  /** Segundos de habla efectiva, sin contar los silencios internos. */
  speechSec: number;
}

/**
 * Duración máxima de un bloque para transcribir.
 *
 * Whisper procesa ventanas de 30 s, así que un bloque más largo lo obligaría a fragmentar
 * por su cuenta —y ahí vuelve el problema del pegado que E1 midió—. Se deja margen para
 * no rozar el límite.
 */
export const MAX_BLOCK_SEC = 28;

/**
 * Agrupa segmentos en bloques transcribibles, **cortando siempre en silencio**.
 *
 * Es la diferencia con fragmentar cada 30 s a ciegas: un corte arbitrario parte una
 * palabra al medio y el modelo la transcribe mal en los dos lados. Cortando donde el
 * detector dice que nadie habla, cada bloque es una unidad completa.
 *
 * Un segmento más largo que `MAX_BLOCK_SEC` —alguien que habla dos minutos sin pausa— va
 * solo en su bloque y se acepta que exceda: partirlo sin silencio sería peor.
 */
export function toBlocks(segments: readonly Segment[], maxSec = MAX_BLOCK_SEC): Block[] {
  const bloques: Block[] = [];
  let actual: Segment[] = [];

  const cerrar = () => {
    if (actual.length === 0) return;
    bloques.push({
      segments: actual,
      startSec: actual[0].startSec,
      endSec: actual[actual.length - 1].endSec,
      speechSec: actual.reduce((a, s) => a + (s.endSec - s.startSec), 0),
    });
    actual = [];
  };

  for (const s of segments) {
    const inicio = actual.length ? actual[0].startSec : s.startSec;
    if (actual.length && s.endSec - inicio > maxSec) cerrar();
    actual.push(s);
    // Un segmento que por sí solo excede el máximo cierra inmediatamente: no tiene sentido
    // acumularle nada más.
    if (s.endSec - s.startSec > maxSec) cerrar();
  }
  cerrar();

  return bloques;
}

/** Segundos de habla detectada en total. Denominador de la comprobación de omisión. */
export function totalSpeechSec(segments: readonly Segment[]): number {
  return segments.reduce((a, s) => a + (s.endSec - s.startSec), 0);
}
