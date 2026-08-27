# OpenSRT

Transcribe audio a texto **en tu propia computadora**, dentro del navegador. El audio no se
sube a ningún servidor.

Tercera herramienta de la familia de [OpenPDF](https://github.com/Tobb-s/open-pdf) y
open-latex-ai: el trabajo ocurre en tu equipo, no en el de otro.

---

## Qué hace hoy

Toma un archivo de audio y devuelve su texto **con marcas de tiempo**, listo para corregir
y para exportar como subtítulos. Es la segunda etapa de un plan de seis, y cada una se
cierra con mediciones antes de pasar a la siguiente.

- **El audio nunca sale de tu computadora.** Lo que sí entra es el modelo: unos cientos de
  megabytes que se descargan una vez desde Hugging Face y quedan en la caché del navegador.
  Decir «nada sale de tu equipo» a secas sería falso, así que la interfaz lo aclara. Todo lo
  demás —incluido el motor de ONNX que ejecuta el modelo— se sirve desde el propio sitio, no
  desde un CDN de terceros.
- **Subtítulos con tiempos reales**: `.srt` y `.vtt`, con las convenciones que hacen que se
  lean bien (42 caracteres por línea, dos líneas, velocidad de lectura). Comprobado en VLC.
- **Video**: mp4, webm y más. No hace falta ninguna cabecera especial ni ffmpeg en el
  navegador — el audio de un contenedor de video se abre con lo mismo que ya se usaba para
  audio. Está medido en `docs/E3-ESTADO.md`.
- **Seis formatos de salida**: TXT, SRT, VTT, CSV, **DOCX y PDF**. El documento lleva las
  horas en el margen y el texto en columna: es para leer, no un volcado.
- **Separa hablantes**, si se lo pedís. Marca quién dice cada cosa, con un color por persona
  y nombres que podés cambiar. Corre en tu equipo como todo lo demás: 25 MB más de descarga y
  alrededor de un tercio más de tiempo. Los nombres van a los seis formatos, cada uno con su
  convención — `<v Nombre>` en VTT, columna propia en CSV.
- **Editor sincronizado**: hacés clic en el tiempo de una línea y el audio salta ahí; el
  texto se corrige en el lugar.
- **Queda guardado en tu navegador.** Cerrás la pestaña, volvés, y la transcripción y tus
  correcciones siguen ahí. En tu máquina, y con un botón para borrarlo.
- **Se puede retomar.** Con un archivo largo, el avance se guarda a medida que termina cada
  bloque: si cerrás a la mitad, al volver a elegir el archivo te ofrece seguir donde iba en
  vez de empezar de nuevo. Comprobado cortando una transcripción de 30 minutos por la mitad.
- **Avisa cuando puede faltar contenido.** Un detector de voz mide cuánto se habló; si el
  texto no da cuenta de ese tiempo, lo dice.
- **Bilingüe por URL**: `/es` y `/en`.
- **Dice cuánto va a tardar** *antes* de empezar, y aprende del propio uso: la primera
  estimación viene de una tabla y lo declara; a partir de la segunda transcripción usa lo
  que tardó en tu equipo.
- **Elige el modelo según lo que aguanta tu equipo**, y si va a ser peor, lo dice.

Lo que **todavía no** hace: traducción ni resúmenes. Están planificados en `docs/ETAPAS.md`.

## Qué tan bueno es

Todo medido, no estimado. Los reportes crudos están en `benchmarks/`.

| Con GPU (WebGPU) | Sin GPU |
|---|---|
| `whisper-large-v3-turbo` | `whisper-base` |
| **WER 2,98 %** | WER 29,6 % |
| ~0,46× tiempo real | ~0,45× tiempo real |

Es decir: con aceleración por GPU, una hora de audio tarda unos 28 minutos y sale con
menos de 3 % de error. Sin GPU la velocidad es parecida pero **la calidad cae mucho**, y la
herramienta lo advierte en pantalla en vez de disimularlo.

### Una limitación conocida, medida y sin resolver

**Whisper puede omitir un tramo entero de audio sin dar ninguna señal.** Medido sobre 46
transcripciones: 0 casos en 23 archivos en español, **3 en 23 en inglés**, con hasta el 32 %
del texto faltante. Lo que devuelve es fluido y plausible, así que el faltante no se nota
sin tener el original al lado.

No es un defecto de esta herramienta sino del modelo, pero **te afecta igual**: revisá las
transcripciones importantes.

La etapa 2 no lo resuelve —no se puede desde afuera del modelo— pero hace dos cosas al
respecto. Detecta cuánta voz hay y **avisa** cuando el texto no da cuenta de ese tiempo. Y
recorta el audio a los tramos con voz antes de dárselo al modelo, lo que elimina las
invenciones en el silencio: medido sobre audio construido, **cero inserciones con el
detector contra dos por archivo sin él** — el modelo escribía `[Música]` donde no hablaba
nadie. Los números están en `docs/E2-ESTADO.md`.

## Correrlo

```bash
npm install
npm run dev
```

Hace falta un navegador con WebGPU para la mejor calidad (Chrome reciente). Sin WebGPU
funciona igual, con un modelo más chico.

## Desarrollo

```bash
npm test             # 433 tests
npm run mutation     # rompe el código a propósito y confirma que los tests lo atrapan
                     # (acepta un filtro: `npm run mutation -- csv.ts`)
npm run corpus:build # regenera el corpus de medición desde OpenSLR
npm run corpus:verify
npm run drift:build  # arma el audio de 30 min del test de desfase
```

Algunos tests de integración necesitan artefactos locales y se saltean sin ellos: el corpus
(`corpus:build`), el detector de voz (`vad:fetch`), el audio de desfase (`drift:build`) y
VLC instalado. El resto corre en cualquier lado.

El banco de medición vive en `/bench` y no forma parte del producto: es la herramienta con
la que se eligió el modelo. `docs/` tiene el plan por etapas y el registro de cada decisión
con los números que la sostienen.

## Créditos y licencias

- Modelos: [Whisper](https://github.com/openai/whisper) de OpenAI, convertidos a ONNX por
  [onnx-community](https://huggingface.co/onnx-community). MIT / Apache-2.0 según la
  variante — el detalle verificado está en `src/lib/asr/models.ts`.
- Motor: [transformers.js](https://github.com/huggingface/transformers.js).
- Corpus de medición: [OpenSLR SLR61](https://www.openslr.org/61/) (español argentino) y
  [SLR83](https://www.openslr.org/83/) (inglés de Reino Unido e Irlanda), ambos CC BY-SA 4.0.
