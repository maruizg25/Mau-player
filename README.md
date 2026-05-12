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

## Agregar una playlist de Spotify

```bash
./add-spotify.sh "https://open.spotify.com/playlist/ID"
./add-spotify.sh "https://open.spotify.com/playlist/ID" 30   # primeros 30
```

Cómo funciona: lee la metadata desde el embed público de Spotify
(sin tocar la API anónima, que se rate-limitea rápido), y para cada track
busca el match en YouTube vía `yt-dlp ytsearch1:` y lo descarga con
`add-song.sh` pasando título/artista de Spotify como overrides, así
`tracks.json` queda con metadata limpia.

Funciona con cualquier playlist pública (o con link "compartir → copiar").
Las personalizadas tipo Daily Mix también suelen ser accesibles vía embed.

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

## Escalar a más música (multi-repo)

GitHub recomienda repos < 1 GB. Cuando este se acerque al límite, la
solución no es Git LFS — es crear repos secundarios y enlazarlos desde
`sources.json`.

### Cómo funciona

`sources.json` (en este repo) lista URLs base de repos hermanos:

```json
[
  "https://maruizg25.github.io/Mau-player-music-2/"
]
```

Al cargar, el player:

1. Lee `music/tracks.json` local (paths relativos a `music/`)
2. Lee `sources.json` y, por cada URL base, hace `fetch` a
   `<base>/music/tracks.json` y prefija las URLs de archivo con `<base>music/`
3. Combina todas las librerías en una sola lista

CORS funciona porque GitHub Pages sirve con `Access-Control-Allow-Origin: *`.

### Crear un repo secundario

1. Crea `Mau-player-music-N` vacío en GitHub
2. Clónalo, copia `add-song.sh` y crea `music/tracks.json` con `[]`
3. Activa Pages: `gh api -X POST repos/maruizg25/Mau-player-music-N/pages -f "source[branch]=main" -f "source[path]=/"`
4. Añade su URL Pages al `sources.json` de este repo, commit + push

A partir de ahí, agrega música directamente en ese repo (mismos scripts)
y el player principal la mostrará automáticamente.

## Troubleshooting

- **El player se queda vacío** → el `fetch` a `music/tracks.json` falló.
  Confirma que estás corriendo un servidor local (no `file://`) y que el
  JSON es válido (`jq . music/tracks.json`).
- **`yt-dlp` no encuentra el video** → actualízalo: `brew upgrade yt-dlp`.
- **Una canción no suena** → mira la consola del navegador. Lo más común
  es un nombre con caracteres raros; renombra el archivo y la entrada en
  `tracks.json` para que coincidan exactamente.
