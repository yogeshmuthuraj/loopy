const { app, BrowserWindow, dialog, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs').promises;

// Tiny 16x16 transparent PNG as drag icon (base64)
const DRAG_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAAHElEQVQ4T2NkYGD4z0AEMGGgAQxQYgGJYBIjQAAAHQwBEQqQH+QAAAAASUVORK5CYII=';

const audioExtensions = new Set([
  '.wav', '.aiff', '.aif', '.flac', '.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus'
]);

/**
 * Recursively scan a directory for audio files.
 * @param {string} rootDir
 * @returns {Promise<Array<{name:string,path:string,relPath:string,ext:string}>>}
 */
async function scanAudioFiles(rootDir) {
  /** @type {Array<{name:string,path:string,relPath:string,ext:string}>} */
  const results = [];

  async function walk(currentDir) {
    let entries = [];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (e) {
      return; // skip unreadable dirs
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // skip hidden files/folders
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (audioExtensions.has(ext)) {
          const relPath = path.relative(rootDir, fullPath);
          results.push({ name: entry.name, path: fullPath, relPath, ext });
        }
      }
    }
  }

  await walk(rootDir);
  // Sort by name, case-insensitive
  results.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return results;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 700,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('choose-folder', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Choose your loops folder',
    properties: ['openDirectory']
  });
  if (res.canceled || !res.filePaths?.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('scan-folder', async (_event, folderPath) => {
  if (!folderPath) return [];
  try {
    return await scanAudioFiles(folderPath);
  } catch (e) {
    console.error('Scan failed:', e);
    return [];
  }
});

ipcMain.handle('start-drag', (event, filePath) => {
  if (!filePath) return;
  const icon = nativeImage.createFromDataURL(DRAG_ICON_DATA_URL);
  event.sender.startDrag({ file: filePath, icon });
});

// Simple settings persistence in userData
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
async function loadSettings() {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
async function saveSettings(obj) {
  try {
    await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  } catch {}
  await fs.writeFile(settingsPath(), JSON.stringify(obj, null, 2), 'utf8');
}

ipcMain.handle('settings-get', async (_event, key) => {
  const s = await loadSettings();
  return s?.[key] ?? null;
});

ipcMain.handle('settings-set', async (_event, key, value) => {
  const s = await loadSettings();
  if (value === undefined || value === null) delete s[key];
  else s[key] = value;
  await saveSettings(s);
  return true;
});
