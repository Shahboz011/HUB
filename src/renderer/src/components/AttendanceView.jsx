import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, ClipboardList, Clock, CalendarDays, DollarSign, PiggyBank, Camera, RefreshCw, XCircle, ChevronDown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { callEdgeFn, fetchScreenshotUrls } from '../lib/edgeFunctions'
import UserAvatar from './UserAvatar'

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

const NY = 'America/New_York'

function fmt(v) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(v)
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: NY })
}
function fmtMonthYear(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: NY })
}
function nyMonthYear(d) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: NY, year: 'numeric', month: 'numeric' }).formatToParts(d)
  return { month: +parts.find(p => p.type === 'month').value, year: +parts.find(p => p.type === 'year').value }
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
  const [sessionError, setSessionError] = useState('')
  const [closingSessionId, setClosingSessionId] = useState(null)

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
      .then(({ data, error }) => {
        if (!error && data) setSessions(data)
        setLoading(false)
      })
  }, [employee.id])

  async function closeSession(session) {
    const now = new Date()
    const totalSecs = (now - new Date(session.started_at)) / 1000
    const durationHours = totalSecs / 3600
    const hrs = Math.floor(durationHours)
    const mins = Math.round((durationHours - hrs) * 60)
    const durationLabel = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`

    const confirmed = window.confirm(
      `Close session for ${employee.full_name || employee.email}?\n\nElapsed: ${durationLabel} (wall-clock time since clock-in).\nThis will be saved as their worked duration.\n\nClick OK to confirm.`
    )
    if (!confirmed) return

    setClosingSessionId(session.id)
    setSessionError('')

    const { error: sessionErr } = await supabase.from('work_sessions').update({
      ended_at: now.toISOString(),
      duration_hours: durationHours,
    }).eq('id', session.id)

    if (sessionErr) {
      setSessionError(`Failed to close session: ${sessionErr.message}`)
      setClosingSessionId(null)
      return
    }

    const newHours = Number(employee.hours_worked) + durationHours
    const { error: profileErr } = await supabase.from('profiles').update({ hours_worked: newHours }).eq('id', employee.id)
    if (profileErr) {
      setSessionError(`Session closed but hours update failed: ${profileErr.message}`)
    }

    setSessions(prev => prev.map(s =>
      s.id === session.id ? { ...s, ended_at: now.toISOString(), duration_hours: durationHours } : s
    ))
    setClosingSessionId(null)
  }

  const completed = sessions.filter(s => s.ended_at)
  const totalHours = completed.reduce((sum, s) => sum + (Number(s.duration_hours) || 0), 0)

  const nowNY = nyMonthYear(new Date())
  const thisMonthSessions = completed.filter(s => {
    const p = nyMonthYear(new Date(s.started_at))
    return p.month === nowNY.month && p.year === nowNY.year
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
        <UserAvatar userId={employee.id} name={employee.full_name} avatarUrl={employee.avatar_url}
          className="att-avatar" style={{ background: color + '18', border: `2px solid ${color}40`, color }} />
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
          <span className="att-stat-value att-val-purple">{fmt(Math.max(0, totalHours * rate + Number(employee.bonuses) - Number(employee.fines)))}</span>
          <span className="att-stat-label">All-Time Earnings</span>
        </div>
      </div>

      {sessionError && (
        <p className="bf-error" style={{ margin: '8px 0 0' }}>{sessionError}</p>
      )}

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
                    <span style={{ width: 110 }} />
                  </div>

                  {monthSessions.map((s, i) => {
                    const isActive = !s.ended_at
                    const hours = Number(s.duration_hours) || 0
                    const d = new Date(s.started_at)
                    return (
                      <div key={s.id} className={`att-session-row ${isActive ? 'att-row-active' : ''} ${i % 2 === 1 ? 'att-row-odd' : ''}`}>
                        <div className="att-col-date">
                          <span className="att-weekday">
                            {d.toLocaleDateString('en-US', { weekday: 'short', timeZone: NY })}
                          </span>
                          <span className="att-datenum">
                            {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: NY })}
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
                        <div style={{ width: 110, display: 'flex', justifyContent: 'flex-end' }}>
                          {isActive && (
                            <button
                              className="dept-remove-btn"
                              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--negative)', opacity: closingSessionId === s.id ? 0.5 : 1 }}
                              onClick={() => closeSession(s)}
                              disabled={closingSessionId !== null}
                              title="Close this session on behalf of the employee"
                            >
                              <XCircle size={12} />
                              {closingSessionId === s.id ? 'Closing…' : 'Close Session'}
                            </button>
                          )}
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
  const [refreshing, setRefreshing] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [isOpen, setIsOpen] = useState(false)

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)

    const { data, error } = await supabase
      .from('screenshots')
      .select('*')
      .eq('employee_id', employeeId)
      .order('taken_at', { ascending: false })
      .limit(48)

    if (!error && data?.length) {
      const signedUrls = await fetchScreenshotUrls(data.map(s => s.path))
      setScreenshots(data.map((s, i) => ({ ...s, url: signedUrls[i] })).filter(s => s.url))
    } else if (!isRefresh) {
      setScreenshots([])
    }

    setLoading(false)
    setRefreshing(false)
  }, [employeeId])

  useEffect(() => { load(false) }, [load])

  return (
    <div className="bf-wrap">
      <div
        className={`bf-header sr-dept-header-clickable ${isOpen ? 'sr-dept-header-open' : ''}`}
        onClick={() => setIsOpen(o => !o)}
      >
        <h3 className="bf-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ChevronDown size={14} className={`sr-dept-chevron ${isOpen ? 'sr-dept-chevron-open' : ''}`} />
          <Camera size={15} />
          Screenshots
          {!loading && screenshots.length > 0 && (
            <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 13, marginLeft: 4 }}>
              {screenshots.length} captured
            </span>
          )}
        </h3>
        <button
          onClick={e => { e.stopPropagation(); load(true) }}
          disabled={loading || refreshing}
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: (loading || refreshing) ? 'default' : 'pointer', padding: '2px 6px' }}
          title="Refresh screenshots"
        >
          <RefreshCw size={13} style={{ opacity: (loading || refreshing) ? 0.4 : 1 }} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {isOpen && (loading ? (
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
                  hour: '2-digit', minute: '2-digit', timeZone: NY,
                })}
              </span>
              {(s.active_app || s.window_title) && (
                <div className="ss-window-info">
                  {s.active_app && <span className="ss-app-name">{s.active_app}</span>}
                  {s.window_title && <span className="ss-win-title">{s.window_title}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}

      {expanded && (
        <div className="ss-overlay" onClick={() => setExpanded(null)}>
          <div className="ss-overlay-inner" onClick={e => e.stopPropagation()}>
            <img src={expanded.url} alt="" className="ss-full-img" />
            <div className="ss-full-meta">
              {new Date(expanded.taken_at).toLocaleString('en-US', {
                weekday: 'long', month: 'long', day: 'numeric',
                hour: '2-digit', minute: '2-digit', timeZone: NY,
              })}
            </div>
            {(expanded.active_app || expanded.window_title) && (
              <div className="ss-meta-window">
                {expanded.active_app && <div className="ss-meta-app">{expanded.active_app}</div>}
                {expanded.window_title && <div className="ss-meta-win">{expanded.window_title}</div>}
              </div>
            )}
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
  const [expandedTxId, setExpandedTxId] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [editTxId, setEditTxId] = useState(null)
  const [editAmount, setEditAmount] = useState('')
  const [editNote, setEditNote] = useState('')
  const [secPrompt, setSecPrompt] = useState(null) // { action: 'delete'|'edit', tx }
  const [confirmWord, setConfirmWord] = useState('')

  useEffect(() => {
    if (!expandedTxId) return
    const timer = setTimeout(() => {
      const el = document.querySelector('.bf-row-expanded')
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 80)
    return () => clearTimeout(timer)
  }, [expandedTxId])
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

    let tx, errMsg
    {
      const result = await callEdgeFn('admin-manage-transaction', { action: 'insert', employee_id: employee.id, type, amount: amt, note: note.trim() })
      if (!result.ok) { setError(result.error || 'Failed to save'); setSaving(false); return }
      tx = result.tx
    }

    const field = type === 'bonus' ? 'bonuses' : 'fines'
    const next = { ...localTotals, [field]: localTotals[field] + amt }
    setLocalTotals(next)
    await supabase.from('profiles').update({ [field]: next[field] }).eq('id', employee.id)

    setTransactions(prev => [tx, ...prev])
    setAmount(''); setNote('')
    setSaving(false)
  }

  async function deleteTransaction(tx) {
    await callEdgeFn('admin-manage-transaction', { action: 'delete', txId: tx.id })
    const field = tx.type === 'bonus' ? 'bonuses' : 'fines'
    const newTotal = Math.max(0, localTotals[field] - tx.amount)
    setLocalTotals(prev => ({ ...prev, [field]: newTotal }))
    await supabase.from('profiles').update({ [field]: newTotal }).eq('id', employee.id)
    setTransactions(prev => prev.filter(t => t.id !== tx.id))
  }

  function initiateDelete(tx) {
    setSecPrompt({ action: 'delete', tx })
    setConfirmWord('')
    setEditTxId(null)
  }

  function initiateEdit(tx) {
    setEditTxId(tx.id)
    setEditAmount(String(tx.amount))
    setEditNote(tx.note || '')
    setSecPrompt(null)
    setConfirmWord('')
  }

  function initiateEditSave(tx) {
    setSecPrompt({ action: 'edit', tx })
    setConfirmWord('')
  }

  function cancelSec() {
    setSecPrompt(null)
    setConfirmWord('')
    setEditTxId(null)
  }

  async function commitAction() {
    if (confirmWord !== 'CONFIRM') return
    const { action, tx } = secPrompt
    if (action === 'delete') {
      await deleteTransaction(tx)
      setExpandedTxId(null)
    } else {
      const amt = Number(editAmount)
      if (!amt || amt <= 0) return
      const field = tx.type === 'bonus' ? 'bonuses' : 'fines'
      const diff = amt - tx.amount
      await callEdgeFn('admin-manage-transaction', { action: 'update', txId: tx.id, fields: { amount: amt, note: editNote.trim() } })
      const newTotal = Math.max(0, localTotals[field] + diff)
      setLocalTotals(prev => ({ ...prev, [field]: newTotal }))
      await supabase.from('profiles').update({ [field]: newTotal }).eq('id', employee.id)
      setTransactions(prev => prev.map(t => t.id === tx.id ? { ...t, amount: amt, note: editNote.trim() } : t))
      setEditTxId(null)
    }
    setSecPrompt(null)
    setConfirmWord('')
  }

  const totalBonus = localTotals.bonuses
  const totalFine  = localTotals.fines

  return (
    <div className="bf-wrap">
      <div className="bf-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 className="bf-title">Bonuses &amp; Fines</h3>
          {transactions.length > 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>
              {transactions.length} {transactions.length === 1 ? 'entry' : 'entries'}
            </span>
          )}
        </div>
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
            <span style={{ width: 36 }} />
          </div>
          <div className="bf-list-scroll" style={{ maxHeight: showAll ? 'none' : '220px', overflow: showAll ? 'visible' : 'hidden' }}>
              {transactions.map(tx => {
                const isOpen = expandedTxId === tx.id
                const d = new Date(tx.created_at)
                return (
                  <div key={tx.id} className={`bf-row bf-row-${tx.type} ${isOpen ? 'bf-row-expanded' : ''}`}>
                    {/* Collapsed row — click anywhere to expand */}
                    <div
                      className="bf-row-summary"
                      onClick={() => { setExpandedTxId(isOpen ? null : tx.id); setSecPrompt(null); setConfirmWord('') }}
                    >
                      <span className="bf-row-date">
                        <span className="bf-row-day">{d.toLocaleDateString('en-US', { weekday: 'short', timeZone: NY })}</span>
                        <span className="bf-row-datenum">{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: NY })}</span>
                      </span>
                      <span className={`bf-badge bf-badge-${tx.type}`}>{tx.type === 'bonus' ? '+ Bonus' : '− Fine'}</span>
                      <span className="bf-row-note">{tx.note || <span style={{ color: 'var(--text-muted)' }}>—</span>}</span>
                      <span className={`bf-row-amt bf-amt-${tx.type}`}>
                        {tx.type === 'bonus' ? '+' : '−'}{fmt(tx.amount)}
                      </span>
                      <span style={{ width: 36, display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
                        <ChevronDown size={14} style={{ color: 'var(--text-muted)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
                      </span>
                    </div>

                    {/* Expanded detail card */}
                    {isOpen && (
                      <div className="bf-row-detail">
                        <div className="bf-detail-amount" style={{ color: tx.type === 'bonus' ? 'var(--positive)' : 'var(--negative)' }}>
                          {tx.type === 'bonus' ? '+' : '−'}{fmt(tx.amount)}
                        </div>
                        <div className="bf-detail-meta">
                          <span className={`bf-badge bf-badge-${tx.type}`} style={{ fontSize: 12, padding: '3px 10px' }}>
                            {tx.type === 'bonus' ? 'Bonus' : 'Fine'}
                          </span>
                          <span className="bf-detail-date">
                            {d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: NY })}
                            {' · '}
                            {d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: NY })}
                          </span>
                        </div>
                        {editTxId === tx.id ? (
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                            <div className="bf-amount-wrap" style={{ minWidth: 'unset' }}>
                              <span className="bf-dollar">$</span>
                              <input type="number" min="0.01" step="0.01" value={editAmount} onChange={e => setEditAmount(e.target.value)} className="bf-amount-input" style={{ width: 70 }} />
                            </div>
                            <input type="text" value={editNote} onChange={e => setEditNote(e.target.value)} placeholder="Reason" className="bf-note-input" style={{ flex: 1, minWidth: 140 }} />
                            <button className={`bf-add-btn bf-add-${tx.type}`} style={{ padding: '5px 14px', fontSize: 12 }} onClick={() => initiateEditSave(tx)} disabled={!editAmount || Number(editAmount) <= 0}>Save</button>
                            <button className="dept-remove-btn" style={{ fontSize: 12, padding: '5px 10px' }} onClick={cancelSec}>Cancel</button>
                          </div>
                        ) : (
                          <>
                            {tx.note && <div className="bf-detail-note">"{tx.note}"</div>}
                            <div className="bf-detail-actions" style={{ display: 'flex', gap: 6 }}>
                              <button className="dept-remove-btn" style={{ fontSize: 12, padding: '5px 12px' }} onClick={() => initiateEdit(tx)}>Edit entry</button>
                              <button className="dept-remove-btn dept-delete-icon-btn" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '5px 12px' }} onClick={() => initiateDelete(tx)}>
                                <Trash2 size={13} />
                                Delete entry
                              </button>
                            </div>
                          </>
                        )}
                        {secPrompt?.tx.id === tx.id && (
                          <div className="bf-sec-prompt">
                            <p className="bf-sec-label">
                              {secPrompt.action === 'delete' ? 'Permanently delete this entry?' : 'Save changes to this entry?'}
                              {' '}Type <code className="bf-sec-code">CONFIRM</code> to proceed.
                            </p>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <input
                                type="text" value={confirmWord} autoFocus
                                onChange={e => setConfirmWord(e.target.value.toUpperCase())}
                                onKeyDown={e => e.key === 'Enter' && commitAction()}
                                placeholder="CONFIRM" className="bf-confirm-input"
                              />
                              <button className="dept-remove-btn dept-delete-confirm-btn" style={{ fontSize: 12, padding: '6px 14px', opacity: confirmWord === 'CONFIRM' ? 1 : 0.4 }} onClick={commitAction} disabled={confirmWord !== 'CONFIRM'}>Proceed</button>
                              <button className="dept-remove-btn" style={{ fontSize: 12, padding: '6px 14px' }} onClick={cancelSec}>Cancel</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {transactions.length > 3 && (
              <button className="bf-show-more" onClick={() => setShowAll(a => !a)}>
                {showAll ? 'Show Less' : `View All ${transactions.length} entries`}
              </button>
            )}
          </div>
        )}
    </div>
  )
}
