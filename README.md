# Herramientas para wplace.live

1. **`wplace-asistente.user.js`**: userscript (Tampermonkey / Violentmonkey) con todo integrado: conversor de imágenes, plantilla superpuesta en el mapa, progreso de lo pintado, filtro por colores y códigos para compartir con amigos. **Tú sigues haciendo cada clic**: no envía nada por su cuenta ni toca el Turnstile.
2. **`wplace-pixel.html`**: el mismo conversor como página suelta, por si lo quieres usar fuera de wplace. Se abre con doble clic.

## 1. Instalar el asistente

1. Instala la extensión Tampermonkey (Chrome, Edge o Firefox).
2. Icono de Tampermonkey → "Crear un nuevo script". Borra el contenido, pega el de `wplace-asistente.user.js` y guarda con Ctrl+S.
3. Entra en https://wplace.live. Aparece el panel "Asistente wplace" arriba a la derecha.

Para actualizarlo: Panel de control de Tampermonkey → clic en "wplace Asistente de plantilla" → Ctrl+A, pegar la versión nueva, Ctrl+S → recargar wplace. La plantilla y las coordenadas no se pierden.

## 2. Convertir una imagen

1. En el panel, pulsa **Abrir conversor de imágenes**.
2. Arrastra la imagen, pégala con Ctrl+V o haz clic para elegirla.
3. Ajusta el tamaño en píxeles de wplace y los colores de la paleta. Por defecto están los 31 gratis; marca los de pago (★) que tengas.
4. Para fotos o retratos: fuerza del dithering entre 20 y 40 %, o "Ninguno" para colores planos. Toca brillo, contraste y saturación hasta que la vista previa te guste. "Ver original" compara.
5. Pulsa **Usar como plantilla**. Se carga directamente en el asistente.

"Descargar PNG" guarda la plantilla 1:1 por si la quieres usar en otro overlay.

## 3. Colocarla y pintar

1. Fuera del modo pintar, haz clic en el píxel del mapa donde quieres la esquina superior izquierda y pulsa **Usar último píxel clicado**. Afina con las flechas.
2. Pulsa **Pintar** en wplace. Al pasar el ratón sobre la plantilla se selecciona solo el color correcto. Tú haces clic, o mantienes la barra espaciadora y barres.
3. Alt+A activa o desactiva la selección automática de color.

Funciones del panel:

- **Hechos y pendientes**: el script lee el lienzo real y lo compara con la plantilla. El selector "Ver" muestra la plantilla completa, los pendientes con lo hecho atenuado, o solo los pendientes. Se actualiza solo tras pintar y cada minuto; "Actualizar estado del lienzo" lo fuerza.
- **Pintar solo estos colores**: marca uno o varios colores en la rejilla. El número es lo que falta de cada uno. El overlay y el asistente solo actúan sobre esos colores.
- **Bloquear clics fuera de lo pendiente** (activado por defecto): con la paleta abierta, un clic o un espacio sobre un píxel que no toca, que ya está bien o que no es de los colores marcados se anula antes de que wplace lo procese. Arrastrar el mapa sigue funcionando. Fuera del modo pintar no bloquea nada.
- **Barra espaciadora**: con la paleta abierta, al mantenerla y mover el ratón solo se pintan los píxeles pendientes de los colores marcados, cada uno con su color exacto.

## 4. Compartir con un amigo

Tu amigo necesita tener el asistente instalado.

- **Copiar código**: copia un mensaje con la plantilla y las coordenadas de la esquina. Pégaselo por WhatsApp, Telegram o Discord.
- **Descargar archivo**: guarda lo mismo en un `.txt`. Úsalo si el código es largo, por ejemplo en Discord a partir de 2000 caracteres.

Tu amigo pega el mensaje entero en el cuadro del panel y pulsa **Cargar**, o abre el archivo con **Abrir archivo…**, o lo arrastra al panel. Se carga la plantilla, se ponen las coordenadas y el mapa le lleva al sitio. **Ir a la plantilla** vuelve a llevarte allí cuando quieras.

"Abrir archivo…" también acepta un PNG. Si el nombre del archivo contiene `wplace` y las coordenadas en la forma `TlX-TlY-PxX-PxY`, se colocan solas.

## Notas

- Si el panel dice "Mapa: esperando…", mueve el mapa un poco.
- Si dice "Paleta no visible", abre la paleta con el botón Pintar de wplace.
- La paleta está incrustada en el script (`PALETTE`) y en `wplace-pixel.html`. Si wplace añade o cambia colores, edítala ahí.
- Coordenadas: wplace divide el mundo en 2048×2048 tiles de 1000×1000 píxeles en proyección Web Mercator. Está verificado contra las peticiones reales del sitio.
