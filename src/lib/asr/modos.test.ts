import { describe, expect, it } from 'vitest';
import { modosPara, modoDe, vecesMasLento } from './modos';
import { PROFILES, SLOW_ACCURATE } from './models';
import type { DeviceCapabilities } from './capabilities';

/**
 * Los tres modos de transcripción.
 *
 * Lo que se cuida acá es que la pantalla **no ofrezca lo que este equipo no puede**: E0
 * midió que el modelo grande sin WebGPU da RTF 4,74 con un ítem cortado por el tope, o sea
 * una hora de audio en casi cinco horas y con el final faltando. Ofrecerlo igual no sería
 * un modo lento: sería una promesa que termina en un timeout.
 */

const GB = 1024 ** 3;
const SIN_GPU: DeviceCapabilities = { webgpu: false, webgpuReason: 'WebGPU no disponible.' };
const CON_GPU: DeviceCapabilities = { webgpu: true, maxBufferBytes: 2 * GB };
// Entre los dos perfiles de GPU a propósito: 0,8 GB no alcanza para el encoder en fp16
// (1,3 GB) pero sí para el liviano (0,4 GB). Con 0,2 GB —el primer valor que puse— no
// entraba ninguno y el test fallaba por la razón equivocada.
const GPU_CHICA: DeviceCapabilities = { webgpu: true, maxBufferBytes: 0.8 * GB };

describe('modosPara', () => {
  it('siempre son tres y siempre en el mismo orden', () => {
    // Una lista que se reordena según la máquina pone la misma tarjeta en distinto lugar
    // en cada visita.
    for (const caps of [SIN_GPU, CON_GPU, GPU_CHICA]) {
      expect(modosPara(caps).map((m) => m.clave)).toEqual(['rapido', 'equilibrado', 'preciso']);
    }
  });

  it('los dos modos de procesador andan sin GPU', () => {
    const [rapido, equilibrado] = modosPara(SIN_GPU);
    expect(rapido.profile?.key).toBe('base-wasm');
    expect(equilibrado.profile?.key).toBe(SLOW_ACCURATE.key);
  });

  it('sin GPU, el modo preciso queda deshabilitado CON motivo', () => {
    // Deshabilitado y explicado, no escondido: sin el motivo el usuario se queda
    // preguntando por qué su máquina ofrece menos que la de al lado.
    const preciso = modosPara(SIN_GPU)[2];
    expect(preciso.profile).toBeNull();
    expect(preciso.motivo).toContain('WebGPU');
  });

  it('con GPU grande, el modo preciso usa el perfil rápido', () => {
    const preciso = modosPara(CON_GPU)[2];
    expect(preciso.profile?.key).toBe('turbo-webgpu');
    expect(preciso.motivo).toBeUndefined();
  });

  it('con GPU chica cae al perfil liviano en vez de prometer el grande', () => {
    // Es el chequeo que E0 pagó con un timeout de 900 s: el encoder en fp16 no entraba en
    // el `maxBufferSize` y la carga moría sin ningún error que dijera «no entra».
    const preciso = modosPara(GPU_CHICA)[2];
    expect(preciso.profile?.key).toBe('turbo-webgpu-q4');
  });

  it('con una GPU que no da para ningún perfil, el modo preciso se cae con motivo', () => {
    const preciso = modosPara({ webgpu: true, maxBufferBytes: 1024 })[2];
    expect(preciso.profile).toBeNull();
    expect(preciso.motivo).toMatch(/memoria/i);
  });

  it('sin límite de buffer declarado no se descarta nada por las dudas', () => {
    // `maxBufferBytes` ausente significa «no se pudo averiguar», no «es cero». Tratarlo
    // como cero apagaría el modo preciso en todo navegador que no lo reporte.
    const preciso = modosPara({ webgpu: true })[2];
    expect(preciso.profile?.key).toBe('turbo-webgpu');
  });
});

describe('modoDe', () => {
  it('reconoce a qué modo pertenece cada perfil', () => {
    expect(modoDe(PROFILES.find((p) => p.key === 'turbo-webgpu')!)).toBe('preciso');
    expect(modoDe(PROFILES.find((p) => p.key === 'turbo-webgpu-q4')!)).toBe('preciso');
    expect(modoDe(SLOW_ACCURATE)).toBe('equilibrado');
    expect(modoDe(PROFILES.find((p) => p.key === 'base-wasm')!)).toBe('rapido');
  });

  it('sin perfil no inventa un modo', () => {
    // Pasa mientras la detección corre. Marcar «rápido» ahí resaltaría una tarjeta que el
    // usuario no eligió.
    expect(modoDe(null)).toBeNull();
  });
});

describe('vecesMasLento', () => {
  it('compara las medianas medidas, no números escritos a mano', () => {
    const [rapido, equilibrado] = modosPara(SIN_GPU);
    // base-wasm 0,445 · small-wasm 1,248 → algo menos de 2,8×.
    expect(vecesMasLento(equilibrado, rapido)).toBeCloseTo(1.248 / 0.445, 2);
  });

  it('sin uno de los dos perfiles no inventa una comparación', () => {
    // Fingir un «1×» sería peor que no decir nada.
    const [rapido, , preciso] = modosPara(SIN_GPU);
    expect(vecesMasLento(preciso, rapido)).toBeNull();
    expect(vecesMasLento(rapido, preciso)).toBeNull();
  });
});
