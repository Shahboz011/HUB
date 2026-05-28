import { useState, useEffect } from 'react'
import { X, Mail, Briefcase, Building2, DollarSign, Clock, Activity, TrendingUp, Coffee } from 'lucide-react'
import { supabase } from '../lib/supabase'
import UserAvatar from './UserAvatar'

const NY = 'America/New_York'

const STATUS_STYLE = {
  working:  { bg: '#d1fae5', color: '#059669', dot: '#059669' },
  break:    { bg: '#dbeafe', color: '#3b82f6', dot: '#3b82f6' },
  restroom: { bg: '#e0f2fe', color: '#0284c7', dot: '#0284c7' },
  lunch:    { bg: '#ffedd5', color: '#f97316', dot: '#f97316' },
  pray:     { bg: '#faf5ff', color: '#9333ea', dot: '#a855f7' },
  idle:     { bg: '#fef3c7', color: '#d97706', dot: '#f59e0b' },
  offline:  { bg: '#f1f5f9', color: '#94a3b8', dot: '#cbd5e1' },
}

function deptColor(dept) {
  const COLORS = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#14b8a6','#f97316','#ef4444','#06b6d4']
  if (!dept) return '#94a3b8'
  let h = 0
  for (let i = 0; i < dept.length; i++) h = dept.charCodeAt(i) + ((h << 5) - h)
  return COLORS[Math.abs(h) % COLORS.length]
}

function fmtDur(totalSecs) {
  const secs = Math.floor(totalSecs || 0)
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  if (m < 60) return `${m}m ${String(s).padStart(2, '0')}s`
  const h = Math.floor(m / 60); const rm = m % 60
  return `${h}h ${String(rm).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: NY })
}

function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: NY })
}

function InfoRow({ icon, label, value, valueColor }) {
  return (
    <div className="wpm-info-row">
      <span className="wpm-info-icon">{icon}</span>
      <span className="wpm-info-label">{label}</span>
      <span className="wpm-info-value" style={valueColor ? { color: valueColor, fontWeight: 600 } : {}}>{value}</span>
    </div>
  )
}

export default function WorkerProfileModal({ emp, session, status, onClose, hideSalary = false }) {
  const [sessions,     setSessions]     = useState([])
  const [transactions, setTransactions] = useState([])
  const [loading,      setLoading]      = useState(true)

  useEffect(() => {
    if (!emp?.id) return
    setLoading(true)
    Promise.all([
      supabase.from('work_sessions')
        .select('id, started_at, ended_at, salary_start_at, accumulated_idle_secs, accumulated_unpaid_break_secs, break_count, lunch_used')
        .eq('employee_id', emp.id)
        .order('started_at', { ascending: false })
        .limit(8),
      supabase.from('transactions')
        .select('id, type, amount, note, created_at')
        .eq('employee_id', emp.id)
        .order('created_at', { ascending: false })
        .limit(6),
    ]).then(([{ data: sess }, { data: txns }]) => {
      setSessions(sess || [])
      setTransactions(txns || [])
      setLoading(false)
    })
  }, [emp?.id])

  if (!emp) return null

  const rate       = Number(emp.hourly_rate)  || 0
  const totalHours = Number(emp.hours_worked) || 0
  const color      = deptColor(emp.department)
  const st         = STATUS_STYLE[status?.type] || STATUS_STYLE.offline

  // ── Today's live session stats ──
  let sessionElapsed = 0, activeSecs = 0, actPct = null, earnedToday = 0
  let breakCount = 0, idleTodaySecs = 0
  if (session) {
    const salaryStart  = session.salary_start_at || session.started_at
    sessionElapsed     = Math.max(0, (Date.now() - new Date(salaryStart).getTime()) / 1000)
    const unpaidIdle   = Number(session.accumulated_idle_secs)         || 0
    const unpaidBreak  = Number(session.accumulated_unpaid_break_secs) || 0
    idleTodaySecs      = unpaidIdle
    activeSecs         = Math.max(0, sessionElapsed - unpaidIdle - unpaidBreak)
    actPct             = sessionElapsed > 30 ? Math.round((activeSecs / sessionElapsed) * 100) : 100
    earnedToday        = (activeSecs / 3600) * rate
    breakCount         = Number(session.break_count) || 0
  }

  const pastSessions = sessions.filter(s => s.ended_at)

  return (
    <div className="wpm-overlay" onClick={onClose}>
      <div className="wpm-drawer" onClick={e => e.stopPropagation()}>

        {/* ── Close ── */}
        <button className="wpm-close" onClick={onClose}><X size={16} /></button>

        {/* ── Header ── */}
        <div className="wpm-header">
          <UserAvatar
            userId={emp.id}
            name={emp.full_name}
            avatarUrl={emp.avatar_url}
            className="wpm-avatar"
            style={{ background: color + '20', color, border: `2px solid ${color}40` }}
          />
          <div className="wpm-header-body">
            <div className="wpm-name">{emp.full_name || '(no name)'}</div>
            <div className="wpm-email">{emp.email}</div>
            <span className="wpm-status-badge" style={{ background: st.bg, color: st.color }}>
              <span className="wpm-status-dot" style={{ background: st.dot }} />
              {status?.label || 'Offline'}
            </span>
          </div>
        </div>

        {/* ── Profile info ── */}
        <div className="wpm-section">
          <InfoRow icon={<Building2 size={13} />}  label="Department"   value={emp.department || '—'} />
          <InfoRow icon={<Briefcase size={13} />}  label="Position"     value={emp.position   || '—'} />
          {!hideSalary && <InfoRow icon={<DollarSign size={13} />} label="Hourly Rate"  value={`$${rate.toFixed(2)}/hr`} valueColor="#059669" />}
          <InfoRow icon={<Clock size={13} />}      label="Total Hours"  value={`${totalHours.toFixed(2)}h`} />
        </div>

        {/* ── Today's session ── */}
        {session && (
          <div className="wpm-section">
            <div className="wpm-section-title">📍 Today's Session</div>
            <div className="wpm-today-grid">
              <div className="wpm-today-cell">
                <span className="wpm-today-val">{fmtDur(sessionElapsed)}</span>
                <span className="wpm-today-lbl">Session time</span>
              </div>
              {!hideSalary && (
              <div className="wpm-today-cell">
                <span className="wpm-today-val" style={{ color: '#059669' }}>${earnedToday.toFixed(2)}</span>
                <span className="wpm-today-lbl">Earned today</span>
              </div>
              )}
              <div className="wpm-today-cell">
                <span className="wpm-today-val" style={{ color: actPct >= 80 ? '#059669' : actPct >= 50 ? '#f59e0b' : '#ef4444' }}>{actPct}%</span>
                <span className="wpm-today-lbl">Activity</span>
              </div>
              <div className="wpm-today-cell">
                <span className="wpm-today-val">{breakCount}/2</span>
                <span className="wpm-today-lbl">Breaks used</span>
              </div>
            </div>
            <div className="wpm-pool-row">
              <span className="wpm-pool-label">⏸ Idle time today</span>
              <span className="wpm-pool-val" style={{ color: idleTodaySecs > 1800 ? '#ef4444' : idleTodaySecs > 0 ? '#d97706' : '#64748b' }}>
                {idleTodaySecs > 0 ? fmtDur(idleTodaySecs) : '—'}
              </span>
            </div>
          </div>
        )}

        {/* ── Recent sessions ── */}
        <div className="wpm-section">
          <div className="wpm-section-title"><TrendingUp size={13} style={{ display: 'inline', marginRight: 4 }} />Recent Sessions</div>
          {loading ? (
            <div className="wpm-loading">Loading…</div>
          ) : pastSessions.length === 0 ? (
            <div className="wpm-empty">No past sessions yet.</div>
          ) : (
            <div className="wpm-sess-list">
              <div className={`wpm-sess-head${hideSalary ? ' wpm-sess-no-salary' : ''}`}>
                <span>Date</span><span>Active</span><span>Idle</span>{!hideSalary && <span>Earned</span>}
              </div>
              {pastSessions.map(s => {
                const salStart = s.salary_start_at || s.started_at
                const wallSecs = Math.max(0, (new Date(s.ended_at) - new Date(salStart)) / 1000)
                const uIdle    = Number(s.accumulated_idle_secs)         || 0
                const uBreak   = Number(s.accumulated_unpaid_break_secs) || 0
                const paid     = Math.max(0, wallSecs - uIdle - uBreak)
                const earned   = (paid / 3600) * rate
                return (
                  <div key={s.id} className={`wpm-sess-row${hideSalary ? ' wpm-sess-no-salary' : ''}`}>
                    <span>{fmtDate(s.started_at)}<br /><span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{fmtTime(s.started_at)}</span></span>
                    <span>{fmtDur(paid)}</span>
                    <span style={{ color: uIdle > 0 ? '#d97706' : 'var(--text-muted)', fontWeight: uIdle > 0 ? 600 : 400 }}>
                      {uIdle > 0 ? fmtDur(uIdle) : '—'}
                    </span>
                    {!hideSalary && <span style={{ color: '#059669', fontWeight: 600 }}>${earned.toFixed(2)}</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Bonuses & fines ── */}
        {!hideSalary && !loading && transactions.length > 0 && (
          <div className="wpm-section">
            <div className="wpm-section-title"><Coffee size={13} style={{ display: 'inline', marginRight: 4 }} />Bonuses &amp; Fines</div>
            <div className="wpm-tx-list">
              {transactions.map(tx => (
                <div key={tx.id} className={`wpm-tx-row wpm-tx-${tx.type}`}>
                  <span className={`wpm-tx-badge wpm-tx-badge-${tx.type}`}>
                    {tx.type === 'bonus' ? '+ Bonus' : '− Fine'}
                  </span>
                  <span className="wpm-tx-note">{tx.note || '—'}</span>
                  <span className="wpm-tx-date">{fmtDate(tx.created_at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!hideSalary && !loading && transactions.length === 0 && (
          <div className="wpm-section">
            <div className="wpm-section-title">Bonuses &amp; Fines</div>
            <div className="wpm-empty">No transactions recorded.</div>
          </div>
        )}

      </div>
    </div>
  )
}
