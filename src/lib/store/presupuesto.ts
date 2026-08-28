/**
 * Cuándo guardar el audio y cuándo no.
 *
 * ── Lo que reemplaza, y por qué ──
 *
 * Hasta el paso 4, `MAX_SESSIONS = 5` borraba la transcripción más vieja al guardar la
 * sexta: la cabecera, los tramos y el audio, enteros y en silencio. En un banco de pruebas
 * eso es un tope; el día que la pantalla se llama «biblioteca» es **pérdida de datos**.
 *
 * Las mediciones del 28/08/2026 en el equipo del usuario dicen que ese tope nunca defendió
 * de nada:
 *
 * - Cuota del origen: **6,08 GB**. De eso, el modelo Whisper en `caches` ocupa 82,4 MB y
 *   **todas las transcripciones juntas, 45 KB**.
 * - Un tramo pesa **175 bytes**. Una reunión de una hora son ~400-800 tramos: 70-140 KB de
 *   texto. Cien reuniones serían ~14 MB, el 0,2 % de la cuota.
 * - El costo real es el **audio**: 30-60 MB por hora en mp3, ~350 MB en WAV.
 *
 * O sea que la restricción está en **bytes** y el tope contaba **sesiones**. El mismo
 * número es a la vez demasiado y demasiado poco según la máquina: cinco mp3 de una hora son
 * 225 MB sobre 6 GB —borra con el 96 % libre—, y cinco WAV de una hora son 1,75 GB, que en
 * un portátil con el disco lleno no entran ni de cerca.
 *
 * Y hay una asimetría que decide el diseño entero: **el audio es una copia** de un archivo
 * que el usuario abrió desde su disco; **el texto no existe en ningún otro lado**. Descartar
 * una copia es degradar. Borrar el texto es perder.
 *
 * ── La regla ──
 *
 * El texto se guarda siempre y sin tope. El audio es una caché con presupuesto: entra si
 * después de escribirlo queda una reserva libre. Cuando no entra, la sesión queda con
 * `audioStored: false` — el estado degradado que ya existía desde E2 y que la interfaz ya
 * sabe decir.
 */

const MB = 1024 * 1024;

/**
 * Cuánto espacio se deja libre siempre.
 *
 * No es sólo cortesía con el resto del navegador: la caché del modelo vive en la misma
 * cuota y pesa entre 145 y 850 MB según el perfil. Llenar la cuota con audio haría que el
 * navegador tire el modelo, y la próxima visita volvería a bajar 850 MB — un desastre
 * silencioso que el usuario viviría como «esto es lentísimo».
 *
 * El 10 % cubre las cuotas grandes; el piso de 150 MB cubre las chicas, donde un 10 % no
 * alcanza ni para el modelo más chico.
 */
export function reservaDe(cuota: number): number {
  return Math.max(150 * MB, cuota * 0.1);
}

export interface Espacio {
  /** Lo que `navigator.storage.estimate()` reporta como cuota del origen. */
  quota?: number;
  usage?: number;
}

/**
 * Si conviene intentar guardar este audio.
 *
 * ── Falla abierto, a propósito ──
 *
 * Sin `quota` —el navegador no implementa `estimate()`, o devuelve algo sin números—
 * devuelve `true`. **Un instrumento ciego no puede negar el audio para siempre.** Si de
 * verdad no entra, la escritura va a fallar y `save()` ya lo atrapa y degrada; lo que no
 * puede pasar es que una API ausente apague el audio en todos los navegadores que no la
 * tienen.
 *
 * Es la misma regla que el resto del proyecto: cuando no se puede medir, se dice y se sigue
 * por el camino que no inventa un resultado.
 */
export function cabeAudio(bytes: number, espacio: Espacio | null | undefined): boolean {
  const quota = espacio?.quota;
  if (!quota || !Number.isFinite(quota)) return true;
  const usado = Number.isFinite(espacio?.usage) ? (espacio!.usage as number) : 0;
  return usado + bytes + reservaDe(quota) <= quota;
}

/** Por qué el audio de una sesión no está. Se guarda para poder decirlo, no para decidir. */
export type MotivoSinAudio =
  /** No entraba en el presupuesto: se decidió antes de intentar escribir. */
  | 'sin-espacio'
  /** Se intentó y el navegador lo rechazó. */
  | 'error'
  /** El usuario lo liberó desde la biblioteca para hacer lugar. */
  | 'liberado';
