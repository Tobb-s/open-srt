import { describe, expect, it } from 'vitest';
import { empaquetar, nombreSeguro, nombresUnicos } from './paquete';
import type { TimedText } from '../vad/align';

/**
 * El paquete de «descargar todas».
 *
 * Lo que se cuida acá es el fallo que **no avisa**: bajar un zip con nueve archivos
 * creyendo que tiene diez, porque dos se llamaban igual y uno pisó al otro.
 */

const TRAMOS: TimedText[] = [
  { startSec: 0, endSec: 2, text: 'Hola' },
  { startSec: 2, endSec: 4.5, text: 'Qué tal' },
];

describe('nombreSeguro', () => {
  it('saca la extensión y lo que un sistema de archivos no acepta', () => {
    expect(nombreSeguro('reunión: equipo/ventas*.mp3')).toBe('reunión-equipo-ventas');
  });

  it('un nombre que queda vacío no produce un archivo sin nombre', () => {
    // `///.mp3` limpiado queda en nada, y `.txt` a secas es un archivo oculto en Unix.
    expect(nombreSeguro('///.mp3')).toBe('transcripcion');
    expect(nombreSeguro('   ')).toBe('transcripcion');
  });

  it('conserva los acentos y la ñ', () => {
    // Windows y macOS los aceptan; sacarlos volvería «grabación» → «grabacin».
    expect(nombreSeguro('año 2026 — reunión.wav')).toBe('año 2026 — reunión');
  });

  it('corta un nombre larguísimo antes de que el sistema lo rechace', () => {
    expect(nombreSeguro('x'.repeat(300)).length).toBeLessThanOrEqual(80);
  });
});

describe('nombresUnicos', () => {
  it('dos transcripciones con el mismo nombre no se pisan', () => {
    // El fallo silencioso que este módulo existe para evitar: sin esto el zip tendría UN
    // archivo donde el usuario espera dos, y nada fallaría.
    expect(nombresUnicos(['reunion.mp3', 'reunion.mp3', 'reunion.mp3'])).toEqual([
      'reunion',
      'reunion (2)',
      'reunion (3)',
    ]);
  });

  it('desambigua sin distinguir mayúsculas', () => {
    // En Windows y macOS `Reunion.txt` y `reunion.txt` son el MISMO archivo: dejarlos
    // distintos adentro del zip perdería uno al descomprimir.
    expect(nombresUnicos(['Reunion.mp3', 'reunion.mp3'])).toEqual(['Reunion', 'reunion (2)']);
  });

  it('nombres distintos quedan como están', () => {
    expect(nombresUnicos(['uno.mp3', 'dos.wav'])).toEqual(['uno', 'dos']);
  });

  it('dos que se limpian al mismo nombre también se desambiguan', () => {
    // «a/b.mp3» y «a:b.mp3» son distintos para el usuario y el mismo tras limpiar.
    expect(nombresUnicos(['a/b.mp3', 'a:b.mp3'])).toEqual(['a-b', 'a-b (2)']);
  });
});

describe('empaquetar', () => {
  it('mete un TXT y un SRT por transcripción, y se pueden volver a leer', async () => {
    const blob = await empaquetar([{ nombre: 'reunion.mp3', segments: TRAMOS }]);
    const { unzipSync, strFromU8 } = await import('fflate');
    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));

    expect(Object.keys(zip).sort()).toEqual(['reunion.srt', 'reunion.txt']);
    expect(strFromU8(zip['reunion.txt'])).toContain('Hola');
    // El SRT tiene que traer los tiempos: es lo que lo distingue del TXT.
    expect(strFromU8(zip['reunion.srt'])).toMatch(/00:00:0\d,\d{3} --> /);
  });

  it('con nombres repetidos entran TODOS los archivos', async () => {
    const blob = await empaquetar([
      { nombre: 'grabacion.m4a', segments: TRAMOS },
      { nombre: 'grabacion.m4a', segments: TRAMOS },
    ]);
    const { unzipSync } = await import('fflate');
    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(zip)).toHaveLength(4);
  });

  it('informa el avance, una por una', async () => {
    // Con diez reuniones de una hora esto tarda; un botón mudo parece colgado.
    const avisos: string[] = [];
    await empaquetar(
      [
        { nombre: 'a.mp3', segments: TRAMOS },
        { nombre: 'b.mp3', segments: TRAMOS },
      ],
      (h, t) => avisos.push(`${h}/${t}`),
    );
    expect(avisos).toEqual(['1/2', '2/2']);
  });

  it('una lista vacía da un zip vacío en vez de romper', async () => {
    const blob = await empaquetar([]);
    const { unzipSync } = await import('fflate');
    expect(Object.keys(unzipSync(new Uint8Array(await blob.arrayBuffer())))).toEqual([]);
  });
});
