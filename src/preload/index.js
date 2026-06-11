const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  onDeepLink: (callback) => ipcRenderer.on('deep-link', (_event, url) => callback(url)),
  // Clipboard — not a privileged operation, stays as IPC
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  // Avatar cache — local disk read/write, no service key
  uploadAvatar: (data) => ipcRenderer.invoke('upload-avatar', data),
  loadAvatarCache: () => ipcRenderer.invoke('avatar:load-cache'),
  fetchAndCacheAvatars: (users) => ipcRenderer.invoke('avatar:fetch-many', users),
  // Auto-updater
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (_e, version) => callback(version)),
  onUpdateProgress: (callback) => ipcRenderer.on('update-progress', (_e, percent) => callback(percent)),
  onUpdateReady: (callback) => ipcRenderer.on('update-ready', () => callback()),
  onUpdateError: (callback) => ipcRenderer.on('update-error', (_e, msg) => callback(msg)),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  getVersion: () => ipcRenderer.invoke('get-version'),
  // Screen capture (local OS call — no Supabase key involved)
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  // Activity / idle tracking
  setTracking: (val) => ipcRenderer.invoke('set-tracking', val),
  setBreakStatus: (val) => ipcRenderer.invoke('set-break-status', val),
  onIdleTick: (cb) => ipcRenderer.on('idle-tick', (_e, secs) => cb(secs)),
  onCursorSample: (cb) => ipcRenderer.on('cursor-sample', (_e, pos) => cb(pos)),
  onUserIdle: (cb) => ipcRenderer.on('user-idle', (_e, secs) => cb(secs)),
  onUserActive: (cb) => ipcRenderer.on('user-active', () => cb()),
  // Hubstaff-style per-second activity blocks
  activityStart:     (data) => ipcRenderer.invoke('activity:start', data),
  activityStop:      ()     => ipcRenderer.invoke('activity:stop'),
  activityConfigure: (cfg)  => ipcRenderer.invoke('activity:configure', cfg),
  onActivityBlock: (cb) => ipcRenderer.on('activity-block', (_e, block) => cb(block)),
  onActivityTick:  (cb) => ipcRenderer.on('activity-tick',  (_e, data)  => cb(data)),
})
