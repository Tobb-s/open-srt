import { describe, expect, it } from 'vitest';
import { layoutTranscript, paginate, wrapByMeasure } from './document';
import { toPdfSafe } from './pdf';
import type { TimedText } from '../vad/align';

/**
 * El modelo del documento y las dos operaciones que el PDF necesita hacer a mano.
 *
 * Nada de esto carga `docx` ni `pdf-lib`: la parte que decide **qué dice** el documento y
 * **cómo se corta** está separada de la que dibuja, justamente para poder probarla con
 * números. Que el archivo abra en Word y en un lector de PDF es otra comprobación, y se hace
 * abriéndolos.
 */

const ETIQUETAS = {
  title: 'Transcripción',
  subtitle: (f: string, d: string, n: number) => `${f} · ${d} · ${n} tramos`,
};

const TRAMOS: TimedText[] = [
  { startSec: 0.5, endSec: 3, text: 'Primera cosa que se dijo.' },
  { startSec: 3, endSec: 4, text: '   ' },
  { startSec: 3661.5, endSec: 3664, text: 'Otra pasada la hora.' },
];

describe('layoutTranscript', () => {
  it('descarta los tramos sin texto', () => {
    const m = layoutTranscript(TRAMOS, {
      fileName: 'reunion.mp4',
      durationHuman: '1 h',
      labels: ETIQUETAS,
    });
    // Una fila vacía con una hora al lado parece un error del documento y no lo es.
    expect(m.rows).toHaveLength(2);
    expect(m.rows.map((r) => r.text)).toEqual([
      'Primera cosa que se dijo.',
      'Otra pasada la hora.',
    ]);
  });

  it('la hora va sin milisegundos y aguanta pasada la hora', () => {
    const m = layoutTranscript(TRAMOS, {
      fileName: 'r.mp4',
      durationHuman: '1 h',
      labels: ETIQUETAS,
    });
    expect(m.rows[0].time).toBe('00:00:00');
    expect(m.rows[1].time).toBe('01:01:01');
    // Los milisegundos en un documento para leer son ruido.
    for (const r of m.rows) expect(r.time).not.toMatch(/[.,]/);
  });

  it('el subtítulo cuenta las filas que quedaron, no los tramos que entraron', () => {
    const m = layoutTranscript(TRAMOS, {
      fileName: 'reunion.mp4',
      durationHuman: '1 h 1 min',
      labels: ETIQUETAS,
    });
    expect(m.subtitle).toBe('reunion.mp4 · 1 h 1 min · 2 tramos');
  });
});

describe('wrapByMeasure', () => {
  // Medida de juguete: cada carácter mide 1. Alcanza para probar la lógica de corte, que es
  // lo único que hay acá; la medida real la pone la fuente.
  const medir = (s: string) => s.length;

  it('corta al llegar al ancho, en límite de palabra', () => {
    expect(wrapByMeasure('uno dos tres cuatro', 11, medir)).toEqual(['uno dos', 'tres cuatro']);
  });

  it('una palabra más ancha que el renglón se deja entera', () => {
    // Partirla sería peor: se rompe la lectura y no se gana nada.
    expect(wrapByMeasure('anticonstitucionalmente ya', 10, medir)).toEqual([
      'anticonstitucionalmente',
      'ya',
    ]);
  });

  it('colapsa los espacios y no devuelve líneas vacías', () => {
    expect(wrapByMeasure('  uno   dos  ', 100, medir)).toEqual(['uno dos']);
    expect(wrapByMeasure('   ', 100, medir)).toEqual([]);
  });

  it('usa la medida que le pasan y no la longitud del texto', () => {
    // CONTROL: si ignorara `measure` y contara caracteres, este caso daría otra cosa. Con
    // una medida que dice que todo es angosto, entra todo en una línea.
    expect(wrapByMeasure('uno dos tres cuatro', 11, () => 1)).toEqual(['uno dos tres cuatro']);
  });
});

describe('paginate', () => {
  it('llena una página antes de abrir la siguiente', () => {
    expect(paginate([30, 30, 30, 30], 100)).toEqual([
      [0, 1, 2],
      [3],
    ]);
  });

  it('no parte un tramo entre páginas', () => {
    // El tramo 1 no entra en lo que queda, así que va entero a la página siguiente en vez
    // de cortarse: dar vuelta la hoja para terminar una frase es lo que hay que evitar.
    expect(paginate([80, 40, 40], 100)).toEqual([[0], [1, 2]]);
  });

  it('un tramo más alto que la página va igual, solo', () => {
    // La alternativa sería perderlo. Se desborda y se ve, que es preferible.
    expect(paginate([50, 300, 40], 100)).toEqual([[0], [1], [2]]);
  });

  it('si el PRIMER tramo no entra, no se abre una página en blanco antes', () => {
    // Este caso lo encontró la prueba de mutación. Quitar la guarda `actual.length > 0` no
    // rompía ninguno de los tests de arriba —los tracé: los tres daban lo mismo— porque
    // todos empiezan con un tramo que entra. El único que la ejercita es éste, y sin la
    // guarda devuelve `[[], [0], [1]]`: una hoja en blanco al principio del PDF.
    expect(paginate([300, 40], 100)).toEqual([[0], [1]]);
  });

  it('ninguna página queda vacía, entren o no los tramos', () => {
    // La propiedad de fondo, por encima de dónde caiga cada corte. Un caso a mano tapa un
    // agujero; esto tapa la clase entera.
    for (const alturas of [[300], [300, 40], [40, 300], [500, 500], [10, 10], [120, 30, 200]]) {
      for (const paginas of [paginate(alturas, 100), paginate(alturas, 100, 60)]) {
        expect(paginas.every((p) => p.length > 0), JSON.stringify({ alturas, paginas })).toBe(
          true,
        );
      }
    }
  });

  it('sin filas no hay páginas', () => {
    expect(paginate([], 100)).toEqual([]);
  });

  it('la primera página puede tener menos lugar que las demás', () => {
    // Es lo que pasa en el PDF: la primera lleva encabezado. Antes de esto, el hueco se
    // reservaba en todas y quedaban cuatro centímetros de blanco arriba de cada página.
    // Con 60 de primera y 100 después: entran 2 filas de 30, después 3, después el resto.
    expect(paginate([30, 30, 30, 30, 30, 30, 30], 100, 60)).toEqual([
      [0, 1],
      [2, 3, 4],
      [5, 6],
    ]);
  });

  it('con un solo alto, la primera se comporta como el resto', () => {
    // El parámetro es opcional y no tiene que cambiar el comportamiento de quien no lo usa.
    expect(paginate([30, 30, 30, 30], 100)).toEqual(paginate([30, 30, 30, 30], 100, 100));
  });

  it('no pierde ninguna fila', () => {
    // La propiedad que importa por encima de dónde caiga cada corte.
    const alturas = [20, 35, 12, 90, 45, 8, 60];
    const paginas = paginate(alturas, 100);
    expect(paginas.flat()).toEqual(alturas.map((_, i) => i));
  });
});

describe('toPdfSafe', () => {
  it('deja pasar acentos, ñ y signos de apertura', () => {
    expect(toPdfSafe('¿Qué año? ¡Sí! pingüino')).toBe('¿Qué año? ¡Sí! pingüino');
  });

  it('NO toca las comillas tipográficas ni el guion largo', () => {
    // La primera versión las reemplazaba, por una suposición sin comprobar. WinAnsi cubre
    // el bloque 0x80–0x9F, que es justamente donde viven. Cambiarlas habría empeorado el
    // PDF frente al DOCX sin ninguna razón.
    expect(toPdfSafe('dijo “hola” —y se fue…')).toBe('dijo “hola” —y se fue…');
    expect(toPdfSafe('«así»')).toBe('«así»');
  });

  it('cambia lo que tiene equivalente obvio', () => {
    expect(toPdfSafe('5′ 30″')).toBe("5' 30\"");
    expect(toPdfSafe('a → b')).toBe('a -> b');
  });

  it('lo que queda afuera se marca en vez de romper el archivo', () => {
    expect(toPdfSafe('中文 texto')).toBe('?? texto');
    // Un emoji son dos unidades UTF-16: si se recorriera por índice quedaría medio carácter.
    expect(toPdfSafe('hola 🙂')).toBe('hola ?');
  });
});

describe('toPdfSafe contra pdf-lib', () => {
  // El test que hace que los de arriba signifiquen algo: que una función diga que sanea no
  // sirve si nadie comprobó qué acepta el que dibuja.
  async function dibujar(texto: string): Promise<void> {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([300, 300]).drawText(texto, { x: 10, y: 150, size: 10, font });
  }

  it('pdf-lib dibuja todo lo que la función deja pasar', async () => {
    const duro = '¿Qué año? “hola” —y… «así» 中文 🙂 5′';
    await expect(dibujar(toPdfSafe(duro))).resolves.toBeUndefined();
  });

  it('CONTROL: sin sanear, pdf-lib tira', async () => {
    // Sin esto, «no rompe» no distinguiría una función que sanea de una que no hace nada.
    await expect(dibujar('中文')).rejects.toThrow(/WinAnsi cannot encode/);
  });

  it('CONTROL: y lo que se decidió no tocar, pdf-lib lo acepta tal cual', async () => {
    // La otra mitad: comprueba que la decisión de no reemplazar las comillas es correcta y
    // no una omisión con suerte.
    await expect(dibujar('dijo “hola” —y se fue…')).resolves.toBeUndefined();
  });
});
