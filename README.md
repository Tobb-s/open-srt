# OpenSRT

Transcribe audio a texto **en tu propia computadora**, dentro del navegador. El audio no se
sube a ningún servidor.

Tercera herramienta de la familia de [OpenPDF](https://github.com/Tobb-s/open-pdf) y
open-latex-ai: el trabajo ocurre en tu equipo, no en el de otro.

---

## Qué hace hoy

Toma un archivo de audio y devuelve su texto. Nada más — y eso es a propósito: es la
primera etapa de un plan de seis, y cada una se cierra con mediciones antes de pasar a la
siguiente.

- **El audio nunca sale de tu computadora.** Lo que sí entra es el modelo: unos cientos de
  megabytes que se descargan una vez desde Hugging Face y quedan en la caché del navegador.
  Decir «nada sale de tu equipo» a secas sería falso, así que la interfaz lo aclara.
- **Bilingüe por URL**: `/es` y `/en`.
- **Dice cuánto va a tardar** *antes* de empezar, y aprende del propio uso: la primera
  estimación viene de una tabla y lo declara; a partir de la segunda transcripción usa lo
  que tardó en tu equipo.
- **Elige el modelo según lo que aguanta tu equipo**, y si va a ser peor, lo dice.

Lo que **todavía no** hace: subtítulos con marcas de tiempo, video, separar hablantes,
traducción ni resúmenes. Están planificados en `docs/ETAPAS.md`.

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
transcripciones importantes. La etapa 2 incorpora detección de voz, que permite avisar
cuando el texto producido no se corresponde con el habla detectada.

## Correrlo

```bash
npm install
npm run dev
```

Hace falta un navegador con WebGPU para la mejor calidad (Chrome reciente). Sin WebGPU
funciona igual, con un modelo más chico.

## Desarrollo

```bash
npm test             # 179 tests
npm run mutation     # rompe el código a propósito y confirma que los tests lo atrapan
npm run corpus:build # regenera el corpus de medición desde OpenSLR
npm run corpus:verify
```

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
