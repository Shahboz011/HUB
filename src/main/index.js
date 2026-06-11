const { app, BrowserWindow, shell, ipcMain, clipboard, powerMonitor, screen, nativeImage, Notification, desktopCapturer } = require('electron')
const { join } = require('path')
const { autoUpdater } = require('electron-updater')
const https = require('https')
const fs = require('fs')
const { execFile } = require('child_process')

// All privileged admin operations (invite, delete, update member/department/transactions,
// clear history/screenshots) have moved to Supabase Edge Functions.
// The service-role key no longer exists in the client bundle.
// See supabase/functions/ for the server-side implementations.

const SUPABASE_URL = 'dbukihrdqbjzohbcngqr.supabase.co'

// IPC: get app version
ipcMain.handle('get-version', () => app.getVersion())

// IPC: write avatar to the local disk cache after the renderer uploads to Supabase Storage.
// No service key — the renderer performs the actual Supabase Storage PUT using its own JWT.
ipcMain.handle('upload-avatar', async (_event, { userId, base64, mimeType }) => {
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg'
  const publicUrl = `https://${SUPABASE_URL}/storage/v1/object/public/avatars/${userId}/avatar.${ext}`
  try {
    const dir = avatarCacheDir()
    fs.mkdirSync(dir, { recursive: true })
    for (const e of ['jpg', 'png', 'webp']) {
      const old = join(dir, `${userId}.${e}`)
      if (fs.existsSync(old)) fs.unlinkSync(old)
    }
    fs.writeFileSync(join(dir, `${userId}.${ext}`), Buffer.from(base64, 'base64'))
  } catch { /* non-fatal — cache miss just means a network fetch on next launch */ }
  return { ok: true, url: publicUrl }
})

// ── Local avatar disk cache ───────────────────────────────────────────────────
// Stored in userData/avatar-cache/{userId}.{ext}
// Loaded into renderer memory on startup → instant rendering, no network flash.

function avatarCacheDir() {
  return join(app.getPath('userData'), 'avatar-cache')
}

// IPC: load all cached avatar files from disk → { [userId]: 'data:image/...;base64,...' }
ipcMain.handle('avatar:load-cache', async () => {
  const dir = avatarCacheDir()
  if (!fs.existsSync(dir)) return {}
  const result = {}
  for (const file of fs.readdirSync(dir)) {
    const m = file.match(/^(.+?)\.(jpg|png|webp)$/)
    if (!m) continue
    try {
      const buf = fs.readFileSync(join(dir, file))
      const mime = m[2] === 'png' ? 'image/png' : m[2] === 'webp' ? 'image/webp' : 'image/jpeg'
      result[m[1]] = `data:${mime};base64,${buf.toString('base64')}`
    } catch { /* skip corrupt files */ }
  }
  return result
})

// IPC: fetch a list of avatars from Supabase and cache to disk
// Input: [{ userId, url }]  → returns { [userId]: dataUrl } for newly fetched entries
ipcMain.handle('avatar:fetch-many', async (_event, users) => {
  const dir = avatarCacheDir()
  fs.mkdirSync(dir, { recursive: true })
  const result = {}

  await Promise.all(users.map(({ userId, url }) => new Promise((resolve) => {
    // Already on disk? Skip (any extension counts)
    for (const ext of ['jpg', 'png', 'webp']) {
      if (fs.existsSync(join(dir, `${userId}.${ext}`))) { resolve(); return }
    }
    let parsedPath
    try {
      const u = new URL(url)
      parsedPath = u.pathname + (u.search ? u.search : '')
    } catch { resolve(); return }

    // Avatars bucket is public — no Authorization header needed
    const options = {
      hostname: SUPABASE_URL,
      path: parsedPath,
      method: 'GET',
    }
    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) { resolve(); return }
      const contentType = (res.headers['content-type'] || 'image/jpeg').split(';')[0].trim()
      const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg'
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const buf = Buffer.concat(chunks)
        try {
          fs.writeFileSync(join(dir, `${userId}.${ext}`), buf)
          result[userId] = `data:${contentType};base64,${buf.toString('base64')}`
        } catch { /* disk write failed — no crash */ }
        resolve()
      })
    })
    req.on('error', () => resolve())
    req.end()
  })))

  return result
})

// fetch-screenshot-images removed — screenshots are now fetched by the renderer
// directly via supabase.storage.createSignedUrls() (see lib/edgeFunctions.js)

// ── Privacy blur ─────────────────────────────────────────────────────────────
// Three-pass sliding-window box blur on raw RGBA bitmap data.
// Radius 20 px × 3 passes ≈ Gaussian σ 35 px — makes all text unreadable while
// keeping window chrome and layout visible for activity verification.
// Operates entirely on in-process Buffers; the raw NativeImage pixel data never
// leaves the main process or touches any storage/network path.
function blurBitmap(buffer, width, height) {
  const R = 10
  const PASSES = 3
  const stride = width * 4
  const diam = R * 2 + 1
  let src = Buffer.from(buffer) // copy — never mutate the NativeImage's own buffer
  let dst = Buffer.allocUnsafe(buffer.length)

  for (let pass = 0; pass < PASSES; pass++) {
    // Horizontal sweep (sliding-window sum, O(width × height) regardless of R)
    for (let y = 0; y < height; y++) {
      const row = y * stride
      let rs = 0, gs = 0, bs = 0
      for (let dx = -R; dx <= R; dx++) {
        const nx = Math.max(0, Math.min(dx, width - 1))
        rs += src[row + nx * 4]; gs += src[row + nx * 4 + 1]; bs += src[row + nx * 4 + 2]
      }
      for (let x = 0; x < width; x++) {
        const o = row + x * 4
        dst[o] = (rs / diam) | 0; dst[o + 1] = (gs / diam) | 0
        dst[o + 2] = (bs / diam) | 0; dst[o + 3] = src[o + 3]
        const nx = Math.min(x + R + 1, width - 1)
        const px = Math.max(x - R, 0)
        rs += src[row + nx * 4] - src[row + px * 4]
        gs += src[row + nx * 4 + 1] - src[row + px * 4 + 1]
        bs += src[row + nx * 4 + 2] - src[row + px * 4 + 2]
      }
    }
    ;[src, dst] = [dst, src]

    // Vertical sweep
    for (let x = 0; x < width; x++) {
      const col = x * 4
      let rs = 0, gs = 0, bs = 0
      for (let dy = -R; dy <= R; dy++) {
        const ny = Math.max(0, Math.min(dy, height - 1))
        rs += src[ny * stride + col]; gs += src[ny * stride + col + 1]; bs += src[ny * stride + col + 2]
      }
      for (let y = 0; y < height; y++) {
        const o = y * stride + col
        dst[o] = (rs / diam) | 0; dst[o + 1] = (gs / diam) | 0
        dst[o + 2] = (bs / diam) | 0; dst[o + 3] = src[o + 3]
        const ny = Math.min(y + R + 1, height - 1)
        const py = Math.max(y - R, 0)
        rs += src[ny * stride + col] - src[py * stride + col]
        gs += src[ny * stride + col + 1] - src[py * stride + col + 1]
        bs += src[ny * stride + col + 2] - src[py * stride + col + 2]
      }
    }
    ;[src, dst] = [dst, src]
  }

  return src // points to the last-written buffer after an even number of swaps
}

// ── Active window detection ──────────────────────────────────────────────────
// Gets the foreground app name PLUS all visible window titles on the desktop.
// window_title stores "Active Tab | Other Window | ..." so violation detection
// can catch background apps (e.g. YouTube open in a background Chrome tab).
// Fails silently — returns empty strings so screenshots still upload on error.
function getActiveWindow() {
  return new Promise((resolve) => {
    const ps = [
      'Add-Type -TypeDefinition @"',
      'using System;',
      'using System.Runtime.InteropServices;',
      'using System.Text;',
      'public class Win32 {',
      '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
      '  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);',
      '  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);',
      '}',
      '"@',
      // Foreground window — app name
      '$h = [Win32]::GetForegroundWindow()',
      '$sb = New-Object System.Text.StringBuilder 512',
      '[Win32]::GetWindowText($h, $sb, 512) | Out-Null',
      '$activeTitle = $sb.ToString()',
      '$wpid = 0',
      '[Win32]::GetWindowThreadProcessId($h, [ref]$wpid) | Out-Null',
      '$p = Get-Process -Id $wpid -ErrorAction SilentlyContinue',
      "$app = if ($p) { try { $n = $p.MainModule.FileVersionInfo.ProductName; if ($n) { $n } else { $p.ProcessName } } catch { $p.ProcessName } } else { '' }",
      // All visible windows — catches background tabs (YouTube, Netflix, etc.)
      '$allTitles = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne \'\' } | Select-Object -ExpandProperty MainWindowTitle)',
      '$combined = @($activeTitle) + ($allTitles | Where-Object { $_ -ne $activeTitle }) | Select-Object -Unique',
      '$joined = $combined -join \' | \'',
      '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
      'Write-Output (ConvertTo-Json @{ title = $joined; app = $app })',
    ].join('\r\n')
    const enc = Buffer.from(ps, 'utf16le').toString('base64')
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc],
      { timeout: 8000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) { resolve({ active_app: '', window_title: '' }); return }
        try {
          const parsed = JSON.parse(stdout.trim())
          resolve({ active_app: (parsed.app || '').trim(), window_title: (parsed.title || '').trim() })
        } catch { resolve({ active_app: '', window_title: '' }) }
      }
    )
  })
}

// IPC: capture screen via desktopCapturer — multi-monitor aware, HIPAA-compliant blur
ipcMain.handle('capture-screen', async () => {
  try {
    const [sources, activeWindow] = await Promise.all([
      desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 720 } }),
      getActiveWindow(),
    ])
    if (!sources || sources.length === 0) return { ok: false, error: 'no_sources' }

    // Blur + encode each monitor sequentially with setImmediate yields so the
    // event loop stays responsive during CPU-intensive pixel work.
    const screens = []
    for (let i = 0; i < sources.length; i++) {
      const buf = await new Promise(resolve =>
        setImmediate(() => {
          try {
            resolve(sources[i].thumbnail.toJPEG(60))
          } catch { resolve(null) }
        })
      )
      if (buf && buf.length > 0) {
        screens.push({ index: i, dataUrl: 'data:image/jpeg;base64,' + buf.toString('base64') })
      }
    }

    if (screens.length === 0) return { ok: false, error: 'empty_thumbnails' }
    return { ok: true, screens, active_app: activeWindow.active_app, window_title: activeWindow.window_title }
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

// IPC: employee tells us when they start/end a break so idle is suppressed during breaks
let isOnBreak = false
ipcMain.handle('set-break-status', (_event, val) => { isOnBreak = !!val })

// ── Idle popup window ────────────────────────────────────────────────────────
// A native always-on-top BrowserWindow shown even when the main app is minimised.
// C3 fix: nodeIntegration disabled, contextIsolation enabled, dedicated preload.
// The HTML lives in resources/idle-popup.html (no inline HTML, no require()).
// The preload (idle-popup-preload.js) exposes ONLY window.idlePopupAPI.resume().

const IDLE_POPUP_PATH = app.isPackaged
  ? join(process.resourcesPath, 'idle-popup.html')
  : join(app.getAppPath(), 'resources', 'idle-popup.html')

const IDLE_POPUP_PRELOAD = join(__dirname, '../preload/idle-popup-preload.js')

let idlePopupWin = null

function showIdlePopup() {
  if (idlePopupWin && !idlePopupWin.isDestroyed()) return
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  idlePopupWin = new BrowserWindow({
    width: 420, height: 240,
    x: Math.round((width - 420) / 2),
    y: Math.round((height - 240) / 2),
    resizable: false, minimizable: false, maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    title: 'PharmaStaff Hub — Timer Paused',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration:   false,   // was true  — C3 fix
      contextIsolation:  true,    // was false — C3 fix
      sandbox:           true,    // renderer runs in OS sandbox
      preload:           IDLE_POPUP_PRELOAD,
    },
  })
  idlePopupWin.setAlwaysOnTop(true, 'screen-saver')
  idlePopupWin.loadFile(IDLE_POPUP_PATH)
  idlePopupWin.on('closed', () => { idlePopupWin = null })
}

function closeIdlePopup() {
  if (idlePopupWin && !idlePopupWin.isDestroyed()) {
    idlePopupWin.destroy()
    idlePopupWin = null
  }
}

// "Continue to work?" clicked inside the popup → close popup + resume main app
ipcMain.on('idle-popup-continue', () => {
  closeIdlePopup()
  if (win && !win.isDestroyed()) win.webContents.send('user-active')
})

// ── Activity monitor ────────────────────────────────────────────────────────
const IDLE_THRESHOLD_SECS = 1 * 60 // 1 minute

function setupActivityMonitor() {
  let wasIdle = false

  setInterval(() => {
    if (!win) return
    const idleSecs = powerMonitor.getSystemIdleTime()
    win.webContents.send('idle-tick', idleSecs)
    win.webContents.send('cursor-sample', screen.getCursorScreenPoint())

    if (isTracking && !isOnBreak && idleSecs >= IDLE_THRESHOLD_SECS && !wasIdle) {
      wasIdle = true
      win.webContents.send('user-idle', idleSecs)
      showIdlePopup()   // native window — visible even when app is minimised
    } else if (wasIdle && (idleSecs < IDLE_THRESHOLD_SECS || isOnBreak)) {
      wasIdle = false
      closeIdlePopup()
      win.webContents.send('user-active')
    }
  }, 10 * 1000)
}

// ── Hubstaff-style per-second activity tracker ───────────────────────────────
// Every second checks powerMonitor.getSystemIdleTime() === 0 (any OS-level input
// in the last second counts as active). No keylogging — only binary active/inactive.
// Emits 'activity-block' to the renderer at the end of each 600-second window
// and 'activity-tick' every 10 s for live UI updates.

const ACTIVITY_BLOCK_SECS = 600 // 10 minutes

const activityTracker = {
  _interval: null,
  employeeId: null,
  sessionId: null,
  idleTimeoutSecs: 5 * 60, // admin-configurable, default 5 min
  discardIdle: true,        // whether idle time is excluded from paid hours

  // current block accumulators
  _blockStart: null,
  _blockActiveSecs: 0,
  _blockTotalSecs: 0,
  _blockWasIdle: false,
  _consecutiveIdleSecs: 0,

  configure({ idleTimeoutMins, discardIdle }) {
    const mins = Math.max(1, Math.min(10, idleTimeoutMins || 5))
    this.idleTimeoutSecs = mins * 60
    if (discardIdle !== undefined) this.discardIdle = !!discardIdle
  },

  _resetBlock() {
    this._blockStart = new Date()
    this._blockActiveSecs = 0
    this._blockTotalSecs = 0
    this._blockWasIdle = false
    this._consecutiveIdleSecs = 0
  },

  _buildBlock() {
    const total = this._blockTotalSecs
    return {
      employee_id: this.employeeId,
      session_id: this.sessionId,
      block_start: this._blockStart.toISOString(),
      block_end: new Date().toISOString(),
      active_seconds: this._blockActiveSecs,
      total_seconds: total,
      activity_percent: total > 0
        ? Math.round((this._blockActiveSecs / total) * 1000) / 10
        : 0,
      was_idle: this._blockWasIdle,
      discard_idle: this.discardIdle,
    }
  },

  _tick() {
    // idleSecs === 0 means input happened within the last second
    const idleSecs = powerMonitor.getSystemIdleTime()
    if (idleSecs === 0) {
      this._blockActiveSecs++
      this._consecutiveIdleSecs = 0
    } else {
      this._consecutiveIdleSecs++
      if (this._consecutiveIdleSecs >= this.idleTimeoutSecs) {
        this._blockWasIdle = true
      }
    }
    this._blockTotalSecs++

    // Live update every 10 s
    if (this._blockTotalSecs % 10 === 0 && win && !win.isDestroyed()) {
      win.webContents.send('activity-tick', {
        blockActiveSecs: this._blockActiveSecs,
        blockTotalSecs: this._blockTotalSecs,
        activityPct: Math.round((this._blockActiveSecs / this._blockTotalSecs) * 100),
        wasIdle: this._blockWasIdle,
      })
    }

    // Block complete — emit and start next block
    if (this._blockTotalSecs >= ACTIVITY_BLOCK_SECS) {
      const block = this._buildBlock()
      if (win && !win.isDestroyed()) win.webContents.send('activity-block', block)
      this._resetBlock()
    }
  },

  start({ employeeId, sessionId }) {
    this.stop() // clear any previous run
    this.employeeId = employeeId
    this.sessionId  = sessionId
    this._resetBlock()
    this._interval = setInterval(() => this._tick(), 1000)
  },

  stop() {
    if (!this._interval) return null
    clearInterval(this._interval)
    this._interval = null
    const block = this._blockTotalSecs > 0 ? this._buildBlock() : null
    this._resetBlock()
    this.employeeId = null
    this.sessionId  = null
    return block
  },
}

ipcMain.handle('activity:start',     (_e, data) => { activityTracker.start(data) })
ipcMain.handle('activity:stop',      ()         => activityTracker.stop())
ipcMain.handle('activity:configure', (_e, cfg)  => { activityTracker.configure(cfg) })

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
    title: 'PharmaStaff Hub',
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
