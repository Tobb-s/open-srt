# Plan del proyecto — herramienta de transcripción de audio y video

**Estado:** borrador de plan, agosto 2026. Nada construido todavía.
**Familia:** tercera herramienta después de OpenPDF y open-latex-ai.
**Carpeta provisional.** El nombre no está decidido — ver §3.

---

## 1. Qué hay que igualar

TurboScribe es la referencia que diste. Su catálogo real, sacado de fuentes indexables
(el sitio está detrás de Cloudflare y no es accesible por herramientas; ver `NOTAS-INVESTIGACION.md`):

| Dimensión | TurboScribe |
|---|---|
| Motor | OpenAI Whisper large-v3 |
| Idiomas | 98+ para transcribir, 134+ para traducir |
| Plan gratis | 3 transcripciones por día, tope de 30 min por archivo |
| Plan pago | 10 US$/mes anual (120 US$/año) o 20 US$/mes |
| Límites del plan pago | ilimitado, hasta 10 h / 5 GB por archivo, 50 subidas simultáneas |
| Diarización | sí, casilla «Speaker Recognition» al subir |
| Traducción | sí, del transcript o de los subtítulos |
| Exportación | TXT, SRT, VTT, DOCX, PDF, CSV |
| Extra | resúmenes con IA, exportación masiva, procesamiento prioritario |
| Precisión declarada | 99,8 % (marketing; las reseñas independientes miden >95 % en audio limpio) |

Lo importante para nosotros no es la lista, es **lo que la lista implica**: transcripción
ilimitada por 10 US$/mes sólo cierra económicamente con GPUs propias. Ver §2.

---

## 2. La decisión que define el proyecto

OpenPDF tiene una propiedad que lo hace posible: **corre entero en el navegador**, así que
el coste marginal por usuario es cero y ningún documento sale del equipo. La transcripción
no hereda eso gratis. Hay que decidirlo, y con números.

### 2.1 Cuánto cuesta cada camino

Coste por **hora de audio** transcrita:

| Camino | Coste/hora | Nota |
|---|---|---|
| Navegador (WebGPU) | **0 US$** | el equipo del usuario pone el cómputo |
| faster-whisper autohospedado | ~0,021 US$ | requiere GPU y operación |
| AssemblyAI Universal-2 | 0,15 US$ | la API administrada más barata |
| Deepgram Nova-3 (batch) | ~0,26 US$ | |
| OpenAI Whisper API | 0,36 US$ | |

Un usuario que transcriba 100 h/mes cuesta 36 US$ por la API de OpenAI y 2,10 US$
autohospedado. Por eso TurboScribe puede vender «ilimitado» a 10 US$: no usa la API,
corre Whisper propio.

### 2.2 Cuánto tarda el navegador

Mediciones publicadas con transformers.js, **backend WASM**:

| Modelo | Segundos por minuto de audio | RTF |
|---|---|---|
| Whisper tiny | ~7 s | 0,12 |
| Whisper base | ~20 s | 0,33 |
| Whisper small | ~90 s | **1,5 — más lento que tiempo real** |

WebGPU da entre 5× y 10× sobre WASM. Whisper large-v3-turbo pesa **1,2 GB** (809 M
parámetros) y **no entra en WASM** en hardware típico: exige WebGPU.

> **Advertencia metodológica.** De acá en adelante son números derivados, no medidos.
> Si small en WASM da RTF 1,5 y WebGPU aporta 5–10×, small en WebGPU quedaría en RTF
> 0,15–0,30, y turbo —3,3× los parámetros de small— entre 0,5 y 1,0. Es decir: **una hora
> de audio tardaría entre 30 y 60 minutos** con el modelo bueno. Esa extrapolación
> encadena dos supuestos y no la voy a dar por buena. Medirla es la Etapa 0.

### 2.3 La decisión

**El navegador es el camino por defecto; el servidor es un escape opcional y explícito.**

A favor del navegador:
- Coste marginal cero, así que se puede ofrecer sin límite de cantidad — justo donde
  TurboScribe pone su muro (3 por día).
- **El audio nunca sale del equipo.** Es el diferencial genuino, no un eslogan: en
  transcripción el material suele ser sesiones clínicas, entrevistas, reuniones internas,
  material periodístico con fuentes. Es una categoría donde la privacidad se paga.
- Coherente con OpenPDF, y desplegable en Vercel sin infraestructura.

Contra, y hay que decirlo de frente:
- Un archivo de 10 horas en el navegador no es realista con el modelo grande.
- Equipos modestos y móviles se quedan cortos: 4 GB de RAM son el piso práctico.
- La primera vez hay que descargar 1,2 GB de modelo.

Por eso la herramienta debe ser **honesta en la puerta**: medir el equipo, estimar cuánto
va a tardar *ese* archivo en *ese* equipo, y decirlo antes de empezar. Nunca una barra de
progreso falsa sobre una espera de 40 minutos.

---

## 3. El nombre

Verifiqué colisiones antes de proponer nada, porque en OpenPDF ya descartaste dos nombres
por esto. **Todos los `Open___` obvios del dominio están tomados:**

| Nombre | Estado |
|---|---|
| OpenScribe | tomado ×4 (uno es un escriba clínico con IA, otro transcripción de audio) |
| OpenTranscribe | tomado ×2 (uno es plataforma de transcripción con diarización) |
| OpenVerbatim | tomado ×2 (análisis cualitativo de entrevistas — dominio contiguo) |
| OpenAudio | tomado ×2 (uno comercial, de voz + IA) |
| OpenVoice | tomado (MyShell, clonación de voz, muy conocido) |
| OpenVox | tomado ×4, **uno de ellos hace transcripción con IA** |
| OpenEcho | tomado ×2 |
| OpenSubtitles | marca enorme, ni acercarse |

**Sin resultados** (libres a esta fecha): `OpenSRT`, `OpenParla`, `OpenLoqui`.

Recomendación: **OpenSRT**. Replica exactamente la lógica de la familia — Open + un
formato de archivo estándar, igual que PDF y LaTeX —, es idéntico en español e inglés y
está libre. La objeción honesta: SRT sugiere subtítulos, y la herramienta hace más que eso.

Es tu decisión y el plan funciona con cualquier nombre; no bloquea nada.

---

## 4. Arquitectura propuesta

Hereda el stack de OpenPDF, que ya conocés y ya está probado en producción:

- **Next.js 16 App Router**, React 19, Tailwind 4, TypeScript, vitest.
- **Bilingüe por URL** (`/es` por defecto, `/en`), como OpenPDF.
- **Todo en el cliente.** El motor vive en un **worker propio**, con degradación al hilo
  principal — el mismo patrón que `src/lib/studio/` en OpenPDF.
- **Sesión en IndexedDB**: audio original + transcripción como lista de segmentos. Permite
  cerrar la pestaña y volver. OpenPDF ya resolvió este patrón (`original` una vez,
  `script` en cada cambio).
- **Vercel**, despliegue por push.

Piezas nuevas:

| Pieza | Elección | Por qué |
|---|---|---|
| ASR | transformers.js + Whisper ONNX, WebGPU con caída a WASM | único camino local real |
| VAD | Silero VAD | obligatorio, ver §6.1 |
| Audio de video | ffmpeg.wasm | exige cabeceras COOP/COEP |
| DOCX | `docx` | **ya está en OpenPDF** |
| PDF | pdf-lib | **ya está en OpenPDF** |

Las dos últimas filas son sinergia real: exportar una transcripción a PDF o Word es
código que ya escribiste.

---

## 5. Las etapas

Cada etapa declara **qué no entra**, porque el alcance se defiende por lo que se excluye.
El criterio de terminado es verificable o no sirve.

### Etapa 0 — Medir antes de prometer

Nada de interfaz. Un banco de pruebas y una tabla de números reales.

- Corpus fijo: audios de 1, 5, 30 y 120 min; español e inglés; limpio, con ruido y con
  varios hablantes. Congelado y versionado.
- Medir en el navegador, por modelo (tiny / base / small / large-v3-turbo) y por backend
  (WebGPU / WASM): **RTF real, pico de memoria, tiempo de descarga del modelo, WER**.
- Medir en **dos equipos**: el tuyo y uno modesto. El segundo es el que manda.

**Terminado cuando:** existe `benchmarks/resultados.md` en el repo con la tabla medida y
el manifiesto del corpus. Ningún número del §2.2 sobrevive sin confirmarse.

**Por qué primero:** todo el plan depende de si turbo en WebGPU da RTF 0,3 o 1,0. Con 0,3
el navegador es el producto; con 1,0 hay que reordenar las etapas. Es exactamente tu regla
de que un número que sólo vive en una conversación no es evidencia.

**No entra:** interfaz, despliegue, ningún formato de salida.

---

### Etapa 1 — Mínimo funcional: audio entra, texto sale

- Un archivo de audio (mp3, wav, m4a, ogg) → transcripción → copiar y descargar TXT.
- Modelo elegido por la Etapa 0, en worker, con caída a WASM.
- **Estimación honesta antes de empezar**: «este archivo, en este equipo, ~N minutos».
- Progreso real por fragmento procesado, nunca una barra decorativa.
- Detección automática de idioma, con opción de forzarlo.
- Portada bilingüe y despliegue en Vercel. **Esto ya está lanzado.**

**Terminado cuando:** un archivo de 5 minutos se transcribe de punta a punta en producción,
en Chrome y en Firefox, y el tiempo estimado cae dentro del ±25 % del real.

**No entra:** video, subtítulos, diarización, edición, cuentas de usuario.

---

### Etapa 2 — El tiempo: subtítulos y editor

Acá deja de ser una demo.

- Marcas de tiempo por segmento y por palabra.
- Exportar **SRT, VTT y TXT** con la convención correcta de cada formato (líneas, duración
  mínima, caracteres por línea).
- **Editor con audio sincronizado**: clic en una palabra y el audio salta ahí; se resalta
  lo que suena; el texto se corrige a mano.
- **VAD (Silero) antes del modelo.** Obligatorio, ver §6.1.

**Terminado cuando:** un SRT exportado abre correctamente en VLC y en YouTube, y existe un
test con un audio que contiene 30 s de silencio que **falla** si se quita el VAD.

**No entra:** video, diarización, traducción.

---

### Etapa 3 — Video y formatos de salida

- ffmpeg.wasm para extraer el audio de mp4, mov, mkv, webm.
- Cabeceras **COOP/COEP** en Vercel para habilitar SharedArrayBuffer — con verificación de
  que no rompen nada del resto del sitio.
- Exportar **DOCX y PDF** reutilizando `docx` y pdf-lib de OpenPDF.
- Exportar CSV.

**Terminado cuando:** un mp4 de 20 minutos produce transcripción y subtítulos sin subir un
byte a ningún servidor, comprobado en el panel de red del navegador.

**No entra:** diarización, traducción, resúmenes.

---

### Etapa 4 — Quién habla

La etapa difícil, y la señalo como tal desde ahora.

- pyannote.audio es MIT, pero **sus modelos están cerrados detrás de un token de Hugging
  Face**, así que no se pueden servir desde el navegador sin más. Sortformer de NVIDIA es
  **CC-BY-NC**: no comercial, descartado para un producto.
- Primera tarea: **una prueba de viabilidad**, no código de producto. ¿Existe un modelo de
  diarización con licencia usable y exportable a ONNX que corra en el navegador?
- Si la respuesta es sí: diarización local, etiquetas de hablante renombrables.
- Si es no: se ofrece **como opción en servidor, con consentimiento explícito** —
  «esto sube tu audio a un tercero» en rojo, apagado por defecto. Y el resto sigue siendo
  local.

**Terminado cuando:** o corre local, o la vía servidor está detrás de un consentimiento que
un test verifica que no se puede saltear.

**No entra:** traducción, resúmenes.

---

### Etapa 5 — Escala, y lo que falta del catálogo

- **Archivos largos**: fragmentación, persistencia en IndexedDB, reanudar tras cerrar la
  pestaña. Un tope declarado y medido, al estilo del `MAX_EDITABLE_BYTES` de OpenPDF.
- Cola de varios archivos.
- Traducción de la transcripción.
- Resumen con IA.
- **Camino de servidor opcional** para lo que el navegador no puede: archivo larguísimo o
  equipo flojo, siempre con el coste y la implicancia de privacidad dichos de frente.

**Terminado cuando:** un archivo de 2 horas se procesa entero en un equipo modesto, o la
herramienta dice antes de empezar por qué no puede y qué alternativa hay.

---

## 6. Trampas conocidas

### 6.1 Whisper alucina en el silencio

Es el defecto más serio del modelo y no es un detalle: en tramos sin voz, el decodificador
sigue generando y produce **texto plausible que nadie dijo**, a menudo repitiendo la misma
frase en bucle. En una herramienta de transcripción esto es lo peor que puede pasar,
porque el resultado *parece* correcto.

Mitigación establecida: **VAD antes del modelo** (Silero es el estándar del ecosistema
faster-whisper) más una escala de temperatura creciente en vez de temperatura fija.

Y siguiendo tu propia regla de OpenPDF sobre qué no puede ver una comprobación: el test
tiene que llevar un **control**. Un audio con silencio *y* con habla conocida, donde se
verifique que la frase inventada no aparece **y** que la frase real sí. Sin el control, un
cero no distingue «limpio» de «la búsqueda está rota».

### 6.2 Las otras

| Trampa | Qué hacer |
|---|---|
| WebGPU inconsistente entre navegadores (hay reportes de Firefox colgado 200 s) | dejar que transformers.js autodetecte, no forzar `device: 'webgpu'` |
| COOP/COEP rompe recursos de terceros | verificar el sitio entero tras activarlas |
| Móviles matan la pestaña por memoria | detectar y degradar a modelo chico, o negarse con un motivo claro |
| 1,2 GB de descarga inicial | caché explícita, tamaño dicho antes, y poder elegir modelo chico |
| El navegador congela el hilo principal | worker propio desde el día uno, no como refactor posterior |

---

## 7. Lo que este plan no promete

- **No va a igualar los 10 h / 5 GB de TurboScribe en el navegador.** Ese número existe
  porque ellos tienen GPUs. Si lo querés igualar, hace falta infraestructura y deja de ser
  gratis de operar.
- **Los tiempos del §2.2 no están medidos.** Son extrapolación de dos supuestos
  encadenados. La Etapa 0 existe para reemplazarlos.
- **La diarización local puede no ser viable** por licencias, no por dificultad técnica.
  La Etapa 4 empieza averiguándolo, no asumiéndolo.

---

## 8. Siguiente paso

Falta que decidas dos cosas antes de escribir código:

1. **El nombre** (§3) — recomiendo OpenSRT, están libres también OpenParla y OpenLoqui.
2. **Si aceptás el navegador como camino por defecto** (§2.3), con el techo que eso impone.

Con eso, arranca la Etapa 0: banco de pruebas y mediciones reales.
