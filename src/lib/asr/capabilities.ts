import { PROFILES, SLOW_ACCURATE, rtfMedian, rtfRange, type ModelProfile } from './models';

/**
 * Qué puede hacer este equipo, y qué modelo le corresponde.
 *
 * La lógica de acá sale directamente de lo que E0 midió, incluido el fallo más caro: el
 * encoder en `fp32` **no entraba** en el `maxBufferSize` de 2 GB del adaptador y eso se
 * manifestaba como un **timeout de carga a los 900 segundos**, sin ningún mensaje que
 * dijera «no entra». Por eso acá el límite del adaptador se consulta *antes* de elegir, en
 * vez de intentar y esperar a que falle.
 */

export interface DeviceCapabilities {
  webgpu: boolean;
  /** Buffer más grande que el adaptador acepta. El dato que decide el dtype. */
  maxBufferBytes?: number;
  adapterLabel?: string;
  deviceMemoryGB?: number;
  cores?: number;
  /** Por qué se descartó WebGPU, cuando se descartó. */
  webgpuReason?: string;
}

export interface Selection {
  profile: ModelProfile;
  /** Alternativa que el usuario puede elegir a mano, si existe una que valga la pena. */
  alternative?: ModelProfile;
  /**
   * Qué decirle al usuario sobre la calidad que va a obtener. No es un detalle de
   * cortesía: entre el mejor perfil y el peor hay diez veces más errores, y alguien que
   * transcribe sin WebGPU merece saber que va a tener que corregir mucho.
   */
  notice?: { level: 'info' | 'warn'; text: string };
}

/**
 * Cuánto se espera a que WebGPU conteste antes de darlo por no disponible.
 *
 * `requestAdapter()` normalmente responde en menos de una décima. Pero **puede no responder
 * nunca**: visto en una pestaña en segundo plano, la promesa se quedó colgada, la detección
 * no terminó y la interfaz quedó en blanco —con el archivo ya elegido y sin un solo mensaje
 * que explicara qué pasaba—. Un plazo convierte ese cuelgue en una respuesta: no hay WebGPU,
 * se usa el camino sin GPU, y se dice.
 */
export const GPU_PROBE_TIMEOUT_MS = 8000;

/**
 * Pide el adaptador con un plazo.
 *
 * Separada para poder probarla con un `gpu` de mentira: una promesa que nunca resuelve no
 * se puede provocar de otra forma, y es justo el caso que hay que cubrir.
 */
export async function requestAdapterWithTimeout(
  gpu: GPU,
  timeoutMs: number = GPU_PROBE_TIMEOUT_MS,
): Promise<GPUAdapter | null | 'timeout'> {
  let id: ReturnType<typeof setTimeout> | undefined;
  const vencimiento = new Promise<'timeout'>((res) => {
    id = setTimeout(() => res('timeout'), timeoutMs);
  });
  try {
    return await Promise.race([gpu.requestAdapter(), vencimiento]);
  } finally {
    // Sin esto el temporizador mantiene vivo el proceso en Node y retrasa la salida de los
    // tests; en el navegador es sólo prolijidad.
    clearTimeout(id);
  }
}

export async function detectCapabilities(
  timeoutMs: number = GPU_PROBE_TIMEOUT_MS,
): Promise<DeviceCapabilities> {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const caps: DeviceCapabilities = {
    webgpu: false,
    deviceMemoryGB: nav.deviceMemory,
    cores: navigator.hardwareConcurrency,
  };

  const gpu = (navigator as unknown as { gpu?: GPU }).gpu;
  if (!gpu) {
    caps.webgpuReason = 'El navegador no expone WebGPU.';
    return caps;
  }

  try {
    const adapter = await requestAdapterWithTimeout(gpu, timeoutMs);
    if (adapter === 'timeout') {
      caps.webgpuReason = `WebGPU no contestó en ${Math.round(timeoutMs / 1000)} s.`;
      return caps;
    }
    if (!adapter) {
      caps.webgpuReason = 'No hay adaptador de WebGPU disponible.';
      return caps;
    }
    caps.webgpu = true;
    caps.maxBufferBytes = adapter.limits.maxBufferSize;

    const info = (adapter as GPUAdapter & {
      info?: { vendor?: string; architecture?: string; description?: string };
    }).info;
    if (info) {
      caps.adapterLabel = [info.vendor, info.architecture, info.description]
        .filter(Boolean)
        .join(' ');
    }
  } catch (err) {
    caps.webgpuReason = `WebGPU falló al inicializar: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }

  return caps;
}

/**
 * Elige el perfil para este equipo.
 *
 * Recorre los perfiles en orden de preferencia y se queda con el primero que el equipo
 * pueda sostener de verdad — no con el primero que «probablemente ande».
 */
export function selectProfile(caps: DeviceCapabilities): Selection {
  if (!caps.webgpu) {
    return {
      profile: PROFILES.find((p) => p.backend === 'wasm')!,
      alternative: SLOW_ACCURATE,
      notice: {
        level: 'warn',
        text:
          'Sin aceleración por GPU en este navegador, así que se usa un modelo más chico. ' +
          'La transcripción va a tener bastantes más errores que con GPU y conviene ' +
          'revisarla. ' +
          (caps.webgpuReason ?? ''),
      },
    };
  }

  const limit = caps.maxBufferBytes ?? 0;

  for (const profile of PROFILES) {
    if (profile.backend !== 'webgpu') continue;
    // El chequeo que E0 pagó con 900 s de timeout: si el buffer no entra, ni se intenta.
    if (limit > 0 && profile.peakBufferBytes > limit) continue;
    return {
      profile,
      notice:
        profile.key === 'turbo-webgpu'
          ? undefined
          : {
              level: 'info',
              text:
                'La placa de video de este equipo no admite el formato más rápido, así que ' +
                'se usa uno más liviano. La calidad es la misma; tarda algo más.',
            },
    };
  }

  // Hay WebGPU pero ningún perfil entra en su límite: mejor WASM que un timeout de 15 min.
  return {
    profile: PROFILES.find((p) => p.backend === 'wasm')!,
    alternative: SLOW_ACCURATE,
    notice: {
      level: 'warn',
      text:
        'La placa de video no tiene memoria suficiente para los modelos grandes, así que se ' +
        'usa uno más chico que corre en el procesador. Va a tener más errores.',
    },
  };
}

/**
 * Estimación inicial de cuánto va a tardar, antes de calibrar.
 *
 * Es deliberadamente provisional: el RTF de E0 se midió en **un** equipo, y el de otro
 * puede diferir mucho. `estimate.ts` la reemplaza por una medición hecha en el equipo real
 * apenas hay con qué. Sirve para no mostrar una pantalla vacía mientras tanto.
 */
export function roughEstimateSec(profile: ModelProfile, audioSec: number): number {
  return audioSec * rtfMedian(profile);
}

/**
 * Cuánto va a tardar, como **rango**.
 *
 * El RTF de esta configuración varía un 25 % entre corridas del mismo equipo, así que un
 * número único —«2 minutos y 17 segundos»— finge una precisión que no existe. Un rango
 * dice la verdad y encima es más útil: nadie planifica al segundo.
 */
export function roughEstimateRange(
  profile: ModelProfile,
  audioSec: number,
): { minSec: number; maxSec: number; single: boolean } {
  const r = rtfRange(profile);
  return { minSec: audioSec * r.min, maxSec: audioSec * r.max, single: r.single };
}
