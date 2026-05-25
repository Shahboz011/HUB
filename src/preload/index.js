const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  onDeepLink: (callback) => ipcRenderer.on('deep-link', (_event, url) => callback(url)),
  inviteMember: (data) => ipcRenderer.invoke('invite-member', data),
  deleteMember: (data) => ipcRenderer.invoke('delete-member', data),
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (_e, version) => callback(version)),
  onUpdateProgress: (callback) => ipcRenderer.on('update-progress', (_e, percent) => callback(percent)),
  onUpdateReady: (callback) => ipcRenderer.on('update-ready', () => callback()),
  onUpdateError: (callback) => ipcRenderer.on('update-error', (_e, msg) => callback(msg)),
  installUpdate: () => ipcRenderer.invoke('install-update'),
})
