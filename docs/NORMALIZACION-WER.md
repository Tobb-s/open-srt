# Regla de normalización para el cálculo de WER

**Escrita el 23 de agosto de 2026, antes de correr ninguna medición.**

Este documento existe para que las decisiones de normalización no se tomen después de ver
los números. Cada decisión cambia el WER resultante entre décimas y varios puntos, así que
elegirlas mirando los resultados sería elegir la regla que favorece la conclusión que uno
quiere. Se fija ahora y no se toca; si hubiera que cambiarla, se cambia con fecha y se
vuelven a correr **todas** las mediciones, no sólo la que molesta.

Implementación: `src/lib/bench/normalize.ts`. Tests: `src/lib/bench/normalize.test.ts`.

---

## Qué se puede concluir con esto, y qué no

**Sí:** comparar modelos entre sí sobre este corpus. Todos pasan por el mismo normalizador,
así que cualquier sesgo que introduzca es común a todos y la comparación relativa se
sostiene. Ese es el uso para el que existe E0: elegir el modelo por defecto.

**No:** comparar estos WER contra los publicados en la literatura o por los autores de los
modelos. Cada trabajo normaliza distinto, y las diferencias de normalización son del mismo
orden que las diferencias entre modelos. **Un WER de acá no es comparable con un WER de
afuera.** Si alguna vez se cita un número de este banco, va con esa advertencia pegada.

---

## Las reglas, en orden de aplicación

El orden importa: eliminar puntuación antes de expandir contracciones destruiría los
apóstrofos que la expansión necesita.

### 1. Recortar y colapsar espacios
Espacios al principio y al final; cualquier secuencia de espacios en blanco pasa a un solo
espacio. Sin controversia.

### 2. Minúsculas
Todo a minúsculas. Es estándar en ASR: reconocer habla no incluye decidir mayúsculas, que
son una convención ortográfica sin correlato acústico.

### 3. Expandir contracciones (sólo inglés)
`don't` → `do not`, `it's` → `it is`, `we've` → `we have`, y el resto de la lista cerrada
del módulo. Whisper y las transcripciones de referencia difieren libremente entre la forma
contraída y la expandida, y esa diferencia no es un error de reconocimiento.

Lista cerrada y explícita, no una regla general con apóstrofos: `it's` puede ser *it is* o
*it has*, y adivinarlo introduciría más error del que corrige. Los casos ambiguos se
expanden a la lectura más frecuente y se documentan en el módulo.

### 4. Eliminar puntuación
Todo signo de puntuación, incluidos `¿` y `¡` del español, comillas de todo tipo, guiones
largos y puntos suspensivos. Los guiones **dentro** de una palabra se reemplazan por
espacio (`ex-presidente` → `ex presidente`), porque la segmentación en palabras compuestas
es una convención escrita, no acústica.

### 5. Quitar diacríticos, **preservando la ñ**
`está` → `esta`, `también` → `tambien`, `café` → `cafe`.

Es la decisión más discutible del documento, así que va con su razón: un modelo que oye
bien pero acentúa mal no falló en reconocer habla, y penalizarlo mezclaría dos capacidades
distintas. La contrapartida real es que funde pares como *esta / está* y *publico /
publicó*, que sí se distinguen acústicamente por la tónica. Se acepta el costo porque es
la práctica estándar en ASR y porque afecta a todos los modelos por igual.

**La `ñ` no es un diacrítico y no se toca.** Es una letra propia del español, y `año` y
`ano` son palabras distintas. Confundirlas sería un error de normalización, no una
simplificación. La `ü` de *pingüino* sí se reduce a `u`.

### 6. Números: palabras a dígitos
`veinticinco` → `25`, `twenty five` → `25`, `mil novecientos ochenta y cuatro` → `1984`.

Se convierte hacia el dígito y no al revés porque un número tiene **una sola** forma en
dígitos y muchas en palabras. La dirección contraria multiplicaría las variantes.

**Limitación declarada:** el conversor cubre enteros hasta 999.999 en español e inglés.
Fuera de ese rango, ordinales, fracciones, números romanos y años leídos de forma partida
(*mil novecientos* frente a *diecinueve ochenta y cuatro*) **no se normalizan**, y quedan
como diferencia contable. Es una limitación conocida, no un descuido, y afecta por igual a
todos los modelos.

### 7. Lo que **no** se toca

- **Muletillas e interjecciones** (`eh`, `mmm`, `este`, `uh`). Es tentador borrarlas,
  porque Whisper suele omitirlas y las referencias humanas a veces las incluyen. No se
  hace: la lista sería arbitraria, `este` es además una palabra corriente en español, y
  borrar tokens es exactamente el tipo de decisión que puede maquillar un resultado.
- **Repeticiones.** Si un modelo repite una frase en bucle —el modo de fallo por
  alucinación— eso **tiene que** contar como error. Colapsar repeticiones ocultaría
  precisamente lo que E2 quiere medir.

---

## La métrica

WER clásico sobre distancia de edición a nivel palabra:

```
WER = (S + D + I) / N
```

donde `N` es la cantidad de palabras de la **referencia**, y `S`, `D`, `I` son
sustituciones, borrados e inserciones del alineamiento óptimo.

**Los tres se reportan por separado, no sólo el total.** Es una decisión deliberada: las
alucinaciones de Whisper en silencio aparecen como **inserciones**, no como sustituciones.
Un WER agregado de 8 % no distingue un modelo que confunde palabras de uno que inventa
frases enteras en los silencios, y ese segundo caso es mucho más grave para una
herramienta de transcripción. Con `I` a la vista, el problema que E2 va a atacar con el
VAD ya se puede ver desde E0.

`WER > 1` es posible y no es un error de cálculo: un modelo que alucina largo puede
insertar más palabras de las que tiene la referencia. Cuando pase, se reporta tal cual.

---

## Control del propio normalizador

El normalizador es código, y código con errores silenciosos daría WER mal calculados en
toda la matriz sin que nada falle. Por eso lleva tests que cubren cada regla por separado,
más dos controles:

1. **Idempotencia**: `normalizar(normalizar(x)) === normalizar(x)` para todo el corpus.
   Si no lo cumple, alguna regla está peleando con otra.
2. **No vaciado**: ningún texto de referencia no vacío puede quedar vacío después de
   normalizar. Si eso pasa, el WER de ese ítem sería 0 o infinito por un motivo falso.
