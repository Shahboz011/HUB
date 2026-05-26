import { useState, useEffect, useRef } from 'react'
import {
  Monitor, LayoutDashboard, UserCircle2, HelpCircle, LogOut,
  Play, StopCircle, Info, ChevronDown, MessageCircle, Activity,
  Coffee, Utensils,
} from 'lucide-react'
import { supabase } from '../lib/supabase'

function pad(n) { return String(Math.floor(n)).padStart(2, '0') }

const NAV = [
  { id: 'dashboard', label: 'Dashboard',   icon: <LayoutDashboard size={16} /> },
  { id: 'profile',   label: 'My Profile',  icon: <UserCircle2 size={16} /> },
  { id: 'faq',       label: 'Help & FAQ',  icon: <HelpCircle size={16} /> },
]

export default function EmployeeView({ profile, onSignOut }) {
  const [fresh, setFresh] = useState(profile)
  const [activeSession, setActiveSession] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [loading, setLoading] = useState(true)
  const [clocking, setClocking] = useState(false)
  const [activeNav, setActiveNav] = useState('dashboard')
  const [appVersion, setAppVersion] = useState('')
  const [screenshotStatus, setScreenshotStatus] = useState(null) // null | 'ok' | string(error)

  // Activity tracking
  const [isIdle, setIsIdle] = useState(false)
  const [idleStartAt, setIdleStartAt] = useState(null) // ms timestamp when idle began
  const totalIdleRef = useRef(0)  // accumulated idle seconds this session
  const idleStartAtRef = useRef(null) // mirror of idleStartAt for use in async callbacks
  const activityBcRef = useRef(null) // supabase broadcast channel
  const justRestoredRef = useRef(false) // true only during the first effect fire after a session restore
  const cursorSamplesRef = useRef([])   // [{x, y, t}] — rolling 2-min window of global cursor positions
  const suspicionFiredRef = useRef(false)
  const lastIdleSecsRef = useRef(0)     // most recent powerMonitor reading
  const trackingStateRef = useRef({ isIdle: false, sessionId: null, employeeId: null })

  const [breakStatus, setBreakStatus] = useState(null) // null | 'break' | 'restroom' | 'lunch'
  const [breakStartAt, setBreakStartAt] = useState(null)
  const breakStartAtRef = useRef(null)
  const totalBreakRef = useRef(0)
  const totalUnpaidBreakRef = useRef(0)
  const [breakCount, setBreakCount] = useState(0)  // # of 20-min paid breaks used this session
  const breakCountRef = useRef(0)
  const usedRestRoomSecsRef = useRef(0)             // cumulative restroom seconds used
  const currentBreakAllowanceRef = useRef(0)        // paid seconds available for the current break
  const [currentBreakAllowance, setCurrentBreakAllowance] = useState(0)

  useEffect(() => {
    window.electronAPI?.getVersion?.().then(v => { if (v) setAppVersion(v) })
  }, [])

  useEffect(() => {
    if (!profile?.id) return

    Promise.all([
      supabase.from('profiles').select('*').eq('id', profile.id).single(),
      supabase.from('work_sessions').select('*').eq('employee_id', profile.id).is('ended_at', null).maybeSingle(),
    ]).then(([{ data: p }, { data: s }]) => {
      if (p) setFresh(p)
      if (s) {
        justRestoredRef.current = true
        totalIdleRef.current = Number(s.accumulated_idle_secs) || 0
        totalBreakRef.current = Number(s.accumulated_break_secs) || 0
        totalUnpaidBreakRef.current = Number(s.accumulated_unpaid_break_secs) || 0
        breakCountRef.current = Number(s.break_count) || 0
        setBreakCount(Number(s.break_count) || 0)
        usedRestRoomSecsRef.current = Number(s.used_restroom_secs) || 0
        if (s.break_status) {
          setBreakStatus(s.break_status)
          const allowance = Number(s.current_break_allowance_secs) || 0
          currentBreakAllowanceRef.current = allowance
          setCurrentBreakAllowance(allowance)
          if (s.break_started_at) {
            const bStart = new Date(s.break_started_at).getTime()
            breakStartAtRef.current = bStart
            setBreakStartAt(bStart)
          }
        }
        setActiveSession(s)
        setElapsed(Math.floor((Date.now() - new Date(s.started_at).getTime()) / 1000))
        window.electronAPI?.setTracking?.(true)
      }
      setLoading(false)
    })

    const profileSub = supabase
      .channel(`profile-${profile.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${profile.id}` },
        ({ new: row }) => setFresh(row))
      .subscribe()

    const sessionSub = supabase
      .channel(`sessions-${profile.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'work_sessions', filter: `employee_id=eq.${profile.id}` },
        ({ new: row }) => {
          if (row.ended_at) { setActiveSession(null); setElapsed(0) }
        })
      .subscribe()

    return () => {
      supabase.removeChannel(profileSub)
      supabase.removeChannel(sessionSub)
    }
  }, [profile?.id])

  useEffect(() => {
    if (!activeSession) return
    const id = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [activeSession])

  // Idle event listeners from main process
  useEffect(() => {
    if (!window.electronAPI) return
    window.electronAPI.onUserIdle?.((secs) => {
      const startAt = Date.now() - secs * 1000
      idleStartAtRef.current = startAt
      setIdleStartAt(startAt)
      setIsIdle(true)
    })
    window.electronAPI.onUserActive?.(() => {
      if (idleStartAtRef.current !== null) {
        totalIdleRef.current += (Date.now() - idleStartAtRef.current) / 1000
        idleStartAtRef.current = null
      }
      setIdleStartAt(null)
      setIsIdle(false)
    })
  }, [])

  // Keep trackingStateRef current so the [] cursor listener can read live values without stale closures
  useEffect(() => {
    trackingStateRef.current = {
      isIdle,
      sessionId: activeSession?.id ?? null,
      employeeId: fresh?.id ?? null,
    }
  }, [isIdle, activeSession?.id, fresh?.id])

  // Macro / virtual-clicker detection — cross-check powerMonitor against global cursor variance
  useEffect(() => {
    if (!window.electronAPI) return

    const VARIANCE_THRESHOLD = 9    // px² — within a ~3px radius; any natural hand movement exceeds this
    const WINDOW_MS = 2 * 60 * 1000 // rolling 2-minute sample window
    const MIN_SAMPLES = 12           // 12 × 10 s = 2 min of data required before judging
    const OS_IDLE_SECS = 60          // mirrors IDLE_THRESHOLD_SECS in main/index.js

    // Track the latest powerMonitor reading so we can cross-check inside the cursor handler
    window.electronAPI.onIdleTick?.((secs) => {
      lastIdleSecsRef.current = secs
    })

    window.electronAPI.onCursorSample?.(({ x, y }) => {
      const now = Date.now()
      cursorSamplesRef.current.push({ x, y, t: now })
      cursorSamplesRef.current = cursorSamplesRef.current.filter(s => now - s.t <= WINDOW_MS)

      const { isIdle, sessionId, employeeId } = trackingStateRef.current

      // While already idle (any cause) reset the flag so detection can re-arm after they resume
      if (!sessionId || isIdle) { suspicionFiredRef.current = false; return }

      // If powerMonitor itself already considers the user idle, no need to double-flag
      if (lastIdleSecsRef.current >= OS_IDLE_SECS) return

      const samples = cursorSamplesRef.current
      if (samples.length < MIN_SAMPLES) return

      // Compute combined x+y population variance over the window
      const xMean = samples.reduce((s, p) => s + p.x, 0) / samples.length
      const yMean = samples.reduce((s, p) => s + p.y, 0) / samples.length
      const variance =
        samples.reduce((s, p) => s + (p.x - xMean) ** 2 + (p.y - yMean) ** 2, 0) / samples.length

      if (variance < VARIANCE_THRESHOLD && !suspicionFiredRef.current) {
        suspicionFiredRef.current = true
        // Force the session into idle — the existing idle persist effect handles the DB write
        const startAt = Date.now()
        idleStartAtRef.current = startAt
        setIdleStartAt(startAt)
        setIsIdle(true)
        // Log the flag for admin review
        supabase.from('activity_suspicions').insert({
          employee_id: employeeId,
          session_id: sessionId,
          reason: 'low_mouse_variance',
          details: { variance: Math.round(variance * 100) / 100, sample_count: samples.length },
        }).then(() => {})
      } else if (variance >= VARIANCE_THRESHOLD) {
        suspicionFiredRef.current = false
      }
    })
  }, [])

  // Screenshot capture — every 5 minutes while clocked in
  useEffect(() => {
    if (!activeSession || !window.electronAPI?.captureScreen) return
    async function capture() {
      try {
        const result = await window.electronAPI.captureScreen()
        if (!result?.ok) {
          setScreenshotStatus('capture_err:' + (result?.error || 'null_result'))
          return
        }
        // All screens in this batch share the same taken_at so the admin can
        // correlate which captures belong to the same 5-minute milestone.
        const takenAt = new Date().toISOString()
        const ts = Date.now()
        let lastError = null
        for (const { index, dataUrl } of result.screens) {
          const base64 = dataUrl.split(',')[1]
          const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
          const filename = `${profile.id}/${ts}_screen${index}.jpg`
          const { error: uploadErr } = await supabase.storage
            .from('screenshots').upload(filename, bytes, { contentType: 'image/jpeg' })
          if (uploadErr) { lastError = 'upload_err:' + uploadErr.message; continue }
          const { error: insertErr } = await supabase.from('screenshots')
            .insert({ employee_id: profile.id, path: filename, taken_at: takenAt, active_app: result.active_app || '', window_title: result.window_title || '' })
          if (insertErr) lastError = 'insert_err:' + insertErr.message
        }
        setScreenshotStatus(lastError ?? 'ok')
      } catch (e) {
        setScreenshotStatus('exception:' + (e?.message || 'unknown'))
      }
    }
    capture()
    const id = setInterval(capture, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [activeSession?.id])

  // Supabase broadcast channel for admin visibility (set up when clocked in)
  useEffect(() => {
    if (!activeSession || !fresh.id) return
    const ch = supabase.channel('employee-activity')
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          ch.send({ type: 'broadcast', event: 'status',
            payload: { employee_id: fresh.id, is_idle: false, break_status: null, ts: Date.now() } })
        }
      })
    activityBcRef.current = ch
    return () => { supabase.removeChannel(ch); activityBcRef.current = null }
  }, [activeSession?.id, fresh.id])

  // Re-broadcast whenever idle state changes so admin sees it immediately
  useEffect(() => {
    if (!activityBcRef.current || !fresh.id || !activeSession) return
    activityBcRef.current.send({ type: 'broadcast', event: 'status',
      payload: { employee_id: fresh.id, is_idle: isIdle, break_status: breakStatus, ts: Date.now() } }).catch(() => {})
  }, [isIdle, breakStatus, activeSession?.id, fresh.id])

  // Persist idle state to DB so admin dashboard survives refresh
  useEffect(() => {
    if (!activeSession?.id) return
    // When a session is restored on mount the DB already holds the correct state —
    // skip this one fire to avoid overwriting it with zeroed-out local values.
    if (justRestoredRef.current) {
      justRestoredRef.current = false
      return
    }
    if (isIdle) {
      const startIso = idleStartAt ? new Date(idleStartAt).toISOString() : new Date().toISOString()
      supabase.from('work_sessions')
        .update({ is_idle: true, idle_started_at: startIso })
        .eq('id', activeSession.id)
        .then(() => {})
    } else {
      supabase.from('work_sessions')
        .update({ is_idle: false, idle_started_at: null, accumulated_idle_secs: totalIdleRef.current })
        .eq('id', activeSession.id)
        .then(() => {})
    }
  }, [isIdle, activeSession?.id])

  async function clockIn() {
    if (activeSession) return // guard against double-tap
    totalIdleRef.current = 0
    idleStartAtRef.current = null
    setIdleStartAt(null)
    setIsIdle(false)
    window.electronAPI?.setTracking?.(true)
    setClocking(true)
    const { data, error } = await supabase
      .from('work_sessions').insert({ employee_id: fresh.id }).select().single()
    if (!error) { setActiveSession(data); setElapsed(0) }
    else window.electronAPI?.setTracking?.(false) // revert if insert failed
    setClocking(false)
  }

  async function clockOut() {
    // Finalize any in-progress break before closing the session
    let finalBreakSecs = totalBreakRef.current
    let finalUnpaidSecs = totalUnpaidBreakRef.current
    let finalBreakCount = breakCountRef.current
    let finalRestRoomSecs = usedRestRoomSecsRef.current
    if (breakStartAtRef.current !== null) {
      const dur = (Date.now() - breakStartAtRef.current) / 1000
      finalBreakSecs += dur
      finalUnpaidSecs += Math.max(0, dur - currentBreakAllowanceRef.current)
      if (breakStatus === 'break') finalBreakCount += 1
      else if (breakStatus === 'restroom') finalRestRoomSecs += dur
      breakStartAtRef.current = null
    }
    currentBreakAllowanceRef.current = 0
    setCurrentBreakAllowance(0)
    setBreakStartAt(null)
    setBreakStatus(null)
    setClocking(true)
    window.electronAPI?.setTracking?.(false)
    // Save final break data so admin can see it; then clock out server-side
    await supabase.from('work_sessions').update({
      break_status: null, break_started_at: null, current_break_allowance_secs: 0,
      accumulated_break_secs: finalBreakSecs,
      accumulated_unpaid_break_secs: finalUnpaidSecs,
      break_count: finalBreakCount,
      used_restroom_secs: finalRestRoomSecs,
    }).eq('id', activeSession.id)
    const { data: durationHours } = await supabase.rpc('clock_out_session', {
      p_session_id: activeSession.id,
    })
    setFresh(p => ({ ...p, hours_worked: Number(p.hours_worked) + (Number(durationHours) || 0) }))
    setActiveSession(null)
    setElapsed(0)
    totalIdleRef.current = 0
    idleStartAtRef.current = null
    setIdleStartAt(null)
    setIsIdle(false)
    totalBreakRef.current = 0
    totalUnpaidBreakRef.current = 0
    breakCountRef.current = 0
    setBreakCount(0)
    usedRestRoomSecsRef.current = 0
    setClocking(false)
  }

  function handleContinueWorking() {
    // Finalize idle period immediately on button click (don't wait for IPC user-active)
    if (idleStartAtRef.current !== null) {
      totalIdleRef.current += (Date.now() - idleStartAtRef.current) / 1000
      idleStartAtRef.current = null
    }
    setIdleStartAt(null)
    setIsIdle(false)
  }

  function startBreak(type) {
    if (!activeSession || breakStatus) return
    // Compute paid allowance for this break type:
    // - restroom: 5 min per completed elapsed hour, minus already-used restroom time
    // - break: 20 min flat if fewer than 2 paid breaks have been used this session
    // - lunch: no paid window defined yet
    let allowance = 0
    if (type === 'restroom') {
      const totalAllowanceSecs = Math.floor(elapsed / 3600) * 5 * 60
      allowance = Math.max(0, totalAllowanceSecs - usedRestRoomSecsRef.current)
    } else if (type === 'break') {
      allowance = breakCountRef.current < 2 ? 20 * 60 : 0
    }
    const now = Date.now()
    currentBreakAllowanceRef.current = allowance
    setCurrentBreakAllowance(allowance)
    breakStartAtRef.current = now
    setBreakStartAt(now)
    setBreakStatus(type)
    supabase.from('work_sessions')
      .update({
        break_status: type,
        break_started_at: new Date(now).toISOString(),
        current_break_allowance_secs: allowance,
      })
      .eq('id', activeSession.id)
      .then(() => {})
  }

  function endBreak() {
    if (!breakStatus) return
    let duration = 0
    if (breakStartAtRef.current !== null) {
      duration = (Date.now() - breakStartAtRef.current) / 1000
      totalBreakRef.current += duration
      breakStartAtRef.current = null
    }
    const unpaid = Math.max(0, duration - currentBreakAllowanceRef.current)
    totalUnpaidBreakRef.current += unpaid

    const prevStatus = breakStatus
    if (prevStatus === 'restroom') {
      usedRestRoomSecsRef.current += duration
    } else if (prevStatus === 'break') {
      breakCountRef.current += 1
      setBreakCount(breakCountRef.current)
    }

    currentBreakAllowanceRef.current = 0
    setCurrentBreakAllowance(0)
    setBreakStartAt(null)
    setBreakStatus(null)

    supabase.from('work_sessions')
      .update({
        break_status: null,
        break_started_at: null,
        current_break_allowance_secs: 0,
        accumulated_break_secs: totalBreakRef.current,
        accumulated_unpaid_break_secs: totalUnpaidBreakRef.current,
        break_count: breakCountRef.current,
        used_restroom_secs: usedRestRoomSecsRef.current,
      })
      .eq('id', activeSession.id)
      .then(() => {})
  }

  if (loading) return <div className="ev-loading">Loading…</div>

  const rate = Number(fresh.hourly_rate) || 0
  const totalHours = Number(fresh.hours_worked) || 0

  // Activity-adjusted values (idle time excluded)
  const currentIdleContrib = idleStartAtRef.current !== null
    ? (Date.now() - idleStartAtRef.current) / 1000 : 0
  const effectiveIdleSecs = totalIdleRef.current + currentIdleContrib
  const activeSecs = Math.max(0, elapsed - effectiveIdleSecs)
  const activityPct = elapsed > 30 ? Math.round((activeSecs / elapsed) * 100) : 100

  const h = Math.floor(activeSecs / 3600)
  const m = Math.floor((activeSecs % 3600) / 60)
  const s = Math.floor(activeSecs % 60)

  const initials = fresh.full_name
    ? fresh.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?'

  return (
    <div className="ev-shell">
      {/* ── Sidebar ── */}
      <aside className="ev-sidebar">
        {/* Brand */}
        <div className="ev-sidebar-brand">
          <div className="logo-mark" style={{ width: 28, height: 28 }}>
            <Monitor size={14} />
          </div>
          <span className="ev-sidebar-brand-name">SCC</span>
        </div>

        {/* User card */}
        <div className="ev-sidebar-user">
          <div className="ev-sidebar-avatar">{initials}</div>
          <div className="ev-sidebar-userinfo">
            <div className="ev-sidebar-name">{fresh.full_name}</div>
            {fresh.department && (
              <div className="ev-sidebar-dept">{fresh.department}</div>
            )}
          </div>
        </div>

        {/* Status pill */}
        <div className={`ev-sidebar-status ${
          !activeSession ? 'ev-status-off'
          : breakStatus ? 'ev-status-break'
          : isIdle ? 'ev-status-idle'
          : 'ev-status-live'
        }`}>
          <span className={
            !activeSession ? 'counter-dot-off'
            : breakStatus ? 'counter-dot-break'
            : isIdle ? 'counter-dot-idle'
            : 'counter-dot'
          } />
          {!activeSession ? 'Available'
            : breakStatus === 'break' ? 'On Break'
            : breakStatus === 'restroom' ? 'Rest Room'
            : breakStatus === 'lunch' ? 'Lunch Break'
            : isIdle ? 'Idle — paused'
            : 'Working'}
        </div>

        {/* Nav */}
        <nav className="ev-nav">
          {NAV.map(item => (
            <button
              key={item.id}
              className={`ev-nav-item ${activeNav === item.id ? 'ev-nav-active' : ''}`}
              onClick={() => setActiveNav(item.id)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        {screenshotStatus && (
          <div className={`ev-ss-status ${screenshotStatus === 'ok' ? 'ev-ss-ok' : 'ev-ss-err'}`} title={screenshotStatus}>
            {screenshotStatus === 'ok' ? '📷 Screenshot OK' : '⚠ Screenshot: ' + screenshotStatus}
          </div>
        )}
        {appVersion && <div className="ev-version">v{appVersion}</div>}

        {/* Sign out */}
        <button className="ev-signout" onClick={onSignOut}>
          <LogOut size={15} />
          Sign Out
        </button>
      </aside>

      {/* ── Main content ── */}
      <div className="ev-main">
        {activeNav === 'dashboard' && (
          <DashboardPanel
            fresh={fresh}
            activeSession={activeSession}
            elapsed={elapsed} h={h} m={m} s={s}
            rate={rate} totalHours={totalHours}
            clocking={clocking}
            clockIn={clockIn} clockOut={clockOut}
            isIdle={isIdle} activityPct={activityPct}
            activeSecs={activeSecs}
            breakStatus={breakStatus}
            breakStartAt={breakStartAt}
            breakCount={breakCount}
            currentBreakAllowance={currentBreakAllowance}
            startBreak={startBreak}
            endBreak={endBreak}
          />
        )}

      {/* Idle overlay — shown on top of everything when user goes idle while clocked in */}
      {isIdle && activeSession && (
        <IdleModal idleStartAt={idleStartAt} onContinue={handleContinueWorking} />
      )}
        {activeNav === 'profile' && <ProfilePanel fresh={fresh} setFresh={setFresh} />}
        {activeNav === 'faq' && <FAQPanel />}
      </div>
    </div>
  )
}

// ── Idle modal ───────────────────────────────────────────────────────────────
function IdleModal({ idleStartAt, onContinue }) {
  const [secs, setSecs] = useState(() =>
    idleStartAt ? Math.floor((Date.now() - idleStartAt) / 1000) : 0
  )
  useEffect(() => {
    const id = setInterval(() => {
      setSecs(idleStartAt ? Math.floor((Date.now() - idleStartAt) / 1000) : 0)
    }, 1000)
    return () => clearInterval(id)
  }, [idleStartAt])

  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  const timeStr = h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`

  return (
    <div className="idle-overlay">
      <div className="idle-modal">
        <div className="idle-modal-icon">⏸</div>
        <h2 className="idle-modal-title">Timer Paused</h2>
        <p className="idle-modal-desc">No mouse or keyboard activity detected.<br />Idle time is not counted as work.</p>
        <div className="idle-modal-timer">{timeStr}</div>
        <p className="idle-modal-sub">Away time will be deducted from your session earnings.</p>
        <button className="idle-continue-btn" onClick={onContinue}>▶ Continue Working</button>
      </div>
    </div>
  )
}

// ── Break timer ──────────────────────────────────────────────────────────────
function BreakTimer({ breakStartAt, breakStatus, paidAllowanceSecs }) {
  const [secs, setSecs] = useState(() =>
    breakStartAt ? Math.floor((Date.now() - breakStartAt) / 1000) : 0
  )
  useEffect(() => {
    const id = setInterval(() => {
      setSecs(breakStartAt ? Math.floor((Date.now() - breakStartAt) / 1000) : 0)
    }, 1000)
    return () => clearInterval(id)
  }, [breakStartAt])

  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  const timeStr = h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`
  const label = breakStatus === 'lunch' ? 'Lunch Break'
    : breakStatus === 'restroom' ? 'Rest Room'
    : 'Break'

  const isFullyUnpaid = paidAllowanceSecs === 0
  const paidRemaining = Math.max(0, paidAllowanceSecs - secs)
  const isOvertime = paidAllowanceSecs > 0 && secs >= paidAllowanceSecs
  const prMins = Math.floor(paidRemaining / 60)
  const prSecs = paidRemaining % 60
  const paidStr = `${prMins}:${String(prSecs).padStart(2, '0')}`

  return (
    <div className="break-timer">
      <span className="break-timer-label">{label}</span>
      <span className="break-timer-time">{timeStr}</span>
      {isFullyUnpaid ? (
        <span className="break-tag break-tag-unpaid">Salary paused</span>
      ) : isOvertime ? (
        <span className="break-tag break-tag-overtime">Paid time ended — salary paused</span>
      ) : (
        <span className="break-tag break-tag-paid">{paidStr} paid time remaining</span>
      )}
    </div>
  )
}

// ── Dashboard ────────────────────────────────────────────────────────────────
function DashboardPanel({ fresh, activeSession, elapsed, h, m, s, rate, totalHours, clocking, clockIn, clockOut, isIdle, activityPct, activeSecs, breakStatus, breakStartAt, breakCount, currentBreakAllowance, startBreak, endBreak }) {
  if (!fresh?.department) {
    return (
      <div className="ev-content-area">
        <div className="ev-pending-card">
          <div className="logo-mark" style={{ width: 44, height: 44, margin: '0 auto 16px' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
            </svg>
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Account Active</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 6 }}>Your department hasn't been assigned yet.</p>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Your admin will assign your department, position, and hourly rate.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="ev-content-area">
      <div className="ev-page-header">
        <h2 className="ev-page-title">Dashboard</h2>
        <p className="ev-page-sub">Track your shift in real time.</p>
      </div>

      {/* Live counter */}
      <div className={`counter-hero ${activeSession ? 'counter-active' : 'counter-idle'}`}>
        {activeSession && !breakStatus && <div className="counter-pulse-ring" />}

        <div className="counter-status">
          {activeSession
            ? breakStatus === 'break' ? <><span className="counter-dot-break" />On Break</>
            : breakStatus === 'restroom' ? <><span className="counter-dot-break" />Rest Room</>
            : breakStatus === 'lunch' ? <><span className="counter-dot-break" />Lunch Break</>
            : isIdle ? <><span className="counter-dot-idle" />Paused — No activity detected</>
            : <><span className="counter-dot" />Live — Shift in progress</>
            : <><span className="counter-dot-off" />Available</>}
        </div>

        <div className="counter-time">
          <span className="counter-digit-group">
            <span className="counter-digit">{pad(h)}</span>
            <span className="counter-unit">hr</span>
          </span>
          <span className="counter-sep">:</span>
          <span className="counter-digit-group">
            <span className="counter-digit">{pad(m)}</span>
            <span className="counter-unit">min</span>
          </span>
          <span className="counter-sep">:</span>
          <span className="counter-digit-group">
            <span className="counter-digit">{pad(s)}</span>
            <span className="counter-unit">sec</span>
          </span>
        </div>

        {activeSession && elapsed > 30 && (
          <span className="counter-activity-pct" style={{ color: activityPct >= 80 ? 'var(--positive)' : activityPct >= 50 ? '#f59e0b' : 'var(--negative)' }}>
            <Activity size={11} style={{ display: 'inline', marginRight: 3 }} />
            {activityPct}% active
          </span>
        )}

        <button
          className={`clock-btn ${activeSession ? 'clock-out' : 'clock-in'}`}
          onClick={activeSession ? clockOut : clockIn}
          disabled={clocking || rate === 0}
          title={rate === 0 ? 'Your admin needs to set your hourly rate first' : ''}
        >
          {clocking ? 'Please wait…' : activeSession
            ? <><StopCircle size={16} style={{ flexShrink: 0 }} /> Clock Out</>
            : <><Play size={16} style={{ flexShrink: 0 }} /> Start Shift</>}
        </button>
        {rate === 0 && (
          <p className="clock-note">Your admin needs to set your hourly rate before you can clock in.</p>
        )}

        {activeSession && !isIdle && !breakStatus && (
          <div className="break-btns">
            <button
              className="break-btn"
              onClick={() => startBreak('break')}
              disabled={breakCount >= 2}
              title={breakCount >= 2 ? 'Both paid breaks used' : `${2 - breakCount} of 2 paid breaks remaining`}
            >
              <Coffee size={13} />
              {breakCount >= 2 ? 'Break (used)' : `Break (${2 - breakCount}×20m)`}
            </button>
            <button className="break-btn" onClick={() => startBreak('restroom')}
              title={`5 min paid per elapsed hour`}>
              Rest Room
            </button>
            <button className="break-btn" onClick={() => startBreak('lunch')}>
              <Utensils size={13} /> Lunch
            </button>
          </div>
        )}

        {activeSession && breakStatus && (
          <div className="break-active-wrap">
            <BreakTimer
              breakStartAt={breakStartAt}
              breakStatus={breakStatus}
              paidAllowanceSecs={currentBreakAllowance}
            />
            <button className="break-return-btn" onClick={endBreak}>
              ▶ Return to Work
            </button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="ev-grid" style={{ gridTemplateColumns: '1fr' }}>
        <div className="ev-stat-card">
          <span className="ev-stat-label">Total Hours Logged</span>
          <span className="ev-stat-value">{totalHours.toFixed(2)}h</span>
        </div>
      </div>

      {activeSession && elapsed > 30 && (
        <div className="activity-bar-wrap">
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Activity size={11} />Activity this session</span>
            <span style={{ color: activityPct >= 80 ? 'var(--positive)' : activityPct >= 50 ? '#f59e0b' : 'var(--negative)', fontWeight: 600 }}>{activityPct}%</span>
          </div>
          <div className="activity-track">
            <div className="activity-fill" style={{ width: `${activityPct}%`, background: activityPct >= 80 ? 'var(--positive)' : activityPct >= 50 ? '#f59e0b' : 'var(--negative)' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            <span>Active: {Math.floor(activeSecs / 60)}m</span>
            <span>Idle: {Math.floor((elapsed - activeSecs) / 60)}m</span>
          </div>
        </div>
      )}

      <EmployeeTransactions employeeId={fresh.id} />
    </div>
  )
}

// ── Profile ──────────────────────────────────────────────────────────────────
function ProfilePanel({ fresh, setFresh }) {
  const [name, setName] = useState(fresh.full_name || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  async function saveName() {
    if (!name.trim()) { setError('Name cannot be empty'); return }
    setSaving(true); setError(''); setSaved(false)
    const { error: authErr } = await supabase.auth.updateUser({ data: { full_name: name.trim() } })
    if (authErr) { setError(authErr.message); setSaving(false); return }
    const { error: dbErr } = await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', fresh.id)
    if (dbErr) { setError(dbErr.message); setSaving(false); return }
    setFresh(p => ({ ...p, full_name: name.trim() }))
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const initials = fresh.full_name
    ? fresh.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?'

  return (
    <div className="ev-content-area">
      <div className="ev-page-header">
        <h2 className="ev-page-title">My Profile</h2>
        <p className="ev-page-sub">Your account information. Contact your admin to update department or pay rate.</p>
      </div>

      <div className="profile-card">
        {/* Avatar */}
        <div className="profile-avatar-row">
          <div className="profile-big-avatar" style={{ background: '#6366f118', border: '3px solid #6366f140', color: '#6366f1' }}>
            {initials}
          </div>
          <div>
            <div className="profile-name-display">{fresh.full_name}</div>
            <div className="profile-email-display">{fresh.email}</div>
          </div>
        </div>

        <div className="profile-divider" />

        {/* Editable: full name */}
        <div className="profile-field-group">
          <label className="profile-field-label">Full Name</label>
          <div className="profile-field-row">
            <input
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setSaved(false) }}
              className="form-input"
              style={{ flex: 1 }}
              onKeyDown={e => e.key === 'Enter' && saveName()}
            />
            <button className="profile-save-btn" onClick={saveName} disabled={saving || name.trim() === fresh.full_name}>
              {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
            </button>
          </div>
          {error && <p className="bf-error" style={{ padding: 0, marginTop: 6 }}>{error}</p>}
        </div>

        <div className="profile-divider" />

        {/* Read-only info */}
        <div className="profile-readonly-grid">
          <div className="profile-ro-field">
            <span className="profile-field-label">Email</span>
            <span className="profile-ro-value">{fresh.email}</span>
          </div>
          <div className="profile-ro-field">
            <span className="profile-field-label">Department</span>
            <span className="profile-ro-value">{fresh.department || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not assigned</span>}</span>
          </div>
          <div className="profile-ro-field">
            <span className="profile-field-label">Position</span>
            <span className="profile-ro-value">{fresh.position || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not assigned</span>}</span>
          </div>
          <div className="profile-ro-field">
            <span className="profile-field-label">Role</span>
            <span className={`role-badge ${fresh.role === 'admin' ? 'role-admin' : 'role-employee'}`}>
              {fresh.role || 'employee'}
            </span>
          </div>
        </div>

        <div className="profile-admin-note">
          <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          Department, position, and hourly rate are managed by your admin.
        </div>
      </div>
    </div>
  )
}

// ── FAQ ──────────────────────────────────────────────────────────────────────
const FAQS = [
  {
    q: 'How do I clock in and out?',
    a: 'Go to Dashboard and click "▶ Start Shift" when you begin working. Click "⏹ Clock Out" when you finish. Your hours and earnings are calculated automatically.',
  },
  {
    q: 'Does the timer keep running if I close the app?',
    a: 'Yes. The clock-in time is saved on the server. Even if you close or minimize the app, your hours continue to accumulate from the moment you clocked in.',
  },
  {
    q: 'Can I see my bonus and fine history?',
    a: 'Yes — scroll down on the Dashboard to see the Bonuses & Fines history with dates and reasons.',
  },
  {
    q: 'My hourly rate or department is wrong. What do I do?',
    a: 'Only admins can update your department, position, and hourly rate. Contact your admin and they can fix it from the Admin Panel → Members tab.',
  },
  {
    q: 'How do I change my name?',
    a: 'Go to My Profile in the left menu, update your full name, and click Save.',
  },
  {
    q: 'Will I see updates from my admin in real time?',
    a: 'Yes. The app uses live sync — if your admin updates your rate, bonuses, or other details, your dashboard reflects the change immediately without needing to reload.',
  },
  {
    q: 'What happens if I forget to clock out?',
    a: 'Your admin can close your session remotely from the employee history view. Contact your admin to correct any missed clock-outs.',
  },
]

function FAQPanel() {
  const [open, setOpen] = useState(null)
  return (
    <div className="ev-content-area">
      <div className="ev-page-header">
        <h2 className="ev-page-title">Help &amp; FAQ</h2>
        <p className="ev-page-sub">Answers to common questions about Salary Command Center.</p>
      </div>

      <div className="faq-list">
        {FAQS.map((item, i) => (
          <div key={i} className={`faq-item ${open === i ? 'faq-open' : ''}`}>
            <button className="faq-question" onClick={() => setOpen(open === i ? null : i)}>
              <span>{item.q}</span>
              <ChevronDown size={16} className="faq-chevron" />
            </button>
            {open === i && (
              <div className="faq-answer">{item.a}</div>
            )}
          </div>
        ))}
      </div>

      <div className="faq-contact">
        <MessageCircle size={16} style={{ flexShrink: 0 }} />
        Still have questions? Contact your admin directly.
      </div>
    </div>
  )
}

// ── Transactions ─────────────────────────────────────────────────────────────
function EmployeeTransactions({ employeeId }) {
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('transactions').select('*').eq('employee_id', employeeId)
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setTransactions(data); setLoading(false) })
  }, [employeeId])

  if (loading || transactions.length === 0) return null

  return (
    <div className="ev-txn-wrap">
      <h3 className="ev-txn-title">Bonuses &amp; Fines History</h3>
      <div className="bf-list">
        <div className="bf-list-head">
          <span className="bf-lh-date">Date</span>
          <span className="bf-lh-type">Type</span>
          <span className="bf-lh-note">Reason</span>
        </div>
        {transactions.map(tx => (
          <div key={tx.id} className={`bf-row bf-row-${tx.type}`}>
            <span className="bf-row-date">
              <span className="bf-row-day">{new Date(tx.created_at).toLocaleDateString('en-US', { weekday: 'short' })}</span>
              <span className="bf-row-datenum">{new Date(tx.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            </span>
            <span className={`bf-badge bf-badge-${tx.type}`}>{tx.type === 'bonus' ? '+ Bonus' : '− Fine'}</span>
            <span className="bf-row-note">{tx.note || <span style={{ color: 'var(--text-muted)' }}>—</span>}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
