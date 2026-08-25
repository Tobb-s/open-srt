/**
 * Decisiones de política del banco.
 *
 * Están juntas y aparte del código que las usa porque no son parámetros de afinado: son
 * decisiones metodológicas que cambian qué se puede concluir de la tabla. Tocar
 * cualquiera de éstas invalida la comparación con corridas anteriores, así que se cambia
 * con fecha y se vuelve a correr todo.
 */

/**
 * RTF a partir del cual una combinación se da por fallida y se corta.
 *
 * No es sólo evitar que la corrida se cuelgue. Un modelo que tarda más de cinco veces la
 * duración del audio es inservible para esta herramienta —una hora de grabación serían
 * cinco de espera—, así que su valor exacto no cambiaría ninguna decisión de E0. Se
 * registra como `timeout`, que en la tabla significa "no da", no "no se midió".
 */
export const MAX_RTF = 5;

/**
 * Plazo para cargar un modelo. Generoso a propósito: el turbo son 1,2 GB y en una
 * conexión lenta la primera descarga es larga. Lo que este plazo atrapa no es una
 * descarga lenta sino un worker que dejó de responder.
 */
export const LOAD_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Intervalo de muestreo del pico de memoria. Compromiso: muy corto compite con la
 * inferencia por el hilo, muy largo se pierde el pico.
 */
export const MEMORY_SAMPLE_MS = 250;

/**
 * Umbrales de la decisión de E0, fijados en `docs/ETAPAS.md` **antes** de medir.
 *
 * Están en código para que la decisión final se lea contra ellos y no contra lo que uno
 * recuerde haber decidido. El criterio se fija antes para que el número no elija la regla.
 */
export const DECISION_THRESHOLDS = {
  /** Por debajo de esto, turbo queda como modelo por defecto. */
  turboKeeps: 0.4,
  /** Entre `turboKeeps` y esto, el defecto baja a `small` o `base`. */
  fallbackToSmaller: 0.8,
  /** Por encima de `fallbackToSmaller`, hay que adelantar el camino de servidor. */
} as const;

export function decisionFor(rtf: number): 'turbo' | 'smaller' | 'server' {
  if (rtf < DECISION_THRESHOLDS.turboKeeps) return 'turbo';
  if (rtf <= DECISION_THRESHOLDS.fallbackToSmaller) return 'smaller';
  return 'server';
}
