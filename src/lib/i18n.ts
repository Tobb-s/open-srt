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
  hero: {
    title: string;
    subtitle: string;
    /** El título encogido, para cuando el usuario ya decidió y está trabajando. */
    short: string;
  };
  drop: { idle: string; hint: string; button: string; formats: string };
  privacy: {
    title: string;
    /** Una línea, para el disparador del panel plegado. */
    short: string;
    audioStays: string;
    modelComes: string;
    detail: string;
  };
  device: {
    checking: string;
    /**
     * Con qué va a trabajar el equipo, en palabras de quien lo usa.
     *
     * Reemplaza a `ready(model, mb)`, que imprimía la **clave interna del perfil** —
     * `turbo-webgpu`, `base-wasm`— en la primera línea que veía el usuario. Esa clave es de
     * `models.ts` y no significa nada afuera del código; lo que importa es si va a usar la
     * placa de video o el procesador, porque eso explica la velocidad y la calidad.
     */
    engine: (usaGpu: boolean, mb: number) => string;
    noGpuWarn: string;
    quality: { alta: string; media: string; baja: string };
    switchTo: (model: string) => string;
  };
  file: {
    duration: (human: string) => string;
    /**
     * Encabeza la estimación previa. Es un **techo**, no una promesa: antes de detectar la
     * voz no se sabe cuánto del archivo es silencio, y el silencio no se transcribe.
     */
    estimateBefore: string;
    /** Por qué el número de arriba es un techo y no una predicción. */
    estimateCeiling: string;
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
  speakers: {
    /** La casilla para pedir que separe hablantes, antes de arrancar. */
    label: string;
    hint: string;
    /** Mientras corre. */
    loading: string;
    running: (done: number, total: number) => string;
    /** El resultado, arriba del editor. */
    found: (n: number) => string;
    /** Nombre por defecto: se numeran desde 1, que es como cuenta la gente. */
    name: (n: number) => string;
    rename: string;
    /** Lo que la separacion NO hace, dicho donde se ve el resultado. */
    caveat: string;
  };
  translate: {
    /** El control para pedirla, en el editor. */
    label: string;
    to: (idioma: string) => string;
    button: (mb: number) => string;
    running: (done: number, total: number) => string;
    /** Lo que se ve arriba de la traducción. Tiene el peso del aviso de omisión a propósito. */
    warningTitle: string;
    warningBody: string;
    /** Para volver al original. */
    showOriginal: string;
    showTranslation: string;
    /** Bajo cada tramo traducido. */
    originalLabel: string;
  };
  queue: {
    /** Encabeza la lista de archivos en cola. */
    title: (hechos: number, total: number) => string;
    pending: string;
    running: string;
    done: string;
    failed: string;
    /** Para volver a abrir una transcripción ya terminada de la cola. */
    open: string;
    /** Que se procesan de a uno, y por qué. */
    hint: string;
  };
  resume: {
    /** Se encontro este archivo a medio transcribir. */
    offer: (pct: number) => string;
    button: string;
    discard: string;
    /** Mientras corre, para que se vea que cerrar no pierde todo. */
    saving: string;
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
    /** Nombre accesible de cada tramo editable: dice de qué minuto es. */
    segmentLabel: (tiempo: string) => string;
    /** Mientras se lee el archivo del disco, antes de saber siquiera cuánto dura. */
    decoding: string;
    hint: string;
    edited: string;
    /**
     * Etiqueta del grupo de descargas. Los formatos van con su nombre a secas —TXT, SRT,
     * VTT, CSV— porque son nombres propios: traducirlos sería inventar.
     */
    downloadLabel: string;
    csvHint: string;
    /** Encabezado del DOCX y del PDF, y su línea de contexto. */
    docTitle: string;
    docSubtitle: (file: string, duration: string, rows: number) => string;
    /** Mientras se arma el archivo: `docx` y `pdf-lib` se cargan recién al pedirlos. */
    building: string;
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
    /** Cuando no se pudo averiguar qué puede el equipo y hay que asumir lo mínimo. */
    detect: string;
  };
  /**
   * La biblioteca: todo lo que quedó guardado en este equipo.
   *
   * Es la pantalla que convierte «restaurar la última sesión» en algo que se puede usar con
   * diez archivos. Y es el momento en que borrar la sexta transcripción en silencio deja de
   * ser un límite de banco de pruebas y pasa a ser pérdida de datos.
   */
  library: {
    title: string;
    link: string;
    empty: string;
    emptyHint: string;
    /** Cuántas hay y cuánto ocupan, junto: es la información que evita la sorpresa. */
    summary: (n: number, tamano: string) => string;
    /** Lo que ocupa el audio de una transcripción. `null` cuando el audio no está. */
    size: (tamano: string) => string;
    noAudio: string;
    segments: (n: number) => string;
    open: string;
    rename: string;
    renamePrompt: string;
    remove: string;
    removeConfirm: (file: string) => string;
    /** Descargar varias de una vez, que es lo que hace útil una cola de diez. */
    exportAll: string;
    exportAllHint: string;
    exporting: (hechos: number, total: number) => string;
    /** Las transcripciones a medias, que hoy sólo aparecen si volvés a elegir el archivo. */
    unfinished: string;
    unfinishedAt: (pct: number) => string;
    resume: string;
    /** Cuánto queda en el equipo, dicho antes de que se llene. */
    quota: (usado: string, total: string) => string;
    quotaTight: string;
    /** Soltar el audio y quedarse con el texto: la salida cuando falta lugar. */
    freeAudio: string;
    freeAudioConfirm: (file: string, tamano: string) => string;
    freedAudio: string;
  };
  /** Los títulos de lo que está plegado. Ver `paneles` en el diccionario. */
  paneles: { ajustes: string; ajustesResumen: (calidad: string) => string };
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
    subtitle: 'Tu audio no viaja a ningún servidor: se transcribe acá, dentro del navegador.',
    short: 'Transcripción en tu equipo',
  },
  drop: {
    idle: 'Soltá un archivo de audio o video acá',
    hint: 'o elegilo desde tu computadora',
    button: 'Elegir archivo',
    formats: 'MP3, WAV, M4A, OGG, FLAC · MP4, WEBM, MOV y más',
  },
  privacy: {
    title: 'Qué sale y qué entra',
    short: 'tu audio no sale; el modelo sí se baja',
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
    engine: (usaGpu, mb) =>
      `${usaGpu ? 'Usa la placa de video' : 'Usa el procesador'} · ${mb} MB la primera vez`,
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
  library: {
    title: 'Tus transcripciones',
    link: 'Biblioteca',
    empty: 'Todavía no hay nada guardado.',
    emptyHint: 'Lo que transcribas queda acá, en el disco de esta computadora.',
    summary: (n, tamano) =>
      n === 1 ? `1 transcripción · ${tamano}` : `${n} transcripciones · ${tamano}`,
    size: (tamano) => `audio ${tamano}`,
    noAudio: 'sin audio',
    segments: (n) => `${n} tramos`,
    open: 'Abrir',
    rename: 'Renombrar',
    renamePrompt: 'Nombre de la transcripción',
    remove: 'Borrar',
    removeConfirm: (file) => `¿Borrar «${file}» y su audio? No se puede deshacer.`,
    exportAll: 'Descargar todas',
    exportAllHint: 'Un archivo .zip con el TXT y el SRT de cada una.',
    exporting: (hechos, total) => `Armando… ${hechos} de ${total}`,
    unfinished: 'Sin terminar',
    unfinishedAt: (pct) => `quedó al ${pct} %`,
    resume: 'Continuar',
    quota: (usado, total) => `${usado} usados de ${total} disponibles en este navegador`,
    quotaTight:
      'Queda poco espacio. Al guardar una transcripción nueva puede que el audio no entre: ' +
      'el texto se guarda igual, y se avisa cuando pasa.',
    freeAudio: 'Soltar audio',
    freeAudioConfirm: (file, tamano) =>
      `¿Soltar el audio de «${file}» y recuperar ${tamano}? El texto queda intacto; lo que ` +
      `se pierde es poder escucharlo desde acá.`,
    freedAudio: 'audio soltado',
  },
  paneles: {
    ajustes: 'Ajustes',
    ajustesResumen: (calidad) => `${calidad}, listo para usar`,
  },
  file: {
    duration: (human) => `Duración: ${human}`,
    estimateBefore: 'Va a tardar como mucho',
    estimateCeiling:
      'Es un techo: los silencios no se transcriben, así que un audio con pausas termina ' +
      'bastante antes. Medido: un video de 30 minutos con 44 % de silencio tardó 7 min 40 s ' +
      'contra los 13 min que decía esta estimación.',
    estimateApprox: 'estimación aproximada, todavía sin medir en tu equipo',
    estimateLearned: (n) =>
      n === 1
        ? 'según lo que tardó tu equipo la vez anterior'
        : `según lo que tardó tu equipo las ${n} veces anteriores`,
    tooLong:
      'Es un archivo largo. El avance se guarda a medida que termina cada bloque, así que si ' +
      'cerrás la pestaña podés retomar donde iba en vez de empezar de nuevo.',
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
  speakers: {
    label: 'Separar hablantes',
    hint:
      'Marca quién dice cada cosa. Descarga 25 MB más la primera vez y tarda alrededor de un ' +
      'tercio más: hace una comprobación por cada tramo de voz.',
    loading: 'Preparando el modelo de hablantes…',
    running: (done, total) => `Separando hablantes… ${done} de ${total}`,
    found: (n) => (n === 1 ? 'Se detectó 1 hablante' : `Se detectaron ${n} hablantes`),
    name: (n) => `Hablante ${n}`,
    rename: 'Hacé clic en un nombre para cambiarlo.',
    caveat:
      'Cuando dos personas hablan a la vez, el tramo queda atribuido a una sola. Y a veces ' +
      'parte a una misma persona en dos: si ves un hablante de más, podés renombrarlo igual ' +
      'que al otro y quedan unidos.',
  },
  translate: {
    label: 'Traducir',
    to: (idioma) => `a ${idioma}`,
    button: (mb) => `Traducir (${mb} MB de descarga la primera vez)`,
    running: (done, total) => `Traduciendo… ${done} de ${total}`,
    warningTitle: 'Esto es un borrador, no una traducción confiable',
    warningBody:
      'Medido sobre 30 frases: 4 salieron con el sentido cambiado, y sonando perfectas. ' +
      '«Los más grandes éxitos» se convirtió en «the biggest "Sterntos"», una palabra que no ' +
      'existe. Una transcripción mala se puede comparar con el audio; una traducción mala no ' +
      'la vas a notar si no hablás el otro idioma. Revisala antes de publicarla.',
    showOriginal: 'Ver original',
    showTranslation: 'Ver traducción',
    originalLabel: 'original',
  },
  queue: {
    title: (hechos, total) => `Cola: ${hechos} de ${total} listos`,
    pending: 'en espera',
    running: 'transcribiendo',
    done: 'listo',
    failed: 'falló',
    open: 'Abrir',
    hint:
      'Se procesan de a uno: hay un solo modelo cargado y dos a la vez no terminan antes. El ' +
      'modelo se descarga una sola vez para toda la cola.',
  },
  resume: {
    offer: (pct) =>
      `Este archivo lo habías empezado y quedó al ${pct} %. Se puede retomar donde iba.`,
    button: 'Retomar',
    discard: 'Empezar de nuevo',
    saving: 'El avance se guarda a medida que termina cada bloque: podés cerrar y volver.',
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
    segmentLabel: (tiempo) => `Transcripción del minuto ${tiempo}, se puede corregir`,
    decoding: 'Leyendo el archivo…',
    hint: 'Hacé clic en una línea para escuchar esa parte. El texto se puede corregir.',
    edited: 'editado',
    downloadLabel: 'Descargar',
    csvHint: 'CSV: una fila por tramo, con los tiempos en segundos y en formato legible.',
    docTitle: 'Transcripción',
    docSubtitle: (file, duration, rows) => `${file} · ${duration} · ${rows} tramos`,
    building: 'Armando el archivo…',
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
    detect:
      'No se pudo averiguar qué puede tu equipo, así que se usa el modelo más compatible. ' +
      'Va a cometer bastantes más errores. Recargar la página suele resolverlo.',
    degraded:
      'No se pudo usar un proceso aparte, así que la transcripción corre en la misma ' +
      'pestaña. **La página va a quedar congelada mientras trabaja** — no está trabada.',
  },
  footer: {
    // Decía «Etapa 4: … Traducir y resumir vienen después». Era vocabulario interno —las
    // etapas son del plan de desarrollo, no del producto— y además **ya era falso**:
    // traducir se hizo en E5 y resumir se descartó por decisión de alcance.
    stage: 'Audio y video a texto, con tiempos y hablantes. Se exporta en seis formatos.',
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
    subtitle: 'Your audio never reaches a server: it is transcribed here, inside the browser.',
    short: 'Transcription on your machine',
  },
  drop: {
    idle: 'Drop an audio or video file here',
    hint: 'or pick one from your computer',
    button: 'Choose file',
    formats: 'MP3, WAV, M4A, OGG, FLAC · MP4, WEBM, MOV and more',
  },
  privacy: {
    title: 'What leaves and what arrives',
    short: 'your audio stays; the model comes down',
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
    engine: (usaGpu, mb) =>
      `${usaGpu ? 'Uses your graphics card' : 'Uses your processor'} · ${mb} MB the first time`,
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
  library: {
    title: 'Your transcripts',
    link: 'Library',
    empty: 'Nothing saved yet.',
    emptyHint: 'Whatever you transcribe stays here, on this computer’s disk.',
    summary: (n, tamano) => (n === 1 ? `1 transcript · ${tamano}` : `${n} transcripts · ${tamano}`),
    size: (tamano) => `audio ${tamano}`,
    noAudio: 'no audio',
    segments: (n) => `${n} segments`,
    open: 'Open',
    rename: 'Rename',
    renamePrompt: 'Transcript name',
    remove: 'Delete',
    removeConfirm: (file) => `Delete “${file}” and its audio? This cannot be undone.`,
    exportAll: 'Download all',
    exportAllHint: 'One .zip with the TXT and SRT of each.',
    exporting: (hechos, total) => `Building… ${hechos} of ${total}`,
    unfinished: 'Unfinished',
    unfinishedAt: (pct) => `stopped at ${pct}%`,
    resume: 'Continue',
    quota: (usado, total) => `${usado} used of ${total} available in this browser`,
    quotaTight:
      'Space is running low. The audio of a new transcript may not fit: the text is saved ' +
      'anyway, and you are told when it happens.',
    freeAudio: 'Drop audio',
    freeAudioConfirm: (file, tamano) =>
      `Drop the audio of “${file}” and get ${tamano} back? The text stays untouched; what ` +
      `you lose is being able to play it from here.`,
    freedAudio: 'audio dropped',
  },
  paneles: {
    ajustes: 'Settings',
    ajustesResumen: (calidad) => `${calidad}, ready to go`,
  },
  file: {
    duration: (human) => `Length: ${human}`,
    estimateBefore: 'This will take at most',
    estimateCeiling:
      'That is a ceiling: silence is not transcribed, so audio with pauses finishes well ' +
      'before. Measured: a 30-minute video that was 44 % silence took 7 min 40 s against the ' +
      '13 min this estimate showed.',
    estimateApprox: 'rough estimate, not yet measured on your machine',
    estimateLearned: (n) =>
      n === 1
        ? 'based on how long your machine took last time'
        : `based on how long your machine took the last ${n} times`,
    tooLong:
      'This is a long file. Progress is saved as each block finishes, so if you close the tab ' +
      'you can resume where it stopped instead of starting over.',
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
  speakers: {
    label: 'Tell speakers apart',
    hint:
      'Marks who says what. Downloads 25 MB more the first time and takes about a third ' +
      'longer: it runs one check per speech segment.',
    loading: 'Getting the speaker model ready…',
    running: (done, total) => `Telling speakers apart… ${done} of ${total}`,
    found: (n) => (n === 1 ? '1 speaker detected' : `${n} speakers detected`),
    name: (n) => `Speaker ${n}`,
    rename: 'Click a name to change it.',
    caveat:
      'When two people talk at once, the segment is attributed to just one of them. And it ' +
      'sometimes splits one person in two: if you see an extra speaker, rename it the same ' +
      'as the other and they merge.',
  },
  translate: {
    label: 'Translate',
    to: (idioma) => `to ${idioma}`,
    button: (mb) => `Translate (${mb} MB download the first time)`,
    running: (done, total) => `Translating… ${done} of ${total}`,
    warningTitle: 'This is a draft, not a reliable translation',
    warningBody:
      'Measured over 30 sentences: 4 came out with the meaning changed, and sounding ' +
      'perfect. «Los más grandes éxitos» became «the biggest "Sterntos"», a word that does ' +
      'not exist. A bad transcript can be checked against the audio; a bad translation is ' +
      'not something you will notice if you do not speak the other language. Review it ' +
      'before publishing.',
    showOriginal: 'Show original',
    showTranslation: 'Show translation',
    originalLabel: 'original',
  },
  queue: {
    title: (hechos, total) => `Queue: ${hechos} of ${total} done`,
    pending: 'waiting',
    running: 'transcribing',
    done: 'done',
    failed: 'failed',
    open: 'Open',
    hint:
      'They run one at a time: there is a single model loaded and two at once do not finish ' +
      'sooner. The model is downloaded once for the whole queue.',
  },
  resume: {
    offer: (pct) => `You had started this file and it stopped at ${pct} %. It can be resumed.`,
    button: 'Resume',
    discard: 'Start over',
    saving: 'Progress is saved as each block finishes: you can close and come back.',
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
    segmentLabel: (tiempo) => `Transcript at ${tiempo}, editable`,
    decoding: 'Reading the file…',
    hint: 'Click a line to hear that part. The text can be corrected.',
    edited: 'edited',
    downloadLabel: 'Download',
    csvHint: 'CSV: one row per segment, with times in seconds and in readable form.',
    docTitle: 'Transcript',
    docSubtitle: (file, duration, rows) => `${file} · ${duration} · ${rows} segments`,
    building: 'Building the file…',
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
    detect:
      'Could not work out what your machine can do, so the most compatible model is used. ' +
      'It will make considerably more mistakes. Reloading the page usually fixes it.',
    degraded:
      'A separate process could not be used, so transcription runs in this tab. **The page ' +
      'will freeze while it works** — it is not stuck.',
  },
  footer: {
    stage: 'Audio and video to text, with timings and speakers. Exports in six formats.',
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
/**
 * Un tamaño en bytes, legible.
 *
 * Con **base 1024 y etiquetas KB/MB/GB**, que es lo que muestran Windows y el explorador
 * de archivos: si la biblioteca dijera «52,4 MB» y el sistema «50,0 MB» por el mismo
 * archivo, el usuario tendría razón en desconfiar de las dos.
 *
 * Un decimal a partir de MB y ninguno abajo: «1,4 MB» dice algo, «734,2 KB» finge una
 * precisión que a nadie le sirve.
 */
export function humanBytes(bytes: number, lang: Lang): string {
  const coma = (n: number, dec: number) =>
    n.toLocaleString(lang === 'es' ? 'es-AR' : 'en-US', {
      minimumFractionDigits: dec,
      maximumFractionDigits: dec,
    });
  if (bytes < 1024) return `${coma(bytes, 0)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${coma(kb, 0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${coma(mb, 1)} MB`;
  return `${coma(mb / 1024, 1)} GB`;
}

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
