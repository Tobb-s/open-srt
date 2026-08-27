import type { DocModel } from './document';

/**
 * El documento de Word.
 *
 * ── Por qué es tan corto ──
 *
 * Word decide dónde cortar las líneas y dónde termina una página. Lo único que hay que
 * darle es la estructura —qué es título, qué es hora, qué es texto— y las medidas. Toda la
 * decisión de *qué dice* el documento está en `document.ts`, compartida con el PDF, para que
 * los dos archivos no se vayan separando sin que nadie lo note.
 *
 * ── La hora en una tabla y no delante del texto ──
 *
 * Poniendo `00:01:23  Lo que se dijo` en un párrafo, la segunda línea del texto arranca
 * pegada al margen y la hora se pierde en la mancha. En una tabla de dos columnas sin bordes,
 * el texto queda en su columna y las horas forman una guía vertical que se puede recorrer
 * con el ojo. Es la diferencia entre un volcado y un documento.
 *
 * ── La carga es diferida ──
 *
 * `docx` pesa cerca de un mega. Traerlo en el bundle principal se lo cobraría a todos los
 * usuarios —incluidos los que sólo quieren un `.srt`— por una función que usa una minoría.
 * Por eso el import está adentro de la función.
 */
export async function toDocxBlob(model: DocModel): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, HeadingLevel, AlignmentType } =
    await import('docx');

  const sinBordes = {
    top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  };

  const filas = model.rows.map(
    (r) =>
      new TableRow({
        children: [
          new TableCell({
            borders: sinBordes,
            width: { size: 15, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({
                children: [new TextRun({ text: r.time, font: 'Consolas', size: 18, color: '666666' })],
              }),
              // El nombre debajo de la hora, no delante del texto: asi los nombres forman
              // una guia vertical y no le roban ancho a lo que se lee.
              ...(r.speaker
                ? [
                    new Paragraph({
                      children: [new TextRun({ text: r.speaker, size: 18, bold: true })],
                    }),
                  ]
                : []),
            ],
          }),
          new TableCell({
            borders: sinBordes,
            width: { size: 85, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: [new TextRun({ text: r.text, size: 22 })] })],
          }),
        ],
      }),
  );

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: model.title, heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [new TextRun({ text: model.subtitle, size: 18, color: '666666' })],
          }),
          new Paragraph({ text: '' }),
          ...(filas.length
            ? [new Table({ rows: filas, width: { size: 100, type: WidthType.PERCENTAGE } })]
            : []),
        ],
      },
    ],
  });

  return Packer.toBlob(doc);
}
