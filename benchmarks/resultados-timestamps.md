# ¿Cuánto cuestan los timestamps?

**23 de agosto de 2026.** Medido sobre el nivel A completo (8 ítems, 2874 palabras de
referencia), perfil `whisper-large-v3-turbo` / WebGPU / `enc:fp16/dec:q4`, misma máquina y
una corrida a continuación de la otra. **Lo único que cambia es `return_timestamps`.**

## La pregunta

El producto muestra progreso real —segundos de audio efectivamente procesados, no una barra
que avanza sola— y para eso el streamer necesita timestamps. Pero toda la matriz de E0 se
midió **sin** ellos. La sospecha era que generar tokens de timestamp costaría velocidad.

## El resultado

| | RTF | WER | Sustituciones | Borrados | Inserciones | Errores |
|---|---|---|---|---|---|---|
| **sin timestamps** | **0,565** | **3,03 %** | 63 | 13 | 11 | 87 |
| **con timestamps** | 0,570 | **4,52 %** | 64 | 34 | 32 | 130 |

**La sospecha era falsa: no cuestan velocidad.** 0,565 contra 0,570 es menos de un 1 % de
diferencia, dentro del ruido. Los 816 s y 822 s de inferencia son prácticamente iguales.

**Cuestan precisión: el WER sube casi un 50 % relativo**, de 3,03 % a 4,52 %.

## Dónde exactamente

Es lo que hace útil el desglose por ítem, porque el promedio esconde el patrón:

| Ítem | sin ts | con ts | Δ |
|---|---|---|---|
| `es-clean-1min` | 1,8 % | 1,8 % | — |
| `es-clean-5min` | 0,2 % | 0,2 % | — |
| `en-clean-1min` | 5,6 % | 5,6 % | — |
| `en-clean-5min` | 3,0 % | 3,0 % | — |
| `en-multi-3min` | 5,4 % | 5,4 % | — |
| **`es-noisy-3min`** | 2,2 % | **4,4 %** | inserciones 1 → 8 |
| **`es-multi-3min`** | 1,3 % | **5,0 %** | inserciones 1 → 15 |
| **`en-noisy-3min`** | 6,0 % | **11,7 %** | borrados 6 → 27 |

**Los cinco ítems de audio limpio no cambian ni una décima.** Todo el daño se concentra en
ruido y solapamiento de hablantes.

Y las **sustituciones son idénticas** (63 contra 64): el modelo no reconoce peor. Lo que se
rompe es el **pegado**, que aparece como borrados e inserciones. El algoritmo que une las
ventanas de 30 s usa los timestamps para saber dónde solapan; cuando el audio es difícil el
modelo emite timestamps poco fiables, el pegado se desalinea y se pierden o duplican
fragmentos enteros.

## Qué se decide con esto

**Los timestamps quedan apagados por defecto.**

El costo no es velocidad —que sería tolerable— sino precisión, y se concentra justo en el
audio difícil: reuniones con ruido de fondo y varias personas hablando. Ése **es** el caso
de uso real de una herramienta de transcripción; el audio de estudio limpio es la
excepción. Cambiar 1,5 puntos de WER en el caso que más importa por una barra de progreso
más precisa es un mal negocio.

### Qué pasa con el progreso

Sin timestamps no hay forma de saber en qué segundo del audio va el modelo. Lo que sí
sigue funcionando es el **texto en vivo**: las palabras van apareciendo a medida que se
generan, y eso es prueba real de avance —si el modelo se traba, el texto se detiene—.

Así que el progreso de E1 pasa a ser: texto en vivo, tiempo transcurrido y estimación
restante, **sin una barra de porcentaje que finja medir lo que no mide**.

La forma de tener las dos cosas es fragmentar el audio en bloques y llamar al modelo una
vez por bloque, lo que da progreso exacto sin depender de los timestamps del modelo. Eso
requiere cortar en silencios para no partir palabras, que es justamente lo que trae el VAD
de **E2**. Queda para ahí, no forzado en E1.

## Un dato aparte: el RTF varía entre corridas

E0 midió **0,451** para esta misma configuración. Acá dio **0,565** — un 25 % más lento sin
que nada haya cambiado salvo el momento de la corrida (estado térmico, carga de fondo).

Importa para el criterio de cierre de E1, que pide que la estimación caiga dentro del
±25 %: si la variabilidad del propio equipo ya consume ese margen entero, el criterio está
mal calibrado y hay que revisarlo con este número a la vista, no forzar el cumplimiento.
