/**
 * Decodificación y remuestreo de audio a lo que el modelo exige.
 *
 * Compartido entre el banco de E0 y el producto **a propósito**. Un segundo remuestreador
 * sería una segunda forma de degradar el audio sin que nada falle, y además rompería la
 * comparabilidad: los WER medidos en E0 valen para el producto sólo si el audio llega al
 * modelo por el mismo camino.
 *
 * Whisper y Moonshine esperan PCM mono a **16 kHz** en Float32. No es una preferencia:
 * el extractor de características está construido sobre esa tasa, y darle otra cosa
 * produce transcripciones sutilmente peores sin ningún error visible.
 *
 * Todo pasa por `OfflineAudioContext`, que remuestrea en el propio navegador con el
 * mismo código que usa el motor de audio. Meter un remuestreador propio acá sería
 * agregar una fuente de error entre el archivo y la medición.
 */

export const TARGET_SAMPLE_RATE = 16000;

export interface DecodedAudio {
  /** PCM mono a 16 kHz. */
  samples: Float32Array;
  /** Duración real en segundos, calculada de las muestras, no del contenedor. */
  durationSec: number;
  /** Tasa y canales del archivo original, para poder auditar el remuestreo. */
  sourceSampleRate: number;
  sourceChannels: number;
}

/**
 * Decodifica un archivo de audio y lo deja en mono a 16 kHz.
 *
 * La duración se recalcula de las muestras producidas y no se toma de la cabecera del
 * archivo: un contenedor puede declarar una duración que no coincide con lo que
 * realmente trae, y el RTF se divide por este número. Un RTF calculado sobre una
 * duración mentida es un RTF mentido.
 */
export async function decodeToMono16k(data: ArrayBuffer): Promise<DecodedAudio> {
  // Un AudioContext temporal sólo para decodificar. La tasa que pidamos acá no
  // determina la de salida: eso lo hace el OfflineAudioContext de abajo.
  const AudioCtx =
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;

  const decodeCtx = new AudioCtx();
  let decoded: AudioBuffer;
  try {
    // decodeAudioData consume el ArrayBuffer en algunos navegadores; se le pasa una
    // copia para que quien llamó pueda seguir usando el suyo.
    decoded = await decodeCtx.decodeAudioData(data.slice(0));
  } finally {
    void decodeCtx.close();
  }

  const sourceSampleRate = decoded.sampleRate;
  const sourceChannels = decoded.numberOfChannels;

  const targetLength = Math.max(
    1,
    Math.ceil((decoded.duration * TARGET_SAMPLE_RATE) as number),
  );

  // Un solo canal de salida: el mezclado a mono lo hace el propio grafo al conectar
  // una fuente multicanal a un destino mono.
  const offline = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);

  const rendered = await offline.startRendering();
  const samples = rendered.getChannelData(0);

  return {
    // Copia desprendida del AudioBuffer: el original queda libre para el recolector,
    // que con audios de dos horas no es un detalle.
    samples: new Float32Array(samples),
    durationSec: samples.length / TARGET_SAMPLE_RATE,
    sourceSampleRate,
    sourceChannels,
  };
}

/** Descarga y decodifica en un paso. Devuelve además los bytes crudos, para el hash. */
export async function fetchAndDecode(
  url: string,
): Promise<DecodedAudio & { bytes: ArrayBuffer }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo bajar ${url}: HTTP ${res.status}`);
  const bytes = await res.arrayBuffer();
  const audio = await decodeToMono16k(bytes);
  return { ...audio, bytes };
}

/**
 * SHA-256 en hexadecimal. Se usa para confirmar que el audio que se está midiendo es el
 * mismo que declara el manifiesto del corpus: sin eso, una tabla de resultados no es
 * comparable con la de la semana siguiente.
 */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
