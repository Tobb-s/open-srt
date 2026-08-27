/**
 * Agrupar embeddings de hablante.
 *
 * ── Por qué aglomerativo y no k-medias ──
 *
 * k-medias exige saber cuántos hablantes hay. En una reunión no se sabe: es justamente parte
 * de lo que hay que averiguar. El aglomerativo empieza con cada tramo en su propio grupo y va
 * uniendo los dos más parecidos hasta que el parecido baja de un umbral — así el número de
 * hablantes **sale** del audio en vez de pedírselo al usuario.
 *
 * ── Enlace promedio ──
 *
 * La distancia entre dos grupos es el promedio de las distancias entre sus miembros. El
 * enlace simple —la distancia mínima— encadena: basta un tramo ambiguo para pegar dos
 * hablantes distintos. El completo —la máxima— parte a la misma persona en dos si un tramo
 * suyo salió raro. El promedio es el que usan las tuberías de diarización, y por eso.
 */

export interface Cluster {
  /** Índices de los elementos que quedaron juntos. */
  members: number[];
}

/** Coseno entre dos vectores. 1 es idéntico, 0 es ortogonal. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let p = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    p += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : p / d;
}

/**
 * Agrupa por enlace promedio, cortando cuando el mejor parecido cae por debajo del umbral.
 *
 * `maxClusters` no es un tope caprichoso: si el umbral quedó mal puesto, sin él esto devuelve
 * un grupo por tramo y el resultado parece plausible —cada tramo con su hablante— cuando en
 * realidad no agrupó nada.
 */
export function agglomerative(
  embeddings: readonly Float32Array[],
  opts: { threshold: number; maxClusters?: number } = { threshold: 0.5 },
): Cluster[] {
  const n = embeddings.length;
  if (n === 0) return [];
  if (n === 1) return [{ members: [0] }];

  let grupos: number[][] = embeddings.map((_, i) => [i]);

  // Similitud entre elementos, calculada una vez.
  const sim: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      sim[i][j] = sim[j][i] = cosine(embeddings[i], embeddings[j]);
    }
  }

  const entreGrupos = (a: number[], b: number[]): number => {
    let acc = 0;
    for (const i of a) for (const j of b) acc += sim[i][j];
    return acc / (a.length * b.length);
  };

  const tope = opts.maxClusters ?? n;
  for (;;) {
    if (grupos.length <= 1) break;

    let mejorI = -1;
    let mejorJ = -1;
    let mejor = -Infinity;
    for (let i = 0; i < grupos.length; i++) {
      for (let j = i + 1; j < grupos.length; j++) {
        const s = entreGrupos(grupos[i], grupos[j]);
        if (s > mejor) {
          mejor = s;
          mejorI = i;
          mejorJ = j;
        }
      }
    }

    // Se sigue uniendo mientras el parecido lo justifique, o mientras haya más grupos de los
    // que se aceptan.
    const debeUnir = mejor >= opts.threshold || grupos.length > tope;
    if (!debeUnir) break;

    const unido = [...grupos[mejorI], ...grupos[mejorJ]];
    grupos = grupos.filter((_, k) => k !== mejorI && k !== mejorJ);
    grupos.push(unido);
  }

  // Orden estable: por el primer elemento de cada grupo, para que dos corridas den lo mismo.
  return grupos
    .map((members) => ({ members: [...members].sort((a, b) => a - b) }))
    .sort((a, b) => a.members[0] - b.members[0]);
}

/** De grupos a una etiqueta por elemento: `0`, `1`, `2`… en orden de aparición. */
export function labelsOf(clusters: readonly Cluster[], n: number): string[] {
  const out = new Array<string>(n).fill('');
  for (const [k, c] of clusters.entries()) {
    for (const i of c.members) out[i] = String(k);
  }
  return out;
}
