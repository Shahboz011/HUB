const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  onDeepLink: (callback) => ipcRenderer.on('deep-link', (_event, url) => callback(url)),
})
