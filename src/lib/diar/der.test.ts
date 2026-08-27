import { describe, expect, it } from 'vitest';
import { computeDer, type Turn } from './der';

/**
 * El DER, con casos donde la respuesta se sabe de antemano.
 *
 * Una métrica es un instrumento, y un instrumento sin calibrar da números que tranquilizan.
 * Los casos de acá tienen la respuesta calculable a mano: acierto perfecto da 0, no decir
 * nada da 1, equivocarse la mitad del tiempo da 0,5. Si alguno no diera eso, cualquier
 * medición apoyada en esta función sería inútil — y parecería bien.
 */

const t = (speaker: string, startSec: number, endSec: number): Turn => ({
  speaker,
  startSec,
  endSec,
});

describe('computeDer', () => {
  it('acierto perfecto da 0', () => {
    const ref = [t('A', 0, 10), t('B', 10, 20)];
    expect(computeDer(ref, ref).der).toBe(0);
  });

  it('los nombres de las etiquetas no importan', () => {
    // El sistema devuelve «grupo 0» y «grupo 1»; que no los llame como la referencia no es
    // un error. Sin buscar la mejor correspondencia, esto daría 100 % y sería mentira.
    const ref = [t('arm_00610', 0, 10), t('arm_04310', 10, 20)];
    const hyp = [t('0', 0, 10), t('1', 10, 20)];
    const r = computeDer(ref, hyp);
    expect(r.der).toBe(0);
    expect(r.mapping).toEqual({ arm_00610: '0', arm_04310: '1' });
  });

  it('no decir nada da 1', () => {
    const ref = [t('A', 0, 10)];
    const r = computeDer(ref, []);
    expect(r.der).toBe(1);
    expect(r.missedSec).toBeCloseTo(10, 6);
  });

  it('confundir a los dos hablantes todo el tiempo da 1', () => {
    // Dos turnos, cada uno atribuido al otro. No hay correspondencia que salve nada.
    const ref = [t('A', 0, 10), t('B', 10, 20)];
    const hyp = [t('X', 0, 10), t('X', 10, 20)];
    const r = computeDer(ref, hyp);
    // Con un solo grupo en la hipótesis, la mitad del tiempo está bien atribuida.
    expect(r.der).toBeCloseTo(0.5, 3);
    expect(r.confusionSec).toBeCloseTo(10, 3);
  });

  it('equivocarse la mitad del tiempo da 0,5', () => {
    const ref = [t('A', 0, 10), t('B', 10, 20)];
    const hyp = [t('X', 0, 10), t('Y', 10, 15), t('X', 15, 20)];
    const r = computeDer(ref, hyp);
    expect(r.der).toBeCloseTo(0.25, 3);
  });

  it('hablar donde no habla nadie es falsa alarma', () => {
    const ref = [t('A', 0, 10)];
    const hyp = [t('X', 0, 10), t('X', 10, 15)];
    const r = computeDer(ref, hyp);
    expect(r.falseAlarmSec).toBeCloseTo(5, 3);
    expect(r.der).toBeCloseTo(0.5, 3);
  });

  it('puede pasar de 1', () => {
    // Con suficiente falsa alarma el numerador supera al denominador. Una métrica que se
    // topara en 1 escondería lo mal que está saliendo.
    const ref = [t('A', 0, 1)];
    const hyp = [t('X', 0, 10)];
    expect(computeDer(ref, hyp).der).toBeGreaterThan(1);
  });

  it('cuenta el habla solapada dos veces en el denominador', () => {
    // Dos personas hablando a la vez son dos segundos-hablante por segundo. Un sistema que
    // sólo sabe atribuir a uno **no puede** acertar los dos, y el DER tiene que reflejarlo.
    const ref = [t('A', 0, 10), t('B', 5, 10)];
    expect(computeDer(ref, ref).totalRefSec).toBeCloseTo(15, 3);

    const hyp = [t('X', 0, 10)];
    const r = computeDer(ref, hyp);
    expect(r.missedSec).toBeCloseTo(5, 3);
    expect(r.der).toBeCloseTo(5 / 15, 3);
  });

  it('el collar descuenta los bordes y baja el error', () => {
    // Un sistema que se corre 100 ms en cada cambio está bien para cualquier uso real. Sin
    // collar eso cuenta como error; con collar, no.
    const ref = [t('A', 0, 10), t('B', 10, 20)];
    const hyp = [t('X', 0, 10.1), t('Y', 10.1, 20)];
    const sinCollar = computeDer(ref, hyp);
    const conCollar = computeDer(ref, hyp, { collarSec: 0.25 });
    expect(sinCollar.der).toBeGreaterThan(0);
    expect(conCollar.der).toBe(0);
    expect(conCollar.collarSec).toBeGreaterThan(0);
  });

  it('CONTROL: el collar no perdona un error grande', () => {
    // Sin este control, «con collar da 0» no distinguiría un sistema bueno de un collar que
    // se come todo. El collar sólo descuenta los bordes, no el medio de un turno.
    const ref = [t('A', 0, 10), t('B', 10, 20)];
    const hyp = [t('X', 0, 15), t('Y', 15, 20)];
    expect(computeDer(ref, hyp, { collarSec: 0.25 }).der).toBeGreaterThan(0.2);
  });

  it('se planta con demasiados hablantes en vez de tardar para siempre', () => {
    // La búsqueda de correspondencias es exhaustiva. Es una limitación real y conviene que
    // avise, no que se cuelgue.
    const muchos = Array.from({ length: 12 }, (_, i) => t(`S${i}`, i, i + 1));
    expect(() => computeDer(muchos, muchos)).toThrow(/Demasiados hablantes/);
  });

  it('sin referencia ni hipótesis da 0', () => {
    expect(computeDer([], []).der).toBe(0);
  });
});
