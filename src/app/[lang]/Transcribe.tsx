'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AsrEngine, type TimedPhase } from '@/lib/asr/engine';
import type { Selection } from '@/lib/asr/capabilities';
import { rtfMedian, profileByKey, type ModelProfile } from '@/lib/asr/models';
import { roughEstimateRange } from '@/lib/asr/capabilities';
import { Estimator, describeEstimate, WINDOW_SEC } from '@/lib/asr/estimate';
import { learnedRtf, recordRtf, sampleCount } from '@/lib/asr/learned';
import { decodeToMono16k } from '@/lib/audio/decode';
import type { TimedText } from '@/lib/vad/align';
import {
  SessionStore,
  fileKeyOf,
  newSessionId,
  type StoredRun,
  type StoredSession,
} from '@/lib/store/session';
import { defaultSpeakerName } from '@/lib/diar/diarize';
import { parPara } from '@/lib/translate/translator';
import { dict, humanDuration, humanRange, type Lang } from '@/lib/i18n';
import Editor from './Editor';

type Phase =
  | 'checking'
  | 'idle'
  | 'decoding'
  | 'ready'
  | 'downloading'
  | 'loading'
  | TimedPhase
  | 'done'
  | 'error';

interface LoadedFile {
  /** Identifica el archivo entre visitas, para poder reconocer uno empezado. */
  key: string;
  name: string;
  samples: Float32Array;
  durationSec: number;
  /** El archivo original, para reproducirlo y para guardarlo. */
  blob: Blob;
}

/**
 * Un archivo esperando su turno.
 *
 * Guarda el `File`, **no** el audio decodificado. Decodificar los cinco de entrada dejaría
 * cinco `Float32Array` gigantes vivos a la vez: media hora de audio son 115 MB, así que una
 * cola de cinco archivos largos se comería más de medio giga antes de transcribir nada. Se
 * decodifica de a uno, en su turno, y se suelta al terminar.
 */
interface ItemCola {
  key: string;
  name: string;
  blob: File;
  estado: 'pendiente' | 'procesando' | 'listo' | 'error';
  /** La sesión que quedó guardada, para poder volver a abrirla desde la lista. */
  sessionId?: string;
  error?: string;
}

/** Lo que se muestra en el editor, venga de transcribir recién o de la base local. */
interface Sesion {
  id: string;
  fileName: string;
  segments: TimedText[];
  suspicious: boolean;
  audioUrl: string | null;
  /** Se decide por el tipo del archivo, no por su extensión: la extensión miente. */
  mediaKind: 'audio' | 'video';
  editedInitially: ReadonlySet<number>;
  inferMs: number;
}

export default function Transcribe({ lang }: { lang: Lang }) {
  const t = dict(lang);

  const [phase, setPhase] = useState<Phase>('checking');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [profile, setProfile] = useState<ModelProfile | null>(null);
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [downloadPct, setDownloadPct] = useState(0);
  const [processedSec, setProcessedSec] = useState<number | undefined>(undefined);
  const [blockInfo, setBlockInfo] = useState<{ done: number; total: number } | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [remainingText, setRemainingText] = useState('');
  const [partial, setPartial] = useState('');
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // Sesión guardada de una visita anterior. No se abre sola: se ofrece.
  const [pendiente, setPendiente] = useState<StoredSession | null>(null);
  /** Una corrida de este mismo archivo que quedó a medias. */
  const [corrida, setCorrida] = useState<StoredRun | null>(null);
  /** La traducción de la sesión en pantalla. Se pide a mano y vive sólo en memoria. */
  const [traduccion, setTraduccion] = useState<TimedText[] | null>(null);
  const [traduciendo, setTraduciendo] = useState<{ done: number; total: number } | null>(null);
  /** Los archivos que faltan, en orden. Vacía cuando se eligió uno solo. */
  const [cola, setCola] = useState<ItemCola[]>([]);
  // Espejo para el bucle: leer `cola` del estado adentro del recorrido daría la lista del
  // render en que se creó el callback.
  const colaRef = useRef<ItemCola[]>([]);
  colaRef.current = cola;
  const [aviso, setAviso] = useState<string | null>(null);
  // Idioma del audio, que NO es necesariamente el de la interfaz: alguien en /es puede
  // transcribir una reunión en inglés. Por eso es un control aparte.
  //
  // **El valor inicial es el idioma de la interfaz, no «Detectar».** Medido: con
  // `es-noisy-3min` y detección automática, el modelo devolvió «The theater of the
  // Flautista, a great success» — tradujo al inglés en vez de transcribir, y a mitad de
  // archivo volvió al español solo. Con el idioma fijado, el mismo audio sale perfecto,
  // voseo incluido. Forzar `task: 'transcribe'` NO lo evita.
  //
  // Un fallo silencioso que devuelve texto plausible en otro idioma es peor que pedirle
  // al usuario que confirme el idioma, así que el default es el predecible y «Detectar»
  // queda como opción advertida.
  const [audioLang, setAudioLang] = useState<'auto' | 'es' | 'en'>(lang);
  // Apagada por defecto: descarga 25 MB mas y suma una inferencia por tramo. Quien la
  // necesita —una reunion, una entrevista— la enciende; quien transcribe a una sola persona
  // no paga por algo que no le sirve.
  const [separarHablantes, setSepararHablantes] = useState(false);
  const [avanceHablantes, setAvanceHablantes] = useState<{ done: number; total: number } | null>(
    null,
  );

  const engineRef = useRef<AsrEngine | null>(null);
  const estimatorRef = useRef<Estimator | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const storeRef = useRef<SessionStore | null>(null);
  // Las URL de objeto hay que revocarlas a mano: si no, el audio queda retenido en memoria
  // por cada archivo que se haya abierto en la sesión.
  const urlRef = useRef<string | null>(null);

  const ponerAudioUrl = useCallback((blob: Blob | null): string | null => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = blob ? URL.createObjectURL(blob) : null;
    return urlRef.current;
  }, []);

  // El texto sale del efecto para no atarlo al diccionario entero: es una cadena estable
  // para un idioma dado, y el efecto tiene que correr una sola vez.
  const avisoDeteccion = t.errors.detect;

  // Detectar capacidades apenas carga: el usuario tiene que saber qué va a pasar
  // *antes* de elegir un archivo, no después.
  useEffect(() => {
    let alive = true;
    void AsrEngine.inspect().then(({ selection: sel }) => {
      if (!alive) return;
      setSelection(sel);

      // `?perfil=base-wasm` fuerza un perfil concreto. Sirve para dos cosas: probar el
      // camino sin GPU en un equipo que sí la tiene —si no, ese camino no se ejercita
      // nunca hasta que le toca a un usuario real—, y para que alguien pueda elegir a
      // mano un modelo distinto del que la detección eligió.
      const pedido = new URLSearchParams(window.location.search).get('perfil');
      const forzado = pedido ? profileByKey(pedido) : undefined;
      setProfile(forzado ?? sel.profile);
      setPhase('idle');
    }).catch(() => {
      if (!alive) return;
      // Sin esto, un fallo de la detección dejaba la interfaz **vacía**: con un archivo ya
      // elegido no se dibujaba nada, ni el panel del equipo ni un mensaje. Visto en una
      // pestaña en segundo plano, donde WebGPU no contestaba.
      setProfile(profileByKey('base-wasm') ?? null);
      setSelection({
        profile: profileByKey('base-wasm')!,
        notice: { level: 'warn', text: avisoDeteccion },
      });
      setPhase('idle');
    });

    // La persistencia es un extra: si el navegador no da IndexedDB —modo privado, permisos
    // restringidos— la herramienta tiene que seguir transcribiendo igual.
    void SessionStore.open()
      .then(async (s) => {
        if (!alive) {
          s.close();
          return;
        }
        storeRef.current = s;
        setPendiente(await s.latest());
      })
      .catch(() => {});

    return () => {
      alive = false;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      storeRef.current?.close();
      void engineRef.current?.dispose();
    };
  }, [avisoDeteccion]);

  /** Decodifica un archivo y lo deja listo para transcribir. */
  const prepararArchivo = useCallback(
    async (f: File): Promise<LoadedFile> => {
      const audio = await decodeToMono16k(await f.arrayBuffer());
      return {
        key: fileKeyOf(f),
        name: f.name,
        samples: audio.samples,
        durationSec: audio.durationSec,
        blob: f,
      };
    },
    [],
  );

  const onFiles = useCallback(
    async (fs: File[]) => {
      if (fs.length === 0) return;
      setError(null);
      setSesion(null);
      setPartial('');
      setProcessedSec(undefined);
      setBlockInfo(null);
      setPhase('decoding');

      // La cola guarda los `File`; sólo el primero se decodifica ahora, para poder mostrar
      // duración y estimación antes de arrancar. Los demás esperan su turno.
      setCola(
        fs.map((f) => ({ key: fileKeyOf(f), name: f.name, blob: f, estado: 'pendiente' })),
      );

      try {
        const primero = await prepararArchivo(fs[0]);
        setFile(primero);
        // ¿Este archivo ya se había empezado? Se ofrece retomar, no se retoma solo: puede
        // haberlo interrumpido a propósito.
        const previa = await storeRef.current?.loadRun(primero.key).catch(() => null);
        setCorrida(previa && previa.doneBlocks < previa.blocks.length ? previa : null);
        setPhase('ready');
      } catch {
        setError(t.errors.decode);
        setPhase('error');
      }
    },
    [t, prepararArchivo],
  );

  /**
   * Transcribe **un** archivo.
   *
   * Recibe cuál en vez de leerlo del estado, y eso es lo que permite encadenarlos: adentro de
   * un bucle, un `useCallback` que lee `file` del estado se queda con el valor del render en
   * que se creó y transcribiría el primer archivo una y otra vez.
   */
  const transcribirUno = useCallback(
    async (elFile: LoadedFile, retomar: StoredRun | null = null): Promise<boolean> => {
    if (!profile) return false;
    setError(null);
    setPartial('');
    setProcessedSec(undefined);
    setBlockInfo(null);
    setElapsedSec(0);
    setPendiente(null);

    // El RTF que este equipo ya demostró vale más que el de la tabla, aunque venga de
    // otro archivo: al menos se midió acá.
    const estimator = new Estimator(profile, learnedRtf(profile.key));
    estimatorRef.current = estimator;

    try {
      let engine = engineRef.current;
      if (!engine) {
        engine = new AsrEngine();
        engineRef.current = engine;
        setPhase('downloading');
        const status = await engine.load(profile, (p) => {
          const pct = Math.round((p.loaded / p.total) * 100);
          setDownloadPct(pct);
          // Bajar los bytes no es tenerlo listo: inicializar la sesión de ONNX y subir los
          // pesos a la GPU tardó 91 s con turbo en E0. Sin este cambio de fase, la barra
          // se queda en 100 % y parece colgada.
          if (pct >= 100) setPhase('loading');
        });
        if (status.mode === 'main-thread') setDegraded(t.errors.degraded);
      }

      // El reloj arranca acá, no en un efecto: si se leyera de una variable capturada en
      // el render, el callback usaría el valor de cuando se creó y la calibración mediría
      // contra un instante equivocado.
      const startedAt = performance.now();
      estimator.start();
      let calibrated = false;

      // El avance se guarda bloque a bloque. Se acumula acá y no adentro del motor porque el
      // motor no sabe de IndexedDB, y tampoco tiene por qué.
      // Los tramos ya hechos viven en su propia tabla; la cabecera sólo dice cuántos bloques.
      const yaHechos: TimedText[] = retomar
        ? await storeRef.current!.loadRunSegments(retomar.fileKey, retomar.doneBlocks)
        : [];
      let acumulados: TimedText[] = [...yaHechos];
      let bloques: StoredRun['blocks'] = retomar?.blocks ?? [];

      const out = await engine.transcribeTimed(elFile.samples, elFile.durationSec, {
        language: audioLang === 'auto' ? undefined : audioLang,
        diarize: separarHablantes,
        onDiarizeProgress: setAvanceHablantes,
        resume: retomar
          ? {
              doneBlocks: retomar.doneBlocks,
              segments: yaHechos,
              speechSec: retomar.speechSec,
              speechSegments: retomar.blocks.flatMap((b) => b.segments),
            }
          : undefined,
        onBlocks: (bs) => {
          bloques = bs.map((b) => ({
            startSec: b.startSec,
            endSec: b.endSec,
            segments: b.segments.map((x) => ({ startSec: x.startSec, endSec: x.endSec })),
            speechSec: b.speechSec,
          }));
        },
        onBlockDone: (p) => {
          acumulados = [...acumulados, ...p.segments];
          // Se guarda **sólo este bloque**, no la lista entera. Reescribirla en cada paso es
          // cuadrático: en un archivo de dos horas son unos 1300 bloques y casi un millón de
          // escrituras de tramo para guardar mil seiscientos.
          void storeRef.current
            ?.saveRunProgress(
              {
                fileKey: elFile.key,
                fileName: elFile.name,
                durationSec: elFile.durationSec,
                updatedAt: Date.now(),
                blocks: bloques,
                doneBlocks: p.index + 1,
                speechSec: p.speechSec,
                language: audioLang === 'auto' ? undefined : audioLang,
              },
              { fileKey: elFile.key, blockIndex: p.index, segments: [...p.segments] },
            )
            .catch(() => {
              // Que no se pueda guardar no detiene nada: se pierde poder retomar, no el
              // trabajo en curso.
            });
        },
        onPhase: (p) => {
          setPhase(p);
          // El detector y el modelo miden segundos distintos; arrancar de cero al pasar de
          // uno al otro evita que la barra retroceda.
          if (p === 'transcribing') setProcessedSec(0);
        },
        onDownload: (p) => setDownloadPct(Math.round((p.loaded / p.total) * 100)),
        onDetectProgress: (p) => setProcessedSec(p.processedSec),
        onBlockProgress: (p) => {
          setPartial(p.partialText);
          setProcessedSec(p.processedSec);
          setBlockInfo({ done: p.done, total: p.total });

          // Con bloques el avance es exacto —terminados sobre totales—, así que la
          // estimación deja de ser una extrapolación a ciegas y se calibra con lo medido.
          if (!calibrated && p.processedSec >= WINDOW_SEC) {
            estimator.calibrate(performance.now() - startedAt, p.processedSec);
            calibrated = true;
          } else {
            estimator.refine(p.processedSec);
          }
          setRemainingText(describeEstimate(estimator.estimate(elFile.durationSec, p.processedSec)));
        },
      });

      // Acá sí se sabe todo: cuánto audio era y cuánto tardó. Ese RTF alimenta la
      // estimación del próximo archivo, que ya no va a ser prestada.
      // Por segundo de **habla**, no de archivo: desde E2 sólo se transcribe lo que el
      // detector marca como voz, así que dividir por la duración del archivo mezclaría una
      // propiedad del equipo con el porcentaje de silencio que traiga cada audio.
      recordRtf(profile.key, out.inferMs / 1000 / out.speechSec, out.speechSec);

      // El modelo devuelve `0`, `1`, `2`. El nombre que ve la gente se pone aca, no en el
      // modelo: numerar desde 1 es cosa de la interfaz.
      const conNombres = out.segments.map((x) => ({
        ...x,
        speaker:
          x.speaker === undefined ? undefined : defaultSpeakerName(x.speaker, t.speakers.name),
      }));

      const id = newSessionId();
      // Tres estados, no dos: guardado con audio, guardado sin audio, y **no guardado**
      // —el navegador no dio IndexedDB, o no había nada que guardar—. Decir «el audio no
      // entró» cuando no se guardó nada sería mentir sobre lo que pasó.
      let aviso: string | null = null;
      // Una transcripción sin una sola palabra no se guarda. Si se guardara, la próxima
      // visita ofrecería recuperar una pantalla vacía, que es peor que no ofrecer nada.
      const hayTexto = conNombres.some((x) => x.text.trim());
      try {
        const guardada = hayTexto
          ? await storeRef.current?.save(
              {
                id,
                fileName: elFile.name,
                durationSec: elFile.durationSec,
                createdAt: Date.now(),
                speechSec: out.speechSec,
                inferMs: out.inferMs,
                suspicious: out.coverage.suspicious,
              },
              conNombres,
              elFile.blob,
            )
          : undefined;
        if (guardada) aviso = guardada.audioStored ? t.store.kept : t.store.audioTooBig;
      } catch {
        // Que no se pueda guardar no invalida la transcripción: se muestra igual, sin
        // prometer que quedó en ningún lado.
        aviso = null;
      }

      setTraduccion(null);
      setSesion({
        id,
        fileName: elFile.name,
        segments: conNombres,
        suspicious: out.coverage.suspicious,
        // El audio para reproducir sale del archivo que el usuario acaba de abrir, esté o
        // no guardado: no hay razón para no poder escucharlo ahora.
        audioUrl: ponerAudioUrl(elFile.blob),
        mediaKind: elFile.blob.type.startsWith('video/') ? 'video' : 'audio',
        editedInitially: new Set(),
        inferMs: out.inferMs,
      });
      // Terminó: la corrida a medias ya no sirve para nada y ocuparía lugar.
      void storeRef.current?.deleteRun(elFile.key).catch(() => {});
      // Y queda anotado cuál es su sesión, para poder reabrirla desde la lista sin
      // transcribir de nuevo.
      setCola((prev) => prev.map((x) => (x.key === elFile.key ? { ...x, sessionId: id } : x)));
      setCorrida(null);
      setAviso(aviso);
      setPhase('done');
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errors.generic);
      setPhase('error');
      return false;
    }
  }, [profile, t, audioLang, ponerAudioUrl, separarHablantes]);

  /**
   * Recorre la cola, **en serie**.
   *
   * En serie y no en paralelo porque hay un solo modelo cargado y un solo procesador: dos
   * transcripciones a la vez no terminan antes, se estorban. Lo que sí se comparte es la
   * carga del modelo, que en E0 tardó 91 s — pagarla una vez para diez archivos es la mitad
   * del sentido de tener cola.
   *
   * **Un archivo que falla no detiene la fila.** Se marca y sigue el siguiente: perder los
   * nueve que faltan porque el tercero está dañado sería lo peor que puede hacer una cola.
   */
  const procesarCola = useCallback(
    async (primero: LoadedFile, retomar: StoredRun | null) => {
      const items = colaRef.current;
      if (items.length <= 1) {
        await transcribirUno(primero, retomar);
        return;
      }

      for (const [i, item] of items.entries()) {
        setCola((prev) => prev.map((x, j) => (j === i ? { ...x, estado: 'procesando' } : x)));
        try {
          // El primero ya viene decodificado —hizo falta para mostrar la estimación—; los
          // demás se decodifican recién acá, y su audio se suelta al pasar al siguiente.
          const preparado = i === 0 ? primero : await prepararArchivo(item.blob);
          const ok = await transcribirUno(preparado, i === 0 ? retomar : null);
          setCola((prev) =>
            prev.map((x, j) => (j === i ? { ...x, estado: ok ? 'listo' : 'error' } : x)),
          );
        } catch (e) {
          setCola((prev) =>
            prev.map((x, j) =>
              j === i
                ? { ...x, estado: 'error', error: e instanceof Error ? e.message : String(e) }
                : x,
            ),
          );
        }
      }
    },
    [transcribirUno, prepararArchivo],
  );

  /**
   * Una corrección: se aplica en pantalla y se escribe en la base.
   *
   * La escritura toca un solo registro. Si el audio y el texto vivieran juntos, corregir
   * una coma reescribiría el archivo entero.
   */
  // Depende del **id** de la sesión, no de la sesión entera: así no se rehace con cada
  // corrección, sólo al cambiar de transcripción.
  const sesionId = sesion?.id;
  const onEdit = useCallback(
    (index: number, text: string) => {
      // La escritura va **afuera** del actualizador de estado: React puede llamar al
      // actualizador dos veces en desarrollo, y un efecto adentro correría dos veces.
      if (sesionId) void storeRef.current?.updateSegment(sesionId, index, text).catch(() => {});
      setSesion((prev) =>
        prev
          ? { ...prev, segments: prev.segments.map((s, i) => (i === index ? { ...s, text } : s)) }
          : prev,
      );
    },
    [sesionId],
  );

  /**
   * Renombrar un hablante en todos sus tramos.
   *
   * Dos personas con el mismo nombre quedan **unidas**, y eso es a proposito: es la salida
   * para el defecto conocido del modelo, que a veces parte a una persona en dos.
   */
  const onRenameSpeaker = useCallback(
    (anterior: string, nuevo: string) => {
      setSesion((prev) => {
        if (!prev) return prev;
        const segments = prev.segments.map((s) =>
          s.speaker === anterior ? { ...s, speaker: nuevo } : s,
        );
        // Se persiste igual que una correccion de texto: un registro por tramo afectado, sin
        // tocar el audio.
        const store = storeRef.current;
        if (store) {
          for (const [i, s] of prev.segments.entries()) {
            if (s.speaker === anterior) {
              void store.updateSegment(prev.id, i, segments[i].text, nuevo).catch(() => {});
            }
          }
        }
        return { ...prev, segments };
      });
    },
    [],
  );

  /**
   * Vuelve a abrir una transcripción ya terminada de la cola.
   *
   * Sale de la base, no de memoria: con diez archivos largos, tener los diez resultados vivos
   * a la vez es exactamente lo que la cola evita al decodificar de a uno.
   */
  const abrirDeLaCola = useCallback(
    async (sessionId: string) => {
      const cargada = await storeRef.current?.load(sessionId);
      if (!cargada) return;
      setSesion({
        id: cargada.session.id,
        fileName: cargada.session.fileName,
        segments: cargada.segments.map((x) => ({
          startSec: x.startSec,
          endSec: x.endSec,
          text: x.text,
          speaker: x.speaker,
        })),
        suspicious: cargada.session.suspicious,
        audioUrl: ponerAudioUrl(cargada.audio),
        mediaKind: cargada.audio?.type.startsWith('video/') ? 'video' : 'audio',
        editedInitially: new Set(cargada.segments.filter((x) => x.edited).map((x) => x.index)),
        inferMs: cargada.session.inferMs,
      });
      setPhase('done');
    },
    [ponerAudioUrl],
  );

  /**
   * Traduce lo que está en pantalla.
   *
   * A pedido y no automático: son 235 MB y una decisión del usuario sobre un resultado que ya
   * tiene. Y **el original no se toca** — la traducción va en su propio estado.
   */
  const traducir = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || !sesion) return;
    const par = parPara(audioLang === 'auto' ? undefined : audioLang, audioLang === 'es' ? 'en' : 'es');
    if (!par) return;
    setTraduciendo({ done: 0, total: sesion.segments.length });
    try {
      const out = await engine.translate(par, sesion.segments, {
        onDownload: (p) => setDownloadPct(Math.round((p.loaded / p.total) * 100)),
        onProgress: setTraduciendo,
      });
      setTraduccion(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errors.generic);
    } finally {
      setTraduciendo(null);
    }
  }, [audioLang, t, sesion]);

  const restaurar = useCallback(async () => {
    const s = storeRef.current;
    if (!s || !pendiente) return;
    const cargada = await s.load(pendiente.id);
    if (!cargada) return;
    setTraduccion(null);
    setSesion({
      id: cargada.session.id,
      fileName: cargada.session.fileName,
      segments: cargada.segments.map((x) => ({
        startSec: x.startSec,
        endSec: x.endSec,
        text: x.text,
        speaker: x.speaker,
      })),
      suspicious: cargada.session.suspicious,
      audioUrl: ponerAudioUrl(cargada.audio),
      // El tipo viaja con el Blob dentro de IndexedDB, así que una sesión recuperada sigue
      // sabiendo que era un video.
      mediaKind: cargada.audio?.type.startsWith('video/') ? 'video' : 'audio',
      editedInitially: new Set(cargada.segments.filter((x) => x.edited).map((x) => x.index)),
      inferMs: cargada.session.inferMs,
    });
    setPendiente(null);
    setFile(null);
    setAviso(cargada.session.audioStored ? t.store.kept : t.store.audioTooBig);
    setPhase('done');
  }, [pendiente, ponerAudioUrl, t]);

  const borrarTodo = useCallback(async () => {
    await storeRef.current?.clear();
    setPendiente(null);
    setAviso(t.store.cleared);
  }, [t]);

  // Reloj de pared. Sin barra de porcentaje, es la referencia de que el tiempo corre.
  useEffect(() => {
    if (phase !== 'transcribing' && phase !== 'detecting') return;
    const t0 = performance.now();
    const id = setInterval(() => setElapsedSec((performance.now() - t0) / 1000), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const reset = useCallback(() => {
    ponerAudioUrl(null);
    setFile(null);
    setCola([]);
    setSesion(null);
    setPartial('');
    setError(null);
    setAviso(null);
    setPhase('idle');
    void storeRef.current?.latest().then(setPendiente);
  }, [ponerAudioUrl]);

  const busy =
    phase === 'downloading' ||
    phase === 'loading' ||
    phase === 'detector' ||
    phase === 'detecting' ||
    phase === 'transcribing' ||
    phase === 'embedder' ||
    phase === 'diarizing';

  // Sólo hay porcentaje si hay un avance medido. Sin eso NO se dibuja una barra: fingir
  // una medición es exactamente lo que esta herramienta no hace.
  const pct =
    processedSec !== undefined && file && file.durationSec > 0
      ? Math.min(100, (processedSec / file.durationSec) * 100)
      : undefined;

  const tituloFase =
    phase === 'downloading'
      ? t.run.downloading(downloadPct)
      : phase === 'loading'
        ? t.run.loading
        : phase === 'detector'
          ? t.detect.loading
          : phase === 'detecting'
            ? t.detect.running
            : phase === 'embedder'
              ? t.speakers.loading
              : phase === 'diarizing'
                ? t.speakers.running(avanceHablantes?.done ?? 0, avanceHablantes?.total ?? 0)
                : t.run.transcribing;

  return (
    <div className="space-y-8">
      {/* Qué va a usar este equipo, dicho antes de elegir archivo */}
      <section className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 dark:border-neutral-800 dark:bg-neutral-900/50">
        {phase === 'checking' ? (
          <p className="text-neutral-500">{t.device.checking}</p>
        ) : selection && profile ? (
          <div className="space-y-2">
            {/*
              Muestra el perfil EFECTIVO, no el que la detección eligió. Antes usaba
              `selection.profile`, así que al cambiar de modelo —con el botón de la
              alternativa o con `?perfil=`— el panel seguía anunciando el anterior: decía
              «Calidad alta» mientras iba a usar el modelo de calidad limitada.
            */}
            <p className="text-sm">
              <span className="font-medium">{t.device.quality[profile.quality]}</span>
              <span className="text-neutral-500">
                {' · '}
                {t.device.ready(profile.key, profile.downloadMB)}
              </span>
            </p>
            {selection.notice && (
              <p
                className={
                  selection.notice.level === 'warn'
                    ? 'rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
                    : 'text-sm text-neutral-500'
                }
              >
                {selection.notice.text}
              </p>
            )}
            {selection.alternative && !busy && (
              <button
                onClick={() => setProfile(selection.alternative!)}
                className="text-sm underline underline-offset-2 disabled:opacity-50"
                disabled={profile?.key === selection.alternative.key}
              >
                {profile?.key === selection.alternative.key
                  ? `✓ ${selection.alternative.key}`
                  : t.device.switchTo(selection.alternative.key)}
              </button>
            )}
          </div>
        ) : null}
      </section>

      {/* Una transcripción de una visita anterior. Se ofrece, no se impone. */}
      {pendiente && !sesion && !busy && (
        <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm dark:border-blue-900 dark:bg-blue-950/30">
          <p className="flex-1">{t.store.restored(pendiente.fileName)}</p>
          <button
            onClick={() => void restaurar()}
            className="rounded-full bg-blue-600 px-4 py-1.5 font-medium text-white"
          >
            {t.store.open}
          </button>
          <button
            onClick={() => void borrarTodo()}
            className="rounded-full px-3 py-1.5 text-neutral-600 underline underline-offset-2 dark:text-neutral-400"
          >
            {t.store.discard}
          </button>
        </section>
      )}

      {/*
        La cola. Sólo aparece con más de un archivo: con uno solo sería una lista de un
        elemento, que es ruido.
      */}
      {cola.length > 1 && (
        <section className="space-y-2 rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="font-medium">
              {t.queue.title(cola.filter((c) => c.estado === 'listo').length, cola.length)}
            </h2>
            <span className="text-xs text-neutral-500">{t.queue.hint}</span>
          </div>
          <ol className="divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
            {cola.map((c, i) => (
              <li key={c.key} className="flex flex-wrap items-center gap-3 py-2">
                <span className="w-5 shrink-0 text-right font-mono text-xs text-neutral-400">
                  {i + 1}
                </span>
                <span className="flex-1 truncate">{c.name}</span>
                <span
                  className={
                    c.estado === 'listo'
                      ? 'text-green-700 dark:text-green-400'
                      : c.estado === 'error'
                        ? 'text-red-700 dark:text-red-400'
                        : c.estado === 'procesando'
                          ? 'text-blue-700 dark:text-blue-400'
                          : 'text-neutral-400'
                  }
                >
                  {c.estado === 'listo'
                    ? t.queue.done
                    : c.estado === 'error'
                      ? t.queue.failed
                      : c.estado === 'procesando'
                        ? t.queue.running
                        : t.queue.pending}
                </span>
                {c.estado === 'listo' && c.sessionId && (
                  <button
                    onClick={() => void abrirDeLaCola(c.sessionId!)}
                    className="rounded-full border border-neutral-300 px-3 py-0.5 text-xs dark:border-neutral-700"
                  >
                    {t.queue.open}
                  </button>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Zona de archivo */}
      {!file && !sesion && phase !== 'decoding' && (
        <section
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void onFiles([...e.dataTransfer.files]);
          }}
          className={`rounded-2xl border-2 border-dashed p-12 text-center transition-colors ${
            dragging
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
              : 'border-neutral-300 dark:border-neutral-700'
          }`}
        >
          <p className="text-lg font-medium">{t.drop.idle}</p>
          <p className="mt-1 text-neutral-500">{t.drop.hint}</p>
          <button
            onClick={() => inputRef.current?.click()}
            className="mt-4 rounded-full bg-neutral-900 px-6 py-2.5 font-medium text-white dark:bg-white dark:text-neutral-900"
          >
            {t.drop.button}
          </button>
          <p className="mt-3 text-xs text-neutral-400">{t.drop.formats}</p>
          <input
            ref={inputRef}
            type="file"
            // El video entra por el mismo camino que el audio: `decodeAudioData` saca la
            // pista de audio de un mp4 o un webm sin ninguna dependencia extra. Medido en
            // `/bench/video`; el detalle está en `docs/E3-ESTADO.md`.
            multiple
            accept="audio/*,video/*"
            className="hidden"
            onChange={(e) => {
              void onFiles([...(e.target.files ?? [])]);
            }}
          />
        </section>
      )}

      {phase === 'decoding' && <p className="text-neutral-500">…</p>}

      {/* Archivo listo: duración y estimación ANTES de arrancar */}
      {file && phase === 'ready' && profile && (
        <section className="space-y-3 rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
          <p className="font-medium">{file.name}</p>
          <p className="text-sm text-neutral-500">
            {t.file.duration(humanDuration(file.durationSec, lang))}
          </p>
          <p className="text-sm">
            {t.file.estimateBefore}{' '}
            <strong>
              {(() => {
                const aprendido = learnedRtf(profile.key);
                // Con RTF aprendido de este equipo, un número. Sin él, un RANGO: las
                // mediciones varían un 25 % y un valor único fingiría precisión.
                if (aprendido !== undefined) {
                  return humanDuration(file.durationSec * aprendido, lang);
                }
                const r = roughEstimateRange(profile, file.durationSec);
                return r.single
                  ? humanDuration(file.durationSec * rtfMedian(profile), lang)
                  : humanRange(r.minSec, r.maxSec, lang);
              })()}
            </strong>
            <span className="text-neutral-500">
              {' — '}
              {/* De dónde sale el número. Presentar una estimación prestada de otro
                  equipo como si fuera medida acá sería la mentira cómoda de siempre. */}
              {sampleCount(profile.key) > 0
                ? t.file.estimateLearned(sampleCount(profile.key))
                : t.file.estimateApprox}
            </span>
          </p>
          {/*
            Por qué es un techo. Sin esta línea el número de arriba parece una predicción, y
            con un audio con pausas se equivoca por casi el doble — medido con un video de
            30 minutos que terminó en 7 min 40 s contra los 13 que decía.
          */}
          <p className="text-xs text-neutral-500">{t.file.estimateCeiling}</p>
          {file.durationSec > 1800 && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              {t.file.tooLong}
            </p>
          )}
          <div className="pt-1">
            <label className="text-sm text-neutral-600 dark:text-neutral-400">
              {t.file.audioLang}{' '}
              <select
                value={audioLang}
                onChange={(e) => setAudioLang(e.target.value as 'auto' | 'es' | 'en')}
                className="ml-1 rounded-lg border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
              >
                <option value="auto">{t.file.audioLangAuto}</option>
                <option value="es">{t.file.audioLangEs}</option>
                <option value="en">{t.file.audioLangEn}</option>
              </select>
            </label>
            <p className="mt-1.5 text-xs text-neutral-500">
              {audioLang === 'auto' ? t.file.audioLangAutoWarn : t.file.audioLangHint}
            </p>
          </div>

          <div className="pt-1">
            <label className="flex items-start gap-2 text-sm text-neutral-600 dark:text-neutral-400">
              <input
                type="checkbox"
                checked={separarHablantes}
                onChange={(e) => setSepararHablantes(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-neutral-900 dark:text-neutral-100">
                  {t.speakers.label}
                </span>
                {/* El costo se dice ANTES de aceptar, no despues de esperar. */}
                <span className="mt-0.5 block text-xs text-neutral-500">{t.speakers.hint}</span>
              </span>
            </label>
          </div>

          {corrida && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950/30">
              <p className="flex-1">
                {t.resume.offer(
                  Math.round((corrida.doneBlocks / Math.max(1, corrida.blocks.length)) * 100),
                )}
              </p>
              <button
                onClick={() => file && void procesarCola(file, corrida)}
                className="rounded-full bg-blue-600 px-4 py-1.5 font-medium text-white"
              >
                {t.resume.button}
              </button>
              <button
                onClick={() => {
                  void storeRef.current?.deleteRun(file.key).catch(() => {});
                  setCorrida(null);
                }}
                className="rounded-full px-3 py-1.5 underline underline-offset-2"
              >
                {t.resume.discard}
              </button>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              onClick={() => file && void procesarCola(file, null)}
              className="rounded-full bg-blue-600 px-6 py-2.5 font-medium text-white"
            >
              {t.run.start}
            </button>
            <button onClick={reset} className="rounded-full px-4 py-2.5 text-neutral-500">
              {t.result.newFile}
            </button>
          </div>
        </section>
      )}

      {/* Progreso real */}
      {busy && file && (
        <section className="space-y-3 rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
          <p className="font-medium">{tituloFase}</p>

          {(phase === 'detecting' || phase === 'transcribing') && (
            <>
              {pct !== undefined ? (
                <>
                  <div className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                    <div
                      className="h-full bg-blue-600 transition-[width] duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-sm text-neutral-500">
                    {t.run.processed(
                      humanDuration(processedSec!, lang),
                      humanDuration(file.durationSec, lang),
                    )}
                    {/* Con bloques el avance no se estima: se cuenta. */}
                    {blockInfo && ` · ${t.run.blocks(blockInfo.done, blockInfo.total)}`}
                    {remainingText && ` · ${t.run.remaining(remainingText)}`}
                  </p>
                </>
              ) : (
                <p className="text-sm text-neutral-500">
                  {t.run.elapsed(humanDuration(elapsedSec, lang))}
                </p>
              )}
            </>
          )}

          {(phase === 'downloading' || phase === 'detector' || phase === 'embedder') && (
            <div className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
              <div
                className="h-full bg-neutral-500 transition-[width]"
                style={{ width: `${downloadPct}%` }}
              />
            </div>
          )}

          {partial && (
            <p className="max-h-40 overflow-y-auto rounded-lg bg-neutral-50 p-3 text-sm text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
              {partial}
            </p>
          )}
          {phase === 'transcribing' && (
            <p className="text-xs text-neutral-500">{t.resume.saving}</p>
          )}
        </section>
      )}

      {degraded && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {degraded.replace(/\*\*/g, '')}
        </p>
      )}

      {/* Resultado */}
      {phase === 'done' && sesion && (
        <div className="space-y-4">
          {sesion.segments.some((s) => s.text.trim()) ? (
            <Editor
              key={sesion.id}
              lang={lang}
              segments={sesion.segments}
              suspicious={sesion.suspicious}
              audioUrl={sesion.audioUrl}
              mediaKind={sesion.mediaKind}
              fileName={sesion.fileName}
              editedInitially={sesion.editedInitially}
              traduccion={traduccion}
              traduciendo={traduciendo}
              puedeTraducir={
                // Sólo cuando se sabe de qué idioma viene: con «Detectar» no se sabe, y
                // elegir un par al azar traduciría desde un idioma equivocado sin avisar.
                audioLang === 'auto'
                  ? null
                  : {
                      destino: audioLang === 'es' ? 'en' : 'es',
                      etiqueta: audioLang === 'es' ? t.file.audioLangEn : t.file.audioLangEs,
                    }
              }
              onTraducir={() => void traducir()}
              onEdit={onEdit}
              onRenameSpeaker={onRenameSpeaker}
            />
          ) : (
            <p className="text-neutral-500">{t.result.empty}</p>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-4 dark:border-neutral-800">
            <button onClick={reset} className="rounded-full px-4 py-2 text-neutral-500">
              {t.result.newFile}
            </button>
            <button
              onClick={() => void borrarTodo()}
              className="rounded-full px-4 py-2 text-sm text-neutral-500 underline underline-offset-2"
            >
              {t.store.clear}
            </button>
          </div>
          {aviso && <p className="text-xs text-neutral-500">{aviso}</p>}
        </div>
      )}

      {error && (
        <section className="space-y-3">
          <p className="rounded-lg bg-red-50 p-4 text-red-900 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </p>
          <button onClick={reset} className="text-sm underline underline-offset-2">
            {t.result.newFile}
          </button>
        </section>
      )}
    </div>
  );
}
