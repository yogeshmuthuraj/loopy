/* global api */
(function () {
  const chooseBtn = document.getElementById('choose');
  const queryInput = document.getElementById('query');
  const countEl = document.getElementById('count');
  const listEl = document.getElementById('list');
  const player = document.getElementById('player');
  const nowEl = document.getElementById('now');
  const themeBtn = document.getElementById('theme');

  /** @type {Array<{name:string,path:string,relPath:string,ext:string}>} */
  let all = [];
  let currentFolder = null;
  let currentPlayingPath = null;
  let playingMode = null; // 'html5' | 'webaudio' | null
  let audioCtx = null;
  let currentSource = null; // WebAudio source node when using webaudio

  // Favorites and Collections state
  /** @type {Set<string>} */
  let favorites = new Set(); // file.path
  /** @type {Record<string, Set<string>>} */
  let collections = {}; // { collectionName: Set<file.path> }
  let activeFilter = { type: 'all', name: null };

  // Thumbnails cache: path -> imagePath
  const thumbs = new Map();
  const imageExts = ['.jpg', '.jpeg', '.png', '.webp'];

  function isPlaying(file) {
    if (currentPlayingPath !== file.path) return false;
    if (playingMode === 'html5') return !player.paused && !!player.src;
    if (playingMode === 'webaudio') return !!currentSource;
    return false;
  }

  function render(items) {
    listEl.innerHTML = '';
    countEl.textContent = `${items.length} item${items.length !== 1 ? 's' : ''}`;
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = currentFolder ? 'No matching audio files.' : 'Choose a folder to begin.';
      listEl.appendChild(empty);
      return;
    }
    const frag = document.createDocumentFragment();
    for (const file of items) {
      const row = document.createElement('div');
      row.className = 'item';

      const play = document.createElement('button');
      play.className = 'play';
      play.title = 'Play/Pause';
      play.textContent = isPlaying(file) ? '❚❚' : '▶';
      const thumbEl = document.createElement('img');
      thumbEl.className = 'thumb';
      const cached = thumbs.get(file.path);
      if (cached) {
        thumbEl.src = api.toFileUrl(cached);
      } else {
        // Asynchronously discover sidecar image
        findThumbFor(file).then((imgPath) => {
          if (imgPath) {
            thumbs.set(file.path, imgPath);
            try { thumbEl.src = api.toFileUrl(imgPath); } catch {}
          }
        });
      }

      play.addEventListener('click', () => togglePlay(file));

      const meta = document.createElement('div');
      meta.className = 'meta';

      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = file.name;
      // Make clicking the name auto-play from start
      name.style.cursor = 'pointer';
      name.addEventListener('click', () => playFromStart(file));

      const pathEl = document.createElement('div');
      pathEl.className = 'path';
      pathEl.textContent = file.relPath.replace(file.name, '').replace(/\/$/, '');

      meta.appendChild(name);
      meta.appendChild(pathEl);
      // Clicking the meta area auto-plays from start
      meta.addEventListener('click', (e) => {
        if ((e.target instanceof HTMLElement) && e.target.closest('.play')) return;
        playFromStart(file);
      });

      const ext = document.createElement('div');
      ext.className = 'ext';
      ext.textContent = file.ext.toUpperCase().slice(1);

      const star = document.createElement('button');
      star.className = 'star';
      star.title = favorites.has(file.path) ? 'Unfavorite' : 'Favorite';
      star.textContent = favorites.has(file.path) ? '★' : '☆';
      star.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(file.path);
        star.textContent = favorites.has(file.path) ? '★' : '☆';
        star.title = favorites.has(file.path) ? 'Unfavorite' : 'Favorite';
        renderCollectionsSidebar();
        filter();
      });

      const menu = document.createElement('button');
      menu.className = 'menu-btn';
      menu.textContent = '⋯';
      menu.title = 'More';
      menu.addEventListener('click', (e) => {
        e.stopPropagation();
        openMenuForFile(file, e);
      });

      row.appendChild(play);
      row.appendChild(thumbEl);
      row.appendChild(meta);
      row.appendChild(ext);
      row.appendChild(star);
      row.appendChild(menu);

      // Set up drag & drop to OS/DAW
      row.setAttribute('draggable', 'true');
      row.addEventListener('dragstart', (e) => {
        api.startDrag(file.path);
        e.dataTransfer?.setData('text/uri-list', api.toFileUrl(file.path));
        e.dataTransfer?.setData('text/plain', file.path);
      });

      // Single click anywhere on the row (except the play button) auto-plays from start
      row.addEventListener('click', (e) => {
        if ((e.target instanceof HTMLElement) && e.target.closest('.play')) return;
        playFromStart(file);
      });

      frag.appendChild(row);
    }
    listEl.appendChild(frag);
  }

  function filter() {
    const q = queryInput.value.trim().toLowerCase();
    let base = all;
    if (activeFilter.type === 'favorites') {
      base = base.filter(f => favorites.has(f.path));
    } else if (activeFilter.type === 'collection' && activeFilter.name && collections[activeFilter.name]) {
      const set = collections[activeFilter.name];
      base = base.filter(f => set.has(f.path));
    }
    const res = !q ? base : base.filter((f) =>
      f.name.toLowerCase().includes(q) ||
      f.relPath.toLowerCase().includes(q)
    );
    render(res);
  }

  function playFile(file) {
    const ext = file.ext.toLowerCase();
    // Prefer HTML5 for most formats; use WebAudio for AIFF as fallback
    if (ext === '.aif' || ext === '.aiff') {
      toggleWebAudio(file);
    } else {
      toggleHtml5(file);
    }
  }

  function togglePlay(file) {
    playFile(file);
  }

  function playFromStart(file) {
    const ext = file.ext.toLowerCase();
    if (ext === '.aif' || ext === '.aiff') {
      return startWebAudio(file);
    }
    return startHtml5(file);
  }

  function stopWebAudio() {
    if (currentSource) {
      try { currentSource.stop(); } catch {}
      try { currentSource.disconnect(); } catch {}
    }
    currentSource = null;
    if (playingMode === 'webaudio') playingMode = null;
  }

  async function toggleWebAudio(file) {
    // If same file via webaudio and currently playing -> stop
    if (currentPlayingPath === file.path && playingMode === 'webaudio' && currentSource) {
      stopWebAudio();
      filter();
      return;
    }
    // Switching modes: pause HTML5 if active
    if (playingMode === 'html5' && !player.paused) player.pause();

    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    stopWebAudio();
    let buffer;
    try {
      const arr = await api.readFileBuffer(file.path);
      buffer = await audioCtx.decodeAudioData(arr);
    } catch (e) {
      // Fallback to HTML5 if decode fails
      return toggleHtml5(file);
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(audioCtx.destination);
    src.onended = () => {
      currentSource = null;
      if (playingMode === 'webaudio') playingMode = null;
      filter();
    };
    currentPlayingPath = file.path;
    nowEl.textContent = file.relPath;
    playingMode = 'webaudio';
    currentSource = src;
    try { src.start(0); } catch {}
    filter();
  }

  function toggleHtml5(file) {
    const fileUrl = api.toFileUrl(file.path);
    // If switching from webaudio, stop that first
    if (playingMode === 'webaudio') stopWebAudio();

    if (currentPlayingPath !== file.path) {
      player.src = fileUrl;
      currentPlayingPath = file.path;
      nowEl.textContent = file.relPath;
      playingMode = 'html5';
      player.play().catch(() => {});
    } else {
      // Same file: toggle pause/play
      if (playingMode !== 'html5') {
        player.src = fileUrl;
        playingMode = 'html5';
      }
      if (player.paused) player.play().catch(() => {});
      else player.pause();
    }
    filter();
  }

  // Always (re)start from the beginning using WebAudio
  async function startWebAudio(file) {
    if (playingMode === 'html5' && !player.paused) player.pause();
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    stopWebAudio();
    try {
      const arr = await api.readFileBuffer(file.path);
      const buffer = await audioCtx.decodeAudioData(arr);
      const src = audioCtx.createBufferSource();
      src.buffer = buffer;
      src.connect(audioCtx.destination);
      src.onended = () => {
        currentSource = null;
        if (playingMode === 'webaudio') playingMode = null;
        filter();
      };
      currentPlayingPath = file.path;
      nowEl.textContent = file.relPath;
      playingMode = 'webaudio';
      currentSource = src;
      try { src.start(0); } catch {}
      filter();
    } catch (e) {
      // fallback
      toggleHtml5(file);
    }
  }

  // Always (re)start from the beginning using HTML5 audio
  function startHtml5(file) {
    const fileUrl = api.toFileUrl(file.path);
    if (playingMode === 'webaudio') stopWebAudio();
    if (currentPlayingPath === file.path && playingMode === 'html5') {
      try { player.currentTime = 0; } catch {}
      player.play().catch(() => {});
    } else {
      player.src = fileUrl;
      currentPlayingPath = file.path;
      nowEl.textContent = file.relPath;
      playingMode = 'html5';
      player.play().catch(() => {});
    }
    filter();
  }

  chooseBtn.addEventListener('click', async () => {
    chooseBtn.disabled = true;
    try {
      const folder = await api.chooseFolder();
      if (!folder) return;
      currentFolder = folder;
      try { localStorage.setItem('lastFolder', folder); } catch {}
      listEl.innerHTML = '<div class="empty">Scanning…</div>';
      all = await api.scanFolder(folder);
      renderCollectionsSidebar();
      filter();
    } finally {
      chooseBtn.disabled = false;
    }
  });

  queryInput.addEventListener('input', filter);

  // Keep UI in sync with HTML5 player state
  player.addEventListener('play', () => { playingMode = 'html5'; filter(); });
  player.addEventListener('pause', () => { if (!player.src) return; filter(); });
  player.addEventListener('ended', () => { filter(); });
  player.addEventListener('error', () => {
    // Try WebAudio fallback for AIFF or unknown cases
    const file = all.find(f => f.path === currentPlayingPath);
    if (file) toggleWebAudio(file);
  });

  // Restore last chosen folder if available
  (async function restoreLast() {
    let last = null;
    try { last = localStorage.getItem('lastFolder'); } catch {}
    if (!last) return;
    currentFolder = last;
    listEl.innerHTML = '<div class="empty">Scanning last folder…</div>';
    try {
      all = await api.scanFolder(last);
    } catch {
      all = [];
    }
    filter();
  })();

  // Theme toggle and persistence
  (function initTheme() {
    const root = document.documentElement;
    function apply(theme) {
      root.setAttribute('data-theme', theme);
      themeBtn.textContent = theme === 'light' ? '☀️' : '🌙';
      try { localStorage.setItem('theme', theme); } catch {}
    }
    let saved = null;
    try { saved = localStorage.getItem('theme'); } catch {}
    if (!saved) {
      const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
      saved = prefersLight ? 'light' : 'dark';
    }
    apply(saved);
    themeBtn?.addEventListener('click', () => {
      const next = (root.getAttribute('data-theme') === 'light') ? 'dark' : 'light';
      apply(next);
    });
  })();

  // Sidebar: Collections
  const addColBtn = document.getElementById('add-col');
  const newColInput = document.getElementById('new-col');
  const collectionsEl = document.getElementById('collections');
  const countAllEl = document.getElementById('count-all');
  const countFavEl = document.getElementById('count-fav');

  function renderCollectionsSidebar() {
    if (countAllEl) countAllEl.textContent = String(all.length);
    if (countFavEl) countFavEl.textContent = String(favorites.size);
    // Remove existing dynamic items
    [...collectionsEl.querySelectorAll('.col-item[data-name]')].forEach(n => n.remove());
    Object.keys(collections).sort((a,b)=>a.localeCompare(b)).forEach((name) => {
      const el = document.createElement('div');
      el.className = 'col-item';
      el.dataset.name = name;
      el.dataset.filter = 'collection';
      const left = document.createElement('span');
      left.className = 'col-name';
      left.textContent = name;
      const right = document.createElement('span');
      right.className = 'col-count';
      right.textContent = String(collections[name].size);
      el.appendChild(left); el.appendChild(right);
      el.addEventListener('click', () => {
        activeFilter = { type: 'collection', name };
        filter();
      });
      collectionsEl.appendChild(el);
    });
    // Wire up built-ins
    const allItem = collectionsEl.querySelector('.col-item[data-filter="all"]');
    const favItem = collectionsEl.querySelector('.col-item[data-filter="favorites"]');
    allItem?.addEventListener('click', () => { activeFilter = { type: 'all', name: null }; filter(); });
    favItem?.addEventListener('click', () => { activeFilter = { type: 'favorites', name: null }; filter(); });
  }

  function addCollection(name) {
    if (!name) return;
    if (!collections[name]) collections[name] = new Set();
    saveCollections();
    renderCollectionsSidebar();
  }

  addColBtn?.addEventListener('click', () => {
    const name = (newColInput?.value || '').trim();
    if (!name) return;
    addCollection(name);
    newColInput.value = '';
  });

  function openMenuForFile(file, ev) {
    closeDropdown();
    const dd = document.createElement('div');
    dd.className = 'dropdown';
    const rect = (ev.target instanceof HTMLElement) ? ev.target.getBoundingClientRect() : null;
    const x = rect ? rect.left : (ev.clientX || 20);
    const y = rect ? rect.bottom + 4 : (ev.clientY || 20);
    dd.style.left = `${Math.max(12, x)}px`;
    dd.style.top = `${Math.max(12, y)}px`;

    const makeItem = (label, onClick) => {
      const it = document.createElement('div');
      it.className = 'item';
      it.textContent = label;
      it.addEventListener('click', () => { onClick(); closeDropdown(); });
      return it;
    };

    // Favorite toggle
    dd.appendChild(makeItem(favorites.has(file.path) ? '★ Remove from Favorites' : '☆ Add to Favorites', () => {
      toggleFavorite(file.path);
      renderCollectionsSidebar();
      filter();
    }));

    // Collections list
    const names = Object.keys(collections).sort((a,b)=>a.localeCompare(b));
    if (names.length) {
      dd.appendChild(document.createElement('hr'));
      names.forEach((name) => {
        const inCol = collections[name]?.has(file.path);
        dd.appendChild(makeItem(`${inCol ? '✓ ' : ''}Add to "${name}"`, () => {
          toggleInCollection(name, file.path);
          renderCollectionsSidebar();
          filter();
        }));
      });
    }

    document.body.appendChild(dd);
    setTimeout(() => {
      document.addEventListener('click', onDocClick, { once: true });
      window.addEventListener('blur', closeDropdown, { once: true });
    }, 0);

    function onDocClick(e) {
      if (!(e.target instanceof HTMLElement)) return closeDropdown();
      if (!e.target.closest('.dropdown')) closeDropdown();
    }
    function closeDropdown() {
      dd.remove();
      document.removeEventListener('click', onDocClick);
      window.removeEventListener('blur', closeDropdown);
    }
  }

  function toggleFavorite(path) {
    if (favorites.has(path)) favorites.delete(path); else favorites.add(path);
    saveFavorites();
  }
  function toggleInCollection(name, path) {
    if (!collections[name]) collections[name] = new Set();
    const set = collections[name];
    if (set.has(path)) set.delete(path); else set.add(path);
    saveCollections();
  }

  function saveFavorites() {
    try { localStorage.setItem('favorites', JSON.stringify([...favorites])); } catch {}
  }
  function saveCollections() {
    try {
      const obj = Object.fromEntries(Object.entries(collections).map(([k,v]) => [k, [...v]]));
      localStorage.setItem('collections', JSON.stringify(obj));
    } catch {}
  }
  function loadPrefs() {
    try {
      const fav = JSON.parse(localStorage.getItem('favorites') || '[]');
      favorites = new Set(Array.isArray(fav) ? fav : []);
    } catch { favorites = new Set(); }
    try {
      const obj = JSON.parse(localStorage.getItem('collections') || '{}');
      collections = {};
      Object.keys(obj).forEach(k => { collections[k] = new Set(Array.isArray(obj[k]) ? obj[k] : []); });
    } catch { collections = {}; }
  }

  async function findThumbFor(file) {
    const base = file.path.replace(/\.[^.]+$/, '');
    for (const ext of imageExts) {
      const candidate = base + ext;
      try {
        const exists = await api.fileExists(candidate);
        if (exists) return candidate;
      } catch {}
    }
    return null;
  }

  // Load persisted favorites/collections and render sidebar initially
  loadPrefs();
  renderCollectionsSidebar();
})();
