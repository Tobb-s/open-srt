import { describe, it, expect } from 'vitest';
import { splitSentences, alignBlockText, checkCoverage, MIN_WORDS_PER_SPEECH_SEC } from './align';
import type { Segment } from './segments';

const seg = (a: number, b: number): Segment => ({ startSec: a, endSec: b });

describe('splitSentences', () => {
  it('corta en punto, interrogación y exclamación', () => {
    expect(splitSentences('Hola mundo. ¿Cómo estás? ¡Bien!')).toHaveLength(3);
  });

  it('NO corta en decimales', () => {
    // Un corte acá partiría un número al medio.
    expect(splitSentences('El total es 3.14 pesos')).toHaveLength(1);
  });

  it('NO corta en abreviaturas seguidas de minúscula', () => {
    expect(splitSentences('Vino el Sr. lópez ayer')).toHaveLength(1);
  });

  it('respeta la apertura de signos del español', () => {
    const s = splitSentences('Llegó tarde. ¿Qué pasó?');
    expect(s).toHaveLength(2);
    expect(s[1]).toBe('¿Qué pasó?');
  });

  it('texto vacío da lista vacía', () => {
    expect(splitSentences('   ')).toHaveLength(0);
  });

  it('texto sin puntuación queda entero', () => {
    expect(splitSentences('hola que tal como andas')).toHaveLength(1);
  });
});

describe('alignBlockText — un tramo', () => {
  it('le da todo el texto', () => {
    const r = alignBlockText([seg(1, 4)], 'Hola mundo cruel');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ startSec: 1, endSec: 4, text: 'Hola mundo cruel' });
  });
});

describe('alignBlockText — oraciones que coinciden con tramos', () => {
  it('asigna una oración por tramo', () => {
    // El caso frecuente: el detector corta donde alguien deja de hablar, que suele ser
    // el final de una frase.
    const r = alignBlockText(
      [seg(0, 3), seg(4, 7), seg(8, 11)],
      'Primera frase. Segunda frase. Tercera frase.',
    );
    expect(r.map((x) => x.text)).toEqual(['Primera frase.', 'Segunda frase.', 'Tercera frase.']);
    // Y los tiempos son los del detector, sin tocar.
    expect(r[1]).toMatchObject({ startSec: 4, endSec: 7 });
  });
});

describe('alignBlockText — reparto por duración', () => {
  it('da más texto al tramo más largo', () => {
    // Sin correspondencia de oraciones, se reparte por peso.
    const r = alignBlockText([seg(0, 1), seg(2, 12)], 'uno dos tres cuatro cinco seis siete ocho nueve diez once');
    expect(r[1].text.split(' ').length).toBeGreaterThan(r[0].text.split(' ').length);
  });

  it('NO pierde ni duplica palabras', () => {
    // El control de fondo: todo lo que entra tiene que salir, una sola vez.
    const texto = 'una dos tres cuatro cinco seis siete ocho nueve diez';
    const r = alignBlockText([seg(0, 2), seg(3, 8), seg(9, 11)], texto);
    const salida = r.map((x) => x.text).join(' ').trim().split(/\s+/).filter(Boolean);
    expect(salida).toEqual(texto.split(' '));
  });

  it('nunca parte una palabra al medio', () => {
    const texto = 'anticonstitucionalmente esdrujulisimo paralelepipedo';
    const r = alignBlockText([seg(0, 1), seg(2, 3), seg(4, 5)], texto);
    for (const t of r) {
      for (const w of t.text.split(/\s+/).filter(Boolean)) {
        expect(texto.split(' ')).toContain(w);
      }
    }
  });

  it('con menos palabras que tramos, los últimos quedan vacíos', () => {
    // No se inventa texto para rellenar: un tramo vacío es información.
    const r = alignBlockText([seg(0, 2), seg(3, 5), seg(6, 8)], 'una dos');
    expect(r).toHaveLength(3);
    expect(r.map((x) => x.text).join(' ').trim().split(/\s+/).filter(Boolean)).toHaveLength(2);
  });

  it('los tiempos siempre son los del detector, se reparta como se reparta', () => {
    const segs = [seg(1.5, 4.2), seg(5.1, 9.9)];
    const r = alignBlockText(segs, 'a b c d e f g');
    expect(r[0].startSec).toBe(1.5);
    expect(r[0].endSec).toBe(4.2);
    expect(r[1].startSec).toBe(5.1);
    expect(r[1].endSec).toBe(9.9);
  });
});

describe('alignBlockText — casos borde', () => {
  it('sin tramos no hay salida', () => {
    expect(alignBlockText([], 'texto')).toHaveLength(0);
  });

  it('texto vacío deja los tramos con texto vacío, no los descarta', () => {
    // Los tramos siguen existiendo: hubo habla aunque no haya texto. Descartarlos
    // escondería exactamente la omisión que queremos detectar.
    const r = alignBlockText([seg(0, 3), seg(4, 7)], '');
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.text === '')).toBe(true);
  });
});

describe('checkCoverage — la detección de omisiones', () => {
  const timed = (n: number, palabras: number) =>
    Array.from({ length: n }, (_, i) => ({
      startSec: i * 5,
      endSec: i * 5 + 4,
      text: Array(palabras).fill('palabra').join(' '),
    }));

  it('una transcripción normal no levanta sospecha', () => {
    // ~2,5 palabras por segundo de habla, que es el ritmo del habla leída.
    const r = checkCoverage(timed(5, 10), 20);
    expect(r.suspicious).toBe(false);
    expect(r.wordsPerSpeechSec).toBeGreaterThan(MIN_WORDS_PER_SPEECH_SEC);
  });

  it('DETECTA cuando falta la mayor parte del texto', () => {
    // El caso medido en E1: 60 s de habla y sólo un puñado de palabras. El modelo se
    // saltó un tramo y devolvió algo fluido, así que nada más lo delataría.
    const r = checkCoverage(timed(2, 3), 60);
    expect(r.suspicious).toBe(true);
  });

  it('cuenta los tramos que quedaron sin una sola palabra', () => {
    const conVacios = [...timed(2, 5), { startSec: 20, endSec: 24, text: '' }];
    expect(checkCoverage(conVacios, 12).emptySegments).toBe(1);
  });

  it('NO sospecha con audio demasiado corto', () => {
    // Con pocos segundos el cociente es ruidoso y avisaría en falso.
    expect(checkCoverage(timed(1, 1), 5).suspicious).toBe(false);
  });

  it('sin habla no divide por cero', () => {
    const r = checkCoverage([], 0);
    expect(r.wordsPerSpeechSec).toBe(0);
    expect(Number.isFinite(r.wordsPerSpeechSec)).toBe(true);
  });

  it('texto vacío con mucha habla es el caso más claro', () => {
    const r = checkCoverage([{ startSec: 0, endSec: 60, text: '' }], 60);
    expect(r.suspicious).toBe(true);
    expect(r.emptySegments).toBe(1);
  });
});
