# Pagina Test


## Uso
1) Pulsa **Cargar TXT** y selecciona tu archivo de preguntas.
2) Pulsa **Nuevo test (20)**.
3) Responde: 1-4 para seleccionar, Enter para responder/siguiente, Esc para omitir.

## Puntuación
- Correcta: +1
- Incorrecta: −1/3
- Omitida: 0

## Datos guardados
Se guarda en `localStorage`:
- Última batería de preguntas (texto del TXT)
- Historial de intentos (porcentaje 0–100%)
- Estadísticas por pregunta (visto/acierto/fallo/omitida)

No se sube nada a internet.


## Matemáticas (TeX)
- Si el texto contiene `\\alpha_1` o `$...$`, se renderiza con **MathJax**.
- Requiere internet la primera vez (carga desde CDN). Si lo quieres 100% offline, te lo empaqueto local.
