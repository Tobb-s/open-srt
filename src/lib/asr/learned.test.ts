import { describe, it, expect, beforeEach, vi } from 'vitest';
import { median, learnedRtf, recordRtf, sampleCount, forget } from './learned';
import { Estimator, describeEstimate } from './estimate';
import { PROFILES } from './models';

// localStorage no existe en Node: se simula uno mínimo con la misma semántica.
beforeEach(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  });
});

describe('median', () => {
  it('impares y pares', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('vacío da undefined, no cero', () => {
    // Un cero se confundiría con "instantáneo" y daría estimaciones de 0 s.
    expect(median([])).toBeUndefined();
  });

  it('ignora un valor anómalo, que es para lo que se eligió', () => {
    // El RTF varía ~25 % entre corridas; una corrida rara no debe mover la estimación.
    expect(median([0.45, 0.47, 0.46, 0.48, 3.9])).toBe(0.47);
  });
});

describe('recordRtf — guardas contra datos que no describen al equipo', () => {
  it('guarda y recupera', () => {
    recordRtf('turbo-webgpu', 0.5, 300);
    expect(learnedRtf('turbo-webgpu')).toBe(0.5);
  });

  it('descarta audio de menos de una ventana', () => {
    // Con menos de 30 s el relleno domina y el RTF sale inflado.
    recordRtf('p', 5, 10);
    expect(learnedRtf('p')).toBeUndefined();
  });

  it('descarta valores imposibles', () => {
    recordRtf('p', 0, 300);
    recordRtf('p', -1, 300);
    recordRtf('p', Infinity, 300);
    recordRtf('p', 500, 300); // pestaña en segundo plano, reloj corriendo
    expect(learnedRtf('p')).toBeUndefined();
  });

  it('conserva sólo las últimas cinco', () => {
    for (const r of [1, 2, 3, 4, 5, 6, 7]) recordRtf('p', r, 300);
    expect(sampleCount('p')).toBe(5);
    expect(learnedRtf('p')).toBe(5); // mediana de 3..7
  });

  it('separa por perfil', () => {
    recordRtf('a', 0.4, 300);
    recordRtf('b', 1.2, 300);
    expect(learnedRtf('a')).toBe(0.4);
    expect(learnedRtf('b')).toBe(1.2);
  });

  it('no revienta si localStorage falla', () => {
    // Modo incógnito, cuota llena: perder el historial es aceptable, romper no.
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('bloqueado'); },
      setItem: () => { throw new Error('bloqueado'); },
      removeItem: () => { throw new Error('bloqueado'); },
    });
    expect(() => recordRtf('p', 0.5, 300)).not.toThrow();
    expect(learnedRtf('p')).toBeUndefined();
    expect(() => forget()).not.toThrow();
  });
});

describe('Estimator con RTF aprendido', () => {
  const profile = PROFILES[0];

  it('el RTF aprendido reemplaza al de tabla desde el arranque', () => {
    const e = new Estimator(profile, 0.8);
    const r = e.estimate(600);
    expect(r.rtf).toBe(0.8);
    expect(r.source).toBe('aprendido');
    expect(r.remainingSec).toBeCloseTo(480);
  });

  it('sin aprendizaje cae al de tabla y lo declara aproximado', () => {
    const r = new Estimator(profile).estimate(600);
    expect(r.source).toBe('tabla');
    expect(describeEstimate(r)).toMatch(/aproximada/);
  });

  it('una estimación aprendida NO se anuncia como aproximada', () => {
    // Ya no es un número prestado de otro equipo.
    const r = new Estimator(profile, 0.8).estimate(600);
    expect(describeEstimate(r)).not.toMatch(/aproximada/);
  });

  it('ignora un aprendizaje inválido', () => {
    expect(new Estimator(profile, 0).estimate(600).source).toBe('tabla');
    expect(new Estimator(profile, -1).estimate(600).source).toBe('tabla');
  });
});
