import { describe, it, expect } from 'vitest';
import {
  wrapText, toCues, formatTime, toSrt, toVtt, toPlainText, DEFAULT_RULES,
} from './subtitles';
import type { TimedText } from '../vad/align';

const t = (startSec: number, endSec: number, text: string): TimedText => ({ startSec, endSec, text });

describe('wrapText', () => {
  it('parte en líneas sin exceder el ancho', () => {
    const l = wrapText('una frase bastante larga que no entra en una sola línea de subtítulo', 20);
    for (const x of l) expect(x.length).toBeLessThanOrEqual(20);
  });

  it('NUNCA parte una palabra al medio', () => {
    const l = wrapText('hola anticonstitucionalmente chau', 10);
    expect(l.join(' ').split(/\s+/)).toEqual(['hola', 'anticonstitucionalmente', 'chau']);
  });

  it('una palabra más larga que el límite se deja entera', () => {
    // Partirla sería peor que una línea larga.
    expect(wrapText('anticonstitucionalmente', 10)).toEqual(['anticonstitucionalmente']);
  });

  it('texto vacío da lista vacía', () => {
    expect(wrapText('   ', 42)).toEqual([]);
  });
});

describe('formatTime', () => {
  it('SRT usa coma y VTT usa punto', () => {
    // No es estético: un SRT con puntos falla en varios reproductores.
    expect(formatTime(3661.5, ',')).toBe('01:01:01,500');
    expect(formatTime(3661.5, '.')).toBe('01:01:01.500');
  });

  it('rellena con ceros', () => {
    expect(formatTime(0, ',')).toBe('00:00:00,000');
    expect(formatTime(5.007, ',')).toBe('00:00:05,007');
  });

  it('arrastra el segundo cuando los milisegundos redondean a 1000', () => {
    // Sin esto saldría «00:00:09,1000», que no es un tiempo válido.
    expect(formatTime(9.9999, ',')).toBe('00:00:10,000');
  });

  it('un tiempo negativo se acota a cero', () => {
    expect(formatTime(-5, ',')).toBe('00:00:00,000');
  });
});

describe('toCues — reglas de legibilidad', () => {
  it('un tramo corto se convierte en un subtítulo', () => {
    const c = toCues([t(1, 4, 'Hola mundo')]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ index: 1, startSec: 1, endSec: 4 });
  });

  it('numera desde 1 y de forma consecutiva', () => {
    const c = toCues([t(0, 3, 'Uno'), t(4, 7, 'Dos'), t(8, 11, 'Tres')]);
    expect(c.map((x) => x.index)).toEqual([1, 2, 3]);
  });

  it('parte lo que no entra en dos líneas', () => {
    // 42×2 = 84 caracteres de capacidad. Con 200 hacen falta varios subtítulos.
    const texto = 'palabra '.repeat(25).trim();
    const c = toCues([t(0, 20, texto)]);
    expect(c.length).toBeGreaterThan(1);
    for (const x of c) expect(x.lines.length).toBeLessThanOrEqual(DEFAULT_RULES.maxLines);
  });

  it('parte lo que no se alcanza a LEER en su tiempo', () => {
    // 80 caracteres en 2 s son 40 por segundo: más del doble de lo legible.
    const c = toCues([t(0, 2, 'a'.repeat(20) + ' ' + 'b'.repeat(20) + ' ' + 'c'.repeat(20) + ' ' + 'd'.repeat(17))]);
    expect(c.length).toBeGreaterThan(1);
  });

  it('parte lo que dura demasiado', () => {
    // Un subtítulo de 20 s se queda quieto mucho después de leerse.
    const c = toCues([t(0, 20, 'texto corto')]);
    expect(c.length).toBeGreaterThan(1);
  });

  it('estira los que parpadearían', () => {
    const c = toCues([t(0, 0.2, 'Sí')]);
    expect(c[0].endSec - c[0].startSec).toBeGreaterThanOrEqual(DEFAULT_RULES.minDurationSec);
  });

  it('al estirar NO invade el subtítulo siguiente', () => {
    // Dos subtítulos superpuestos aparecen encimados en pantalla.
    const c = toCues([t(0, 0.2, 'Sí'), t(0.5, 3, 'Claro que sí')]);
    expect(c[0].endSec).toBeLessThanOrEqual(c[1].startSec);
  });

  it('descarta los tramos sin texto', () => {
    // Un subtítulo vacío en pantalla es un error visible. Que el tramo exista es
    // información —el modelo omitió algo— pero eso lo reporta checkCoverage.
    const c = toCues([t(0, 3, 'Hola'), t(4, 7, ''), t(8, 11, 'Chau')]);
    expect(c).toHaveLength(2);
  });

  it('los tiempos nunca se cruzan', () => {
    const c = toCues([t(0, 5, 'a b c d e'), t(6, 12, 'f g h i j k l m n')]);
    for (let i = 1; i < c.length; i++) {
      expect(c[i].startSec).toBeGreaterThanOrEqual(c[i - 1].startSec);
      expect(c[i].endSec).toBeGreaterThanOrEqual(c[i].startSec);
    }
  });

  it('al partir NO pierde ni duplica palabras', () => {
    const texto = Array.from({ length: 40 }, (_, i) => `p${i}`).join(' ');
    const c = toCues([t(0, 30, texto)]);
    const salida = c.flatMap((x) => x.lines).join(' ').split(/\s+/).filter(Boolean);
    expect(salida).toEqual(texto.split(' '));
  });
});

describe('toSrt', () => {
  const cues = toCues([t(1, 4, 'Primera línea'), t(5, 8, 'Segunda línea')]);

  it('usa CRLF, que es lo que espera el formato', () => {
    expect(toSrt(cues)).toContain('\r\n');
  });

  it('numera y usa coma en los tiempos', () => {
    const srt = toSrt(cues);
    expect(srt).toMatch(/^1\r\n00:00:01,000 --> 00:00:04,000\r\n/);
  });

  it('separa los subtítulos con una línea en blanco', () => {
    expect(toSrt(cues)).toContain('\r\n\r\n2\r\n');
  });

  it('termina con salto de línea', () => {
    expect(toSrt(cues).endsWith('\r\n')).toBe(true);
  });

  it('sin subtítulos no revienta', () => {
    expect(() => toSrt([])).not.toThrow();
  });
});

describe('toVtt', () => {
  const cues = toCues([t(1, 4, 'Hola'), t(5, 8, 'Chau')]);

  it('empieza con la cabecera obligatoria', () => {
    // Sin ella el navegador rechaza el archivo entero sin decir por qué.
    expect(toVtt(cues).startsWith('WEBVTT\n\n')).toBe(true);
  });

  it('usa PUNTO en los tiempos, no coma', () => {
    expect(toVtt(cues)).toContain('00:00:01.000 --> 00:00:04.000');
    expect(toVtt(cues)).not.toContain(',000');
  });

  it('NO numera los subtítulos', () => {
    // VTT no lo necesita y algunos analizadores se confunden.
    expect(toVtt(cues)).not.toMatch(/\n1\n00:/);
  });
});

describe('toPlainText', () => {
  it('un tramo por línea, sin los vacíos', () => {
    expect(toPlainText([t(0, 1, 'Uno'), t(2, 3, ''), t(4, 5, 'Dos')])).toBe('Uno\nDos');
  });
});
