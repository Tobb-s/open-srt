# E3 — estado

Actualizado: 26 de agosto de 2026. **En curso** — falta la prueba con material real.

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

### Lo medido en los dos motores, sobre los mismos bytes

| archivo | Chrome 148 | Firefox 154 |
|---|---|---|
| `prueba-avc1.mp4` (H.264 + AAC) | ok · señal en su lugar | **ok · señal en su lugar** |
| `prueba-avc1-renombrado.mov`, servido como `video/quicktime` | ok · señal en su lugar | **ok · señal en su lugar** |
| `prueba-vp8.webm` | ok · señal en su lugar | ok · señal en su lugar |
| `prueba-vp9.webm` | ok · señal en su lugar | ok · señal en su lugar |

Los dos motores deciden **por el contenido**, no por la extensión ni por el tipo declarado.
Eso responde la pregunta que importaba para el `.mov` del teléfono: es ISOBMFF igual que un
mp4, así que ese caso queda cubierto — aunque los átomos propios de QuickTime siguen sin
probarse.

Firefox tiene además `AudioDecoder` de WebCodecs completo —AAC, Opus, mp3, y también FLAC y
Vorbis, que Chrome no pudo ni responder—, así que hay camino de respaldo sin cabeceras si
alguna vez hiciera falta.

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

- **DOCX y PDF**, con un modelo intermedio compartido (`document.ts`). Las dos bibliotecas no
  se parecen en nada —una arma párrafos y deja que Word decida los cortes, la otra dibuja en
  coordenadas— así que si cada exportador armara el documento por su cuenta, las dos salidas
  se irían separando sin que nadie lo note. Lo que decide **qué dice** el documento está en un
  solo lugar; cada adaptador decide sólo cómo se dibuja.

  Lo interesante —cortar líneas midiéndolas con la fuente, y paginar sin partir un tramo— es
  puro y se prueba con números, sin cargar `docx` ni `pdf-lib`. Las bibliotecas se importan
  **al pedir el archivo**: son un mega y medio entre las dos y no tienen por qué pesar sobre
  quien sólo quiere un `.srt`.

### Lo que el plan daba por reutilizable y no lo era

El plan anotaba aprovechar `textLayout.ts` de OpenPDF «para el flujo de texto». **No aplica:**
ese módulo reconstruye párrafos a partir de las corridas de glifos que devuelve pdf.js — va de
PDF a texto, la dirección contraria. Escribir un PDF exige medir con la fuente, que es lo que
hace `wrapByMeasure`.

### Una suposición sobre PDF que era falsa, y se midió

La primera versión del saneador de texto partía de que las fuentes estándar de PDF no podían
dibujar comillas tipográficas ni guion largo, y los reemplazaba por ASCII. **Comprobado contra
pdf-lib, es falso:**

| texto | resultado |
|---|---|
| `¿Qué año? ¡Sí! pingüino` | dibuja |
| `dijo “hola”` · `texto —cortado—` · `y entonces…` · `«así»` | **dibuja** |
| `中文` | `WinAnsi cannot encode "中" (0x4e2d)` |
| emoji | `WinAnsi cannot encode` |

WinAnsi cubre latin-1 **más** el bloque 0x80–0x9F, que es justamente donde viven `‘ ’ “ ” – — …`.
Reemplazarlos habría dejado el PDF peor que el DOCX sin ninguna razón. Ahora se sanea sólo lo
que de verdad no entra, y el test lo comprueba **contra pdf-lib**, con dos controles: que sin
sanear efectivamente tira, y que lo que se decidió no tocar el dibujante lo acepta.

Lo que sí falla, falla **tirando una excepción**: sin sanear, una transcripción con un emoji no
genera PDF y el usuario ve un error sin explicación.

### Verificado abriéndolos

| | |
|---|---|
| DOCX en **Word** | abre; título, subtítulo, tabla de dos columnas sin bordes, horas en monoespaciada alineadas con la primera línea de cada tramo |
| Acentos, ñ, `¿`, y `—y esto lo hablé con el equipo—` | intactos |
| `01:01:01` pasada la hora | correcto |
| PDF en **Adobe Acrobat** | abre; A4, 5 páginas en el documento largo, tramos continuos entre páginas |
| Los tres botones en el navegador | producen archivo con la firma correcta: `PK` el DOCX, `%PDF-` el PDF, BOM el CSV |

Abrir el PDF destapó un desperdicio que ningún test veía: el hueco del encabezado se reservaba
en **todas** las páginas y quedaban cuatro centímetros de blanco arriba de cada una. `paginate`
ahora recibe un alto propio para la primera página.

### Un test más débil que su nombre, encontrado por la mutación

El test se llamaba «no parte un tramo entre páginas» y decía cubrir la guarda que evita abrir
una página vacía. **No la tocaba.** Quitar la guarda no rompía ninguno de los tres casos, y
los tres daban exactamente el mismo resultado:

| caso | con la guarda | sin ella |
|---|---|---|
| `[80, 40, 40]` | `[[0],[1,2]]` | igual |
| `[50, 300, 40]` | `[[0],[1],[2]]` | igual |
| **`[300, 40]`** | `[[0],[1]]` | **`[[],[0],[1]]`** |

La guarda sólo importa cuando **el primer** tramo es más alto que la página: sin ella se emite
una página vacía, o sea una hoja en blanco al principio del PDF. Todos los casos empezaban con
un tramo que entraba, así que ninguno la ejercitaba.

El código estaba bien; el test no. Se agregó el caso que faltaba y, sobre todo, la propiedad de
fondo —ninguna página queda vacía— que tapa la clase entera y no sólo este agujero.

## Lo que falta para cerrar E3

- **Un video de 20 minutos.** Lo que se probó son 67 segundos (ver más abajo). La duración
  se cubrió por separado, midiendo el techo de memoria hasta las dos horas, pero el camino
  entero con un archivo largo **no está comprobado**.
- **Encodings de cámaras y de Zoom.** El material de prueba lo genera `MediaRecorder`, que
  produce lo que ese navegador sabe producir. Un teléfono o un Zoom pueden traer perfiles de
  H.264 distintos.
- **`.mkv`**: sin probar. `MediaRecorder` no lo genera y no hay archivo real a mano. Se sabe
  que el audio **AC-3**, frecuente en ese contenedor, no lo decodifica ninguno de los dos
  navegadores.
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

## El defecto que apareció intentando la prueba de punta a punta

Con el archivo ya elegido, la interfaz quedó **completamente en blanco**: ni el panel del
equipo, ni el archivo, ni un mensaje de error. Leyendo los dos árboles de React, el que se
estaba renderizando tenía `selection` y `profile` en `null`.

La causa: **`gpu.requestAdapter()` puede quedarse colgado** — no rechaza, no resuelve. Pasó
en una pestaña en segundo plano. No faltaba un `catch`: no había excepción que atrapar.
Faltaba un plazo.

Arreglado con tres cosas:

1. Un plazo de 8 s que convierte el cuelgue en una respuesta: no hay WebGPU, se usa el camino
   compatible, y se dice.
2. Un `catch` en el componente que cae a un perfil seguro con aviso visible, en vez de dejar
   la pantalla vacía.
3. `requestAdapterWithTimeout` sale afuera para poder probarla: una promesa que nunca resuelve
   no se puede provocar con el WebGPU real. Uno de sus tests **no terminaría** si el plazo no
   existiera.
