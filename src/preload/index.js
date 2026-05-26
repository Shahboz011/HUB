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
  setTracking: (val) => ipcRenderer.invoke('set-tracking', val),
  onIdleTick: (cb) => ipcRenderer.on('idle-tick', (_e, secs) => cb(secs)),
  onCursorSample: (cb) => ipcRenderer.on('cursor-sample', (_e, pos) => cb(pos)),
  onUserIdle: (cb) => ipcRenderer.on('user-idle', (_e, secs) => cb(secs)),
  onUserActive: (cb) => ipcRenderer.on('user-active', () => cb()),
  getVersion: () => ipcRenderer.invoke('get-version'),
  fetchScreenshotImages: (paths) => ipcRenderer.invoke('fetch-screenshot-images', paths),
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
})
