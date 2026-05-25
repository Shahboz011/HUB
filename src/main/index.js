const { app, BrowserWindow, shell, ipcMain, clipboard, powerMonitor, Notification, desktopCapturer } = require('electron')
const { join } = require('path')
const { autoUpdater } = require('electron-updater')
const https = require('https')
const crypto = require('crypto')

const SUPABASE_URL = 'oewfgyiuyeetsxebowaa.supabase.co'
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ld2ZneWl1eWVldHN4ZWJvd2FhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTUzNTE3MywiZXhwIjoyMDk1MTExMTczfQ.rWCGISd8zfe-gkgVDBGaz5SCP0lVsiWhyZX4FgJ-c3A'

function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let pwd = 'SCC-'
  for (let i = 0; i < 6; i++) pwd += chars[crypto.randomInt(chars.length)]
  return pwd
}

function supabaseAdminPost(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const options = {
      hostname: SUPABASE_URL,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Content-Length': Buffer.byteLength(payload),
      },
    }
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
        catch { resolve({ status: res.statusCode, body: data }) }
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

// IPC: create a new member without sending any email
ipcMain.handle('invite-member', async (_event, { email, department, position, hourly_rate }) => {
  const tempPassword = generateTempPassword()
  const result = await supabaseAdminPost('/auth/v1/admin/users', {
    email,
    password: tempPassword,
    email_confirm: true,         // skip email confirmation
    user_metadata: { department, position, hourly_rate },
  })

  if (result.status === 200 || result.status === 201) {
    return { ok: true, tempPassword }
  }

  // User already exists — just return error so admin knows
  const msg = result.body?.msg || result.body?.message || result.body?.error_description || 'Unknown error'
  return { ok: false, error: msg }
})

// IPC: delete a member from auth + profile
ipcMain.handle('delete-member', async (_event, { userId }) => {
  const result = await new Promise((resolve, reject) => {
    const options = {
      hostname: SUPABASE_URL,
      path: `/auth/v1/admin/users/${userId}`,
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
      },
    }
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    })
    req.on('error', reject)
    req.end()
  })
  if (result.status === 200 || result.status === 204) return { ok: true }
  return { ok: false, error: `Status ${result.status}` }
})

// IPC: get app version
ipcMain.handle('get-version', () => app.getVersion())

// IPC: capture screen via desktopCapturer (main process — more reliable than preload)
ipcMain.handle('capture-screen', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 720 },
    })
    if (!sources || sources.length === 0) return { ok: false, error: 'no_sources' }
    const buf = sources[0].thumbnail.toJPEG(60)
    if (!buf || buf.length === 0) return { ok: false, error: 'empty_thumbnail' }
    return { ok: true, dataUrl: 'data:image/jpeg;base64,' + buf.toString('base64') }
  } catch (e) {
    return { ok: false, error: e.message || 'unknown' }
  }
})

// IPC: copy text to clipboard
ipcMain.handle('copy-to-clipboard', (_event, text) => {
  clipboard.writeText(text)
})

// IPC: install downloaded update and restart
ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall()
})

// IPC: employee tells us when they clock in/out so we only notify when tracking
let isTracking = false
ipcMain.handle('set-tracking', (_event, val) => { isTracking = !!val })

// ── Activity monitor ────────────────────────────────────────────────────────
const IDLE_THRESHOLD_SECS = 1 * 60 // 1 minute

function setupActivityMonitor() {
  let wasIdle = false

  setInterval(() => {
    if (!win) return
    const idleSecs = powerMonitor.getSystemIdleTime()
    win.webContents.send('idle-tick', idleSecs)

    if (isTracking && idleSecs >= IDLE_THRESHOLD_SECS && !wasIdle) {
      wasIdle = true
      win.webContents.send('user-idle', idleSecs)

      if (Notification.isSupported()) {
        const n = new Notification({
          title: 'Salary Command Center — Timer Paused',
          body: 'No activity for 1 minute. Your work timer has been paused.',
        })
        n.on('click', () => { if (win) { win.show(); win.focus() } })
        n.show()
      }
    } else if (wasIdle && idleSecs < 30) {
      wasIdle = false
      win.webContents.send('user-active')
    }
  }, 10 * 1000)
}

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

  autoUpdater.on('update-available', (info) => {
    if (win) win.webContents.send('update-available', info.version)
  })

  autoUpdater.on('download-progress', (p) => {
    if (win) win.webContents.send('update-progress', Math.round(p.percent))
  })

  autoUpdater.on('update-downloaded', () => {
    if (win) win.webContents.send('update-ready')
  })

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err.message)
    if (win) win.webContents.send('update-error', err.message)
  })

  function check() {
    autoUpdater.checkForUpdates().catch(err => console.error('Update check failed:', err.message))
  }

  // Check shortly after launch, then every 30 minutes
  setTimeout(check, 4000)
  setInterval(check, 30 * 60 * 1000)
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
    // Block DevTools in production so employees cannot manipulate the app via console
    win.webContents.on('before-input-event', (_e, input) => {
      if ((input.control && input.shift && input.key.toLowerCase() === 'i') ||
          (input.control && input.shift && input.key.toLowerCase() === 'j') ||
          input.key === 'F12') {
        _e.preventDefault()
      }
    })
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
  setupActivityMonitor()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
