const { contextBridge, ipcRenderer } = require('electron')

// Exposes the single action this popup needs — nothing more.
// The main window's full electronAPI is intentionally NOT available here.
contextBridge.exposeInMainWorld('idlePopupAPI', {
  resume: () => ipcRenderer.send('idle-popup-continue'),
})
