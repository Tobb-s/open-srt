# E4 — estado

Actualizado: 26 de agosto de 2026. **Fase A cerrada · Fase B en el producto.**

**Objetivo de la etapa:** separar y etiquetar hablantes. El plan la marcaba como *la etapa con
más incertidumbre*, y decía que empezara averiguando en vez de construyendo porque el
obstáculo esperado era **de licencia, no técnico**.

---

## La respuesta: la vía local es viable

El plan se equivocaba sobre dónde estaba el problema. Su inventario decía que pyannote está
tras un gate, que Sortformer es CC-BY-NC, y que la única salida era ECAPA-TDNN de SpeechBrain
(Apache 2.0). Contrastado contra la API de Hugging Face:

| repo | licencia | gate | ONNX | desc/mes |
|---|---|---|---|---|
| **`onnx-community/pyannote-segmentation-3.0`** | **MIT** | no | **sí, 8 variantes** | 9 579 |
| **`onnx-community/wespeaker-voxceleb-resnet34-LM`** | **CC-BY-4.0** | no | **sí, 8 variantes** | 2 162 |
| `Wespeaker/wespeaker-ecapa-tdnn512-LM` | cc-by-4.0 | no | sí (23,7 MB) | 108 |
| `speechbrain/spkrec-ecapa-voxceleb` | apache-2.0 | no | **no tiene** | 1,9 M |
| `pyannote/embedding` | mit | **sí** | no | 893 k |
| `pyannote/speaker-diarization-3.1` | mit | **sí** | no | 10 M |
| `nvidia/diar_sortformer_4spk-v1` | **cc-by-nc** | no | no | 169 k |

Los dos primeros son **los modelos de la tubería de pyannote 3.1**, portados a ONNX, sin gate
y con licencias que permiten uso comercial. Y transformers.js —que el proyecto ya usa— exporta
`PyAnnoteForAudioFrameClassification` y `WeSpeakerFeatureExtractor`: la biblioteca ya sabe
correrlos.

El candidato principal del plan resultó ser el peor de los tres: Apache 2.0 pero sin ONNX, o
sea que habría que exportarlo con PyTorch y escribir el banco de filtros de mel a mano.

**Tamaño:** 25 MB el de embeddings. Junto a los ~800 MB de Whisper turbo, no se nota.

---

## Que corra no alcanza: que separe

Un modelo mal alimentado —bandas de mel equivocadas, sin normalizar— **igual devuelve 256
números**. No falla. La única forma de saber que la tubería está bien armada es comprobar que
los embeddings separan.

Sobre 12 clips de 4 hablantes del corpus:

| | |
|---|---|
| Mismo hablante | **0,766** de similitud (12 pares) |
| Distinto hablante | **0,181** (54 pares) |
| Peor par del mismo hablante | 0,656 |
| Mejor par de distintos | 0,464 |

El peor caso propio está holgadamente por encima del mejor caso ajeno: hay margen para
agrupar con un umbral.

**Control:** con las etiquetas de hablante barajadas, la brecha cae de 0,585 a **0,029**. Sin
eso, el 0,585 no distinguiría «el modelo separa hablantes» de «estos embeddings se parecen por
cualquier otra razón».

---

## La referencia, y el defecto que tenía

Para medir DER hace falta saber quién habla en cada segundo. El corpus registraba **cuántos**
hablantes tiene cada ítem, no cuándo habla cada uno.

`scripts/build-corpus.mjs --linea-de-tiempo` la genera **sin escribir un byte de audio**: el
constructor la calcula en el mismo lugar donde coloca los trozos, y verifica cada ítem
recalculando su SHA-256 contra el manifiesto. Los 20 coincidieron. Si alguno no coincidiera, el
script se planta: una referencia que no corresponde al audio haría mentir a toda medición que
se apoye en ella.

### El primer intento medía mi instrumento, no el sistema

La primera versión anotaba el **intervalo entero de cada turno**, así que la referencia cubría
el 100 % del archivo y declaraba habla también durante los silencios internos de cada frase
leída. El DER dio 27,9 % y estaba dominado por 65 segundos de «omitido» que eran silencio que
el detector correctamente no marcó.

Corregido: la referencia marca **regiones con voz**, detectadas por energía — criterio
independiente del detector que se está evaluando. Y el resultado del cambio es, en sí mismo, el
argumento más fuerte de esta etapa:

| referencia | omitido | falsa alarma | **confusión** |
|---|---|---|---|
| turno entero (marca 100 % del archivo) | 65,5 s | 0,0 s | **0,0 s** |
| sólo regiones con voz (marca 55 %) | 0,2 s | 18,2 s | **0,0 s** |

Las dos primeras columnas se dieron vuelta por completo al cambiar la definición. **La tercera
no se movió.** El DER que se reporte depende de dónde se ponga la frontera del habla; la
atribución de hablante, no. Por eso lo que se afirma es la **confusión**, y el DER va siempre
con su desglose.

---

## El umbral, elegido sin mirar el examen

El umbral decide cuándo dos tramos son la misma persona. Barrerlo sobre los mismos ítems con
los que después se reporta el resultado daría el mejor número posible para ese audio y nada
más.

Se armaron dos conjuntos de **voces distintas** (`--multi-holdout`):

- **Elección:** `es-multi-3min` (`arm_00610`, `arm_01523`, `arm_02484`) y `en-multi-3min`.
- **Reporte:** `es-multi-holdout` (`arm_03397`, `arm_04310`, `arm_05223`) y `en-multi-holdout`.

El split `validacion` del corpus no servía: son clips distintos de los **mismos** hablantes, y
lo que hay que probar de un umbral de parecido entre voces es que generalice a **voces nuevas**.

### El barrido

| umbral | DER medio | confusión | grupos (reales 3/3) |
|---|---|---|---|
| 0,30 | 21,3 % | 15,89 % | 2/3 |
| **0,35 – 0,50** | **5,4 %** | **0,00 %** | **3/3** |
| 0,55 | 5,5 % | 0,13 % | 3/5 |
| 0,60 | 5,6 % | 0,24 % | 3/6 |
| 0,65 | 7,7 % | 2,28 % | 4/8 |
| 0,70 y más | no medible | — | demasiados grupos |

No hay un pico: hay una **meseta**. Se toma su centro, **0,475**, porque quedarse con el primer
mínimo deja el valor pegado a un borde y del otro lado el resultado se cae. El 0,55 que se usó
al principio estaba puesto a ojo y ya partía al inglés en cinco grupos.

### El resultado sobre voces que no participaron

| | DER (collar 0,25 s) | confusión | grupos |
|---|---|---|---|
| `es-multi-holdout` | **2,8 %** | 0,71 % | 4 (reales 3) |
| `en-multi-holdout` | **2,3 %** | 0,00 % | 4 (reales 3) |

**Control:** con todo en un solo grupo, 67,0 % y 58,5 %. Con un umbral demasiado alto, 6,3 % y
3,0 %. El elegido gana a los dos, así que el número no sale de que el problema sea fácil.

Sobre el conjunto de elección, con 0,475: DER 4,3 % y 6,4 %, **confusión 0,00 % en los dos
idiomas**, y los tres hablantes encontrados en ambos.

---

## Lo que estos números NO dicen

**No son comparables con el DER publicado de pyannote.** Este corpus es fácil por
construcción: frases leídas, tres hablantes, audio limpio, y sólo 0,25 s de solapamiento en
cada transición. Los benchmarks de la literatura (AMI, DIHARD) son conversación espontánea, con
ruido, interrupciones y solapes largos. Lo que estos números sostienen es que **la tubería
funciona y la vía local es viable**, no que iguale a pyannote.

Tres limitaciones concretas:

1. **El solapamiento no se detecta.** El sistema atribuye un hablante por tramo. En los 0,25 s
   donde hablan dos, uno se pierde por construcción.
2. **Tiende a partir de más.** En el holdout encontró 4 grupos donde hay 3, en los dos idiomas.
   El grupo de sobra es chico —la confusión es casi nula— pero en la interfaz aparecería como
   un hablante fantasma.
3. **Sólo se probó con tres hablantes.** Con ocho en una reunión, el agrupamiento y el umbral
   pueden comportarse distinto, y la búsqueda exhaustiva de correspondencias del DER se planta
   arriba de ocho.

---

# Fase B — en el producto

**No hizo falta la vía servidor.** El plan la tenía prevista por si lo local no alcanzaba, con
consentimiento explícito y un test que verificara que no se puede saltear. Queda descartada por
innecesaria, que es el mejor motivo para descartar algo.

## Cómo se enciende

Una casilla **apagada por defecto**, con el costo dicho antes de aceptar: 25 MB más de descarga
y una comprobación por cada tramo de voz. Quien transcribe a una sola persona no paga por algo
que no le sirve.

Se diariza **después** de transcribir, no antes. Si el modelo de hablantes falla o el usuario se
cansa de esperar, ya tiene su transcripción; al revés, un fallo en la parte opcional se llevaría
puesta la principal. Por lo mismo, un error cargando ese modelo **no es fatal** en el worker.

## Una invariante que ahora se comprueba

Los tramos de voz y el texto son 1 a 1 y en el mismo orden por construcción: `toBlocks` reparte
los tramos en orden y `alignBlockText` devuelve uno por tramo. Pero es una invariante **entre dos
módulos**: si se rompiera, cada nombre quedaría pegado al texto de otra persona y no fallaría
nada. Se verifica antes de pegar los nombres, y el error dice que es de programa, no del audio.

## Cada formato con su convención

| formato | cómo | por qué |
|---|---|---|
| **VTT** | `<v Martín>texto` | **el único con campo de verdad**: el reproductor sabe que es una persona |
| SRT | `Martín: texto` | SubRip no tiene campo; una línea aparte gastaría una de las dos que caben |
| TXT | `Martín: texto`, **sólo al cambiar** | repetirlo llenaría la página si Martín habla cinco tramos seguidos |
| CSV | columna propia | en una tabla el hablante es un campo por el que se filtra, no un prefijo que hay que desarmar |
| DOCX y PDF | bajo la hora, en negrita | los nombres forman una guía vertical sin robarle ancho al texto |

Dos detalles que salieron de escribir los tests: en VTT hay que **escapar** `<` y `&` —un texto
transcrito puede traerlos y el navegador corta la línea sin avisar— y el prefijo del SRT **se
repite** cuando un tramo largo se parte en varios subtítulos, porque cada uno aparece solo en
pantalla.

**Sin diarización, los seis formatos salen exactamente como antes.** Hay un test por formato que
lo comprueba: es opcional y no puede cambiar lo que ya funcionaba.

## En pantalla

El nombre aparece **cuando cambia** el hablante; la barra de color va en **todos** los tramos,
que es lo que permite ver de quién es una línea sin leerla.

El color nunca informa solo: el nombre va escrito al lado, porque alrededor del 8 % de los
varones no distingue rojo de verde. Por eso la paleta puede ser de cinco colores elegidos a mano
en vez de tonos calculados — `hsl(i * 137, …)` da colores bonitos y algunos ilegibles.

**Renombrar** cambia el nombre en todos los tramos de esa persona a la vez. Corregir uno por uno
sería inaceptable en una reunión de una hora. Y como dos hablantes con el mismo nombre quedan
unidos, **eso es la salida para el defecto conocido**: si el modelo parte a una persona en dos,
se les pone el mismo nombre y se juntan, color incluido. La advertencia está escrita donde se ve
el resultado, no escondida acá.

## Verificado en el navegador

Con `es-multi-3min`, que tiene tres hablantes reales:

| | |
|---|---|
| Hablantes detectados | **3** — los que hay |
| Tramos | 40 |
| Renombrar «Hablante 1» → «Martín» | cambió sus **17** tramos y llegó a IndexedDB |
| SRT · VTT · CSV · TXT | `Martín:` · `<v Martín>` · columna propia · `Martín:` al cambiar |
| DOCX · PDF | 10,5 KB con firma `PK` · 5,3 KB con `%PDF` |

## Cuánto cuesta encenderla

Medido en el navegador, mismo archivo y mismo equipo, con los modelos ya en caché:

| | `es-multi-3min` (2 min 52 s de audio, 40 tramos) |
|---|---|
| Sin separar hablantes | **86 s** |
| Separando hablantes | **115 s** |
| **Costo** | **+29 s · +34 %** |

Unos 0,7 s por tramo de voz. Es bastante menos de lo que hacía suponer la cuenta a ojo —una
inferencia más por tramo sonaba a duplicar el tiempo— y es la razón por la que la casilla dice
«alrededor de un tercio más» y no una advertencia vaga.

Con `base-wasm`, que es el perfil sin GPU. Con WebGPU los dos números bajan, pero la
proporción no está medida.

## Lo que sigue sin resolverse

1. **El solapamiento no se detecta.** Cada tramo tiene un hablante; donde hablan dos, uno se
   pierde. Está dicho en la interfaz.
2. **Tiende a partir de más.** El arreglo es del usuario —renombrar dos iguales— y no del
   modelo. No es lo ideal, pero es honesto: la alternativa sería juntar de más por nuestra
   cuenta y equivocarnos sin que se note.
3. ~~`q8` en el modelo de embeddings está sin medir.~~ **Medido el 27/08/2026.** Ver abajo.


---

## El `q8` del modelo de embeddings, medido (27/08/2026)

El producto corre el modelo de hablantes en `q8` por tamaño, pero la fase A eligió el umbral
midiendo en `fp32`. Eso era un cambio de dtype sin medición, que es exactamente lo que la
regla de E0 prohíbe.

Rehecho el barrido y el holdout con `OPENSRT_DIAR_DTYPE=q8`:

| | fp32 | q8 |
|---|---|---|
| Meseta del barrido | 0,35 – 0,50 | **0,35 – 0,50** |
| Umbral elegido | 0,475 | **0,475** |
| `es-multi-holdout` | DER 2,8 % · conf. 0,71 % · 4 grupos | **idéntico** |
| `en-multi-holdout` | DER 2,3 % · conf. 0,00 % · 4 grupos | **idéntico** |

Idénticos hasta el último decimal. Eso podía significar dos cosas muy distintas, y una de
ellas era que el dtype no se estuviera aplicando — transformers.js podría haber ignorado el
parámetro y cargado el mismo archivo las dos veces.

**El control que lo separa:** comparar los vectores directamente, sobre el mismo audio.

| | |
|---|---|
| Componentes idénticas | **0 de 256** |
| Diferencia máxima por componente | 7,67 × 10⁻² |
| Coseno `fp32` ↔ `q8` | **0,994944** |

O sea: el dtype **sí** se aplica y los embeddings **sí** cambian. Lo que pasa es que mueven
el ángulo unos 0,005, y la meseta del umbral tiene 0,15 de ancho — treinta veces más. Por eso
ninguna decisión de agrupamiento llega a cambiar.

**Lo que esto no dice:** que `q8` sea inofensivo en general. Dice que sobre estos cuatro
ítems, con estas voces, ninguna asignación cambió. Un audio donde dos hablantes caigan cerca
del umbral sí podría dar vuelta con 0,005 de diferencia; lo que la medición sostiene es que
eso no pasa en el material medido, no que no pueda pasar.
