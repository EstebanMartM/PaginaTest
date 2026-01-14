# Pagina Test

Una aplicación web moderna y ligera para practicar tests de opción múltiple. Funciona totalmente en el navegador (Single Page Application) sin necesidad de servidor backend.

## Características

- **100% Client-side**: Todo se ejecuta en tu navegador. Tus datos se guardan en el `localStorage` y no salen de tu dispositivo.
- **Modos de test**:
  - **Aleatorio (20)**: Selecciona 20 preguntas al azar.
  - **Modo infinito**: Preguntas sin fin hasta que decidas parar.
  - **Bloque / Examen**: Filtra preguntas por bloques temáticos o exámenes específicos.
  - **Repaso inteligente**: Reodena las opciones aleatoriamente cada vez (evita memorizar "la c").
- **Matemáticas (LaTeX)**: Soporte completo para fórmulas matemáticas mediante **MathJax**.
- **Seguimiento**:
  - Historial de tus últimos intentos.
  - Gráfica de progreso.
  - Estadísticas de aciertos/fallos por pregunta.
  - Posibilidad de marcar preguntas para revisar luego ("Marcadas").

## Uso


1. **Abrir**: Simplemente abre el archivo `index.html` en tu navegador web moderno favorito (Chrome, Firefox, Edge, Safari).
2. **Cargar Preguntas**:
   - Pulsa el botón **Cargar TXT**.
   - Selecciona tu archivo de texto con las preguntas.
3. **Empezar**:
   - Pulsa **Nuevo test** para comenzar.
   - Usa el teclado o el ratón para responder.

### Atajos de teclado
- `1` - `4`: Seleccionar opción a-d.
- `Enter`: Confirmar respuesta / Pasar a siguiente.
- `Esc`: Omitir pregunta / Enviar selección actual.

## Formato del archivo de preguntas (.txt)

Para cargar tus propias preguntas, crea un archivo de texto plano (`.txt` o `.md`) siguiendo este formato. El parser es bastante flexible, pero esta es la estructura ideal:

### Estructura Básica

```text
### Bloque Nombre del Tema

Pregunta 1: Texto de la pregunta...
a) Opción A
b) Opción B
c) Opción C
d) Opción D
Solución: a
Justificación: Aquí explicas por qué es la 'a'.
```

### Reglas
- **Bloques**: Usa `### Bloque [Nombre]` para agrupar preguntas.
- **Exámenes**: Usa `### Examen [Nombre]` para agrupar preguntas como examen.
- **Pregunta**: Debe empezar por `Pregunta N:` (donde N es el número).
- **Opciones**: Deben ser líneas que empiecen por `a)`, `b)`, `c)`, `d)` (o `a.`, `a-`).
- **Solución**: Una línea `Solución: X` indicando la letra correcta.
- **Justificación** (Opcional): Una línea `Justificación: ...`. Puede ser multilínea hasta la siguiente pregunta.

### Ejemplo complejo (con LaTeX)

```text
Pregunta 10: Calcular la integral de $\int x dx$
a) $x^2/2 + C$
b) $x + C$
c) $e^x$
d) 0
Solución: a
Justificación: Regla básica de integración de potencias.
```

## Puntuación

El sistema de puntuación penaliza los errores para simular entornos de examen reales:
- **Acierto**: +1 punto
- **Fallo**: -0.33 puntos (-1/3)
- **Omitida**: 0 puntos

## Tecnologías

- **Vanilla JavaScript**: Sin frameworks pesados.
- **CSS3**: Variables CSS, Flexbox/Grid, diseño responsive.
- **MathJax**: Para renderizado de fórmulas matemáticas.
- **LocalStorage**: Para persistencia de datos.
