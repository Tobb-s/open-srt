/**
 * El recorrido de la cola de archivos.
 *
 * ── Por qué es una función y no un `useCallback` ──
 *
 * Es la lógica más delicada del componente y la que **no tenía ni un test**, porque vivía
 * dentro de `Transcribe.tsx` y la suite no llega ahí (`vitest.config.ts` recolecta
 * `src/**`, entorno `node`, y los 88 mutantes están todos en `src/lib`). Acá adentro está
 * el error clásico de React que E5 esquivó a mano y que cualquier refactor puede volver a
 * meter sin que nada falle:
 *
 * > Un `useCallback` que lee el archivo **del estado** se queda con el valor del render en
 * > que se creó, y dentro del bucle transcribiría el primer archivo diez veces.
 *
 * No falla, no tira error: devuelve diez transcripciones del mismo audio con diez nombres
 * distintos. Por eso el archivo se pasa **por argumento**, y por eso ahora hay un test que
 * lo comprueba con una cola de tres.
 *
 * ── Las tres decisiones que el recorrido codifica ──
 *
 * 1. **En serie, no en paralelo.** Hay un solo modelo cargado y un solo procesador: dos
 *    transcripciones a la vez no terminan antes, se estorban. Lo que sí se comparte es la
 *    carga del modelo —91 s con turbo, medido en E0—: pagarla una vez para diez archivos
 *    es la mitad del sentido de tener cola.
 * 2. **Se decodifica de a uno.** Media hora de audio son 115 MB de `Float32Array`;
 *    decodificar cinco de entrada se comería más de medio giga antes de transcribir nada.
 *    El primero ya viene decodificado —hizo falta para mostrar la estimación—; el resto
 *    espera como `File` y se decodifica en su turno.
 * 3. **Un archivo que falla no detiene la fila.** Perder los nueve que faltan porque el
 *    tercero está dañado sería lo peor que puede hacer una cola.
 */

export type EstadoItem = 'pendiente' | 'procesando' | 'listo' | 'error';

/** Un archivo esperando su turno. Guarda el `File`, **no** el audio decodificado. */
export interface ItemCola<F = File> {
  key: string;
  name: string;
  blob: F;
  estado: EstadoItem;
  /** La sesión que quedó guardada, para poder volver a abrirla desde la lista. */
  sessionId?: string;
  error?: string;
}

export interface DepsCola<F, P, R> {
  /** Decodifica un archivo de la cola. No se llama para el primero: ya viene listo. */
  preparar: (blob: F) => Promise<P>;
  /**
   * Transcribe **uno**. Recibe cuál por argumento: es lo que impide la captura vieja.
   * Devuelve `false` si falló de forma controlada (el motor ya avisó del error).
   */
  transcribir: (preparado: P, retomar: R | null) => Promise<boolean>;
  /** Marca el estado de un ítem por índice. */
  marcar: (indice: number, cambio: Partial<ItemCola<F>>) => void;
}

/**
 * Recorre la cola entera.
 *
 * `primero` es el archivo ya decodificado que corresponde al índice 0, y `retomar` la
 * corrida a medias que le corresponde **sólo a él**: los demás archivos de la cola son
 * nuevos y arrancan de cero.
 */
export async function recorrerCola<F, P, R>(
  items: readonly ItemCola<F>[],
  primero: P,
  retomar: R | null,
  deps: DepsCola<F, P, R>,
): Promise<void> {
  // Con un solo archivo no hay cola: transcribir y listo. Marcar estados de una lista de
  // un elemento sería dibujar una fila que la interfaz no muestra.
  if (items.length <= 1) {
    await deps.transcribir(primero, retomar);
    return;
  }

  for (const [i] of items.entries()) {
    deps.marcar(i, { estado: 'procesando' });
    try {
      const preparado = i === 0 ? primero : await deps.preparar(items[i].blob);
      // `retomar` sólo para el primero: la corrida guardada es de ESE archivo. Pasársela
      // al segundo lo haría arrancar desde bloques que son de otro audio, y saldría una
      // transcripción con los tiempos corridos sin que nada fallara.
      const ok = await deps.transcribir(preparado, i === 0 ? retomar : null);
      deps.marcar(i, { estado: ok ? 'listo' : 'error' });
    } catch (e) {
      // Decodificar puede tirar —archivo dañado— y eso NO detiene la fila.
      deps.marcar(i, { estado: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }
}

/** Cuántos terminaron bien, para el encabezado «Cola: 2 de 3 listos». */
export function listos<F>(items: readonly ItemCola<F>[]): number {
  return items.filter((x) => x.estado === 'listo').length;
}
