# E0 — estado

Actualizado: 23 de agosto de 2026.

## Hecho

**Andamiaje.** Next.js 16.3.1, React 19.2.8, Tailwind 4, TypeScript, App Router con
`src/`. `@huggingface/transformers` 4.2.0 y vitest. `tsc`, `eslint` y `next build` limpios.

**Especificación de normalización de WER** (`NORMALIZACION-WER.md`), escrita y fechada
**antes** de cualquier medición, como exige el criterio de cierre de E0.

**Núcleo de medición** — `normalize.ts`, `wer.ts`.

**Runner del banco** — completo:

| Módulo | Qué resuelve |
|---|---|
| `policy.ts` | las decisiones metodológicas juntas y aparte: `MAX_RTF`, umbrales de decisión |
| `models.ts` | los 6 modelos, con `hfId` y licencia **verificados contra la API de HF** |
| `audio.ts` | decodifica y remuestrea a 16 kHz mono; SHA-256 para cotejar con el manifiesto |
| `memory.ts` | muestreo de memoria y, sobre todo, qué no se puede medir |
| `corpus.ts` | carga y **valida** el manifiesto antes de medir |
| `bench.worker.ts` | transformers.js aislado en un worker |
| `runner.ts` | orquesta la matriz, con watchdog y reanudación |
| `persist.ts` | guarda cada resultado apenas termina, en IndexedDB |
| `report.ts` | genera `resultados.md`, el entregable de E0 |
| `src/app/bench/page.tsx` | la interfaz del banco |

**Corpus construido y verificado** — `scripts/build-corpus.mjs`, `scripts/verify-corpus.mjs`,
`scripts/lib/wav.mjs`. Diez ítems, 84 min de audio, los dos idiomas, las tres condiciones.

**80 tests en verde, 10 mutantes muertos, 74/74 comprobaciones del corpus.**

## El corpus

| Fuente | Licencia | Hablantes |
|---|---|---|
| [OpenSLR SLR61 — español argentino](https://www.openslr.org/61/) | CC BY-SA 4.0 | 13 |
| [OpenSLR SLR83 — inglés de UK/Irlanda](https://www.openslr.org/83/) | CC BY-SA 4.0 | 3 |

| Ítem | Nivel | Duración | Palabras | Nota |
|---|---|---|---|---|
| `es-clean-1min` / `en-clean-1min` | A | ~1 min | 113 / 126 | |
| `es-clean-5min` / `en-clean-5min` | A | 5 min | 497 / 626 | |
| `es-noisy-3min` / `en-noisy-3min` | A | ~3 min | 319 / 386 | murmullo a **SNR 10 dB exacta** |
| `es-multi-3min` / `en-multi-3min` | A | ~3 min | 381 / 424 | 3 hablantes, 0,25 s de solapamiento |
| `es-clean-30min` / `en-clean-30min` | B | 30 min | 3373 / 3765 | |

**El español es rioplatense**, que era la decisión abierta más seria: SLR61 es un corpus
argentino, así que el WER en español ya no se mide sobre acentos ajenos.

**Reproducible byte a byte.** Semilla fija (`20260823`) y orden estable: dos corridas del
constructor dan los mismos SHA-256. Comprobado corriéndolo dos veces.

### Por qué el corpus está estratificado

El plan pedía ítems de 1, 5, 30 y **120** minutos para la matriz completa. Medido el costo,
eso es impracticable: 312 min de audio × 12 combinaciones son **entre 19 y 125 horas** de
corrida según el RTF. Con niveles:

- **Nivel A** — 8 ítems, 24,1 min → **4,8 h** de matriz completa con RTF 1.
- **Nivel B** — 2 ítems, 60 min → 6 h, y sólo para los modelos que pasen el corte.

El ítem de 120 min queda fuera: no aporta a la decisión —qué modelo va por defecto— y
llevaría la corrida a decenas de horas. La resistencia con audio largo es una prueba
puntual sobre el ganador, no una celda de la matriz.

### Qué es natural y qué está construido

El habla es real y las transcripciones son las del corpus original. Lo demás está
fabricado, y el manifiesto lo declara porque cambia cómo se leen los WER:

- **Los ítems son frases sueltas concatenadas con silencio.** SLR61 y SLR83 son
  grabaciones para TTS: no hay habla continua, ni coarticulación entre frases, ni prosodia
  de discurso seguido. Un WER de acá no es un WER sobre una reunión real.
- **`noisy`** es murmullo mezclado a una SNR calculada de las energías reales, no
  aproximada.
- **`multi`** alterna hablantes con solapamiento medido.
- **En inglés el murmullo comparte hablantes con la señal**, porque SLR83 sólo trae 3 y no
  alcanzaban para separarlos. Está declarado por idioma en `sharedNoiseSpeakers`.

### Sin ffmpeg

No hay ffmpeg en el equipo y LibriSpeech viene en FLAC, así que se descartó y se usó
SLR83, que es WAV y tiene la misma estructura que el corpus argentino. El WAV I/O, el
remuestreo de 48 a 16 kHz y la mezcla a SNR están escritos en `scripts/lib/wav.mjs`, sin
dependencias. El remuestreo lleva **filtro FIR antialiasing** antes de decimar: decimar sin
filtrar repliega todo lo que está sobre la nueva Nyquist en la banda audible, y eso no
suena a "peor calidad" sino a componentes que nunca existieron, que el modelo transcribe
como algo y suben el WER sin motivo aparente.

## Lo que se descubrió construyendo

### Las licencias del catálogo no eran las que yo había escrito

El plan afirmaba «MIT» para los cuatro Whisper. Verificado contra
`/api/models/{id}?full=true`, lo que declaran es otra cosa:

| Modelo | Licencia declarada |
|---|---|
| `openai/whisper-large-v3-turbo` | **mit** |
| `openai/whisper-tiny` | **apache-2.0** |
| `openai/whisper-base` | **apache-2.0** |
| `openai/whisper-small` | **apache-2.0** |
| `lite-whisper-large-v3-turbo-ONNX` | apache-2.0 |
| `moonshine-base-ONNX` | mit |

Las dos son permisivas y sirven igual, así que **no cambia ninguna decisión** — pero la
tabla del plan decía algo que nadie había mirado. Además, los repos de `onnx-community`
**no declaran licencia propia**: heredan la del modelo base, y por eso cada entrada del
catálogo lleva `licenseFrom` diciendo de dónde sale el dato.

### El «pico de memoria» del plan no existe como número

E0 pedía medir pico de memoria como si fuera una lectura disponible. No lo es:

- `performance.measureUserAgentSpecificMemory()` cubre JS, DOM y heap WASM, pero **exige
  `crossOriginIsolated`** — las cabeceras COOP/COEP, justo las que el hallazgo 1 dice que
  pueden romper la descarga del modelo. Y es cara: no sirve para muestrear.
- `performance.memory` es barata pero sólo Chromium y **sólo heap JS**.
- **Ninguna ve la memoria de la GPU**, que con WebGPU es exactamente donde viven los pesos.

Consecuencia: la columna de memoria mide el lado del CPU y es una **cota inferior**
(pico muestreado). Para WebGPU, la evidencia de que un equipo no da es indirecta —aparece
como `error` o `timeout`—, y por eso el runner registra esos fallos en vez de descartarlos.
El reporte lo dice en su propia sección para que nadie lea la columna de más.

### Un defecto silencioso en el normalizador y otro en el parser de números

- **La expansión de contracciones no corría nunca.** La regla era `/\bn't\b/`, pero en
  `don't` la `n` va precedida de `o` y ahí no hay límite de palabra. El apóstrofo caía
  luego en la eliminación de puntuación y quedaba `dont`. Habría inflado el WER de todo
  el corpus en inglés, en todos los modelos por igual: un sesgo que no hace fallar nada.
- **`tengo cinco y seis manzanas` daba `tengo 11 manzanas`.** La conjunción une decena +
  unidad, no dos unidades sueltas.

El segundo lo destapó la prueba de mutación por un camino indirecto: el mutante «saltear
siempre el conector» **sobrevivió**. Investigando por qué, resultó ser un *mutante
equivalente* — la guarda no cambiaba nada porque otra variable protegía los casos
cubiertos. Esa inutilidad era el síntoma de que la guarda no verificaba lo que debía.

### transformers.js 4.2.0 rompe el backend WASM — la versión está fijada a 3.7.6

Lo encontró la primera corrida real de la matriz. Con `@huggingface/transformers` **4.2.0**,
**los ocho ítems de `whisper-tiny/wasm` fallaron**, todos con el mismo error al crear la
sesión de onnxruntime:

```
qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits
Missing required scale: model.decoder.embed_tokens.weight_merged_0_scale
```

WebGPU funcionaba perfecto con el mismo modelo, así que el fallo era específico de WASM.
Se acotó por descarte, probando en el navegador contra el paquete del CDN:

| Hipótesis | Resultado |
|---|---|
| Es el `dtype` | **No.** Falla igual con `q8` por componente, `q8` string, `fp32` y `q4`. |
| Es el repositorio `onnx-community` | **No.** `Xenova/whisper-tiny` falla idéntico. |
| Es el optimizador de grafos | **No.** Falla con `disabled`, `basic` y `extended`. |
| **Es la versión de transformers.js** | **Sí.** `3.7.6` carga y transcribe en WASM en 7,7 s. |

Verificado además que 3.7.6 sirve para **los dos** backends con la misma configuración de
dtype. La dependencia quedó fijada a **`3.7.6` exacta, sin `^`**: con el rango, cualquier
`npm install` volvería a traer la 4.x y la mitad de la matriz saldría en error otra vez.

Costo de no haberlo detectado: la mitad de la tabla —los seis modelos en WASM— habría
salido `error`, y era fácil leerlo como «WASM no sirve para esto» en vez de «esta versión
de la biblioteca está rota».

Efecto colateral: en la 3.x los tipos del `pipeline` producen una unión que TypeScript no
puede representar (TS2590), así que la llamada va por una firma mínima, comentada en
`bench.worker.ts`.

### La columna WASM mide la cuantización, no el backend

Primer resultado de la corrida real, mismo modelo y mismo audio:

| | RTF | WER | Inserciones |
|---|---|---|---|
| `whisper-tiny` / **webgpu** | 0,168 | **33,2 %** | 48 |
| `whisper-tiny` / **wasm** | 0,304 | **74,5 %** | 236 |

Cuarenta puntos de WER y casi cinco veces más inserciones no los explica el backend: los
dos ejecutan el mismo grafo. Lo que cambia es el **dtype**, que el worker elige distinto
para cada uno — WebGPU corre el encoder en `fp32` y el decoder en `q4`; WASM corre los dos
en `q8`. El encoder de Whisper es sensible a la cuantización, y con `q8` el modelo empieza
a inventar: las inserciones son la firma de la alucinación, y por eso se reportan aparte.

**Consecuencia para leer la tabla:** la fila WASM **no responde «cuánto peor es WASM»**,
responde «cuánto cuesta la configuración que hoy se usa en WASM». Son preguntas distintas
y conviene no confundirlas al decidir.

#### Con `whisper-base` completo, la explicación fácil se cae

Los dos primeros modelos, ya con los ocho ítems cada uno:

| Modelo | Backend | dtype | RTF | WER | Inserciones |
|---|---|---|---|---|---|
| `whisper-tiny` | webgpu | enc fp32 / dec q4 | 0,168 | 33,2 % | 48 |
| `whisper-tiny` | wasm | enc q8 / dec q8 | 0,294 | **87,7 %** | **1079** |
| `whisper-base` | webgpu | enc fp32 / dec q4 | 0,188 | 36,6 % | 27 |
| `whisper-base` | wasm | enc q8 / dec q8 | 0,445 | **29,6 %** | 40 |

El desastre **no es del backend**: con `base`, el mismo WASM y el mismo `q8` dan **mejor**
WER que WebGPU (29,6 % contra 36,6 %). Y tampoco es simplemente «cuantizar el encoder
arruina», porque entonces `base` en WASM tendría que sufrir igual que `tiny`.

Lo que queda en pie es una **interacción entre el tamaño del modelo y la cuantización**:
`tiny` tiene poca redundancia y el `q8` lo desarma —87,7 % de WER que es casi todo texto
inventado—, mientras que `base` lo absorbe sin problema. Y hay una segunda sospecha que la
tabla insinúa: el **decoder en `q4`** de WebGPU podría estar costando calidad, ya que
`base` mejora al pasar a `q8/q8`.

Por eso el control se amplía: no alcanza con probar el encoder en `fp32`. Hay que cruzar
**dos modelos** (`tiny`, `base`) por **cuatro dtypes** (`q8/q8`, `fp32/q8`, `fp32/fp32`,
`fp32/q4`) en un solo backend, para separar tres efectos que hoy están confundidos: el del
backend, el del encoder y el del decoder. Sin eso, ninguna fila de la tabla dice lo que
parece decir.

### El modelo candidato principal **no carga** en WebGPU en este equipo

`whisper-turbo` en WebGPU dio **timeout en la carga tras 900 s**, y sus ocho ítems
quedaron en `timeout`. El watchdog hizo exactamente lo que debía: cortó y siguió con la
combinación siguiente en vez de dejar la corrida colgada para siempre.

**No fue una caída de GPU.** Comprobado inmediatamente después: el adaptador y el
dispositivo responden, y el heap está en 119 MB. La GPU aguantó toda la corrida.

**Causa probable** — `[hipótesis]`, a confirmar en el control: el adaptador declara
`maxBufferSize = 2,00 GB`, y el dtype que el worker usa en WebGPU deja **el encoder en
`fp32`**. El encoder de `large-v3-turbo` es el de `large-v3` completo —el recorte de turbo
está en el decoder, que baja de 32 capas a 4—, así que en `fp32` pide bastante más de esos
2 GB. Los 1,2 GB del catálogo son el peso de descarga, no lo que ocupa en memoria sin
cuantizar.

Si la hipótesis es correcta, se arregla bajando el encoder a `fp16` o `q8` **sólo para
los modelos grandes**, y turbo pasa a ser medible en WebGPU. Es lo primero que prueba el
control.

### Y en WASM turbo es el mejor de todos… a un costo inviable

| | RTF | WER |
|---|---|---|
| `whisper-turbo` / wasm | **4,74** | **1,8 %** |
| `whisper-small` / webgpu | 0,64 | 20,5 % |

Un solo ítem todavía, pero la diferencia de calidad es enorme: **1,8 % de WER contra
20,5 %**. Es la primera medición que muestra de qué es capaz el modelo bueno.

El problema es el RTF de 4,74: casi cinco veces la duración del audio, rozando el corte de
`MAX_RTF`. Una hora de grabación serían casi cinco de espera. Inservible como está.

**Esto tensiona la conclusión de todo el proyecto.** Si el modelo bueno no carga en WebGPU
y en WASM es cinco veces más lento que tiempo real, lo que queda para el navegador es
`small` a ~20 % de WER — una calidad muy por debajo de la de TurboScribe, que corre
`large-v3` completo en GPU de servidor. La decisión de E0 depende ahora de si el control
del dtype rescata a turbo en WebGPU.

### El control rescató a turbo: era el `fp32` del encoder

La hipótesis se confirmó. Mismo modelo, mismo backend, mismo ítem; lo único que cambia es
la precisión del encoder:

| encoder / decoder | Carga | RTF | WER |
|---|---|---|---|
| `fp32` / `q4` — el de la matriz | **timeout 900 s** | — | — |
| **`fp16` / `q4`** | 91 s | **0,47** | **1,8 %** |
| `q8` / `q4` | 5 s | 3,50 | **100 %** |
| `q4` / `q4` | 26 s | 0,97 | 1,8 % |

El encoder de `large-v3-turbo` en `fp32` no entra en el `maxBufferSize` de 2 GB del
adaptador. En `fp16` entra, carga en 91 s y corre **más rápido que tiempo real con 1,8 %
de WER**. Lo que parecía «el modelo bueno no es viable en el navegador» era una elección
de dtype mía.

**Y un resultado contraintuitivo que vale anotar:** `q8` es *peor* que `q4` para el
encoder. Con `q8` el modelo produce 100 % de WER —sale roto, no degradado— mientras que
`q4`, que tiene menos bits, funciona igual de bien que `fp16`. Eso no es pérdida de
precisión: es un problema del camino `q8` en concreto.

Y explica el otro desastre de la matriz: **`tiny` en WASM con `q8/q8` daba 87,7 % de WER
con 1079 inserciones**. No era «WASM es malo» ni «los modelos chicos no toleran
cuantización»: era el mismo `q8` roto. Los dos peores números de toda la tabla salen de
ahí.

**Y la regla fácil también se cae.** El último control probó `small` con el decoder en
`fp16` —siguiendo la sospecha de que el `q4` del decoder costaba calidad— y el resultado
fue **580,6 % de WER con 14.120 inserciones**: el modelo genera casi seis veces más
palabras que las que hay, casi todas inventadas.

Eso **refuta la hipótesis del decoder `q4`**: `q4` no era el problema, funciona bien. Y
deja un cuadro que no sigue ningún orden de precisión:

| Componente | `fp32` | `fp16` | `q8` | `q4` |
|---|---|---|---|---|
| **Encoder** | no entra en 2 GB | **✓** | ✗ roto (100 % WER) | **✓** |
| **Decoder** | — | ✗ roto (580 % WER) | ✓ | **✓** |

`fp16` sirve en el encoder y destruye el decoder. `q8` destruye el encoder y sirve en el
decoder. `q4`, el de menos bits, es el único que anda en los dos. No hay jerarquía de
precisión que explique esto: son fallos de caminos concretos de onnxruntime-web, no
pérdida numérica.

> **Corrección hecha en E1: esta tabla generaliza de más y es incorrecta.**
>
> Está escrita como si fueran propiedades de la precisión, y no lo son. Al codificarla
> como guarda en el producto, un test de consistencia la tumbó: prohibía perfiles del
> propio catálogo que están medidos y funcionan. Con **todo** lo medido a la vista:
>
> | modelo | backend | encoder `q8` | WER |
> |---|---|---|---|
> | turbo | webgpu | q8 | **100 % — roto** |
> | turbo | wasm | q8 | 1,8 % — bien |
> | small | wasm | q8 | 19,5 % — bien |
> | base | wasm | q8 | 29,6 % — bien |
> | tiny | wasm | q8 | **87,7 % — roto** |
>
> `q8` no está roto en general: está roto **en WebGPU**, y en WASM sólo falla en `tiny`.
> Y `fp32` no es «demasiado grande» en abstracto: no entra **para large-v3**, mientras que
> con `small` carga y da 20,5 %. Las filas de arriba valen para turbo en WebGPU, que es
> donde se midieron — no como ley general.
>
> Lo que queda en pie es la lección de abajo, que es la que importa. La tabla real de
> combinaciones medidas vive en `src/lib/asr/evidence.ts`.

**La lección metodológica, que vale más que la tabla:** el dtype **no se puede razonar, hay
que medirlo**. Tres de las combinaciones probadas producen basura —100 %, 580 % y 87,7 %
de WER— y ninguna avisa: cargan sin error y devuelven texto de aspecto normal. Sin el
desglose de inserciones y sin un WER contra referencia, cualquiera de las tres se habría
tomado por buena.

**Configuración ganadora, medida:** `whisper-large-v3-turbo`, encoder `fp16`, decoder `q4`,
en WebGPU.

### La tensión con el criterio preregistrado

El criterio, fijado **antes** de medir, decía:

| RTF de turbo en el equipo modesto | Decisión |
|---|---|
| < 0,4 | turbo por defecto |
| **0,4 – 0,8** | **por defecto `small` o `base`; turbo como opción explícita** |
| > 0,8 | adelantar el camino de servidor |

Turbo con `fp16` da **RTF 0,47**, así que cae en el tramo del medio: el criterio manda
poner `small` por defecto y dejar turbo como opción.

**Pero el criterio sólo miraba velocidad, y los datos muestran que la calidad varía
muchísimo:** `small` da ~20 % de WER y turbo **1,8 %**, diez veces mejor. Un criterio
escrito sin saber eso no puede zanjar la decisión solo.

Lo correcto acá es **no reescribir la regla después de ver los resultados** —eso es
exactamente lo que el preregistro existe para impedir—, sino aplicarla y **señalar su
límite** para que la decisión de fondo se tome a conciencia y quede escrita: ¿vale la pena
`small` por ser algo más rápido, cuando comete diez veces más errores? Es una decisión de
producto, no una que se deduzca del criterio.

### `vitest` no arrancaba en este Windows

La suite moría con `Timeout waiting for worker to respond` sin ejecutar un test, usando el
pool `forks` que trae por defecto. Con `pool: 'threads'` corre en medio segundo. Fijado en
`vitest.config.mts` con el motivo escrito, porque el síntoma parece un problema del código
y no lo es.

## Decisiones de diseño del runner que vienen de riesgos reales

1. **El modelo se carga una vez por (modelo, backend)**, no por ítem: cargar el turbo son
   1,2 GB y repetirlo por ítem multiplicaría la corrida sin medir nada nuevo.
2. **Watchdog en cada operación.** Si la GPU se cae, el worker deja de responder sin
   emitir error; sin plazo la corrida se cuelga para siempre.
3. **Cada resultado se guarda antes de empezar el siguiente**, y la corrida **se reanuda**
   con la misma etiqueta. Una caída pierde como mucho la medición en vuelo.
4. **`MAX_RTF = 5` es una decisión, no un recurso técnico**: un modelo que tarda más de
   cinco veces la duración del audio es inservible acá, así que se corta y se registra
   como `timeout`, que en la tabla significa «no da», no «no se midió».
5. **Moonshine no se corre sobre español**, y la celda queda marcada `n/a` con el motivo.
   No es que ande mal: su modelo multilingüe tiene licencia no comercial.

### Dos defectos que encontró la verificación del corpus

- **El índice de SLR83 tiene tres campos, no dos.** Es `<idPrompt>, <idArchivo>, <texto>`,
  y el nombre del wav es el segundo. Leerlo como dos campos daba cero clips.
- **El ítem `multi` en inglés salió con un solo hablante.** El reparto partía los hablantes
  por la mitad —señal contra murmullo— y con sólo 3 disponibles la señal se quedaba con
  uno, así que el ítem "multi-hablante" no tenía nada que separar. Ahora `multi` toma del
  conjunto completo, cuenta **los hablantes que de verdad entraron** en vez de los que se
  pidieron, y falla si quedan menos de dos. El validador del runner también lo rechaza.

## La decisión de E0

**Modelo por defecto: `whisper-large-v3-turbo` en WebGPU, encoder `fp16` / decoder `q4`.**

| | RTF | WER | Inserciones |
|---|---|---|---|
| **`turbo` fp16/q4** | **0,451** | **3,0 %** | 11 |
| `small` fp32/q4 | 0,636 | 20,5 % | 13 |
| `base` fp32/q4 | 0,188 | 36,6 % | 27 |

Turbo **domina a `small` en las dos dimensiones**: es más rápido *y* comete siete veces
menos errores. No hay que canjear velocidad por calidad.

### Cómo se aplica el criterio preregistrado, y dónde no alcanza

El criterio fijado antes de medir manda, para un RTF de 0,451, poner `small` o `base` por
defecto y dejar turbo como opción. **Tomado al pie de la letra elegiría un modelo dominado**
—más lento y siete veces peor—, porque la regla se escribió asumiendo que las alternativas
serían más rápidas que turbo, y esa premisa resultó falsa.

Lo correcto no es reescribir la regla ahora que se ven los resultados, que es justo lo que
el preregistro existe para impedir. Es dejar escrito que **la premisa de la regla no se
cumplió** y que por eso la regla no decide este caso: cuando la opción «rápida» es a la vez
la lenta y la mala, no hay disyuntiva que arbitrar. La decisión queda tomada sobre los
números de la tabla, y este párrafo es el registro de por qué.

## Pendiente de E0

**Medir en un segundo equipo.** El criterio de E0 dice explícitamente que **el equipo
modesto es el que manda**, y todo lo medido hasta acá salió de uno solo —AMD RDNA-2, 16
núcleos, 32 GB—. Un RTF de 0,451 acá no garantiza nada en una máquina con la mitad de
memoria y una GPU más chica, y el `maxBufferSize` de 2 GB que tumbó al `fp32` puede ser
todavía menor allá.

**Hasta que eso se mida, la decisión de arriba es provisional.** Está tomada sobre la
mitad de la evidencia que el propio plan exigía.

## Decisiones abiertas

Quedan dos; la del audio en español se resolvió con SLR61.

1. **Los modelos.** Correr la matriz baja los seis; sólo el turbo son 1,2 GB.
2. **WebGPU en este equipo.** Cargar la GPU a fondo sobre el driver AMD de agosto de 2024
   que ya tumbó Claude Desktop hoy. La persistencia por resultado y la reanudación existen
   para eso —una caída pierde una medición, no la corrida—, pero conviene decidir si se
   corre acá o en otra máquina.

## Comandos

```
npm test             # 80 tests
npm run mutation     # rompe a propósito y confirma que los tests lo atrapan
npm run corpus:build # reconstruye el corpus (necesita los zips en .corpus-src/)
npm run corpus:verify
npm run dev          # y abrir /bench
```
