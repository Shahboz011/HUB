import { useState, useEffect, useRef } from 'react'
import {
  Monitor, LayoutDashboard, UserCircle2, HelpCircle, LogOut,
  Play, StopCircle, ChevronDown, MessageCircle, Activity,
  Coffee, UtensilsCrossed,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { syncServerTime, serverNow, serverNowISO } from '../lib/serverTime'
import { ServerClockFull } from './ServerClock'
import ProfilePanel from './ProfilePanel'
import UserAvatar from './UserAvatar'

function pad(n) { return String(Math.floor(n)).padStart(2, '0') }

const NAV = [
  { id: 'dashboard', label: 'Dashboard',   icon: <LayoutDashboard size={16} /> },
  { id: 'profile',   label: 'My Profile',  icon: <UserCircle2 size={16} /> },
  { id: 'faq',       label: 'Help & FAQ',  icon: <HelpCircle size={16} /> },
]

// Convert "HH:MM" schedule time (always in ET) → UTC ms for today.
// Workers may be on machines in any timezone, so we must NOT use setHours()
// (which applies local timezone). Instead we determine the ET offset at runtime.
function nyHHMMtoMs(hhMM) {
  const [h, m] = hhMM.split(':').map(Number)
  const now = new Date(serverNow())
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
  }).formatToParts(now)
  const get = t => +parts.find(p => p.type === t).value
  const [nyY, nyMo, nyD, nyH, nyMn, nySc] = [get('year'), get('month'), get('day'), get('hour'), get('minute'), get('second')]
  const nyWallMs   = Date.UTC(nyY, nyMo - 1, nyD, nyH, nyMn, nySc)
  const nyOffsetMs = now.getTime() - nyWallMs // e.g. 14_400_000 for EDT
  return Date.UTC(nyY, nyMo - 1, nyD, h, m, 0) + nyOffsetMs
}

// Stitch multiple monitor screenshots side-by-side into one JPEG data URL.
function stitchScreens(screens) {
  if (screens.length === 1) return Promise.resolve(screens[0].dataUrl)
  return new Promise(resolve => {
    let loaded = 0
    const imgs = screens.map(() => new Image())
    imgs.forEach((img, i) => {
      img.onload = () => {
        if (++loaded < imgs.length) return
        const totalW = imgs.reduce((s, im) => s + im.naturalWidth, 0)
        const maxH   = Math.max(...imgs.map(im => im.naturalHeight))
        const canvas = document.createElement('canvas')
        canvas.width  = totalW
        canvas.height = maxH
        const ctx = canvas.getContext('2d')
        let x = 0
        imgs.forEach(im => { ctx.drawImage(im, x, 0); x += im.naturalWidth })
        resolve(canvas.toDataURL('image/jpeg', 0.7))
      }
      img.src = screens[i].dataUrl
    })
  })
}

export default function EmployeeView({ profile, onSignOut, deptSchedule }) {
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

  const [breakStatus, setBreakStatus] = useState(null) // null | 'break' | 'restroom' | 'pray' | 'coffee'
  const [breakStartAt, setBreakStartAt] = useState(null)
  const breakStartAtRef = useRef(null)
  const totalBreakRef = useRef(0)
  const totalUnpaidBreakRef = useRef(0)
  const [breakCount, setBreakCount] = useState(0)       // Break/Lunch uses (max 2, 20 min paid each)
  const breakCountRef = useRef(0)
  const [coffeeCount, setCoffeeCount] = useState(0)     // Coffee Break uses (max 2, 5 min paid each)
  const coffeeCountRef = useRef(0)
  const [restroomPaidUsed, setRestroomPaidUsed] = useState(0) // seconds used from 30-min daily pool
  const restroomPaidUsedRef = useRef(0)
  const currentBreakAllowanceRef = useRef(0)             // paid seconds available for current break
  const [currentBreakAllowance, setCurrentBreakAllowance] = useState(0)
  // Salary schedule: salary counting starts at work_start, stops at work_end
  const [salaryStartAt, setSalaryStartAt] = useState(null) // ms timestamp
  const salaryStartAtRef = useRef(null)
  const workEndMsRef = useRef(null) // ms timestamp for today's work_end (null = no cap)

  // Early clock-out confirmation modal
  const [earlyClockoutOpen, setEarlyClockoutOpen] = useState(false)
  const [earlyInitials,     setEarlyInitials]     = useState('')
  const [earlyReason,       setEarlyReason]       = useState('')

  // Live 10-minute activity block (Hubstaff-style)
  const [liveBlock, setLiveBlock] = useState(null) // { blockActiveSecs, blockTotalSecs, activityPct }

  useEffect(() => {
    window.electronAPI?.getVersion?.().then(v => { if (v) setAppVersion(v) })
    // Sync to server clock immediately, then every 5 minutes
    syncServerTime()
    const syncId = setInterval(syncServerTime, 5 * 60 * 1000)
    return () => clearInterval(syncId)
  }, [])

  // Save completed 10-min activity blocks to Supabase as they arrive from main process
  useEffect(() => {
    window.electronAPI?.onActivityBlock?.((block) => {
      supabase.from('activity_blocks').insert(block).catch(() => {})
    })
    window.electronAPI?.onActivityTick?.((data) => {
      setLiveBlock(data)
    })
  }, [])

  useEffect(() => {
    if (!profile?.id) return

    async function init() {
      const [{ data: p }, { data: s }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', profile.id).single(),
        supabase.from('work_sessions').select('*').eq('employee_id', profile.id).is('ended_at', null).maybeSingle(),
      ])
      if (p) setFresh(p)
      if (s) {
        justRestoredRef.current = true
        totalIdleRef.current = Number(s.accumulated_idle_secs) || 0
        totalBreakRef.current = Number(s.accumulated_break_secs) || 0
        totalUnpaidBreakRef.current = Number(s.accumulated_unpaid_break_secs) || 0
        breakCountRef.current = Number(s.break_count) || 0
        setBreakCount(Number(s.break_count) || 0)
        coffeeCountRef.current = Number(s.coffee_count) || 0
        setCoffeeCount(Number(s.coffee_count) || 0)
        restroomPaidUsedRef.current = Number(s.used_restroom_secs) || 0
        setRestroomPaidUsed(Number(s.used_restroom_secs) || 0)

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
        const sStart = s.salary_start_at
          ? new Date(s.salary_start_at).getTime()
          : new Date(s.started_at).getTime()
        salaryStartAtRef.current = sStart
        setSalaryStartAt(sStart)
        setActiveSession(s)
        setElapsed(Math.max(0, Math.floor((serverNow() - sStart) / 1000)))
        window.electronAPI?.setTracking?.(true)
      }
      setLoading(false)
    }
    init()

    const profileSub = supabase
      .channel(`profile-${profile.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${profile.id}` },
        ({ new: row }) => setFresh(row))
      .subscribe()

    const sessionSub = supabase
      .channel(`sessions-${profile.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'work_sessions', filter: `employee_id=eq.${profile.id}` },
        ({ new: row }) => {
          if (row.ended_at) { setActiveSession(null); setElapsed(0); return }
          const bc = Number(row.break_count) || 0
          if (bc !== breakCountRef.current) { breakCountRef.current = bc; setBreakCount(bc) }
          const cc = Number(row.coffee_count) || 0
          if (cc !== coffeeCountRef.current) { coffeeCountRef.current = cc; setCoffeeCount(cc) }
        })
      .subscribe()

    return () => {
      supabase.removeChannel(profileSub)
      supabase.removeChannel(sessionSub)
    }
  }, [profile?.id])

  // Recompute work_end timestamp whenever the schedule changes (or on mount).
  // Always interpreted as ET regardless of the worker's machine timezone.
  useEffect(() => {
    if (!deptSchedule?.work_end) { workEndMsRef.current = null; return }
    workEndMsRef.current = nyHHMMtoMs(deptSchedule.work_end)
  }, [deptSchedule])

  useEffect(() => {
    if (!activeSession) return
    const id = setInterval(() => {
      const start = salaryStartAtRef.current
      if (!start) return
      // elapsed = raw wall-clock seconds since salary start.
      // Idle deduction happens below in activeSecs = elapsed − effectiveIdleSecs,
      // which makes the displayed h/m/s counter freeze automatically while idle.
      const cap = workEndMsRef.current
      const effectiveNow = cap ? Math.min(serverNow(), cap) : serverNow()
      setElapsed(Math.max(0, Math.floor((effectiveNow - start) / 1000)))
    }, 1000)
    return () => clearInterval(id)
  }, [activeSession])

  // Idle event listeners from main process
  useEffect(() => {
    if (!window.electronAPI) return
    window.electronAPI.onUserIdle?.((secs) => {
      if (trackingStateRef.current.breakStatus) return // idle suppressed during breaks
      const startAt = serverNow() - secs * 1000
      idleStartAtRef.current = startAt
      setIdleStartAt(startAt)
      setIsIdle(true)
    })
    window.electronAPI.onUserActive?.(() => {
      if (idleStartAtRef.current !== null) {
        totalIdleRef.current += (serverNow() - idleStartAtRef.current) / 1000
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
      breakStatus,
      sessionId: activeSession?.id ?? null,
      employeeId: fresh?.id ?? null,
    }
  }, [isIdle, breakStatus, activeSession?.id, fresh?.id])

  // Tell main process when a break starts/ends so it suppresses the idle popup
  useEffect(() => {
    window.electronAPI?.setBreakStatus?.(!!breakStatus)
  }, [breakStatus])

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
      const now = serverNow()
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
        const startAt = serverNow()
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

        // Stitch all monitors side-by-side into one image, then save one row.
        const stitchedDataUrl = await stitchScreens(result.screens)
        const base64 = stitchedDataUrl.split(',')[1]
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
        const filename = `${profile.id}/${serverNow()}_screen.jpg`
        const { error: uploadErr } = await supabase.storage
          .from('screenshots').upload(filename, bytes, { contentType: 'image/jpeg' })
        if (uploadErr) { setScreenshotStatus('upload_err:' + uploadErr.message); return }
        const { error: insertErr } = await supabase.from('screenshots')
          .insert({ employee_id: profile.id, path: filename, taken_at: serverNowISO(), active_app: result.active_app || '', window_title: result.window_title || '' })
        setScreenshotStatus(insertErr ? 'insert_err:' + insertErr.message : 'ok')
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
            payload: {
              employee_id: fresh.id,
              is_idle: trackingStateRef.current.isIdle,
              break_status: trackingStateRef.current.breakStatus,
              ts: new Date().toISOString(),
            } })
        }
      })
    activityBcRef.current = ch
    return () => { supabase.removeChannel(ch); activityBcRef.current = null }
  }, [activeSession?.id, fresh.id])

  // Re-broadcast whenever idle state changes so admin sees it immediately
  useEffect(() => {
    if (!activityBcRef.current || !fresh.id || !activeSession) return
    activityBcRef.current.send({ type: 'broadcast', event: 'status',
      payload: { employee_id: fresh.id, is_idle: isIdle, break_status: breakStatus, ts: new Date().toISOString() } }).catch(() => {})
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
        .update({
          is_idle: false,
          idle_started_at: null,
          accumulated_idle_secs: totalIdleRef.current,
        })
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

    // Compute salary_start_at: if clocking in before work_start, salary begins at work_start
    const now = serverNow()
    let sStart = now
    if (deptSchedule?.work_start) {
      const workStartMs = nyHHMMtoMs(deptSchedule.work_start)
      if (now < workStartMs) sStart = workStartMs
    }

    const { data, error } = await supabase
      .from('work_sessions')
      .insert({ employee_id: fresh.id, salary_start_at: new Date(sStart).toISOString() })
      .select().single()
    if (!error) {
      salaryStartAtRef.current = sStart
      setSalaryStartAt(sStart)
      setActiveSession(data)
      setElapsed(Math.max(0, Math.floor((serverNow() - sStart) / 1000)))
      window.electronAPI?.activityStart?.({ employeeId: fresh.id, sessionId: data.id })
    } else {
      window.electronAPI?.setTracking?.(false)
    }
    setClocking(false)
  }

  async function clockOut(earlyData = null) {
    // Stop activity tracker immediately — captures the last partial block
    const finalActivityBlock = await window.electronAPI?.activityStop?.() ?? null

    // Finalize any in-progress break before closing the session
    let finalBreakSecs = totalBreakRef.current
    let finalUnpaidSecs = totalUnpaidBreakRef.current
    let finalBreakCount = breakCountRef.current
    let pendingBreakLog = null
    const clockOutMs = serverNow()
    if (breakStartAtRef.current !== null) {
      const dur = (clockOutMs - breakStartAtRef.current) / 1000
      const coAllowance = currentBreakAllowanceRef.current
      const coUnlimited = coAllowance === -1
      pendingBreakLog = {
        break_type: breakStatus,
        started_at: new Date(breakStartAtRef.current).toISOString(),
        ended_at: new Date(clockOutMs).toISOString(),
        duration_secs: Math.round(dur),
        paid_secs: Math.round(coUnlimited ? dur : Math.min(dur, coAllowance)),
      }
      finalBreakSecs += dur
      finalUnpaidSecs += coUnlimited ? 0 : Math.max(0, dur - coAllowance)
      if (breakStatus === 'break') finalBreakCount += 1
      else if (breakStatus === 'coffee') coffeeCountRef.current += 1
      else if (breakStatus === 'restroom') restroomPaidUsedRef.current = Math.min(30 * 60, restroomPaidUsedRef.current + Math.round(Math.min(dur, coAllowance)))
      breakStartAtRef.current = null
    }
    currentBreakAllowanceRef.current = 0
    setCurrentBreakAllowance(0)
    setBreakStartAt(null)
    setBreakStatus(null)
    setClocking(true)
    window.electronAPI?.setTracking?.(false)
    // Log the in-progress break if one was active at clock-out
    if (pendingBreakLog) {
      await supabase.from('break_log').insert({
        employee_id: fresh.id,
        session_id: activeSession.id,
        ...pendingBreakLog,
      })
    }
    // Save final break data so admin can see it; then clock out server-side
    await supabase.from('work_sessions').update({
      break_status: null, break_started_at: null, current_break_allowance_secs: 0,
      accumulated_break_secs: finalBreakSecs,
      accumulated_unpaid_break_secs: finalUnpaidSecs,
      accumulated_idle_secs: totalIdleRef.current,
      break_count: finalBreakCount,
      coffee_count: coffeeCountRef.current,
      used_restroom_secs: restroomPaidUsedRef.current,
      ...(earlyData ? { early_clockout_initials: earlyData.initials, early_clockout_reason: earlyData.reason } : {}),
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
    coffeeCountRef.current = 0
    setCoffeeCount(0)
    restroomPaidUsedRef.current = 0
    setRestroomPaidUsed(0)
    salaryStartAtRef.current = null
    setSalaryStartAt(null)
    setLiveBlock(null)
    // Persist final partial activity block (the incomplete 10-min window at clock-out)
    if (finalActivityBlock?.total_seconds > 0) {
      supabase.from('activity_blocks').insert(finalActivityBlock).catch(() => {})
    }
    setClocking(false)
  }

  function handleClockOutRequest() {
    if (!activeSession) return
    const now = serverNow()
    if (workEndMsRef.current && now < workEndMsRef.current) {
      setEarlyInitials('')
      setEarlyReason('')
      setEarlyClockoutOpen(true)
      return
    }
    clockOut()
  }

  function handleContinueWorking() {
    if (idleStartAtRef.current !== null) {
      totalIdleRef.current += (serverNow() - idleStartAtRef.current) / 1000
      idleStartAtRef.current = null
    }
    setIdleStartAt(null)
    setIsIdle(false)
  }

  function startBreak(type) {
    if (!activeSession || breakStatus) return
    // Paid allowance rules:
    // - break:    20 min paid, max 2 uses per session (Break / Lunch combined)
    // - restroom: 30-min daily paid pool — remaining pool is the allowance
    // - pray:     20 min paid per prayer session
    // - coffee:   5 min paid, max 2 uses per session
    let allowance = 0
    if (type === 'break') {
      allowance = breakCountRef.current < 2 ? 20 * 60 : 0
    } else if (type === 'restroom') {
      allowance = Math.max(0, 30 * 60 - restroomPaidUsedRef.current)
    } else if (type === 'pray') {
      allowance = 20 * 60
    } else if (type === 'coffee') {
      allowance = coffeeCountRef.current < 2 ? 5 * 60 : 0
    }
    const now = serverNow()
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

  async function endBreak() {
    if (!breakStatus) return
    const bStart = breakStartAtRef.current  // save before clearing
    const endedAt = serverNow()
    let duration = 0
    if (bStart !== null) {
      duration = (endedAt - bStart) / 1000
      totalBreakRef.current += duration
      breakStartAtRef.current = null
    }
    const isUnlimitedPaid = currentBreakAllowanceRef.current === -1
    const paidSecs = isUnlimitedPaid ? duration : Math.min(duration, currentBreakAllowanceRef.current)
    const unpaid = isUnlimitedPaid ? 0 : Math.max(0, duration - currentBreakAllowanceRef.current)
    totalUnpaidBreakRef.current += unpaid

    const prevStatus = breakStatus
    if (prevStatus === 'break') {
      breakCountRef.current += 1
      setBreakCount(breakCountRef.current)
    } else if (prevStatus === 'coffee') {
      coffeeCountRef.current += 1
      setCoffeeCount(coffeeCountRef.current)
    } else if (prevStatus === 'restroom') {
      restroomPaidUsedRef.current = Math.min(30 * 60, restroomPaidUsedRef.current + Math.round(paidSecs))
      setRestroomPaidUsed(restroomPaidUsedRef.current)
    }

    currentBreakAllowanceRef.current = 0
    setCurrentBreakAllowance(0)
    setBreakStartAt(null)
    setBreakStatus(null)

    // Insert break_log first, then update session (ensures log exists before session reflects end)
    if (bStart !== null && activeSession) {
      await supabase.from('break_log').insert({
        employee_id: fresh.id,
        session_id: activeSession.id,
        break_type: prevStatus,
        started_at: new Date(bStart).toISOString(),
        ended_at: new Date(endedAt).toISOString(),
        duration_secs: Math.round(duration),
        paid_secs: Math.round(paidSecs),
      })
    }

    supabase.from('work_sessions')
      .update({
        break_status: null,
        break_started_at: null,
        current_break_allowance_secs: 0,
        accumulated_break_secs: totalBreakRef.current,
        accumulated_unpaid_break_secs: totalUnpaidBreakRef.current,
        break_count: breakCountRef.current,
        coffee_count: coffeeCountRef.current,
        used_restroom_secs: restroomPaidUsedRef.current,
      })
      .eq('id', activeSession.id)
      .then(() => {})
  }

  if (loading) return <div className="ev-loading">Loading…</div>

  const rate = Number(fresh.hourly_rate) || 0
  const totalHours = Number(fresh.hours_worked) || 0

  // All idle time is unpaid — deducted directly from activeSecs
  const currentIdleContrib = idleStartAtRef.current !== null
    ? (serverNow() - idleStartAtRef.current) / 1000 : 0
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
          <span className="ev-sidebar-brand-name">PharmaStaff</span>
        </div>

        {/* User card */}
        <div className="ev-sidebar-user">
          <UserAvatar
            userId={fresh.id}
            name={fresh.full_name}
            avatarUrl={fresh.avatar_url}
            className="ev-sidebar-avatar"
          />
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
            : breakStatus === 'break' ? 'Break / Lunch'
            : breakStatus === 'restroom' ? 'Rest Room'
            : breakStatus === 'pray' ? 'Praying'
            : breakStatus === 'coffee' ? 'Coffee Break'
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

        {/* Server time clock */}
        <ServerClockFull />

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
            clockIn={clockIn} clockOut={handleClockOutRequest}
            isIdle={isIdle} activityPct={activityPct}
            activeSecs={activeSecs}
            breakStatus={breakStatus}
            breakStartAt={breakStartAt}
            breakCount={breakCount}
            coffeeCount={coffeeCount}
            restroomPaidUsed={restroomPaidUsed}
            salaryStartAt={salaryStartAt}
            workEndMs={workEndMsRef.current}
            currentBreakAllowance={currentBreakAllowance}
            startBreak={startBreak}
            endBreak={endBreak}
            liveBlock={liveBlock}
          />
        )}

      {/* Idle overlay — shown on top of everything when user goes idle while clocked in */}
      {isIdle && activeSession && (
        <IdleModal idleStartAt={idleStartAt} onContinue={handleContinueWorking} />
      )}

      {/* Early clock-out confirmation */}
      {earlyClockoutOpen && (
        <EarlyClockOutModal
          workEndMs={workEndMsRef.current}
          workerName={fresh?.full_name || fresh?.email || ''}
          initials={earlyInitials}
          reason={earlyReason}
          onInitialsChange={setEarlyInitials}
          onReasonChange={setEarlyReason}
          onConfirm={() => { setEarlyClockoutOpen(false); clockOut({ initials: earlyInitials.trim(), reason: earlyReason.trim() }) }}
          onCancel={() => setEarlyClockoutOpen(false)}
          clocking={clocking}
        />
      )}
        {activeNav === 'profile' && <ProfilePanel profile={fresh} onUpdate={setFresh} />}
        {activeNav === 'faq' && <FAQPanel />}
      </div>
    </div>
  )
}

// ── Idle modal ───────────────────────────────────────────────────────────────
function IdleModal({ idleStartAt, onContinue }) {
  const [secs, setSecs] = useState(() =>
    idleStartAt ? Math.floor((serverNow() - idleStartAt) / 1000) : 0
  )
  useEffect(() => {
    const id = setInterval(() => {
      setSecs(idleStartAt ? Math.floor((serverNow() - idleStartAt) / 1000) : 0)
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

// ── Early clock-out modal ─────────────────────────────────────────────────────
function EarlyClockOutModal({ workEndMs, workerName, initials, reason, onInitialsChange, onReasonChange, onConfirm, onCancel, clocking }) {
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), 1000)
    return () => clearInterval(id)
  }, [])
  const minsLeft  = workEndMs ? Math.max(0, Math.round((workEndMs - now) / 60000)) : 0
  const hoursLeft = Math.floor(minsLeft / 60)
  const remMins   = minsLeft % 60
  const timeLeft  = hoursLeft > 0 ? `${hoursLeft}h ${remMins}m` : `${remMins}m`
  const endTimeStr= workEndMs ? new Date(workEndMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' }) : ''

  const initialsOk = initials.trim().length >= 1 && initials.trim().length <= 6
  const reasonOk   = reason.trim().length >= 5
  const canConfirm = initialsOk && reasonOk && !clocking

  return (
    <div className="idle-overlay" style={{ zIndex: 1100, background: 'rgba(0,0,0,0.72)' }}>
      <div className="idle-modal" style={{ maxWidth: 420, width: '90%', padding: '28px 28px 24px', gap: 0 }}>

        {/* Icon */}
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#fff3cd', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', fontSize: 26 }}>
          ⏰
        </div>

        {/* Title */}
        <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', textAlign: 'center' }}>
          Leaving Early?
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
          Your shift ends at <strong style={{ color: 'var(--text-primary)' }}>{endTimeStr}</strong>.
          {minsLeft > 0 && <> You still have <strong style={{ color: '#f59e0b' }}>{timeLeft}</strong> remaining.</>}
        </p>

        <div style={{ borderTop: '1px solid var(--border)', margin: '0 0 18px' }} />

        <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
          To confirm early clock-out, please sign below and provide a reason.
        </p>

        {/* Initials */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Your Initials <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <input
            value={initials}
            onChange={e => onInitialsChange(e.target.value.slice(0, 6))}
            placeholder="e.g. A.B. or AB"
            maxLength={6}
            autoFocus
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '9px 12px', borderRadius: 8,
              border: `1.5px solid ${initialsOk || !initials ? 'var(--border)' : '#ef4444'}`,
              background: 'var(--surface)', color: 'var(--text-primary)',
              fontSize: 20, fontWeight: 700, letterSpacing: 4, textAlign: 'center',
              outline: 'none', fontFamily: 'monospace',
            }}
          />
          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
            Type your initials as your electronic signature
          </p>
        </div>

        {/* Reason */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Reason for Leaving Early <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <textarea
            value={reason}
            onChange={e => onReasonChange(e.target.value)}
            placeholder="Please explain why you are leaving before your scheduled shift end…"
            rows={3}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '9px 12px', borderRadius: 8,
              border: `1.5px solid ${reasonOk || !reason ? 'var(--border)' : '#ef4444'}`,
              background: 'var(--surface)', color: 'var(--text-primary)',
              fontSize: 13, resize: 'vertical', outline: 'none', lineHeight: 1.5,
              fontFamily: 'inherit',
            }}
          />
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onCancel}
            disabled={clocking}
            style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
          >
            Stay & Continue
          </button>
          <button
            onClick={onConfirm}
            disabled={!canConfirm}
            style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: canConfirm ? '#dc2626' : '#94a3b8', color: '#fff', fontSize: 13, fontWeight: 700, cursor: canConfirm ? 'pointer' : 'default', transition: 'background 0.15s' }}
          >
            {clocking ? 'Clocking Out…' : 'Confirm Clock Out'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Break timer ──────────────────────────────────────────────────────────────
function BreakTimer({ breakStartAt, breakStatus, paidAllowanceSecs }) {
  const [secs, setSecs] = useState(() =>
    breakStartAt ? Math.floor((serverNow() - breakStartAt) / 1000) : 0
  )
  useEffect(() => {
    const id = setInterval(() => {
      setSecs(breakStartAt ? Math.floor((serverNow() - breakStartAt) / 1000) : 0)
    }, 1000)
    return () => clearInterval(id)
  }, [breakStartAt])

  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  const timeStr = h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`
  const label = breakStatus === 'coffee' ? 'Coffee Break'
    : breakStatus === 'restroom' ? 'Rest Room'
    : breakStatus === 'pray' ? 'Prayer Break'
    : 'Break / Lunch'

  const isUnlimitedPaid = paidAllowanceSecs === -1
  const isFullyUnpaid   = paidAllowanceSecs === 0
  const paidRemaining   = isUnlimitedPaid ? 0 : Math.max(0, paidAllowanceSecs - secs)
  const isOvertime      = !isUnlimitedPaid && paidAllowanceSecs > 0 && secs >= paidAllowanceSecs
  const prMins = Math.floor(paidRemaining / 60)
  const prSecs = paidRemaining % 60
  const paidStr = `${prMins}:${String(prSecs).padStart(2, '0')}`

  return (
    <div className="break-timer">
      <span className="break-timer-label">{label}</span>
      <span className="break-timer-time">{timeStr}</span>
      {isUnlimitedPaid ? (
        <span className="break-tag break-tag-paid">Paid — no time limit</span>
      ) : isFullyUnpaid ? (
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
function DashboardPanel({ fresh, activeSession, elapsed, h, m, s, rate, totalHours, clocking, clockIn, clockOut, isIdle, activityPct, activeSecs, breakStatus, breakStartAt, breakCount, coffeeCount, restroomPaidUsed, salaryStartAt, workEndMs, currentBreakAllowance, startBreak, endBreak, liveBlock }) {
  const now            = serverNow()
  const waitingForWork = activeSession && elapsed === 0 && salaryStartAt && salaryStartAt > now
  const salaryEnded    = activeSession && workEndMs && now > workEndMs
  const workStartStr   = salaryStartAt ? new Date(salaryStartAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : null
  const workEndStr     = workEndMs     ? new Date(workEndMs).toLocaleTimeString('en-US',     { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : null
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
            ? breakStatus === 'break' ? <><span className="counter-dot-break" />Break / Lunch</>
            : breakStatus === 'restroom' ? <><span className="counter-dot-break" />Rest Room</>
            : breakStatus === 'pray' ? <><span className="counter-dot-break" />Praying</>
            : breakStatus === 'coffee' ? <><span className="counter-dot-break" />Coffee Break</>
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

        {/* Waiting for work to start */}
        {waitingForWork && (
          <div style={{
            background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8,
            padding: '10px 16px', fontSize: 13, color: '#92400e', fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 8, marginTop: 8,
          }}>
            ⏰ You're clocked in early — salary timer starts at <strong>{workStartStr}</strong>
          </div>
        )}

        {/* Salary ended for the day */}
        {salaryEnded && (
          <div style={{
            background: '#fce7f3', border: '1px solid #f9a8d4', borderRadius: 8,
            padding: '10px 16px', fontSize: 13, color: '#9d174d', fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 8, marginTop: 8,
          }}>
            🔴 Shift ended at <strong>{workEndStr}</strong> — salary is no longer counting. Please clock out.
          </div>
        )}

        {activeSession && !isIdle && !breakStatus && !waitingForWork && !salaryEnded && (
          <div className="break-btns">
            {/* Break / Lunch — 20 min paid, 2 uses */}
            <button
              className={`break-btn ${breakCount >= 2 ? 'break-btn-used' : ''}`}
              onClick={() => startBreak('break')}
              disabled={breakCount >= 2}
              title={breakCount >= 2 ? 'Both breaks used' : `20 min paid — ${2 - breakCount} use${2 - breakCount !== 1 ? 's' : ''} left`}
            >
              <UtensilsCrossed size={13} />
              {breakCount >= 2 ? 'Break / Lunch ✓' : `Break / Lunch (${2 - breakCount} left)`}
            </button>

            {/* Rest Room — 30-min daily paid pool */}
            {(() => {
              const paidLeft = Math.max(0, 30 * 60 - restroomPaidUsed)
              const minsLeft = Math.round(paidLeft / 60)
              return (
                <button
                  className="break-btn"
                  onClick={() => startBreak('restroom')}
                  title={paidLeft > 0 ? `${minsLeft}m paid remaining from 30-min daily pool` : 'Restroom — paid pool exhausted, unpaid'}
                >
                  🚶 Rest Room {paidLeft > 0 ? `(${minsLeft}m paid)` : '(unpaid)'}
                </button>
              )
            })()}

            {/* Pray — 20 min paid per session, unlimited times */}
            <button
              className="break-btn"
              onClick={() => startBreak('pray')}
              title="20 min paid per prayer — unlimited uses"
            >
              🙏 Pray (20m)
            </button>

            {/* Coffee Break — 5 min paid, 2 uses */}
            <button
              className={`break-btn ${coffeeCount >= 2 ? 'break-btn-used' : ''}`}
              onClick={() => startBreak('coffee')}
              disabled={coffeeCount >= 2}
              title={coffeeCount >= 2 ? 'Coffee breaks used' : `5 min paid — ${2 - coffeeCount} use${2 - coffeeCount !== 1 ? 's' : ''} left`}
            >
              <Coffee size={13} />
              {coffeeCount >= 2 ? 'Coffee ✓' : `Coffee (${2 - coffeeCount} left)`}
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
            <span>Deducted: {Math.floor((elapsed - activeSecs) / 60)}m</span>
          </div>
        </div>
      )}

      {/* Live 10-minute activity block */}
      {activeSession && liveBlock && liveBlock.blockTotalSecs >= 10 && (() => {
        const pct      = liveBlock.activityPct
        const secsLeft = Math.max(0, 600 - liveBlock.blockTotalSecs)
        const minsLeft = Math.floor(secsLeft / 60)
        const pctColor = pct >= 80 ? 'var(--positive)' : pct >= 50 ? '#f59e0b' : 'var(--negative)'
        return (
          <div className="activity-bar-wrap" style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Activity size={11} />
                Current 10-min block
                {liveBlock.wasIdle && <span style={{ color: '#f59e0b', marginLeft: 4 }}>· idle detected</span>}
              </span>
              <span style={{ color: pctColor, fontWeight: 600 }}>{pct}%</span>
            </div>
            <div className="activity-track">
              <div className="activity-fill" style={{ width: `${pct}%`, background: pctColor }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              <span>{liveBlock.blockActiveSecs}s active / {liveBlock.blockTotalSecs}s elapsed</span>
              <span>{minsLeft > 0 ? `${minsLeft}m left` : 'block ending…'}</span>
            </div>
          </div>
        )
      })()}

      <EmployeeTransactions employeeId={fresh.id} />
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
        <p className="ev-page-sub">Answers to common questions about PharmaStaff Hub.</p>
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
              <span className="bf-row-day">{new Date(tx.created_at).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' })}</span>
              <span className="bf-row-datenum">{new Date(tx.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })}</span>
            </span>
            <span className={`bf-badge bf-badge-${tx.type}`}>{tx.type === 'bonus' ? '+ Bonus' : '− Fine'}</span>
            <span className="bf-row-note">{tx.note || <span style={{ color: 'var(--text-muted)' }}>—</span>}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
