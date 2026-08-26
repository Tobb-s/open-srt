/**
 * Textos de la interfaz, en los dos idiomas.
 *
 * Bilingüe por URL como OpenPDF (`/es` por defecto, `/en`), no por detección automática:
 * una URL por idioma se puede compartir, marcar y indexar.
 *
 * Varias de estas cadenas son el producto, no decoración. La nota de privacidad, el aviso
 * de calidad sin GPU y la estimación de tiempo son lo que separa esta herramienta de una
 * que te deja mirando una barra sin saber qué está pasando.
 */

export const LANGS = ['es', 'en'] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = 'es';

export function isLang(x: string): x is Lang {
  return (LANGS as readonly string[]).includes(x);
}

/** Nombre provisional. Falta decidirlo; se cambia acá y en `layout.tsx`. */
export const APP_NAME = 'OpenSRT';

export interface Dict {
  meta: { title: string; description: string };
  hero: { title: string; subtitle: string };
  drop: { idle: string; hint: string; button: string; formats: string };
  privacy: {
    title: string;
    audioStays: string;
    modelComes: string;
    detail: string;
  };
  device: {
    checking: string;
    ready: (model: string, mb: number) => string;
    noGpuWarn: string;
    quality: { alta: string; media: string; baja: string };
    switchTo: (model: string) => string;
  };
  file: {
    duration: (human: string) => string;
    estimateBefore: string;
    estimateApprox: string;
    estimateLearned: (n: number) => string;
    tooLong: string;
    audioLang: string;
    audioLangAuto: string;
    audioLangEs: string;
    audioLangEn: string;
    audioLangHint: string;
    audioLangAutoWarn: string;
  };
  run: {
    start: string;
    downloading: (pct: number) => string;
    loading: string;
    transcribing: string;
    remaining: (human: string) => string;
    processed: (done: string, total: string) => string;
    /** Avance por bloques: es exacto, a diferencia de la estimación por RTF. */
    blocks: (done: number, total: number) => string;
    elapsed: (human: string) => string;
    liveHint: string;
    cancel: string;
    calibrating: string;
  };
  detect: {
    loading: string;
    running: string;
    found: (n: number, habla: string) => string;
  };
  store: {
    /** Que el audio quedó en el disco de esta máquina hay que decirlo, no dejarlo pasar. */
    kept: string;
    clear: string;
    cleared: string;
    restored: (file: string) => string;
    open: string;
    discard: string;
    audioTooBig: string;
  };
  omission: {
    title: string;
    body: string;
  };
  editor: {
    hint: string;
    edited: string;
    /**
     * Etiqueta del grupo de descargas. Los formatos van con su nombre a secas —TXT, SRT,
     * VTT, CSV— porque son nombres propios: traducirlos sería inventar.
     */
    downloadLabel: string;
    csvHint: string;
  };
  result: {
    title: string;
    copy: string;
    copied: string;
    download: string;
    words: (n: number) => string;
    empty: string;
    tookLabel: (human: string) => string;
    newFile: string;
  };
  errors: {
    decode: string;
    load: string;
    generic: string;
    degraded: string;
  };
  footer: { stage: string; source: string };
}

const es: Dict = {
  meta: {
    title: `${APP_NAME} — transcribí audio y video en tu propia computadora`,
    description:
      'Convierte audio y video a texto sin subir nada a ningún servidor. La transcripción ' +
      'ocurre en tu navegador.',
  },
  hero: {
    title: 'Transcribí audio sin subirlo a ningún lado',
    subtitle:
      'La transcripción ocurre en tu computadora, dentro del navegador. Tu audio no viaja ' +
      'a ningún servidor.',
  },
  drop: {
    idle: 'Soltá un archivo de audio o video acá',
    hint: 'o elegilo desde tu computadora',
    button: 'Elegir archivo',
    formats: 'MP3, WAV, M4A, OGG, FLAC · MP4, WEBM, MOV y más',
  },
  privacy: {
    title: 'Qué sale y qué entra',
    audioStays: 'Tu audio **no sale** de esta computadora.',
    modelComes: 'Pero **se descarga un modelo** desde Hugging Face, la primera vez.',
    detail:
      'Decir «nada sale de tu equipo» sería falso: el audio no se sube, pero el modelo hay ' +
      'que bajarlo. Son unos cientos de megas y queda en la caché del navegador, así que la ' +
      'segunda vez es inmediata. Todo lo demás —incluido el motor que lo ejecuta— se sirve ' +
      'desde este sitio, no desde un CDN de terceros.',
  },
  device: {
    checking: 'Viendo qué puede tu equipo…',
    ready: (model, mb) => `Se va a usar ${model} · ${mb} MB de descarga la primera vez`,
    noGpuWarn:
      'Este navegador no tiene aceleración por GPU disponible, así que se usa un modelo ' +
      'más chico. Va a cometer bastantes más errores: conviene revisar el resultado.',
    quality: {
      alta: 'Calidad alta',
      media: 'Calidad media',
      baja: 'Calidad limitada',
    },
    switchTo: (model) => `Usar ${model} (más lento, menos errores)`,
  },
  file: {
    duration: (human) => `Duración: ${human}`,
    estimateBefore: 'Va a tardar',
    estimateApprox: 'estimación aproximada, todavía sin medir en tu equipo',
    estimateLearned: (n) =>
      n === 1
        ? 'según lo que tardó tu equipo la vez anterior'
        : `según lo que tardó tu equipo las ${n} veces anteriores`,
    tooLong:
      'Es un archivo largo. Si cerrás la pestaña mientras transcribe, se pierde y hay que ' +
      'empezar de nuevo: lo que se guarda es el resultado terminado, no el avance.',
    audioLang: 'Idioma del audio',
    audioLangAuto: 'Detectar',
    audioLangEs: 'Español',
    audioLangEn: 'Inglés',
    audioLangHint:
      'Si el audio está en otro idioma, cambialo acá. Conviene elegirlo antes que dejarlo ' +
      'en «Detectar».',
    audioLangAutoWarn:
      'Ojo: con audio ruidoso la detección automática a veces traduce en vez de ' +
      'transcribir, y devuelve el texto en otro idioma sin avisar. Si sabés el idioma, ' +
      'elegilo.',
  },
  run: {
    start: 'Transcribir',
    downloading: (pct) => `Descargando el modelo… ${pct} %`,
    loading: 'Preparando el modelo…',
    transcribing: 'Transcribiendo…',
    remaining: (human) => `Falta ${human}`,
    processed: (done, total) => `${done} de ${total}`,
    blocks: (done, total) => `Bloque ${done} de ${total}`,
    elapsed: (human) => `Llevás ${human}`,
    liveHint: 'El texto va apareciendo a medida que se transcribe.',
    cancel: 'Cancelar',
    calibrating: 'Midiendo la velocidad de tu equipo…',
  },
  detect: {
    loading: 'Preparando el detector de voz…',
    running: 'Buscando dónde hay voz…',
    found: (n, habla) => `${n} tramos de voz · ${habla} de habla`,
  },
  store: {
    kept:
      'Esta transcripción y su audio quedan guardados en este navegador para que puedas ' +
      'volver a abrirlos. Siguen en tu máquina: nunca se suben a ningún lado.',
    clear: 'Borrar lo guardado',
    cleared: 'Se borró todo lo guardado en este navegador.',
    restored: (file) => `Se recuperó tu última transcripción: ${file}`,
    open: 'Abrir',
    discard: 'Descartar',
    audioTooBig:
      'El texto quedó guardado, pero el audio no entró en el espacio que da el navegador. ' +
      'Al volver vas a ver la transcripción sin el reproductor.',
  },
  omission: {
    title: 'Puede faltar contenido',
    body:
      'Se detectó bastante más voz de la que corresponde al texto obtenido. El modelo a ' +
      'veces se saltea un tramo entero sin avisar, y lo que devuelve suena natural igual. ' +
      'Conviene comparar con el audio antes de darla por buena.',
  },
  editor: {
    hint: 'Hacé clic en una línea para escuchar esa parte. El texto se puede corregir.',
    edited: 'editado',
    downloadLabel: 'Descargar',
    csvHint: 'CSV: una fila por tramo, con los tiempos en segundos y en formato legible.',
  },
  result: {
    title: 'Transcripción',
    copy: 'Copiar',
    copied: 'Copiado',
    download: 'Descargar .txt',
    words: (n) => `${n} palabras`,
    empty: 'No se detectó habla en el archivo.',
    tookLabel: (human) => `Tardó ${human}`,
    newFile: 'Transcribir otro',
  },
  errors: {
    decode:
      'No se pudo leer el audio de este archivo. Puede estar dañado, o traer una pista de ' +
      'audio que este navegador no sabe abrir —pasa con algunos .mkv, que suelen usar AC-3—. ' +
      'Probá con otro navegador, o convertilo a MP4 o a un audio suelto.',
    load:
      'No se pudo cargar el modelo. Revisá la conexión: la primera vez hay que descargarlo.',
    generic: 'Algo falló durante la transcripción.',
    degraded:
      'No se pudo usar un proceso aparte, así que la transcripción corre en la misma ' +
      'pestaña. **La página va a quedar congelada mientras trabaja** — no está trabada.',
  },
  footer: {
    stage: 'Etapa 2: audio a texto con tiempos y subtítulos. Video y hablantes vienen después.',
    source: 'Código abierto',
  },
};

const en: Dict = {
  meta: {
    title: `${APP_NAME} — transcribe audio and video on your own computer`,
    description:
      'Turn audio and video into text without uploading anything. Transcription happens in ' +
      'your browser.',
  },
  hero: {
    title: 'Transcribe audio without uploading it anywhere',
    subtitle:
      'Transcription happens on your computer, inside the browser. Your audio never reaches ' +
      'a server.',
  },
  drop: {
    idle: 'Drop an audio or video file here',
    hint: 'or pick one from your computer',
    button: 'Choose file',
    formats: 'MP3, WAV, M4A, OGG, FLAC · MP4, WEBM, MOV and more',
  },
  privacy: {
    title: 'What leaves and what arrives',
    audioStays: 'Your audio **never leaves** this computer.',
    modelComes: 'But **a model is downloaded** from Hugging Face, the first time.',
    detail:
      'Saying "nothing leaves your machine" would be false: the audio is not uploaded, but ' +
      'the model has to come down. It is a few hundred megabytes and it stays in the ' +
      'browser cache, so the second time is instant. Everything else — including the engine ' +
      'that runs it — is served from this site, not from a third-party CDN.',
  },
  device: {
    checking: 'Checking what your machine can do…',
    ready: (model, mb) => `Will use ${model} · ${mb} MB download the first time`,
    noGpuWarn:
      'This browser has no GPU acceleration available, so a smaller model is used. It will ' +
      'make considerably more mistakes — worth reviewing the result.',
    quality: {
      alta: 'High quality',
      media: 'Medium quality',
      baja: 'Limited quality',
    },
    switchTo: (model) => `Use ${model} (slower, fewer mistakes)`,
  },
  file: {
    duration: (human) => `Length: ${human}`,
    estimateBefore: 'This will take',
    estimateApprox: 'rough estimate, not yet measured on your machine',
    estimateLearned: (n) =>
      n === 1
        ? 'based on how long your machine took last time'
        : `based on how long your machine took the last ${n} times`,
    tooLong:
      'This is a long file. Closing the tab mid-run loses it and you have to start over: ' +
      'what gets saved is the finished transcript, not the progress.',
    audioLang: 'Audio language',
    audioLangAuto: 'Detect',
    audioLangEs: 'Spanish',
    audioLangEn: 'English',
    audioLangHint:
      'If the audio is in another language, change it here. Better to pick it than to ' +
      'leave it on "Detect".',
    audioLangAutoWarn:
      'Careful: with noisy audio, automatic detection sometimes translates instead of ' +
      'transcribing, returning text in another language without warning. If you know the ' +
      'language, pick it.',
  },
  run: {
    start: 'Transcribe',
    downloading: (pct) => `Downloading the model… ${pct} %`,
    loading: 'Getting the model ready…',
    transcribing: 'Transcribing…',
    remaining: (human) => `${human} left`,
    processed: (done, total) => `${done} of ${total}`,
    blocks: (done, total) => `Block ${done} of ${total}`,
    elapsed: (human) => `${human} elapsed`,
    liveHint: 'Text appears as it is transcribed.',
    cancel: 'Cancel',
    calibrating: 'Measuring your machine’s speed…',
  },
  detect: {
    loading: 'Getting the speech detector ready…',
    running: 'Finding where the speech is…',
    found: (n, habla) => `${n} speech segments · ${habla} of speech`,
  },
  store: {
    kept:
      'This transcript and its audio are kept in this browser so you can reopen them. ' +
      'They stay on your machine: they are never uploaded anywhere.',
    clear: 'Delete what is stored',
    cleared: 'Everything stored in this browser was deleted.',
    restored: (file) => `Recovered your last transcript: ${file}`,
    open: 'Open',
    discard: 'Discard',
    audioTooBig:
      'The text was saved, but the audio did not fit in the space the browser allows. ' +
      'When you come back you will see the transcript without the player.',
  },
  omission: {
    title: 'Content may be missing',
    body:
      'Considerably more speech was detected than the resulting text accounts for. The ' +
      'model sometimes skips a whole stretch without warning, and what it returns still ' +
      'sounds natural. Worth checking against the audio before trusting it.',
  },
  editor: {
    hint: 'Click a line to hear that part. The text can be corrected.',
    edited: 'edited',
    downloadLabel: 'Download',
    csvHint: 'CSV: one row per segment, with times in seconds and in readable form.',
  },
  result: {
    title: 'Transcript',
    copy: 'Copy',
    copied: 'Copied',
    download: 'Download .txt',
    words: (n) => `${n} words`,
    empty: 'No speech detected in this file.',
    tookLabel: (human) => `Took ${human}`,
    newFile: 'Transcribe another',
  },
  errors: {
    decode:
      'Could not read audio from this file. It may be damaged, or carry an audio track this ' +
      'browser cannot open — this happens with some .mkv files, which often use AC-3. Try ' +
      'another browser, or convert it to MP4 or to a plain audio file.',
    load: 'Could not load the model. Check your connection: the first run has to download it.',
    generic: 'Something failed during transcription.',
    degraded:
      'A separate process could not be used, so transcription runs in this tab. **The page ' +
      'will freeze while it works** — it is not stuck.',
  },
  footer: {
    stage: 'Stage 2: audio to text with timings and subtitles. Video and speakers come later.',
    source: 'Open source',
  },
};

export const DICTS: Record<Lang, Dict> = { es, en };

export function dict(lang: Lang): Dict {
  return DICTS[lang];
}

/**
 * Un rango de espera, redondeado a la unidad que lo hace legible.
 *
 * Componer dos `humanDuration` daba «entre 2 minutos y 17 s y 2 minutos y 51 s»: la doble
 * «y» se lee mal, y esos segundos son precisamente la falsa precisión que el rango venía a
 * evitar. Se redondea a minutos, y si los extremos coinciden se dice uno solo.
 */
export function humanRange(minSec: number, maxSec: number, lang: Lang): string {
  const entre = lang === 'es' ? 'entre' : 'between';
  const y = lang === 'es' ? 'y' : 'and';
  const cerca = lang === 'es' ? 'alrededor de' : 'about';

  const plural = (n: number, sing: string, plur: string) => `${n} ${n === 1 ? sing : plur}`;

  // El corte va en 60 s, no en 90: con 90 la rama de minutos arrancaba en round(1,5) = 2,
  // así que «alrededor de 1 minuto» no se podía decir nunca y 75 s salía como «entre 70 y
  // 80 segundos», que nadie dice.
  if (maxSec < 60) {
    const a = Math.round(minSec);
    const b = Math.round(maxSec);
    const txt = (n: number) =>
      lang === 'es' ? plural(n, 'segundo', 'segundos') : plural(n, 'second', 'seconds');
    return a === b ? txt(a) : `${entre} ${a} ${y} ${txt(b)}`;
  }

  // Redondeo normal, no floor/ceil: con floor y ceil un rango estrecho —125 a 130 s, que
  // es «dos minutos y pico» en los dos extremos— salía como «entre 2 y 3 minutos», más
  // ancho de lo que la medición justifica.
  const unidadSec = maxSec < 3600 ? 60 : 3600;
  const a = Math.max(1, Math.round(minSec / unidadSec));
  const b = Math.max(a, Math.round(maxSec / unidadSec));
  const txt = (n: number) =>
    unidadSec === 60
      ? lang === 'es' ? plural(n, 'minuto', 'minutos') : plural(n, 'minute', 'minutes')
      : lang === 'es' ? plural(n, 'hora', 'horas') : plural(n, 'hour', 'hours');

  return a === b ? `${cerca} ${txt(a)}` : `${entre} ${a} ${y} ${txt(b)}`;
}

/** Duración en lenguaje llano. Se usa para el archivo y para la espera. */
export function humanDuration(seconds: number, lang: Lang): string {
  const s = Math.round(seconds);
  if (s < 60) return lang === 'es' ? `${s} segundos` : `${s} seconds`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) {
    const mm = lang === 'es' ? (m === 1 ? '1 minuto' : `${m} minutos`) : m === 1 ? '1 minute' : `${m} minutes`;
    if (rest === 0) return mm;
    return lang === 'es' ? `${mm} y ${rest} s` : `${mm} ${rest}s`;
  }
  const h = Math.floor(m / 60);
  const mr = m % 60;
  const hh = lang === 'es' ? (h === 1 ? '1 hora' : `${h} horas`) : h === 1 ? '1 hour' : `${h} hours`;
  return mr === 0 ? hh : lang === 'es' ? `${hh} y ${mr} min` : `${hh} ${mr}min`;
}
