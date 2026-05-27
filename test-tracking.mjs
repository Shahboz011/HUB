/**
 * test-tracking.mjs
 * Isolated simulation of the SCC timer, idle-detection, salary, and screenshot logic.
 * Mirrors the exact algorithms in EmployeeView.jsx — no React, no Electron, no network.
 *
 * Run:  node test-tracking.mjs
 *
 * Scenario
 * ────────
 * T=0s   Clock-in
 * T=0s–60s   Active  (Minute 1 — mouse clicks present)
 * T=60s–120s Idle    (Minute 2 — no mouse/keyboard)
 * T=120s–180s Active (Minute 3 — mouse clicks resume)
 * T=180s Clock-out
 */

// ── Constants (match EmployeeView.jsx) ───────────────────────────────────────
const HOURLY_RATE        = 10          // $/hr — easy round numbers for manual checking
const SCREENSHOT_INTERVAL = 300        // 5 min in seconds (real app uses 5 * 60 * 1000 ms)
const ACTIVITY_DISPLAY_THRESHOLD = 30  // elapsed > 30s before activity% is shown

// ── State mirrors (refs in EmployeeView) ─────────────────────────────────────
let totalIdleSecs  = 0      // totalIdleRef.current
let idleStartAt    = null   // idleStartAtRef.current  (simulated ms timestamp)
let elapsed        = 0      // seconds since clock-in (driven by setInterval tick)
let clockInTime    = null   // ms timestamp of clock-in (activeSession.started_at)

// ── Test result tracking ──────────────────────────────────────────────────────
let passed = 0
let failed = 0
const results = []

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(v) {
  return `$${v.toFixed(4)}`
}
function assert(label, actual, expected, tolerance = 0.001) {
  const ok = Math.abs(actual - expected) <= tolerance
  const icon = ok ? '✓' : '✗'
  if (ok) passed++; else failed++
  results.push({ ok, label, actual, expected })
  console.log(`  ${icon}  ${label}`)
  if (!ok) console.log(`       expected ${expected}, got ${actual}`)
}
function assertBool(label, actual, expected) {
  const ok = actual === expected
  const icon = ok ? '✓' : '✗'
  if (ok) passed++; else failed++
  results.push({ ok, label, actual, expected })
  console.log(`  ${icon}  ${label}`)
  if (!ok) console.log(`       expected ${expected}, got ${actual}`)
}
function section(title) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`  ${title}`)
  console.log('─'.repeat(60))
}
function tick(nowMs) {
  elapsed = (nowMs - clockInTime) / 1000
}

// ── Core salary calculation (mirrors lines 215–220 of EmployeeView.jsx) ──────
function snapshot(nowMs) {
  const currentIdleContrib = idleStartAt !== null
    ? (nowMs - idleStartAt) / 1000
    : 0
  const effectiveIdleSecs = totalIdleSecs + currentIdleContrib
  const activeSecs        = Math.max(0, elapsed - effectiveIdleSecs)
  const activityPct       = elapsed > ACTIVITY_DISPLAY_THRESHOLD
    ? Math.round((activeSecs / elapsed) * 100)
    : 100
  const sessionEarned     = (activeSecs / 3600) * HOURLY_RATE
  return { elapsed, totalIdleSecs, currentIdleContrib, effectiveIdleSecs, activeSecs, activityPct, sessionEarned }
}

// ── Clock-out calculation (mirrors clockOut() in EmployeeView.jsx) ────────────
function clockOut(nowMs) {
  if (idleStartAt !== null) {
    totalIdleSecs += (nowMs - idleStartAt) / 1000
    idleStartAt = null
  }
  const totalElapsedSecs = (nowMs - clockInTime) / 1000
  const activeSecs       = Math.max(0, totalElapsedSecs - totalIdleSecs)
  const durationHours    = activeSecs / 3600
  return { totalElapsedSecs, activeSecs, durationHours, earned: durationHours * HOURLY_RATE }
}

// ── onUserIdle (mirrors the IPC handler in EmployeeView.jsx line 85–89) ───────
function onUserIdle(nowMs, idledForSecs) {
  // Electron reports how long user has ALREADY been idle, so back-date the start
  const startAt = nowMs - idledForSecs * 1000
  idleStartAt = startAt
}

// ── onUserActive (mirrors IPC handler in EmployeeView.jsx line 91–98) ─────────
function onUserActive(nowMs) {
  if (idleStartAt !== null) {
    totalIdleSecs += (nowMs - idleStartAt) / 1000
    idleStartAt = null
  }
}

// ── Screenshot trigger simulator ──────────────────────────────────────────────
function buildScreenshotSchedule(clockInMs, sessionLengthSecs) {
  const shots = []
  // First shot fires immediately on clock-in (capture() called before setInterval)
  shots.push(0)
  // Then every SCREENSHOT_INTERVAL seconds
  for (let t = SCREENSHOT_INTERVAL; t < sessionLengthSecs; t += SCREENSHOT_INTERVAL) {
    shots.push(t)
  }
  return shots
}

// ═════════════════════════════════════════════════════════════════════════════
//  SIMULATION
// ═════════════════════════════════════════════════════════════════════════════

// Use a fake epoch so numbers stay readable (T=0 → ms=0)
const T0 = 0   // clock-in timestamp

clockInTime   = T0
totalIdleSecs = 0
idleStartAt   = null
elapsed       = 0

const SESSION_LENGTH = 180  // 3 minutes total

// Build screenshot schedule
const screenshotFires = buildScreenshotSchedule(T0, SESSION_LENGTH)

// ─── Event timeline ──────────────────────────────────────────────────────────
// T=0     Clock-in
// T=0–60  Active (Minute 1)
// T=60    Idle event fires — user has been idle for ~0 s (just went idle)
// T=120   Active event fires — user moved mouse
// T=120–180 Active (Minute 3)
// T=180   Clock-out

const IDLE_START_T   = 60   // seconds into session when idle begins
const ACTIVE_AGAIN_T = 120  // seconds when user becomes active again
const IDLE_DURATION  = ACTIVE_AGAIN_T - IDLE_START_T  // 60 seconds

// ═════════════════════════════════════════════════════════════════════════════
//  MINUTE 1: T=0 to T=60  (active)
// ═════════════════════════════════════════════════════════════════════════════
section('MINUTE 1  T=0–60s  (mouse active)')

// Advance to end of minute 1
tick(T0 + 60_000)
const snap1 = snapshot(T0 + 60_000)

console.log(`\n  State at T=60s:`)
console.log(`    elapsed          = ${snap1.elapsed}s`)
console.log(`    totalIdleSecs    = ${snap1.totalIdleSecs}s`)
console.log(`    currentIdleContrib = ${snap1.currentIdleContrib}s`)
console.log(`    activeSecs       = ${snap1.activeSecs}s`)
console.log(`    activityPct      = ${snap1.activityPct}%`)
console.log(`    sessionEarned    = ${fmt(snap1.sessionEarned)}`)
console.log()

assert('elapsed = 60s',          snap1.elapsed,          60)
assert('totalIdleSecs = 0',      snap1.totalIdleSecs,    0)
assert('activeSecs = 60s',       snap1.activeSecs,       60)
assert('activityPct = 100%',     snap1.activityPct,      100)
assert(`sessionEarned = ${fmt(60/3600 * HOURLY_RATE)}`, snap1.sessionEarned, (60/3600) * HOURLY_RATE)

// Verify screenshot fired at T=0 only (< 300s mark)
const ssBeforeMin1End = screenshotFires.filter(t => t <= 60)
assertBool('screenshot fired once (at T=0s)',  ssBeforeMin1End.length === 1, true)

// ═════════════════════════════════════════════════════════════════════════════
//  IDLE EVENT fires at T=60s: user went idle
// ═════════════════════════════════════════════════════════════════════════════
section('IDLE EVENT  T=60s  (no mouse/keyboard detected)')

// Electron fires onUserIdle after its threshold (~30s inactivity by default).
// The event carries how long idle has already been: here 0s (fired right at boundary).
onUserIdle(T0 + 60_000, 0)
console.log(`  idleStartAt set to T=60s  (${idleStartAt}ms)`)
assertBool('idleStartAt is not null',  idleStartAt !== null, true)

// ═════════════════════════════════════════════════════════════════════════════
//  MINUTE 2: T=60 to T=120  (idle — no salary should accumulate)
// ═════════════════════════════════════════════════════════════════════════════
section('MINUTE 2  T=60–120s  (idle — salary must NOT grow)')

// Check mid-idle at T=90s
tick(T0 + 90_000)
const snapMidIdle = snapshot(T0 + 90_000)

console.log(`\n  State at T=90s (mid-idle):`)
console.log(`    elapsed            = ${snapMidIdle.elapsed}s`)
console.log(`    totalIdleSecs      = ${snapMidIdle.totalIdleSecs}s  (committed idle)`)
console.log(`    currentIdleContrib = ${snapMidIdle.currentIdleContrib}s  (in-progress idle)`)
console.log(`    effectiveIdleSecs  = ${snapMidIdle.effectiveIdleSecs}s`)
console.log(`    activeSecs         = ${snapMidIdle.activeSecs}s  ← must stay at 60`)
console.log(`    sessionEarned      = ${fmt(snapMidIdle.sessionEarned)}  ← must stay frozen`)
console.log()

assert('elapsed = 90s',                snapMidIdle.elapsed,            90)
assert('totalIdleSecs still = 0',      snapMidIdle.totalIdleSecs,      0)   // not committed yet
assert('currentIdleContrib = 30s',     snapMidIdle.currentIdleContrib, 30)  // 90-60=30s in-progress
assert('effectiveIdleSecs = 30s',      snapMidIdle.effectiveIdleSecs,  30)
assert('activeSecs frozen at 60s',     snapMidIdle.activeSecs,         60)
assert(`sessionEarned frozen at ${fmt((60/3600)*HOURLY_RATE)}`, snapMidIdle.sessionEarned, (60/3600)*HOURLY_RATE)

// Check end of idle at T=120s (just before active event)
tick(T0 + 120_000)
const snapEndIdle = snapshot(T0 + 120_000)

console.log(`  State at T=120s (end of idle, before active event):`)
console.log(`    currentIdleContrib = ${snapEndIdle.currentIdleContrib}s`)
console.log(`    activeSecs         = ${snapEndIdle.activeSecs}s  ← must still be 60`)
console.log()

assert('currentIdleContrib = 60s at T=120',  snapEndIdle.currentIdleContrib, 60)
assert('activeSecs still frozen at 60s',      snapEndIdle.activeSecs,         60)
assert(`sessionEarned still ${fmt((60/3600)*HOURLY_RATE)}`, snapEndIdle.sessionEarned, (60/3600)*HOURLY_RATE)

// ═════════════════════════════════════════════════════════════════════════════
//  ACTIVE EVENT fires at T=120s: user moves mouse
// ═════════════════════════════════════════════════════════════════════════════
section('ACTIVE EVENT  T=120s  (mouse detected — idle committed)')

onUserActive(T0 + 120_000)

console.log(`  After onUserActive():`)
console.log(`    totalIdleSecs = ${totalIdleSecs}s  (should be 60)`)
console.log(`    idleStartAt   = ${idleStartAt}   (should be null)`)
console.log()

assert('totalIdleSecs committed = 60s',  totalIdleSecs, 60)
assertBool('idleStartAt reset to null',  idleStartAt === null, true)

// ═════════════════════════════════════════════════════════════════════════════
//  MINUTE 3: T=120 to T=180  (active again — salary resumes)
// ═════════════════════════════════════════════════════════════════════════════
section('MINUTE 3  T=120–180s  (mouse active — salary resumes)')

// Check mid-minute3 at T=150s
tick(T0 + 150_000)
const snapMid3 = snapshot(T0 + 150_000)

console.log(`\n  State at T=150s (mid-Minute 3):`)
console.log(`    elapsed           = ${snapMid3.elapsed}s`)
console.log(`    totalIdleSecs     = ${snapMid3.totalIdleSecs}s`)
console.log(`    currentIdleContrib = ${snapMid3.currentIdleContrib}s`)
console.log(`    activeSecs        = ${snapMid3.activeSecs}s  ← 150-60=90`)
console.log(`    activityPct       = ${snapMid3.activityPct}%  ← 90/150=60%`)
console.log(`    sessionEarned     = ${fmt(snapMid3.sessionEarned)}`)
console.log()

assert('elapsed = 150s',              snapMid3.elapsed,          150)
assert('totalIdleSecs = 60s',         snapMid3.totalIdleSecs,    60)
assert('currentIdleContrib = 0',      snapMid3.currentIdleContrib, 0)
assert('activeSecs = 90s',            snapMid3.activeSecs,        90)   // 150-60
assert('activityPct = 60%',           snapMid3.activityPct,       60)   // 90/150
assert(`sessionEarned = ${fmt((90/3600)*HOURLY_RATE)}`, snapMid3.sessionEarned, (90/3600)*HOURLY_RATE)

// Check end of Minute 3 at T=180s (just before clock-out)
tick(T0 + 180_000)
const snapEnd = snapshot(T0 + 180_000)

console.log(`  State at T=180s (end of session, before clock-out):`)
console.log(`    activeSecs    = ${snapEnd.activeSecs}s  ← 180-60=120`)
console.log(`    activityPct   = ${snapEnd.activityPct}%  ← 120/180=67%`)
console.log(`    sessionEarned = ${fmt(snapEnd.sessionEarned)}`)
console.log()

assert('activeSecs = 120s at T=180',   snapEnd.activeSecs,    120)   // 180-60
assert('activityPct = 67% at T=180',   snapEnd.activityPct,   67)
assert(`sessionEarned = ${fmt((120/3600)*HOURLY_RATE)}`, snapEnd.sessionEarned, (120/3600)*HOURLY_RATE)

// ═════════════════════════════════════════════════════════════════════════════
//  CLOCK-OUT at T=180s
// ═════════════════════════════════════════════════════════════════════════════
section('CLOCK-OUT  T=180s')

const result = clockOut(T0 + 180_000)

console.log(`\n  clockOut() result:`)
console.log(`    totalElapsedSecs = ${result.totalElapsedSecs}s`)
console.log(`    activeSecs       = ${result.activeSecs}s  ← only 2 active minutes`)
console.log(`    durationHours    = ${result.durationHours.toFixed(6)}h`)
console.log(`    earned           = ${fmt(result.earned)}`)
console.log()

assert('clockOut totalElapsedSecs = 180',   result.totalElapsedSecs, 180)
assert('clockOut activeSecs = 120',         result.activeSecs,       120)
assert(`clockOut durationHours = ${(120/3600).toFixed(6)}`, result.durationHours, 120/3600)
assert(`clockOut earned = ${fmt((120/3600)*HOURLY_RATE)}`, result.earned, (120/3600)*HOURLY_RATE)

// ═════════════════════════════════════════════════════════════════════════════
//  SCREENSHOT SCHEDULE
// ═════════════════════════════════════════════════════════════════════════════
section('SCREENSHOT SCHEDULE  (every 300s while clocked in)')

console.log(`\n  Session length: ${SESSION_LENGTH}s  |  Interval: ${SCREENSHOT_INTERVAL}s`)
console.log(`  Expected fire times: T=0s only (session < 300s)`)
console.log(`  Actual schedule: ${screenshotFires.map(t => `T=${t}s`).join(', ')}`)
console.log()

assertBool('exactly 1 screenshot in a 3-min session',  screenshotFires.length === 1, true)
assert('screenshot fires at T=0s',                     screenshotFires[0],           0)

// Bonus: verify schedule for a 12-minute session
const longSessionShots = buildScreenshotSchedule(T0, 720)
console.log(`  12-min session schedule: ${longSessionShots.map(t => `T=${t}s`).join(', ')}`)
assertBool('12-min session → 3 screenshots (T=0,300,600)',  longSessionShots.length === 3, true)

// ═════════════════════════════════════════════════════════════════════════════
//  EDGE CASE: clock-out while STILL IDLE (idle never committed via onUserActive)
// ═════════════════════════════════════════════════════════════════════════════
section('EDGE CASE  Clock-out during active idle period')

// Reset state
clockInTime   = T0
totalIdleSecs = 0
idleStartAt   = null
elapsed       = 0

// User clocks in, works 30s, goes idle, never comes back — admin closes session at T=90s
tick(T0 + 30_000)
onUserIdle(T0 + 30_000, 0)    // idle starts at T=30s
// NO onUserActive — clockOut must finalize the idle internally

const edgeResult = clockOut(T0 + 90_000)

console.log(`\n  Clocked in T=0, active T=0–30s, idle T=30–90s, clockOut T=90s`)
console.log(`    totalElapsedSecs = ${edgeResult.totalElapsedSecs}s`)
console.log(`    activeSecs       = ${edgeResult.activeSecs}s  ← must be 30, not 90`)
console.log(`    earned           = ${fmt(edgeResult.earned)}`)
console.log()

assert('edge: totalElapsedSecs = 90',   edgeResult.totalElapsedSecs, 90)
assert('edge: activeSecs = 30',         edgeResult.activeSecs,       30)
assert(`edge: earned = ${fmt((30/3600)*HOURLY_RATE)}`, edgeResult.earned, (30/3600)*HOURLY_RATE)

// ═════════════════════════════════════════════════════════════════════════════
//  SUMMARY
// ═════════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(60)}`)
console.log(`  RESULTS  ${passed} passed  /  ${passed + failed} total  ${failed > 0 ? `(${failed} FAILED)` : '✓ ALL PASS'}`)
console.log('═'.repeat(60))

if (failed > 0) {
  console.log('\n  Failed assertions:')
  results.filter(r => !r.ok).forEach(r => {
    console.log(`    ✗  ${r.label}`)
    console.log(`       expected ${r.expected}, got ${r.actual}`)
  })
  process.exit(1)
}
