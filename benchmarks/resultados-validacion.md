# Validación del rango de RTF, con audio independiente

**23 de agosto de 2026.** Diez archivos (20,5 min) que **no participaron en definir** el
rango del catálogo. Perfil `whisper-large-v3-turbo` / WebGPU / `enc:fp16/dec:q4`, sin
timestamps: exactamente la configuración del producto.

## Por qué hacía falta

El rango del catálogo se derivó de 16 mediciones. Evaluarlo contra esas mismas mediciones
no es validación, es tautología. El conjunto de validación es **disjunto por
construcción** —son los clips que quedaron después de los que consumió el conjunto
principal, porque el cursor del constructor siguió avanzando—, no por una comprobación a
posteriori que podría fallar en silencio.

## Resultado

**10 de 10 archivos caen dentro del rango declarado [0,430 – 0,632].**

| Archivo | RTF | WER |
|---|---|---|
| `es-val-1` | 0,616 | 0 % |
| `es-val-2` | 0,569 | 1,7 % |
| `es-val-3` | 0,551 | 0,5 % |
| `es-val-4` | 0,570 | 1,7 % |
| `es-val-5` | 0,536 | 0 % |
| `en-val-1` | 0,460 | 3,1 % |
| `en-val-2` | 0,493 | **26,0 %** |
| `en-val-3` | 0,528 | 2,6 % |
| `en-val-4` | 0,550 | 2,4 % |
| `en-val-5` | 0,534 | 3,2 % |

RTF agregado **0,540**, dentro del rango y cerca de la mediana declarada (0,492).

**El rango del catálogo queda validado con datos independientes.**

## El caso raro: `en-val-2` y el modo de fallo que importa

26 % de WER contra 0–3,2 % del resto. El desglose lo delata: **61 borrados, 0 inserciones,
5 sustituciones**. Un modelo que se equivoca *sustituye* palabras; no omite sesenta
seguidas sin inventar ninguna.

Se investigaron y descartaron tres causas antes de encontrar la real:

1. **¿Referencias mal mapeadas?** No: ninguno de los dos índices tiene ids repetidos.
2. **¿El texto del índice no corresponde al audio?** No. Se transcribieron tres clips
   fuente de los tres dialectos y cada uno dijo lo que el índice le asigna (WER 0 %,
   12,5 %, 28,6 % — errores léxicos menores como «caret» → «caray», mismo contenido).
3. **¿Audio y referencia describen contenidos distintos?** Tampoco. Los finales de ambos
   coinciden **palabra por palabra**, y todas las frases que el modelo produjo están en la
   referencia.

**Lo que pasó es que el modelo se saltó un tramo del medio.** El audio y la referencia son
el mismo contenido; la transcripción tiene 1123 caracteres contra 1462 de la referencia.

### Por qué esto importa más que el número

**Whisper puede omitir un tramo entero sin dar ninguna señal.** La transcripción resultante
es fluida, coherente y plausible: nadie que no tenga el original al lado notaría que falta
un párrafo. Para una herramienta de transcripción es el peor modo de fallo posible —peor
que equivocarse, porque el error no se ve—.

Apareció en 1 de 10 archivos. Con audio limpio y leído, que es el caso fácil.

**Lo que se puede hacer, y queda anotado para E2:** el VAD de E2 detecta dónde hay habla,
así que permite comparar «cuánto habla detectó el detector» contra «cuánto texto produjo el
modelo». Un desajuste grande es exactamente esta omisión, y se puede avisar. Sin esa
comparación no hay forma de detectarla.

## Un bug de construcción encontrado de paso

Al investigar, se descubrió que `speakerOf` estaba mal para SLR83: tomaba el **segundo**
campo del id, que es el prompt, no el hablante. `irm_02484_…`, `mif_02484_…` y
`mim_02484_…` son la misma frase leída por tres personas distintas, y las tres daban
«02484».

| Agrupando por | Resultado |
|---|---|
| número (lo que hacía) | 02484: 396, 03397: 450, 04310: 300 |
| prefijo (el hablante real) | irm: 450, mif: 246, mim: 450 |

Corregido en el constructor. **El corpus actual se generó con la versión anterior**, así
que el ítem `en-multi-3min` mezclaba dialectos dentro de cada «hablante»: tenía más voces
de las que declaraba, no menos. No invalida las mediciones —el audio es real y la
referencia le corresponde—, pero la etiqueta era incorrecta.

Regenerar el corpus cambiaría los SHA-256 y obligaría a repetir todas las mediciones. Es
una decisión de costo, no algo que convenga hacer de oficio.
