const { contextBridge, ipcRenderer } = require('electron');
const { pathToFileURL } = require('url');

contextBridge.exposeInMainWorld('api', {
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  scanFolder: (folderPath) => ipcRenderer.invoke('scan-folder', folderPath),
  startDrag: (filePath) => ipcRenderer.invoke('start-drag', filePath),
  toFileUrl: (filePath) => pathToFileURL(filePath).toString()
});
