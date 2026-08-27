# E4 — estado

Actualizado: 26 de agosto de 2026. **Fase A cerrada.**

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

## Lo que falta (Fase B)

- Meter la diarización en el producto: etiquetas renombrables, un color por hablante.
- Propagar los hablantes a los exportadores: `<v Nombre>` en VTT, `Nombre:` en TXT y DOCX,
  columna propia en CSV.
- Medir el costo en tiempo: un embedding por tramo son decenas de inferencias más por archivo.
- Decidir qué hacer con el hablante de más.

**No hace falta la vía servidor.** El plan la tenía prevista para el caso de que lo local no
alcanzara, con consentimiento explícito y un test que verificara que no se puede saltear. Ese
camino queda descartado por innecesario, que es el mejor motivo para descartarlo.
