import { describe, expect, it, vi } from 'vitest';
import { MIN_SEC, defaultSpeakerName, diarize } from './diarize';
import type { Segment } from '../vad/segments';

/**
 * La tubería de diarización, con un modelo de mentira.
 *
 * El modelo se inyecta —`embed` es un parámetro— y acá se le da uno que devuelve la dirección
 * que se le pida. Eso permite probar **las decisiones** de la tubería, que son las que se
 * pueden equivocar en silencio: qué tramos entran al agrupamiento, qué pasa con los cortos, y
 * qué se devuelve cuando no hay nada con que decidir.
 *
 * Que el modelo de verdad separe hablantes es otra medición y está en
 * `embeddings.integration.test.ts`; que el umbral generalice, en `umbral.integration.test.ts`.
 */

const RATE = 16000;

/** Tramos de la duración que se pidan, uno detrás de otro. */
function tramos(...duraciones: number[]): Segment[] {
  const out: Segment[] = [];
  let t = 0;
  for (const d of duraciones) {
    out.push({ startSec: t, endSec: t + d });
    t += d + 0.3;
  }
  return out;
}

/**
 * Un «modelo» que devuelve una dirección según qué parte del audio le toque.
 *
 * El audio se arma con una marca por tramo: la muestra en la posición 0 dice qué hablante es.
 */
function modeloFalso() {
  return vi.fn(async (trozo: Float32Array) => {
    const v = new Float32Array(8);
    const cual = Math.round(trozo[0] ?? 0);
    v[Math.min(7, Math.max(0, cual))] = 1;
    return v;
  });
}

/** Audio donde cada tramo lleva su marca de hablante en la primera muestra. */
function audioCon(segments: Segment[], quien: number[]): Float32Array {
  const fin = Math.max(...segments.map((s) => s.endSec));
  const a = new Float32Array(Math.ceil((fin + 1) * RATE));
  for (const [i, s] of segments.entries()) a[Math.round(s.startSec * RATE)] = quien[i];
  return a;
}

describe('diarize', () => {
  it('agrupa los tramos por hablante', async () => {
    const segs = tramos(2, 2, 2, 2);
    const r = await diarize({
      audio: audioCon(segs, [0, 1, 0, 1]),
      segments: segs,
      sampleRate: RATE,
      embed: modeloFalso(),
    });
    expect(r.count).toBe(2);
    expect(r.speakers[0]).toBe(r.speakers[2]);
    expect(r.speakers[1]).toBe(r.speakers[3]);
    expect(r.speakers[0]).not.toBe(r.speakers[1]);
  });

  it('no le pide un embedding a los tramos demasiado cortos', async () => {
    // Un tramo de 200 ms no da un embedding en el que se pueda confiar. Pedirlo igual
    // gastaría una inferencia y metería ruido en el agrupamiento.
    const segs = tramos(2, MIN_SEC / 2, 2);
    const embed = modeloFalso();
    await diarize({
      audio: audioCon(segs, [0, 1, 0]),
      segments: segs,
      sampleRate: RATE,
      embed,
    });
    expect(embed).toHaveBeenCalledTimes(2);
  });

  it('pero los cortos igual quedan atribuidos, al vecino más cercano', async () => {
    // Dejarlos sin nombre sería más honesto en abstracto; en pantalla, un tramo en blanco
    // entre dos con nombre se lee como un error del programa.
    const segs = tramos(2, MIN_SEC / 2, 2);
    const r = await diarize({
      audio: audioCon(segs, [0, 5, 0]),
      segments: segs,
      sampleRate: RATE,
      embed: modeloFalso(),
    });
    expect(r.speakers).toHaveLength(3);
    for (const s of r.speakers) expect(s).toBeTruthy();
    expect(r.speakers[1]).toBe(r.speakers[0]);
  });

  it('sin ningún tramo largo, todo es la misma persona', async () => {
    // Es lo más parecido a la verdad que se puede afirmar sin evidencia para separar.
    const segs = tramos(0.2, 0.3, 0.2);
    const embed = modeloFalso();
    const r = await diarize({
      audio: audioCon(segs, [0, 1, 2]),
      segments: segs,
      sampleRate: RATE,
      embed,
    });
    expect(r.count).toBe(1);
    expect(embed).not.toHaveBeenCalled();
  });

  it('sin tramos no devuelve nada', async () => {
    const r = await diarize({
      audio: new Float32Array(RATE),
      segments: [],
      sampleRate: RATE,
      embed: modeloFalso(),
    });
    expect(r).toEqual({ speakers: [], count: 0 });
  });

  it('respeta el tope de hablantes', async () => {
    // Quince personas en una reunión de cuatro es peor que inútil: hay que corregir tramo
    // por tramo. Prefiere juntar de más a inventar gente.
    const segs = tramos(2, 2, 2, 2, 2, 2);
    const r = await diarize({
      audio: audioCon(segs, [0, 1, 2, 3, 4, 5]),
      segments: segs,
      sampleRate: RATE,
      embed: modeloFalso(),
      maxSpeakers: 3,
    });
    expect(r.count).toBeLessThanOrEqual(3);
  });

  it('informa el avance con el total real, no con la cantidad de tramos', async () => {
    // Los cortos no generan inferencia: contar sobre el total dejaría la barra clavada antes
    // de llegar al final.
    const segs = tramos(2, 0.2, 2, 0.2, 2);
    const avances: Array<[number, number]> = [];
    await diarize({
      audio: audioCon(segs, [0, 0, 1, 0, 1]),
      segments: segs,
      sampleRate: RATE,
      embed: modeloFalso(),
      onProgress: (d, t) => avances.push([d, t]),
    });
    expect(avances).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('se puede cancelar', async () => {
    const segs = tramos(2, 2, 2);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      diarize({
        audio: audioCon(segs, [0, 1, 0]),
        segments: segs,
        sampleRate: RATE,
        embed: modeloFalso(),
        signal: ctrl.signal,
      }),
    ).rejects.toThrow('Cancelado');
  });
});

describe('defaultSpeakerName', () => {
  it('numera desde 1, que es como cuenta la gente', () => {
    expect(defaultSpeakerName('0', (n) => `Hablante ${n}`)).toBe('Hablante 1');
    expect(defaultSpeakerName('2', (n) => `Hablante ${n}`)).toBe('Hablante 3');
  });

  it('deja pasar una etiqueta que ya es un nombre', () => {
    expect(defaultSpeakerName('Martín', (n) => `Hablante ${n}`)).toBe('Martín');
  });
});
