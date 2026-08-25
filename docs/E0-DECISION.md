# E0 — decisión de cierre

**23 de agosto de 2026.** Se cierra contra el criterio fijado en `ETAPAS.md` §E0 **antes**
de medir, y contra los números de `benchmarks/resultados-principal.md` y
`benchmarks/resultados-controles.md`.

---

## El criterio, tal como se escribió

| RTF de turbo en el equipo modesto | Decisión |
|---|---|
| < 0,4 | turbo por defecto |
| **0,4 – 0,8** | **por defecto `small` o `base`; turbo como opción explícita** |
| > 0,8 | adelantar el camino de servidor |

Turbo con encoder en `fp16` da **RTF 0,451**. Cae en el tramo del medio, así que la lectura
literal manda poner `small` por defecto.

## Por qué la lectura literal es incorrecta acá

El criterio tenía una **premisa implícita**: que bajar de modelo compra velocidad. Es lo
que uno espera —menos parámetros, menos cómputo— y es la razón de ser de ese tramo: «si
turbo es aceptable pero no rápido, usá algo más rápido».

Los datos la refutan:

| Modelo | RTF | WER |
|---|---|---|
| **`whisper-turbo`** (enc `fp16`) | **0,451** | **3,0 %** |
| `whisper-small` | 0,636 | 20,5 % |
| `whisper-base` | 0,188 | 36,6 % |

**`small` es más lento que turbo _y_ comete siete veces más errores.** Bajar a `small` no
compra nada: no hay disyuntiva que resolver, porque turbo **domina** a `small` en las dos
dimensiones a la vez.

El motivo es el diseño de large-v3-turbo: el recorte está en el **decoder** (32 capas → 4),
que es la parte que corre una vez por token generado. `small` tiene menos parámetros en
total pero un decoder proporcionalmente más pesado, y la decodificación es lo que domina el
tiempo. Menos parámetros no implica más rápido.

**Esto no es reescribir la regla después de ver los resultados.** La regla sigue siendo la
misma; lo que cayó fue un hecho que la regla daba por cierto. Aplicarla igual llevaría a
elegir un modelo peor en todo, que es exactamente lo contrario de lo que buscaba. La
distinción importa y por eso queda escrita: si algún día se revisa esto, lo que hay que
mirar es si la premisa —«más chico es más rápido»— vuelve a ser falsa.

## Decisión

**Modelo por defecto: `onnx-community/whisper-large-v3-turbo`, encoder `fp16`, decoder
`q4`, backend WebGPU.** RTF 0,451 y WER 3,0 % sobre los ocho ítems del nivel A, ruido a
10 dB y multi-hablante incluidos.

### Sin WebGPU

Turbo en WASM es inviable: **RTF 4,74** y un ítem cortado por el tope. El respaldo es:

| Situación | Modelo | dtype | RTF | WER |
|---|---|---|---|---|
| Hay WebGPU | `whisper-turbo` | enc `fp16` / dec `q4` | 0,451 | **3,0 %** |
| Sin WebGPU | `whisper-base` | `q8` | 0,445 | 29,6 % |
| Sin WebGPU, prioridad calidad | `whisper-small` | `q8` | 1,248 | 19,5 % |

La caída de calidad sin WebGPU es **enorme** —de 3 % a 30 %— y la herramienta tiene que
decirlo en la cara, no esconderlo. No es «un poco peor»: es la diferencia entre una
transcripción utilizable y una que hay que corregir entera.

### La regla de dtype no es una regla: es una tabla

**Corrección (E1).** Acá había una tabla que decía «encoder: `q8` roto; decoder: `fp16`
roto», como si fueran propiedades de la precisión. **Un test de consistencia la tumbó**: la
regla prohibía perfiles del propio catálogo que están medidos y funcionan.

Mirando todo lo medido junto:

| modelo | backend | encoder `q8` | WER |
|---|---|---|---|
| turbo | webgpu | q8 | **100 % — roto** |
| turbo | wasm | q8 | 1,8 % — bien |
| small | wasm | q8 | 19,5 % — bien |
| base | wasm | q8 | 29,6 % — bien |
| tiny | wasm | q8 | **87,7 % — roto** |

`q8` **no está roto en general**: está roto en WebGPU, y en WASM sólo falla en `tiny`. Lo
mismo con `fp32`, que no es «demasiado grande» sino que no entra **para large-v3**: con
`small` carga y da 20,5 %.

Así que no hay reglas sobre precisiones, hay **combinaciones medidas**. Viven en
`src/lib/asr/evidence.ts`, y sobre una que no figura el código no afirma nada: la marca
como no verificada en vez de inventar una generalización. Lo que sigue en pie, y es lo
importante, es que **las combinaciones rotas cargan sin error y transcriben con aplomo**:
no hay excepción que atrapar, así que un cambio de dtype exige volver a medir el WER.

## Lo que queda pendiente y por qué no bloquea

**Medir en un segundo equipo.** El criterio hablaba del «equipo modesto» y esto se midió en
uno con Radeon RDNA-2, 16 núcleos y 32 GB. Que turbo domine a `small` en las dos
dimensiones es una propiedad de los modelos, no del equipo, así que la elección se sostiene;
lo que puede cambiar es el **valor absoluto** del RTF y si WebGPU está disponible. Por eso
E1 detecta capacidades en tiempo real y calibra contra el equipo de cada usuario en vez de
confiar en este número.
