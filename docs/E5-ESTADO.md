# E5 — estado

Actualizado: 27 de agosto de 2026. **En curso.**

**Objetivo de la etapa:** que un archivo real —dos horas de reunión— no rompa nada, y cerrar
las funciones del catálogo que faltan, cada una con su decisión de privacidad explícita.

---

## 1. Retomar una transcripción interrumpida

### El problema

Hasta acá sólo se guardaba el resultado **terminado**. En un archivo de dos horas eso
significa que cerrar la pestaña sin querer a los cien minutos tira todo: hora y media del
equipo de alguien, perdida por un clic. El aviso de archivo largo lo decía de frente —«si
cerrás la pestaña se pierde»— que es honesto, pero no es una solución.

### Cómo quedó

El avance se guarda **al terminar cada bloque**, no al final. Cuando el usuario vuelve a
elegir el mismo archivo, se le ofrece retomar; no se retoma solo, porque puede haberlo
interrumpido a propósito.

**Tres decisiones que no son obvias:**

1. **Se guardan los bloques, no sólo el texto.** Retomar exige que los bloques sean *los
   mismos* de la vez anterior. Si se recalcularan con el detector y un umbral o una versión
   hubieran cambiado, los bordes serían otros y los tramos ya hechos no encajarían con los
   nuevos. **Nada fallaría**: saldría una transcripción con los tiempos corridos.

2. **Al retomar, el detector no se vuelve a correr.** Los tramos vienen guardados. No es sólo
   ahorrar los 24 s que tarda en media hora de audio — es la misma razón del punto anterior.
   Comprobado: en frío la transcripción arranca a los 32 s; retomando, a los **6 s**.

3. **La clave del archivo es `nombre|tamaño|modificado`, no un hash del contenido.** Un hash
   sería más exacto pero exige leer dos horas de audio antes de poder decir «esto ya lo
   empezaste», que es justo lo que se quiere evitar. La colisión posible se paga con una
   oferta de retomar que no corresponde, y el usuario puede decir que no.

### Lo que hay que probar, y no es «reanudó»

Lo que importa es que **el resultado de retomar sea el mismo** que el de haber corrido de una
sola vez. Si al retomar se perdiera un bloque, se repitiera uno o los tiempos quedaran
corridos, nada fallaría: saldría una transcripción con un agujero — el mismo modo de fallo que
este proyecto viene persiguiendo desde E1.

Por eso el test central compara las dos corridas tramo por tramo, y hay un **control** que
demuestra que esa comparación sabe ver una diferencia: se retoma diciendo que hay un bloque
más hecho del que hay, y el test tiene que notarlo.

### El mismo error que E2 había evitado, cometido de nuevo

La primera versión guardaba **la lista entera de tramos** dentro del registro de la corrida y
la reescribía en cada bloque. Con los 65 bloques de media hora no se nota. Con los ~1300 de un
archivo de dos horas es cuadrático: cerca de **un millón de escrituras de tramo** para guardar
mil seiscientos.

Es exactamente el error que E2 evitó con el audio —«el audio una vez, las ediciones
incrementales»— enunciado como principio en ese módulo y violado en el código nuevo dos etapas
después.

Ahora cada bloque escribe **sólo lo suyo**, en su propia tabla. La cabecera y el bloque van en
la **misma transacción**: si no, podría quedar una cabecera diciendo que hay diez bloques
hechos con nueve guardados, y al retomar faltaría uno sin que nada fallara. Y al leer se
descarta lo que esté más allá de lo que la cabecera confirma — si el navegador muere entre una
escritura y la otra, sobra un bloque, y es preferible rehacerlo que meterlo dos veces.

Medido en el navegador con el archivo de 30 minutos: en el bloque 40, el trozo más grande
guardado tiene **8 tramos**. Con la versión anterior habría escrito unos 250.

### Comprobado con una interrupción de verdad

Sobre el mp4 de 30 minutos, cortando la pestaña en el **bloque 17 de 65** y volviendo a elegir
el archivo:

| | corrida entera | interrumpida y retomada |
|---|---|---|
| Palabras | 3394 | **3394** |
| Tramos | 399 | **399** |
| Cobertura del vocabulario | 94,1 % | **94,1 %** |

Idéntico en las tres cifras. Y además:

- El ofrecimiento apareció con el porcentaje correcto: «quedó al 26 %» (17 de 65).
- Al retomar **no aparece la fase de detección**: transcribe desde los 6 s, contra 32 s en
  frío. El detector no se vuelve a correr, que es lo que garantiza que los bloques sean los
  mismos.
- El guardado incremental sigue andando *durante* la reanudación: se lo vio pasar de 110 a
  213 tramos acumulados sobre los que ya había.
- Al terminar, la corrida a medias **se borra**: quedan 0 corridas y 1 sesión de 399 tramos.

---

## 2. Lo que salió de medir con un archivo largo

Ver `docs/E3-ESTADO.md` para la corrida completa de 30 minutos. Dos correcciones que
aparecieron ahí y son de esta etapa:

- **El RTF aprendido se guardaba por segundo de archivo**, y desde E2 sólo se transcribe el
  habla. Un archivo con 44 % de silencio aportaba 0,255 y uno sin silencio 0,46: los dos
  describen el mismo equipo. Ahora la unidad es el **segundo de habla** y la clave de
  almacenamiento pasó a `v2`, para que las observaciones viejas —que están en la otra
  unidad— no se mezclen con las nuevas.
- **La estimación previa se presentaba como una predicción.** Antes de detectar la voz no se
  sabe cuánto silencio hay, así que ahora es un **techo declarado**: «va a tardar como mucho»,
  con el motivo escrito al lado.

---

## 3. Una mejora de la prueba de mutación

Al agregar los mutantes de esta etapa aparecieron **tres viejos que ya no enganchaban** con el
código, porque lo de alrededor había cambiado. El script los reportaba recién al llegarles el
turno —media hora después— y **como si fueran sobrevivientes**.

Un mutante cuyo patrón ya no existe no es un test que pasa: es un instrumento roto. Ahora se
comprueban todos antes de empezar y falla en un segundo, diciendo cuál.

---

## 4. Cola de varios archivos

Se eligen varios y se procesan **en serie**, con el estado de cada uno a la vista.

**En serie y no en paralelo** porque hay un solo modelo cargado y un solo procesador: dos
transcripciones a la vez no terminan antes, se estorban. Lo que sí se comparte es la carga del
modelo —91 s con turbo, medido en E0—: pagarla una vez para diez archivos es la mitad del
sentido de tener cola.

**Se decodifica de a uno.** Decodificar los cinco de entrada dejaría cinco `Float32Array`
gigantes vivos a la vez: media hora de audio son 115 MB, así que una cola de cinco archivos
largos se comería más de medio giga antes de transcribir nada. Sólo el primero se decodifica
al elegir —hace falta para mostrar la duración y la estimación—; los demás esperan como
`File` y se decodifican en su turno.

**Un archivo que falla no detiene la fila.** Perder los nueve que faltan porque el tercero
está dañado sería lo peor que puede hacer una cola.

### Comprobado con un archivo roto en el medio

Tres archivos, el segundo con cabecera de WAV y basura adentro:

| | |
|---|---|
| `archivo-1.wav` | **listo** · 14 tramos |
| `archivo-2.wav` (dañado) | **falló** |
| `archivo-3.wav` | **listo** · 16 tramos |

«Cola: 2 de 3 listos», dos sesiones guardadas, cero corridas a medias colgadas y **ninguna
petición que no sea GET**. Reabrir el primero desde la lista trae su transcripción —113
palabras, 14 tramos— y no la del tercero que estaba en pantalla.

Los resultados terminados se reabren **desde la base**, no desde memoria: con diez archivos
largos, tener los diez resultados vivos a la vez es exactamente lo que la cola evita al
decodificar de a uno.

---

## Lo que falta de E5
- **Traducción.** Opus-MT de Helsinki-NLP es Apache 2.0 y son modelos por par de idiomas, así
  que se baja sólo el que hace falta. Que la calidad alcance para subtítulos es **hipótesis**.
- **Resumen con IA.** Acá la promesa se tensa: local significa otro modelo grande; por API
  significa **mandar la transcripción a un tercero**. Si es por API, apagado por defecto y con
  consentimiento por uso.
- **Camino de servidor opcional**, con el coste y la implicancia dichos en la interfaz.
- **Dos horas de verdad.** Lo probado son 30 minutos. El techo de memoria se midió hasta las
  dos horas por separado, pero el camino entero con un archivo así **no está comprobado**.
