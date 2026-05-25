const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  onDeepLink: (callback) => ipcRenderer.on('deep-link', (_event, url) => callback(url)),
  inviteMember: (data) => ipcRenderer.invoke('invite-member', data),
  deleteMember: (data) => ipcRenderer.invoke('delete-member', data),
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  onUpdateReady: (callback) => ipcRenderer.on('update-ready', () => callback()),
  installUpdate: () => ipcRenderer.invoke('install-update'),
})
