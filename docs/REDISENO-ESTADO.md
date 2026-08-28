# Rediseño — estado

Actualizado: 28 de agosto de 2026. **Pasos 1 y 2 cerrados.**

El plan completo está en el artefacto del rediseño (cinco pasos). Este archivo registra lo
hecho y lo medido, paso por paso, con la misma regla de siempre: una cifra que sólo existe
en una conversación no es evidencia.

---

## Paso 1 — cimientos: tipografía, tokens, modo oscuro unificado, primitivas

### El defecto que lo motivó

Todo el producto se veía en **Arial**. `globals.css` traía de la plantilla de
create-next-app un `--font-sans: var(--font-geist-sans)` que nadie definía —el layout nunca
cargó `next/font`— y un `font-family: Arial, Helvetica, sans-serif` en `body` que era la
letra real desde E0. Comprobado en producción con estilos computados: `body` y `h1`
resolvían `Arial, Helvetica, sans-serif`.

### Qué se hizo

1. **Tipografía real, tres roles** (`src/app/layout.tsx`): Bricolage Grotesque para
   títulos, Instrument Sans para la interfaz, IBM Plex Mono para los tiempos — sólo el
   peso 400, que es el único que los contextos mono usan. Vía `next/font`: la fuente se
   baja **en el build** y se sirve desde el propio origen, así que `font-src 'self'` de la
   CSP la cubre y en ejecución no se le pide nada a Google — medido: 5 recursos desde
   `/_next/static/media/`, **0 peticiones a gstatic/googleapis**.

2. **Tokens semánticos** (`src/app/globals.css`): cada color tiene nombre de rol
   (`tinta`, `apagado`, `acento-fondo`, `advertencia-titulo`…), un valor claro y uno
   oscuro, y el JSX usa la utilidad (`text-apagado`) sin saber el valor. Los valores son
   los oklch de Tailwind 4 que las clases sueltas ya usaban; toda desviación está marcada
   en el archivo (`⚠ contraste`, `DECISIÓN`) y listada abajo. Cambiar la paleta (paso 3)
   será cambiar este archivo.

3. **Modo oscuro en un solo lugar.** Antes convivían pares `dark:` en el JSX y variables
   por `prefers-color-scheme` que nadie consumía. Ahora el tema se decide en `:root` una
   vez. En el JSX del producto no queda **ningún** `dark:` ni ninguna clase de paleta
   suelta (la aserción final del script de migración falla si queda una).

4. **Cuatro primitivas** (`src/components/ui.tsx`): `Boton`, `Campo`/`Selector`,
   `Tarjeta`, `Chip`, adoptadas en `Transcribe.tsx`, `Editor.tsx` y `page.tsx`. El
   tamaño `ninguno` de `Boton` existe por la paridad: los botones cuyo relleno original
   no cae en la escala lo conservan a la vista en su `className`; el paso 3 decide cuáles
   de esas diferencias eran intención. La paleta de hablantes (`diar/colores.ts`) queda
   aparte a propósito: es otro sistema, con su propia razón documentada.

### La migración, con la disciplina del mutation-check

El intercambio de clases lo hizo un script con **cada ancla afirmada única** (`assert
count == 1`) y los reemplazos globales con **su cuenta esperada declarada**. Es la lección
del incidente de i18n en E5. Al final, dos controles: cero clases de paleta sueltas y
balance de aperturas/cierres de cada primitiva.

### El contraste, medido y no estimado

`npm run contraste` (`scripts/contrast-check.mjs`) lee los tokens **del propio
`globals.css`**, convierte oklch→sRGB con la matemática de OKLab, compone las
transparencias sobre lo que de verdad tienen debajo —incluida la superficie intermedia
del aviso que vive dentro del panel translúcido—, y mide los **21 pares texto/fondo** que
la interfaz usa, en los dos temas. **El instrumento tiene control**: antes de medir
verifica que `oklch(55.6% 0 0)` dé `#737373`; si no, se declara roto y no mide.

Resultado: **42/42 pares ≥ 4,5:1**. Para llegar hubo tres correcciones —los únicos
cambios de color de texto del paso—:

- `text-neutral-400` (2,58:1 sobre blanco) subió a `--apagado`.
- El `--apagado` oscuro subió de neutral-500 (4,39:1 sobre neutral-950) a neutral-400.
- El `--apagado` claro bajó de `#737373` a `#707070`: neutral-500 daba **4,34:1** sobre
  `--acento-fondo` (el marcador «editado» dentro del tramo activo del editor), un par que
  la primera versión del instrumento omitía y la revisión adversarial encontró.

Hallazgos **no textuales** que el script informa y este paso no toca (decisión visible,
pertenece al paso 3): el borde de controles a 1,48:1 (WCAG 1.4.11 pide 3:1) y la barra de
avance sobre su riel a 2,88:1 en oscuro.

### La revisión adversarial: qué encontró y qué se hizo con cada cosa

Workflow de 4 lentes (mecánica de Tailwind 4, paridad en Transcribe, paridad en
Editor/ui, fuentes+instrumento), cada hallazgo verificado por **dos refutadores
independientes** que leen el repo real. Sobre código que ya había pasado build, suite,
lint y mi propia verificación con estilos computados, encontró **12 hallazgos reales: 7
se corrigieron y 5 se convirtieron en decisión declarada**. La pasada final volvió a
verificar contra el árbol corregido y descartó como irreproducible todo lo arreglado —
así se cierra el ciclo, no dando el arreglo por bueno. Es la cuarta vez en este proyecto
que la revisión adversarial encuentra lo que la verificación de una sola mano no vio.

**Corregidos:**

| Hallazgo | Corrección |
|---|---|
| 11 botones mapeados a la escala de la primitiva corrían su relleno hasta 4 px por lado, el doble de lo declarado | `tamano="ninguno"`: conservan el relleno original a la vista (verificado por los propios refutadores en la segunda pasada, que los declararon irreproducibles sobre el árbol corregido) |
| El instrumento omitía el par `apagado/acento-fondo`, que **fallaba** (4,34:1) | Par agregado; `--apagado` claro bajado a `#707070` (4,55:1) |
| El instrumento omitía `tinta-2/acento-fondo` («descartar» dentro del aviso) | Par agregado; pasa (7,16:1 / 7,19:1) |
| El instrumento componía el aviso de advertencia sobre el fondo cuando en el panel vive sobre una superficie translúcida | Soporte de superficie intermedia; los dos pares compuestos pasan |
| IBM Plex Mono cargaba y precargaba los pesos 500/600 que ningún contexto mono usa | Sólo 400; agregar un peso irá junto con su uso |
| El comentario de `tabular-nums` afirmaba cubrir los tiempos del editor, que son `font-mono` y no lo necesitan | Comentario corregido: la regla es para el código del banco |
| `paso1.diff` (el material de revisión) quedó desactualizado tras las correcciones | Regenerado antes de la pasada final de verificación |

**Declarados como decisión** (unificaciones de valores que eran accidente, un paso de
tono en modo oscuro cada una — colapsarlas es exactamente el trabajo del sistema de
tokens; el paso 3 los revaluará de todos modos):

- El recuadro del texto parcial: `dark:bg-neutral-900` opaco → `--superficie` (900 al
  50 %, apenas más hondo sobre el fondo).
- El resaltado del tramo activo del editor: blue-950/**40** → `--acento-fondo`
  (blue-950/**30**, el valor de los demás avisos).
- El relleno de la barra de descarga: neutral-500 fijo → `--apagado` (neutral-400 en
  oscuro; su contraste no textual sube de 3,19:1 a 5,86:1 sobre el riel).
- Todos los `Boton` secundarios comparten el hover que antes sólo tenían los de formato.
- `--deshabilitado` oscuro: neutral-600 en vez del neutral-400 original, que hacía que un
  control deshabilitado se viera **igual** que el texto secundario habilitado.

**Además, la revisión encontró un defecto en su propio arnés**: la primera agregación
clasificaba como «descartado» un hallazgo cuyos dos verificadores habían muerto por el
límite de sesión — un hallazgo sin verificar no es un hallazgo refutado. Corregido antes
de la segunda pasada; de ahí salieron dos de los confirmados.

### Verificado

| Qué | Antes (producción) | Después (build local) |
|---|---|---|
| `body` / `h1` computados | Arial / Arial | **Instrument Sans / Bricolage Grotesque** |
| Peticiones a Google en ejecución | 0 | **0** (la fuente viaja con el sitio) |
| Pares de texto ≥ 4,5:1 | no medido | **42/42** |
| `dark:` en el JSX del producto | decenas | **0** |
| Desborde horizontal en 375 px | no | **no** |
| Suite | 447 pasan | **447 pasan** |
| `next build` + `eslint` | — | **limpios** |

El panel del navegador no estaba compositando, así que la comparación visual fue por
**estilos computados** en vez de capturas: qué fuente y qué color resolvió el navegador,
en claro y en oscuro emulados. El tema oscuro resolvió cada token al valor declarado.

La prueba de mutación no se corrió: este paso no toca lógica; es la vara del paso 2,
donde sí se parte el monolito.

---

## Paso 2 — partir el monolito

### La vara que el plan proponía era ciega

El plan decía cerrar este paso corriendo `mutation-check.py` antes y después: «los mismos
88 mutantes, los mismos sobrevivientes». **Ese control no probaba nada de este refactor.**
Comprobado antes de empezar:

- `vitest.config.ts` recolecta `src/**/*.test.ts` en entorno `node`.
- No hay **ni un** test bajo `src/app` ni `src/components`.
- Los 88 mutantes viven todos en `src/lib/**` y `scripts/lib/wav.mjs`.

Es decir: se podía romper `Transcribe.tsx` entero y los 88 mutantes habrían dado idéntico.
Un instrumento que no puede ver lo que dice vigilar es peor que ninguno, porque da un
verde. Así que el paso 2 empezó **construyendo el instrumento**.

### La forma que eso le dio al refactor

La respuesta no fue «mover la lógica a un hook para que quede prolijo», sino **sacarla del
componente hacia donde el instrumento llega**. Es exactamente lo que hizo E1 al extraer
`transcribeBlocks` de la clase «para que los tests ejerciten código de producto».

| Dónde | Qué |
|---|---|
| `src/lib/sesion/cola.ts` | El recorrido de la cola: en serie, decodificando de a uno, con un archivo roto que no detiene la fila. |
| `src/lib/sesion/armar.ts` | Armar la sesión venga de donde venga, el aviso de guardado y si vale guardar. |
| `src/app/[lang]/useTranscripcion.ts` | El estado de React y el cableado con el motor. |
| `src/app/[lang]/pantallas/*.tsx` | Siete pantallas, cada una con una sola cosa que mostrar. |
| `src/app/[lang]/Transcribe.tsx` | Sólo **qué se ve y cuándo**. |

`armar.ts` además borra una duplicación real: el mismo mapeo de sesión estaba escrito
**tres veces** en el componente —al terminar de transcribir, al restaurar y al reabrir de
la cola— y las tres podían divergir sin que nada fallara.

### Tres defectos que aparecieron al mover el código

Ninguno lo habría encontrado la suite; los tres salieron de mirar el código de cerca, que
es como salieron los últimos de este proyecto.

1. **`acumulados` era código muerto y caro.** Juntaba los tramos de cada bloque con
   `acumulados = [...acumulados, ...p.segments]` y **nadie leía el resultado** — la
   transcripción sale de `out.segments`. En un archivo de dos horas son ~1300 copias de
   una lista que crece hasta ~1600 tramos: del orden de un millón de copias de tramo. Es
   el mismo patrón cuadrático que E5 corrigió para las escrituras en disco, sobreviviendo
   en memoria. Borrarlo no cambia nada observable: su valor no podía salir de ahí.

2. **Se escribía un ref durante el render.** `colaRef.current = cola` en el cuerpo del
   componente. Dentro del componente el linter no lo veía; al moverlo a un hook,
   `react-hooks/refs` lo marcó — y tiene razón: eso se rompe con el render doble de
   StrictMode y con el render concurrente, donde el valor puede venir de un render que
   React después descarta. El espejo tampoco hacía falta: `recorrerCola` sólo necesita la
   lista inicial, y las marcas van por el actualizador funcional de `setCola`.

3. **Un contrato que yo mismo asumí mal.** El primer test de la cola afirmaba que con la
   lista vacía no se transcribe nada. Falló, y así apareció el contrato real: **`primero`
   manda sobre qué se transcribe, `items` sólo sobre qué se dibuja**. Es la conducta del
   código original y quedó documentada, no cambiada.

### El instrumento nuevo, y la prueba de que muerde

- **32 tests** nuevos sobre la cola y el armado, donde antes había **cero**.
- **15 mutantes** nuevos en `mutation-check.py` (103 en total), todos sobre decisiones que
  **no lanzan ninguna excepción** al romperse: la cola transcribiendo diez veces el mismo
  archivo, un archivo que falla marcado como listo, la corrida a medias pasada al segundo
  archivo, los hablantes numerados desde 0, los campos internos de la base filtrándose al
  CSV del usuario.
- Uno de los 15 es un **control equivalente**: reescribe la llamada sin cambiar la
  semántica. Si ese muriera, los tests estarían atrapando la forma del código y no su
  conducta.

**Resultado: 14 de 15 muertos, y el único sobreviviente es el control equivalente.** Es
el resultado que se buscaba y no una casualidad afortunada: cada mutante real murió, y el
que no cambia la conducta sobrevivió. Sin ese control, «14 muertos» no distinguiría entre
tests que miden conducta y tests que memorizan la forma del código.

Los muertos con su cuenta de tests en rojo:

| Mutante | Tests en rojo |
|---|---|
| la cola transcribe siempre el primero | 5 |
| el video restaurado se abre como audio | 3 |
| la cola vuelve a decodificar el primero · con un archivo la cola no transcribe | 2 cada uno |
| los otros nueve | 1 cada uno |

El de 5 tests en rojo es el importante: es la captura vieja de React, el error que este
refactor podía reintroducir sin que nada fallara.

### El script de mutación tenía un agujero, y me mordió

A mitad de la primera corrida el proceso murió por una señal que el `finally` no puede
atrapar, y **dejó `armar.ts` mutado**. La suite quedó en rojo por una mutación pegada, y
la receta que documentaba el encabezado —`git checkout -- <archivo>`— **no servía**,
porque el módulo era nuevo y todavía no estaba bajo seguimiento.

Ahora el script deja un respaldo `.mutbak` en disco **antes** de mutar y lo restaura al
arrancar la corrida siguiente, avisando qué recuperó. Sobrevive a un `SIGKILL` y no
depende de git.

### Verificado en el navegador, de punta a punta

Con `next build && next start` y un WAV real del corpus, forzando el camino sin GPU
(`?perfil=base-wasm`):

| Camino | Resultado |
|---|---|
| Detección de capacidades y `?perfil=` | «Calidad limitada · base-wasm · 145 MB» |
| `ArchivoListo` | duración, techo de estimación, idioma por defecto = interfaz, hablantes |
| `ListaDeCola` con dos archivos | «Cola: 0 de 2 listos», ambos «en espera» |
| `Progreso`, fase por fase | modelo → detector → detección con avance → transcripción con contador de bloques |
| `Resultado` | editor con **15 tramos**, 146 palabras, 42 s de habla, reproductor, los seis formatos, oferta de traducción |
| `AvisoDeSesion` + `sesionDeGuardada` | al recargar ofrece la sesión; al abrirla, **los mismos 15 tramos y 146 palabras** |

### Estructura final

| Archivo | Líneas |
|---|---|
| `Transcribe.tsx` | **157** (era 1079) |
| `useTranscripcion.ts` | 659 |
| Pantalla más grande (`ArchivoListo`) | 156 |
| `cola.ts` + `armar.ts` | 230, con 401 líneas de test |

**Lo que este paso NO logró, dicho de frente:** el criterio del plan era «ninguna pantalla
por encima de 200», y las pantallas cumplen (156 la mayor). Pero el hook quedó en **659
líneas**, y ahora es el archivo más grande del proyecto. El grueso es `transcribirUno`
(~190 líneas): el cableado de una sola operación asincrónica con ocho callbacks. Las
*decisiones* que tenía adentro ya salieron a `lib`; lo que queda es cableado. Partirlo más
sería mover llaves de lugar con riesgo de cambiar conducta, así que queda anotado como
límite conocido y no como trabajo pendiente disfrazado de hecho.

---

## Paso 3 — el flujo principal: momentos, no cajas

### Una cifra del plan estaba mal, y se corrige antes de usarla

El plan decía que el botón principal caía **bajo el pliegue** a 596 px en 375×812. Medido
de nuevo sobre el build actual: estaba a **619 px**, y 619 + 44 = 663 < 812, así que **no
estaba bajo el pliegue geométrico**. Sólo lo está contando la barra del navegador (110–160
px en Safari o Chrome de teléfono), donde queda al borde.

El problema real no necesitaba ese argumento y es más fácil de medir: **1264 px de página
en un teléfono cuya única tarea, en ese instante, es elegir un archivo**, con 619 px de
texto y vocabulario interno antes de la acción.

### Cuatro momentos

| Momento | Manda | Qué se calla |
|---|---|---|
| `soltar` | la zona de soltar | ajustes y privacidad, plegados |
| `preparar` | el archivo y su costo | la zona de soltar, ya cumplió |
| `trabajando` | el avance | todo lo demás |
| `leer` | la transcripción | encabezado encogido, sin panel ni privacidad |

Para que el encabezado y el pie puedan encogerse tienen que ver el estado, así que pasaron
de `page.tsx` —que los dibujaba siempre iguales— a `Transcribe.tsx`. `page.tsx` quedó en
lo suyo: validar el idioma.

### La regla que hace honesto plegar

**Una advertencia no se pliega.** Si la detección avisa que este equipo no tiene GPU y va
a usar un modelo que comete bastantes más errores, eso queda **fuera** del panel cerrado.
Esconder una advertencia adentro de un `<details>` es la forma elegante de no darla.

Los paneles son `<details>` del navegador y no un estado propio: traen el teclado, el
anuncio para lectores de pantalla y el estado abierto/cerrado, gratis y bien hechos.
Comprobado: un solo `<h1>` en la página y los dos disparadores enfocables.

### La pasada de textos

- `turbo-webgpu` / `base-wasm` era **la clave interna de `models.ts`** en la primera línea
  que veía el usuario. Ahora dice **«Usa la placa de video · 850 MB la primera vez»**.
- El pie decía «Etapa 4: … Traducir y resumir vienen después». Vocabulario interno —las
  etapas son del plan de desarrollo— y además **ya era falso**: traducir se hizo en E5 y
  resumir se descartó por alcance.
- El subtítulo decía dos veces lo mismo en dos oraciones y ocupaba **cuatro líneas** en un
  teléfono. Ahora es una.

### La barra de exportación, pegada al borde

Vivía al final del documento. Con una reunión de una hora son cientos de tramos, así que
bajar el SRT obligaba a recorrer la transcripción entera hasta el fondo. La acción no
depende de dónde esté leyendo el usuario. Ahora es `sticky bottom-0` con fondo **opaco**
—translúcido, el texto se vería pasar por detrás de los botones—.

### Medido, antes y después

| | Paso 2 | Paso 3 |
|---|---|---|
| Botón principal en 375×812, primera visita | 619 px | **406 px** |
| Botón principal con sesión guardada | 765 px | **544 px** |
| Alto de la página en móvil | 1264 px | **812 px** (entra entera en una pantalla) |
| Alto de la página en 1280×900 | 972 px | **900 px** (sin scroll) |
| Jerga visible (`turbo-webgpu`, «Etapa 4») | sí | **no** |
| Desborde horizontal en 375 px | no | **no** |
| Pares de contraste ≥ 4,5:1 | 42/42 | **42/42** |
| Suite · lint · build | verdes | **verdes** |

Los tres momentos se verificaron en el navegador con un WAV real: `preparar` sin zona de
soltar ni paneles, `leer` con el encabezado encogido y los 15 tramos, y la barra de
exportación resuelta como `position: sticky; bottom: 0px` con fondo opaco.

### Un límite del entorno, no del código

Dos corridas de transcripción **por WebGPU** terminaron con la pestaña recargada. El
camino sin GPU (`?perfil=base-wasm`) completó las dos veces que se probó. Es coherente con
lo ya sabido de este equipo —un driver AMD que ya tumbó la aplicación una vez— así que la
verificación de punta a punta se hizo por el camino WASM y **el camino WebGPU queda sin
comprobar en este entorno**. No se afirma que funcione ni que no: no se pudo medir acá.

---

## Paso 4 — la biblioteca

### La decisión que había que medir, medida

El plan decía que `MAX_SESSIONS = 5` **no se decide, se mide**. Medido el 28/08/2026 en el
equipo del usuario, con `navigator.storage.estimate()` y leyendo IndexedDB:

| | |
|---|---|
| Cuota del origen | **6,08 GB** |
| Uso: modelo Whisper en `caches` | 82,4 MB |
| Uso: **todas las transcripciones juntas** | **45 KB** |
| Peso de un tramo | **175 bytes** |
| Extrapolado: una reunión de 1 h | 400-800 tramos ≈ 70-140 KB de texto |
| El costo real: audio de 1 h | 30-60 MB en mp3, ~350 MB en WAV |

El tope borraba la sexta transcripción **con el 99,99 % de la cuota libre**, y contaba
sesiones donde la restricción son bytes. El mismo número es a la vez demasiado y demasiado
poco: cinco mp3 de una hora son 225 MB sobre 6 GB, y cinco WAV de una hora son 1,75 GB,
que en un portátil con el disco lleno no entran ni de cerca.

### Una medición que descartó una familia entera de soluciones

Antes de diseñar nada había que saber si `estimate()` sirve para decidir. Se escribió un
blob de 40 MB y se borró, muestreando el uso a 0,5 s, 2 s, 5 s, 10 s y 20 s:

- Escribir 40 MB → `usage` **sube 40 MB al instante**.
- Borrarlos → `usage` **no baja**. Las cinco muestras, planas en +40 MB.

O sea que `estimate()` sirve para la **cuota** (estable) y para ver que algo se consumió,
pero **no** para comprobar que algo se liberó. Cualquier política que borrara y volviera a
consultar leería un número viejo, concluiría que sigue sin entrar, y borraría otra vez:
**borrado en cadena, en silencio**, que es el peor fallo posible en algo que se llama
biblioteca. Por eso la contabilidad es propia (`blob.size`, exacto) y `estimate()` sólo se
consulta **antes de escribir**, nunca después de borrar.

### Un panel de diseño donde el acuerdo valió más que el ganador

Se corrieron cuatro propuestas independientes —«nada se borra solo», «el texto es sagrado y
el audio es caché», «un presupuesto en bytes, no un conteo», «que decida el usuario»—, cada
una juzgada por tres lentes distintas (pérdida de datos, realidad de la cuota,
construibilidad). Empataron en 6,0.

**El empate es el resultado**: los cuatro ángulos, sin verse entre sí, llegaron a la misma
regla. Eso pesa más que un puntaje alto de una sola. Y aportaron algo que no estaba en la
medición: **sin `navigator.storage.persist()`, el navegador puede desalojar el origen
entero** — un borrador automático mucho mayor que `prune()`, así que decir «nada se borra
solo» sin más sería mentir.

### La política

- **`prune()` no existe.** Nada del usuario se borra solo. `MAX_SESSIONS` queda sólo como
  `MAX_SESSIONS_HISTORICO`, comentado, porque su desaparición es el cambio del paso.
- **El texto se guarda siempre y sin tope**: 175 bytes por tramo.
- **El audio es una caché con presupuesto.** `cabeAudio(bytes, {quota, usage})` es una
  función pura en `src/lib` —donde los tests y los mutantes llegan— que exige dejar libre
  `max(150 MB, cuota × 10 %)`. El piso de 150 MB no es cortesía: **la caché del modelo vive
  en la misma cuota** y pesa entre 145 y 850 MB. Llenarla haría que el navegador tire el
  modelo y la próxima visita vuelva a bajar 850 MB.
- **Falla abierto.** Sin `estimate()`, o con una cuota absurda, `cabeAudio` devuelve `true`:
  un instrumento ciego no puede negar el audio para siempre. Si de verdad no entra, la
  escritura falla y el `try/catch` que ya existía degrada.
- **`liberarAudio(id)`** suelta el audio y deja el texto intacto: la salida real cuando
  falta lugar, porque el audio es una **copia** de un archivo que el usuario ya tiene y el
  texto no existe en ningún otro lado.
- **`audioMotivo`** distingue «no entró», «falló» y «lo soltaste vos», que para quien lee
  la biblioteca son tres cosas distintas.

**La excepción que queda, declarada:** `MAX_RUNS = 3` sigue descartando corridas a medias
viejas. Una corrida es progreso hacia el artefacto, no el artefacto, está atada a un
archivo que el usuario todavía tiene, y ahora es **visible y descartable** desde la
biblioteca. No es lo mismo que borrar una transcripción terminada, pero sigue siendo un
borrado automático y por eso se dice acá en vez de omitirse.

### La pantalla

`/[lang]/biblioteca`, ruta propia y **sin cargar el motor**: bajar 850 MB de modelo para
mirar una lista sería absurdo. Muestra cada transcripción con fecha, duración, tramos y lo
que ocupa su audio; permite abrir, renombrar, soltar el audio, borrar y **descargar todas**
en un zip. Las corridas a medias —que existían en la tabla `runs` desde E5 y sólo aparecían
si el usuario volvía a elegir el mismo archivo— ahora se ven siempre.

### Dos defectos encontrados por sus propios tests

1. **`nombreSeguro` mal escrita, dos veces.** El primer test la reprobó: «reunión:
   equipo/ventas*.mp3» quedaba como «reunión- equipo-ventas-», y «///.mp3» quedaba en
   «---», que **no es vacío** y por eso no activaba el respaldo — habría salido un archivo
   llamado `---.txt`. Además el archivo tenía **caracteres de control** (`\x00-\x1f`)
   metidos por un heredoc donde yo creía tener un espacio, así que la clase de caracteres
   prohibidos no era la que yo había escrito.
2. **El enlace «Abrir» de la biblioteca no abría nada.** Probado en el navegador: llevaba
   a la pantalla de soltar archivo, sin ningún error. La causa es una carrera silenciosa:
   `AsrEngine.inspect()` terminaba con `setPhase('idle')` **incondicional**, y sondear el
   adaptador de WebGPU tarda más que leer IndexedDB — la sesión se abría en fase «done» y
   medio segundo después la detección la devolvía a «idle». Ahora la detección sólo saca de
   «comprobando» (`setPhase((p) => (p === 'checking' ? 'idle' : p))`) y nunca pisa un
   estado posterior.

### Verificado en el navegador

| Qué | Resultado |
|---|---|
| Sesiones listadas | **9**, muy por encima del viejo tope de 5 |
| Renombrar | «paso3.wav» → «Reunión de equipo — agosto», persistido |
| Soltar audio | «1 transcripción · 0 B», la fila dice «audio soltado» |
| El texto tras soltar el audio | **146 palabras, 15 tramos: idénticos** |
| `?abrir=` | abre en momento «leer», con el aviso correcto de que el audio no está |
| Descargar todas | zip válido, **18 entradas** (9 × 2), acentos conservados |
| Dos archivos con el mismo nombre | `grabacion` y `grabacion (2)` — nadie se pisa |
| Cuota mostrada | «168,7 MB usados de 6,1 GB disponibles en este navegador» |

### Instrumentos

- **515 tests** (eran 479): 11 del presupuesto, 12 del paquete, 13 nuevos del almacén.
- **114 mutantes** (eran 103). De los 11 nuevos, **10 murieron y el único sobreviviente es
  el control equivalente** plantado a propósito. El más importante es «vuelve el borrador
  automático de sesiones», que **restituye `prune()`**: si sobreviviera, la prueba de que
  no se borra sería decorado. Murió con un test en rojo.

  Los muertos y cuántos tests los atraparon: el presupuesto dado vuelta (8), fallar cerrado
  en vez de abierto (9), quedarse sin reserva libre (6), la reserva sin su piso (3), los
  nombres del zip sin desambiguar (4), y cinco más con uno cada uno.

### El instrumento tenía un mutante inerte, y lo dijo mal

En la primera corrida, «liberar audio se lleva el texto» figuró como **sobreviviente**, con
el mensaje del script: «el test es más débil que su nombre». Era falso. El mutante metía
`sessions.delete(sessionId)` justo **antes** de `store.put({...})`, y `store` *es* la tabla
de sesiones: el `put` reinsertaba la fila en la misma transacción. **El mutante no cambiaba
nada observable**; el débil era él, no el test.

Vale anotar el límite: un sobreviviente significa **o** un test flojo **o** un mutante
inerte, y el script no puede distinguirlos — eso lo distingue quien lo lee. Reescrito para
que reemplace la actualización de la cabecera por su borrado, murió a la primera.
- El test del tope se **dio vuelta**: el mismo test que afirmaba que la sexta borraba la
  primera ahora afirma que no, con un control al lado que comprueba que `remove()` sí
  sigue borrando cuando lo pide el usuario — sin ese control, el primero pasaría por la
  razón equivocada.

---

## Paso 5 — terminaciones, accesibilidad y el control

### Lo que no estaba

Cuatro huecos, comprobados antes de tocar nada:

- **Cero reglas de foco.** Se usaba el anillo por defecto del navegador, distinto en cada
  uno y mal contrastado sobre el fondo oscuro.
- **Cero `prefers-reduced-motion`**, con seis transiciones activas. No es una preferencia
  estética: quien la activa suele tener trastornos vestibulares y una transición inesperada
  le produce mareo real.
- **Ningún anuncio en vivo.** Quien usa lector de pantalla hacía clic en «Transcribir» y no
  se enteraba de nada más: ni de que el modelo se estaba bajando, ni de que terminó.
- **`contentEditable` sin nombre.** El lector decía «editable» y nada más — ni de qué tramo
  ni de qué minuto.

### Lo que se hizo

- **Foco visible** desde el token `--foco`, con `:focus-visible` y no `:focus`: el navegador
  distingue el foco que llegó por teclado del que llegó por clic, y poner el anillo al
  hacer clic es la razón por la que tanta gente termina borrándolo — y dejando sin él a
  quien navega con teclado.
- **`prefers-reduced-motion`** anulando con `0.01ms` y **no** con `none`: un `transitionend`
  que nunca llega cuelga al código que lo espera, y eso es peor que el mareo que se quería
  evitar.
- **`role="status"` + `aria-live="polite"`** en la fase, **`role="progressbar"`** con
  `aria-valuenow` en las dos barras, y **`role="alert"`** en el error — la única
  interrupción, porque un fallo que nadie escucha es un fallo que nadie atiende.
- **Nombres accesibles** en los dos `contentEditable`: el del texto dice de qué minuto es.
- El estado de decodificación decía **«…»**. Ahora dice qué pasa, y lo anuncia.

### Medido, no supuesto

| Qué | Resultado |
|---|---|
| Recorrido de teclado, pantalla principal | **8 elementos, todos enfocables y con nombre** |
| Recorrido de teclado, biblioteca | **6 elementos, todos enfocables y con nombre** |
| Anillo de foco con un Tab real | `:focus-visible` coincide; anillo pintado con `--foco` |
| Elementos en movimiento en la pantalla de trabajo | **1** — la barra de avance, dentro de su `role="progressbar"` |
| Elementos en movimiento en la biblioteca | **0** |
| Pares de contraste ≥ 4,5:1 | **42/42** |

Un aviso sobre el método: la primera sonda del foco dijo que **no se aplicaba**. Era falso —
`.focus()` por código no activa `:focus-visible` en Chrome. El defecto estaba en el
instrumento, no en el CSS, y se vio recién al mandar un Tab de verdad.

### Un retroceso que sólo apareció al volver a medir

El enlace «Biblioteca» que agregó el paso 4 se puso **al lado del título**. Medido en 375
px: la nav ocupaba 139 px, le dejaba **172 px** al título, y el `<h1>` se partía en **cuatro
líneas** — 280 px de encabezado y **79 px** de castigo al botón principal (544 → 623).
Nadie lo notó al hacerlo; lo encontró la re-medición del paso 5.

El encabezado ahora se apila: la navegación en su propia fila y el título con el ancho
entero. Resultado: 4 líneas → **2**, encabezado 280 → **164 px**.

### Los seis números del diagnóstico, de punta a punta

| | Diagnóstico (paso 0) | Ahora |
|---|---|---|
| Tipografía | Arial (heredada de la plantilla) | **Instrument Sans / Bricolage Grotesque** |
| Botón principal en 375×812 | 619 px | **350 px** |
| Alto de página en móvil | 1264 px | **812 px** (una pantalla) |
| Primera línea bajo el título | «turbo-webgpu · 850 MB» | **sin jerga** |
| Componente más grande | `Transcribe.tsx`, 1079 líneas | **157 líneas** |
| Transcripciones guardadas | 5, con borrado silencioso | **sin tope; nada se borra solo** |

Escritorio 1280×900: **900 px**, sin scroll. Sin desborde horizontal en 375 px.

### El control: el criterio del plan no se pudo aplicar, y eso es el hallazgo

El plan decía cerrar con «el mp4 de 30 minutos contra E5: 3394 palabras, 399 tramos, 94,1 %
de cobertura». Al ejecutarlo aparecieron **dos problemas con el criterio mismo**:

1. **El mp4 no está en el repositorio.** E3 lo armó con VLC —H.264 más **AAC**— y no quedó
   guardado. Lo que sí está es el WAV original del corpus. AAC es con pérdida: decodificarlo
   no devuelve la forma de onda del WAV, así que el detector y el modelo ven muestras
   distintas. Comparar 3394/399 contra una corrida sobre el WAV sería llamar «regresión» a
   la diferencia entre dos entradas.
2. **La «cobertura del vocabulario» no es reproducible.** No hay ninguna función en el
   repositorio que la calcule: fue una cuenta improvisada en la verificación manual de E3.
   Comprobado: una normalización casera dio **86,4 %** sobre esta misma corrida — un número
   que **no significa nada** contra el 94,1 %, porque son instrumentos distintos.

Se reemplazó por los instrumentos que **sí** existen, los de E0: `normalizeToWords` + `wer`.
La corrida de control (`es-clean-30min.wav`, `base-wasm`, 30 min 1 s, 9 min de reloj):

| | |
|---|---|
| Bloques del detector | **65** — exactamente los mismos 65 de E5 |
| Palabras: referencia · obtenidas | 3373 · **3371** |
| **WER** | **12,4 %** (S 299 · D 54 · I 63) |
| Inserciones sobre referencia | **1,9 %** — sin alucinación |
| WER agregado declarado para `base-wasm` | 29,6 % |

**El 12,4 % contra el 29,6 % no es una mejora: son cosas distintas.** El 29,6 % es el
agregado de los **ocho ítems de nivel A**, que incluyen murmullo a 10 dB de SNR, tres
hablantes con solapamiento y los cuatro ítems en inglés. Éste es nivel B, limpio y en
español: la categoría más fácil. La primera versión del test exigía caer a ±15 puntos del
0,296 y **falló** — el umbral estaba mal, no la corrida. Lo que sí se puede afirmar es la
desigualdad: un ítem limpio no puede salir peor que el promedio que incluye los sucios.

El control que **no depende de la calidad del modelo** es el de los 65 bloques: la
segmentación del detector es idéntica a la de E5, y ésa es la parte que un refactor de
cinco pasos sí podía romper.

Todo queda en `src/lib/bench/control-rediseno.test.ts`, que se saltea solo si no está el
archivo y trae escrito cómo regenerarlo.

### Estado final

**518 tests · 114 mutantes · lint y build limpios · 42/42 pares de contraste.**
