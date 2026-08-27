import { describe, expect, it } from 'vitest';
import { agglomerative, cosine, labelsOf } from './cluster';

/**
 * El agrupamiento, con vectores construidos a mano.
 *
 * Se prueba con embeddings inventados —tres direcciones bien separadas, con ruido— porque lo
 * que hay que verificar acá es la **regla de agrupar**, no el modelo. Que el modelo separe
 * hablantes es otra medición, y está en `embeddings.integration.test.ts`.
 */

/** Un vector en una dirección dada, con algo de ruido determinista. */
function vec(direccion: number, ruido: number, semilla: number): Float32Array {
  const v = new Float32Array(16);
  v[direccion] = 1;
  let s = semilla;
  for (let i = 0; i < v.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    v[i] += ((s / 0x7fffffff) * 2 - 1) * ruido;
  }
  return v;
}

describe('cosine', () => {
  it('vale 1 para el mismo vector y 0 para perpendiculares', () => {
    const a = Float32Array.from([1, 0, 0]);
    const b = Float32Array.from([0, 1, 0]);
    expect(cosine(a, a)).toBeCloseTo(1, 6);
    expect(cosine(a, b)).toBeCloseTo(0, 6);
  });

  it('no se rompe con el vector nulo', () => {
    // Un tramo de silencio puede dar un embedding degenerado; dividir por cero daría NaN y
    // el NaN se propagaría por todo el agrupamiento sin que nada falle.
    expect(cosine(new Float32Array(4), Float32Array.from([1, 0, 0, 0]))).toBe(0);
  });
});

describe('agglomerative', () => {
  it('junta lo parecido y separa lo distinto', () => {
    const embs = [
      vec(0, 0.05, 1), vec(0, 0.05, 2), vec(0, 0.05, 3),
      vec(5, 0.05, 4), vec(5, 0.05, 5),
      vec(9, 0.05, 6),
    ];
    const grupos = agglomerative(embs, { threshold: 0.5 });
    expect(grupos).toHaveLength(3);
    expect(grupos.map((g) => g.members)).toEqual([[0, 1, 2], [3, 4], [5]]);
  });

  it('con el umbral al máximo no junta nada', () => {
    // CONTROL: si diera lo mismo con cualquier umbral, el parámetro no estaría haciendo nada
    // y el resultado de arriba sería una casualidad.
    const embs = [vec(0, 0.05, 1), vec(0, 0.05, 2), vec(5, 0.05, 3)];
    expect(agglomerative(embs, { threshold: 0.999 })).toHaveLength(3);
  });

  it('con el umbral al mínimo junta todo', () => {
    const embs = [vec(0, 0.05, 1), vec(5, 0.05, 2), vec(9, 0.05, 3)];
    expect(agglomerative(embs, { threshold: -1 })).toHaveLength(1);
  });

  it('el tope obliga a unir aunque el parecido no alcance', () => {
    // Sirve cuando el umbral quedó mal puesto: sin tope, esto devolvería un grupo por
    // elemento y el resultado parecería plausible sin haber agrupado nada.
    const embs = [vec(0, 0.05, 1), vec(5, 0.05, 2), vec(9, 0.05, 3), vec(12, 0.05, 4)];
    expect(agglomerative(embs, { threshold: 0.9, maxClusters: 2 })).toHaveLength(2);
  });

  it('el orden de salida es estable', () => {
    // Dos corridas tienen que dar lo mismo: si el orden dependiera del recorrido interno, el
    // DER cambiaría entre corridas sin que cambie nada del audio.
    const embs = [vec(5, 0.05, 7), vec(0, 0.05, 8), vec(5, 0.05, 9), vec(0, 0.05, 10)];
    const a = agglomerative(embs, { threshold: 0.5 });
    const b = agglomerative(embs, { threshold: 0.5 });
    expect(a.map((g) => g.members)).toEqual(b.map((g) => g.members));
    // Y el primer grupo es el que contiene al primer elemento.
    expect(a[0].members[0]).toBe(0);
  });

  it('casos borde: vacío y un solo elemento', () => {
    expect(agglomerative([], { threshold: 0.5 })).toEqual([]);
    expect(agglomerative([vec(0, 0, 1)], { threshold: 0.5 })).toEqual([{ members: [0] }]);
  });
});

describe('labelsOf', () => {
  it('da una etiqueta por elemento, en orden de grupo', () => {
    const grupos = [{ members: [0, 2] }, { members: [1] }];
    expect(labelsOf(grupos, 3)).toEqual(['0', '1', '0']);
  });
});
