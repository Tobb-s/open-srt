import {
  BURSTS,
  PROBE_SECONDS,
  energyPerSecond,
  signalMatchesPattern,
  type CodecCheck,
  type ContainerCheck,
  type SampleCheck,
  type VideoProbeResult,
} from './probe';

/**
 * La parte de la prueba que necesita un navegador de verdad.
 *
 * Vive aparte de `probe.ts` para que la lógica de veredicto —«¿la señal cayó donde
 * corresponde?»— se pueda probar con series inventadas, sin `MediaRecorder` ni
 * `AudioContext`. Lo que está acá no se puede probar en Node y por eso no tiene decisiones
 * adentro: graba, decodifica y mide.
 */

const CODECS = [
  'mp4a.40.2', // AAC-LC: la pista de audio de casi todo mp4 y mov
  'mp4a.40.5', // AAC-HE
  'opus', // webm, y mp4 moderno
  'mp3',
  'flac',
  'vorbis',
  'pcm-s16',
  'ac-3', // frecuente en mkv
  'ec-3',
];

const CONTAINERS = [
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
];

const MEMORY_MINUTES = [10, 20, 30, 60, 90, 120];

async function checkCodecs(): Promise<CodecCheck[]> {
  const Decoder = (globalThis as { AudioDecoder?: typeof AudioDecoder }).AudioDecoder;
  if (!Decoder) return [];
  const out: CodecCheck[] = [];
  for (const codec of CODECS) {
    try {
      const s = await Decoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2 });
      out.push({ codec, supported: !!s.supported });
    } catch (e) {
      // Algunos códecs exigen una descripción del contenedor para poder responder. Que
      // tire excepción no es «no soportado»: es «no se puede saber así».
      out.push({ codec, supported: false, note: e instanceof Error ? e.name : String(e) });
    }
  }
  return out;
}

/** Graba unos segundos de video con un tono en posiciones conocidas. */
async function record(mime: string): Promise<Blob | null> {
  if (!MediaRecorder.isTypeSupported(mime)) return null;

  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 240;
  const cx = canvas.getContext('2d')!;
  const pintar = () => {
    cx.fillStyle = `hsl(${(performance.now() / 20) % 360},70%,50%)`;
    cx.fillRect(0, 0, canvas.width, canvas.height);
  };
  const idPintar = setInterval(pintar, 100);
  pintar();

  const ac = new AudioContext({ sampleRate: 48000 });
  // Firefox bloquea el audio automático: el contexto arranca **suspendido** y su reloj no
  // avanza, así que `osc.stop(currentTime + n)` nunca llega y la prueba se cuelga para
  // siempre. `resume()` sólo funciona con un gesto del usuario detrás; si no lo hay, más
  // vale decirlo que quedarse esperando.
  await ac.resume().catch(() => {});
  if (ac.state !== 'running') {
    await ac.close();
    throw new Error(
      'El contexto de audio quedó suspendido: este navegador exige un gesto del usuario ' +
        'antes de dejar sonar nada. Hacé clic en la página y recargá.',
    );
  }

  const dest = ac.createMediaStreamDestination();
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.frequency.value = 440;
  osc.connect(g);
  g.connect(dest);
  g.gain.value = 0;
  for (const [a, b] of BURSTS) {
    g.gain.setValueAtTime(0.5, ac.currentTime + a);
    g.gain.setValueAtTime(0, ac.currentTime + b);
  }
  osc.start();

  const stream = new MediaStream([
    ...canvas.captureStream(10).getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);
  const rec = new MediaRecorder(stream, { mimeType: mime });
  const trozos: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) trozos.push(e.data);
  };
  const detenido = new Promise<void>((res) => {
    rec.onstop = () => res();
  });

  // La grabación termina cuando lo dice **el reloj del audio**, no un `setTimeout`.
  //
  // No es un detalle de estilo: con la pestaña en segundo plano Chrome estrangula los
  // temporizadores y la prueba se quedaba colgada en «grabando…» para siempre. El hilo de
  // audio no se estrangula, así que `onended` del oscilador llega igual. De paso la
  // duración queda exacta en vez de depender de cuándo el navegador quiera correr un
  // callback.
  const terminado = new Promise<void>((res) => {
    osc.onended = () => res();
  });

  rec.start();
  osc.stop(ac.currentTime + PROBE_SECONDS);

  // Red de seguridad. El reloj de audio es fiable cuando el contexto corre, pero si algo lo
  // suspende a mitad de camino la prueba tiene que terminar igual y decir qué pasó, no
  // quedarse en «grabando…» indefinidamente.
  const vencido = Symbol('vencido');
  const guarda = new Promise<typeof vencido>((res) =>
    setTimeout(() => res(vencido), (PROBE_SECONDS + 15) * 1000),
  );
  if ((await Promise.race([terminado.then(() => 'fin'), guarda])) === vencido) {
    try {
      rec.stop();
    } catch {
      /* ya estaba detenido */
    }
    clearInterval(idPintar);
    await ac.close();
    throw new Error('La grabación no terminó a tiempo: el reloj de audio se detuvo.');
  }

  rec.stop();
  await detenido;

  clearInterval(idPintar);
  await ac.close();
  return new Blob(trozos, { type: mime });
}

export type OnPhase = (fase: string) => void;

/** Nombre de archivo estable para lo que grabó un navegador. */
function nombreDeMuestra(mime: string): string {
  const contenedor = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  const codec = /codecs=([^;]+)/.exec(mime)?.[1]?.split(',')[0] ?? 'x';
  return `prueba-${codec}.${contenedor}`;
}

/** Deja el archivo en `public/muestras/` para que lo lean los demás navegadores. */
async function subirMuestra(blob: Blob, mime: string): Promise<void> {
  await fetch(`/api/bench-video/muestra?nombre=${encodeURIComponent(nombreDeMuestra(mime))}`, {
    method: 'POST',
    body: blob,
  }).catch(() => {
    /* en producción la ruta no existe, y eso está bien */
  });
}

/** Decodifica un archivo servido por el sitio, venga de donde venga. */
async function checkSample(file: string): Promise<SampleCheck> {
  let bytes: ArrayBuffer;
  try {
    const res = await fetch(`/muestras/${file}`);
    if (!res.ok) return { file, decode: `HTTP ${res.status}` };
    bytes = await res.arrayBuffer();
  } catch (e) {
    return { file, decode: e instanceof Error ? e.message : String(e) };
  }

  const ac = new AudioContext();
  try {
    const ab = await ac.decodeAudioData(bytes.slice(0));
    const energia = energyPerSecond(ab.getChannelData(0), ab.sampleRate);
    return {
      file,
      bytes: bytes.byteLength,
      decode: 'ok',
      durationSec: +ab.duration.toFixed(2),
      sampleRate: ab.sampleRate,
      channels: ab.numberOfChannels,
      energyPerSec: energia.map((x) => +x.toFixed(4)),
      signalOk: signalMatchesPattern(energia),
    };
  } catch (e) {
    return {
      file,
      bytes: bytes.byteLength,
      decode: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    };
  } finally {
    void ac.close();
  }
}

async function checkContainer(mime: string): Promise<ContainerCheck> {
  let blob: Blob | null;
  try {
    blob = await record(mime);
  } catch (e) {
    // Que un contenedor no se pueda grabar no invalida los otros: se anota y se sigue.
    return { mime, generated: false, decode: e instanceof Error ? e.message : String(e) };
  }
  if (!blob) return { mime, generated: false, decode: 'no-generado' };

  const bytes = await blob.arrayBuffer();
  const ac = new AudioContext();
  try {
    const ab = await ac.decodeAudioData(bytes.slice(0));
    const energia = energyPerSecond(ab.getChannelData(0), ab.sampleRate);
    return {
      mime,
      generated: true,
      blob,
      bytes: blob.size,
      decode: 'ok',
      durationSec: +ab.duration.toFixed(2),
      sampleRate: ab.sampleRate,
      channels: ab.numberOfChannels,
      energyPerSec: energia.map((x) => +x.toFixed(4)),
      signalOk: signalMatchesPattern(energia),
    };
  } catch (e) {
    return {
      mime,
      generated: true,
      bytes: blob.size,
      decode: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    };
  } finally {
    void ac.close();
  }
}

/**
 * Hasta qué duración el motor de audio sostiene el archivo entero en memoria.
 *
 * Es lo que decide si hace falta un decodificador en streaming. **No se mide con
 * `performance.memory`**: el primer intento lo hizo y no vio nada —30 minutos de audio
 * movían el montón de JS de 28 a 70 MB— porque los `AudioBuffer` no viven en el montón de
 * JavaScript. Lo que se mide acá es lo que importa: si la operación se puede hacer.
 *
 * Un `AudioBuffer` recién creado está en cero y el sistema puede no reservarle páginas de
 * verdad hasta que se escriban, así que esto es un **techo optimista**: decodificar un
 * archivo real toca toda la memoria.
 */
async function checkMemoryCeiling(): Promise<VideoProbeResult['memoryCeiling']> {
  const out: VideoProbeResult['memoryCeiling'] = [];
  for (const minutes of MEMORY_MINUTES) {
    const fila = { minutes, allocated: false, resampled: false, ms: undefined as number | undefined };
    let ab: AudioBuffer | null = null;
    try {
      // 48 kHz estéreo: lo que sale de la pista de audio de un video.
      ab = new AudioBuffer({ length: minutes * 60 * 48000, sampleRate: 48000, numberOfChannels: 2 });
      fila.allocated = true;
    } catch {
      out.push(fila);
      break;
    }
    try {
      const off = new OfflineAudioContext(1, minutes * 60 * 16000, 16000);
      const src = off.createBufferSource();
      src.buffer = ab;
      src.connect(off.destination);
      src.start(0);
      const t0 = performance.now();
      await off.startRendering();
      fila.resampled = true;
      fila.ms = Math.round(performance.now() - t0);
    } catch {
      /* queda `resampled: false` */
    }
    out.push(fila);
    if (!fila.resampled) break;
  }
  return out;
}

export async function runVideoProbe(onPhase: OnPhase = () => {}): Promise<VideoProbeResult> {
  const g = globalThis as { AudioDecoder?: unknown; VideoDecoder?: unknown };

  // Los contenedores se graban **de a uno**. En paralelo habría tres `MediaRecorder` y tres
  // `AudioContext` peleando por el mismo reloj de audio, y las ráfagas caerían corridas: la
  // prueba mediría la contención, no el contenedor.
  onPhase('probando códecs');
  const codecs = await checkCodecs();

  const containers: ContainerCheck[] = [];
  for (const [i, mime] of CONTAINERS.entries()) {
    onPhase(`grabando ${i + 1} de ${CONTAINERS.length}: ${mime}`);
    const r = await checkContainer(mime);
    containers.push(r);
    if (r.generated && r.decode === 'ok' && r.blob) await subirMuestra(r.blob, mime);
  }

  // Ahora los archivos compartidos: los mismos bytes en todos los navegadores.
  onPhase('leyendo las muestras compartidas');
  const samples: SampleCheck[] = [];
  const lista = await fetch('/muestras/manifest.json')
    .then((r) => (r.ok ? (r.json() as Promise<{ archivos: string[] }>) : null))
    .catch(() => null);
  for (const f of lista?.archivos ?? []) samples.push(await checkSample(f));

  onPhase('midiendo el techo de memoria');
  const memoryCeiling = await checkMemoryCeiling();

  onPhase('listo');
  return {
    userAgent: navigator.userAgent,
    webCodecs: { audioDecoder: !!g.AudioDecoder, videoDecoder: !!g.VideoDecoder },
    codecs,
    containers,
    samples,
    memoryCeiling,
  };
}
