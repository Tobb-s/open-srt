# E3 — estado

Actualizado: 26 de agosto de 2026. **En curso.**

**Objetivo de la etapa:** aceptar lo que la gente realmente tiene —un mp4 de una reunión, un
mov del teléfono— y entregar en los formatos que realmente usa.

---

## La decisión que la etapa existía para tomar

El plan planteaba dos caminos para sacarle el audio a un video, y decía que había que
probarlos antes de elegir:

| | ffmpeg.wasm | WebCodecs + mp4box.js |
|---|---|---|
| Cabeceras COOP/COEP | **necesarias** | no |
| Peso | varios MB | mínimo |
| Riesgo | rompe recursos de otro origen | soporte desigual |

El riesgo de la primera columna no era teórico: COOP/COEP bloquean recursos de otro origen,
y el modelo de Whisper se descarga de Hugging Face. Activar esas cabeceras en E3 **habría
roto la descarga que E1 dejó funcionando** — una regresión a una etapa de distancia.

**Ninguno de los dos hacía falta.**

### La hipótesis barata que nadie había probado

`decodeAudioData` —lo que el producto ya usa para audio desde E1— abre directamente la pista
de audio de un contenedor de video. No es un truco: la especificación dice que acepta
«cualquiera de los formatos que soporta el elemento `audio`», y `<audio src="reunion.mp4">`
reproduce el audio de un mp4 en todos los navegadores. Hubo una propuesta de 2013
([bug 21520](https://www.w3.org/Bugs/Public/show_bug.cgi?id=21520)) para restringirlo a
contenedores sin video; no se adoptó.

Así que E3 no incorpora ninguna dependencia nueva, ninguna cabecera, y el riesgo del plan
desaparece solo.

### Cómo se probó

`/bench/video` graba con `MediaRecorder` un mp4 y un webm **con un tono en segundos
conocidos** (1–2, 3–4 y 5–5,5), y después los decodifica midiendo la energía segundo a
segundo. Que el material lo genere el propio navegador tiene una ventaja sobre traer un
archivo cualquiera: se sabe qué tiene que sonar y cuándo.

Eso importa porque **«decodificó» no es la pregunta**. Un decodificador que devuelve ruido
con la duración correcta también «decodifica». El veredicto exige las dos cosas: que suene
donde se puso el tono y que calle donde no. `signalMatchesPattern` está en `probe.ts`, fuera
del código que toca el navegador, con tests que incluyen los dos controles que hacen falta —
rechaza ruido parejo y rechaza el silencio total.

### Lo medido en Chrome 148

| contenedor | decodifica | señal en su lugar |
|---|---|---|
| `video/mp4` (H.264 + AAC) | sí | **sí** |
| `video/webm` (VP8 + Opus) | sí | **sí** |
| `video/webm` (VP9 + Opus) | sí | **sí** |

Energía por segundo del mp4: `0 · 0,354 · 0,0001 · 0,354 · 0,0001 · 0,259` — exactamente el
patrón que se grabó.

### Lo medido en Firefox 154

| contenedor | graba | decodifica | señal en su lugar |
|---|---|---|---|
| `video/webm` (VP8 + Opus) | sí | sí | **sí** |
| `video/mp4` (H.264 + AAC) | **no sabe grabarlo** | pendiente | pendiente |

Firefox tiene `AudioDecoder` de WebCodecs completo —AAC, Opus, mp3, y además FLAC y Vorbis,
que Chrome no pudo ni responder— así que **si `decodeAudioData` fallara con mp4, el camino de
respaldo existe y no exige cabeceras**. Eso es lo que hace que la decisión de la etapa no
dependa de este dato pendiente.

### El agujero del método, y cómo se tapó

La primera versión hacía que **cada navegador grabara su propio material**, y eso dejaba sin
responder justo la pregunta que importaba: **Firefox no sabe grabar mp4**, así que por ese
camino su capacidad de *leerlo* quedaba sin medir — no porque no pudiera, sino porque la
prueba no tenía con qué preguntarle.

La corrección: el navegador que sí sabe grabar deja el archivo en `public/muestras/`, y
**todos decodifican el mismo**. Deja de medirse qué sabe grabar cada uno y pasa a medirse qué
sabe leer.

Chrome ya dejó las muestras (`prueba-avc1.mp4`, `prueba-vp8.webm`, `prueba-vp9.webm`) y las
releyó las tres correctamente. **La corrida de Firefox sobre esas mismas muestras está
pendiente**: no está medida y no se afirma nada sobre ella.

---

## El techo de memoria

Es lo que decide si hace falta un decodificador en streaming. El camino actual mete el
archivo entero en memoria: 48 kHz estéreo son 460 MB por cada 20 minutos.

| duración | reserva | remuestrea a 16 kHz mono |
|---|---|---|
| 10 a 120 min | sí | sí (7,7 s para 120 min) |

No se encontró techo hasta las **dos horas** en este equipo, ni en Chrome ni en Firefox. Dos
salvedades que hay que decir:

1. Un `AudioBuffer` recién creado está en cero y el sistema puede no reservarle páginas
   reales hasta que se escriban. Es un **techo optimista**: decodificar un archivo de verdad
   toca toda la memoria.
2. Es *este* equipo. Una máquina con menos RAM va a fallar antes.

**`performance.memory` no sirve para medir esto**, y el primer intento lo usó: 30 minutos de
audio movían el montón de JavaScript de 28 a 70 MB, porque los `AudioBuffer` no viven ahí.
Otra vez, un instrumento mal calibrado dando números tranquilizadores.

---

## Lo que el producto ya acepta

- El selector de archivos toma `audio/*` **y `video/*`**.
- El editor muestra un `<video>` cuando la fuente es video, en vez de un `<audio>`. En una
  reunión grabada, ver quién habla es la mitad del trabajo de verificar una línea dudosa.
- El mensaje de error dice qué hacer cuando el navegador no puede con la pista —el caso
  típico es un `.mkv` con audio AC-3, que **ni Chrome ni Firefox decodifican**.

## Exportadores

- **CSV** (`src/lib/export/csv.ts`), con analizador propio en los tests y control.
  Dos formas del tiempo: `start_sec` en segundos para procesar y `start` legible para leer.
  Sale con BOM porque sin ella Excel en Windows muestra `configuraciÃ³n`; y el tiempo
  legible va con punto y no con la coma del SRT, para no obligar a entrecomillar dos campos
  por una razón evitable.
- DOCX y PDF: **pendientes**.

## Lo que falta para cerrar E3

- Un video real de 20 minutos, de punta a punta, con el panel de red abierto. Los archivos de
  prueba los genera el navegador y no cubren encodings de cámaras ni de Zoom. Queda
  **declarado como no comprobado**.
- **Firefox leyendo el mp4** que grabó Chrome. Es el único dato que falta de la matriz de
  navegadores, y no bloquea la decisión: aunque falle, Firefox tiene WebCodecs con AAC.
- `.mov` y `.mkv`: sin probar. `MediaRecorder` no los genera.
- DOCX y PDF.
- Safari: no hay forma de probarlo desde Windows.

## Una traba del entorno que costó media hora

Correr la prueba en Firefox mientras se edita código **no funciona**: el servidor de
desarrollo recarga la página en cada cambio y la prueba vuelve a empezar. Se veía como «se
cuelga», y no se colgaba nada.

Antes de eso hubo dos trabas reales, las dos arregladas en la prueba:

- **Firefox suspende el `AudioContext`** hasta que hay un gesto del usuario, así que su reloj
  no avanza y `osc.stop(currentTime + n)` no llega nunca. Ahora la prueba lo detecta y lo
  dice en vez de esperar para siempre; para correrla sin nadie que haga clic se usa un perfil
  temporal con `media.autoplay.default = 0`.
- **Chrome estrangula los temporizadores en pestañas ocultas.** La grabación se controlaba
  con `setTimeout` y quedaba colgada. Ahora la marca el **reloj del audio**, que no se
  estrangula — y de paso la duración quedó exacta.
