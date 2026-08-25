import { describe, it, expect } from 'vitest';
import { wer, aggregateWer } from './wer';
import { normalizeToWords } from './normalize';

const w = (s: string) => s.split(' ');

describe('wer — casos básicos', () => {
  it('texto idéntico da 0', () => {
    const r = wer(w('el gato come pescado'), w('el gato come pescado'));
    expect(r).toMatchObject({ wer: 0, sub: 0, del: 0, ins: 0, refWords: 4 });
  });

  it('cuenta una sustitución', () => {
    const r = wer(w('el gato come pescado'), w('el perro come pescado'));
    expect(r).toMatchObject({ sub: 1, del: 0, ins: 0 });
    expect(r.wer).toBeCloseTo(0.25);
  });

  it('cuenta un borrado — falta una palabra de la referencia', () => {
    const r = wer(w('el gato come pescado'), w('el gato pescado'));
    expect(r).toMatchObject({ sub: 0, del: 1, ins: 0 });
    expect(r.wer).toBeCloseTo(0.25);
  });

  it('cuenta una inserción — sobra una palabra en la hipótesis', () => {
    const r = wer(w('el gato come'), w('el gato come pescado'));
    expect(r).toMatchObject({ sub: 0, del: 0, ins: 1 });
    expect(r.wer).toBeCloseTo(1 / 3);
  });
});

describe('wer — el desglose separa alucinación de confusión', () => {
  it('la alucinación se ve como inserciones, no como sustituciones', () => {
    // Este es el motivo de reportar S/D/I por separado. El modelo dijo bien lo que
    // había e inventó una frase entera encima: el error es de inserción.
    const ref = w('hola que tal');
    const hyp = w('hola que tal gracias por ver el video suscribite al canal');
    const r = wer(ref, hyp);

    expect(r.sub).toBe(0);
    expect(r.del).toBe(0);
    expect(r.ins).toBe(8);
    expect(r.wer).toBeGreaterThan(1); // válido, no es un error de cálculo
  });

  it('la confusión se ve como sustituciones', () => {
    const r = wer(w('hola que tal'), w('ola ke tal'));
    expect(r.sub).toBe(2);
    expect(r.ins).toBe(0);
  });

  it('dos modelos con el mismo WER se distinguen por el desglose', () => {
    // Mismo total de errores, naturaleza distinta. Un WER agregado los daría iguales.
    const ref = w('uno dos tres cuatro');
    const confunde = wer(ref, w('uno DOS tres CUATRO'.toLowerCase().replace('dos', 'x').replace('cuatro', 'y')));
    const inventa = wer(ref, w('uno dos tres cuatro cinco seis'));

    expect(confunde.wer).toBeCloseTo(inventa.wer);
    expect(confunde.sub).toBeGreaterThan(0);
    expect(confunde.ins).toBe(0);
    expect(inventa.ins).toBeGreaterThan(0);
    expect(inventa.sub).toBe(0);
  });
});

describe('wer — casos borde', () => {
  it('hipótesis vacía: todo borrado, WER 1', () => {
    const r = wer(w('el gato come'), []);
    expect(r).toMatchObject({ wer: 1, del: 3, sub: 0, ins: 0 });
  });

  it('referencia vacía con hipótesis no vacía: infinito, no división silenciosa', () => {
    const r = wer([], w('el gato come'));
    expect(r.wer).toBe(Number.POSITIVE_INFINITY);
    expect(r.ins).toBe(3);
  });

  it('ambas vacías: 0', () => {
    expect(wer([], []).wer).toBe(0);
  });

  it('el total siempre es sub + del + ins sobre refWords', () => {
    const casos: Array<[string, string]> = [
      ['a b c d e', 'a x c e f'],
      ['uno dos tres', 'uno uno dos dos tres tres'],
      ['solo', 'una frase completamente distinta aca'],
    ];
    for (const [r, h] of casos) {
      const res = wer(w(r), w(h));
      expect(res.wer).toBeCloseTo((res.sub + res.del + res.ins) / res.refWords);
    }
  });
});

describe('aggregateWer — suma antes de dividir', () => {
  it('NO es el promedio de los WER individuales', () => {
    // El clip corto tiene WER 1 y el largo 0,01. Promediar daría ~0,5, que es falso:
    // el corpus tiene 101 palabras y 2 errores.
    const corto = wer(w('hola'), w('chau'));
    const largo = wer(Array(100).fill('palabra'), [...Array(99).fill('palabra'), 'otra']);

    const agregado = aggregateWer([corto, largo]);
    const promedio = (corto.wer + largo.wer) / 2;

    expect(agregado.refWords).toBe(101);
    expect(agregado.wer).toBeCloseTo(2 / 101);
    expect(agregado.wer).toBeLessThan(promedio / 10);
  });

  it('suma cada categoría por separado', () => {
    const a = wer(w('uno dos'), w('uno tres'));
    const b = wer(w('cuatro cinco'), w('cuatro cinco seis'));
    const agg = aggregateWer([a, b]);

    expect(agg.sub).toBe(a.sub + b.sub);
    expect(agg.ins).toBe(a.ins + b.ins);
    expect(agg.del).toBe(a.del + b.del);
    expect(agg.refWords).toBe(4);
  });

  it('lista vacía da 0 y no NaN', () => {
    expect(aggregateWer([]).wer).toBe(0);
  });
});

describe('integración — normalizador y WER juntos', () => {
  it('las diferencias que el normalizador borra no cuentan como error', () => {
    const ref = normalizeToWords('¿Tenés veinticinco años, che?', 'es');
    const hyp = normalizeToWords('tenes 25 anos che', 'es');
    // "años" vs "anos" SÍ debe contar: la ñ se preserva a propósito.
    const r = wer(ref, hyp);
    expect(r.sub).toBe(1);
  });

  it('mayúsculas, tildes y puntuación no cuentan como error', () => {
    const ref = normalizeToWords('¡Qué día más lindo!', 'es');
    const hyp = normalizeToWords('que dia mas lindo', 'es');
    expect(wer(ref, hyp).wer).toBe(0);
  });

  it('una contracción expandida no cuenta como error en inglés', () => {
    const ref = normalizeToWords("I don't know", 'en');
    const hyp = normalizeToWords('i do not know', 'en');
    expect(wer(ref, hyp).wer).toBe(0);
  });
});
