import { describe, expect, it } from 'vitest';
import { BURSTS, energyPerSecond, signalMatchesPattern } from './probe';

/**
 * El veredicto de la prueba de video, con series inventadas.
 *
 * Lo que se prueba acá no es el navegador: es la regla que decide si el audio extraído de
 * un contenedor **es el que se grabó**. Sin esa regla, la prueba de E3 diría «decodificó»
 * de un archivo lleno de ruido con la duración correcta, y eso no es extraer audio.
 */

/** Serie de energía por segundo con tono donde dicen las ráfagas. */
function conTono(segundos: number, nivelTono = 0.35, fondo = 0.001): number[] {
  return Array.from({ length: segundos }, (_, i) =>
    BURSTS.some(([a, b]) => a <= i && b >= i + 1) ? nivelTono : fondo,
  );
}

describe('signalMatchesPattern', () => {
  it('acepta la señal que cae donde se la puso', () => {
    expect(signalMatchesPattern(conTono(6))).toBe(true);
  });

  it('CONTROL: rechaza ruido parejo, que tiene energía en todos lados', () => {
    // Es el caso que hace falta descartar: un decodificador que devuelve basura con la
    // duración correcta. Si esto pasara, la prueba de E3 no probaría nada.
    expect(signalMatchesPattern([0.3, 0.3, 0.3, 0.3, 0.3, 0.3])).toBe(false);
  });

  it('CONTROL: rechaza el silencio total', () => {
    // El otro falso aprobado: un archivo que decodifica pero no trae audio.
    expect(signalMatchesPattern([0, 0, 0, 0, 0, 0])).toBe(false);
  });

  it('rechaza la señal corrida un segundo', () => {
    // Un desfase constante en la extracción daría subtítulos corridos. Acá se ve como
    // energía donde debería haber silencio.
    const corrida = [0.001, 0.001, 0.35, 0.001, 0.35, 0.35];
    expect(signalMatchesPattern(corrida)).toBe(false);
  });

  it('tolera la energía residual que deja un códec con pérdida', () => {
    // Opus y AAC no dejan silencio digital entre ráfagas. Exigir cero rechazaría
    // extracciones correctas.
    expect(signalMatchesPattern(conTono(6, 0.35, 0.03))).toBe(true);
  });

  it('rechaza cuando el contraste es pobre', () => {
    // Tono apenas por encima del fondo: no alcanza para afirmar que se extrajo la señal.
    expect(signalMatchesPattern(conTono(6, 0.05, 0.03))).toBe(false);
  });

  it('no afirma nada sin datos', () => {
    expect(signalMatchesPattern([])).toBe(false);
    // Sin segundos de silencio no hay con qué comparar.
    expect(signalMatchesPattern([0.35])).toBe(false);
  });
});

describe('energyPerSecond', () => {
  it('da un valor por segundo y mide la amplitud', () => {
    const rate = 100;
    const d = new Float32Array(rate * 3);
    d.fill(0, 0, rate);
    d.fill(1, rate, rate * 2); // RMS 1
    d.fill(0.5, rate * 2);
    const e = energyPerSecond(d, rate);
    expect(e).toHaveLength(3);
    expect(e[0]).toBeCloseTo(0, 5);
    expect(e[1]).toBeCloseTo(1, 5);
    expect(e[2]).toBeCloseTo(0.5, 5);
  });

  it('cuenta el último segundo incompleto sobre las muestras que tiene', () => {
    // Si dividiera por un segundo entero, el último tramo saldría artificialmente flojo y
    // podría hacer fallar un veredicto correcto.
    const rate = 100;
    const d = new Float32Array(150);
    d.fill(1);
    const e = energyPerSecond(d, rate);
    expect(e).toHaveLength(2);
    expect(e[1]).toBeCloseTo(1, 5);
  });
});
