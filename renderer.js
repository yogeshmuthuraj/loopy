/* global api */
(function () {
  const chooseBtn = document.getElementById('choose');
  const queryInput = document.getElementById('query');
  const countEl = document.getElementById('count');
  const listEl = document.getElementById('list');
  const player = document.getElementById('player');
  const nowEl = document.getElementById('now');

  /** @type {Array<{name:string,path:string,relPath:string,ext:string}>} */
  let all = [];
  let currentFolder = null;
  let currentPlayingPath = null;
  let playingMode = null; // 'html5' | 'webaudio' | null
  let audioCtx = null;
  let currentSource = null; // WebAudio source node when using webaudio

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
      play.addEventListener('click', () => togglePlay(file));

      const meta = document.createElement('div');
      meta.className = 'meta';

      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = file.name;
      // Make clicking the name also play/pause
      name.style.cursor = 'pointer';
      name.addEventListener('click', () => togglePlay(file));

      const pathEl = document.createElement('div');
      pathEl.className = 'path';
      pathEl.textContent = file.relPath.replace(file.name, '').replace(/\/$/, '');

      meta.appendChild(name);
      meta.appendChild(pathEl);
      // Clicking anywhere in the meta area toggles playback
      meta.addEventListener('click', (e) => {
        // Avoid double-trigger when clicking the play button itself
        if ((e.target instanceof HTMLElement) && e.target.closest('.play')) return;
        togglePlay(file);
      });

      const ext = document.createElement('div');
      ext.className = 'ext';
      ext.textContent = file.ext.toUpperCase().slice(1);

      row.appendChild(play);
      row.appendChild(meta);
      row.appendChild(ext);

      // Set up drag & drop to OS/DAW
      row.setAttribute('draggable', 'true');
      row.addEventListener('dragstart', (e) => {
        api.startDrag(file.path);
        e.dataTransfer?.setData('text/uri-list', api.toFileUrl(file.path));
        e.dataTransfer?.setData('text/plain', file.path);
      });

      // Double click to quick play
      row.addEventListener('dblclick', () => {
        if (currentPlayingPath === file.path && !player.paused) {
          player.currentTime = 0; // restart
        } else {
          playFile(file);
        }
      });

      frag.appendChild(row);
    }
    listEl.appendChild(frag);
  }

  function filter() {
    const q = queryInput.value.trim().toLowerCase();
    if (!q) return render(all);
    const res = all.filter((f) =>
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

  chooseBtn.addEventListener('click', async () => {
    chooseBtn.disabled = true;
    try {
      const folder = await api.chooseFolder();
      if (!folder) return;
      currentFolder = folder;
      try { localStorage.setItem('lastFolder', folder); } catch {}
      listEl.innerHTML = '<div class="empty">Scanning…</div>';
      all = await api.scanFolder(folder);
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
})();
