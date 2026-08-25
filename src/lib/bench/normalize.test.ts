import { describe, it, expect } from 'vitest';
import { normalize, normalizeToWords, wordsToDigits } from './normalize';

/**
 * Un test por regla de `docs/NORMALIZACION-WER.md`, más los dos controles del propio
 * normalizador. Si una regla del documento cambia, acá tiene que fallar algo.
 */

describe('regla 2 — minúsculas', () => {
  it('baja todo a minúsculas', () => {
    expect(normalize('Hola MUNDO Cruel', 'es')).toBe('hola mundo cruel');
  });
});

describe('regla 3 — contracciones del inglés', () => {
  it('expande las contracciones de la lista', () => {
    expect(normalize("I don't know", 'en')).toBe('i do not know');
    expect(normalize("we've been here", 'en')).toBe('we have been here');
    expect(normalize("can't stop", 'en')).toBe('cannot stop');
    expect(normalize("it's fine", 'en')).toBe('it is fine');
  });

  it('NO las expande en español, donde el apóstrofo no es una contracción verbal', () => {
    // Si alguna vez se aplicaran las reglas del inglés al español, esto lo delata.
    expect(normalize("rock'n'roll", 'es')).toBe('rocknroll');
  });
});

describe('regla 4 — puntuación', () => {
  it('elimina signos, incluidos ¿ y ¡ del español', () => {
    expect(normalize('¿Qué pasa, che?', 'es')).toBe('que pasa che');
    expect(normalize('¡Increíble!', 'es')).toBe('increible');
  });

  it('convierte el guión interno en espacio, no en nada', () => {
    // `ex-presidente` → `ex presidente`, dos palabras. Si se eliminara sin más
    // quedaría `expresidente`, una sola, y el conteo de palabras cambiaría.
    expect(normalize('ex-presidente', 'es')).toBe('ex presidente');
  });

  it('elimina comillas de todo tipo', () => {
    expect(normalize('dijo «hola» y "chau"', 'es')).toBe('dijo hola y chau');
  });
});

describe('regla 5 — diacríticos, preservando la ñ', () => {
  it('quita las tildes', () => {
    expect(normalize('está también café', 'es')).toBe('esta tambien cafe');
  });

  it('PRESERVA la ñ, porque año y ano son palabras distintas', () => {
    expect(normalize('el año pasado', 'es')).toBe('el año pasado');
    expect(normalize('mañana señor niño', 'es')).toBe('mañana señor niño');
  });

  it('reduce la diéresis, que sí es un diacrítico', () => {
    expect(normalize('pingüino vergüenza', 'es')).toBe('pinguino verguenza');
  });

  it('distingue año de ano tras normalizar', () => {
    // El control que hace valer la excepción de la ñ: si se fundieran, este test cae.
    expect(normalize('año', 'es')).not.toBe(normalize('ano', 'es'));
  });
});

describe('regla 6 — números en palabras a dígitos', () => {
  it('convierte unidades y decenas', () => {
    expect(normalize('tengo veinticinco años', 'es')).toBe('tengo 25 años');
    expect(normalize('i have twenty five', 'en')).toBe('i have 25');
  });

  it('resuelve el conector "y" dentro de un número', () => {
    expect(normalize('treinta y cuatro', 'es')).toBe('34');
    expect(normalize('noventa y nueve', 'es')).toBe('99');
  });

  it('NO se come la "y" cuando es conjunción de verdad', () => {
    // El caso que rompe un parser ingenuo: "y" entre dos no-números.
    expect(normalize('pan y agua', 'es')).toBe('pan y agua');
    expect(normalize('cinco y agua', 'es')).toBe('5 y agua');
  });

  it('NO une unidad + unidad, que no es un número compuesto en español', () => {
    // Encontrado por prueba de mutación: la versión anterior daba `11` acá, y
    // convertía "tengo cinco y seis manzanas" en "tengo 11 manzanas".
    // La conjunción une decena + unidad, no dos unidades sueltas.
    expect(normalize('cinco y seis', 'es')).toBe('5 y 6');
    expect(normalize('tengo cinco y seis manzanas', 'es')).toBe('tengo 5 y 6 manzanas');
    expect(normalize('dos y tres', 'es')).toBe('2 y 3');
  });

  it('sí une decena + unidad, incluso dentro de un número mayor', () => {
    expect(normalize('cincuenta y seis', 'es')).toBe('56');
    // El acumulado acá es 980; la decena a mirar es 80, no 980.
    expect(normalize('mil novecientos ochenta y cuatro', 'es')).toBe('1984');
    expect(normalize('doscientos treinta y cuatro', 'es')).toBe('234');
  });

  it('en inglés une centena + resto', () => {
    expect(normalize('three hundred and forty two', 'en')).toBe('342');
  });

  it('maneja centenas y miles', () => {
    expect(normalize('doscientos treinta', 'es')).toBe('230');
    expect(normalize('mil novecientos ochenta y cuatro', 'es')).toBe('1984');
    expect(normalize('two thousand', 'en')).toBe('2000');
    expect(normalize('three hundred forty two', 'en')).toBe('342');
  });

  it('acepta los acentos ya quitados por la regla 5', () => {
    // `veintidós` llega al conversor como `veintidos`; el diccionario va sin acentos.
    expect(normalize('veintidós', 'es')).toBe('22');
    expect(normalize('dieciséis', 'es')).toBe('16');
  });

  it('deja intacto lo que el conversor no cubre, sin romperse', () => {
    // Limitación declarada: ordinales y fracciones no se normalizan.
    expect(normalize('el primero de mayo', 'es')).toBe('el primero de mayo');
  });

  it('no toca palabras que no son números', () => {
    expect(wordsToDigits(['hola', 'mundo'])).toEqual(['hola', 'mundo']);
  });
});

describe('regla 7 — lo que NO se toca', () => {
  it('conserva las muletillas', () => {
    // Borrarlas sería una decisión arbitraria que puede maquillar resultados.
    expect(normalize('eh, bueno, este, mmm', 'es')).toBe('eh bueno este mmm');
  });

  it('conserva las repeticiones', () => {
    // Colapsarlas ocultaría el modo de fallo por alucinación, que es justo lo que
    // hay que poder ver.
    expect(normalize('hola hola hola', 'es')).toBe('hola hola hola');
  });
});

describe('controles del propio normalizador', () => {
  const CORPUS = [
    '¿Qué hacés, che? Son las veintidós y treinta.',
    "I don't think it's twenty five degrees—maybe thirty.",
    'El niño del año pasado comió ñoquis; ¡qué rico!',
    'mil novecientos ochenta y cuatro',
    'pan y agua, nada más',
    'Ex-presidente «Fulano» dijo: 25 años.',
  ];

  it('control 1 — es idempotente', () => {
    // Si normalizar dos veces difiere de normalizar una, hay reglas peleándose.
    for (const t of CORPUS) {
      for (const lang of ['es', 'en'] as const) {
        const once = normalize(t, lang);
        expect(normalize(once, lang)).toBe(once);
      }
    }
  });

  it('control 2 — no vacía un texto que tenía contenido', () => {
    // Un texto que quedara vacío daría un WER de 0 o infinito por un motivo falso.
    for (const t of CORPUS) {
      for (const lang of ['es', 'en'] as const) {
        expect(normalize(t, lang).length).toBeGreaterThan(0);
      }
    }
  });

  it('devuelve lista vacía para entrada vacía o de puro símbolo', () => {
    expect(normalizeToWords('', 'es')).toEqual([]);
    expect(normalizeToWords('   ', 'es')).toEqual([]);
    expect(normalizeToWords('¿¡...!?', 'es')).toEqual([]);
  });
});
