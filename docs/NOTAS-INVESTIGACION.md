# Notas de investigación — agosto 2026

Fuentes detrás de cada número del `PLAN.md`. Todo consultado el 23 de agosto de 2026.

## Advertencia sobre el método

**El sitio de TurboScribe no es accesible por herramientas.** `WebFetch` devuelve
HTTP 403 y el panel del navegador recibe un desafío anti-bot de Cloudflare. Resolver
desafíos de detección de bots está fuera de lo que puedo hacer, así que **todo el
catálogo de la §1 sale de fuentes de terceros**, no del sitio oficial.

Consecuencia práctica: los precios y límites pueden estar desactualizados o mal copiados
por esas fuentes. Antes de tomar una decisión de producto contra esos números, conviene
que los verifiques a mano en el sitio.

(Además, ese mismo intento tumbó Claude Desktop entero: el desafío de Cloudflare hace
fingerprinting por WebGL y crasheó el proceso GPU sobre un driver AMD de 2024. Registrado
en la memoria `env-gpu-browser-panel-crash`.)

## Catálogo y precios de TurboScribe

- [TurboScribe Review 2026 — autogpt.net](https://autogpt.net/ai-tool/turboscribe-ai/)
- [TurboScribe Free Plan Limits 2026 — ConvertAudioToText](https://convertaudiototext.com/blog/turboscribe-free-plan-limits-alternatives)
- [TurboScribe Pricing 2026 — thetoolsverse](https://thetoolsverse.com/tools/turboscribe)
- [TurboScribe Review — Transkriptor](https://transkriptor.com/turboscribe-review/)
- [TurboScribe Review 2026 — PodPosted](https://www.podposted.com/resources/turboscribe)

Datos: 3 transcripciones/día y tope de 30 min en el plan gratis; 10 US$/mes anual o
20 US$/mes; 10 h / 5 GB por archivo; 50 subidas simultáneas; Whisper large-v3;
98+ idiomas; traducción a 134+; diarización por casilla; salida TXT/SRT/VTT/DOCX/PDF/CSV.

## Precios de APIs de ASR

- [Speech-to-Text APIs 2026: benchmarks y precios — Future AGI](https://futureagi.com/blog/speech-to-text-apis-in-2026-benchmarks-pricing-developer-s-decision-guide/)
- [Best Speech-to-Text APIs 2026 — Deepgram](https://deepgram.com/learn/best-speech-to-text-apis-2026)
- [AssemblyAI pricing — Gladia](https://www.gladia.io/blog/assemblyai-pricing)
- [Deepgram Nova-3 $0.0043/min — ConvertAudioToText](https://convertaudiototext.com/blog/deepgram-nova-3-explained)

Por hora de audio: AssemblyAI Universal-2 0,15 US$ (Universal-3.5 Pro 0,21 US$);
Deepgram Nova-3 batch ~0,26 US$; OpenAI Whisper 0,36 US$.

## Autohospedaje

- [Self-Host Faster-Whisper on GPU Cloud — Spheron](https://www.spheron.network/blog/faster-whisper-gpu-cloud-production-deployment-guide/)
- [Self-Hosted Whisper vs OpenAI API — GigaGPU](https://gigagpu.com/self-hosted-whisper-vs-openai-whisper-api-cost/)

0,0214 US$/hora de audio en una L40S (0,75 US$/hora de GPU ÷ 35× RTF). 17× más barato
que la API de OpenAI. **Este es el número que explica el modelo de negocio de TurboScribe.**

## Rendimiento en el navegador

- [How Browser-Based Audio Transcription Works — Whisper STT](https://whisperstt.com/blog/transcribe-audio-in-browser/)
- [Whisper WebGPU vs WASM — issue #894 transformers.js](https://github.com/huggingface/transformers.js/issues/894)
- [Transformers.js v3: WebGPU — Hugging Face](https://www.huggingface.co/blog/transformersjs-v3)
- [Whisper Large V3 Turbo WebGPU — HF Space](https://huggingface.co/spaces/webml-community/whisper-large-v3-turbo-webgpu)

tiny ~7 s/min, base ~20 s/min, small ~90 s/min (WASM). WebGPU 5–10× sobre WASM.
large-v3-turbo: 1,2 GB, 809 M parámetros, ~1,6 GB en los dtypes recomendados, no apto
para WASM. Firefox colgado 200 s en un reporte: **no forzar `device: 'webgpu'`**.

Whisper procesa ventanas de 30 s con solapamiento — de ahí la fragmentación obligatoria.

## Alucinaciones

- [Investigation of Whisper ASR Hallucinations Induced by Non-Speech Audio (arXiv)](https://arxiv.org/pdf/2501.11378)
- [Calm-Whisper (arXiv)](https://arxiv.org/html/2505.12969v1)
- [Whisper Hallucination on Silence — DEV](https://dev.to/nareshipme/whisper-hallucination-on-silence-why-your-transcript-loops-the-same-phrase-2pg4)

El decodificador genera aunque no haya voz, sobre todo a temperatura 0. WhisperX demostró
que el VAD previo reduce alucinación y repetición en Kincaid46 y TED-LIUM. Silero VAD es
el estándar del ecosistema faster-whisper. Complemento: escala de temperatura creciente.

Contrapartida a tener en cuenta: un VAD conservador **corta inicios y finales de palabra**.

## Diarización

- [State of Speaker Diarization 2026 — Picovoice](https://picovoice.ai/blog/state-of-speaker-diarization/)
- [pyannote.audio guide — VexaScribe](https://vexascribe.com/pyannote-audio)
- [nvidia/diar_sortformer_4spk-v1 — Hugging Face](https://huggingface.co/nvidia/diar_sortformer_4spk-v1)

pyannote.audio 3.1 es MIT y sigue siendo el mejor abierto, **pero los modelos están gated
en Hugging Face y exigen token** — obstáculo real para servirlos desde el navegador.
Sortformer de NVIDIA es **CC-BY-NC**: no comercial, inservible para un producto.
Ese es el motivo de que la Etapa 4 empiece por una prueba de viabilidad.

## ffmpeg.wasm

- [ffmpeg.wasm](https://ffmpegwasm.netlify.app/)
- [ffmpeg.wasm vs hosted API: where browser-side breaks — DEV](https://dev.to/javidjamae/ffmpegwasm-vs-a-hosted-ffmpeg-api-where-browser-side-breaks-21k9)

Requiere WebAssembly **y SharedArrayBuffer** → cabeceras COOP/COEP. Chrome 92+,
Firefox 79+, Safari 15.2+. Usa workers, no bloquea el hilo principal. Límites de memoria
en móviles y set de códecs recortado (H.265 y AV1 pueden faltar).

## Colisiones de nombre

Tomados: OpenScribe (openscribe.ca, openscribe.org, sammargolis/OpenScribe,
michaelxer/openscribe-studio), OpenTranscribe (genea.ca, attevon-llc/OpenTranscribe),
OpenVerbatim (openverbatim.com, Vellum-Works/openverbatim), OpenAudio (openaudio.com,
webprofusion/OpenAudio), OpenVox (OpenVoxProject, VoIP, **openvoxai.com que hace
transcripción con IA**, y un proyecto de robótica), OpenEcho (×2), OpenVoice (MyShell).

Sin resultados: **OpenSRT, OpenParla, OpenLoqui**.

## Contexto adicional

- [Introducing Scribe v2 — ElevenLabs](https://elevenlabs.io/blog/introducing-scribe-v2)

Scribe v2 supera a Whisper large-v3, Deepgram Nova-3 y Gemini 2.0 Flash en FLEURS y
Common Voice. Relevante si alguna vez se agrega un camino de servidor: **el mejor motor
de 2026 ya no es Whisper**. Pero es API cerrada, así que no sirve para el camino local.
