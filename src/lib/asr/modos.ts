import { PROFILES, SLOW_ACCURATE, rtfMedian, type ModelProfile } from './models';
import type { DeviceCapabilities } from './capabilities';

/**
 * Los tres modos de transcripción, como una elección del usuario.
 *
 * ── Qué cambia respecto de antes ──
 *
 * Los tres modelos ya existían desde E0 y el usuario **no los veía**: la detección elegía
 * uno y la alternativa vivía dentro de un panel plegado, nombrada por su clave interna
 * (`small-wasm`). Elegir entre rapidez y precisión es una decisión del usuario, no del
 * programa, y esto la pone a la vista.
 *
 * ── Por qué no son tres botones iguales ──
 *
 * En una herramienta que corre en un servidor los tres modos están siempre disponibles.
 * Acá corre en **este** navegador: el modo preciso necesita WebGPU, y sin ella no es que
 * ande lento — E0 lo midió y da **RTF 4,74 con un ítem cortado por el tope**, o sea una
 * hora de audio en casi cinco horas y con el final faltando.
 *
 * Así que un modo que este equipo no puede sostener se muestra **deshabilitado y con el
 * motivo**, no escondido. Esconderlo dejaría al usuario preguntándose por qué su máquina
 * ofrece menos que la de al lado; ofrecerlo igual sería prometer algo que termina en un
 * timeout de quince minutos.
 */

export type ClaveModo = 'rapido' | 'equilibrado' | 'preciso';

export interface Modo {
  clave: ClaveModo;
  /** El perfil concreto que se cargaría. `null` si este equipo no puede con este modo. */
  profile: ModelProfile | null;
  /** Por qué no se puede, cuando no se puede. Va a la vista, no a la consola. */
  motivo?: string;
}

/** El mejor perfil de GPU que entra en el límite de buffer de este adaptador. */
function mejorDeGpu(caps: DeviceCapabilities): ModelProfile | null {
  const limite = caps.maxBufferBytes ?? 0;
  for (const p of PROFILES) {
    if (p.backend !== 'webgpu') continue;
    // El chequeo que E0 pagó con un timeout de 900 s: si el buffer no entra, ni se intenta.
    if (limite > 0 && p.peakBufferBytes > limite) continue;
    return p;
  }
  return null;
}

/**
 * Los tres modos para este equipo, siempre en el mismo orden.
 *
 * El orden es fijo —rápido, equilibrado, preciso— y no depende de cuál esté disponible:
 * una lista que se reordena según la máquina hace que la misma tarjeta esté en distinto
 * lugar en cada visita.
 */
export function modosPara(caps: DeviceCapabilities): Modo[] {
  const base = PROFILES.find((p) => p.key === 'base-wasm')!;
  const gpu = caps.webgpu ? mejorDeGpu(caps) : null;

  return [
    // Los dos primeros corren en el procesador: andan en cualquier navegador.
    { clave: 'rapido', profile: base },
    { clave: 'equilibrado', profile: SLOW_ACCURATE },
    {
      clave: 'preciso',
      profile: gpu,
      motivo: gpu
        ? undefined
        : !caps.webgpu
          ? (caps.webgpuReason ?? 'Este navegador no tiene aceleración por placa de video.')
          : 'La placa de video de este equipo no tiene memoria suficiente para el modelo grande.',
    },
  ];
}

/** El modo que corresponde a un perfil ya elegido, para marcar cuál está activo. */
export function modoDe(profile: ModelProfile | null): ClaveModo | null {
  if (!profile) return null;
  if (profile.backend === 'webgpu') return 'preciso';
  return profile.key === SLOW_ACCURATE.key ? 'equilibrado' : 'rapido';
}

/**
 * Cuánto más lento es un modo que otro, en veces.
 *
 * Se compara la **mediana** de los RTF medidos, no un número escrito a mano. Sale acá y no
 * en la pantalla porque es una cuenta sobre datos, y una cuenta sobre datos se prueba.
 *
 * Devuelve `null` cuando falta alguno de los dos: no hay comparación que hacer, y fingir
 * un «1×» sería peor que no decir nada.
 */
export function vecesMasLento(modo: Modo, referencia: Modo): number | null {
  if (!modo.profile || !referencia.profile) return null;
  const a = rtfMedian(modo.profile);
  const b = rtfMedian(referencia.profile);
  if (b <= 0) return null;
  return a / b;
}
