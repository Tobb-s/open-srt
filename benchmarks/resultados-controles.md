# E0 — corridas de control del dtype

Complementan `resultados-principal.md`. Existen porque la matriz mezclaba dos efectos que
no se podían separar: el del backend y el de la precisión de los pesos.

| Corrida | Modelo | Backend | dtype | n | RTF | WER | Inserciones |
|---|---|---|---|---|---|---|---|
| `c1-turbo-webgpu-fp16-q4` | whisper-turbo | webgpu | `enc:fp16/dec:q4` | 1 | 0.471 | 1.8 % | 0 |
| `c1-turbo-webgpu-q8-q4` | whisper-turbo | webgpu | `enc:q8/dec:q4` | 1 | 3.496 | 100.0 % | 0 |
| `c1-turbo-webgpu-q4-q4` | whisper-turbo | webgpu | `enc:q4/dec:q4` | 1 | 0.969 | 1.8 % | 0 |
| **`turbo-fp16-A`** | whisper-turbo | webgpu | `enc:fp16/dec:q4` | **8** | **0.451** | **3.0 %** | 11 |
| `small-decfp16-A` | whisper-small | webgpu | `enc:fp16/dec:fp16` | 8 | 1.767 | **580.6 %** | 14120 |

En la matriz, `whisper-turbo` en WebGPU con el encoder en `fp32` daba **timeout de carga a
los 900 s** y sus ocho ítems quedaron sin medir. Ese es el punto de partida de esta tabla.

## Qué contesta cada fila

**Las tres `c1-*`** prueban si turbo carga en WebGPU cuando el encoder no va en `fp32`.
Sí carga: el encoder de `large-v3-turbo` es el de `large-v3` completo —el recorte de
«turbo» está en el decoder, que baja de 32 capas a 4— y en `fp32` no entra en el
`maxBufferSize` de 2 GB que declara el adaptador.

**`turbo-fp16-A`** es la medición que decide E0: la configuración ganadora sobre los ocho
ítems del nivel A, con ruido a 10 dB y multi-hablante incluidos. Que el WER suba de 1,8 %
a 3,0 % al pasar de un ítem limpio al conjunto completo es esperable y buena señal.

**`small-decfp16-A`** iba a confirmar la sospecha de que el `q4` del decoder costaba
calidad. **La refutó**: con el decoder en `fp16` el modelo se rompe.

## El cuadro que sale de acá

| Componente | `fp32` | `fp16` | `q8` | `q4` |
|---|---|---|---|---|
| **Encoder** | no entra en 2 GB | **✓** | ✗ roto (100 % WER) | **✓** |
| **Decoder** | — | ✗ roto (580 % WER) | ✓ | **✓** |

No hay jerarquía de precisión que lo explique. `fp16` sirve en el encoder y destruye el
decoder; `q8` destruye el encoder y sirve en el decoder; `q4`, el de menos bits, es el
único que funciona en los dos. Son fallos de caminos concretos de onnxruntime-web, no
pérdida numérica.

Y explica de paso el peor número de la matriz: los **87,7 % de WER con 1079 inserciones**
de `whisper-tiny` en WASM salían del mismo `q8` en el encoder. Los dos resultados más
catastróficos de todo E0 tenían una única causa, y no era ni el backend ni el tamaño del
modelo.

## Lo que hay que llevarse

**El dtype no se puede razonar: hay que medirlo.** Tres de las combinaciones probadas
producen basura —100 %, 580 % y 87,7 % de WER— y **ninguna avisa**: cargan sin error y
devuelven texto de aspecto perfectamente normal. Sin el desglose de inserciones y sin un
WER contra referencia, las tres se habrían dado por buenas.

**Configuración para el producto:** encoder `fp16`, decoder `q4`, en WebGPU.
