# Re-medición sobre el corpus corregido

**25 de agosto de 2026.** Después de corregir la identificación de hablantes en el
constructor del corpus. Perfil `whisper-large-v3-turbo` / WebGPU / `enc:fp16/dec:q4`, sin
timestamps.

## La corrección del corpus no movió la calidad

| | RTF | WER |
|---|---|---|
| Nivel A, corpus anterior | 0,565 | 3,03 % |
| **Nivel A, corpus corregido** | **0,457** | **2,98 %** |

El WER es prácticamente el mismo. El bug de hablantes afectaba a **la etiqueta** del ítem
multi-hablante —decía tener tres hablantes cuando mezclaba dialectos dentro de cada
grupo—, no al audio ni a la referencia. La diferencia de RTF cae dentro de la variabilidad
conocida entre corridas.

Confirmación limpia del diagnóstico: **en español no cambió ni un hash**, porque tiene un
único prefijo (`arm`) y ahí la combinación prefijo+número equivale al número. El error sólo
se manifestaba en inglés.

## Ocho muestras no alcanzan para un rango

El hallazgo metodológico de esta ronda, y fue contraintuitivo.

Con las **8 muestras** del nivel A recién medido, el rango de RTF salía `[0,435, 0,488]` y
**cubría 2 de 10** archivos de validación. Con las **24 muestras** del conjunto principal
—tres corridas—, `p10–p90` da `[0,428, 0,599]` y cubre **8 de 10**.

| Muestras | Rango p10–p90 | Cubre en validación |
|---|---|---|
| 8 (una corrida) | [0,435, 0,488] | **2/10** |
| **24 (tres corridas)** | **[0,428, 0,599]** | **8/10** |

**Un rango estrecho no es un rango preciso: es uno mal medido.** Con pocas muestras los
percentiles describen esa corrida, no la variabilidad del equipo, y la estrechez da una
falsa sensación de certeza. El catálogo guarda ahora las 24.

La cobertura de 8/10 se mide contra archivos que **no participaron** en definir el rango,
así que no es circular.

## El hallazgo importante: la omisión silenciosa es sistemática

Sobre las 46 mediciones del perfil del producto, contando como omisión los casos con muchos
borrados y casi ninguna inserción:

| Idioma | Ítems con omisión | WER medio | Texto faltante |
|---|---|---|---|
| **español** | **0 de 23** | 1,1 % | 0,0 % |
| **inglés** | **3 de 23** | 8,8 % | 2,9 % |

Y en el conjunto de validación, el contraste es de 15 veces: **WER 0,78 % en español contra
12,2 % en inglés**.

### Cómo se ve

En `en-val-1`, el modelo saltó **tres frases enteras**:

> Referencia: «…Tracks only **remain in French Lick and are used as an excursion route** \|
> **It is fifteen degrees with light rain in Banbridge** \| **The actual primary rainbow
> observed…** \| **Race organizers transport** gear bins to designated checkpoints…»
>
> Salida: «…Tracks only **gear buttons** to designated checkpoints…»

42 borrados, 1 inserción. Falta el **32 %** del texto. En `en-val-2` faltaba el 24 %.

### Qué se descartó antes de llegar acá

1. **Referencias mal mapeadas** — ninguno de los dos índices tiene ids repetidos.
2. **Texto que no corresponde al audio** — se transcribieron tres clips fuente de los tres
   dialectos y cada uno dijo lo que el índice le asigna.
3. **Audio y referencia con contenidos distintos** — los finales coinciden palabra por
   palabra y todas las frases producidas están en la referencia.

No es el corpus. **Es el modelo.**

### Por qué importa para el producto

Lo que devuelve es fluido, coherente y plausible. Nadie que no tenga el original al lado
notaría que falta un párrafo. Para una herramienta de transcripción es el peor modo de fallo
posible: **el error no se ve**.

Afecta a **1 de cada 8 archivos en inglés**, con audio limpio y leído.

No sabemos por qué el español se salva. Los clips en inglés son más largos —6,6 s contra
4,8 s de media— pero eso es correlación, no causa, y determinarlo necesita un experimento
propio.

**Consecuencia para E2:** la detección de omisiones pasa de mejora deseable a **necesaria**.
El VAD detecta dónde hay habla, así que permite contrastar cuánto habla se detectó contra
cuánto texto se produjo. Un desajuste grande es exactamente esto, y se puede avisar. Sin esa
comparación no hay forma de detectarlo.

## Números para el catálogo

- `rtfSamples`: 24 mediciones por archivo del conjunto principal.
- Mediana **0,462**; rango mostrado **[0,428, 0,599]**.
- `measuredWer`: **2,98 %** sobre los 8 ítems del nivel A.
