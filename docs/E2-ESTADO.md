# E2 — estado

Actualizado: 26 de agosto de 2026.

**Objetivo de la etapa:** anclar el texto al tiempo. Que la transcripción deje de ser un
bloque de texto y pase a ser subtítulos, material citable y navegable — y atacar de paso el
defecto más serio que E1 dejó medido y sin resolver.

---

## Hecho

### El detector de voz y la fragmentación, en `src/lib/vad/`

| Módulo | Qué resuelve |
|---|---|
| `silero.ts` | Silero VAD v5 en ONNX (MIT, 2,2 MB), reusando el onnxruntime que ya trae transformers.js |
| `segments.ts` | probabilidades → tramos de habla → bloques que entran en la ventana del modelo |
| `align.ts` | reparte el texto del bloque entre sus tramos, y detecta omisiones |

El orden de `toSegments` no es intercambiable: primero se fusionan los silencios cortos y
después se descartan los tramos breves. Al revés, un tramo corto rodeado de silencios
cortos se eliminaría antes de poder fusionarse con sus vecinos.

`toBlocks` corta **siempre en bordes de tramo**. Un corte calculado por tiempo partiría una
palabra al medio, y el modelo transcribiría dos mitades sin sentido.

### Los exportadores, en `src/lib/export/`

`subtitles.ts` aplica las convenciones del subtitulado: 42 caracteres por línea, 2 líneas,
1 a 7 segundos, 17 caracteres por segundo de velocidad de lectura. Un tramo que no entra se
parte en varios subtítulos repartiendo el tiempo; uno que parpadea se estira sin invadir al
siguiente. SRT con coma y CRLF; VTT con punto y cabecera `WEBVTT`.

### El editor y la persistencia

`Editor.tsx` muestra los tramos junto a un `<audio>`: el tiempo es un botón que salta a esa
parte, el tramo que suena queda resaltado, y el texto se corrige en el lugar.

`src/lib/store/session.ts` guarda la sesión en IndexedDB. **El audio se escribe una sola
vez**; cada corrección toca **un solo registro** de la tabla de tramos. Si audio y texto
vivieran juntos, corregir una coma reescribiría el archivo entero: en un audio de una hora,
unos 100 MB por tecla.

El texto y el audio van en **transacciones separadas** a propósito. El audio es lo único que
puede reventar la cuota del navegador, y si fuera todo junto un archivo grande se llevaría
puesta también la transcripción. En el peor caso queda el texto y se pierde sólo la
reproducción, y la interfaz lo dice.

---

## Lo medido

### El desfase en 30 minutos

El riesgo que había que descartar: un corrimiento de subtítulos que crece con el archivo.
Es el error clásico de esta parte y el peor de notar, porque los primeros minutos salen
bien.

`scripts/build-drift-audio.mjs` arma media hora de audio colocando frases reales de OpenSLR
en posiciones que **conoce porque las eligió**: `[2 s][frase][1,2 s][frase]…`. Los bordes de
cada frase se recortan por amplitud, no con el detector — recortar con Silero para después
evaluar a Silero sería compararlo consigo mismo.

| | |
|---|---|
| Frases colocadas | 456 |
| Tramos detectados | 495 |
| Emparejadas | **456 de 456** |
| Sesgo (mediana del error) | −0,078 s |
| Pendiente del error | 0,027 ms/s |
| **Crecimiento en todo el archivo** | **0,049 s** |
| Primer tercio · último tercio | −0,014 s · +0,014 s |

Los 49 ms de crecimiento son **una ventana y media del detector**, que trabaja en pasos de
32 ms. No es desfase: es la resolución del instrumento.

Los 495 tramos contra 456 frases no son un error: el detector partió unas cuarenta frases en
dos, casi siempre donde el hablante hace una pausa interna. El emparejamiento se queda con
el tramo que más se superpone, y el resultado —456 de 456 emparejadas— dice que en esos
casos ganó la primera mitad, que es la que marca el comienzo.

El sesgo constante de −78 ms tampoco lo es. El detector agrega 100 ms de aire a cada lado
del tramo, así que empieza un poco antes de la primera sílaba. Eso no desincroniza nada; lo
que desincroniza es que el error **crezca**, y no crece.

**El control.** Se le inyectó un desfase a propósito, estirando los tiempos un 0,02 %:

| | inyectado | medido | emparejadas |
|---|---|---|---|
| Desfase chico | 0,360 s | **0,367 s** | 456/456 |
| Desfase grande | 1,800 s | 0,358 s | 432/456 |

El primero prueba dos cosas: que la comprobación suena, y que **mide bien** — un detector
que dispara con cualquier cosa no serviría para decir cuánto se corrió.

El segundo está escrito como control del control, porque limita lo que este test puede
afirmar: **con un desfase grande la medición se queda corta**. Los tramos del final dejan de
superponerse con la frase que les toca, se pierden del emparejamiento o se enganchan con la
vecina, y la pendiente sale menor que la real. Para decidir si hay acumulación o no alcanza;
como medida exacta de cuánto, es un piso.

### La alucinación en los tramos sin voz

Audio construido: `[30 s de sala vacía][una frase conocida][30 s de sala vacía]`, con tres
frases distintas. «Sala vacía» es ruido de fondo a unos −60 dBFS, no silencio digital: el
silencio de ceros exactos casi no existe fuera de un test.

El camino con detector usa `transcribeBlocks`, **la función del producto**. No una copia del
bucle escrita para el test: una copia probaría la copia.

| | con detector | sin detector |
|---|---|---|
| `arm_09697…` | 0 inserciones | 2 — `[Música]` … `[Música]` |
| `arm_01523…` | 0 inserciones | 2 — `[Música]` … `[Música]` |
| `arm_04310…` | 0 inserciones | 2 — `[Música]` … `[Música]` |
| con ceros exactos | 0 inserciones | 2 — `y` … `y` |

En los tres casos con detector la frase salió transcrita y el tramo detectado cayó donde
estaba la voz (por ejemplo 29,9–32,6 s para una voz colocada en 30,0–32,5 s).

**Cómo se llegó a medir esto, que costó dos intentos fallidos.**

1. *Buscar fragmentos con marca de tiempo caídos en la zona sin voz.* No sirve: el modelo
   devuelve el archivo entero como **un solo fragmento** `0 → 62,5 s`. Sus tiempos no
   localizan nada.
2. *Contar las palabras del resultado que no estén en la frase.* Tampoco: mezcla dos cosas
   distintas. `whisper-base` tiene 29,6 % de WER y escribió `favoritos` donde la frase decía
   `favorito`, y `písama` donde decía `pijama`. Eso es **error de reconocimiento**, no
   invención — el modelo oyó mal una palabra que sí se dijo.
3. *Contar las **inserciones** del alineamiento de WER.* Esa es la distinción correcta y ya
   estaba construida y probada en `src/lib/bench/wer.ts`: `favoritos` por `favorito` es una
   sustitución; `[Música]` donde no habló nadie es una inserción.

Con el instrumento correcto, el resultado es limpio y reproducible: **cero invención con el
detector, dos inserciones sin él, en los tres casos**.

### Los subtítulos en un reproductor de verdad

`srt-format.test.ts` compara la salida contra un analizador estricto escrito leyendo la
especificación. Si entendí mal la especificación, el analizador y el exportador comparten el
error y los dos tests pasan. VLC 3.0.20 es un **oráculo independiente**.

| archivo | qué dice VLC |
|---|---|
| SRT del exportador | `detected SubRIP format` · `loaded N subtitles` |
| VTT del exportador | `using demux module "webvtt"` |
| CONTROL basura | ningún demultiplexor lo reconoce |
| CONTROL sin líneas en blanco | carga **menos** subtítulos de los que hay |
| CONTROL sin la parte de horas | detecta otro formato y carga **cero** |
| CONTROL VTT sin cabecera | lo toma como SubRIP, no como WebVTT |

**Un hallazgo que conviene no disimular: VLC acepta un SRT con puntos en vez de comas** y
carga sus subtítulos igual. Así que «abre en VLC» **no** verifica esa convención. La sostiene
`srt-format.test.ts`, que sí la exige. Confundir una comprobación laxa con una estricta es
justamente lo que este proyecto trata de no hacer.

### El estado de la suite

**293 tests en 18 archivos** (los 122 de E1 más los de VAD, subtítulos, persistencia,
desfase, alucinación, VLC y runtime). **52 mutantes, todos muertos.** Los tres de esta etapa
que más importan:

| mutante | atrapado por |
|---|---|
| el reloj del detector corre 0,02 % rápido | el desfase de 0,36 s a los 30 minutos |
| los bloques no se recortan: el modelo recibe el archivo entero | vuelven las alucinaciones |
| el aviso de omisión nunca se enciende | el modelo se saltea un tramo y nadie avisa |

El segundo es el que sostiene el test de alucinación: prueba que mide **el aporte del
detector**, no que el audio sea fácil.

---

## Lo que sólo se vio en el navegador

Los 293 tests pasaban, la mutación estaba en verde y el build limpio. **La herramienta no
funcionaba.** Los dos defectos que siguen no los podía ver ningún test de Node, y valen como
recordatorio de para qué sirve abrir la página.

### 1. La CSP bloqueaba el motor, y tenía razón

transformers.js, si nadie le dice lo contrario, apunta las rutas de sus archivos WASM a
jsdelivr. La consola decía:

    Loading the script 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/
    ort-wasm-simd-threaded.jsep.mjs' violates the following Content Security Policy
    directive: "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'"

El modelo no cargaba. Y la CSP hizo exactamente lo que tenía que hacer: eso era **descargar y
ejecutar código de un tercero** en cada transcripción, en una herramienta cuyo argumento es
que el trabajo ocurre en tu equipo.

El arreglo no fue aflojar la CSP sino **servir el runtime nosotros**:
`scripts/vendor-ort.mjs` copia los cuatro archivos del backend WASM —31 MB— desde el paquete
instalado a `public/ort/` antes de cada `build`, `dev` y `test`, y `src/lib/asr/runtime.ts`
fija la ruta **antes** de llamar a `pipeline(...)`, porque transformers pone su valor por
defecto sólo «si no está ya puesto».

`runtime.test.ts` compara byte por byte lo servido contra `node_modules`, con control: una
copia alterada tiene que dar otro hash. Sin eso, subir la versión de onnxruntime dejaría un
`.wasm` viejo con un cargador nuevo — un fallo que no rompe la compilación, sólo devuelve
basura.

### 2. El detector de voz nunca habría arrancado

`silero.ts` tomaba `env.backends.onnx` de transformers creyendo que ahí estaba el espacio de
nombres de onnxruntime. **La suposición era equivocada**: ahí está su `env`, que es sólo
configuración. `InferenceSession` era `undefined` y el detector reventaba apenas se lo usaba.

Ningún test lo veía porque los de integración cargan `onnxruntime-node` directo y **no pasan
por esa clase**. El comentario del módulo decía, con toda seguridad, que reutilizaba el
runtime de transformers; ahora dice lo que hace de verdad y por qué el primer intento estaba
mal.

Cuesta una segunda instancia del runtime. Los archivos son los mismos y el navegador los
cachea, así que se paga en memoria, no en descarga.

### El flujo completo, cronometrado en Chrome

Archivo de 1 minuto y 7 segundos, perfil `base-wasm` forzado con `?perfil=base-wasm`:

| | |
|---|---|
| Modelo listo | 6 s |
| Detector listo | 9 s |
| Voz detectada | 11 s |
| Transcripción terminada | **35 s** · 14 tramos · 113 palabras |

En pantalla, mientras corría: «57 segundos de 1 minuto y 7 s · **Bloque 2 de 3** · Falta
menos de un minuto». El avance por bloques es exacto, no estimado.

### El criterio de cierre, comprobado

Corregir un tramo, cerrar la pestaña y volver:

1. Se corrigió el tramo 5 → apareció la marca «editado».
2. Se recargó la página → «Se recuperó tu última transcripción: prueba-e2.wav».
3. Se abrió → los 14 tramos, el tramo 5 con el texto corregido y su marca, y el reproductor
   con el audio recuperado de IndexedDB.

Comprobado **leyendo IndexedDB directamente**, no mirando la pantalla: la pantalla podría
estar mostrando estado en memoria.

### La red, durante todo el proceso

Un solo origen: `http://localhost:3000`. Ningún tercero, ningún POST, ninguna subida. El
modelo ya estaba en la caché del navegador de una sesión anterior; la primera vez aparece
también `huggingface.co`, que es lo que la nota de privacidad declara.

El SRT descargado: CRLF, comas, **20 subtítulos a partir de 14 tramos** — el exportador
partió los que no entraban en su tiempo de lectura.

---

## Lo que no está verificado

- **YouTube.** El plan lo pedía junto con VLC. No hay forma de comprobarlo sin subir
  contenido a una plataforma, así que queda **declarado como no comprobado**, no dado por
  bueno.
- **Firefox.** Sigue pendiente de E1. El camino sin GPU se ejercita en Chrome con
  `?perfil=base-wasm`, que es el mismo código.
- **Marcas de tiempo por palabra.** El plan las tenía como punto 3, con la hipótesis de que
  harían falta para sincronizar el editor. **No hicieron falta y no se implementaron.** Los
  tiempos salen del detector, que da bordes de tramo exactos y no cuesta WER; pedírselos al
  modelo sube el error de 3,03 % a 4,52 % en audio difícil, medido en E1. El editor sincroniza
  por tramo y eso alcanza para saltar al audio y corregir. Si en alguna etapa hace falta
  resaltar palabra por palabra, hay que volver a medir, no asumir.
- **La causa de la asimetría español/inglés en las omisiones** que midió E1 (0 de 23 contra
  3 de 23). E2 permite **avisar** cuando pasa; no explica por qué pasa.

## Limitaciones que quedaron documentadas

- **El detector no distingue la voz principal del murmullo de fondo.** Sólo sabe si hay voz
  humana. En una grabación con conversaciones detrás, marca las dos como habla. Salió de un
  control que falló: el primer intento usó el murmullo del corpus como ejemplo de «no habla»
  y el detector lo marcó con 0,92 de probabilidad. La suposición equivocada era mía — ese
  murmullo está hecho con voces.
- **El reparto del texto dentro de un bloque es aproximado** cuando la cantidad de oraciones
  no coincide con la de tramos. Los bordes de cada tramo siguen siendo exactos —los dio el
  detector—; lo que puede quedar corrido es en qué tramo cae el corte del texto. Para
  subtítulos eso significa que una palabra puede aparecer en la línea de al lado, no que el
  subtítulo se desincronice del audio.
- **Sólo se guarda el resultado terminado, no el avance.** Cerrar la pestaña a mitad de una
  transcripción la pierde. La interfaz lo dice en los archivos largos.

## Una decisión de privacidad que hay que declarar

La persistencia deja el audio del usuario **guardado en el disco de su máquina**. No sale del
navegador —eso lo garantiza la CSP y está verificado en el panel de red— pero sobrevive a
cerrar la pestaña, que es exactamente para lo que está.

Por eso hay tope de 5 sesiones, borrado explícito a un clic, y un texto que dice que quedó
guardado. Guardar el audio sin avisar habría sido lo cómodo.

## Un tropiezo del corredor de tests, no del código

Con tres archivos de integración cargando `onnxruntime-node` en hilos distintos a la vez, V8
se cae con un error fatal (`Check failed: !IsFreelistEntry()`) **antes de ejecutar un solo
test**: el módulo nativo no está preparado para vivir en varios isolates. De a un archivo
por vez pasan todos. Está resuelto con `fileParallelism: false` y anotado en
`vitest.config.mts`, junto al `pool: 'threads'` que ya había hecho falta por otra razón.
