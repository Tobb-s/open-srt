import type { ModelSpec } from './types';

/**
 * Los seis modelos de la matriz de E0.
 *
 * Todos los `hfId` y todas las licencias se verificaron el 23/08/2026 contra la API de
 * Hugging Face (`/api/models/{id}?full=true`, campo `cardData.license`). No están puestas
 * de memoria: la licencia ya nos descartó a Sortformer y condicionó a Moonshine, así que
 * acá va lo que el repositorio declara.
 *
 * Detalle que sorprende y conviene tener anotado: **los Whisper no son todos MIT**.
 * `openai/whisper-large-v3-turbo` declara MIT, pero `whisper-tiny` y `whisper-small`
 * declaran Apache-2.0. Las dos son permisivas y sirven igual para un producto; lo que no
 * sirve es repetir "MIT" para todos sin haberlo mirado.
 *
 * Y los repos de `onnx-community` **no declaran licencia propia**: heredan la del modelo
 * base al que apuntan por `base_model`. Por eso cada entrada dice de dónde sale el dato.
 */
export const MODELS: readonly ModelSpec[] = [
  {
    key: 'whisper-tiny',
    hfId: 'onnx-community/whisper-tiny',
    family: 'whisper',
    params: '39 M',
    approxMB: 75,
    license: 'apache-2.0',
    licenseFrom: 'hereda de openai/whisper-tiny',
    coverage: 'multi',
    note: 'Piso de la matriz: el que tiene que andar en el equipo más flojo.',
  },
  {
    key: 'whisper-base',
    hfId: 'onnx-community/whisper-base',
    family: 'whisper',
    params: '74 M',
    approxMB: 145,
    license: 'apache-2.0',
    licenseFrom: 'hereda de openai/whisper-base',
    coverage: 'multi',
    note: 'Candidato a por defecto si turbo no rinde en el equipo modesto.',
  },
  {
    key: 'whisper-small',
    hfId: 'onnx-community/whisper-small',
    family: 'whisper',
    params: '244 M',
    approxMB: 480,
    license: 'apache-2.0',
    licenseFrom: 'hereda de openai/whisper-small',
    coverage: 'multi',
    note: 'El punto medio. Las cifras publicadas lo dan más lento que tiempo real en WASM.',
  },
  {
    key: 'whisper-turbo',
    hfId: 'onnx-community/whisper-large-v3-turbo',
    family: 'whisper',
    params: '809 M',
    approxMB: 1200,
    license: 'mit',
    licenseFrom: 'hereda de openai/whisper-large-v3-turbo',
    coverage: 'multi',
    note: 'El candidato principal. Todo el plan depende de su RTF en el equipo modesto.',
  },
  {
    key: 'lite-whisper-turbo',
    hfId: 'onnx-community/lite-whisper-large-v3-turbo-ONNX',
    family: 'whisper',
    params: '~700 M',
    approxMB: 900,
    license: 'apache-2.0',
    licenseFrom: 'declarada en el propio repo; base efficient-speech/lite-whisper-…',
    coverage: 'multi',
    // Su generation_config.json no trae `lang_to_id`, así que transformers.js rechaza
    // `language`. Medido: los 16 ítems fallaban con "Cannot specify `task` or `language`
    // for an English-only model".
    acceptsLanguage: false,
    note:
      'Variante comprimida del turbo. El repo ONNX viene sin el mapa de idiomas, así que ' +
      'hay que dejar que autodetecte en vez de forzar el idioma.',
  },
  {
    key: 'moonshine-base',
    hfId: 'onnx-community/moonshine-base-ONNX',
    family: 'moonshine',
    params: '245 M',
    approxMB: 190,
    license: 'mit',
    licenseFrom: 'declarada en el repo y en UsefulSensors/moonshine-base',
    coverage: 'en',
    note:
      'SÓLO inglés. El modelo de inglés es MIT, pero los de español y demás idiomas usan ' +
      'la Moonshine AI Community License, que es no comercial. Por eso la matriz lo corre ' +
      'únicamente sobre ítems en inglés.',
  },
] as const;

export const BACKENDS = ['webgpu', 'wasm'] as const;

export function modelByKey(key: string): ModelSpec | undefined {
  return MODELS.find((m) => m.key === key);
}

/**
 * Si esta combinación de modelo e ítem debe correrse.
 *
 * Moonshine sobre un ítem en español no se corre: no es que ande mal, es que el modelo
 * multilingüe tiene una licencia que no podemos usar. Correrlo daría un número que no
 * sirve para decidir nada y confundiría la tabla.
 */
export function shouldRun(model: ModelSpec, itemLang: string): boolean {
  if (model.coverage === 'en' && itemLang !== 'en') return false;
  return true;
}
