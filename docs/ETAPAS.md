# Las seis etapas, desarrolladas

Complemento de `PLAN.md`, que tiene el contexto y la decisión de arquitectura.
Este documento es **qué hago en cada etapa y cuándo se considera cerrada**.

**Sobre el tamaño:** cada etapa lleva una marca S / M / L. Es tamaño relativo entre
etapas, **no un plazo**. No tengo base para prometer días y no los voy a inventar.

**Sobre el estado de cada afirmación:** marco `[verificado]` lo que comprobé contra una
fuente, e `[hipótesis]` lo que hay que probar antes de construir encima. Nada de lo que
está marcado como hipótesis entra en producción sin confirmarse.

---

## Tres hallazgos que cambian el plan grueso

Al desarrollar las etapas aparecieron tres cosas que la versión anterior no veía. Van
acá arriba porque afectan decisiones tempranas.

### 1. COOP/COEP y el modelo de 1,2 GB chocan entre sí

ffmpeg.wasm (E3) exige `SharedArrayBuffer`, que exige las cabeceras COOP/COEP en todo el
sitio. Pero esas cabeceras **también bloquean cualquier recurso de otro origen** que no
declare `Cross-Origin-Resource-Policy`. Y el modelo de Whisper —1,2 GB— se descarga del
CDN de Hugging Face, que es otro origen.

Si el CDN de HF no sirve la cabecera correcta, **activar COOP/COEP en E3 rompe la
descarga del modelo que E1 dejó funcionando**. Es una regresión con una etapa de
distancia, del tipo que no se ve hasta que ya está construido.

Por eso el lugar donde vive el modelo pasa a decidirse **en E1**, no en E3. Y hay una
salida mejor, ver el punto siguiente.

### 2. WebCodecs podría evitar ffmpeg.wasm y COOP/COEP por completo

`AudioDecoder` de WebCodecs decodifica audio nativamente, sin WebAssembly y sin
SharedArrayBuffer. Lo que no hace es *demuxear* el contenedor: hay que sacar la pista de
audio del mp4 antes, con algo como mp4box.js, que es liviano y no necesita cabeceras
especiales.

Si funciona, E3 se vuelve mucho más simple, el sitio no necesita COOP/COEP, el problema
del punto 1 desaparece y ahorramos varios MB de descarga. **[hipótesis]** — E3 empieza
probándolo contra ffmpeg.wasm, no asumiendo ninguno de los dos.

### 3. La diarización local probablemente sí es viable, sin pyannote

El plan grueso daba la diarización por dudosa porque pyannote está cerrado tras un token
de Hugging Face y Sortformer es CC-BY-NC. Pero **pyannote no es el único camino**: una
tubería de diarización es VAD → segmentación → *embeddings* de hablante → agrupamiento.

El VAD ya lo tenemos de E2. El agrupamiento se escribe a mano. Lo único que falta es el
modelo de *embeddings*, y **ECAPA-TDNN de SpeechBrain es Apache 2.0** — sin gate, sin
restricción comercial. **[hipótesis]**, y es lo primero que verifica E4.

Esto cambia el tono de E4: de «probablemente haya que ir al servidor» a «hay un camino
local plausible que hay que probar primero».

---

# E0 · Medir antes de prometer

**Tamaño: M · Sin interfaz, sin despliegue, sin producto.**

## Objetivo

Reemplazar los números derivados del plan por números medidos, y elegir el modelo por
defecto con evidencia. Hoy la afirmación «una hora de audio tarda 30–60 minutos» encadena
dos extrapolaciones y no la sostiene nada. Todo el proyecto se apoya en si el modelo
grande da RTF 0,3 o 1,0 en un equipo real: con 0,3 el navegador es el producto, con 1,0
hay que reordenar las etapas.

Existe además una razón específica de tu equipo: **tu GPU es una Radeon integrada con
driver de agosto de 2024**, y es la que acaba de tumbar Claude Desktop entera. Es el peor
escenario razonable para WebGPU, y por eso es un buen banco de pruebas — pero significa
que no puedo tomar tu equipo como representativo del caso bueno.

## Qué hago

**1. Armar el corpus y congelarlo.**
Audios de 1, 5, 30 y 120 minutos, en español y en inglés, en tres condiciones: limpio,
con ruido de fondo, y con varios hablantes solapados. Los corpus públicos con
transcripción de referencia son clips cortos, así que los tramos largos se arman
concatenando — y eso queda documentado, porque una concatenación tiene cortes que el
audio real no tiene.

Fuentes candidatas por licencia: Common Voice (CC-0), LibriSpeech (CC BY 4.0), FLEURS.
Más audio propio en español rioplatense, que ninguno de esos corpus cubre bien.

**Manifiesto SHA-256 del corpus**, como en tus repos de trading. Sin eso, una medición de
la semana que viene no es comparable con una de hoy.

**2. Escribir el banco.**
Corre **en el navegador**, no en Node, porque es donde va a correr el producto. Una ruta
`/bench` fuera del sitio público. Recorre la matriz completa: **seis modelos × dos
backends (WebGPU, WASM) × el corpus**.

| Modelo | Params | Licencia | Por qué está en la matriz |
|---|---|---|---|
| `whisper-tiny` | 39 M | MIT | piso, para equipos flojos |
| `whisper-base` | 74 M | MIT | candidato a por defecto si turbo no rinde |
| `whisper-small` | 244 M | MIT | ídem |
| `whisper-large-v3-turbo` | 809 M | MIT | el candidato principal — 1,2 GB |
| `lite-whisper-large-v3-turbo` | — | MIT | variante comprimida del turbo, **[hipótesis]** que baja peso sin perder mucho |
| `moonshine` (inglés) | 245 M | **MIT sólo el de inglés** | gana a large-v3 en inglés con 6× menos parámetros |

**Sobre Moonshine y su licencia.** Está diseñado para navegador y edge, no adaptado a
ellos, y en inglés supera a Whisper large-v3 con una fracción del tamaño. Pero **sólo el
modelo de inglés es MIT**: los de español y demás idiomas usan la *Moonshine AI Community
License*, que es **no comercial** y sólo aplica bajo 1 M US$ de facturación anual. Es una
licencia condicionada, del mismo tipo que descartó a Sortformer.

Por eso Moonshine entra **únicamente en el camino de inglés**, y lo que E0 tiene que
responder es si vale mantener dos motores: si Moonshine sirve, la descarga inicial para
audio en inglés baja de 1,2 GB a decenas de MB, que es una diferencia enorme en la
primera experiencia de uso. Para español, Whisper es la única opción con licencia limpia.

**3. Medir cuatro cosas por combinación.**

| Métrica | Cómo |
|---|---|
| RTF | tiempo de pared ÷ duración del audio |
| Pico de memoria | `performance.measureUserAgentSpecificMemory()`, con caída a `performance.memory` |
| Descarga del modelo | primera carga en frío, con la caché vacía |
| WER | contra la transcripción de referencia |

El WER necesita **normalización de texto definida por escrito antes de medir**:
minúsculas, sin puntuación, números a palabras, elisiones expandidas. Whisper trae un
normalizador para inglés; para español hay que escribirlo, y las decisiones que tome
(¿«2» y «dos» son iguales? ¿«¿» cuenta?) cambian el resultado varios puntos. Se fija
antes de ver ningún número, no después.

**4. Medir en dos equipos.**
El tuyo y uno modesto. **El modesto es el que manda** para elegir el modelo por defecto:
si sólo anda bien en la máquina del que lo construyó, no es un producto.

**5. Decidir, por escrito y de antemano, qué pasa en cada escenario.**

| Si turbo en el equipo modesto da… | Entonces |
|---|---|
| RTF < 0,4 | turbo es el modelo por defecto, el plan sigue tal cual |
| RTF 0,4 – 0,8 | por defecto entra `small` o `base`; turbo queda como opción explícita con su tiempo estimado a la vista |
| RTF > 0,8 | el navegador no puede ser el único camino: E5 se adelanta y el camino de servidor deja de ser opcional |

Esto se escribe **antes** de correr las mediciones. Es la misma disciplina de tus
protocolos: fijar el criterio antes de ver el resultado, para que el número no elija la
regla.

## Terminado cuando

- Existe `benchmarks/resultados.md` con la matriz completa medida, y los datos crudos en
  CSV junto al manifiesto SHA-256 del corpus.
- La regla de normalización de WER está escrita y versionada, con fecha anterior a la
  primera medición.
- El modelo por defecto está elegido, y la elección apunta a una fila de la tabla.
- **Ningún número derivado del plan sobrevive sin confirmarse o corregirse.**

## No entra

Interfaz, despliegue, formatos de salida, nada de producto.

## Riesgo

Que WebGPU sea inestable en tu Radeon y contamine las mediciones. Mitigación: las tres
corridas de cada combinación tienen que ser consistentes entre sí; si divergen, se
reporta la varianza en vez de promediar y llamarlo dato.

---

# E1 · Audio entra, texto sale

**Tamaño: L · Primera etapa con producto lanzado.**

## Objetivo

Que exista una herramienta desplegada que hace bien **una sola cosa**: tomar un archivo
de audio y devolver su texto, sin que el audio salga del equipo. Todo lo demás del
catálogo se construye encima de esto, así que este cimiento tiene que ser sólido antes de
agregarle nada.

## Qué hago

**1. Andamiaje, calcado de OpenPDF.**
Next.js 16 App Router, React 19, Tailwind 4, TypeScript, vitest. Bilingüe por URL
(`/es` por defecto, `/en`). No invento estructura nueva: el patrón de `src/lib/` y
`src/app/[lang]/` ya está probado en producción y ya lo conocés.

**2. El motor, en `src/lib/asr/`.**

- `capabilities.ts` — detecta si hay WebGPU, cuánta memoria declara el equipo
  (`navigator.deviceMemory`), y decide qué modelo puede correr. **No fuerza
  `device: 'webgpu'`**: hay reportes de Firefox colgado 200 segundos al forzarlo, así que
  se deja autodetectar y se registra qué eligió.
- `audio.ts` — decodifica con `AudioContext.decodeAudioData` y remuestrea a **16 kHz
  mono** con `OfflineAudioContext`, que es lo único que Whisper acepta.
- `chunker.ts` — parte en ventanas de 30 s con solapamiento, porque Whisper fue entrenado
  sobre ventanas de 30 s y no procesa audio arbitrario de una.
- `worker.ts` — transformers.js dentro de un **worker propio desde el día uno**. No es un
  refactor para después: si el modelo corre en el hilo principal, la pestaña se congela
  minutos enteros y no hay forma elegante de arreglarlo más tarde.
- `engine.ts` — la API pública, con degradación automática al hilo principal si el worker
  falla (mismo patrón que `src/lib/studio/` en OpenPDF).

**3. Decidir dónde vive el modelo. Acá, no en E3.**
Por el hallazgo (1) de arriba. Dos opciones, y hay que probarlas:

- **Desde el CDN de Hugging Face** — simple, sin coste de ancho de banda, pero depende de
  un tercero y **puede romperse cuando E3 active COOP/COEP**. Hay que verificar si HF
  sirve `Cross-Origin-Resource-Policy: cross-origin`. **[hipótesis]**
- **Servido desde nuestro dominio** — inmune al problema, pero son 1,2 GB por descarga y
  hay que mirar los límites y el coste de Vercel.

Se decide con la prueba hecha, y se documenta. Si el hallazgo (2) resulta cierto y
WebCodecs nos evita COOP/COEP, esta decisión se relaja — pero no se puede *asumir* eso
todavía.

**4. La honestidad en la puerta, que es el rasgo distintivo.**
Antes de empezar, la herramienta transcribe **10 segundos del propio archivo**, mide
cuánto tardó en *ese* equipo, y con eso estima el total. Muestra: «este archivo, acá,
unos N minutos». Recién entonces ofrece el botón.

Esto no es un adorno: es lo que separa una herramienta honesta de una que te deja mirando
una barra durante cuarenta minutos. El RTF de E0 da el punto de partida; la calibración
en vivo lo corrige por equipo.

**5. Progreso real.** Por fragmento efectivamente procesado. Nunca una animación que
avanza sola.

**6. Idioma.** Detección automática de Whisper, con selector manual para forzarlo — la
detección falla en audio corto o con mezcla de idiomas.

**7. Interfaz mínima y despliegue.** Portada bilingüe, zona para soltar el archivo,
panel de resultado, copiar y descargar TXT. A Vercel. **Esto ya está lanzado.**

**8. Una nota de privacidad que dice la verdad completa.**
La promesa es «tu audio nunca sale de tu equipo», y es cierta. Pero **se descarga un
modelo de 1,2 GB desde un tercero**, y eso es una petición de red que el usuario merece
saber que ocurre. La nota lo dice: el audio no sale, el modelo entra. Prometer «nada sale
de tu equipo» a secas sería falso.

## Terminado cuando

- Un archivo de 5 minutos se transcribe de punta a punta **en producción**, en Chrome y
  en Firefox.
- La estimación previa cae dentro del **±25 %** del tiempo real, medido sobre al menos
  diez archivos del corpus de E0.
- El panel de red demuestra que no se subió ningún byte de audio.
- Tests: decodificación y remuestreo a 16 kHz, fragmentación con solapamiento, y la
  degradación worker → hilo principal.

## No entra

Video, subtítulos, marcas de tiempo, diarización, edición, cuentas de usuario.

---

# E2 · El tiempo: subtítulos y editor

**Tamaño: L · Acá deja de ser una demo.**

## Objetivo

Anclar el texto al tiempo. Una transcripción sin marcas temporales es un bloque de texto;
con ellas es subtítulos, es material citable, es navegable. Y es donde se ataca el defecto
más serio del modelo.

## Qué hago

**1. VAD (Silero) antes del modelo. Lo primero de la etapa.**

Silero VAD tiene versión ONNX de ~1,8 MB, licencia MIT, y corre con onnxruntime-web, que
ya está en el proyecto por transformers.js. **[verificado]** que es el estándar del
ecosistema faster-whisper.

Hace tres cosas a la vez: mata la mayor parte de las alucinaciones en silencio, reduce el
cómputo (menos audio que procesar) y mejora la segmentación.

**El detalle que hay que hacer bien:** el VAD **cambia la línea de tiempo**. Al recortar
silencios, los tiempos que devuelve Whisper corresponden al audio recortado, no al
original. Hay que mapearlos de vuelta. Es una fuente de errores sutiles —un desfase de
subtítulos que crece a lo largo del archivo— y lleva **test propio con audio construido a
propósito**, no un vistazo.

Complemento: escala de temperatura creciente en lugar de temperatura fija, que es la otra
mitigación establecida contra el bucle de repetición.

**2. El test de alucinación, con control.**

Este es el test que más me importa de todo el proyecto, y sigue tu regla de OpenPDF sobre
qué no puede ver una comprobación.

Audio construido: `[30 s de silencio][una frase conocida][30 s de silencio]`.

Verifica dos cosas, no una:
- que **no** aparece texto en los tramos de silencio, y
- que **sí** aparece la frase conocida.

Sin la segunda mitad, un resultado vacío no distingue «funcionó» de «la transcripción
está rota». Y el test tiene que **fallar** si se desactiva el VAD: si pasa con el VAD
apagado, no está probando lo que dice probar.

**3. Marcas de tiempo por segmento y por palabra.**
transformers.js soporta `return_timestamps: 'word'`. Hay que medir su precisión real
contra el corpus de E0 — **[hipótesis]** que alcanza para sincronizar el editor.

**4. Exportadores, en `src/lib/export/`.**
No es serializar: los formatos de subtítulo tienen convenciones que, si se ignoran, dan
archivos que abren pero se leen mal.

- Máximo ~42 caracteres por línea, máximo 2 líneas por subtítulo.
- Duración mínima ~1 s, máxima ~7 s.
- Velocidad de lectura ~17 caracteres por segundo; si un segmento la supera, se parte.
- Los cortes respetan límites de palabra y, cuando se puede, de sintagma.
- **SRT**: numeración desde 1, `HH:MM:SS,mmm` con **coma**, saltos CRLF.
- **VTT**: cabecera `WEBVTT`, `HH:MM:SS.mmm` con **punto**.

**5. Editor con audio sincronizado.**
Lista de segmentos junto a un `<audio>`. Clic en una palabra y el audio salta ahí; el
segmento que suena queda resaltado vía `timeupdate`; el texto se corrige en el lugar.

**6. Persistencia en IndexedDB**, con el patrón que OpenPDF ya resolvió: el audio original
se guarda **una sola vez**, y las ediciones van como lista incremental. Escribir el audio
entero en cada tecleo es exactamente el error que OpenPDF ya cometió y arregló.

## Terminado cuando

- Un SRT exportado abre correctamente en **VLC y en YouTube** (son estrictos de formas
  distintas).
- El test de alucinación pasa **y falla al quitar el VAD**, comprobado ejecutándolo.
- El mapeo de tiempos tras el VAD tiene test con audio construido, y no acumula desfase
  en un archivo de 30 minutos.
- Editar un segmento, cerrar la pestaña y volver conserva el cambio.

## No entra

Video, diarización, traducción.

---

# E3 · Video y formatos de documento

**Tamaño: M**

## Objetivo

Aceptar lo que la gente realmente tiene —un mp4 de una reunión, un mov del teléfono— y
entregar en los formatos que realmente usa: Word y PDF, no sólo TXT.

## Qué hago

**1. Primero, la prueba que decide el camino.**
Por el hallazgo (2). Dos opciones, y se prueban antes de elegir:

| | ffmpeg.wasm | WebCodecs + mp4box.js |
|---|---|---|
| Cabeceras COOP/COEP | **necesarias** | no |
| Peso | varios MB | mínimo |
| Cobertura de formatos | amplia | según el navegador |
| Riesgo | rompe recursos de otro origen | soporte desigual |

Si WebCodecs cubre mp4, mov, mkv y webm en Chrome, Firefox y Safari, **gana**: el sitio
se ahorra COOP/COEP entero y con eso desaparece el riesgo del hallazgo (1). Si no cubre
lo suficiente, ffmpeg.wasm con las cabeceras — y entonces hay que **volver a verificar
que la descarga del modelo de E1 sigue funcionando**, que es justamente la regresión que
esta prueba existe para evitar.

Sea cual sea el resultado, la salida es la misma: wav 16 kHz mono hacia el motor de E1.

**2. Exportadores de documento, reutilizando OpenPDF.**
- **DOCX** con `docx`, que ya está en tu `package.json`.
- **PDF** con pdf-lib, aprovechando `textLayout.ts` de OpenPDF para el flujo de texto.
- **CSV** con tiempos, hablante y texto, para quien quiera procesarlo.

Formato del documento: marcas de tiempo en el margen, texto en columna legible,
encabezado con nombre del archivo y duración. Es un documento para leer, no un volcado.

**3. Verificación de que nada sale.**
Con video el archivo es más pesado y la tentación de subirlo es mayor. El criterio de
cierre lo comprueba explícitamente en el panel de red.

## Terminado cuando

- Un mp4 de 20 minutos produce transcripción y subtítulos **sin subir un byte**,
  comprobado en el panel de red del navegador.
- El camino elegido (WebCodecs o ffmpeg.wasm) está documentado **con la prueba que lo
  justifica**, no con una preferencia.
- Si se activó COOP/COEP: el sitio entero se reverificó, incluida la descarga del modelo.
- Un DOCX y un PDF exportados abren en Word y en un lector de PDF, con los tiempos en su
  lugar.

## No entra

Diarización, traducción, resúmenes.

---

# E4 · Quién habla

**Tamaño: L · La etapa con más incertidumbre.**

## Objetivo

Separar y etiquetar hablantes. Es lo que convierte una transcripción de entrevista o
reunión en algo utilizable, y es la función que más se pide después de la transcripción
misma.

Pero es la etapa donde **el obstáculo es de licencia, no de dificultad técnica**, y por eso
empieza averiguando en vez de construyendo.

## Qué hago

**Fase A — Viabilidad. Sin código de producto.**

La tubería de diarización tiene cuatro piezas: VAD → segmentación → *embeddings* de
hablante → agrupamiento. **El VAD ya lo tenemos de E2** y el agrupamiento se escribe a
mano. Lo único que falta es el modelo de *embeddings*.

Inventario por licencia:

| Modelo | Licencia | Sirve |
|---|---|---|
| pyannote.audio | código MIT, **modelos con gate en HF** | no directamente en el navegador |
| Sortformer (NVIDIA) | **CC-BY-NC** | no, es un producto |
| **ECAPA-TDNN (SpeechBrain)** | **Apache 2.0** | **candidato principal** |
| WeSpeaker / 3D-Speaker | a verificar | suplentes |

**[hipótesis] a probar:** ECAPA-TDNN exportado a ONNX + agrupamiento aglomerativo escrito
a mano da una diarización utilizable en el navegador, sin depender de pyannote.

Se mide con **DER** sobre un corpus con referencia de hablantes, y se compara contra el
DER publicado de pyannote para saber cuánto se está resignando. Si la brecha es enorme, la
respuesta honesta es que la vía local no sirve *todavía*.

**Fase B — Según el resultado.**

- **Si es viable:** diarización local, etiquetas renombrables, un color por hablante, y
  los hablantes propagados a todos los exportadores — `<v Nombre>` en VTT, `Nombre:` en
  TXT y DOCX, columna propia en CSV.
- **Si no es viable:** se ofrece como **opción en servidor**, apagada por defecto, detrás
  de un consentimiento que diga en rojo y sin eufemismos que eso sube el audio a un
  tercero. El resto de la herramienta sigue siendo local. No se activa por descuido y no
  se activa por defecto.

## Terminado cuando

- **O bien** corre local, con el DER medido y publicado junto al de pyannote como
  referencia.
- **O bien** la vía servidor existe detrás de un consentimiento explícito, **con un test
  que verifica que no se puede saltear** — que ninguna ruta de código suba audio sin que
  el usuario lo haya aceptado en esa sesión.
- En cualquiera de los dos casos: la decisión y su evidencia quedan escritas.

## No entra

Traducción, resúmenes.

## Riesgo

Es la etapa que puede terminar en «no se puede localmente». Ese resultado **no es un
fracaso**: es información, y llega antes de haber construido encima. La fase A existe
precisamente para que ese descubrimiento cueste poco.

---

# E5 · Escala, y lo que falta del catálogo

**Tamaño: L**

## Objetivo

Que un archivo real —dos horas de reunión— no rompa nada, y cerrar las funciones del
catálogo de TurboScribe que faltan, cada una con su decisión de privacidad explícita.

## Qué hago

**1. Archivos largos, que es lo que de verdad importa.**
Fragmentación con **persistencia incremental**: cada fragmento transcrito se guarda apenas
termina. Cerrar la pestaña a la mitad y volver reanuda donde iba. Sin esto, dos horas de
proceso se pierden con un cierre accidental, y eso es inaceptable.

Un tope declarado y medido, al estilo del `MAX_EDITABLE_BYTES` de OpenPDF — un número que
sale de una medición, no de una intuición.

**2. Cola de varios archivos**, procesados en serie, con progreso por archivo.

**3. Traducción, con una decisión de licencia que ya investigué.**
- NLLB-200 destilado: **CC-BY-NC**, descartado.
- **Opus-MT (Helsinki-NLP): Apache 2.0** — sirve. Son modelos por par de idiomas, chicos,
  así que se descarga sólo el par que hace falta. **[hipótesis]**: la calidad alcanza para
  subtítulos.

Traducción local mantiene la promesa entera. Si la calidad no alcanza, se ofrece vía API
como opción explícita, nunca por defecto.

**4. Resumen con IA — donde la promesa se tensa.**
Un resumen necesita un LLM. Local en WebGPU significa otro modelo grande que descargar;
por API significa **mandar la transcripción a un tercero**.

La transcripción es el contenido, no el audio, pero mandarla afuera contradice el espíritu
de la herramienta. Así que: si es por API, va **apagado por defecto, con consentimiento
explícito por uso**, y dice qué se manda y a dónde. No se activa solo.

**5. Camino de servidor opcional**, para archivo larguísimo o equipo flojo. Con el coste y
la implicancia de privacidad dichos de frente, en la interfaz, no en una página de
términos.

## Terminado cuando

- Un archivo de **2 horas** se procesa entero en el equipo modesto de E0 — o la
  herramienta dice **antes de empezar** por qué no puede y qué alternativa hay.
- Cerrar la pestaña al 50 % y reabrir reanuda sin reprocesar lo hecho, verificado con test.
- Toda función que mande datos afuera está apagada por defecto y tiene test de que no se
  activa sin consentimiento.

---

## Dependencias entre etapas

```
E0 ──▶ E1 ──▶ E2 ──▶ E3 ──▶ E5
              │       │      ▲
              └─▶ E4 ─┴──────┘
```

- **E0 → E1**: E1 no puede elegir modelo por defecto sin las mediciones.
- **E2 → E4**: la diarización reutiliza el VAD de E2. Hacer E4 antes obliga a escribirlo dos veces.
- **E1 ↔ E3**: la decisión de dónde vive el modelo se toma en E1 *porque* E3 puede romperla.
- **E4 → E5**: los hablantes tienen que existir antes de exportarlos y traducirlos.

E3 y E4 son independientes entre sí: si E4 se traba en la fase de viabilidad, E3 avanza igual.

---

## Lo que sigue igual que en el plan grueso

- No se van a igualar los 10 h / 5 GB de TurboScribe en el navegador.
- El navegador es el camino por defecto; el servidor, un escape explícito.
- Falta que elijas el nombre — **OpenSRT** recomendado; libres también OpenParla y OpenLoqui.
