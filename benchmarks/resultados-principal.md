# E0 — resultados medidos

Corrida `principal-2026-08-232147` · 2026-08-23T21:47:21.266Z

> Generado por `src/lib/bench/report.ts`. No editar a mano: se regenera.

## Equipo

| | |
|---|---|
| Etiqueta | principal |
| Navegador | `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36` |
| WebGPU | sí |
| Adaptador | amd rdna-2 |
| Núcleos | 16 |
| Memoria declarada | 32 GB |
| Aislamiento cross-origin | no |

## Matriz

Cada celda: **RTF** · WER. RTF menor que 1 es más rápido que tiempo real.

| Modelo | WEBGPU | WASM | Licencia |
|---|---|---|---|
| `whisper-tiny` | **0.17** · 33.2 % | **0.29** · 87.7 % | apache-2.0 |
| `whisper-base` | **0.19** · 36.6 % | **0.44** · 29.6 % | apache-2.0 |
| `whisper-small` | **0.64** · 20.5 % | **1.25** · 19.5 % | apache-2.0 |
| `whisper-turbo` | ⏱ >5× | **4.74** · 1.8 % | mit |
| `lite-whisper-turbo` | ✕ error | ✕ error | apache-2.0 |
| `moonshine-base` | **0.17** · 42.9 % | **0.35** · 42.9 % | mit |

## Detalle por par

| Modelo | Backend | n | RTF | WER | Inserciones | Pico CPU | Carga |
|---|---|---|---|---|---|---|---|
| `whisper-tiny` | webgpu | 8 | 0.17 | 33.2 % | 48 | 130 MB | 2.0 s |
| `whisper-tiny` | wasm | 8 | 0.29 | 87.7 % | 1079 | 116 MB | 2.6 s |
| `whisper-base` | webgpu | 8 | 0.19 | 36.6 % | 27 | 117 MB | 2.9 s |
| `whisper-base` | wasm | 8 | 0.44 | 29.6 % | 40 | 118 MB | 9.5 s |
| `whisper-small` | webgpu | 8 | 0.64 | 20.5 % | 13 | 119 MB | 28.7 s |
| `whisper-small` | wasm | 8 | 1.25 | 19.5 % | 12 | 117 MB | 13.7 s |
| `whisper-turbo` | webgpu | 8 | ⏱ >5× | | | | |
| `whisper-turbo` | wasm | 1 | 4.74 | 1.8 % | 0 | 122 MB | 42.3 s |
| `lite-whisper-turbo` | webgpu | 8 | ✕ error | | | | |
| `lite-whisper-turbo` | wasm | 8 | ✕ error | | | | |
| `moonshine-base` | webgpu | 1 | 0.17 | 42.9 % | 14 | 119 MB | 11.0 s |
| `moonshine-base` | wasm | 1 | 0.35 | 42.9 % | 14 | 119 MB | 5.7 s |

## Cómo leer esta tabla

- **RTF** es tiempo de inferencia sobre duración del audio, agregado ponderando por duración —no promediando los RTF de cada ítem, que sobrepondera los clips cortos—. No incluye la carga del modelo, que va en su propia columna.
- **⏱ >5×** no es un fallo técnico sino una decisión: un modelo que tarda más de cinco veces la duración del audio es inservible acá, así que se corta y se registra. Medir su valor exacto no cambiaría ninguna decisión.
- **✕ error** sí es un fallo, y la causa más frecuente esperada es la caída del proceso de GPU. Cada resultado se guardó apenas terminó, así que una caída no se lleva la corrida: la fila queda y se puede reintentar.
- **Inserciones** es la parte del WER que son palabras inventadas. Es la señal de alucinación: dos modelos con el mismo WER pero distinta cantidad de inserciones no fallan igual, y el que inventa es peor para transcribir.
- **Pico CPU** mide el heap del lado del procesador. **No incluye la memoria de la GPU**, que con el backend WebGPU es justamente donde viven los pesos del modelo. Además es un pico muestreado, así que es una cota inferior. Para WebGPU, la evidencia de que un equipo no da es indirecta: aparece como error o timeout.
- **WER**: comparable **entre modelos de esta tabla**, no contra cifras publicadas afuera. La normalización está en `docs/NORMALIZACION-WER.md` y cada trabajo usa la suya; esas diferencias son del mismo orden que las diferencias entre modelos.

## Fallos

| Modelo | Backend | Ítem | Estado | Motivo |
|---|---|---|---|---|
| `whisper-turbo` | webgpu | es-clean-1min | timeout | carga: timeout tras 900 s |
| `whisper-turbo` | webgpu | es-clean-5min | timeout | carga: timeout tras 900 s |
| `whisper-turbo` | webgpu | es-noisy-3min | timeout | carga: timeout tras 900 s |
| `whisper-turbo` | webgpu | es-multi-3min | timeout | carga: timeout tras 900 s |
| `whisper-turbo` | webgpu | en-clean-1min | timeout | carga: timeout tras 900 s |
| `whisper-turbo` | webgpu | en-clean-5min | timeout | carga: timeout tras 900 s |
| `whisper-turbo` | webgpu | en-noisy-3min | timeout | carga: timeout tras 900 s |
| `whisper-turbo` | webgpu | en-multi-3min | timeout | carga: timeout tras 900 s |
| `whisper-turbo` | wasm | es-clean-5min | timeout | timeout tras 1514 s |
| `lite-whisper-turbo` | webgpu | es-clean-1min | error | Cannot specify `task` or `language` for an English-only model. If the model is intended to be multilingual, pass `is_multilingual=true` to generate, or update the generation config. |
| `lite-whisper-turbo` | webgpu | es-clean-5min | error | Cannot specify `task` or `language` for an English-only model. If the model is intended to be multilingual, pass `is_multilingual=true` to generate, or update the generation config. |
| `lite-whisper-turbo` | webgpu | es-noisy-3min | error | Cannot specify `task` or `language` for an English-only model. If the model is intended to be multilingual, pass `is_multilingual=true` to generate, or update the generation config. |
| `lite-whisper-turbo` | webgpu | es-multi-3min | error | Cannot specify `task` or `language` for an English-only model. If the model is intended to be multilingual, pass `is_multilingual=true` to generate, or update the generation config. |
| `lite-whisper-turbo` | webgpu | en-clean-1min | error | Cannot specify `task` or `language` for an English-only model. If the model is intended to be multilingual, pass `is_multilingual=true` to generate, or update the generation config. |
| `lite-whisper-turbo` | webgpu | en-clean-5min | error | Cannot specify `task` or `language` for an English-only model. If the model is intended to be multilingual, pass `is_multilingual=true` to generate, or update the generation config. |
| `lite-whisper-turbo` | webgpu | en-noisy-3min | error | Cannot specify `task` or `language` for an English-only model. If the model is intended to be multilingual, pass `is_multilingual=true` to generate, or update the generation config. |
| `lite-whisper-turbo` | webgpu | en-multi-3min | error | Cannot specify `task` or `language` for an English-only model. If the model is intended to be multilingual, pass `is_multilingual=true` to generate, or update the generation config. |
| `lite-whisper-turbo` | wasm | es-clean-1min | error | Cannot specify `task` or `language` for an English-only model. If the model is intended to be multilingual, pass `is_multilingual=true` to generate, or update the generation config. |
| `lite-whisper-turbo` | wasm | es-clean-5min | error | Cannot specify `task` or `language` for an English-only model. If the model is intended to be multilingual, pass `is_multilingual=true` to generate, or update the generation config. |
| `lite-whisper-turbo` | wasm | es-noisy-3min | error | Cannot specify `task` or `language` for an English-only model. If the model is intended to be multilingual, pass `is_multilingual=true` to generate, or update the generation config. |
| `lite-whisper-turbo` | wasm | es-multi-3min | error | Cannot specify `task` or `language` for an English-only model. If the model is intended to be multilingual, pass `is_multilingual=true` to generate, or update the generation config. |
| `lite-whisper-turbo` | wasm | en-clean-1min | error | Cannot specify `task` or `language` for an English-only model. If the model is intended to be multilingual, pass `is_multilingual=true` to generate, or update the generation config. |
| `lite-whisper-turbo` | wasm | en-clean-5min | error | Cannot specify `task` or `language` for an English-only model. If the model is intended to be multilingual, pass `is_multilingual=true` to generate, or update the generation config. |
| `lite-whisper-turbo` | wasm | en-noisy-3min | error | Cannot specify `task` or `language` for an English-only model. If the model is intended to be multilingual, pass `is_multilingual=true` to generate, or update the generation config. |
| `lite-whisper-turbo` | wasm | en-multi-3min | error | Cannot specify `task` or `language` for an English-only model. If the model is intended to be multilingual, pass `is_multilingual=true` to generate, or update the generation config. |
| `moonshine-base` | webgpu | en-clean-5min | error | [WebGPU] Kernel "[MatMul] /layers.0/self_attn/MatMul" failed. Error: Failed to generate kernel's output[0] with dims [1,8,12530,12530]. If you are running with pre-allocated output, please make sure the output type/dims are correct. Error: 88974488 |
| `moonshine-base` | webgpu | en-noisy-3min | error | [WebGPU] Kernel "[MatMul] /layers.0/self_attn/MatMul" failed. Error: Failed to generate kernel's output[0] with dims [1,8,12530,12530]. If you are running with pre-allocated output, please make sure the output type/dims are correct. Error: 88974488 |
| `moonshine-base` | webgpu | en-multi-3min | error | [WebGPU] Kernel "[MatMul] /layers.0/self_attn/MatMul" failed. Error: Failed to generate kernel's output[0] with dims [1,8,12530,12530]. If you are running with pre-allocated output, please make sure the output type/dims are correct. Error: 88974488 |
| `moonshine-base` | wasm | en-clean-5min | error | 139648528 |
| `moonshine-base` | wasm | en-noisy-3min | error | 139648528 |
| `moonshine-base` | wasm | en-multi-3min | error | 139648528 |

## Decisión

Se completa a mano una vez leída la tabla, contra el criterio fijado **antes** de medir en `docs/ETAPAS.md` §E0: RTF < 0,4 mantiene turbo por defecto; 0,4–0,8 baja a `small` o `base`; > 0,8 obliga a adelantar el camino de servidor.

Modelo por defecto elegido: **`whisper-large-v3-turbo`, encoder `fp16`, decoder `q4`,
WebGPU** — RTF 0,451, WER 3,0 %.

El RTF cae en el tramo 0,4–0,8, donde el criterio manda bajar a `small`. **No se aplica esa
lectura**, porque la premisa implícita del tramo —que bajar de modelo compra velocidad— la
refutan los propios datos: `small` es **más lento** (0,636) y comete **siete veces más
errores** (20,5 %). Turbo domina a `small` en las dos dimensiones, así que no hay disyuntiva
que resolver. El razonamiento completo, en `docs/E0-DECISION.md`.
