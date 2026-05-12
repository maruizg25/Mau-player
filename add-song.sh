#!/usr/bin/env bash
#
# add-song.sh — Descarga un MP3 desde YouTube y lo añade a la librería del Mau Player.
#
# Uso:
#   ./add-song.sh "https://www.youtube.com/watch?v=ID"
#   ./add-song.sh "https://youtu.be/ID" "Título personalizado"
#   ./add-song.sh "https://youtu.be/ID" "Título" "Artista"
#
# Convención de nombre de archivo: "Artista - Título.mp3"
# (coincide con el parser de drag-and-drop del player)

set -euo pipefail

URL="${1:-}"
TITLE_OVERRIDE="${2:-}"
ARTIST_OVERRIDE="${3:-}"

if [ -z "$URL" ]; then
  cat <<EOF
Uso: $0 <url-youtube> [titulo] [artista]

Ejemplos:
  $0 "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  $0 "https://youtu.be/abc123" "Mi canción"
  $0 "https://youtu.be/abc123" "Mi canción" "Mi artista"
EOF
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MUSIC_DIR="$SCRIPT_DIR/music"
TRACKS="$MUSIC_DIR/tracks.json"

# ---------- Dependencias ----------
need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Falta: $1" >&2
    echo "Instala con: brew install $1" >&2
    exit 1
  fi
}

need yt-dlp
need jq

mkdir -p "$MUSIC_DIR"
[ -f "$TRACKS" ] || echo "[]" > "$TRACKS"

# ---------- Metadata ----------
echo "==> Leyendo metadata de YouTube..."
META="$(yt-dlp --dump-single-json --no-warnings "$URL")"

TITLE="$(echo "$META" | jq -r '.title // empty')"
ARTIST="$(echo "$META" | jq -r '.artist // .creator // .uploader // .channel // "Desconocido"')"

if [ -z "$TITLE" ]; then
  echo "No se pudo extraer el título del video." >&2
  exit 1
fi

[ -n "$TITLE_OVERRIDE" ]  && TITLE="$TITLE_OVERRIDE"
[ -n "$ARTIST_OVERRIDE" ] && ARTIST="$ARTIST_OVERRIDE"

# Limpiar sufijos típicos de YouTube en el artista (e.g., "Bad Bunny - Topic", "Vevo")
ARTIST="$(echo "$ARTIST" | sed -E 's/ - Topic$//; s/VEVO$//; s/Vevo$//' | xargs)"

# ---------- Sanitizar nombre de archivo ----------
# Permite letras (incluyendo acentos), números, espacios, guiones, paréntesis y &.
sanitize() {
  local s="$1"
  s="${s//\//-}"      # / -> -
  s="${s//\\/-}"      # \ -> -
  s="$(echo "$s" | tr -d ':*?"<>|')"  # caracteres prohibidos en FS
  s="$(echo "$s" | tr -s ' ')"        # colapsar espacios
  s="$(echo "$s" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  echo "$s"
}

SAFE_ARTIST="$(sanitize "$ARTIST")"
SAFE_TITLE="$(sanitize "$TITLE")"
FILENAME="${SAFE_ARTIST} - ${SAFE_TITLE}.mp3"
TARGET="$MUSIC_DIR/$FILENAME"

# ---------- Verificar duplicados ----------
EXISTS="$(jq --arg f "$FILENAME" '[.[] | select(.file == $f)] | length' "$TRACKS")"
if [ "$EXISTS" -gt 0 ]; then
  echo "Ya está en la librería: $FILENAME"
  exit 0
fi

if [ -f "$TARGET" ]; then
  echo "El archivo ya existe en music/ (pero no en tracks.json). Lo registro."
else
  echo "==> Descargando: $TITLE"
  yt-dlp -x --audio-format mp3 --audio-quality 0 \
    --no-warnings \
    --embed-thumbnail \
    --embed-metadata \
    -o "$TARGET" \
    "$URL"
fi

if [ ! -f "$TARGET" ]; then
  echo "Error: no se descargó el archivo." >&2
  exit 1
fi

# ---------- Actualizar tracks.json ----------
echo "==> Actualizando tracks.json..."
TMP="$(mktemp)"
jq --arg file "$FILENAME" \
   --arg title "$TITLE" \
   --arg artist "$ARTIST" \
   '. + [{file: $file, title: $title, artist: $artist}]' \
   "$TRACKS" > "$TMP" && mv "$TMP" "$TRACKS"

SIZE_HUMAN="$(du -h "$TARGET" | cut -f1 | xargs)"
COUNT="$(jq 'length' "$TRACKS")"

echo
echo "Listo:"
echo "  Artista : $ARTIST"
echo "  Título  : $TITLE"
echo "  Archivo : music/$FILENAME ($SIZE_HUMAN)"
echo "  Total   : $COUNT canciones en la librería"
echo
echo "Para publicar a GitHub Pages:"
echo "  git add music/ && git commit -m \"add: $TITLE\" && git push"
