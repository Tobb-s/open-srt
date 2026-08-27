import { describe, expect, it } from 'vitest';
import { CANTIDAD_COLORES, colorDeHablante, ordenDeAparicion } from './colores';

describe('colorDeHablante', () => {
  it('da colores distintos a hablantes distintos', () => {
    const usados = new Set<string>();
    for (let i = 0; i < CANTIDAD_COLORES; i++) usados.add(colorDeHablante(i).barra);
    expect(usados.size).toBe(CANTIDAD_COLORES);
  });

  it('con más hablantes que colores, repite en vez de romperse', () => {
    // Repetir es mejor que generar tonos calculados: algunos salen ilegibles. El nombre va
    // escrito al lado, así que sigue distinguiéndolos.
    expect(colorDeHablante(CANTIDAD_COLORES)).toEqual(colorDeHablante(0));
    expect(colorDeHablante(CANTIDAD_COLORES * 3 + 2)).toEqual(colorDeHablante(2));
  });

  it('aguanta una posición negativa', () => {
    // No debería pasar, pero un `indexOf` que no encuentra devuelve -1 y con el módulo de
    // JavaScript eso daría un índice negativo y `undefined` sin avisar.
    expect(colorDeHablante(-1)).toEqual(colorDeHablante(CANTIDAD_COLORES - 1));
  });

  it('todos los colores traen su versión oscura', () => {
    // Sin eso, el nombre desaparece contra el fondo en modo oscuro.
    for (let i = 0; i < CANTIDAD_COLORES; i++) {
      const c = colorDeHablante(i);
      expect(c.texto).toContain('dark:');
      expect(c.fondo).toContain('dark:');
    }
  });
});

describe('ordenDeAparicion', () => {
  it('ordena por primera aparición, no alfabéticamente', () => {
    // En una entrevista, quien pregunta habla primero: que le toque siempre el primer color
    // hace que la pantalla se lea igual entre archivos.
    expect(ordenDeAparicion(['Zoe', 'Ana', 'Zoe', 'Bruno'])).toEqual(['Zoe', 'Ana', 'Bruno']);
  });

  it('ignora los tramos sin hablante', () => {
    expect(ordenDeAparicion(['A', undefined, 'B', undefined, 'A'])).toEqual(['A', 'B']);
  });

  it('sin hablantes devuelve una lista vacía', () => {
    expect(ordenDeAparicion([undefined, undefined])).toEqual([]);
    expect(ordenDeAparicion([])).toEqual([]);
  });

  it('dos tramos renombrados igual son un solo hablante', () => {
    // Es la forma de unir un hablante que el modelo partió en dos: renombrarlos igual. Si
    // acá salieran como dos, tendrían colores distintos y el arreglo no se vería.
    expect(ordenDeAparicion(['Ana', 'Bruno', 'Ana'])).toEqual(['Ana', 'Bruno']);
  });
});
