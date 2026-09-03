# Foto del cuadro

Coloca aquí tu imagen con el nombre exacto:

```
cuadro.png
```

Es decir, el archivo final debe quedar en:

```
assets/images/cuadro.png
```

El cuadro de la habitación (`src/pictureFrame.js`) la carga automáticamente
al arrancar la escena — no hace falta tocar ningún código.

- Si el archivo no existe todavía, el cuadro se ve con un marcador de
  posición (un icono sencillo + el texto "tu foto aquí"), sin romper la
  escena.
- La imagen se encuadra en modo "cover" (como una foto en un marco real):
  si su proporción no coincide exactamente con la del cuadro (`width`/
  `height` en `src/config/pictureFrame.config.js`), se recorta el
  sobrante centrado en vez de deformarla.
- Si prefieres otro nombre de archivo o ruta, cambia `imagePath` en
  `src/config/pictureFrame.config.js` en vez de renombrar aquí.
