'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AsrEngine, type TimedPhase } from '@/lib/asr/engine';
import type { Selection } from '@/lib/asr/capabilities';
import { profileByKey, type ModelProfile } from '@/lib/asr/models';
import { Estimator, describeEstimate, WINDOW_SEC } from '@/lib/asr/estimate';
import { learnedRtf, recordRtf } from '@/lib/asr/learned';
import { decodeToMono16k } from '@/lib/audio/decode';
import type { TimedText } from '@/lib/vad/align';
import { SessionStore, fileKeyOf, newSessionId, type StoredRun, type StoredSession } from '@/lib/store/session';
import { parPara } from '@/lib/translate/translator';
import { modosPara, type Modo } from '@/lib/asr/modos';
import { recorrerCola, type ItemCola } from '@/lib/sesion/cola';
import {
  sesionDeCorrida,
  sesionDeGuardada,
  avisoDeGuardado,
  valeGuardar,
  type Sesion,
} from '@/lib/sesion/armar';
import { dict, type Lang } from '@/lib/i18n';

/**
 * Toda la lógica de transcribir, en un solo lugar y fuera de la pantalla.
 *
 * ── Qué se movió y qué NO ──
 *
 * Antes del paso 2, `Transcribe.tsx` tenía 1079 líneas y siete responsabilidades: detección
 * de capacidades, cola, transcripción, hablantes, traducción, persistencia y todo el JSX.
 * No era un problema estético — era la razón por la que el paso 3 no podía empezar: para
 * rediseñar «la pantalla de trabajo» primero tiene que existir una pantalla de trabajo.
 *
 * Acá queda el **estado de React y el cableado**. Lo que se puede decidir sin React
 * —recorrer la cola, armar la sesión, elegir el aviso— vive en `@/lib/sesion`, y no por
 * prolijidad: `vitest.config.ts` recolecta `src/**` en entorno `node` y los 88 mutantes
 * están todos en `src/lib`, así que dentro del componente ningún instrumento lo miraba.
 * Sacarlo es ponerlo donde el instrumento llega. Es lo mismo que hizo E1 con
 * `transcribeBlocks`.
 *
 * ── Lo que este archivo no puede romper ──
 *
 * `transcribirUno` recibe el archivo **por argumento** y no lo lee del estado. Dentro del
 * bucle de la cola, un `useCallback` que leyera `file` del estado se quedaría con el valor
 * del render en que se creó y transcribiría el primero diez veces **sin fallar**. Es el
 * error que este refactor podía reintroducir, y ahora `cola.test.ts` lo vigila con un
 * mutante propio.
 */

export type Phase =
  | 'checking'
  | 'idle'
  | 'decoding'
  | 'ready'
  | 'downloading'
  | 'loading'
  | TimedPhase
  | 'done'
  | 'error';

export interface LoadedFile {
  /** Identifica el archivo entre visitas, para poder reconocer uno empezado. */
  key: string;
  name: string;
  samples: Float32Array;
  durationSec: number;
  /** El archivo original, para reproducirlo y para guardarlo. */
  blob: Blob;
}

export function useTranscripcion(lang: Lang) {
  const t = dict(lang);

  const [phase, setPhase] = useState<Phase>('checking');
  const [selection, setSelection] = useState<Selection | null>(null);
  /**
   * Los tres modos, con cuáles puede este equipo.
   *
   * `inspect()` ya devolvía `caps` y se descartaba. Se guardan los modos y no las
   * capacidades porque la pantalla no tiene nada que hacer con `maxBufferBytes`: lo que
   * necesita es qué puede ofrecer y por qué no puede ofrecer el resto.
   */
  const [modos, setModos] = useState<Modo[]>([]);
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
  // Sesión guardada de una visita anterior. No se abre sola: se ofrece.
  const [pendiente, setPendiente] = useState<StoredSession | null>(null);
  /** Una corrida de este mismo archivo que quedó a medias. */
  const [corrida, setCorrida] = useState<StoredRun | null>(null);
  /** La traducción de la sesión en pantalla. Se pide a mano y vive sólo en memoria. */
  const [traduccion, setTraduccion] = useState<TimedText[] | null>(null);
  const [traduciendo, setTraduciendo] = useState<{ done: number; total: number } | null>(null);
  /**
   * Los archivos que faltan, en orden. Vacía cuando se eligió uno solo.
   *
   * Antes había además un `colaRef` espejo que se escribía **durante el render**
   * (`colaRef.current = cola`). Dentro del componente el linter no lo veía; al mover esto a
   * un hook, `react-hooks/refs` lo marcó — y tenía razón: escribir un ref en el render se
   * rompe con el render doble de StrictMode y con el render concurrente, donde el valor
   * puede venir de un render que React después descarta.
   *
   * El espejo tampoco hacía falta. `recorrerCola` sólo necesita la lista **inicial** —
   * recorre por índice y lee `items[i].blob`, que no cambia— y las marcas de estado van por
   * el actualizador funcional de `setCola`. Alcanza con capturar `cola` del render en que
   * el usuario hizo clic, que además es exactamente la lista que estaba viendo.
   */
  const [cola, setCola] = useState<ItemCola[]>([]);
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
    void AsrEngine.inspect()
      .then(({ caps, selection: sel }) => {
        if (!alive) return;
        setSelection(sel);
        setModos(modosPara(caps));

        // `?perfil=base-wasm` fuerza un perfil concreto. Sirve para dos cosas: probar el
        // camino sin GPU en un equipo que sí la tiene —si no, ese camino no se ejercita
        // nunca hasta que le toca a un usuario real—, y para que alguien pueda elegir a
        // mano un modelo distinto del que la detección eligió.
        const pedido = new URLSearchParams(window.location.search).get('perfil');
        const forzado = pedido ? profileByKey(pedido) : undefined;
        setProfile(forzado ?? sel.profile);
        // **Sólo saca de «comprobando»; nunca pisa un estado posterior.**
        //
        // Antes era `setPhase('idle')` a secas, y eso creaba una carrera silenciosa: la
        // detección y la apertura de la base corren en paralelo, sondear el adaptador de
        // WebGPU tarda más que leer IndexedDB, así que al entrar por `?abrir=` la sesión
        // se abría (fase «done») y medio segundo después la detección la devolvía a
        // «idle». El resultado era un enlace «Abrir» que no abría nada y una pantalla de
        // soltar archivo, sin ningún error. Encontrado probando el enlace en el navegador.
        setPhase((p) => (p === 'checking' ? 'idle' : p));
      })
      .catch(() => {
        if (!alive) return;
        // Sin esto, un fallo de la detección dejaba la interfaz **vacía**: con un archivo ya
        // elegido no se dibujaba nada, ni el panel del equipo ni un mensaje. Visto en una
        // pestaña en segundo plano, donde WebGPU no contestaba.
        setProfile(profileByKey('base-wasm') ?? null);
        // Si la detección falló no se sabe qué puede la placa: se ofrecen los dos modos de
        // procesador, que andan en cualquier navegador, y el preciso queda apagado.
        setModos(modosPara({ webgpu: false, webgpuReason: avisoDeteccion }));
        setSelection({
          profile: profileByKey('base-wasm')!,
          notice: { level: 'warn', text: avisoDeteccion },
        });
        // Misma regla que arriba: la detección no pisa un estado posterior.
        setPhase((p) => (p === 'checking' ? 'idle' : p));
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

        // `?abrir=<id>` es el botón «Abrir» de la biblioteca. Se atiende ACÁ y no en un
        // efecto aparte porque necesita el almacén ya abierto; en su propio efecto correría
        // antes y no encontraría nada.
        const pedida = new URLSearchParams(window.location.search).get('abrir');
        if (pedida) {
          const cargada = await s.load(pedida).catch(() => null);
          if (!alive) return;
          if (cargada) {
            setSesion(sesionDeGuardada(cargada, ponerAudioUrl(cargada.audio)));
            setAviso(
              cargada.session.audioStored ? t.store.kept : t.store.audioTooBig,
            );
            setPhase('done');
            // La sesión ya está en pantalla: ofrecer «restaurar la última» encima sería
            // ofrecer lo que el usuario acaba de abrir.
            return;
          }
        }
        setPendiente(await s.latest());
      })
      .catch(() => {});

    return () => {
      alive = false;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      storeRef.current?.close();
      void engineRef.current?.dispose();
    };
  }, [avisoDeteccion, ponerAudioUrl, t]);

  /** Decodifica un archivo y lo deja listo para transcribir. */
  const prepararArchivo = useCallback(async (f: File): Promise<LoadedFile> => {
    const audio = await decodeToMono16k(await f.arrayBuffer());
    return {
      key: fileKeyOf(f),
      name: f.name,
      samples: audio.samples,
      durationSec: audio.durationSec,
      blob: f,
    };
  }, []);

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
      setCola(fs.map((f) => ({ key: fileKeyOf(f), name: f.name, blob: f, estado: 'pendiente' })));

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
        let bloques: StoredRun['blocks'] = retomar?.blocks ?? [];

        // Acá había un `acumulados` que juntaba los tramos de cada bloque y **no lo leía
        // nadie**: el resultado sale de `out.segments`. Se descubrió al mover el código,
        // no antes, porque un valor que nunca se lee no rompe ninguna prueba.
        //
        // No era gratis: `acumulados = [...acumulados, ...p.segments]` copia el arreglo
        // entero en cada bloque. En un archivo de dos horas son ~1300 bloques copiando una
        // lista que crece hasta ~1600 tramos — del orden de un millón de copias de tramo,
        // exactamente el patrón cuadrático que E5 corrigió para las escrituras en disco y
        // que había sobrevivido en memoria. Borrarlo no cambia nada observable: era
        // imposible que su valor saliera de acá.

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
            setRemainingText(
              describeEstimate(estimator.estimate(elFile.durationSec, p.processedSec)),
            );
          },
        });

        // Acá sí se sabe todo: cuánto audio era y cuánto tardó. Ese RTF alimenta la
        // estimación del próximo archivo, que ya no va a ser prestada.
        // Por segundo de **habla**, no de archivo: desde E2 sólo se transcribe lo que el
        // detector marca como voz, así que dividir por la duración del archivo mezclaría una
        // propiedad del equipo con el porcentaje de silencio que traiga cada audio.
        recordRtf(profile.key, out.inferMs / 1000 / out.speechSec, out.speechSec);

        const id = newSessionId();
        // El nombre que ve la gente se pone en `sesionDeCorrida`, no en el modelo: numerar
        // desde 1 es cosa de la interfaz.
        const nueva = sesionDeCorrida({
          id,
          fileName: elFile.name,
          segments: out.segments,
          suspicious: out.coverage.suspicious,
          inferMs: out.inferMs,
          blob: elFile.blob,
          // El audio para reproducir sale del archivo que el usuario acaba de abrir, esté o
          // no guardado: no hay razón para no poder escucharlo ahora.
          audioUrl: ponerAudioUrl(elFile.blob),
          nombreHablante: t.speakers.name,
        });

        let avisoGuardado: string | null = null;
        try {
          const guardada = valeGuardar(nueva.segments)
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
                nueva.segments,
                elFile.blob,
              )
            : undefined;
          avisoGuardado = avisoDeGuardado(guardada, {
            conAudio: t.store.kept,
            sinAudio: t.store.audioTooBig,
          });
        } catch {
          // Que no se pueda guardar no invalida la transcripción: se muestra igual, sin
          // prometer que quedó en ningún lado.
          avisoGuardado = null;
        }

        setTraduccion(null);
        setSesion(nueva);
        // Terminó: la corrida a medias ya no sirve para nada y ocuparía lugar.
        void storeRef.current?.deleteRun(elFile.key).catch(() => {});
        // Y queda anotado cuál es su sesión, para poder reabrirla desde la lista sin
        // transcribir de nuevo.
        setCola((prev) => prev.map((x) => (x.key === elFile.key ? { ...x, sessionId: id } : x)));
        setCorrida(null);
        setAviso(avisoGuardado);
        setPhase('done');
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : t.errors.generic);
        setPhase('error');
        return false;
      }
    },
    [profile, t, audioLang, ponerAudioUrl, separarHablantes],
  );

  /**
   * Recorre la cola. El recorrido en sí vive en `@/lib/sesion/cola`, donde los tests y los
   * mutantes lo alcanzan; acá queda sólo el cableado con el estado de React.
   */
  const procesarCola = useCallback(
    async (primero: LoadedFile, retomar: StoredRun | null) => {
      await recorrerCola(cola, primero, retomar, {
        preparar: prepararArchivo,
        transcribir: transcribirUno,
        // Actualizador funcional: durante el recorrido la lista cambia bajo los pies, y
        // `prev` siempre es la última, no la del render en que arrancó el bucle.
        marcar: (i, cambio) =>
          setCola((prev) => prev.map((x, j) => (j === i ? { ...x, ...cambio } : x))),
      });
    },
    [cola, transcribirUno, prepararArchivo],
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
  const onRenameSpeaker = useCallback((anterior: string, nuevo: string) => {
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
  }, []);

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
      setSesion(sesionDeGuardada(cargada, ponerAudioUrl(cargada.audio)));
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
    const par = parPara(
      audioLang === 'auto' ? undefined : audioLang,
      audioLang === 'es' ? 'en' : 'es',
    );
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
    setSesion(sesionDeGuardada(cargada, ponerAudioUrl(cargada.audio)));
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

  const descartarCorrida = useCallback((fileKey: string) => {
    void storeRef.current?.deleteRun(fileKey).catch(() => {});
    setCorrida(null);
  }, []);

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

  return {
    // estado
    phase,
    selection,
    modos,
    profile,
    file,
    downloadPct,
    processedSec,
    blockInfo,
    elapsedSec,
    remainingText,
    partial,
    sesion,
    error,
    degraded,
    pendiente,
    corrida,
    traduccion,
    traduciendo,
    cola,
    aviso,
    audioLang,
    separarHablantes,
    avanceHablantes,
    // derivados
    busy,
    pct,
    // acciones
    setProfile,
    setAudioLang,
    setSepararHablantes,
    onFiles,
    procesarCola,
    onEdit,
    onRenameSpeaker,
    abrirDeLaCola,
    traducir,
    restaurar,
    borrarTodo,
    descartarCorrida,
    reset,
  };
}
