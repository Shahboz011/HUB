const { app, BrowserWindow, shell, ipcMain, clipboard, powerMonitor, screen, nativeImage, Notification, desktopCapturer } = require('electron')
const { join } = require('path')
const { autoUpdater } = require('electron-updater')
const https = require('https')
const fs = require('fs')
const crypto = require('crypto')
const { execFile } = require('child_process')

const SUPABASE_URL = 'oewfgyiuyeetsxebowaa.supabase.co'
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ld2ZneWl1eWVldHN4ZWJvd2FhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTUzNTE3MywiZXhwIjoyMDk1MTExMTczfQ.rWCGISd8zfe-gkgVDBGaz5SCP0lVsiWhyZX4FgJ-c3A'

function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let pwd = 'PSH-'
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

function supabaseAdminPatch(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const options = {
      hostname: SUPABASE_URL,
      path,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Content-Length': Buffer.byteLength(payload),
        'Prefer': 'return=minimal',
      },
    }
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }) }
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

// IPC: update department fields (schedule, etc.) with service-role key
ipcMain.handle('update-department', async (_event, { name, fields }) => {
  const result = await supabaseAdminPatch(`/rest/v1/departments?name=eq.${encodeURIComponent(name)}`, fields)
  console.log('[update-department] status:', result.status, 'body:', JSON.stringify(result.body))
  if (result.status >= 200 && result.status < 300) return { ok: true }
  return { ok: false, error: `Status ${result.status}: ${JSON.stringify(result.body)}` }
})

// IPC: insert a transaction row with service-role key (bypasses RLS)
// Returns { ok, tx } where tx is the inserted row
ipcMain.handle('insert-transaction', async (_event, { employee_id, type, amount, note }) => {
  const result = await new Promise((resolve, reject) => {
    const payload = JSON.stringify({ employee_id, type, amount, note: note || '' })
    const options = {
      hostname: SUPABASE_URL,
      path: '/rest/v1/transactions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Content-Length': Buffer.byteLength(payload),
        'Prefer': 'return=representation',
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
  if (result.status >= 200 && result.status < 300) {
    const tx = Array.isArray(result.body) ? result.body[0] : result.body
    return { ok: true, tx }
  }
  return { ok: false, error: `Status ${result.status}: ${JSON.stringify(result.body)}` }
})

// IPC: delete a transaction row with service-role key (bypasses RLS)
ipcMain.handle('delete-transaction', async (_event, { txId }) => {
  const result = await new Promise((resolve, reject) => {
    const options = {
      hostname: SUPABASE_URL,
      path: `/rest/v1/transactions?id=eq.${txId}`,
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Prefer': 'return=minimal',
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
  if (result.status >= 200 && result.status < 300) return { ok: true }
  return { ok: false, error: `Status ${result.status}` }
})

// IPC: update a transaction row with service-role key (bypasses RLS)
ipcMain.handle('update-transaction', async (_event, { txId, fields }) => {
  const result = await supabaseAdminPatch(`/rest/v1/transactions?id=eq.${txId}`, fields)
  if (result.status >= 200 && result.status < 300) return { ok: true }
  return { ok: false, error: `Status ${result.status}: ${JSON.stringify(result.body)}` }
})

// IPC: update any profile field(s) with service-role key (bypasses RLS)
// Used for role/department changes that the anon key cannot persist
ipcMain.handle('update-member', async (_event, { userId, fields }) => {
  console.log('[update-member] Updating userId:', userId, 'fields:', JSON.stringify(fields))
  const result = await supabaseAdminPatch(`/rest/v1/profiles?id=eq.${userId}`, fields)
  console.log('[update-member] Response status:', result.status, 'body:', JSON.stringify(result.body))
  if (result.status >= 200 && result.status < 300) return { ok: true }
  return { ok: false, error: `Status ${result.status}: ${JSON.stringify(result.body)}` }
})

// IPC: get app version
ipcMain.handle('get-version', () => app.getVersion())

// ── Supabase Storage helpers ──────────────────────────────────────────────────
function supabaseStoragePut(storagePath, buffer, mimeType) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SUPABASE_URL,
      path: `/storage/v1/object/${storagePath}`,
      method: 'PUT',
      headers: {
        'Content-Type': mimeType,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Content-Length': buffer.length,
        'x-upsert': 'true',
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
    req.write(buffer)
    req.end()
  })
}

// IPC: upload avatar image to Supabase Storage (service key, bypasses RLS)
ipcMain.handle('upload-avatar', async (_event, { userId, base64, mimeType }) => {
  // Ensure the avatars bucket exists (idempotent — ignore "already exists" error)
  await supabaseAdminPost('/storage/v1/bucket', {
    id: 'avatars', name: 'avatars', public: true,
    fileSizeLimit: 5242880,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  }).catch(() => {})

  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg'
  const storagePath = `avatars/${userId}/avatar.${ext}`
  const buffer = Buffer.from(base64, 'base64')
  const result = await supabaseStoragePut(storagePath, buffer, mimeType)

  if (result.status >= 200 && result.status < 300) {
    const publicUrl = `https://${SUPABASE_URL}/storage/v1/object/public/${storagePath}`
    // Simultaneously write to local disk cache so the image shows instantly next launch
    try {
      const dir = avatarCacheDir()
      fs.mkdirSync(dir, { recursive: true })
      // Remove any previous file for this user (ext might differ)
      for (const e of ['jpg', 'png', 'webp']) {
        const old = join(dir, `${userId}.${e}`)
        if (fs.existsSync(old)) fs.unlinkSync(old)
      }
      fs.writeFileSync(join(dir, `${userId}.${ext}`), buffer)
    } catch { /* non-fatal */ }
    const dataUrl = `data:${mimeType};base64,${base64}`
    return { ok: true, url: publicUrl, dataUrl }
  }
  return { ok: false, error: `Status ${result.status}: ${JSON.stringify(result.body)}` }
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

    const options = {
      hostname: SUPABASE_URL,
      path: parsedPath,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY },
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

// IPC: fetch screenshot images as base64 data URLs using service key
ipcMain.handle('fetch-screenshot-images', async (_event, paths) => {
  return Promise.all(paths.map(path => new Promise((resolve) => {
    const options = {
      hostname: SUPABASE_URL,
      path: `/storage/v1/object/screenshots/${path}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
      },
    }
    const req = https.request(options, (res) => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        if (res.statusCode === 200) {
          const buf = Buffer.concat(chunks)
          resolve('data:image/jpeg;base64,' + buf.toString('base64'))
        } else {
          resolve(null)
        }
      })
    })
    req.on('error', () => resolve(null))
    req.end()
  })))
})

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
// Uses Win32 GetForegroundWindow + GetWindowText via PowerShell -EncodedCommand.
// Runs concurrently with desktopCapturer.getSources; never blocks the blur pipeline.
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
      '$h = [Win32]::GetForegroundWindow()',
      '$sb = New-Object System.Text.StringBuilder 512',
      '[Win32]::GetWindowText($h, $sb, 512) | Out-Null',
      '$wpid = 0',
      '[Win32]::GetWindowThreadProcessId($h, [ref]$wpid) | Out-Null',
      '$p = Get-Process -Id $wpid -ErrorAction SilentlyContinue',
      "$app = if ($p) { try { $n = $p.MainModule.FileVersionInfo.ProductName; if ($n) { $n } else { $p.ProcessName } } catch { $p.ProcessName } } else { '' }",
      '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
      "Write-Output (ConvertTo-Json @{ title = $sb.ToString(); app = $app })",
    ].join('\r\n')
    const enc = Buffer.from(ps, 'utf16le').toString('base64')
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc],
      { timeout: 5000, windowsHide: true },
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
            const { width, height } = sources[i].thumbnail.getSize()
            const raw = sources[i].thumbnail.toBitmap()       // raw RGBA, in-process only
            const blurred = blurBitmap(raw, width, height)    // obfuscate before encoding
            const safe = nativeImage.createFromBitmap(blurred, { width, height })
            resolve(safe.toJPEG(60))                          // only the blurred JPEG leaves
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

// ── Idle popup window ────────────────────────────────────────────────────────
// A native always-on-top BrowserWindow that appears even when the main app
// is minimised or in the background. Managed entirely by the main process.

const IDLE_POPUP_HTML = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  background:#0f172a;color:#e2e8f0;height:100vh;
  display:flex;align-items:center;justify-content:center;
  overflow:hidden;user-select:none;
}
.card{text-align:center;padding:28px 40px;width:100%}
.icon{font-size:38px;margin-bottom:10px}
h1{font-size:17px;font-weight:700;color:#f1f5f9;margin-bottom:6px}
p{font-size:12px;color:#94a3b8;line-height:1.6;margin-bottom:18px}
.timer{font-size:34px;font-weight:800;color:#f59e0b;margin-bottom:20px;
  font-variant-numeric:tabular-nums;letter-spacing:-0.5px}
.btn{
  background:#6366f1;color:#fff;border:none;
  padding:12px 0;border-radius:9px;width:100%;
  font-size:14px;font-weight:600;cursor:pointer;
  transition:background .12s,transform .08s;
}
.btn:hover{background:#4f46e5}
.btn:active{transform:scale(.97)}
.hint{font-size:11px;color:#475569;margin-top:10px;min-height:16px}
</style></head>
<body><div class="card">
  <div class="icon">⏸</div>
  <h1>Timer Paused</h1>
  <p>No activity detected for 1 minute.<br>Idle time is not counted as salary.</p>
  <div class="timer" id="t">0s</div>
  <button class="btn" id="btn">▶&nbsp; Continue to work?</button>
  <div class="hint" id="hint">Click anywhere 2 times to resume</div>
</div>
<script>
const {ipcRenderer}=require('electron');
let clicks=0;
const startMs=Date.now();
function fmt(s){
  const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;
  if(h>0)return h+'h '+m+'m';
  if(m>0)return m+'m '+String(sec).padStart(2,'0')+'s';
  return sec+'s';
}
setInterval(()=>{document.getElementById('t').textContent=fmt(Math.floor((Date.now()-startMs)/1000));},500);
function resume(){ipcRenderer.send('idle-popup-continue');}
document.getElementById('btn').addEventListener('click',e=>{e.stopPropagation();resume();});
document.addEventListener('click',()=>{
  clicks++;
  if(clicks>=2){resume();}
  else{document.getElementById('hint').textContent='Click '+(2-clicks)+' more time to resume';}
});
</script></body></html>`

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
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  })
  idlePopupWin.setAlwaysOnTop(true, 'screen-saver')
  idlePopupWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(IDLE_POPUP_HTML))
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

    if (isTracking && idleSecs >= IDLE_THRESHOLD_SECS && !wasIdle) {
      wasIdle = true
      win.webContents.send('user-idle', idleSecs)
      showIdlePopup()   // native window — visible even when app is minimised
    } else if (wasIdle && idleSecs < 30) {
      wasIdle = false
      closeIdlePopup()
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
