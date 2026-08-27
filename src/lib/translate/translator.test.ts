import { describe, expect, it } from 'vitest';
import { Translator, PARES, parPara, DESCARGA_MB } from './translator';
import type { TimedText } from '../vad/align';

/**
 * La parte de la traducción que se puede probar sin bajar 235 MB.
 *
 * Lo que decide si el modelo sirve está medido aparte, en `opusmt.integration.test.ts`, y con
 * los modelos de verdad. Acá se prueba lo que rodea a esa llamada: que los tiempos sobrevivan,
 * que los tramos vacíos no lleguen al modelo, y que el par se elija bien.
 */

const TRAMOS: TimedText[] = [
  { startSec: 0, endSec: 2, text: 'Hola, ¿qué tal?', speaker: 'Ana' },
  { startSec: 2.5, endSec: 3, text: '   ' },
  { startSec: 3, endSec: 5, text: 'Todo bien.', speaker: 'Martín' },
];

/** Un traductor con el modelo reemplazado, para poder mirar qué se le pide. */
function conModeloFalso(respuesta = (t: string) => `[${t}]`) {
  const tr = new Translator();
  const pedidos: string[] = [];
  (tr as unknown as { pipe: unknown }).pipe = async (texto: string) => {
    pedidos.push(texto);
    return [{ translation_text: respuesta(texto) }];
  };
  return { tr, pedidos };
}

describe('parPara', () => {
  it('elige la dirección que corresponde', () => {
    expect(parPara('es', 'en')).toBe('es-en');
    expect(parPara('en', 'es')).toBe('en-es');
  });

  it('no traduce a su mismo idioma', () => {
    expect(parPara('es', 'es')).toBeNull();
    expect(parPara('en', 'en')).toBeNull();
  });

  it('sin idioma de origen no se inventa uno', () => {
    // Pasa cuando el usuario dejó «Detectar»: no se sabe de qué idioma viene, y elegir un par
    // al azar traduciría desde un idioma equivocado sin avisar.
    expect(parPara(undefined, 'en')).toBeNull();
  });

  it('un par que no existe devuelve null en vez de romper', () => {
    expect(parPara('fr', 'en')).toBeNull();
    expect(parPara('es', 'de')).toBeNull();
  });

  it('los pares declarados tienen modelo', () => {
    for (const [par, modelo] of Object.entries(PARES)) {
      expect(modelo).toMatch(/^onnx-community\//);
      expect(parPara(par.split('-')[0], par.split('-')[1])).toBe(par);
    }
  });

  it('el costo está declarado y es el medido', () => {
    // Se muestra antes de que el usuario acepte, como el de separar hablantes.
    expect(DESCARGA_MB).toBe(235);
  });
});

describe('translate', () => {
  it('conserva los tiempos y el hablante de cada tramo', async () => {
    // Es lo que hace que esto sirva para subtítulos: si los tiempos se movieran, el texto
    // traducido no correspondería con el audio y nadie lo notaría hasta reproducirlo.
    const { tr } = conModeloFalso();
    const out = await tr.translate(TRAMOS);
    expect(out.map((s) => [s.startSec, s.endSec])).toEqual(
      TRAMOS.map((s) => [s.startSec, s.endSec]),
    );
    expect(out.map((s) => s.speaker)).toEqual(['Ana', undefined, 'Martín']);
  });

  it('no le pide al modelo que traduzca un tramo vacío', async () => {
    // Pedirle que traduzca la nada es una invitación a que invente, y este modelo ya
    // demostró que inventa: «los más grandes éxitos» salió como «the biggest "Sterntos"».
    const { tr, pedidos } = conModeloFalso();
    const out = await tr.translate(TRAMOS);
    expect(pedidos).toEqual(['Hola, ¿qué tal?', 'Todo bien.']);
    expect(out[1].text).toBe('');
  });

  it('devuelve un tramo por cada uno de entrada, en orden', async () => {
    const { tr } = conModeloFalso();
    const out = await tr.translate(TRAMOS);
    expect(out).toHaveLength(TRAMOS.length);
    expect(out[0].text).toBe('[Hola, ¿qué tal?]');
    expect(out[2].text).toBe('[Todo bien.]');
  });

  it('informa el avance, tramo a tramo', async () => {
    const { tr } = conModeloFalso();
    const avisos: string[] = [];
    await tr.translate(TRAMOS, (p) => avisos.push(`${p.done}/${p.total}`));
    expect(avisos).toEqual(['1/3', '2/3', '3/3']);
  });

  it('sin modelo cargado falla en vez de devolver el original', async () => {
    // Devolver el texto sin traducir sería peor que fallar: el usuario creería que está
    // leyendo una traducción.
    await expect(new Translator().translate(TRAMOS)).rejects.toThrow(/no está cargado/);
  });

  it('no toca el arreglo de entrada', async () => {
    const { tr } = conModeloFalso();
    const copia = JSON.parse(JSON.stringify(TRAMOS));
    await tr.translate(TRAMOS);
    // El original tiene que quedar intacto: la interfaz muestra los dos, y si la traducción
    // lo pisara no habría con qué comparar.
    expect(TRAMOS).toEqual(copia);
  });
});
