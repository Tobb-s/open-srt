import { describe, expect, it } from 'vitest';
import { toCues, toSrt, toVtt, toPlainText } from './subtitles';
import type { TimedText } from '../vad/align';

/**
 * Cómo aparece el hablante en cada formato de salida.
 *
 * Las convenciones **no son intercambiables** y el motivo importa:
 *
 * - **WebVTT** tiene campo propio, `<v Nombre>`. Es la única de las cuatro salidas donde el
 *   reproductor sabe que eso es una persona y no texto: puede darle color, ponerlo aparte o
 *   dejar que el usuario filtre por hablante.
 * - **SubRip** no tiene campo. La convención de la industria es escribirlo en el texto, así
 *   que va como prefijo.
 * - **Texto plano** también, pero sólo cuando el hablante **cambia**: repetirlo en cada tramo
 *   llenaría la página de «Martín:» cuando Martín habla cinco tramos seguidos.
 *
 * Y en los tres, un tramo sin hablante tiene que salir exactamente como salía antes: la
 * diarización es opcional y no puede cambiar lo que ya funcionaba.
 */

const CONVERSACION: TimedText[] = [
  { startSec: 0, endSec: 3, text: 'Buenas tardes a todos.', speaker: 'Martín' },
  { startSec: 3.2, endSec: 6, text: 'Gracias por venir.', speaker: 'Martín' },
  { startSec: 6.5, endSec: 9, text: '¿Empezamos con el presupuesto?', speaker: 'Ana' },
  { startSec: 9.5, endSec: 12, text: 'Dale.', speaker: 'Martín' },
];

const SIN_HABLANTE: TimedText[] = [
  { startSec: 0, endSec: 3, text: 'Buenas tardes a todos.' },
  { startSec: 3.2, endSec: 6, text: 'Gracias por venir.' },
];

describe('texto plano', () => {
  it('escribe el nombre sólo cuando cambia el hablante', () => {
    expect(toPlainText(CONVERSACION)).toBe(
      [
        'Martín: Buenas tardes a todos.',
        'Gracias por venir.',
        'Ana: ¿Empezamos con el presupuesto?',
        'Martín: Dale.',
      ].join('\n'),
    );
  });

  it('sin hablantes sale igual que antes', () => {
    expect(toPlainText(SIN_HABLANTE)).toBe('Buenas tardes a todos.\nGracias por venir.');
  });
});

describe('SubRip', () => {
  /** Analizador estricto, escrito a la especificación y no compartido con el exportador. */
  function parseSrt(texto: string) {
    return texto
      .trimEnd()
      .split('\r\n\r\n')
      .map((bloque) => {
        const [numero, tiempos, ...lineas] = bloque.split('\r\n');
        if (!/^\d+$/.test(numero)) throw new Error(`numeración inválida: ${numero}`);
        if (!/^\d\d:\d\d:\d\d,\d\d\d --> \d\d:\d\d:\d\d,\d\d\d$/.test(tiempos)) {
          throw new Error(`tiempos inválidos: ${tiempos}`);
        }
        return { numero: Number(numero), lineas };
      });
  }

  it('el nombre va como prefijo de la primera línea', () => {
    // SubRip no tiene campo de hablante. Una línea aparte gastaría una de las dos que caben
    // en pantalla.
    const bloques = parseSrt(toSrt(toCues(CONVERSACION)));
    expect(bloques[0].lineas[0]).toMatch(/^Martín: /);
    expect(bloques.some((b) => b.lineas[0].startsWith('Ana: '))).toBe(true);
  });

  it('sigue siendo un SRT válido con el prefijo puesto', () => {
    // El analizador tira si la numeración o los tiempos se rompen. Que no tire es la prueba.
    expect(() => parseSrt(toSrt(toCues(CONVERSACION)))).not.toThrow();
  });

  it('sin hablantes no aparece ningún prefijo', () => {
    const bloques = parseSrt(toSrt(toCues(SIN_HABLANTE)));
    for (const b of bloques) expect(b.lineas[0]).not.toMatch(/^[^:]+: /);
  });

  it('el prefijo se repite cuando un tramo largo se parte en varios subtítulos', () => {
    // Al partir por velocidad de lectura, cada trozo es un subtítulo independiente que
    // aparece solo en pantalla: sin el nombre, el segundo no diría quién habla.
    const largo: TimedText[] = [
      {
        startSec: 0,
        endSec: 12,
        speaker: 'Ana',
        text:
          'Una intervención deliberadamente larga que no entra en dos líneas de cuarenta y ' +
          'dos caracteres y por lo tanto el exportador la parte en varios subtítulos.',
      },
    ];
    const bloques = parseSrt(toSrt(toCues(largo)));
    expect(bloques.length).toBeGreaterThan(1);
    for (const b of bloques) expect(b.lineas[0]).toMatch(/^Ana: /);
  });
});

describe('WebVTT', () => {
  it('usa la etiqueta de voz, que es campo de verdad', () => {
    const vtt = toVtt(toCues(CONVERSACION));
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true);
    expect(vtt).toContain('<v Martín>');
    expect(vtt).toContain('<v Ana>');
  });

  it('la etiqueta va en cada cue, no sólo al cambiar', () => {
    // A diferencia del texto plano: en un reproductor cada subtítulo aparece solo, sin el
    // anterior a la vista, así que omitir el nombre dejaría cues sin atribuir.
    const cues = toVtt(toCues(CONVERSACION)).split('\n\n').slice(1);
    for (const c of cues) expect(c).toMatch(/<v [^>]+>/);
  });

  it('escapa lo que rompería el marcado', () => {
    // Un texto transcrito puede traer `<` o `&`; sin escapar, el navegador corta la línea o
    // deja de mostrarla, y no avisa.
    const conMarcado: TimedText[] = [
      { startSec: 0, endSec: 3, text: 'usá a < b && c', speaker: 'Ana & Co' },
    ];
    const vtt = toVtt(toCues(conMarcado));
    expect(vtt).toContain('&lt;');
    expect(vtt).toContain('&amp;');
    // Y no queda ningún `<` suelto fuera de la propia etiqueta de voz.
    const cuerpo = vtt.replace(/<v [^>]*>/g, '');
    expect(cuerpo).not.toMatch(/<(?!\/)/);
  });

  it('sin hablantes no aparece ninguna etiqueta de voz', () => {
    expect(toVtt(toCues(SIN_HABLANTE))).not.toContain('<v ');
  });
});

describe('el hablante sobrevive al partido de los tramos', () => {
  it('cada subtítulo hereda el hablante del tramo del que salió', () => {
    // `toCues` puede partir un tramo en varios. Si el hablante se perdiera en el camino,
    // los trozos saldrían sin atribuir y nadie lo notaría hasta abrir el archivo.
    const cues = toCues(CONVERSACION);
    expect(cues.length).toBeGreaterThanOrEqual(CONVERSACION.length);
    for (const c of cues) expect(c.speaker).toBeTruthy();
    expect(new Set(cues.map((c) => c.speaker))).toEqual(new Set(['Martín', 'Ana']));
  });
});
