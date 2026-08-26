import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { toSegments, toBlocks, WINDOW_SAMPLES, type Segment } from './segments';
import { readWav } from '../../../scripts/lib/wav.mjs';

/**
 * ¿Se corren los tiempos a lo largo de un archivo largo?
 *
 * ── El riesgo que se está midiendo ──
 *
 * Un desfase de subtítulos que crece con el archivo es el error clásico de esta parte, y es
 * de los peores porque no se nota al principio: los primeros minutos salen bien y a la
 * media hora el texto va tres segundos adelantado. Cualquier redondeo por ventana que se
 * acumule —contar ventanas en vez de muestras, sumar duraciones en vez de posiciones—
 * produce exactamente eso.
 *
 * ── Contra qué se compara ──
 *
 * Contra la posición en la que cada frase fue **colocada**, que `scripts/build-drift-audio.mjs`
 * conoce porque la eligió él. No contra otra medición: comparar el detector con el detector
 * no probaría nada.
 *
 * ── Qué se afirma y qué no ──
 *
 * No se afirma que el detector acierte el borde exacto de cada frase: un detector de voz
 * siempre entra un poco tarde y sale un poco temprano, y eso es un **sesgo constante**. Lo
 * que se afirma es que ese error **no crece** con el tiempo. Por eso el test mide la
 * pendiente del error, no su tamaño.
 */

const ROOT = path.resolve(import.meta.dirname, '../../..');
const MODELO = path.join(ROOT, '.vad-tmp/silero_vad.onnx');
const AUDIO = path.join(ROOT, '.vad-tmp/drift-30min.wav');
const VERDAD = path.join(ROOT, '.vad-tmp/drift-30min.json');
const disponible = existsSync(MODELO) && existsSync(AUDIO) && existsSync(VERDAD);

interface Clip {
  index: number;
  file: string;
  startSec: number;
  endSec: number;
}

/** Pendiente de la recta de mínimos cuadrados: cuánto crece `y` por cada segundo de `x`. */
function pendiente(x: number[], y: number[]): number {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    den += (x[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function mediana(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function promedio(v: number[]): number {
  return v.reduce((a, b) => a + b, 0) / v.length;
}

let segmentos: Segment[] = [];
let clips: Clip[] = [];
let durationSec = 0;

beforeAll(async () => {
  if (!disponible) return;
  const verdad = JSON.parse(readFileSync(VERDAD, 'utf8'));
  clips = verdad.clips;
  durationSec = verdad.durationSec;

  const { samples, sampleRate } = readWav(readFileSync(AUDIO));
  const ort = (await import('onnxruntime-node')).default;
  const sess = await ort.InferenceSession.create(MODELO);
  let state = new ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
  const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(sampleRate)]), []);
  const probs: number[] = [];
  for (let i = 0; i + WINDOW_SAMPLES <= samples.length; i += WINDOW_SAMPLES) {
    const r = await sess.run({
      input: new ort.Tensor('float32', samples.slice(i, i + WINDOW_SAMPLES), [1, WINDOW_SAMPLES]),
      state,
      sr,
    });
    probs.push(r.output.data[0] as number);
    state = r.stateN as typeof state;
  }
  segmentos = toSegments(probs, durationSec);
}, 1_800_000);

/** Empareja cada frase colocada con el tramo detectado que más se le superpone. */
function emparejar(segs: readonly Segment[]) {
  const pares: Array<{ clip: Clip; seg: Segment; error: number }> = [];
  for (const c of clips) {
    let mejor: Segment | null = null;
    let mejorSolape = 0;
    for (const s of segs) {
      const solape = Math.min(c.endSec, s.endSec) - Math.max(c.startSec, s.startSec);
      if (solape > mejorSolape) {
        mejorSolape = solape;
        mejor = s;
      }
    }
    // Sin al menos medio segundo en común no hay correspondencia que valga.
    if (mejor && mejorSolape > 0.5) {
      pares.push({ clip: c, seg: mejor, error: mejor.startSec - c.startSec });
    }
  }
  return pares;
}

describe.skipIf(!disponible)('los tiempos no se corren en 30 minutos', () => {
  it('encuentra casi todas las frases colocadas', async () => {
    // La mitad del test que evita el falso aprobado: si el detector encontrara tres frases,
    // el error de esas tres podría ser cero y el desfase quedaría sin medir.
    const pares = emparejar(segmentos);
    console.log(
      `${clips.length} frases colocadas · ${segmentos.length} tramos detectados · ` +
        `${pares.length} emparejadas · ${(durationSec / 60).toFixed(1)} min`,
    );
    expect(pares.length / clips.length).toBeGreaterThan(0.9);
  }, 1_800_000);

  it('el error no crece a lo largo del archivo', async () => {
    const pares = emparejar(segmentos);
    const x = pares.map((p) => p.clip.startSec);
    const err = pares.map((p) => p.error);

    const sesgo = mediana(err);
    const m = pendiente(x, err);
    const crecimiento = Math.abs(m) * durationSec;

    const tercio = Math.floor(pares.length / 3);
    const primeros = promedio(err.slice(0, tercio));
    const ultimos = promedio(err.slice(-tercio));

    console.log(
      `sesgo (mediana) ${sesgo.toFixed(3)} s · pendiente ${(m * 1000).toFixed(4)} ms/s · ` +
        `crecimiento en todo el archivo ${crecimiento.toFixed(3)} s`,
    );
    console.log(
      `primer tercio ${primeros.toFixed(3)} s · último tercio ${ultimos.toFixed(3)} s`,
    );

    // Un sesgo constante es esperable —el detector entra un poco tarde— y no rompe la
    // sincronía; lo que la rompe es que crezca.
    expect(Math.abs(sesgo)).toBeLessThan(0.5);
    expect(crecimiento, 'el error crece con el archivo: hay desfase acumulado').toBeLessThan(
      0.2,
    );
    expect(Math.abs(ultimos - primeros)).toBeLessThan(0.15);
  }, 1_800_000);

  it('CONTROL: la comprobación ve —y mide bien— un desfase inyectado', async () => {
    // Sin este control, «no hay desfase» podría significar «la comprobación no ve
    // desfases». Se estiran los tiempos un 0,02 %, que a lo largo de media hora son 0,36 s:
    // suficiente para que la comprobación tenga que sonar, chico para que cada tramo siga
    // superponiéndose con la frase que le corresponde.
    const FACTOR = 1.0002;
    const esperado = (FACTOR - 1) * durationSec;

    const corridos = segmentos.map((s) => ({
      ...s,
      startSec: s.startSec * FACTOR,
      endSec: s.endSec * FACTOR,
    }));
    const pares = emparejar(corridos);
    const crecimiento =
      Math.abs(pendiente(pares.map((p) => p.clip.startSec), pares.map((p) => p.error))) *
      durationSec;

    console.log(
      `[control] inyectado ${esperado.toFixed(3)} s · medido ${crecimiento.toFixed(3)} s · ` +
        `${pares.length}/${clips.length} frases emparejadas`,
    );

    // Suena.
    expect(crecimiento, 'la comprobación no vio un desfase evidente').toBeGreaterThan(0.2);
    // Y además da el número correcto: un detector que dispara con cualquier cosa no serviría
    // para decir cuánto se corrió.
    expect(Math.abs(crecimiento - esperado)).toBeLessThan(esperado * 0.25);
    // El emparejamiento no se degradó, que es lo que permite comparar los dos casos.
    expect(pares.length / clips.length).toBeGreaterThan(0.9);
  }, 1_800_000);

  it('CONTROL del control: con un desfase grande la medición se queda corta', async () => {
    // Vale la pena dejarlo escrito porque limita lo que este test puede afirmar. Con un
    // desfase grande —1,8 s en media hora— los tramos del final dejan de superponerse con
    // la frase que les toca, así que se pierden del emparejamiento o se enganchan con la
    // vecina, y la pendiente medida sale **menor** que la real.
    //
    // Para lo que se usa acá —decidir si hay acumulación o no— alcanza: la comprobación
    // sigue sonando. Pero el número que devuelve es un piso, no una medida exacta.
    const corridos = segmentos.map((s) => ({
      ...s,
      startSec: s.startSec * 1.001,
      endSec: s.endSec * 1.001,
    }));
    const pares = emparejar(corridos);
    const crecimiento =
      Math.abs(pendiente(pares.map((p) => p.clip.startSec), pares.map((p) => p.error))) *
      durationSec;

    console.log(
      `[control²] inyectado 1.800 s · medido ${crecimiento.toFixed(3)} s · ` +
        `${pares.length}/${clips.length} frases emparejadas`,
    );
    expect(crecimiento).toBeGreaterThan(0.2);
    expect(crecimiento, 'con desfase grande la medición debería quedarse corta').toBeLessThan(1.8);
  }, 1_800_000);

  it('los bloques que se le mandan al modelo respetan los bordes detectados', async () => {
    // El otro lugar donde podría aparecer un corrimiento: al agrupar tramos en bloques
    // para el modelo. Los bordes tienen que ser bordes de tramo, no cortes calculados.
    const bloques = toBlocks(segmentos);
    expect(bloques.length).toBeGreaterThan(10);
    for (const b of bloques) {
      expect(segmentos.some((s) => s.startSec === b.startSec)).toBe(true);
      expect(segmentos.some((s) => s.endSec === b.endSec)).toBe(true);
    }
  }, 1_800_000);
});
