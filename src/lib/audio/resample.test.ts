import { describe, it, expect } from 'vitest';
import { readWav, writeWav, resample, rms, mixAtSnr, concat, silence } from '../../../scripts/lib/wav.mjs';

/**
 * Remuestreo a 16 kHz, probado con señales construidas.
 *
 * Es el único punto del proyecto donde se puede degradar el audio **en silencio**: un
 * remuestreo mal hecho no falla, sólo produce una señal peor, y eso baja el WER de todos
 * los modelos por igual sin que nada avise. El corpus entero de E0 pasó por acá.
 *
 * Por eso las pruebas no miran «que no explote» sino que verifican propiedades de la
 * señal: que lo que tiene que sobrevivir sobreviva, y que lo que tiene que desaparecer
 * desaparezca.
 */

const SR = 48000;
const TARGET = 16000;

/** Senoide de amplitud 1 y frecuencia dada. */
function tone(freqHz: number, seconds: number, sampleRate: number): Float32Array {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  return out;
}

/**
 * Energía en una frecuencia, por correlación con seno y coseno.
 *
 * Un DFT de un solo bin: alcanza para preguntar «¿cuánta señal hay en esta frecuencia?»
 * sin traer una FFT entera.
 */
function energyAt(x: Float32Array, freqHz: number, sampleRate: number): number {
  let re = 0;
  let im = 0;
  for (let i = 0; i < x.length; i++) {
    const w = (2 * Math.PI * freqHz * i) / sampleRate;
    re += x[i] * Math.cos(w);
    im += x[i] * Math.sin(w);
  }
  return Math.sqrt(re * re + im * im) / x.length;
}

describe('resample — lo que tiene que sobrevivir', () => {
  it('conserva una senoide de 1 kHz, que está en plena banda de voz', () => {
    const src = tone(1000, 0.5, SR);
    const out = resample(src, SR, TARGET);

    expect(out.length).toBe(Math.floor(src.length / 3));
    // La energía en 1 kHz tiene que seguir estando: es el rango donde vive el habla.
    expect(energyAt(out, 1000, TARGET)).toBeGreaterThan(0.4);
  });

  it('mantiene el nivel general', () => {
    const src = tone(440, 0.5, SR);
    const out = resample(src, SR, TARGET);
    // Una senoide tiene RMS ≈ 0,707. El filtro no debe comerse el nivel.
    expect(rms(out)).toBeGreaterThan(0.6);
    expect(rms(out)).toBeLessThan(0.75);
  });

  it('conserva 3 kHz, el borde alto de la inteligibilidad del habla', () => {
    const out = resample(tone(3000, 0.5, SR), SR, TARGET);
    expect(energyAt(out, 3000, TARGET)).toBeGreaterThan(0.35);
  });
});

describe('resample — lo que tiene que desaparecer', () => {
  it('ATENÚA lo que está por encima de la nueva Nyquist', () => {
    // Éste es el test que importa. A 16 kHz, Nyquist son 8 kHz: una senoide de 12 kHz no
    // se puede representar. Sin filtro previo NO desaparece — se repliega y aparece como
    // una frecuencia falsa de 4 kHz, en plena banda de voz, que el modelo transcribe como
    // algo. El aliasing no suena a «peor calidad», suena a algo que nunca se dijo.
    const src = tone(12000, 0.5, SR);
    const out = resample(src, SR, TARGET);

    // 48000 - 12000 = 36000; replegado en 16 kHz cae en 4 kHz.
    const aliasFrec = 4000;
    expect(energyAt(out, aliasFrec, TARGET)).toBeLessThan(0.02);
    expect(rms(out)).toBeLessThan(0.05);
  });

  it('atenúa 20 kHz, muy por encima de la banda útil', () => {
    const out = resample(tone(20000, 0.5, SR), SR, TARGET);
    expect(rms(out)).toBeLessThan(0.05);
  });

  it('control: sin el filtro el aliasing SÍ aparece', () => {
    // El control que hace válido el test anterior. Decimando a lo bruto —una de cada
    // tres muestras, sin filtrar— la senoide de 12 kHz reaparece con fuerza. Si este
    // control no mostrara aliasing, el test de arriba no probaría nada: un cero podría
    // ser «el filtro anda» o «la medición está rota».
    const src = tone(12000, 0.5, SR);
    const crudo = new Float32Array(Math.floor(src.length / 3));
    for (let i = 0; i < crudo.length; i++) crudo[i] = src[i * 3];

    expect(rms(crudo)).toBeGreaterThan(0.5);
    expect(energyAt(crudo, 4000, TARGET)).toBeGreaterThan(0.3);
  });
});

describe('resample — casos borde', () => {
  it('devuelve la misma señal si la tasa ya coincide', () => {
    const src = tone(1000, 0.1, TARGET);
    expect(resample(src, TARGET, TARGET)).toBe(src);
  });

  it('se niega a subir la tasa en vez de inventar banda', () => {
    // Subir de 8 a 16 kHz no agrega información: fingirlo escondería que el audio de
    // origen era peor de lo que el número dice.
    expect(() => resample(tone(1000, 0.1, 8000), 8000, TARGET)).toThrow(/inventar/);
  });
});

describe('WAV — ida y vuelta', () => {
  it('lo escrito se vuelve a leer igual', () => {
    const src = tone(440, 0.25, TARGET);
    const { samples, sampleRate, sourceChannels } = readWav(writeWav(src, TARGET));

    expect(sampleRate).toBe(TARGET);
    expect(sourceChannels).toBe(1);
    expect(samples.length).toBe(src.length);
    // 16 bits: el error de cuantización es de ~1/32768.
    for (let i = 0; i < src.length; i += 97) {
      expect(Math.abs(samples[i] - src[i])).toBeLessThan(0.001);
    }
  });

  it('recorta en vez de dar la vuelta', () => {
    // Un valor fuera de rango que envuelve suena como un chasquido, y el modelo lo
    // transcribe como una palabra que nadie dijo.
    const fuerte = new Float32Array([2, -2, 0.5]);
    const { samples } = readWav(writeWav(fuerte, TARGET));
    expect(samples[0]).toBeCloseTo(1, 2);
    expect(samples[1]).toBeCloseTo(-1, 2);
  });

  it('encuentra el chunk de datos aunque haya otros antes', () => {
    // Muchos WAV traen chunks LIST antes de `data`. Leer a offset fijo daría ruido.
    const base = writeWav(tone(440, 0.05, TARGET), TARGET);
    const extra = Buffer.alloc(20);
    extra.write('LIST', 0, 'ascii');
    extra.writeUInt32LE(12, 4);
    const conLista = Buffer.concat([base.subarray(0, 36), extra, base.subarray(36)]);
    conLista.writeUInt32LE(conLista.length - 8, 4); // corregir el tamaño RIFF

    const { samples, sampleRate } = readWav(conLista);
    expect(sampleRate).toBe(TARGET);
    expect(rms(samples)).toBeGreaterThan(0.5);
  });
});

describe('mezcla a SNR exacta', () => {
  it('la SNR resultante es la pedida, no una aproximación', () => {
    const señal = tone(1000, 0.5, TARGET);
    const ruido = tone(3000, 0.5, TARGET);
    const mezcla = mixAtSnr(señal, ruido, 10);

    // Con 10 dB, el ruido debe quedar ~3,16 veces más débil que la señal.
    const resto = new Float32Array(mezcla.length);
    for (let i = 0; i < mezcla.length; i++) resto[i] = mezcla[i] - señal[i];
    const snrReal = 20 * Math.log10(rms(señal) / rms(resto));
    expect(snrReal).toBeGreaterThan(9);
    expect(snrReal).toBeLessThan(11);
  });

  it('no satura al mezclar', () => {
    const mezcla = mixAtSnr(tone(1000, 0.2, TARGET), tone(2000, 0.2, TARGET), 0);
    for (let i = 0; i < mezcla.length; i++) expect(Math.abs(mezcla[i])).toBeLessThanOrEqual(1);
  });
});

describe('concat y silence', () => {
  it('concat preserva el largo total', () => {
    const a = tone(440, 0.1, TARGET);
    const b = silence(0.4, TARGET);
    expect(concat([a, b]).length).toBe(a.length + b.length);
  });

  it('silence es realmente silencio', () => {
    expect(rms(silence(0.5, TARGET))).toBe(0);
  });
});
