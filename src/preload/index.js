const { contextBridge, ipcRenderer, desktopCapturer } = require('electron')

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
  onUserIdle: (cb) => ipcRenderer.on('user-idle', (_e, secs) => cb(secs)),
  onUserActive: (cb) => ipcRenderer.on('user-active', () => cb()),
  captureScreen: async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1280, height: 720 },
      })
      if (!sources[0]) return null
      const buf = sources[0].thumbnail.toJPEG(60)
      return 'data:image/jpeg;base64,' + buf.toString('base64')
    } catch { return null }
  },
})
