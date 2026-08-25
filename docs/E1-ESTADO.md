# E1 — estado

Actualizado: 23 de agosto de 2026.

**Objetivo de la etapa:** que exista una herramienta desplegada que hace bien una sola
cosa —tomar un archivo de audio y devolver su texto— sin que el audio salga del equipo.

---

## Hecho

### El motor, en `src/lib/asr/`

| Módulo | Qué resuelve |
|---|---|
| `evidence.ts` | tabla de combinaciones medidas en E0; la guarda se apoya en ella |
| `models.ts` | perfiles del producto, con RTF y WER **medidos**, no estimados |
| `capabilities.ts` | detecta WebGPU y el límite del adaptador; elige el perfil |
| `transcriber.ts` | la transcripción, sin mensajería: corre en worker y en hilo principal |
| `asr.worker.ts` | envoltorio de mensajería, sin lógica propia |
| `engine.ts` | API pública, con degradación worker → hilo principal |
| `estimate.ts` | la estimación honesta, en tres estados |
| `../audio/decode.ts` | decodificación y remuestreo, **compartido con el banco** |

### La interfaz

Bilingüe por URL (`/es` por defecto, `/en`), con la raíz redirigiendo. Zona para soltar
archivo, panel de capacidades del equipo, progreso real, resultado con copiar y descargar.

### Verificado en el navegador, en producción

- `/es` y `/en` generadas como estáticas; la raíz redirige (307).
- Detecta WebGPU y elige `turbo-webgpu` solo, mostrando qué va a usar **antes** de que el
  usuario elija archivo.
- Archivo de 1 min: **123 palabras en 40 s**. La calidad es la esperada de un WER de 3 %:
  el modelo escribió *«interesa»* donde la referencia del corpus dice *«intersa»*, y
  *«trasplante»* donde dice *«transplante»* — corrigió erratas del propio corpus.
- **Privacidad comprobada en el panel de red: sólo GET a localhost, ningún POST, ninguna
  subida de audio.**

**122 tests en verde.**

---

## La honestidad, que es el rasgo de la etapa

Tres cosas que la herramienta dice y que era tentador callar:

1. **La nota de privacidad dice la verdad completa.** «Tu audio no sale de esta
   computadora» **y** «se descarga un modelo desde Hugging Face». Prometer «nada sale de
   tu equipo» a secas sería falso.
2. **La estimación se anuncia como aproximada mientras lo sea.** El RTF de E0 se midió en
   otro equipo; hasta que el archivo no calibra contra el equipo real, el texto lo dice.
3. **El aviso de calidad sin GPU no se esconde.** La diferencia es de 3 % a 30 % de WER:
   no es «un poco peor», es la diferencia entre una transcripción utilizable y una que hay
   que corregir entera.

---

## Lo que se descubrió construyendo

### La regla general de dtype era falsa, y un test la tumbó

Al llevar el hallazgo de E0 a código, escribí una guarda con la regla «el encoder en `q8`
está roto, el decoder en `fp16` está roto». **Un test de consistencia la rechazó**: la
regla prohibía perfiles del propio catálogo que están medidos y funcionan.

Con todo lo medido a la vista, `q8` en el encoder da 100 % de WER en turbo/WebGPU y 87,7 %
en tiny/WASM, pero **funciona bien** en base/WASM, small/WASM y turbo/WASM. No está roto en
general: está roto **en WebGPU**. Y `fp32` no es «demasiado grande» en abstracto — no entra
para large-v3, mientras que en `small` carga y da 20,5 %.

Por eso el producto no tiene reglas de dtype sino la tabla de `evidence.ts`, y sobre una
combinación que no figura **no afirma nada**: la marca como no verificada. Bloquear lo
desconocido impediría probar cosas nuevas; declararlo seguro sería mentir.

Se corrigieron también `docs/E0-DECISION.md` y `docs/E0-ESTADO.md`, que arrastraban la
misma generalización.

### Un perfil declaraba un WER que nunca se midió

Otro test de consistencia: el perfil `turbo-webgpu-q4` decía 3,0 % de WER, que es el número
del perfil `fp16` **medido sobre ocho ítems**. El de `q4` fue 1,8 % **sobre uno solo**.
Había copiado un número en vez de usar el medido, y encima la diferencia de respaldo no
estaba dicha en ningún lado.

De ahí sale el campo `werSamples`: un 1,8 % sobre un ítem y un 3,0 % sobre ocho no son
comparables, y **el más bajo no es el mejor**. El perfil por defecto es el que tiene la
medición sólida, no el del número más lindo.

### El progreso estaba roto, y mi diagnóstico también

La barra retrocedía de 28 s a 6 s. La causa: `on_chunk_start` **no da el segundo absoluto
del archivo** sino el tiempo dentro de la ventana de 30 s, que se reinicia en cada una.

Lo grave no fue el bug sino lo que provocó: leí esa barra y concluí «RTF ~3, hay una
regresión de rendimiento». **Era una lectura de un instrumento descalibrado.** Nunca supe
cuánto había avanzado.

Y el primer arreglo tampoco alcanzó. Acumular el desplazamiento de ventanas parecía
suficiente, pero un test lo tumbó: como las ventanas se solapan 10 s, el primer timestamp
de una ventana nueva cae **antes** del último de la anterior, y la barra volvía atrás
igual. Correcto en aritmética —el modelo reprocesa esa zona— e inaceptable como progreso.
Ahora es monótono a la fuerza.

**El número que nadie documenta:** el avance por ventana es
`chunk_length_s − 2 × stride_length_s` = **20 s**, no 30 ni 25. Sale del código del
pipeline (`const jump = window - 2 * stride`). Suponer cualquiera de los otros dos desplaza
el progreso de forma creciente a lo largo del archivo.

---

### La detección automática de idioma traducía, y duplicaba el texto

El peor defecto encontrado en E1, y sólo apareció al probar con audio **ruidoso** — con los
archivos limpios nunca se manifestó.

Con `es-noisy-3min.wav` y el idioma en «Detectar», la salida fue:

> «The theater of the Flautista, a great success. Can you send the news of the different
> media?…»

Es una **traducción** correcta del español al inglés, no una transcripción. Y a mitad de
archivo volvía al español solo. El mismo archivo con el idioma fijado en español sale
perfecto, voseo incluido: «La obra de teatro El Flautista, un éxito rotundo. ¿Querés que te
mande la noticia…».

**Lo cuantitativo es lo que asusta:**

| Idioma | Palabras | Resultado |
|---|---|---|
| Detectar | **643** | traducido al inglés, luego español |
| Español fijo | **319** | correcto |

La referencia tiene 319 palabras. Con detección automática salieron **el doble**: tradujo
*y* transcribió, duplicando el contenido.

Dos cosas que se probaron y **no** lo arreglan:

- Forzar `task: 'transcribe'` en las opciones del pipeline. Se agregó igual, porque es lo
  correcto, pero por sí solo no evita el problema.
- Nada en la salida avisa. El texto es fluido y plausible; alguien que no hable el idioma
  del audio no tendría forma de notar que le devolvieron una traducción.

**Decisión:** el idioma del audio arranca en el **idioma de la interfaz**, no en «Detectar».
Un fallo silencioso que devuelve texto plausible en otro idioma es peor que pedirle al
usuario que confirme el idioma. «Detectar» sigue disponible, con una advertencia que
explica exactamente este riesgo.

La causa de fondo es que sin `language` **cada ventana de 30 s decide por su cuenta**, así
que ni siquiera hay coherencia dentro del mismo archivo. Una detección única sobre los
primeros segundos, fijada para todas las ventanas, sería mejor que el default actual;
queda anotado como mejora.

## Timestamps: medido y decidido

Ver `benchmarks/resultados-timestamps.md`. Sobre el nivel A completo, mismo perfil y misma
máquina:

| | RTF | WER |
|---|---|---|
| **sin timestamps** | **0,565** | **3,03 %** |
| con timestamps | 0,570 | 4,52 % |

**No cuestan velocidad** —la sospecha era falsa— pero suben el WER casi un 50 % relativo, y
el daño se concentra en ruido y varios hablantes: los cinco ítems limpios no cambian ni una
décima. Las sustituciones quedan iguales (63 contra 64), así que el modelo no reconoce
peor: se rompe el **pegado de ventanas**, que usa los timestamps para saber dónde solapan.

Como el audio difícil es el caso de uso real, **quedan apagados por defecto**.

### Qué pasó con el progreso

Sin timestamps no se puede saber en qué segundo va el modelo, así que **no hay barra de
porcentaje**: fingir una medición es justo lo que esta herramienta no hace. En su lugar:

- **Texto en vivo**, verificado funcionando sin timestamps — la curva de caracteres crece
  monótona (`0 … 20, 195, 256, 310, 481, 3039`). Es prueba real de avance: si el modelo se
  traba, el texto se detiene.
- **Tiempo transcurrido** y **estimación restante**.

### El RTF aprendido

Sin timestamps la estimación tampoco puede calibrarse durante la corrida, así que se mide
**al terminar** —ahí se sabe exactamente cuánto audio era y cuánto tardó— y se guarda en
`learned.ts`. La primera vez la estimación es de tabla y lo dice; a partir de la segunda es
de este equipo y ya no se anuncia como aproximada. Se guarda la **mediana** de las últimas
cinco, no el promedio, porque el RTF varía ~25 % entre corridas y una anómala no debe mover
la estimación.

Verificado en el navegador: en la segunda transcripción la interfaz ya mostraba «Falta
alrededor de 2 minutos» sin el «(estimación aproximada)».

## El RTF del catálogo, actualizado con lo medido

El catálogo decía **0,451**, que era una sola corrida del banco. Con todas las mediciones
de la configuración del producto (`turbo` / WebGPU / `enc:fp16/dec:q4`, sin timestamps):

| Medición | RTF | |
|---|---|---|
| banco, 8 ítems | 0,451 | limpia |
| banco, 1 ítem | 0,471 | limpia |
| producto, idioma fijo | 0,544 | limpia |
| banco, 8 ítems (segunda vez) | 0,565 | limpia |
| producto, con detección automática | 0,610 / 0,631 | **descartadas** |

Las dos últimas se descartan: son de las corridas donde el bug de idioma hacía traducir
*y* transcribir, generando el doble de tokens. Medían un defecto, no el equipo.

**Mediana 0,508. Rango 0,45–0,57. Dispersión del 25 %** entre corridas del mismo equipo con
la misma configuración.

### Tres cambios que salen de esto

1. **El catálogo guarda las mediciones, no un número.** `rtfSamples: [0.451, 0.471, 0.544,
   0.565]`, y `rtfMedian`/`rtfRange` derivan el resto. Ya hubo una vez un número copiado en
   vez de medido; guardando las observaciones eso es imposible.
2. **La estimación previa muestra un rango**: «entre 2 y 3 minutos» en vez de «2 minutos y
   17 segundos». Con una dispersión del 25 %, el segundo formato finge una precisión que no
   existe. Los perfiles con una sola medición se marcan `single` y muestran un número,
   porque un rango degenerado no es información.
3. **El texto del rango se redondea.** Componer dos duraciones daba «entre 2 minutos y 17 s
   y 2 minutos y 51 s», con dos «y» seguidas. Y el corte segundos/minutos va en 60 s y no
   en 90, porque con 90 la rama de minutos arrancaba en `round(1,5) = 2` y «alrededor de 1
   minuto» era inalcanzable: 75 s salía como «entre 70 y 80 segundos», que nadie dice.

## Prueba de mutación sobre `asr/`

Trece mutantes nuevos sobre los módulos del producto, uno por cada decisión que los tests
dicen cubrir. **Tres sobrevivieron**, y cada uno era un hueco real:

**1. El filtro de backend en `evidence.ts` no se ejercitaba.** Quitar `m.backend ===
backend` no rompía ningún test. Investigado: **ninguna combinación de modelo y dtype está
medida en los dos backends**, así que con la tabla real ese filtro nunca se usa. Era un
mutante equivalente *con los datos de hoy* — pero la guarda hace falta, porque `q8` está
roto en WebGPU y bien en WASM, y el día que se mida un mismo dtype en ambos, confundirlos
daría por buena una configuración rota. `lookup` ahora acepta una tabla inyectable y el
test fija la propiedad con datos construidos.

**2. El default de los timestamps no estaba fijado por ningún test.** Invertirlo a `true`
—que sube el WER de 3,03 % a 4,52 %— pasaba la suite entera. Vivía dentro de un método que
necesita un modelo cargado, así que no había forma de comprobarlo. Extraído a
`resolveTimestamps()`, que ahora tiene su test.

**3. El test del rango de tiempo no distinguía redondear de truncar.** Usaba 125–130 s,
donde `round` y `floor` dan lo mismo. El caso que sí discrimina es **170–175 s**: redondeando
son «alrededor de 3 minutos», truncando saldría «entre 2 y 3» — un rango inventado. El test
decía cubrir el ensanchamiento y no lo cubría.

Con los tres cerrados: **los 23 mutantes mueren** y hay **151 tests** en verde.

## Cierre del criterio de E1

| Criterio | Estado |
|---|---|
| 5 min de punta a punta en Chrome | ✅ |
| …y en Firefox | ⏭️ **salteado por decisión** — ver abajo |
| Panel de red sin subida de audio | ✅ |
| Test de decodificación y remuestreo a 16 kHz | ✅ 15 tests |
| Test de fragmentación con solapamiento | ✅ |
| Test de degradación worker → hilo principal | ✅ 9 tests |
| Estimación dentro de ±25 % | ❌ **criterio reemplazado** — ver abajo |

**177 tests, 28 mutantes muertos.**

### Firefox: salteado, pero el riesgo cubierto

Lo que Firefox iba a ejercitar de verdad no era «Firefox» sino **el camino sin WebGPU**,
que hasta ahora no se había ejecutado en ningún navegador. Y ese camino no necesita
Firefox: se fuerza con `?perfil=base-wasm`.

Verificado en Chrome: **90 palabras en 22 s, RTF 0,328**, y la calidad es exactamente lo que
el aviso promete —«el viaje en **marco**» por «barco», «**Quedes** detalles me **puedes**
dar» por «¿Qué detalles me podés dar»—. Se entiende el sentido, hay que corregir. El aviso
de «Calidad limitada» ni exagera ni minimiza.

Queda pendiente Firefox como navegador, no como camino.

### El parámetro de diagnóstico encontró un bug de la interfaz

`?perfil=` se agregó para forzar el camino sin GPU, y de paso destapó que **el panel
mostraba el perfil que la detección eligió, no el que se iba a usar**. Con el forzado
decía «Calidad alta · turbo-webgpu» mientras cargaba `base-wasm`. El mismo defecto
afectaba al botón de la alternativa: quien pulsara «usar el modelo más preciso» seguía
leyendo el modelo anterior.

### El criterio de ±25 % se reemplaza, y por qué

No era «difícil de cumplir»: estaba **mal planteado**, y comprobarlo destapó un error de
unidad en el catálogo.

El rango salía de RTF **agregados** —el promedio ponderado de ocho archivos por corrida—.
Al comprobarlo contra archivos individuales, **sólo 8 de 16 caían dentro**. La razón es que
el usuario transcribe *un archivo*, no un corpus: los archivos cortos pagan más
calentamiento y los difíciles generan más tokens, así que su RTF se dispersa mucho más que
el de un promedio. **Predecir un archivo con la variabilidad de un promedio subestima el
error por construcción.**

Corregido:

- `rtfSamples` guarda ahora **16 mediciones por archivo**, no cuatro promedios de corrida.
- `rtfRange` usa **percentiles 10 y 90**, no mínimo y máximo: con min/max basta un archivo
  raro para ensanchar el rango a perpetuidad, y termina siendo tan ancho que no informa.
- La métrica de cierre pasa a ser **que el rango mostrado contenga el tiempo real**, que es
  lo que la herramienta efectivamente promete. Con los datos actuales cubre el 75 %.

**Lo que falta para cerrarlo de verdad:** el rango se derivó de las mismas mediciones con
las que se evalúa, así que la cobertura del 75 % **no es una validación independiente**.
Hace falta medir archivos nuevos y comprobar contra ellos.

## Lanzado

**https://open-srt.vercel.app** · repo público
[Tobb-s/open-srt](https://github.com/Tobb-s/open-srt)

Verificado en producción, no sólo que responde 200:

- `/es` y `/en` sirven; detecta WebGPU y elige `turbo-webgpu`.
- **113 palabras en 37 s** sobre el archivo de 1 min, con el voseo intacto.
- La estimación previa dijo «entre 29 y 40 segundos» y tardó 37: **acertó dentro del rango**.
- **Red: una sola petición GET al propio sitio.** Cero POST, cero subida de audio.

### La privacidad pasó de promesa a mecanismo

El despliegue traía inyectado el widget de comentarios de Vercel —un tercero con acceso al
DOM—. No subía audio, pero en una herramienta cuya propuesta es que nada sale de tu equipo,
un tercero en la página contradice el mensaje.

La política de seguridad de `next.config.ts` hace que **el navegador imponga la promesa** en
vez de confiar en que el código se porte bien. `connect-src` enumera todo lo que la página
puede contactar —el propio sitio y Hugging Face, de donde baja el modelo—, así que aunque se
colara un script no tendría a dónde mandar nada. Comprobado: el widget no monta, no deja
variables globales, y una carga directa del script se bloquea.

`script-src` lleva `'unsafe-inline'` porque Next hidrata las páginas estáticas con scripts en
línea; sin eso falla con el error 412 de React y la aplicación no arranca. Es una concesión
aceptable porque no es la línea que protege la privacidad.

### Dos trampas del despliegue

- **Vercel usa `.vercelignore`, no `.gitignore`.** Sin él intenta subir los 192 MB del corpus
  y aborta. Pero `scripts/` **sí** debe subirse: el test del remuestreo importa
  `scripts/lib/wav.mjs` y el build verifica los tipos de todo el proyecto.
- El widget de Vercel se inyecta en el HTML servido, así que el tag sigue ahí aunque no
  ejecute. Se puede quitar del todo desde la configuración del proyecto.

## Pendiente

- **Validar el rango con archivos nuevos**, independientes de los que lo definieron.
- Firefox como navegador (el camino sin GPU ya está cubierto).
