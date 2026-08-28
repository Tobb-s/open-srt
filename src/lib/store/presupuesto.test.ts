import { describe, expect, it } from 'vitest';
import { cabeAudio, reservaDe } from './presupuesto';

/**
 * El presupuesto del audio.
 *
 * Es lo que reemplazó al tope de cinco sesiones que borraba en silencio. Lo que se cuida
 * acá son las dos formas de equivocarse, que son opuestas y las dos malas: negar audio que
 * entraba —el usuario pierde poder escuchar sin razón— y aceptar audio que no entra —el
 * navegador se queda sin cuota y puede tirar la caché del modelo, que vive ahí mismo—.
 */

const MB = 1024 * 1024;
const GB = 1024 * MB;

describe('reservaDe', () => {
  it('en una cuota grande reserva el 10 %', () => {
    expect(reservaDe(6 * GB)).toBeCloseTo(0.6 * GB, -3);
  });

  it('en una cuota chica el piso manda', () => {
    // El 10 % de 300 MB son 30 MB, y el modelo más chico pesa 145. Sin el piso, el
    // presupuesto dejaría llenar la cuota hasta echar el modelo.
    expect(reservaDe(300 * MB)).toBe(150 * MB);
  });

  it('el piso cubre al modelo más chico', () => {
    // 145 MB es `base-wasm` en `models.ts`. Si la reserva fuera menor, la primera
    // transcripción grande podría dejar al navegador sin lugar para el modelo.
    expect(reservaDe(1 * GB)).toBeGreaterThanOrEqual(145 * MB);
  });
});

describe('cabeAudio', () => {
  it('entra cuando queda lugar de sobra', () => {
    // El caso medido en el equipo del usuario: 6,08 GB de cuota, 78 MB usados.
    expect(cabeAudio(60 * MB, { quota: 6 * GB, usage: 78 * MB })).toBe(true);
  });

  it('no entra cuando comería la reserva', () => {
    // 6 GB de cuota → 600 MB de reserva. Con 5,5 GB usados quedan 500: no alcanza.
    expect(cabeAudio(60 * MB, { quota: 6 * GB, usage: 5.5 * GB })).toBe(false);
  });

  it('un WAV de una hora no entra en una cuota chica', () => {
    // ~350 MB contra 400 MB de cuota. Es el caso que el tope por conteo no veía: para él
    // era «la primera sesión», y para el disco es imposible.
    expect(cabeAudio(350 * MB, { quota: 400 * MB, usage: 10 * MB })).toBe(false);
  });

  it('el borde se decide por el que SÍ entra, no por el que sobra por un byte', () => {
    const quota = 1 * GB;
    const reserva = reservaDe(quota);
    const justo = quota - reserva - 100;
    expect(cabeAudio(justo, { quota, usage: 100 })).toBe(true);
    expect(cabeAudio(justo + 1, { quota, usage: 100 })).toBe(false);
  });

  /* ── Falla abierto: un instrumento ciego no puede negar el audio para siempre ── */

  it('sin cuota reportada, deja pasar', () => {
    // Un navegador sin `estimate()`. Negar el audio ahí lo apagaría para siempre en toda
    // una familia de navegadores, por no poder medir.
    expect(cabeAudio(500 * MB, { quota: undefined, usage: undefined })).toBe(true);
    expect(cabeAudio(500 * MB, null)).toBe(true);
    expect(cabeAudio(500 * MB, undefined)).toBe(true);
  });

  it('con una cuota absurda, deja pasar', () => {
    // `Infinity` o `NaN` no son una medición: son el instrumento diciendo que no sabe.
    expect(cabeAudio(500 * MB, { quota: Infinity, usage: 0 })).toBe(true);
    expect(cabeAudio(500 * MB, { quota: NaN, usage: 0 })).toBe(true);
    expect(cabeAudio(500 * MB, { quota: 0, usage: 0 })).toBe(true);
  });

  it('con cuota pero sin uso reportado, supone cero usado en vez de rendirse', () => {
    // Saber la cuota ya es más que nada: con 6 GB declarados, un audio de 60 MB entra
    // aunque no sepamos cuánto hay usado.
    expect(cabeAudio(60 * MB, { quota: 6 * GB })).toBe(true);
    // Y lo que no entra ni con el disco vacío, sigue sin entrar.
    expect(cabeAudio(6 * GB, { quota: 6 * GB })).toBe(false);
  });

  it('un audio de cero bytes no puede quedar afuera', () => {
    expect(cabeAudio(0, { quota: 6 * GB, usage: 5.99 * GB })).toBe(false);
    // Con lugar, obviamente sí.
    expect(cabeAudio(0, { quota: 6 * GB, usage: 0 })).toBe(true);
  });
});
