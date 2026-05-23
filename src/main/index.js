const { app, BrowserWindow, shell, dialog } = require('electron')
const { join } = require('path')
const { autoUpdater } = require('electron-updater')

const PROTOCOL = 'salary-app'
let win = null

// Register custom protocol so email links open this app, not the browser
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [join(__dirname, process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL)
}

// Windows: only allow one instance; forward deep-link URL to existing window
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
    const deepLink = commandLine.find((arg) => arg.startsWith(PROTOCOL + '://'))
    if (deepLink && win) win.webContents.send('deep-link', deepLink)
  })
}

// ── Auto-updater ───────────────────────────────────────────
function setupAutoUpdater() {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  // Silently download; only prompt when ready to install
  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      title: 'Update Ready',
      message: 'A new version of Salary Command Center has been downloaded.',
      detail: 'Restart the app now to apply the update.',
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall()
    })
  })

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err.message)
  })

  // Check 4 seconds after launch so the window is fully loaded first
  setTimeout(() => autoUpdater.checkForUpdates(), 4000)
}

// ── Window ─────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    title: 'Salary Command Center',
    backgroundColor: '#f1f5f9',
    titleBarStyle: 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// macOS: deep-link arrives here when app is already open
app.on('open-url', (event, url) => {
  event.preventDefault()
  if (win) win.webContents.send('deep-link', url)
})

app.whenReady().then(() => {
  createWindow()

  // macOS cold-launch deep link
  const coldLink = process.argv.find((arg) => arg.startsWith(PROTOCOL + '://'))
  if (coldLink && win) win.webContents.send('deep-link', coldLink)

  // Only check for updates in production (not dev mode)
  if (!process.env['ELECTRON_RENDERER_URL']) {
    setupAutoUpdater()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
