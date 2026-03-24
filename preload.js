const { contextBridge, ipcRenderer } = require('electron');
const { pathToFileURL } = require('url');
const fs = require('fs');
const fsp = require('fs').promises;

contextBridge.exposeInMainWorld('api', {
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  scanFolder: (folderPath) => ipcRenderer.invoke('scan-folder', folderPath),
  startDrag: (filePath) => ipcRenderer.invoke('start-drag', filePath),
  toFileUrl: (filePath) => pathToFileURL(filePath).toString(),
  // Read a file as ArrayBuffer for WebAudio decoding (e.g., AIFF)
  readFileBuffer: async (filePath) => {
    const buf = await fsp.readFile(filePath);
    // Return a trimmed ArrayBuffer view (avoid extra bytes from Node Buffer pool)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  },
  fileExists: async (filePath) => new Promise((resolve) => fs.access(filePath, (e) => resolve(!e)))
});
