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
      play.textContent = currentPlayingPath === file.path && !player.paused ? '❚❚' : '▶';
      play.addEventListener('click', () => togglePlay(file));

      const meta = document.createElement('div');
      meta.className = 'meta';

      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = file.name;

      const pathEl = document.createElement('div');
      pathEl.className = 'path';
      pathEl.textContent = file.relPath.replace(file.name, '').replace(/\/$/, '');

      meta.appendChild(name);
      meta.appendChild(pathEl);

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
    const fileUrl = api.toFileUrl(file.path);
    if (currentPlayingPath !== file.path) {
      player.src = fileUrl;
      player.play().catch(() => {});
    } else {
      if (player.paused) player.play().catch(() => {});
      else player.pause();
    }
    currentPlayingPath = file.path;
    nowEl.textContent = file.relPath;
    filter(); // refresh play button icons
  }

  function togglePlay(file) {
    if (currentPlayingPath === file.path) {
      if (player.paused) player.play().catch(() => {});
      else player.pause();
    } else {
      playFile(file);
    }
    filter();
  }

  chooseBtn.addEventListener('click', async () => {
    chooseBtn.disabled = true;
    try {
      const folder = await api.chooseFolder();
      if (!folder) return;
      currentFolder = folder;
      listEl.innerHTML = '<div class="empty">Scanning…</div>';
      all = await api.scanFolder(folder);
      filter();
    } finally {
      chooseBtn.disabled = false;
    }
  });

  queryInput.addEventListener('input', filter);
})();
