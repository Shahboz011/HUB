import { useState, useEffect, useRef } from 'react'
import {
  Monitor, LayoutDashboard, UserCircle2, HelpCircle, LogOut,
  Play, StopCircle, Info, ChevronDown, MessageCircle, Activity,
} from 'lucide-react'
import { supabase } from '../lib/supabase'

function fmt(v) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(v)
}
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

  // Activity tracking
  const [isIdle, setIsIdle] = useState(false)
  const [idleStartAt, setIdleStartAt] = useState(null) // ms timestamp when idle began
  const totalIdleRef = useRef(0)  // accumulated idle seconds this session
  const idleStartAtRef = useRef(null) // mirror of idleStartAt for use in async callbacks
  const activityBcRef = useRef(null) // supabase broadcast channel

  useEffect(() => {
    if (!profile?.id) return

    Promise.all([
      supabase.from('profiles').select('*').eq('id', profile.id).single(),
      supabase.from('work_sessions').select('*').eq('employee_id', profile.id).is('ended_at', null).maybeSingle(),
    ]).then(([{ data: p }, { data: s }]) => {
      if (p) setFresh(p)
      if (s) {
        setActiveSession(s)
        setElapsed(Math.floor((Date.now() - new Date(s.started_at).getTime()) / 1000))
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

  // Supabase broadcast channel for admin visibility (set up when clocked in)
  useEffect(() => {
    if (!activeSession || !fresh.id) return
    const ch = supabase.channel('employee-activity')
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          ch.send({ type: 'broadcast', event: 'status',
            payload: { employee_id: fresh.id, is_idle: false, ts: Date.now() } })
        }
      })
    activityBcRef.current = ch
    return () => { supabase.removeChannel(ch); activityBcRef.current = null }
  }, [activeSession?.id, fresh.id])

  // Re-broadcast whenever idle state changes so admin sees it immediately
  useEffect(() => {
    if (!activityBcRef.current || !fresh.id || !activeSession) return
    activityBcRef.current.send({ type: 'broadcast', event: 'status',
      payload: { employee_id: fresh.id, is_idle: isIdle, ts: Date.now() } }).catch(() => {})
  }, [isIdle, activeSession?.id, fresh.id])

  async function clockIn() {
    totalIdleRef.current = 0
    idleStartAtRef.current = null
    setIdleStartAt(null)
    setIsIdle(false)
    window.electronAPI?.setTracking?.(true)
    setClocking(true)
    const { data, error } = await supabase
      .from('work_sessions').insert({ employee_id: fresh.id }).select().single()
    if (!error) { setActiveSession(data); setElapsed(0) }
    setClocking(false)
  }

  async function clockOut() {
    setClocking(true)
    window.electronAPI?.setTracking?.(false)
    const now = new Date()
    // Finalize any in-progress idle period
    if (idleStartAtRef.current !== null) {
      totalIdleRef.current += (Date.now() - idleStartAtRef.current) / 1000
      idleStartAtRef.current = null
    }
    const totalElapsedSecs = (now - new Date(activeSession.started_at)) / 1000
    const activeSecs = Math.max(0, totalElapsedSecs - totalIdleRef.current)
    const durationHours = activeSecs / 3600
    await supabase.from('work_sessions').update({
      ended_at: now.toISOString(), duration_hours: durationHours,
    }).eq('id', activeSession.id)
    const newTotal = Number(fresh.hours_worked) + durationHours
    await supabase.from('profiles').update({ hours_worked: newTotal }).eq('id', fresh.id)
    setFresh(p => ({ ...p, hours_worked: newTotal }))
    setActiveSession(null)
    setElapsed(0)
    totalIdleRef.current = 0
    setIdleStartAt(null)
    setIsIdle(false)
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

  if (loading) return <div className="ev-loading">Loading…</div>

  const rate = Number(fresh.hourly_rate) || 0
  const totalHours = Number(fresh.hours_worked) || 0
  const bonuses = Number(fresh.bonuses) || 0
  const fines = Number(fresh.fines) || 0
  const totalNet = Math.max(0, totalHours * rate + bonuses - fines)

  // Activity-adjusted values (idle time excluded from salary)
  const currentIdleContrib = idleStartAtRef.current !== null
    ? (Date.now() - idleStartAtRef.current) / 1000 : 0
  const effectiveIdleSecs = totalIdleRef.current + currentIdleContrib
  const activeSecs = Math.max(0, elapsed - effectiveIdleSecs)
  const activityPct = elapsed > 30 ? Math.round((activeSecs / elapsed) * 100) : 100
  const sessionEarned = (activeSecs / 3600) * rate  // only active time pays

  const h = Math.floor(elapsed / 3600)
  const m = Math.floor((elapsed % 3600) / 60)
  const s = elapsed % 60

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
        <div className={`ev-sidebar-status ${activeSession ? (isIdle ? 'ev-status-idle' : 'ev-status-live') : 'ev-status-off'}`}>
          <span className={activeSession ? (isIdle ? 'counter-dot-idle' : 'counter-dot') : 'counter-dot-off'} />
          {activeSession ? (isIdle ? 'Idle — paused' : 'Working now') : 'Not clocked in'}
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
            sessionEarned={sessionEarned}
            rate={rate} totalHours={totalHours}
            bonuses={bonuses} fines={fines} totalNet={totalNet}
            clocking={clocking}
            clockIn={clockIn} clockOut={clockOut}
            isIdle={isIdle} activityPct={activityPct}
            activeSecs={activeSecs}
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

// ── Dashboard ────────────────────────────────────────────────────────────────
function DashboardPanel({ fresh, activeSession, elapsed, h, m, s, sessionEarned, rate, totalHours, bonuses, fines, totalNet, clocking, clockIn, clockOut, isIdle, activityPct, activeSecs }) {
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
        <p className="ev-page-sub">Track your shift and earnings in real time.</p>
      </div>

      {/* Live counter */}
      <div className={`counter-hero ${activeSession ? 'counter-active' : 'counter-idle'}`}>
        {activeSession && <div className="counter-pulse-ring" />}

        <div className="counter-status">
          {activeSession
            ? isIdle
              ? <><span className="counter-dot-idle" />Paused — No activity detected</>
              : <><span className="counter-dot" />Live — Shift in progress</>
            : <><span className="counter-dot-off" />Not clocked in</>}
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

        <div className="counter-earned">
          <span className="counter-earned-label">Earned this shift</span>
          <span className="counter-earned-value">{fmt(sessionEarned)}</span>
          {activeSession && elapsed > 30 && (
            <span className="counter-activity-pct" style={{ color: activityPct >= 80 ? 'var(--positive)' : activityPct >= 50 ? '#f59e0b' : 'var(--negative)' }}>
              <Activity size={11} style={{ display: 'inline', marginRight: 3 }} />
              {activityPct}% active
            </span>
          )}
        </div>

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
      </div>

      {/* Stats grid */}
      <div className="ev-grid">
        <div className="ev-stat-card">
          <span className="ev-stat-label">Total Hours Logged</span>
          <span className="ev-stat-value">{totalHours.toFixed(2)}h</span>
        </div>
        <div className="ev-stat-card">
          <span className="ev-stat-label">Base Pay</span>
          <span className="ev-stat-value">{fmt(totalHours * rate)}</span>
        </div>
        <div className="ev-stat-card">
          <span className="ev-stat-label">Hourly Rate</span>
          <span className="ev-stat-value">${rate}/hr</span>
        </div>
        <div className="ev-stat-card ev-positive">
          <span className="ev-stat-label">Bonuses</span>
          <span className="ev-stat-value">{fmt(bonuses)}</span>
        </div>
        <div className="ev-stat-card ev-negative">
          <span className="ev-stat-label">Deductions</span>
          <span className="ev-stat-value">{fmt(fines)}</span>
        </div>
        <div className="ev-stat-card ev-highlight">
          <span className="ev-stat-label">Net Salary</span>
          <span className="ev-stat-value ev-big">{fmt(totalNet)}</span>
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

      <p className="ev-note">Only active time counts toward your salary. Idle periods are automatically deducted.</p>

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
            <span className="profile-field-label">Hourly Rate</span>
            <span className="profile-ro-value" style={{ color: 'var(--accent)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
              ${Number(fresh.hourly_rate) || 0}/hr
            </span>
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
    q: 'What is Net Salary?',
    a: 'Net Salary = (Total Hours × Hourly Rate) + Bonuses − Deductions. It is calculated in real time and updates every time your admin makes a change.',
  },
  {
    q: 'Can I see my bonus and fine history?',
    a: 'Yes — scroll down on the Dashboard to see the full Bonuses & Fines history with dates, amounts, and reasons.',
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
          <span className="bf-lh-amt">Amount</span>
        </div>
        {transactions.map(tx => (
          <div key={tx.id} className={`bf-row bf-row-${tx.type}`}>
            <span className="bf-row-date">
              <span className="bf-row-day">{new Date(tx.created_at).toLocaleDateString('en-US', { weekday: 'short' })}</span>
              <span className="bf-row-datenum">{new Date(tx.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            </span>
            <span className={`bf-badge bf-badge-${tx.type}`}>{tx.type === 'bonus' ? '+ Bonus' : '− Fine'}</span>
            <span className="bf-row-note">{tx.note || <span style={{ color: 'var(--text-muted)' }}>—</span>}</span>
            <span className={`bf-row-amt bf-amt-${tx.type}`}>
              {tx.type === 'bonus' ? '+' : '−'}{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(tx.amount)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
