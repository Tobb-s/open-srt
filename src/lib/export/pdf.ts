import { paginate, wrapByMeasure, type DocModel } from './document';

/**
 * El PDF.
 *
 * ── Lo que hay que hacer a mano ──
 *
 * pdf-lib dibuja texto en coordenadas: no sabe qué es una línea, ni una página, ni un
 * margen. Partir el texto, decidir cuántos renglones entran y cuándo abrir página siguiente
 * es todo trabajo propio, y por eso vive en `document.ts` —`wrapByMeasure` y `paginate`—
 * donde se puede probar con números en vez de con un PDF.
 *
 * ── Qué pueden dibujar las fuentes estándar, medido ──
 *
 * Las catorce fuentes estándar usan **WinAnsi**, y la primera versión de este módulo asumía
 * que eso dejaba afuera las comillas tipográficas y el guion largo. **Es falso**, comprobado
 * contra pdf-lib:
 *
 * | texto | resultado |
 * |---|---|
 * | `¿Qué año? ¡Sí! pingüino` | dibuja |
 * | `dijo “hola”` · `texto —cortado—` · `y entonces…` · `«así»` | dibuja |
 * | `中文` | `WinAnsi cannot encode "中" (0x4e2d)` |
 * | emoji | `WinAnsi cannot encode` |
 *
 * WinAnsi cubre latin-1 **más** el bloque 0x80–0x9F, que es justamente donde viven ‘ ’ “ ” –
 * — …. Reemplazarlos habría empeorado el PDF frente al DOCX sin ninguna razón.
 *
 * Lo que sí falla es todo lo demás, y falla **tirando una excepción**: sin sanear, una
 * transcripción con un emoji no genera PDF y el usuario ve un error sin explicación. Por eso
 * se sanea sólo lo que de verdad no entra.
 */

/** Lo que WinAnsi agrega sobre latin-1, en el bloque 0x80–0x9F. */
const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/**
 * Los pocos signos fuera de WinAnsi que tienen un equivalente obvio.
 *
 * Para el resto no hay sustituto sensato —un ideograma no se «aproxima»— y va a un signo de
 * interrogación: una pérdida visible es mejor que una silenciosa, y mucho mejor que un error.
 */
const SUSTITUTOS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[′‵]/g, "'"],
  [/[″‶]/g, '"'],
  [/[→⟶]/g, '->'],
  [/−/g, '-'], // signo menos, distinto del guion
  [/[  ]/g, ' '], // espacios finos y estrechos
];

function encodable(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  if (c >= 0x20 && c <= 0x7e) return true; // ASCII imprimible
  if (c >= 0xa0 && c <= 0xff) return true; // latin-1 alto: acentos, ñ, ¿, ¡
  return WINANSI_EXTRA.has(ch);
}

/**
 * Deja el texto en lo que las fuentes estándar saben dibujar.
 *
 * Exportada para poder probarla, y probada **contra pdf-lib**: que una función diga que
 * sanea no sirve si nadie comprobó qué acepta el que dibuja.
 */
export function toPdfSafe(text: string): string {
  let s = text;
  for (const [re, rep] of SUSTITUTOS) s = s.replace(re, rep);
  // Se recorre por punto de código: un emoji son dos unidades UTF-16 y hay que tratarlo
  // como uno solo, si no queda medio carácter suelto.
  return [...s].map((ch) => (encodable(ch) ? ch : '?')).join('');
}

const A4 = { ancho: 595.28, alto: 841.89 };
const MARGEN = 56; // ~2 cm
const TAM_TEXTO = 10.5;
const TAM_HORA = 8;
const INTERLINEA = 14;
const ESPACIO_ENTRE_TRAMOS = 6;
const ANCHO_COLUMNA_HORA = 52;
const ESPACIO_ENTRE_HABLANTES = 6;
const ALTO_ENCABEZADO = 64;

/**
 * Devuelve un `Blob`, igual que el exportador de DOCX.
 *
 * Los `Uint8Array` que devuelve pdf-lib van sobre un `ArrayBufferLike`, que TypeScript no
 * acepta como parte de un `Blob` —podría ser un `SharedArrayBuffer`—. Se copia a uno propio:
 * son unos cientos de kilobytes y la simetría con `toDocxBlob` vale más que ahorrarlos.
 */
/** Recorta un texto para que entre en un ancho, agregando puntos suspensivos. */
function recortarA(
  texto: string,
  ancho: number,
  font: { widthOfTextAtSize(s: string, size: number): number },
  size = 8.5,
): string {
  if (font.widthOfTextAtSize(texto, size) <= ancho) return texto;
  let corto = texto;
  while (corto.length > 1 && font.widthOfTextAtSize(corto + '...', size) > ancho) {
    corto = corto.slice(0, -1);
  }
  return corto + '...';
}

export async function toPdfBlob(model: DocModel): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');

  const pdf = await PDFDocument.create();
  const texto = await pdf.embedFont(StandardFonts.Helvetica);
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);

  const anchoTexto = A4.ancho - MARGEN * 2 - ANCHO_COLUMNA_HORA;
  const medir = (s: string) => texto.widthOfTextAtSize(s, TAM_TEXTO);

  // Primero se parte todo, después se pagina: la altura de un tramo depende de en cuántas
  // líneas quedó, así que no se puede paginar antes de saberlo.
  const tramos = model.rows.map((r) => ({
    time: toPdfSafe(r.time),
    // El nombre se recorta al ancho de su columna: uno largo invadiria el texto y quedarian
    // dos cosas encimadas, que es peor que un nombre cortado.
    speaker: r.speaker ? recortarA(toPdfSafe(r.speaker), ANCHO_COLUMNA_HORA - 4, negrita) : undefined,
    lineas: wrapByMeasure(toPdfSafe(r.text), anchoTexto, medir),
  }));
  // Un tramo que estrena hablante lleva un respiro extra arriba: sin eso, el cambio de
  // persona no se ve al hojear.
  const alturas = tramos.map(
    (t) =>
      t.lineas.length * INTERLINEA +
      ESPACIO_ENTRE_TRAMOS +
      (t.speaker ? ESPACIO_ENTRE_HABLANTES : 0),
  );

  // La primera lleva encabezado y por eso tiene menos lugar; las demás usan la página entera.
  const paginas = paginate(
    alturas,
    A4.alto - MARGEN * 2,
    A4.alto - MARGEN * 2 - ALTO_ENCABEZADO,
  );

  for (const [nPagina, indices] of paginas.entries()) {
    const page = pdf.addPage([A4.ancho, A4.alto]);
    let y = A4.alto - MARGEN;

    // El encabezado va sólo en la primera: repetirlo gastaría el espacio útil de todas. El
    // hueco se reserva en todas igual, así que un tramo nunca queda sin lugar.
    if (nPagina === 0) {
      page.drawText(toPdfSafe(model.title), { x: MARGEN, y: y - 16, size: 16, font: negrita });
      page.drawText(toPdfSafe(model.subtitle), {
        x: MARGEN,
        y: y - 34,
        size: 9,
        font: texto,
        color: rgb(0.4, 0.4, 0.4),
      });
      y -= ALTO_ENCABEZADO;
    }

    for (const i of indices) {
      const t = tramos[i];
      if (t.speaker) {
        y -= ESPACIO_ENTRE_HABLANTES;
        page.drawText(t.speaker, {
          x: MARGEN,
          y: y - TAM_TEXTO,
          size: TAM_HORA + 0.5,
          font: negrita,
        });
        y -= INTERLINEA;
      }
      // La hora se alinea con la **primera** línea del tramo, no con el bloque entero: así
      // las horas forman una guía vertical que el ojo puede recorrer.
      page.drawText(t.time, {
        x: MARGEN,
        y: y - TAM_TEXTO,
        size: TAM_HORA,
        font: mono,
        color: rgb(0.45, 0.45, 0.45),
      });
      for (const linea of t.lineas) {
        page.drawText(linea, {
          x: MARGEN + ANCHO_COLUMNA_HORA,
          y: y - TAM_TEXTO,
          size: TAM_TEXTO,
          font: texto,
        });
        y -= INTERLINEA;
      }
      y -= ESPACIO_ENTRE_TRAMOS;
    }

    // Con varias páginas hay que poder saber si falta una.
    if (paginas.length > 1) {
      const etiqueta = `${nPagina + 1} / ${paginas.length}`;
      page.drawText(etiqueta, {
        x: (A4.ancho - texto.widthOfTextAtSize(etiqueta, 8)) / 2,
        y: MARGEN / 2,
        size: 8,
        font: texto,
        color: rgb(0.5, 0.5, 0.5),
      });
    }
  }

  const bytes = await pdf.save();
  return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
}
