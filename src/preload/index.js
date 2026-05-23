const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  onDeepLink: (callback) => ipcRenderer.on('deep-link', (_event, url) => callback(url)),
  inviteMember: (data) => ipcRenderer.invoke('invite-member', data),
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
})
