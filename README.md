# Mau Player

Un web player de música minimalista, estilo Spotify, hecho para correr
directamente sobre **GitHub Pages** o clonando el repo en la intranet.
Sin servidores, sin dependencias en runtime — solo HTML + JS.

> Pensado para escuchar música libremente desde SERCOP: clonas el repo,
> abres `index.html` con un servidor local (o entras al sitio publicado)
> y listo.

## Estructura

```
mau-player/
├── index.html          # Player completo (single-file)
├── add-song.sh         # Script para agregar canciones desde YouTube
├── music/
│   ├── tracks.json     # Índice de la librería (lo actualiza add-song.sh)
│   └── *.mp3           # Archivos de audio
└── README.md
```

## Cómo escuchar

### Opción A — Sitio publicado (GitHub Pages)

Abre la URL del repo publicado (ej: `https://maruizg25.github.io/Mau-player/`)
y dale play. Cualquier persona con el link puede escuchar.

Para habilitar Pages: `Settings → Pages → Branch: main / root`.

### Opción B — Clonado localmente

```bash
git clone https://github.com/maruizg25/Mau-player.git
cd Mau-player
python3 -m http.server 8000
# abre http://localhost:8000 en el navegador
```

> No basta con doble-click en `index.html` porque el navegador bloquea
> el `fetch('music/tracks.json')` en el protocolo `file://`. Cualquier
> servidor estático local sirve (`python3 -m http.server`,
> `npx serve`, etc.).

### Opción C — Arrastrar archivos

El player también acepta drag-and-drop de archivos MP3 sueltos sobre la
ventana. Se reproducen en sesión, no se guardan en el repo.

## Agregar canciones desde YouTube

### Requisitos (una sola vez)

```bash
brew install yt-dlp jq
```

### Uso

```bash
# El script extrae título y artista de la metadata del video
./add-song.sh "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# O fuerza el título/artista
./add-song.sh "https://youtu.be/abc123" "Mi título" "Mi artista"
```

El script:

1. Descarga el audio en alta calidad (MP3, 320k cuando esté disponible).
2. Le pone nombre `Artista - Título.mp3` en `music/`.
3. Embebe metadata y miniatura como cover.
4. Agrega la entrada a `music/tracks.json`.
5. Evita duplicados (chequea si el archivo ya está registrado).
6. Te imprime el comando para publicar:

```bash
git add music/ && git commit -m "add: <título>" && git push
```

## Atajos de teclado

| Tecla       | Acción              |
|-------------|---------------------|
| `Espacio`   | Reproducir / Pausar |
| `←` / `→`   | -5s / +5s           |

(Click en cualquier canción de la lista para reproducirla. Doble-click no
es necesario.)

## Schema de `music/tracks.json`

```json
[
  { "file": "Bad Bunny - Tití Me Preguntó.mp3",
    "title": "Tití Me Preguntó",
    "artist": "Bad Bunny" }
]
```

- `file`: nombre del archivo dentro de `music/` (sin la carpeta).
- `title`, `artist`: lo que se muestra en el player.

## Escalar a más música

Cuando el repo se ponga pesado (GitHub limita ~100 MB por archivo y
recomienda repos < 1 GB), puedes:

- Crear repos adicionales (`mau-player-music-2`, `…-3`, etc.) y enlazarlos
  desde el sidebar (queda como evolución).
- O migrar `music/` a Git LFS si solo crece en cantidad de canciones de
  tamaño normal.

## Troubleshooting

- **El player se queda vacío** → el `fetch` a `music/tracks.json` falló.
  Confirma que estás corriendo un servidor local (no `file://`) y que el
  JSON es válido (`jq . music/tracks.json`).
- **`yt-dlp` no encuentra el video** → actualízalo: `brew upgrade yt-dlp`.
- **Una canción no suena** → mira la consola del navegador. Lo más común
  es un nombre con caracteres raros; renombra el archivo y la entrada en
  `tracks.json` para que coincidan exactamente.
