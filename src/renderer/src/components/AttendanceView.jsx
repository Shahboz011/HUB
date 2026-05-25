import { useState, useEffect } from 'react'
import { ArrowLeft, ClipboardList, Clock, CalendarDays, DollarSign, PiggyBank, Camera } from 'lucide-react'
import { supabase } from '../lib/supabase'

const DEPT_COLORS = [
  '#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981',
  '#3b82f6','#14b8a6','#f97316','#ef4444','#06b6d4',
  '#84cc16','#a855f7','#0ea5e9','#f43f5e','#22d3ee',
]
function deptColor(dept) {
  if (!dept) return '#94a3b8'
  let hash = 0
  for (let i = 0; i < dept.length; i++) hash = dept.charCodeAt(i) + ((hash << 5) - hash)
  return DEPT_COLORS[Math.abs(hash) % DEPT_COLORS.length]
}

function fmt(v) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(v)
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
}
function fmtMonthYear(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function groupByMonth(sessions) {
  const groups = {}
  sessions.forEach(s => {
    const key = fmtMonthYear(s.started_at)
    if (!groups[key]) groups[key] = []
    groups[key].push(s)
  })
  return groups
}

export default function AttendanceView({ employee, onBack }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)

  const rate = Number(employee.hourly_rate) || 0
  const color = deptColor(employee.department)
  const initials = employee.full_name
    ? employee.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  useEffect(() => {
    supabase
      .from('work_sessions')
      .select('*')
      .eq('employee_id', employee.id)
      .order('started_at', { ascending: false })
      .then(({ data }) => { if (data) setSessions(data); setLoading(false) })
  }, [employee.id])

  const completed = sessions.filter(s => s.ended_at)
  const totalHours = completed.reduce((sum, s) => sum + (Number(s.duration_hours) || 0), 0)

  const now = new Date()
  const thisMonthSessions = completed.filter(s => {
    const d = new Date(s.started_at)
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  })
  const thisMonthHours = thisMonthSessions.reduce((sum, s) => sum + (Number(s.duration_hours) || 0), 0)

  const grouped = groupByMonth(sessions)

  return (
    <div className="att-wrap">

      {/* Top bar */}
      <div className="att-topbar">
        <button className="att-back-btn" onClick={onBack}>
          <ArrowLeft size={16} />
          All Employees
        </button>
        <span className="att-breadcrumb">Attendance History</span>
      </div>

      {/* Employee card */}
      <div className="att-emp-card">
        <div className="att-avatar" style={{ background: color + '18', border: `2px solid ${color}40`, color }}>
          {initials}
        </div>
        <div className="att-emp-info">
          <h2 className="att-emp-name">{employee.full_name || '—'}</h2>
          <div className="att-emp-meta">
            {employee.department && (
              <span className="att-dept-chip" style={{ background: color + '15', color, border: `1px solid ${color}30` }}>
                {employee.department}
              </span>
            )}
            {employee.position && <span className="att-position">{employee.position}</span>}
            <span className="att-rate-chip">${rate}/hr</span>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="att-stats">
        <div className="att-stat">
          <ClipboardList size={20} className="att-stat-icon" />
          <span className="att-stat-value">{completed.length}</span>
          <span className="att-stat-label">Total Sessions</span>
        </div>
        <div className="att-stat-divider" />
        <div className="att-stat">
          <Clock size={20} className="att-stat-icon" />
          <span className="att-stat-value">{totalHours.toFixed(1)}h</span>
          <span className="att-stat-label">Total Hours</span>
        </div>
        <div className="att-stat-divider" />
        <div className="att-stat">
          <CalendarDays size={20} className="att-stat-icon" />
          <span className="att-stat-value att-val-green">{thisMonthHours.toFixed(1)}h</span>
          <span className="att-stat-label">This Month</span>
        </div>
        <div className="att-stat-divider" />
        <div className="att-stat">
          <DollarSign size={20} className="att-stat-icon" />
          <span className="att-stat-value att-val-amber">{fmt(thisMonthHours * rate)}</span>
          <span className="att-stat-label">This Month Pay</span>
        </div>
        <div className="att-stat-divider" />
        <div className="att-stat">
          <PiggyBank size={20} className="att-stat-icon" />
          <span className="att-stat-value att-val-purple">{fmt(totalHours * rate)}</span>
          <span className="att-stat-label">All-Time Earnings</span>
        </div>
      </div>

      {/* Session list */}
      <div className="att-sessions-wrap">
        {loading ? (
          <div className="att-state">Loading sessions…</div>
        ) : sessions.length === 0 ? (
          <div className="att-state">No work sessions recorded yet for this employee.</div>
        ) : (
          Object.entries(grouped).map(([month, monthSessions]) => {
            const monthHours = monthSessions
              .filter(s => s.ended_at)
              .reduce((sum, s) => sum + (Number(s.duration_hours) || 0), 0)
            return (
              <div key={month} className="att-month-group">
                <div className="att-month-header">
                  <span className="att-month-label">{month}</span>
                  <span className="att-month-summary">{monthHours.toFixed(1)}h &nbsp;·&nbsp; {fmt(monthHours * rate)}</span>
                </div>

                <div className="att-session-table">
                  <div className="att-session-thead">
                    <span className="att-col-date">Date</span>
                    <span className="att-col-in">Clock In</span>
                    <span className="att-col-out">Clock Out</span>
                    <span className="att-col-dur">Duration</span>
                    <span className="att-col-earn">Earned</span>
                  </div>

                  {monthSessions.map((s, i) => {
                    const isActive = !s.ended_at
                    const hours = Number(s.duration_hours) || 0
                    const d = new Date(s.started_at)
                    return (
                      <div key={s.id} className={`att-session-row ${isActive ? 'att-row-active' : ''} ${i % 2 === 1 ? 'att-row-odd' : ''}`}>
                        <div className="att-col-date">
                          <span className="att-weekday">
                            {d.toLocaleDateString('en-US', { weekday: 'short' })}
                          </span>
                          <span className="att-datenum">
                            {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                        <div className="att-col-in att-time">{fmtTime(s.started_at)}</div>
                        <div className="att-col-out att-time">
                          {isActive
                            ? <span className="att-live-pill">● Live</span>
                            : fmtTime(s.ended_at)}
                        </div>
                        <div className="att-col-dur">
                          {isActive ? <span className="att-muted">—</span> : `${hours.toFixed(2)}h`}
                        </div>
                        <div className="att-col-earn">
                          {isActive
                            ? <span className="att-muted">In progress</span>
                            : <span className="att-earn-val">{fmt(hours * rate)}</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Bonuses & Fines */}
      <BonusFineSection employee={employee} />

      {/* Screenshots */}
      <ScreenshotsSection employeeId={employee.id} />
    </div>
  )
}

// ── Screenshots ──────────────────────────────────────────────────────────────
function ScreenshotsSection({ employeeId }) {
  const [screenshots, setScreenshots] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('screenshots')
        .select('*')
        .eq('employee_id', employeeId)
        .order('taken_at', { ascending: false })
        .limit(48)
      if (error || !data?.length) { setLoading(false); return }
      const signedUrls = window.electronAPI?.signScreenshotUrls
        ? await window.electronAPI.signScreenshotUrls(data.map(s => s.path))
        : null
      if (signedUrls) {
        setScreenshots(data.map((s, i) => ({ ...s, url: signedUrls[i] })).filter(s => s.url))
      }
      setLoading(false)
    }
    load()
  }, [employeeId])

  return (
    <div className="bf-wrap">
      <div className="bf-header">
        <h3 className="bf-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Camera size={15} />
          Screenshots
          {!loading && screenshots.length > 0 && (
            <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 13, marginLeft: 4 }}>
              {screenshots.length} captured
            </span>
          )}
        </h3>
      </div>

      {loading ? (
        <p className="bf-empty">Loading…</p>
      ) : screenshots.length === 0 ? (
        <p className="bf-empty">No screenshots yet — taken every 5 min while clocked in. Requires app v1.6.0+.</p>
      ) : (
        <div className="ss-grid">
          {screenshots.map(s => (
            <div key={s.id} className="ss-thumb-wrap" onClick={() => setExpanded(s)}>
              <img src={s.url} alt="" className="ss-thumb" />
              <span className="ss-thumb-time">
                {new Date(s.taken_at).toLocaleString('en-US', {
                  month: 'short', day: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </span>
            </div>
          ))}
        </div>
      )}

      {expanded && (
        <div className="ss-overlay" onClick={() => setExpanded(null)}>
          <div className="ss-overlay-inner" onClick={e => e.stopPropagation()}>
            <img src={expanded.url} alt="" className="ss-full-img" />
            <div className="ss-full-meta">
              {new Date(expanded.taken_at).toLocaleString('en-US', {
                weekday: 'long', month: 'long', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            </div>
            <button className="ss-close-btn" onClick={() => setExpanded(null)}>✕ Close</button>
          </div>
        </div>
      )}
    </div>
  )
}

function BonusFineSection({ employee }) {
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [type, setType] = useState('bonus')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [localTotals, setLocalTotals] = useState({ bonuses: Number(employee.bonuses) || 0, fines: Number(employee.fines) || 0 })

  useEffect(() => {
    supabase.from('transactions')
      .select('*').eq('employee_id', employee.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setTransactions(data); setLoading(false) })
  }, [employee.id])

  async function addTransaction() {
    const amt = Number(amount)
    if (!amt || amt <= 0) { setError('Enter a valid amount'); return }
    setError(''); setSaving(true)
    const { data: tx, error: err } = await supabase
      .from('transactions')
      .insert({ employee_id: employee.id, type, amount: amt, note: note.trim() })
      .select().single()
    if (err) { setError(err.message); setSaving(false); return }

    // Update profile aggregate
    const field = type === 'bonus' ? 'bonuses' : 'fines'
    setLocalTotals(prev => {
      const next = { ...prev, [field]: prev[field] + amt }
      supabase.from('profiles').update({ [field]: next[field] }).eq('id', employee.id)
      return next
    })

    setTransactions(prev => [tx, ...prev])
    setAmount(''); setNote('')
    setSaving(false)
  }

  const totalBonus = localTotals.bonuses
  const totalFine  = localTotals.fines

  return (
    <div className="bf-wrap">
      <div className="bf-header">
        <h3 className="bf-title">Bonuses &amp; Fines</h3>
        <div className="bf-totals">
          <span className="bf-total-bonus">+{fmt(totalBonus)} bonuses</span>
          <span className="bf-total-fine">−{fmt(totalFine)} fines</span>
        </div>
      </div>

      {/* Add form */}
      <div className="bf-add-form">
        <select value={type} onChange={e => setType(e.target.value)} className={`bf-type-select bf-type-${type}`}>
          <option value="bonus">Bonus</option>
          <option value="fine">Fine</option>
        </select>
        <div className="bf-amount-wrap">
          <span className="bf-dollar">$</span>
          <input
            type="number" min="0.01" step="0.01"
            value={amount} onChange={e => { setAmount(e.target.value); setError('') }}
            placeholder="0.00" className="bf-amount-input"
          />
        </div>
        <input
          type="text" value={note} onChange={e => setNote(e.target.value)}
          placeholder="Reason (e.g. Performance bonus, Late arrival)"
          className="bf-note-input"
          onKeyDown={e => e.key === 'Enter' && addTransaction()}
        />
        <button
          className={`bf-add-btn bf-add-${type}`}
          onClick={addTransaction} disabled={saving || !amount}
        >
          {saving ? '…' : `Add ${type === 'bonus' ? 'Bonus' : 'Fine'}`}
        </button>
      </div>
      {error && <p className="bf-error">{error}</p>}

      {/* History */}
      {loading ? (
        <p className="bf-empty">Loading…</p>
      ) : transactions.length === 0 ? (
        <p className="bf-empty">No bonuses or fines recorded yet.</p>
      ) : (
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
                {tx.type === 'bonus' ? '+' : '−'}{fmt(tx.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
