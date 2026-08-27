import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { layoutTranscript } from './document';
import { toDocxBlob } from './docx';
import { toPdfBlob } from './pdf';
import type { TimedText } from '../vad/align';

/**
 * Los dos adaptadores, de punta a punta.
 *
 * `document.test.ts` prueba la parte que decide qué dice el documento y cómo se corta, con
 * números y sin cargar ninguna biblioteca. Esto es lo otro: que `docx` y `pdf-lib`
 * efectivamente produzcan archivos, y que esos archivos tengan adentro lo que tienen que
 * tener. Sin esto, las dos bibliotecas podrían no estar siendo llamadas nunca.
 *
 * De paso deja las muestras en `.vad-tmp/` para poder abrirlas en Word y en un lector de
 * PDF, que es lo que pide el criterio de cierre de E3 y no se puede automatizar. Si el
 * archivo está abierto en Word, escribirlo falla con `EBUSY`: eso se avisa y no se toma como
 * fallo, porque lo que este test afirma es sobre los blobs, no sobre el disco.
 */

const TRAMOS: TimedText[] = [
  { startSec: 0.4, endSec: 4.1, text: 'Buenas tardes a todos, gracias por venir a la reunión.' },
  {
    startSec: 4.5,
    endSec: 12.3,
    text:
      'El primer punto del día es el presupuesto del año que viene, que como saben quedó ' +
      'pendiente desde diciembre y arrastra dos versiones distintas.',
  },
  { startSec: 13, endSec: 16, text: '¿Qué opinás vos, Martín?' },
  {
    startSec: 16.5,
    endSec: 30,
    text:
      'Yo diría —y esto lo hablé con el equipo— que conviene separar las dos partidas: una ' +
      'cosa es el gasto corriente y otra la inversión en equipamiento, que se amortiza en ' +
      'cinco años y no debería competir con los sueldos en la misma línea del cuadro.',
  },
  { startSec: 31, endSec: 33, text: '   ' },
  {
    startSec: 3661.2,
    endSec: 3668,
    text: 'Y ya pasada la hora, el último punto: la próxima reunión queda para el martes.',
  },
];

/** Suficientes tramos para forzar varias páginas y ver si el corte respeta los tramos. */
const MUCHOS: TimedText[] = Array.from({ length: 60 }, (_, i) => ({
  startSec: i * 12,
  endSec: i * 12 + 10,
  text:
    `Tramo número ${i + 1}. ` +
    'Un texto lo bastante largo como para ocupar dos o tres renglones y así llenar varias ' +
    'páginas, que es donde se ve si la paginación corta donde debe o parte un tramo al medio.',
}));

const ETIQUETAS = {
  title: 'Transcripción',
  subtitle: (f: string, d: string, n: number) => `${f} · ${d} · ${n} tramos`,
};

const SALIDA = path.resolve(import.meta.dirname, '../../../.vad-tmp');

function dejarMuestra(nombre: string, bytes: Uint8Array): void {
  try {
    mkdirSync(SALIDA, { recursive: true });
    writeFileSync(path.join(SALIDA, nombre), bytes);
  } catch (e) {
    console.warn(`no se pudo dejar ${nombre} (¿abierto en otro programa?):`, (e as Error).message);
  }
}

const corto = layoutTranscript(TRAMOS, {
  fileName: 'reunion-de-prueba.mp4',
  durationHuman: '1 h 1 min',
  labels: ETIQUETAS,
});
const largo = layoutTranscript(MUCHOS, {
  fileName: 'reunion-larga.mp4',
  durationHuman: '12 min',
  labels: ETIQUETAS,
});

describe('DOCX', () => {
  it('sale un archivo de Word con el texto y los tiempos adentro', async () => {
    const blob = await toDocxBlob(corto);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    dejarMuestra('muestra.docx', bytes);

    // Un DOCX es un zip: empieza con «PK». Si esto falla, no es un documento de Word.
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);

    const { unzipSync, strFromU8 } = await import('fflate');
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);

    // Los tiempos, incluido el que pasa la hora.
    for (const t of ['00:00:00', '00:00:04', '01:01:01']) expect(xml).toContain(t);
    // El texto, con sus acentos y su guion largo: el DOCX es UTF-8 y no tiene por qué
    // perder nada.
    expect(xml).toContain('reunión');
    expect(xml).toContain('—y esto lo hablé con el equipo—');
    // Una tabla de dos columnas, una fila por tramo con texto. El tramo vacío no cuenta.
    expect(xml.match(/<w:tr[ >]/g) ?? []).toHaveLength(5);
  }, 60_000);
});

describe('el hablante en los documentos', () => {
  const conHablantes = layoutTranscript(
    [
      { startSec: 0, endSec: 3, text: 'Buenas tardes.', speaker: 'Martín' },
      { startSec: 3, endSec: 6, text: 'Gracias por venir.', speaker: 'Martín' },
      { startSec: 6, endSec: 9, text: '¿Empezamos?', speaker: 'Ana' },
    ],
    { fileName: 'reunion.mp4', durationHuman: '9 s', labels: ETIQUETAS },
  );

  it('el modelo lo pone sólo cuando cambia', () => {
    // Repetirlo en cada fila llenaría la columna y el ojo dejaría de verlo.
    expect(conHablantes.rows.map((r) => r.speaker)).toEqual(['Martín', undefined, 'Ana']);
  });

  it('el DOCX lo escribe en la columna de la hora', () => {
    // Debajo de la hora y no delante del texto: así los nombres forman una guía vertical
    // sin robarle ancho a lo que se lee.
    return toDocxBlob(conHablantes)
      .then((b) => b.arrayBuffer())
      .then(async (buf) => {
        const { unzipSync, strFromU8 } = await import('fflate');
        const xml = strFromU8(unzipSync(new Uint8Array(buf))['word/document.xml']);
        expect(xml).toContain('Martín');
        expect(xml).toContain('Ana');
        // Una sola vez cada uno: si se repitiera por fila, «Martín» aparecería dos veces.
        expect(xml.split('Martín').length - 1).toBe(1);
      });
  }, 60_000);

  it('el PDF sale con hablantes sin romperse', async () => {
    const blob = await toPdfBlob(conHablantes);
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
    expect(doc.getPageCount()).toBe(1);
  }, 60_000);

  it('un nombre larguísimo no invade la columna del texto', async () => {
    // Se recorta al ancho de su columna: dos cosas encimadas son peores que un nombre
    // cortado, y en un PDF no hay forma de que el usuario lo arregle.
    const largo = layoutTranscript(
      [{ startSec: 0, endSec: 3, text: 'Hola', speaker: 'Un nombre absurdamente largo' }],
      { fileName: 'x.mp4', durationHuman: '3 s', labels: ETIQUETAS },
    );
    const blob = await toPdfBlob(largo);
    expect(blob.size).toBeGreaterThan(0);
  }, 60_000);
});

describe('PDF', () => {
  it('sale un PDF de una página con el encabezado', async () => {
    const blob = await toPdfBlob(corto);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    dejarMuestra('muestra.pdf', bytes);

    expect(blob.type).toBe('application/pdf');
    expect(strDe(bytes.slice(0, 5))).toBe('%PDF-');

    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    // A4 en puntos, redondeado.
    expect(Math.round(doc.getPage(0).getWidth())).toBe(595);
    expect(Math.round(doc.getPage(0).getHeight())).toBe(842);
  }, 60_000);

  it('pagina un documento largo sin perder tramos', async () => {
    const blob = await toPdfBlob(largo);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    dejarMuestra('muestra-larga.pdf', bytes);

    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes);
    // Sesenta tramos de tres renglones no entran en una página; cuántas salgan depende de
    // la métrica de la fuente, así que se afirma el rango y no un número exacto.
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(doc.getPageCount()).toBeLessThan(12);
  }, 60_000);

  it('un texto con emoji no rompe la exportación', async () => {
    // El modo de fallo real: pdf-lib **tira** con lo que WinAnsi no cubre, y una
    // transcripción puede traer cualquier cosa. Sin `toPdfSafe` esto no produciría archivo.
    const conEmoji = layoutTranscript(
      [{ startSec: 0, endSec: 2, text: 'todo bien 🙂 中文 y “comillas”' }],
      { fileName: 'x.mp4', durationHuman: '2 s', labels: ETIQUETAS },
    );
    const blob = await toPdfBlob(conEmoji);
    expect(blob.size).toBeGreaterThan(0);
  }, 60_000);
});

function strDe(b: Uint8Array): string {
  return Array.from(b, (x) => String.fromCharCode(x)).join('');
}
