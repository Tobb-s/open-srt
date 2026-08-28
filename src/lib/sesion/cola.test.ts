import { describe, expect, it } from 'vitest';
import { recorrerCola, listos, type ItemCola } from './cola';

/**
 * La cola, probada de verdad por primera vez.
 *
 * Hasta el paso 2 del rediseño este recorrido vivía dentro de `Transcribe.tsx` y **no
 * tenía un solo test**: la suite recolecta `src/**` en entorno `node` y los 88 mutantes
 * están todos en `src/lib`, así que la función más delicada de E5 no la miraba nadie.
 *
 * Lo que se prueba acá no es «recorrió»: es cada una de las tres decisiones que la cola
 * codifica, y sobre todo **que transcribe archivos distintos**. El error que esto atrapa
 * —una captura vieja que transcribe el primero diez veces— no lanza ninguna excepción:
 * devuelve diez transcripciones del mismo audio con diez nombres distintos.
 */

type Fake = { nombre: string };

function cola(...nombres: string[]): ItemCola<Fake>[] {
  return nombres.map((n) => ({
    key: `k:${n}`,
    name: n,
    blob: { nombre: n },
    estado: 'pendiente',
  }));
}

/** Un banco de pruebas que anota todo lo que la cola le pidió. */
function banco(opts: { fallan?: string[]; rompenAlPreparar?: string[] } = {}) {
  const items = { transcritos: [] as string[], preparados: [] as string[] };
  const marcas: Array<{ i: number; cambio: Partial<ItemCola<Fake>> }> = [];
  const retomados: Array<string | null> = [];

  return {
    items,
    marcas,
    retomados,
    deps: {
      preparar: async (b: Fake) => {
        if (opts.rompenAlPreparar?.includes(b.nombre)) throw new Error(`roto: ${b.nombre}`);
        items.preparados.push(b.nombre);
        return { nombre: b.nombre };
      },
      transcribir: async (p: Fake, retomar: string | null) => {
        items.transcritos.push(p.nombre);
        retomados.push(retomar);
        return !opts.fallan?.includes(p.nombre);
      },
      marcar: (i: number, cambio: Partial<ItemCola<Fake>>) => marcas.push({ i, cambio }),
    },
  };
}

/** El estado final de cada ítem, según las marcas que la cola fue dejando. */
function estados(marcas: Array<{ i: number; cambio: Partial<ItemCola<Fake>> }>, n: number) {
  const out: Array<string | undefined> = Array(n).fill(undefined);
  for (const m of marcas) if (m.cambio.estado) out[m.i] = m.cambio.estado;
  return out;
}

describe('recorrerCola', () => {
  it('transcribe CADA archivo, no el primero muchas veces', async () => {
    // El test central. Con una captura vieja del estado —el error que este diseño
    // esquiva pasando el archivo por argumento— esto daría ['a','a','a'] y NADA fallaría:
    // saldrían tres transcripciones del mismo audio bajo tres nombres distintos.
    const b = banco();
    await recorrerCola(cola('a', 'b', 'c'), { nombre: 'a' }, null, b.deps);
    expect(b.items.transcritos).toEqual(['a', 'b', 'c']);
  });

  it('no vuelve a decodificar el primero, que ya viene listo', async () => {
    // Decodificarlo de nuevo no rompe nada visible: cuesta el doble de tiempo y el doble
    // de memoria en el archivo más grande de la cola, justo lo que la cola evita.
    const b = banco();
    await recorrerCola(cola('a', 'b', 'c'), { nombre: 'a' }, null, b.deps);
    expect(b.items.preparados).toEqual(['b', 'c']);
  });

  it('decodifica de a uno, en el turno de cada archivo', async () => {
    // Media hora de audio son 115 MB: decodificar los cinco de entrada se comería medio
    // giga antes de transcribir nada. El orden prueba el entrelazado.
    const orden: string[] = [];
    const b = banco();
    await recorrerCola(cola('a', 'b', 'c'), { nombre: 'a' }, null, {
      ...b.deps,
      preparar: async (x: Fake) => {
        orden.push(`prep:${x.nombre}`);
        return { nombre: x.nombre };
      },
      transcribir: async (p: Fake) => {
        orden.push(`trans:${p.nombre}`);
        return true;
      },
    });
    expect(orden).toEqual(['trans:a', 'prep:b', 'trans:b', 'prep:c', 'trans:c']);
  });

  it('un archivo que falla no detiene la fila', async () => {
    // Perder los que faltan porque uno del medio está dañado sería lo peor que puede
    // hacer una cola. Comprobado en E5 con un WAV con basura adentro.
    const b = banco({ fallan: ['b'] });
    await recorrerCola(cola('a', 'b', 'c'), { nombre: 'a' }, null, b.deps);
    expect(b.items.transcritos).toEqual(['a', 'b', 'c']);
    expect(estados(b.marcas, 3)).toEqual(['listo', 'error', 'listo']);
  });

  it('uno que revienta al decodificar tampoco detiene la fila', async () => {
    // Distinto del anterior: acá la excepción sale de `preparar`, antes de transcribir.
    const b = banco({ rompenAlPreparar: ['b'] });
    await recorrerCola(cola('a', 'b', 'c'), { nombre: 'a' }, null, b.deps);
    expect(b.items.transcritos).toEqual(['a', 'c']);
    expect(estados(b.marcas, 3)).toEqual(['listo', 'error', 'listo']);
    expect(b.marcas.find((m) => m.cambio.error)?.cambio.error).toMatch(/roto: b/);
  });

  it('marca «procesando» antes de empezar cada uno', async () => {
    // Sin esto la fila se ve congelada mientras trabaja: el usuario no sabe cuál está en
    // curso. El orden importa — procesando ANTES de su resultado.
    const b = banco();
    await recorrerCola(cola('a', 'b'), { nombre: 'a' }, null, b.deps);
    expect(b.marcas.map((m) => `${m.i}:${m.cambio.estado}`)).toEqual([
      '0:procesando',
      '0:listo',
      '1:procesando',
      '1:listo',
    ]);
  });

  it('la corrida a retomar es SÓLO del primero', async () => {
    // La corrida guardada tiene los bloques de ESE archivo. Pasársela al segundo lo haría
    // arrancar desde bloques de otro audio: saldría una transcripción con los tiempos
    // corridos y no fallaría nada.
    const b = banco();
    await recorrerCola(cola('a', 'b', 'c'), { nombre: 'a' }, 'corrida-de-a', b.deps);
    expect(b.retomados).toEqual(['corrida-de-a', null, null]);
  });

  it('con un solo archivo no dibuja fila, pero transcribe igual', async () => {
    // Una lista de un elemento es ruido en pantalla; la interfaz sólo muestra la cola con
    // más de uno. Lo que NO puede pasar es que además no transcriba.
    const b = banco();
    await recorrerCola(cola('a'), { nombre: 'a' }, 'retomar-esto', b.deps);
    expect(b.items.transcritos).toEqual(['a']);
    expect(b.retomados).toEqual(['retomar-esto']);
    expect(b.marcas).toEqual([]);
  });

  it('con la lista vacía transcribe igual el archivo que le dieron', async () => {
    // Este test escribió primero lo contrario y falló, que es como se descubrió cuál es
    // el contrato de verdad: **`primero` manda sobre qué se transcribe, `items` sólo
    // sobre qué se dibuja**. Recibir un archivo decodificado y no transcribirlo porque la
    // lista de la pantalla está vacía sería tragarse el trabajo en silencio.
    //
    // En el producto no pasa —`onFiles` corta con cero archivos— pero la función ahora es
    // general y su contrato tiene que estar dicho. Es la conducta del código original,
    // conservada a propósito: el paso 2 no cambia comportamiento.
    const b = banco();
    await recorrerCola([], { nombre: 'a' }, null, b.deps);
    expect(b.items.transcritos).toEqual(['a']);
    expect(b.marcas).toEqual([]);
  });

  it('espera a que cada uno termine antes de arrancar el siguiente', async () => {
    // En serie y no en paralelo: hay un solo modelo y un solo procesador. Si arrancaran
    // solapados, `vivos` pasaría de 1 en algún momento.
    let vivos = 0;
    let maximo = 0;
    const b = banco();
    await recorrerCola(cola('a', 'b', 'c'), { nombre: 'a' }, null, {
      ...b.deps,
      transcribir: async () => {
        vivos++;
        maximo = Math.max(maximo, vivos);
        await new Promise((r) => setTimeout(r, 1));
        vivos--;
        return true;
      },
    });
    expect(maximo).toBe(1);
  });
});

describe('listos', () => {
  it('cuenta sólo los terminados bien', () => {
    // Es el número del encabezado «Cola: 2 de 3 listos». Contar los errores como listos
    // le diría al usuario que tiene tres transcripciones cuando tiene dos.
    const items = cola('a', 'b', 'c', 'd');
    items[0].estado = 'listo';
    items[1].estado = 'error';
    items[2].estado = 'listo';
    items[3].estado = 'procesando';
    expect(listos(items)).toBe(2);
  });

  it('sin ninguno terminado devuelve 0', () => {
    expect(listos(cola('a', 'b'))).toBe(0);
  });
});
