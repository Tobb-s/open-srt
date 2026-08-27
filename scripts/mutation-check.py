"""
Prueba de mutación sobre el banco de E0.

Rompe a propósito cada decisión que los tests dicen cubrir y confirma que la suite
falla. Un mutante que sobrevive significa que ese test no prueba lo que su nombre
afirma — el problema que la revisión adversarial de OpenPDF encontró tres veces.

Uso:  python scripts/mutation-check.py            (todos)
      python scripts/mutation-check.py csv video  (sólo los que mencionen eso)

El filtro no es una comodidad: la suite completa tarda un minuto, así que los 58 mutantes
son una hora larga. Validar seis mutantes nuevos con eso desalienta correrlo, y una prueba
de mutación que no se corre no prueba nada. El filtro compara contra el nombre del mutante y
contra el archivo que toca.

**Ojo con interrumpirlo**: si el proceso muere entre que muta y restaura, el archivo queda
mutado. Se recupera con `git checkout -- <archivo>`.
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NORM = ROOT / "src" / "lib" / "bench" / "normalize.ts"
WER = ROOT / "src" / "lib" / "bench" / "wer.ts"
MODELS_F = ROOT / "src" / "lib" / "bench" / "models.ts"
CORPUS_F = ROOT / "src" / "lib" / "bench" / "corpus.ts"
REPORT_F = ROOT / "src" / "lib" / "bench" / "report.ts"
POLICY_F = ROOT / "src" / "lib" / "bench" / "policy.ts"

# Módulos del producto (E1)
EVID = ROOT / "src" / "lib" / "asr" / "evidence.ts"
AMODELS = ROOT / "src" / "lib" / "asr" / "models.ts"
CAPS = ROOT / "src" / "lib" / "asr" / "capabilities.ts"
EST = ROOT / "src" / "lib" / "asr" / "estimate.ts"
LEARN = ROOT / "src" / "lib" / "asr" / "learned.ts"
TRANS = ROOT / "src" / "lib" / "asr" / "transcriber.ts"
I18N = ROOT / "src" / "lib" / "i18n.ts"
SEGS = ROOT / "src" / "lib" / "vad" / "segments.ts"
ALIGN = ROOT / "src" / "lib" / "vad" / "align.ts"
SUBS = ROOT / "src" / "lib" / "export" / "subtitles.ts"
WAV = ROOT / "scripts" / "lib" / "wav.mjs"
ENGINE = ROOT / "src" / "lib" / "asr" / "engine.ts"
STORE = ROOT / "src" / "lib" / "store" / "session.ts"
RUNTIME = ROOT / "src" / "lib" / "asr" / "runtime.ts"
CSV = ROOT / "src" / "lib" / "export" / "csv.ts"
PROBE = ROOT / "src" / "lib" / "video" / "probe.ts"
DOCM = ROOT / "src" / "lib" / "export" / "document.ts"
PDFX = ROOT / "src" / "lib" / "export" / "pdf.ts"

# (nombre, archivo, texto original, texto mutado, qué debería atrapar)
MUTANTS = [
    (
        "la ñ deja de preservarse",
        NORM,
        ".replace(/ñ/g, N_TILDE_SLOT)\n    .normalize('NFD')",
        ".normalize('NFD')",
        "regla 5 — 'año' y 'ano' se funden",
    ),
    (
        "el conector 'y' une siempre, sin mirar la gramática",
        NORM,
        "if (sawAny && (tensPlusUnit || hundredsPlusRest)) {",
        "if (sawAny) {",
        "regla 6 — 'cinco y seis' vuelve a dar 11",
    ),
    (
        "el conector mira el acumulado entero en vez de la decena",
        NORM,
        "const tens = current % 100;",
        "const tens = current;",
        "regla 6 — 'mil novecientos ochenta y cuatro' se parte",
    ),
    (
        "una inserción se cuenta como sustitución",
        WER,
        "curIns[j] = curIns[j - 1] + 1;",
        "curSub[j] = curSub[j - 1] + 1;",
        "el desglose deja de distinguir alucinación de confusión",
    ),
    (
        "aggregateWer promedia en vez de sumar",
        WER,
        "refWords += r.refWords;",
        "refWords += 1;",
        "el agregado sobrepondera los clips cortos",
    ),
    (
        "se dejan de quitar los diacríticos",
        NORM,
        ".replace(/[̀-ͯ]/g, '')",
        ".replace(/[̀-ͯ]/g, '$&')",
        "regla 5 — 'está' deja de normalizarse a 'esta'",
    ),
    (
        "Moonshine se corre igual sobre español",
        MODELS_F,
        "if (model.coverage === 'en' && itemLang !== 'en') return false;",
        "if (false) return false;",
        "se mediría un modelo cuya licencia multilingüe es no comercial",
    ),
    (
        "el RTF agregado promedia en vez de ponderar por duración",
        REPORT_F,
        "(a, r) => a + (r.inferMs && r.rtf ? r.inferMs / r.rtf : 0),",
        "(a, r) => a + (r.inferMs && r.rtf ? 1000 : 0),",
        "un clip de 1 s pesaría lo mismo que uno de 2 h",
    ),
    (
        "el manifiesto acepta referencias vacías",
        CORPUS_F,
        "if (!item.reference?.trim())",
        "if (false)",
        "un ítem sin referencia daría WER 1 y parecería un modelo malísimo",
    ),
    (
        "el umbral de decisión se corre un borde",
        POLICY_F,
        "if (rtf < DECISION_THRESHOLDS.turboKeeps) return 'turbo';",
        "if (rtf <= DECISION_THRESHOLDS.turboKeeps) return 'turbo';",
        "el criterio fijado antes de medir dejaría de cumplirse en el borde",
    ),
    # ── asr/ : los defectos que E1 encontró y corrigió ──────────────────────
    (
        "la guarda deja pasar combinaciones medidas rotas",
        EVID,
        "if (m.verdict === 'broken' || m.verdict === 'unusable') throw new BrokenCombinationError(m);",
        "if (false) throw new BrokenCombinationError(m);",
        "cargaría un dtype que transcribe basura sin avisar",
    ),
    (
        "la búsqueda de evidencia ignora el backend",
        EVID,
        "      m.backend === backend &&",
        "",
        "q8 está roto en WebGPU y bien en WASM: sin el backend no se distinguen",
    ),
    (
        "rtfMedian promedia en vez de tomar la mediana",
        AMODELS,
        "  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;",
        "  return xs.reduce((a, b) => a + b, 0) / xs.length;",
        "una corrida anómala arrastraría la estimación",
    ),
    (
        "rtfRange nunca marca `single`",
        AMODELS,
        "if (xs.length < 2) return { min: xs[0], max: xs[0], single: true };",
        "if (xs.length < 2) return { min: xs[0], max: xs[0], single: false };",
        "un perfil medido una vez mostraría un rango degenerado como si fuera información",
    ),
    (
        "no se comprueba que el modelo entre en el buffer de la GPU",
        CAPS,
        "    if (limit > 0 && profile.peakBufferBytes > limit) continue;",
        "    if (false) continue;",
        "vuelve el timeout de carga de 900 s de E0",
    ),
    (
        "calibrar acepta menos de una ventana de audio",
        EST,
        "    if (audioSec < WINDOW_SEC * 0.9) return;",
        "    if (false) return;",
        "el relleno hasta 30 s inflaría el RTF varias veces",
    ),
    (
        "refinar acepta una sola ventana",
        EST,
        "    if (processedSec <= WINDOW_SEC) return;",
        "    if (false) return;",
        "el calentamiento seguiría dominando la estimación",
    ),
    (
        "el RTF aprendido acepta audio demasiado corto",
        LEARN,
        "  if (audioSec < 30) return;",
        "  if (false) return;",
        "un clip de 2 s contaminaría las estimaciones siguientes",
    ),
    (
        "el progreso deja de acumular ventanas",
        TRANS,
        "      if (t < lastTime) windowIndex++;",
        "      if (false) windowIndex++;",
        "vuelve el progreso que retrocedía de 28 s a 6 s",
    ),
    (
        "el progreso deja de ser monótono",
        TRANS,
        "      maxSeen = Math.max(maxSeen, abs);",
        "      maxSeen = abs;",
        "el solapamiento de ventanas haría retroceder la barra igual",
    ),
    (
        "los timestamps vuelven a estar encendidos por defecto",
        TRANS,
        "  return requested ?? false;",
        "  return requested ?? true;",
        "el WER subiría de 3,03 % a 4,52 % en audio difícil",
    ),
    (
        "el rango de tiempo vuelve a ensancharse con floor/ceil",
        I18N,
        "  const a = Math.max(1, Math.round(minSec / unidadSec));",
        "  const a = Math.max(1, Math.floor(minSec / unidadSec));",
        "125 y 130 s volverían a decirse «entre 2 y 3 minutos»",
    ),
    (
        "el corte segundos/minutos vuelve a 90 s",
        I18N,
        "  if (maxSec < 60) {",
        "  if (maxSec < 90) {",
        "«alrededor de 1 minuto» vuelve a ser inalcanzable",
    ),
    (
        "el rango vuelve a min/max en vez de percentiles",
        AMODELS,
        "  return { min: percentile(xs, 0.1), max: percentile(xs, 0.9), single: false };",
        "  return { min: xs[0], max: xs[xs.length - 1], single: false };",
        "un archivo raro ensancharía el rango para siempre",
    ),
    (
        "el remuestreo decima SIN filtrar",
        WAV,
        "      out[i] = filtered(i * ratio);",
        "      out[i] = samples[i * ratio];",
        "vuelve el aliasing: 12 kHz se repliega a 4 kHz, en plena banda de voz",
    ),
    (
        "el filtro pasa-bajos deja de cortar",
        WAV,
        "  const kernel = lowpassKernel(targetRate * 0.45, fromRate);",
        "  const kernel = lowpassKernel(fromRate * 0.49, fromRate);",
        "el corte queda por encima de la nueva Nyquist y no atenúa nada",
    ),
    (
        "el fallo del worker deja de caer al hilo principal",
        ENGINE,
        "      this.fallback = new Transcriber();",
        "      throw err;",
        "sin worker no habría herramienta en vez de una lenta",
    ),
    (
        "el motivo de la degradación se pierde",
        ENGINE,
        "      this.degradedReason = err instanceof Error ? err.message : String(err);",
        "      this.degradedReason = undefined;",
        "la pestaña se congelaría sin que la interfaz pueda explicar por qué",
    ),
    # ── vad/ : el detector de voz de E2 ─────────────────────────────────────
    (
        "no se fusionan los silencios cortos",
        SEGS,
        "if (ultimo && (s.startSec - ultimo.endSec) * 1000 < opts.minSilenceMs) {",
        "if (false) {",
        "cada pausa entre palabras partiria el subtitulo",
    ),
    (
        "los tramos breves se descartan sobre la lista sin fusionar",
        SEGS,
        "  const filtrados = fusionados.filter(",
        "  const filtrados = bruto.filter(",
        "tres fragmentos cortos seguidos se perderian en vez de unirse",
    ),
    (
        "el bloque se cierra despues de agregar, no antes",
        SEGS,
        "    if (actual.length && s.endSec - inicio > maxSec) cerrar();",
        "    if (false) cerrar();",
        "los bloques crecerian sin limite y excederian la ventana del modelo",
    ),
    (
        "el ultimo tramo no recibe las palabras sobrantes",
        ALIGN,
        "      ? ws.length - usadas",
        "      ? 1",
        "el final de cada bloque se perderia",
    ),
    (
        "la comprobacion de omision nunca sospecha",
        ALIGN,
        "    suspicious: speechSec > 10 && wps < MIN_WORDS_PER_SPEECH_SEC,",
        "    suspicious: false,",
        "vuelve la omision silenciosa que E1 midio en 3 de 23 archivos",
    ),
    # -- export/ : los subtitulos de E2 --
    (
        "el SRT usa punto en vez de coma",
        SUBS,
        "formatTime(c.startSec, ',')} --> ${formatTime(c.endSec, ',')",
        "formatTime(c.startSec, '.')} --> ${formatTime(c.endSec, '.')",
        "un SRT con puntos falla en varios reproductores",
    ),
    (
        "el VTT pierde su cabecera",
        SUBS,
        "return `WEBVTT",
        "return `WEBVT",
        "el navegador rechaza el archivo entero sin decir por que",
    ),
    (
        "los subtitulos ya no se parten",
        SUBS,
        "    const partes = Math.max(1, porTamaño, porLectura, porDuracion);",
        "    const partes = 1;",
        "lineas que no entran en pantalla y textos ilegibles en su tiempo",
    ),
    (
        "estirar un subtitulo invade al siguiente",
        SUBS,
        "    const tope = siguiente ? siguiente.startSec : Infinity;",
        "    const tope = Infinity;",
        "dos subtitulos superpuestos aparecen encimados",
    ),
    (
        "el ajuste de linea deja de respetar el ancho",
        SUBS,
        "    else if (actual.length + 1 + w.length <= maxChars) actual += ` ${w}`;",
        "    else if (true) actual += ` ${w}`;",
        "todo iria en una sola linea larguisima",
    ),
    # ---- persistencia (E2) ----
    (
        "los tramos se leen en orden inverso",
        STORE,
        "segments.sort((a, b) => a.index - b.index);",
        "segments.sort((a, b) => b.index - a.index);",
        "el texto dejaria de corresponderse con el audio",
    ),
    (
        "el rango de tramos de una sesion se corta en el indice 0",
        STORE,
        "return IDBKeyRange.bound([sessionId, -Infinity], [sessionId, Infinity]);",
        "return IDBKeyRange.bound([sessionId, -Infinity], [sessionId, 0]);",
        "al recargar volveria un solo tramo",
    ),
    (
        "una correccion no queda marcada como editada",
        STORE,
        "store.put({ ...actual, text, edited: true });",
        "store.put({ ...actual, text, edited: false });",
        "no se distinguiria lo corregido a mano de lo automatico",
    ),
    (
        "corregir un tramo inexistente no falla",
        STORE,
        "    if (!actual) {",
        "    if (false) {",
        "un indice fuera de rango escribiria basura en vez de avisar",
    ),
    (
        "el tope de sesiones se corre uno",
        STORE,
        "for (const vieja of todas.slice(MAX_SESSIONS)) {",
        "for (const vieja of todas.slice(MAX_SESSIONS + 1)) {",
        "quedaria una sesion de mas guardada",
    ),
    (
        "borrar una sesion deja sus tramos huerfanos",
        STORE,
        "    tx.objectStore('segments').delete(segmentRange(sessionId));",
        "    void segmentRange(sessionId);",
        "el tope no liberaria espacio y la cuota se llenaria igual",
    ),
    (
        "el audio guardado nunca se declara como guardado",
        STORE,
        "        session.audioStored = true;",
        "        session.audioStored = false;",
        "al recargar no se podria escuchar el audio que si esta",
    ),
    (
        "un fallo de cuota del audio se lleva puesta la transcripcion",
        STORE,
        "      } catch {\n        // Cuota llena, típicamente. Queda `audioStored: false` y la interfaz lo dice.\n      }",
        "      } catch (e) {\n        throw e;\n      }",
        "el texto se perderia por no poder guardar el audio",
    ),
    # ---- runtime de ONNX servido por nosotros ----
    (
        "la ruta del runtime vuelve a apuntar al CDN",
        RUNTIME,
        "export const ORT_PATH = '/ort/';",
        "export const ORT_PATH = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/';",
        "la CSP volveria a bloquear la carga del modelo",
    ),
    (
        "fijar la ruta del runtime deja de hacer efecto",
        RUNTIME,
        "  if (env?.wasm) env.wasm.wasmPaths = ORT_PATH;",
        "  if (false) env.wasm.wasmPaths = ORT_PATH;",
        "transformers volveria a su default de jsdelivr",
    ),
    (
        "la ruta del runtime pierde la barra final",
        RUNTIME,
        "export const ORT_PATH = '/ort/';",
        "export const ORT_PATH = '/ort';",
        "onnxruntime pediria /ortort-wasm-... y daria 404",
    ),
    # ---- tiempo y alucinacion (E2) ----
    (
        "el reloj del detector corre un 0,02 % rapido",
        SEGS,
        "  const msPerWindow = WINDOW_MS;",
        "  const msPerWindow = WINDOW_MS * 1.0002;",
        "desfase acumulado: 0,36 s al final de un archivo de 30 minutos",
    ),
    (
        "los bloques no se recortan: el modelo recibe el archivo entero",
        TRANS,
        "    const trozo = sliceSamples(opts.audio, block.startSec, block.endSec);",
        "    const trozo = opts.audio;",
        "vuelven las alucinaciones en los tramos sin voz",
    ),
    (
        "el aviso de omision nunca se enciende",
        ALIGN,
        "    suspicious: speechSec > 10 && wps < MIN_WORDS_PER_SPEECH_SEC,",
        "    suspicious: false,",
        "el modelo se saltea un tramo y nadie avisa",
    ),
    # ---- E3: CSV y la prueba de video ----
    (
        'el CSV deja de escapar comas y comillas',
        CSV,
        '  if (!/[",\\r\\n]/.test(value)) return value;',
        '  if (true) return value;',
        'una transcripcion con comas correria las columnas de todo el archivo',
    ),
    (
        'el CSV pierde la marca de orden de bytes',
        CSV,
        "  return CSV_BOM + filas.join('\\r\\n') + '\\r\\n';",
        "  return filas.join('\\r\\n') + '\\r\\n';",
        'Excel en Windows mostraria los acentos rotos',
    ),
    (
        'el tiempo legible del CSV vuelve a llevar coma',
        CSV,
        "        formatTime(t.startSec, '.'),",
        "        formatTime(t.startSec, ','),",
        'dos campos por fila necesitarian comillas por una razon evitable',
    ),
    (
        'el CSV emite filas para tramos sin texto',
        CSV,
        '    if (!texto) continue;',
        '    if (false) continue;',
        'filas en blanco en la planilla',
    ),
    (
        'el veredicto de la prueba de video se conforma con que haya energia',
        PROBE,
        '  return minConTono > 0 && minConTono > maxSinTono * ratio;',
        '  return minConTono > 0;',
        'un archivo de ruido pasaria por audio bien extraido',
    ),
    (
        'el veredicto afirma sin datos suficientes',
        PROBE,
        '  if (conTono.length === 0 || sinTono.length === 0) return false;',
        '  if (false) return false;',
        'sin segundos de silencio no hay con que comparar',
    ),
    # ---- E3: documentos (DOCX y PDF) ----
    (
        'el documento emite filas para tramos sin texto',
        DOCM,
        '    if (!texto) continue;',
        '    if (false) continue;',
        'una fila vacia con una hora al lado parece un error del documento',
    ),
    (
        'la hora del documento vuelve a traer milisegundos',
        DOCM,
        "    rows.push({ time: formatTime(s.startSec, '.').slice(0, 8), text: texto });",
        "    rows.push({ time: formatTime(s.startSec, '.'), text: texto });",
        'ruido en un documento para leer',
    ),
    (
        'el corte de linea del PDF ignora el ancho',
        DOCM,
        '    if (!actual || measure(candidata) <= maxWidth) actual = candidata;',
        '    if (true) actual = candidata;',
        'todo el texto en un solo renglon que se sale de la hoja',
    ),
    (
        'la paginacion parte un tramo entre paginas',
        DOCM,
        '    if (alto + h > disponible && actual.length > 0) {',
        '    if (alto + h > disponible) {',
        'habria que dar vuelta la hoja para terminar una frase',
    ),
    (
        'la primera pagina deja de ser mas corta que las demas',
        DOCM,
        '      disponible = usableHeight;',
        '      disponible = firstPageHeight;',
        'cuatro centimetros de blanco arriba de cada pagina',
    ),
    (
        'el saneador del PDF acepta cualquier caracter',
        PDFX,
        '  return WINANSI_EXTRA.has(ch);',
        '  return true;',
        'pdf-lib tira con un emoji y no se genera archivo',
    ),
    # ---- el plazo de la consulta a WebGPU ----
    (
        'la consulta a WebGPU vuelve a poder colgarse',
        CAPS,
        '    return await Promise.race([gpu.requestAdapter(), vencimiento]);',
        '    return await gpu.requestAdapter();',
        'la deteccion no termina nunca y la interfaz queda en blanco',
    ),
    (
        'el plazo de WebGPU se confunde con no tener adaptador',
        CAPS,
        "    if (adapter === 'timeout') {",
        '    if (false) {',
        'el mensaje diria que no hay adaptador cuando en realidad no contesto',
    ),
]


def run_suite() -> tuple[bool, int]:
    """Devuelve (pasó, cantidad de tests fallados)."""
    r = subprocess.run(
        ["npx", "vitest", "run", "--reporter=json", "--outputFile=.mutation-out.json"],
        cwd=ROOT, capture_output=True, text=True, shell=True,
    )
    failed = 0
    out = ROOT / ".mutation-out.json"
    if out.exists():
        import json
        try:
            data = json.loads(out.read_text(encoding="utf-8"))
            failed = data.get("numFailedTests", 0)
        except Exception:
            failed = -1
        out.unlink(missing_ok=True)
    return r.returncode == 0, failed


def main() -> int:
    filtros = [a.lower() for a in sys.argv[1:]]
    seleccion = [
        m for m in MUTANTS
        if not filtros or any(f in m[0].lower() or f in m[1].name.lower() for f in filtros)
    ]
    if not seleccion:
        print(f"Ningún mutante coincide con {filtros}")
        return 2
    if filtros:
        print(f"Filtrando por {filtros}: {len(seleccion)} de {len(MUTANTS)} mutantes\n")

    print("Comprobando que la suite pasa en limpio…")
    ok, _ = run_suite()
    if not ok:
        print("  La suite YA falla sin mutar. Arreglar eso antes de mutar.")
        return 2
    print("  ok\n")

    survivors = []
    for name, path, original, mutated, catches in seleccion:
        src = path.read_text(encoding="utf-8")
        if original not in src:
            print(f"[  ?  ] {name}")
            print(f"        el patrón no está en {path.name} — la mutación no se aplicó")
            survivors.append(name)
            continue

        path.write_text(src.replace(original, mutated, 1), encoding="utf-8")
        try:
            passed, failed = run_suite()
        finally:
            path.write_text(src, encoding="utf-8")  # restaurar siempre

        if passed:
            print(f"[SOBREVIVE] {name}")
            print(f"            nadie lo atrapó — el test es más débil que su nombre")
            survivors.append(name)
        else:
            print(f"[ muerto  ] {name}  ({failed} test(s) en rojo)")
            print(f"            atrapado: {catches}")

    print()
    if survivors:
        print(f"{len(survivors)} mutante(s) sobrevivieron:")
        for s in survivors:
            print(f"  - {s}")
        return 1

    print(f"Los {len(seleccion)} mutantes murieron. Los tests prueban lo que dicen.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
