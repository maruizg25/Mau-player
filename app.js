'use strict';

// ============================================================
// MauPlayer — app.js
// Reproductor estático con multi-source, géneros, favoritos,
// crossfade, visualizador, atajos de teclado y menú contextual.
// ============================================================

// ============== STATE ==============
const $ = (id) => document.getElementById(id);
const audioA = $('audio-a');
const audioB = $('audio-b');
let audio = audioA;
let audioOther = audioB;
audioA.crossOrigin = 'anonymous';
audioB.crossOrigin = 'anonymous';

let tracks = [];
let viewTracks = [];
let currentIndex = -1;
let shuffle = false;
let repeat = false;
let dragging = false;
let activeGenre = 'all';
let searchQuery = '';
let sortBy = null;       // 'title' | 'artist' | 'genre' | null (default order)
let sortDir = 'asc';     // 'asc' | 'desc'
let hidden = new Set(JSON.parse(localStorage.getItem('mau-hidden') || '[]'));
let liked = new Set(JSON.parse(localStorage.getItem('mau-liked') || '[]'));
let recentlyPlayed = JSON.parse(localStorage.getItem('mau-recent') || '[]');  // array de trackKeys, más reciente primero
const MAX_RECENT = 50;

// Playlists customs
// playlists = [{ id, name, tracks: [trackKey,...], createdAt }]
let playlists = JSON.parse(localStorage.getItem('mau-playlists') || '[]');

// Sleep timer
let sleepTimerHandle = null;
let sleepTimerDeadline = 0;       // timestamp ms o 'end' para "fin de canción"
let sleepEndOfSong = false;

// Up Next panel
let upnextTab = 'next';  // 'next' | 'recent'

// Album art cache (en memoria, por trackKey)
const artCache = new Map();

// Crossfade
const CROSSFADE_OPTIONS = [0, 3, 5, 8, 12];
let crossfadeSec = parseInt(localStorage.getItem('mau-crossfade') ?? '4', 10);
let fadingOut = false;

// Web Audio (visualizer)
let audioCtx = null;
let analyser = null;
const sourceNodes = new WeakMap();
let vizActive = false;

const GENRE_EMOJI = {
  'Hip Hop': '🎤',
  'Latin': '🌶',
  'Electronic': '🎛',
  'Rock': '🎸',
  'Pop': '✨',
  'R&B': '💜',
  'Jazz': '🎷',
  'Reggaeton': '🔥',
  'Indie': '🌿',
  'Classical': '🎻',
  'Locales': '💾',
  'Otros': '🎵',
};

// ============== UTIL ==============
const trackKey = (t) => `${t.source}::${t.file}`;

function fmt(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function gradient(seed) {
  const h1 = hashStr(seed) % 360;
  const h2 = (h1 + 40 + (hashStr(seed + 'x') % 90)) % 360;
  return `linear-gradient(135deg, hsl(${h1}, 65%, 45%), hsl(${h2}, 60%, 28%))`;
}

function initial(s) {
  const t = (s || '').trim();
  return t ? t.charAt(0).toUpperCase() : '?';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}

function toast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

function persist(key, val) { localStorage.setItem(key, val); }
function persistHidden() { persist('mau-hidden', JSON.stringify([...hidden])); }
function persistLiked() { persist('mau-liked', JSON.stringify([...liked])); }
function persistRecent() { persist('mau-recent', JSON.stringify(recentlyPlayed)); }
function persistPlaylists() { persist('mau-playlists', JSON.stringify(playlists)); }

// ============== PLAYLISTS ==============
function createPlaylist(name) {
  const clean = (name || '').trim();
  if (!clean) return null;
  const id = 'pl_' + Math.random().toString(36).slice(2, 9);
  const pl = { id, name: clean, tracks: [], createdAt: Date.now() };
  playlists.push(pl);
  persistPlaylists();
  return pl;
}

function findPlaylist(id) { return playlists.find(p => p.id === id); }

function addTrackToPlaylist(playlistId, trackK) {
  const pl = findPlaylist(playlistId);
  if (!pl) return;
  if (!pl.tracks.includes(trackK)) {
    pl.tracks.push(trackK);
    persistPlaylists();
    return true;
  }
  return false;  // duplicado
}

function removeTrackFromPlaylist(playlistId, trackK) {
  const pl = findPlaylist(playlistId);
  if (!pl) return;
  pl.tracks = pl.tracks.filter(k => k !== trackK);
  persistPlaylists();
}

function renamePlaylist(playlistId, newName) {
  const pl = findPlaylist(playlistId);
  if (!pl) return;
  const n = (newName || '').trim();
  if (!n) return;
  pl.name = n;
  persistPlaylists();
}

function deletePlaylist(playlistId) {
  playlists = playlists.filter(p => p.id !== playlistId);
  persistPlaylists();
  if (activeGenre === '__pl_' + playlistId) activeGenre = 'all';
}

// ============== ALBUM ART (ID3 tags) ==============
async function fetchAlbumArt(track) {
  const key = trackKey(track);
  if (artCache.has(key)) return artCache.get(key);
  if (typeof window.jsmediatags === 'undefined') return null;
  return new Promise((resolve) => {
    try {
      window.jsmediatags.read(track.url, {
        onSuccess: (tag) => {
          const pic = tag.tags && tag.tags.picture;
          if (pic) {
            const blob = new Blob([new Uint8Array(pic.data)], { type: pic.format || 'image/jpeg' });
            const objUrl = URL.createObjectURL(blob);
            artCache.set(key, objUrl);
            resolve(objUrl);
          } else {
            artCache.set(key, null);
            resolve(null);
          }
        },
        onError: () => { artCache.set(key, null); resolve(null); }
      });
    } catch {
      artCache.set(key, null);
      resolve(null);
    }
  });
}

async function setCoverArt(coverEl, track) {
  // Remueve cualquier img previa
  coverEl.querySelector('img')?.remove();
  coverEl.classList.remove('has-art');
  if (!track) return;
  const art = await fetchAlbumArt(track);
  // Solo asignar si seguimos siendo la canción actual (evita race condition)
  const cur = currentIndex >= 0 ? tracks[currentIndex] : null;
  if (cur && trackKey(cur) !== trackKey(track)) return;
  if (art) {
    const img = document.createElement('img');
    img.src = art;
    img.alt = '';
    coverEl.appendChild(img);
    coverEl.classList.add('has-art');
  }
}

// ============== MEDIASESSION ==============
function gradientArtworkDataURI(seed, size = 256) {
  const h1 = hashStr(seed) % 360;
  const h2 = (h1 + 40 + (hashStr(seed + 'x') % 90)) % 360;
  const ini = (seed.charAt(0) || '?').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h1}, 65%, 45%)"/><stop offset="1" stop-color="hsl(${h2}, 60%, 28%)"/></linearGradient></defs><rect width="${size}" height="${size}" fill="url(#g)"/><text x="50%" y="50%" font-family="Arial, sans-serif" font-size="${Math.round(size * 0.55)}" font-weight="800" fill="white" text-anchor="middle" dominant-baseline="central">${ini}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

async function updateMediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  // Artwork: empieza con el gradient, actualiza con la real si llega
  const fallback = gradientArtworkDataURI(t.title || t.file);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title,
    artist: t.artist,
    album: t.genre,
    artwork: [
      { src: fallback, sizes: '256x256', type: 'image/svg+xml' }
    ]
  });
  navigator.mediaSession.setActionHandler('play', () => audio.play());
  navigator.mediaSession.setActionHandler('pause', () => audio.pause());
  navigator.mediaSession.setActionHandler('previoustrack', prevTrack);
  navigator.mediaSession.setActionHandler('nexttrack', nextTrack);
  navigator.mediaSession.setActionHandler('seekto', (e) => {
    if (audio.duration) audio.currentTime = Math.max(0, Math.min(audio.duration, e.seekTime));
  });

  // Intentar real art async
  const art = await fetchAlbumArt(t);
  const cur = currentIndex >= 0 ? tracks[currentIndex] : null;
  if (art && cur && trackKey(cur) === trackKey(t)) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title, artist: t.artist, album: t.genre,
        artwork: [{ src: art, sizes: '512x512', type: 'image/jpeg' }]
      });
    } catch {}
  }
}

// ============== RECENTLY PLAYED ==============
function recordPlay(track) {
  const key = trackKey(track);
  recentlyPlayed = [key, ...recentlyPlayed.filter(k => k !== key)].slice(0, MAX_RECENT);
  persistRecent();
}

// ============== DATA LOAD ==============
async function loadOneSource(base, tracksUrl, sourceLabel) {
  try {
    const r = await fetch(tracksUrl, { cache: 'no-store' });
    if (!r.ok) return;
    const data = await r.json();
    data.forEach((t, i) => {
      tracks.push({
        title: t.title || t.file,
        artist: t.artist || 'Desconocido',
        genre: t.genre || 'Otros',
        url: base + 'music/' + encodeURIComponent(t.file),
        file: t.file,
        source: sourceLabel,
        order: tracks.length,
        duration: 0,
        blob: null
      });
    });
  } catch (e) {
    console.warn('Fuente fallida:', tracksUrl, e);
  }
}

async function loadAll() {
  await loadOneSource('', 'music/tracks.json', 'local');
  try {
    const sr = await fetch('sources.json', { cache: 'no-store' });
    if (sr.ok) {
      const sources = await sr.json();
      for (const raw of sources) {
        const base = raw.endsWith('/') ? raw : raw + '/';
        await loadOneSource(base, base + 'music/tracks.json', base);
      }
    }
  } catch {}
  computeAndRender();
  restoreLastPlayed();
}

function restoreLastPlayed() {
  const last = localStorage.getItem('mau-last');
  if (!last) return;
  try {
    const { key, time } = JSON.parse(last);
    const idx = tracks.findIndex(t => trackKey(t) === key);
    if (idx >= 0) {
      currentIndex = idx;
      const t = tracks[idx];
      audio.src = t.url;
      audio.volume = userVolume();
      updateNowPlayingUI(t);
      audio.addEventListener('loadedmetadata', () => {
        try { audio.currentTime = time || 0; } catch {}
      }, { once: true });
      renderList();
    }
  } catch {}
}

// ============== FILTERS & RENDER ==============
function computeAndRender() {
  renderSidebar();
  applyFilter();
  updateHiddenBanner();
}

function renderSidebar() {
  const counts = { all: 0 };
  const likedCount = [...liked].filter(k => tracks.some(t => trackKey(t) === k && !hidden.has(t.file))).length;

  for (const t of tracks) {
    if (hidden.has(t.file)) continue;
    counts.all++;
    counts[t.genre] = (counts[t.genre] || 0) + 1;
  }

  const genres = Object.keys(counts).filter(k => k !== 'all').sort((a, b) => counts[b] - counts[a]);
  const recentCount = recentlyPlayed.filter(k => tracks.some(t => trackKey(t) === k && !hidden.has(t.file))).length;

  const items = [
    { key: 'all', label: 'Todas', emoji: '🎧', count: counts.all },
    ...(likedCount > 0 ? [{ key: '__liked', label: 'Favoritos', emoji: '❤️', count: likedCount }] : []),
    ...(recentCount > 0 ? [{ key: '__recent', label: 'Recientes', emoji: '🕓', count: recentCount }] : []),
    ...genres.map(g => ({ key: g, label: g, emoji: GENRE_EMOJI[g] || '🎵', count: counts[g] }))
  ];

  $('genre-list').innerHTML = items.map(it => `
    <div class="genre-item ${activeGenre === it.key ? 'active' : ''}" data-key="${escapeHtml(it.key)}">
      <div class="genre-emoji" style="background:${gradient(it.label)}">${it.emoji}</div>
      <div class="genre-meta">
        <div class="genre-name">${escapeHtml(it.label)}</div>
        <div class="genre-count">${it.count} ${it.count === 1 ? 'canción' : 'canciones'}</div>
      </div>
    </div>
  `).join('');

  $('genre-list').querySelectorAll('.genre-item').forEach(el => {
    el.addEventListener('click', () => {
      activeGenre = el.dataset.key;
      renderSidebar();
      applyFilter();
      $('sidebar').classList.remove('open');
    });
  });

  renderPlaylistList();
}

function renderPlaylistList() {
  const el = $('playlist-list');
  if (!el) return;
  if (playlists.length === 0) {
    el.innerHTML = '<div style="padding:8px 22px; font-size:12px; color:var(--muted)">Crea una con el botón +</div>';
    return;
  }
  el.innerHTML = playlists.map(p => `
    <div class="genre-item ${activeGenre === '__pl_' + p.id ? 'active' : ''}" data-pl="${escapeHtml(p.id)}">
      <div class="genre-emoji" style="background:${gradient('pl-' + p.id + p.name)}">📋</div>
      <div class="genre-meta">
        <div class="genre-name">${escapeHtml(p.name)}</div>
        <div class="genre-count">${p.tracks.length} ${p.tracks.length === 1 ? 'canción' : 'canciones'}</div>
      </div>
    </div>
  `).join('');

  el.querySelectorAll('.genre-item').forEach(item => {
    item.addEventListener('click', () => {
      activeGenre = '__pl_' + item.dataset.pl;
      renderSidebar();
      applyFilter();
      $('sidebar').classList.remove('open');
    });
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openPlaylistContextMenu(e, item.dataset.pl);
    });
  });
}

function openPlaylistContextMenu(e, plId) {
  const pl = findPlaylist(plId);
  if (!pl) return;
  const m = $('ctx-menu');
  m.innerHTML = `
    <div class="ctx-header"><strong>${escapeHtml(pl.name)}</strong>${pl.tracks.length} canciones</div>
    <button data-action="play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>Reproducir playlist</button>
    <button data-action="rename"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>Renombrar</button>
    <div class="sep"></div>
    <button class="danger" data-action="delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>Borrar playlist</button>
  `;
  m.classList.add('show');
  const w = 240, h = m.offsetHeight || 180;
  m.style.left = Math.min(e.clientX, window.innerWidth - w - 8) + 'px';
  m.style.top = Math.min(e.clientY, window.innerHeight - h - 8) + 'px';

  m.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      const a = b.dataset.action;
      closeContextMenu();
      if (a === 'play') {
        activeGenre = '__pl_' + plId;
        renderSidebar();
        applyFilter();
        if (viewTracks.length > 0) {
          const idx = tracks.findIndex(t => trackKey(t) === trackKey(viewTracks[0]));
          if (idx >= 0) playTrack(idx);
        }
      } else if (a === 'rename') {
        const newName = prompt('Nuevo nombre para la playlist:', pl.name);
        if (newName !== null) {
          renamePlaylist(plId, newName);
          renderSidebar();
          if (activeGenre === '__pl_' + plId) renderHero();
        }
      } else if (a === 'delete') {
        if (confirm(`¿Borrar la playlist "${pl.name}"? Las canciones siguen en el repo, solo se borra la lista.`)) {
          deletePlaylist(plId);
          renderSidebar();
          applyFilter();
        }
      }
    });
  });
}

function showNewPlaylistForm() {
  const wrap = $('playlist-new-form-wrap');
  wrap.innerHTML = `
    <form class="playlist-new-form" id="pl-form">
      <input type="text" id="pl-input" placeholder="Nombre..." maxlength="40" autocomplete="off">
      <button type="submit">OK</button>
    </form>
  `;
  const input = $('pl-input');
  input.focus();
  $('pl-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const pl = createPlaylist(input.value);
    wrap.innerHTML = '';
    if (pl) {
      activeGenre = '__pl_' + pl.id;
      renderSidebar();
      applyFilter();
      toast(`Playlist "${pl.name}" creada`);
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { wrap.innerHTML = ''; }
  });
  input.addEventListener('blur', () => {
    // Pequeño delay para permitir click en el botón OK
    setTimeout(() => {
      if (!input.value.trim()) wrap.innerHTML = '';
    }, 200);
  });
}

function compareTracks(a, b) {
  const dir = sortDir === 'asc' ? 1 : -1;
  if (!sortBy) return (a.order - b.order) * dir;
  const va = (a[sortBy] || '').toLowerCase();
  const vb = (b[sortBy] || '').toLowerCase();
  return va < vb ? -dir : va > vb ? dir : 0;
}

function applyFilter() {
  const q = searchQuery.toLowerCase();
  viewTracks = tracks.filter(t => {
    if (hidden.has(t.file)) return false;
    if (activeGenre === '__liked') {
      if (!liked.has(trackKey(t))) return false;
    } else if (activeGenre === '__recent') {
      if (!recentlyPlayed.includes(trackKey(t))) return false;
    } else if (activeGenre.startsWith('__pl_')) {
      const pl = findPlaylist(activeGenre.slice(5));
      if (!pl || !pl.tracks.includes(trackKey(t))) return false;
    } else if (activeGenre !== 'all' && t.genre !== activeGenre) {
      return false;
    }
    if (q && !t.title.toLowerCase().includes(q) && !t.artist.toLowerCase().includes(q)) return false;
    return true;
  });

  if (activeGenre === '__recent' && !sortBy) {
    viewTracks.sort((a, b) => recentlyPlayed.indexOf(trackKey(a)) - recentlyPlayed.indexOf(trackKey(b)));
  } else if (activeGenre.startsWith('__pl_') && !sortBy) {
    const pl = findPlaylist(activeGenre.slice(5));
    if (pl) viewTracks.sort((a, b) => pl.tracks.indexOf(trackKey(a)) - pl.tracks.indexOf(trackKey(b)));
  } else {
    viewTracks.sort(compareTracks);
  }
  // Reset preview shuffle al cambiar de vista
  previewUpcoming._seed = null;
  renderHero();
  renderList();
  renderUpNext();
}

function renderHero() {
  const total = viewTracks.length;
  const totSec = viewTracks.reduce((a, t) => a + (t.duration || 0), 0);
  let title, tag, seed, sym;
  if (activeGenre === 'all') {
    title = 'Tu librería';
    tag = 'Todas las canciones';
    seed = 'all-' + tracks.length;
    sym = 'M';
  } else if (activeGenre === '__liked') {
    title = 'Favoritos';
    tag = 'Tus canciones marcadas';
    seed = 'liked';
    sym = '❤';
  } else if (activeGenre === '__recent') {
    title = 'Recientes';
    tag = 'Últimas reproducidas';
    seed = 'recent';
    sym = '🕓';
  } else if (activeGenre.startsWith('__pl_')) {
    const pl = findPlaylist(activeGenre.slice(5));
    title = pl ? pl.name : 'Playlist';
    tag = 'Playlist';
    seed = pl ? ('pl-' + pl.id + pl.name) : 'pl';
    sym = '📋';
  } else {
    title = activeGenre;
    tag = 'Género';
    seed = activeGenre;
    sym = initial(title);
  }
  $('hero-title').textContent = title;
  $('hero-tag').textContent = tag;
  const cover = $('hero-cover');
  // Limpiar img si había
  cover.querySelector('img')?.remove();
  cover.classList.remove('has-art');
  cover.style.background = gradient(seed);
  cover.textContent = sym;
  const durTxt = totSec > 0 ? ` · ~${Math.round(totSec / 60)} min` : '';
  $('hero-sub').innerHTML = `<strong>${total}</strong> ${total === 1 ? 'canción' : 'canciones'}${durTxt}` +
    (searchQuery ? ` · búsqueda: "${escapeHtml(searchQuery)}"` : '');

  // Si hay una canción visible y no es una vista virtual rara, usar su cover en el hero
  if (viewTracks.length > 0 && activeGenre !== 'all') {
    const first = viewTracks[0];
    setCoverArt(cover, first);
  }
}

function renderList() {
  const empty = $('empty-state');
  const list = $('track-list');
  empty.classList.toggle('hidden', viewTracks.length > 0);
  if (viewTracks.length === 0) { list.innerHTML = ''; return; }

  const playing = currentIndex >= 0 ? tracks[currentIndex] : null;
  const paused = audio.paused;

  list.innerHTML = viewTracks.map((t, i) => {
    const isPlaying = playing && trackKey(playing) === trackKey(t);
    const isLiked = liked.has(trackKey(t));
    const dur = t.duration ? fmt(t.duration) : '—';
    return `
      <div class="track-row ${isPlaying ? 'playing' : ''} ${isPlaying && paused ? 'paused' : ''}"
           data-key="${escapeHtml(trackKey(t))}">
        <div class="track-num">
          <span class="num">${i + 1}</span>
          <svg class="play-icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          <div class="bars"><span></span><span></span><span></span></div>
        </div>
        <div class="track-cover" style="background:${gradient(t.title || t.file)}">${initial(t.title)}</div>
        <div class="track-info">
          <div class="track-name">${escapeHtml(t.title)}</div>
          <div class="track-artist">${escapeHtml(t.artist)}</div>
        </div>
        <div class="track-col artist">${escapeHtml(t.artist)}</div>
        <div class="track-col genre"><span class="track-genre">${escapeHtml(t.genre)}</span></div>
        <div class="track-duration">${dur}</div>
        <div class="track-row-actions">
          <button class="icon-mini ${isLiked ? 'liked always' : ''}" data-action="like" title="Favorito">
            <svg viewBox="0 0 24 24" ${isLiked ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2"'}>
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </button>
          <button class="icon-mini danger" data-action="hide" title="Quitar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.track-row').forEach(row => {
    row.addEventListener('click', (e) => {
      const btn = e.target.closest('.icon-mini');
      if (btn) {
        e.stopPropagation();
        if (btn.dataset.action === 'hide') hideTrack(row);
        else if (btn.dataset.action === 'like') likeTrackByKey(row.dataset.key);
        return;
      }
      const key = row.dataset.key;
      const idx = tracks.findIndex(t => trackKey(t) === key);
      if (idx >= 0) playTrack(idx);
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openContextMenu(e, row.dataset.key);
    });
  });
}

function hideTrack(rowEl) {
  const key = rowEl.dataset.key;
  const t = tracks.find(x => trackKey(x) === key);
  if (!t) return;
  rowEl.classList.add('removing');
  setTimeout(() => {
    hidden.add(t.file);
    persistHidden();
    computeAndRender();
    toast('Canción oculta. Banner amarillo arriba para borrar definitivamente.');
  }, 220);
}

function likeTrackByKey(key) {
  if (liked.has(key)) liked.delete(key); else liked.add(key);
  persistLiked();
  renderSidebar();
  renderList();
  // Update like icon en now-playing
  const cur = currentIndex >= 0 ? tracks[currentIndex] : null;
  if (cur && trackKey(cur) === key) updateLikeNP(cur);
}

function updateHiddenBanner() {
  const n = hidden.size;
  $('hidden-banner').classList.toggle('show', n > 0);
  $('hidden-count').textContent = n;
}

// ============== PLAYBACK ==============
function userVolume() { return parseFloat($('volume').value) / 100; }

function updateNowPlayingUI(t) {
  $('np-title').textContent = t.title;
  $('np-artist').textContent = t.artist;
  const cover = $('cover-art');
  cover.style.background = gradient(t.title || t.file);
  const phEl = cover.querySelector('.ph');
  if (phEl) phEl.remove();
  cover.querySelector('.label')?.remove();
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = initial(t.title);
  cover.appendChild(label);
  // Mantén el canvas del visualizer
  if (!cover.querySelector('#viz')) {
    const c = document.createElement('canvas');
    c.id = 'viz';
    cover.appendChild(c);
  }
  document.title = `${t.title} — MauPlayer`;
  updateLikeNP(t);
}

function updateLikeNP(t) {
  const btn = $('btn-like-np');
  btn.classList.toggle('liked', liked.has(trackKey(t)));
}

function playTrack(idx) {
  if (idx < 0 || idx >= tracks.length) return;
  if (fadingOut) {
    audioOther.pause();
    audioOther.currentTime = 0;
    fadingOut = false;
  }
  currentIndex = idx;
  const t = tracks[idx];
  audio.src = t.url;
  audio.volume = userVolume();
  updateNowPlayingUI(t);
  audio.play().then(() => initAudioCtx()).catch(() => {});
  recordPlay(t);
  updateMediaSession(t);
  setCoverArt($('cover-art'), t);
  renderList();
  renderUpNext();
}

function pickNextIndex() {
  if (!viewTracks.length) return -1;
  const cur = currentIndex >= 0 ? tracks[currentIndex] : null;
  const viewIdx = cur ? viewTracks.findIndex(t => trackKey(t) === trackKey(cur)) : -1;

  let nextT;
  if (shuffle) {
    // Smart shuffle: evita el mismo artista back-to-back si hay alternativa
    let pool = viewTracks;
    if (cur && viewTracks.length > 2) {
      const filtered = viewTracks.filter(t =>
        t.artist !== cur.artist && trackKey(t) !== trackKey(cur)
      );
      if (filtered.length > 0) pool = filtered;
    } else if (cur && viewTracks.length > 1) {
      pool = viewTracks.filter(t => trackKey(t) !== trackKey(cur));
    }
    nextT = pool[Math.floor(Math.random() * pool.length)];
  } else {
    nextT = viewTracks[(viewIdx + 1) % viewTracks.length];
  }
  return tracks.findIndex(t => trackKey(t) === trackKey(nextT));
}

function previewUpcoming(n = 12) {
  if (!viewTracks.length) return [];
  if (shuffle) {
    // Una "vista previa" estable basada en el orden actual + sesión
    const cur = currentIndex >= 0 ? tracks[currentIndex] : null;
    const pool = cur ? viewTracks.filter(t => trackKey(t) !== trackKey(cur)) : [...viewTracks];
    // shuffle determinístico por sesión
    if (!previewUpcoming._seed) previewUpcoming._seed = Math.random();
    const seeded = pool.map((t, i) => ({ t, k: hashStr(trackKey(t) + previewUpcoming._seed) }))
                       .sort((a, b) => a.k - b.k)
                       .map(x => x.t);
    return seeded.slice(0, n);
  } else {
    const cur = currentIndex >= 0 ? tracks[currentIndex] : null;
    const viewIdx = cur ? viewTracks.findIndex(t => trackKey(t) === trackKey(cur)) : -1;
    const start = viewIdx >= 0 ? viewIdx + 1 : 0;
    const result = [];
    for (let i = 0; i < n; i++) {
      const idx = (start + i) % viewTracks.length;
      if (i > 0 && idx === start) break;
      result.push(viewTracks[idx]);
    }
    return result;
  }
}

function startCrossfade() {
  if (fadingOut || crossfadeSec <= 0 || repeat) return;
  const nextIdx = pickNextIndex();
  if (nextIdx < 0 || nextIdx === currentIndex) return;
  const nextT = tracks[nextIdx];

  fadingOut = true;
  audioOther.src = nextT.url;
  audioOther.volume = 0;
  const p = audioOther.play();
  if (p && p.catch) p.catch(() => { fadingOut = false; });

  const uVol = userVolume();
  const durMs = crossfadeSec * 1000;
  const start = performance.now();
  const fromAudio = audio;
  const toAudio = audioOther;

  currentIndex = nextIdx;
  updateNowPlayingUI(nextT);
  renderList();

  function tick(now) {
    if (!fadingOut) return;
    const elapsed = Math.min(1, (now - start) / durMs);
    fromAudio.volume = uVol * (1 - elapsed);
    toAudio.volume = uVol * elapsed;
    if (elapsed < 1) requestAnimationFrame(tick);
    else {
      fromAudio.pause();
      try { fromAudio.currentTime = 0; } catch {}
      fromAudio.volume = uVol;
      audio = toAudio;
      audioOther = fromAudio;
      fadingOut = false;
      // Reconectar visualizer al nuevo audio activo
      connectAnalyserToActive();
    }
  }
  requestAnimationFrame(tick);
}

function togglePlay() {
  if (!tracks.length) return;
  if (currentIndex < 0) {
    const firstVisible = viewTracks[0];
    if (!firstVisible) return;
    const idx = tracks.findIndex(t => trackKey(t) === trackKey(firstVisible));
    return playTrack(idx);
  }
  audio.paused ? audio.play() : audio.pause();
}

function nextTrack() {
  const idx = pickNextIndex();
  if (idx >= 0) playTrack(idx);
}

function prevTrack() {
  if (!viewTracks.length) return;
  if (audio.currentTime > 3 && !fadingOut) { audio.currentTime = 0; return; }
  const cur = currentIndex >= 0 ? tracks[currentIndex] : null;
  let viewIdx = cur ? viewTracks.findIndex(t => trackKey(t) === trackKey(cur)) : 0;
  const prev = viewTracks[(viewIdx - 1 + viewTracks.length) % viewTracks.length];
  const idx = tracks.findIndex(t => trackKey(t) === trackKey(prev));
  playTrack(idx);
}

// ============== AUDIO EVENTS ==============
function updatePlayBtn(playing) {
  $('icon-play').classList.toggle('hidden', playing);
  $('icon-pause').classList.toggle('hidden', !playing);
}

[audioA, audioB].forEach(el => {
  el.addEventListener('play', () => {
    if (el === audio) { updatePlayBtn(true); renderList(); startViz(); }
  });
  el.addEventListener('pause', () => {
    if (el === audio && !fadingOut) { updatePlayBtn(false); renderList(); stopViz(); }
  });
  el.addEventListener('timeupdate', () => {
    if (el !== audio || dragging) return;
    const dur = audio.duration || 0;
    const pct = dur ? (audio.currentTime / dur) * 100 : 0;
    $('progress').value = pct;
    $('progress').style.setProperty('--pct', pct + '%');
    $('time-cur').textContent = fmt(audio.currentTime);

    // Persist position (cada ~5s para no saturar localStorage)
    if (Math.floor(audio.currentTime) % 5 === 0 && currentIndex >= 0) {
      persist('mau-last', JSON.stringify({ key: trackKey(tracks[currentIndex]), time: audio.currentTime }));
    }

    if (!fadingOut && crossfadeSec > 0 && !repeat && dur > crossfadeSec + 1) {
      const remaining = dur - audio.currentTime;
      if (remaining > 0 && remaining <= crossfadeSec) startCrossfade();
    }
  });
  el.addEventListener('loadedmetadata', () => {
    if (el !== audio) return;
    $('time-total').textContent = fmt(audio.duration);
    if (currentIndex >= 0) tracks[currentIndex].duration = audio.duration;
  });
  el.addEventListener('ended', () => {
    if (el !== audio || fadingOut) return;
    if (sleepEndOfSong) {
      clearSleep();
      toast('Sleep timer: fin de canción alcanzado');
      return;
    }
    if (repeat) { audio.currentTime = 0; audio.play(); }
    else nextTrack();
  });
});

// ============== CONTROLS ==============
$('btn-play').addEventListener('click', togglePlay);
$('btn-next').addEventListener('click', nextTrack);
$('btn-prev').addEventListener('click', prevTrack);
$('btn-shuffle').addEventListener('click', () => {
  shuffle = !shuffle;
  $('btn-shuffle').classList.toggle('active', shuffle);
  toast(shuffle ? 'Aleatorio activado' : 'Aleatorio desactivado');
});
$('btn-repeat').addEventListener('click', () => {
  repeat = !repeat;
  $('btn-repeat').classList.toggle('active', repeat);
  toast(repeat ? 'Repetir activado' : 'Repetir desactivado');
});

$('btn-like-np').addEventListener('click', () => {
  if (currentIndex < 0) return;
  likeTrackByKey(trackKey(tracks[currentIndex]));
});

$('btn-play-all').addEventListener('click', () => {
  if (!viewTracks.length) return;
  shuffle = false;
  $('btn-shuffle').classList.remove('active');
  const idx = tracks.findIndex(t => trackKey(t) === trackKey(viewTracks[0]));
  playTrack(idx);
});

$('btn-shuffle-all').addEventListener('click', () => {
  if (!viewTracks.length) return;
  shuffle = true;
  $('btn-shuffle').classList.add('active');
  const idx = tracks.findIndex(t => trackKey(t) === trackKey(viewTracks[Math.floor(Math.random() * viewTracks.length)]));
  playTrack(idx);
});

// Sortable columns
document.querySelectorAll('#track-list-header .sortable').forEach(el => {
  el.addEventListener('click', () => {
    const col = el.dataset.col;
    if (sortBy === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else { sortBy = col; sortDir = 'asc'; }
    document.querySelectorAll('#track-list-header .sortable').forEach(e2 => {
      e2.classList.remove('sorted', 'asc', 'desc');
    });
    el.classList.add('sorted', sortDir);
    applyFilter();
  });
});

// ============== PROGRESS / VOLUME ==============
$('progress').addEventListener('mousedown', () => dragging = true);
$('progress').addEventListener('input', () => {
  const pct = $('progress').value;
  $('progress').style.setProperty('--pct', pct + '%');
  $('time-cur').textContent = fmt((pct / 100) * (audio.duration || 0));
});
$('progress').addEventListener('change', () => {
  dragging = false;
  if (audio.duration) audio.currentTime = ($('progress').value / 100) * audio.duration;
});

const savedVol = parseFloat(localStorage.getItem('mau-volume') || '0.8');
audioA.volume = savedVol;
audioB.volume = savedVol;
$('volume').value = savedVol * 100;
$('volume').style.setProperty('--vol', (savedVol * 100) + '%');

$('volume').addEventListener('input', () => {
  const v = $('volume').value / 100;
  if (!fadingOut) { audioA.volume = v; audioB.volume = v; }
  $('volume').style.setProperty('--vol', $('volume').value + '%');
  persist('mau-volume', v.toString());
});

$('vol-icon').addEventListener('click', () => {
  if (audio.volume > 0) {
    audio.dataset.prev = audio.volume;
    $('volume').value = 0;
  } else {
    $('volume').value = (parseFloat(audio.dataset.prev || '0.8')) * 100;
  }
  $('volume').dispatchEvent(new Event('input'));
});

// ============== CROSSFADE ==============
function updateCrossfadeLabel() {
  $('crossfade-label').textContent = crossfadeSec === 0 ? 'off' : crossfadeSec + 's';
  $('btn-crossfade').classList.toggle('active', crossfadeSec > 0);
  $('btn-crossfade').title = `Crossfade: ${crossfadeSec === 0 ? 'desactivado' : crossfadeSec + ' segundos'} (click para cambiar)`;
}
updateCrossfadeLabel();

$('btn-crossfade').addEventListener('click', () => {
  const i = CROSSFADE_OPTIONS.indexOf(crossfadeSec);
  crossfadeSec = CROSSFADE_OPTIONS[(i + 1) % CROSSFADE_OPTIONS.length];
  persist('mau-crossfade', String(crossfadeSec));
  updateCrossfadeLabel();
  toast(crossfadeSec === 0 ? 'Crossfade desactivado' : `Crossfade: ${crossfadeSec}s`);
});

// ============== SEARCH ==============
$('search').addEventListener('input', (e) => {
  searchQuery = e.target.value.trim();
  applyFilter();
});

// ============== HIDDEN / DELETE ==============
$('btn-restore-hidden').addEventListener('click', () => {
  hidden.clear();
  persistHidden();
  computeAndRender();
  toast('Canciones restauradas');
});

$('btn-export-deletions').addEventListener('click', () => {
  const groups = {};
  for (const file of hidden) {
    const t = tracks.find(x => x.file === file);
    if (!t) continue;
    const key = t.source === 'local' ? 'repo-principal' : t.source;
    (groups[key] = groups[key] || []).push(file);
  }
  if (Object.keys(groups).length === 0) { toast('No hay canciones para borrar'); return; }

  const lines = ['#!/usr/bin/env bash',
    '# Generado por MauPlayer. Ejecuta esto en cada repo correspondiente y luego haz git push.', ''];
  for (const [src, files] of Object.entries(groups)) {
    lines.push(`# === ${src} ===`);
    if (src === 'repo-principal') lines.push('# cd /ruta/a/Mau-player && bash este-script.sh');
    else lines.push(`# cd /ruta/a/<repo correspondiente a ${src}> && bash este-script.sh`);
    const args = files.map(f => `"${f.replace(/"/g, '\\"')}"`).join(' \\\n  ');
    lines.push(`./remove-song.sh \\\n  ${args}`);
    lines.push('');
  }
  lines.push('# Cuando termines:');
  lines.push('# git add -A && git commit -m "remove: tracks ocultos desde el player" && git push');

  $('delete-script').textContent = lines.join('\n');
  showModal('delete-modal');
});

// ============== CONTEXT MENU ==============
function openContextMenu(e, key) {
  const t = tracks.find(x => trackKey(x) === key);
  if (!t) return;
  const m = $('ctx-menu');
  const isLiked = liked.has(key);
  const inPlaylist = activeGenre.startsWith('__pl_');
  const plId = inPlaylist ? activeGenre.slice(5) : null;

  m.innerHTML = `
    <div class="ctx-header"><strong>${escapeHtml(t.title)}</strong>${escapeHtml(t.artist)}</div>
    <button data-action="play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>Reproducir ahora</button>
    <button class="like" data-action="like"><svg viewBox="0 0 24 24" ${isLiked ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2"'}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>${isLiked ? 'Quitar de favoritos' : 'Marcar como favorito'}</button>
    <button data-action="add-pl"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Añadir a playlist…</button>
    ${inPlaylist ? `<button class="danger" data-action="remove-pl"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>Quitar de esta playlist</button>` : ''}
    <button data-action="copy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copiar "Artista — Título"</button>
    <div class="sep"></div>
    <button class="danger" data-action="hide"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>Quitar de la lista</button>
  `;
  m.classList.add('show');
  // Posicionar
  const w = 240, h = m.offsetHeight || 180;
  const x = Math.min(e.clientX, window.innerWidth - w - 8);
  const y = Math.min(e.clientY, window.innerHeight - h - 8);
  m.style.left = x + 'px';
  m.style.top = y + 'px';

  m.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      const a = b.dataset.action;
      closeContextMenu();
      if (a === 'play') {
        const idx = tracks.findIndex(x => trackKey(x) === key);
        if (idx >= 0) playTrack(idx);
      } else if (a === 'like') {
        likeTrackByKey(key);
      } else if (a === 'copy') {
        navigator.clipboard.writeText(`${t.artist} — ${t.title}`).catch(() => {});
        toast('Copiado');
      } else if (a === 'hide') {
        const row = document.querySelector(`.track-row[data-key="${CSS.escape(key)}"]`);
        if (row) hideTrack(row);
      } else if (a === 'add-pl') {
        openAddToPlaylistMenu(e, key);
      } else if (a === 'remove-pl' && plId) {
        removeTrackFromPlaylist(plId, key);
        applyFilter();
        renderSidebar();
        toast('Quitada de la playlist');
      }
    });
  });
}

function openAddToPlaylistMenu(srcEvent, trackK) {
  const m = $('submenu');
  const t = tracks.find(x => trackKey(x) === trackK);
  if (!t) return;
  m.innerHTML = `
    <div class="submenu-header">Añadir "${escapeHtml(t.title)}" a…</div>
    <button class="new-pl" data-pl="__new">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Nueva playlist
    </button>
    ${playlists.length === 0 ? '' : '<div class="sep"></div>'}
    ${playlists.map(p => {
      const has = p.tracks.includes(trackK);
      return `<button data-pl="${escapeHtml(p.id)}" ${has ? 'style="opacity:0.6"' : ''}>
        <div class="pl-icon-small" style="background:${gradient('pl-' + p.id + p.name)}">📋</div>
        <span>${escapeHtml(p.name)}</span>
        <span class="pl-count-small">${has ? '✓' : p.tracks.length}</span>
      </button>`;
    }).join('')}
  `;
  m.classList.add('show');
  // Position near cursor
  const w = 260, h = m.offsetHeight || 200;
  const x = Math.min((srcEvent.clientX || 0) + 8, window.innerWidth - w - 8);
  const y = Math.min((srcEvent.clientY || 0), window.innerHeight - h - 8);
  m.style.left = x + 'px';
  m.style.top = y + 'px';

  m.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.pl;
      closeSubmenu();
      if (id === '__new') {
        const name = prompt('Nombre de la nueva playlist:');
        if (!name || !name.trim()) return;
        const pl = createPlaylist(name);
        if (pl) {
          addTrackToPlaylist(pl.id, trackK);
          renderSidebar();
          toast(`"${pl.name}" creada y canción añadida`);
        }
      } else {
        const added = addTrackToPlaylist(id, trackK);
        const pl = findPlaylist(id);
        renderSidebar();
        if (activeGenre === '__pl_' + id) applyFilter();
        toast(added ? `Añadida a "${pl.name}"` : `Ya estaba en "${pl.name}"`);
      }
    });
  });
}

function closeSubmenu() { $('submenu').classList.remove('show'); }
document.addEventListener('click', (e) => {
  if (!e.target.closest('#submenu')) closeSubmenu();
});
window.addEventListener('blur', closeSubmenu);
window.addEventListener('resize', closeSubmenu);

function closeContextMenu() { $('ctx-menu').classList.remove('show'); }
document.addEventListener('click', (e) => {
  if (!e.target.closest('#ctx-menu')) closeContextMenu();
});
window.addEventListener('blur', closeContextMenu);
window.addEventListener('resize', closeContextMenu);
$('main').addEventListener('scroll', closeContextMenu);

// ============== MODAL ==============
function showModal(id) { $(id).classList.add('show'); }
function hideModal(id) { $(id).classList.remove('show'); }

document.querySelectorAll('.modal-bg').forEach(m => {
  m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('show'); });
});
document.querySelectorAll('[data-close-modal]').forEach(b => {
  b.addEventListener('click', () => hideModal(b.dataset.closeModal));
});
$('btn-copy-script')?.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('delete-script').textContent); toast('Script copiado'); }
  catch { toast('No se pudo copiar'); }
});

// Help
$('btn-help').addEventListener('click', () => showModal('help-modal'));

// ============== FILE PICKER / DRAG-DROP ==============
function handleFiles(files) {
  const added = [];
  Array.from(files).forEach(f => {
    if (!f.type.includes('audio')) return;
    const url = URL.createObjectURL(f);
    const name = f.name.replace(/\.mp3$/i, '');
    const parts = name.split(' - ');
    added.push({
      title: parts.length > 1 ? parts.slice(1).join(' - ') : name,
      artist: parts.length > 1 ? parts[0] : 'Local',
      genre: 'Locales',
      url, file: f.name, source: 'local-session',
      order: tracks.length, duration: 0, blob: url
    });
  });
  if (added.length) {
    tracks.push(...added);
    computeAndRender();
    toast(`${added.length} archivo(s) agregados a la sesión`);
  }
}

$('file-input').addEventListener('change', e => handleFiles(e.target.files));

document.addEventListener('dragenter', e => { e.preventDefault(); $('drop-zone').classList.add('active'); });
$('drop-zone').addEventListener('dragleave', e => {
  if (!$('drop-zone').contains(e.relatedTarget)) $('drop-zone').classList.remove('active');
});
$('drop-zone').addEventListener('dragover', e => e.preventDefault());
$('drop-zone').addEventListener('drop', e => {
  e.preventDefault();
  $('drop-zone').classList.remove('active');
  handleFiles(e.dataTransfer.files);
});

// ============== KEYBOARD ==============
document.addEventListener('keydown', e => {
  if (e.target === $('search')) {
    if (e.key === 'Escape') { e.target.value = ''; searchQuery = ''; applyFilter(); e.target.blur(); }
    return;
  }
  if (document.querySelector('.modal-bg.show')) {
    if (e.key === 'Escape') document.querySelectorAll('.modal-bg.show').forEach(m => m.classList.remove('show'));
    return;
  }
  if ($('ctx-menu').classList.contains('show') && e.key === 'Escape') { closeContextMenu(); return; }

  switch (e.key) {
    case ' ': e.preventDefault(); togglePlay(); break;
    case 'n': case 'N': nextTrack(); break;
    case 'p': case 'P': prevTrack(); break;
    case 's': case 'S': $('btn-shuffle').click(); break;
    case 'r': case 'R': $('btn-repeat').click(); break;
    case 'l': case 'L':
      if (currentIndex >= 0) likeTrackByKey(trackKey(tracks[currentIndex]));
      break;
    case 'q': case 'Q': toggleUpNext(); break;
    case 't': case 'T': updateSleepStatus(); showModal('sleep-modal'); break;
    case '/': e.preventDefault(); $('search').focus(); break;
    case '?': showModal('help-modal'); break;
    case 'ArrowRight':
      if (audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
      break;
    case 'ArrowLeft':
      if (audio.duration) audio.currentTime = Math.max(0, audio.currentTime - 5);
      break;
    case 'ArrowUp':
      e.preventDefault();
      $('volume').value = Math.min(100, parseFloat($('volume').value) + 5);
      $('volume').dispatchEvent(new Event('input'));
      break;
    case 'ArrowDown':
      e.preventDefault();
      $('volume').value = Math.max(0, parseFloat($('volume').value) - 5);
      $('volume').dispatchEvent(new Event('input'));
      break;
  }
});

// Mobile sidebar toggle
$('sidebar-toggle').addEventListener('click', () => {
  $('sidebar').classList.toggle('open');
});

// Nueva playlist
$('btn-new-playlist').addEventListener('click', showNewPlaylistForm);

// ============== UP NEXT PANEL ==============
function toggleUpNext(forceOpen) {
  const panel = $('upnext-panel');
  const open = forceOpen ?? !panel.classList.contains('open');
  panel.classList.toggle('open', open);
  $('btn-queue').classList.toggle('active', open);
  if (open) renderUpNext();
}

function renderUpNext() {
  const panel = $('upnext-panel');
  if (!panel.classList.contains('open')) return;
  const list = $('upnext-list');
  let items = [];
  if (upnextTab === 'next') {
    items = previewUpcoming(20);
  } else {
    items = recentlyPlayed
      .map(k => tracks.find(t => trackKey(t) === k))
      .filter(t => t && !hidden.has(t.file))
      .slice(0, 30);
  }
  if (items.length === 0) {
    list.innerHTML = `<div class="upnext-empty">${upnextTab === 'next' ? 'No hay nada en cola. Selecciona una canción.' : 'Aún no has reproducido nada en esta sesión.'}</div>`;
    return;
  }
  list.innerHTML = items.map(t => `
    <div class="upnext-item" data-key="${escapeHtml(trackKey(t))}">
      <div class="uc" style="background:${gradient(t.title || t.file)}">${initial(t.title)}</div>
      <div class="ui-info">
        <div class="ui-title">${escapeHtml(t.title)}</div>
        <div class="ui-artist">${escapeHtml(t.artist)}</div>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('.upnext-item').forEach(el => {
    el.addEventListener('click', () => {
      const k = el.dataset.key;
      const idx = tracks.findIndex(t => trackKey(t) === k);
      if (idx >= 0) playTrack(idx);
    });
  });
}

$('btn-queue').addEventListener('click', () => toggleUpNext());
$('btn-close-panel').addEventListener('click', () => toggleUpNext(false));

document.querySelectorAll('.upnext-tab').forEach(b => {
  b.addEventListener('click', () => {
    upnextTab = b.dataset.tab;
    document.querySelectorAll('.upnext-tab').forEach(x => x.classList.toggle('active', x === b));
    renderUpNext();
  });
});

// ============== SLEEP TIMER ==============
function clearSleep() {
  if (sleepTimerHandle) { clearTimeout(sleepTimerHandle); sleepTimerHandle = null; }
  sleepEndOfSong = false;
  sleepTimerDeadline = 0;
  $('btn-sleep').classList.remove('active');
  $('sleep-badge').textContent = '';
  updateSleepStatus();
}

function fadeOutAndPause() {
  const uVol = audio.volume;
  const start = performance.now();
  const dur = 8000;
  function tick(now) {
    const e = Math.min(1, (now - start) / dur);
    audio.volume = uVol * (1 - e);
    if (e < 1) requestAnimationFrame(tick);
    else {
      audio.pause();
      audio.volume = uVol;
      audioOther.volume = uVol;
      toast('Sleep timer: detenido');
    }
  }
  requestAnimationFrame(tick);
}

function setSleepTimer(min) {
  clearSleep();
  if (min === 'end') {
    sleepEndOfSong = true;
    $('btn-sleep').classList.add('active');
    $('sleep-badge').textContent = '·';
    toast('Se detendrá al final de la canción actual');
  } else {
    const minutes = parseInt(min, 10);
    sleepTimerDeadline = Date.now() + minutes * 60 * 1000;
    sleepTimerHandle = setTimeout(fadeOutAndPause, minutes * 60 * 1000);
    $('btn-sleep').classList.add('active');
    $('sleep-badge').textContent = minutes + 'm';
    toast(`Sleep timer en ${minutes} min`);
  }
  updateSleepStatus();
}

function updateSleepStatus() {
  const s = $('sleep-status');
  if (!s) return;
  if (sleepEndOfSong) s.textContent = 'Activo: detener al final de la canción actual.';
  else if (sleepTimerDeadline) {
    const remaining = Math.max(0, sleepTimerDeadline - Date.now());
    const mins = Math.ceil(remaining / 60000);
    s.textContent = `Activo: detener en ${mins} min.`;
  } else s.textContent = 'No hay timer activo.';
  document.querySelectorAll('.sleep-opt').forEach(o => o.classList.remove('active'));
}

$('btn-sleep').addEventListener('click', () => {
  updateSleepStatus();
  showModal('sleep-modal');
});

document.querySelectorAll('.sleep-opt').forEach(o => {
  o.addEventListener('click', () => {
    setSleepTimer(o.dataset.min);
    document.querySelectorAll('.sleep-opt').forEach(x => x.classList.toggle('active', x === o));
  });
});

$('btn-cancel-sleep').addEventListener('click', () => {
  clearSleep();
  toast('Sleep timer cancelado');
});

// Actualizar badge de sleep cada minuto
setInterval(() => {
  if (sleepTimerDeadline) {
    const remaining = Math.max(0, sleepTimerDeadline - Date.now());
    const mins = Math.ceil(remaining / 60000);
    $('sleep-badge').textContent = mins > 0 ? mins + 'm' : '';
    if (mins === 0) clearSleep();
  }
}, 30000);

// ============== VISUALIZER ==============
function initAudioCtx() {
  if (audioCtx) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.8;
    analyser.connect(audioCtx.destination);
    connectAnalyserToActive();
  } catch (e) { console.warn('AudioContext no disponible', e); }
}

function connectAnalyserToActive() {
  if (!audioCtx || !analyser) return;
  [audioA, audioB].forEach(el => {
    if (!sourceNodes.has(el)) {
      try {
        const src = audioCtx.createMediaElementSource(el);
        src.connect(analyser);
        sourceNodes.set(el, src);
      } catch (e) {
        // Si falla (e.g. CORS), el visualizer queda inactivo silenciosamente
        console.warn('No se pudo crear source node:', e);
      }
    }
  });
}

function startViz() {
  if (vizActive) return;
  vizActive = true;
  const canvas = $('viz');
  if (!canvas) return;
  canvas.classList.add('on');
  const ctx = canvas.getContext('2d');
  const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

  function draw() {
    if (!vizActive) return;
    const c = $('viz');
    if (!c) { vizActive = false; return; }
    const rect = c.getBoundingClientRect();
    if (c.width !== rect.width * devicePixelRatio) {
      c.width = rect.width * devicePixelRatio;
      c.height = rect.height * devicePixelRatio;
    }
    const w = c.width, h = c.height;
    const cx = ctx;
    cx.clearRect(0, 0, w, h);

    if (analyser && data) {
      analyser.getByteFrequencyData(data);
      const bars = 16;
      const bw = w / bars;
      cx.fillStyle = 'rgba(255,255,255,0.18)';
      for (let i = 0; i < bars; i++) {
        const v = data[Math.floor(i * data.length / bars)] / 255;
        const bh = v * h * 0.85;
        cx.fillRect(i * bw + 2, h - bh, bw - 4, bh);
      }
    }
    requestAnimationFrame(draw);
  }
  draw();
}

function stopViz() {
  vizActive = false;
  const c = $('viz');
  if (c) c.classList.remove('on');
}

// ============== INIT ==============
loadAll();
