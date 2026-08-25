/**
 * WAV PCM y remuestreo, sin dependencias.
 *
 * No hay ffmpeg en este equipo, así que el corpus se construye con lo que Node trae. Eso
 * además obliga a que cada paso quede escrito acá y sea auditable: el remuestreo es una
 * de las pocas cosas capaces de degradar el audio en silencio y arruinar todas las
 * mediciones de WER a la vez.
 */

/** Lee un WAV PCM entero y devuelve las muestras en Float32 [-1, 1). */
export function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('no es un WAV RIFF');
  }

  let pos = 12;
  let fmt = null;
  let data = null;

  // Recorrer los chunks en vez de asumir posiciones fijas: muchos WAV traen `LIST` u
  // otros chunks antes de `data`, y leer a offset fijo produce ruido blanco perfecto.
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;

    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = buf.subarray(body, Math.min(body + size, buf.length));
    }
    pos = body + size + (size % 2); // los chunks se alinean a par
  }

  if (!fmt || !data) throw new Error('WAV sin chunk fmt o data');
  if (fmt.audioFormat !== 1) throw new Error(`WAV no PCM (formato ${fmt.audioFormat})`);
  if (fmt.bitsPerSample !== 16) throw new Error(`sólo 16 bits (vino ${fmt.bitsPerSample})`);

  const total = Math.floor(data.length / 2);
  const frames = Math.floor(total / fmt.channels);
  const out = new Float32Array(frames);

  // Mezcla a mono promediando canales. Promediar y no sumar evita saturar.
  for (let f = 0; f < frames; f++) {
    let acc = 0;
    for (let c = 0; c < fmt.channels; c++) acc += data.readInt16LE((f * fmt.channels + c) * 2);
    out[f] = acc / fmt.channels / 32768;
  }

  return { samples: out, sampleRate: fmt.sampleRate, sourceChannels: fmt.channels };
}

/** Escribe WAV PCM 16 bits mono. */
export function writeWav(samples, sampleRate) {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);

  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < samples.length; i++) {
    // Recorte explícito: un valor fuera de rango daría la vuelta y sonaría como un
    // chasquido, que el modelo podría transcribir como una palabra inventada.
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }

  return buf;
}

/**
 * Filtro FIR pasa-bajos por ventana de Hamming.
 *
 * Es la mitad que importa del remuestreo. Decimar sin filtrar primero repliega todo lo
 * que hay por encima de la nueva frecuencia de Nyquist sobre la banda audible, y ese
 * aliasing no suena a "peor calidad" sino a componentes que nunca existieron. El modelo
 * los transcribe como algo, y el WER sube sin motivo aparente.
 */
function lowpassKernel(cutoffHz, sampleRate, taps = 81) {
  const fc = cutoffHz / sampleRate; // normalizada
  const M = taps - 1;
  const h = new Float64Array(taps);
  let sum = 0;

  for (let n = 0; n < taps; n++) {
    const k = n - M / 2;
    const sinc = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k);
    const win = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / M);
    h[n] = sinc * win;
    sum += h[n];
  }

  for (let n = 0; n < taps; n++) h[n] /= sum; // ganancia unitaria en continua
  return h;
}

/**
 * Remuestrea a `targetRate`.
 *
 * Los corpus de OpenSLR vienen a 48 kHz y el destino es 16 kHz: factor entero 3, así que
 * alcanza con filtrar y quedarse con una de cada tres muestras. Si el factor no fuera
 * entero se interpola linealmente después de filtrar, que para voz a 16 kHz es suficiente.
 */
export function resample(samples, fromRate, targetRate) {
  if (fromRate === targetRate) return samples;
  if (fromRate < targetRate) {
    throw new Error(`no se sube de ${fromRate} a ${targetRate}: inventaría banda que no está`);
  }

  // Corte por debajo de la nueva Nyquist, con margen para la transición del filtro.
  const kernel = lowpassKernel(targetRate * 0.45, fromRate);
  const half = (kernel.length - 1) / 2;

  const ratio = fromRate / targetRate;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);

  const filtered = (idx) => {
    let acc = 0;
    for (let k = 0; k < kernel.length; k++) {
      const j = idx - half + k;
      if (j >= 0 && j < samples.length) acc += samples[j] * kernel[k];
    }
    return acc;
  };

  const integer = Number.isInteger(ratio);
  for (let i = 0; i < outLen; i++) {
    if (integer) {
      out[i] = filtered(i * ratio);
    } else {
      const src = i * ratio;
      const i0 = Math.floor(src);
      const frac = src - i0;
      out[i] = filtered(i0) * (1 - frac) + filtered(i0 + 1) * frac;
    }
  }

  return out;
}

/** Raíz cuadrática media. Base para fijar la relación señal/ruido. */
export function rms(samples) {
  let acc = 0;
  for (let i = 0; i < samples.length; i++) acc += samples[i] * samples[i];
  return Math.sqrt(acc / samples.length);
}

/**
 * Mezcla ruido sobre una señal a una SNR dada, en decibelios.
 *
 * El ruido se escala a partir de las energías reales de ambas señales, así que la SNR
 * resultante es la pedida y no una aproximación. Queda escrita en el manifiesto: sin ese
 * número, "con ruido" no significa nada y dos corpus no son comparables.
 */
export function mixAtSnr(signal, noise, snrDb) {
  const sRms = rms(signal);
  const nRms = rms(noise) || 1e-12;
  const target = sRms / Math.pow(10, snrDb / 20);
  const gain = target / nRms;

  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    out[i] = signal[i] + noise[i % noise.length] * gain;
  }

  // Normalizar sólo si la suma se pasó de rango, para no recortar.
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.99) for (let i = 0; i < out.length; i++) out[i] *= 0.99 / peak;

  return out;
}

export function silence(seconds, sampleRate) {
  return new Float32Array(Math.round(seconds * sampleRate));
}

export function concat(chunks) {
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
