import { useState, useEffect, Fragment } from 'react'
import { Users, Wifi, Coffee, WifiOff, TrendingUp, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { ServerClockCompact } from './ServerClock'
import UserAvatar from './UserAvatar'
import WorkerProfileModal from './WorkerProfileModal'

const NY = 'America/New_York'

const DEPT_COLORS = [
  '#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981',
  '#3b82f6','#14b8a6','#f97316','#ef4444','#06b6d4',
  '#84cc16','#a855f7','#0ea5e9','#f43f5e','#22d3ee',
]

function deptColor(dept) {
  if (!dept) return '#94a3b8'
  let h = 0
  for (let i = 0; i < dept.length; i++) h = dept.charCodeAt(i) + ((h << 5) - h)
  return DEPT_COLORS[Math.abs(h) % DEPT_COLORS.length]
}

function initials(name) {
  return name ? name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?'
}

function getStatus(empId, activeSessions, activityMap) {
  const session = activeSessions[empId]
  if (!session) return { type: 'offline', label: 'Offline', startedAt: null }
  const live = activityMap[empId]
  const breakStatus = live ? live.break_status : session.break_status
  const isIdle      = live ? live.is_idle      : session.is_idle
  // For timestamps: prefer DB (always accurate, survives refresh) then broadcast ts as fallback
  const breakStart = session.break_started_at || (live?.ts ?? null)
  const idleStart  = session.idle_started_at  || (live?.ts ?? null)
  if (breakStatus === 'break')    return { type: 'break',    label: 'Break/Lunch', startedAt: breakStart }
  if (breakStatus === 'restroom') return { type: 'restroom', label: 'Rest Room',   startedAt: breakStart }
  if (breakStatus === 'pray')     return { type: 'pray',     label: 'Praying',     startedAt: breakStart }
  if (breakStatus === 'coffee')   return { type: 'coffee',   label: 'Coffee Break',startedAt: breakStart }
  if (isIdle)                     return { type: 'idle',     label: 'Idle',        startedAt: idleStart  }
  return { type: 'working', label: 'Working', startedAt: session.started_at }
}

const STATUS_STYLE = {
  working:  { bg: '#d1fae5', color: '#059669', dot: '#059669' },
  break:    { bg: '#dbeafe', color: '#3b82f6', dot: '#3b82f6' },
  restroom: { bg: '#e0f2fe', color: '#0284c7', dot: '#0284c7' },
  pray:     { bg: '#faf5ff', color: '#9333ea', dot: '#a855f7' },
  coffee:   { bg: '#fef9c3', color: '#ca8a04', dot: '#eab308' },
  idle:     { bg: '#fef3c7', color: '#d97706', dot: '#f59e0b' },
  offline:  { bg: '#f1f5f9', color: '#94a3b8', dot: '#cbd5e1' },
}

// Compact elapsed: "4m 12s" / "1h 23m" — handles both ISO strings and ms timestamps
function elapsedShort(startedAt) {
  if (!startedAt) return ''
  const t = typeof startedAt === 'number' ? startedAt : new Date(startedAt).getTime()
  const secs = Math.max(0, Math.floor((Date.now() - t) / 1000))
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

function fmtTime(isoStr) {
  if (!isoStr) return ''
  return new Date(isoStr).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York',
  })
}

function fmtDur(totalSecs) {
  const secs = Math.floor(totalSecs || 0)
  const m = Math.floor(secs / 60)
  const s = secs % 60
  if (m === 0) return `${s}s`
  if (m < 60) return `${m}m ${String(s).padStart(2, '0')}s`
  const h = Math.floor(m / 60); const rm = m % 60
  return `${h}h ${String(rm).padStart(2, '0')}m`
}

const BREAK_LABELS = { break: '🍽 Break/Lunch', restroom: '🚶 Restroom', pray: '🙏 Pray', coffee: '☕ Coffee' }

function BreakHistoryRow({ emp, breakLogItems }) {
  return (
    <div className="adash-break-hist-row">
      <div className="adash-break-hist-inner">
        <div className="adash-break-hist-title">
          Break History — <strong>{emp.full_name || emp.email}</strong>
          <span className="adash-break-hist-badge">Today</span>
        </div>

        {breakLogItems.length === 0 ? (
          <p className="adash-break-hist-empty">No break events logged today.</p>
        ) : (
          <div className="adash-break-hist-list">
            <div className="adash-break-hist-head">
              <span className="adash-bhh-time">Time</span>
              <span className="adash-bhh-type">Type</span>
              <span className="adash-bhh-dur">Duration</span>
              <span className="adash-bhh-pay">Pay</span>
            </div>
            {breakLogItems.map(evt => {
              const isFullPaid = Number(evt.paid_secs) >= Number(evt.duration_secs)
              const isUnpaid = Number(evt.paid_secs) === 0
              return (
                <div key={evt.id} className="adash-break-hist-item">
                  <span className="adash-bhi-time">{fmtTime(evt.started_at)}</span>
                  <span className={`adash-bhi-type adash-bhi-${evt.break_type}`}>
                    {BREAK_LABELS[evt.break_type] || evt.break_type}
                  </span>
                  <span className="adash-bhi-dur">{fmtDur(evt.duration_secs)}</span>
                  <span className={`adash-bhi-paid ${isFullPaid ? 'adash-bhi-paid-full' : isUnpaid ? 'adash-bhi-paid-no' : 'adash-bhi-paid-partial'}`}>
                    {isFullPaid ? '✓ Paid'
                      : isUnpaid ? 'Unpaid'
                      : `${fmtDur(evt.paid_secs)} paid`}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ type, label, startedAt }) {
  const c = STATUS_STYLE[type] || STATUS_STYLE.offline
  const showDur = startedAt && type !== 'working' && type !== 'offline'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
      <span className="adash-status-badge" style={{ background: c.bg, color: c.color }}>
        <span className="adash-status-dot" style={{ background: c.dot }} />
        {label}
      </span>
      {showDur && (
        <span style={{ fontSize: 10, color: c.color, opacity: 0.85, paddingLeft: 3, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
          for {elapsedShort(startedAt)}
        </span>
      )}
    </div>
  )
}

function elapsed(startedAt) {
  const secs = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m ${String(Math.floor(secs % 60)).padStart(2, '0')}s`
}

function activityPct(session) {
  if (!session) return null
  const wall = (Date.now() - new Date(session.started_at).getTime()) / 1000
  if (wall < 30) return 100
  const idle = Number(session.accumulated_idle_secs) || 0
  const active = Math.max(0, wall - idle)
  return Math.round((active / wall) * 100)
}

export default function AdminDashboard({ adminName, managedDept, hideSalary = false }) {
  const [employees,     setEmployees]     = useState([])
  const [activeSessions, setActiveSessions] = useState({})
  const [activityMap,   setActivityMap]   = useState({})
  const [breakLog, setBreakLog] = useState([])
  const [expandedRow, setExpandedRow] = useState(null)
  const [selectedWorker, setSelectedWorker] = useState(null) // { emp, session, status }
  const [, setTick] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('work_sessions').select('*').is('ended_at', null),
    ]).then(([{ data: profs }, { data: sessions }]) => {
      if (profs) setEmployees(profs)
      if (sessions) {
        const m = {}; sessions.forEach(s => { m[s.employee_id] = s }); setActiveSessions(m)
      }
      setLoading(false)
    })

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    supabase.from('break_log')
      .select('*').gte('started_at', todayStart.toISOString())
      .order('started_at', { ascending: true })
      .then(({ data }) => { if (data) setBreakLog(data) })

    const profSub = supabase.channel('adash-profs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'profiles' },
        ({ new: r }) => setEmployees(p => [...p, r].sort((a, b) => (a.full_name||'').localeCompare(b.full_name||''))))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' },
        ({ new: r }) => setEmployees(p => p.map(e => e.id === r.id ? r : e)))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'profiles' },
        ({ old: r }) => setEmployees(p => p.filter(e => e.id !== r.id)))
      .subscribe()

    const sessSub = supabase.channel('adash-sess')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'work_sessions' },
        ({ new: r }) => { if (!r.ended_at) setActiveSessions(p => ({ ...p, [r.employee_id]: r })) })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'work_sessions' },
        ({ new: r }) => {
          if (r.ended_at) setActiveSessions(p => { const n = { ...p }; delete n[r.employee_id]; return n })
          else setActiveSessions(p => ({ ...p, [r.employee_id]: r }))
        })
      .subscribe()

    const actSub = supabase.channel('adash-activity')
      .on('broadcast', { event: 'status' }, ({ payload }) => {
        setActivityMap(p => ({ ...p, [payload.employee_id]: {
          is_idle: payload.is_idle, break_status: payload.break_status, ts: payload.ts
        }}))
      }).subscribe()

    const breakLogSub = supabase.channel('adash-breaklog')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'break_log' },
        ({ new: r }) => setBreakLog(prev => [...prev, r]))
      .subscribe()

    const poll = setInterval(async () => {
      const { data } = await supabase.from('work_sessions').select('*').is('ended_at', null)
      if (data) {
        setActiveSessions(prev => {
          const next = { ...prev }
          const polled = {}
          data.forEach(s => { polled[s.employee_id] = s })
          // Remove sessions that ended, merge in polled data without clobbering subscription updates
          Object.keys(next).forEach(id => { if (!polled[id]) delete next[id] })
          Object.entries(polled).forEach(([id, s]) => { next[id] = s })
          return next
        })
      }
    }, 30000)

    return () => {
      supabase.removeChannel(profSub)
      supabase.removeChannel(sessSub)
      supabase.removeChannel(actSub)
      supabase.removeChannel(breakLogSub)
      clearInterval(poll)
    }
  }, [])

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  if (loading) return <div className="adash-loading">Loading dashboard…</div>

  const visible = managedDept ? employees.filter(e => e.department === managedDept) : employees

  const breakLogByEmp = {}
  breakLog.forEach(b => {
    if (!breakLogByEmp[b.employee_id]) breakLogByEmp[b.employee_id] = []
    breakLogByEmp[b.employee_id].push(b)
  })

  const workingCount  = visible.filter(e => getStatus(e.id, activeSessions, activityMap).type === 'working').length
  const awayCount     = visible.filter(e => ['break','restroom','pray','coffee','idle'].includes(getStatus(e.id, activeSessions, activityMap).type)).length
  const offlineCount  = visible.filter(e => !activeSessions[e.id]).length

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: NY,
  })

  const ORDER = { working: 0, break: 1, restroom: 2, lunch: 3, pray: 4, idle: 5, offline: 6 }
  const sorted = [...visible].sort((a, b) =>
    ORDER[getStatus(a.id, activeSessions, activityMap).type] -
    ORDER[getStatus(b.id, activeSessions, activityMap).type]
  )

  return (
    <>
    <div className="adash">
      <div className="adash-header">
        <div>
          <h2 className="adash-title">Dashboard{managedDept ? ` — ${managedDept}` : ''}</h2>
          <p className="adash-welcome">Welcome back, <strong>{adminName}</strong>! Here's what's happening with your team today.</p>
        </div>
        <ServerClockCompact />
      </div>

      <div className="adash-stats">
        <div className="adash-stat-card">
          <div className="adash-stat-icon" style={{ background: '#6366f112', color: '#6366f1' }}><Users size={20} /></div>
          <div className="adash-stat-body">
            <span className="adash-stat-num">{visible.length}</span>
            <span className="adash-stat-lbl">My Team</span>
          </div>
        </div>
        <div className="adash-stat-card adash-stat-positive">
          <div className="adash-stat-icon" style={{ background: '#10b98112', color: '#10b981' }}><Wifi size={20} /></div>
          <div className="adash-stat-body">
            <span className="adash-stat-num" style={{ color: '#10b981' }}>{workingCount}</span>
            <span className="adash-stat-lbl">Active Now</span>
          </div>
        </div>
        <div className="adash-stat-card">
          <div className="adash-stat-icon" style={{ background: '#3b82f612', color: '#3b82f6' }}><Coffee size={20} /></div>
          <div className="adash-stat-body">
            <span className="adash-stat-num" style={{ color: '#3b82f6' }}>{awayCount}</span>
            <span className="adash-stat-lbl">On Break / Away</span>
          </div>
        </div>
        <div className="adash-stat-card">
          <div className="adash-stat-icon" style={{ background: '#94a3b812', color: '#94a3b8' }}><WifiOff size={20} /></div>
          <div className="adash-stat-body">
            <span className="adash-stat-num" style={{ color: '#94a3b8' }}>{offlineCount}</span>
            <span className="adash-stat-lbl">Offline</span>
          </div>
        </div>
      </div>

      <div className="adash-body">
        <div className="adash-team">
          <div className="adash-section-hd">
            <h3 className="adash-section-title">Team Overview</h3>
            <span className="adash-section-count">{visible.length} employees</span>
          </div>

          <div className="adash-table-wrap">
            <div className="adash-table-head">
              <span className="adash-th w-emp">Employee</span>
              <span className="adash-th w-dept">Department</span>
              <span className="adash-th w-status">Status</span>
              <span className="adash-th w-time">Session Time</span>
              <span className="adash-th w-breaks">Breaks</span>
              <span className="adash-th w-activity">Activity</span>
            </div>

            <div className="adash-table-body">
              {sorted.length === 0 ? (
                <div className="adash-empty">No employees yet.</div>
              ) : sorted.map((emp, i) => {
                const session = activeSessions[emp.id]
                const status  = getStatus(emp.id, activeSessions, activityMap)
                const color   = deptColor(emp.department)
                const pct     = activityPct(session)
                const breaks  = session ? (Number(session.break_count) || 0) : null
                const empBreakLog = breakLogByEmp[emp.id] || []
                const isExpanded  = expandedRow === emp.id

                return (
                  <Fragment key={emp.id}>
                    <div className={`adash-tr ${i % 2 === 0 ? '' : 'adash-tr-alt'}${isExpanded ? ' adash-tr-expanded' : ''}`}>
                      <div className="adash-td w-emp adash-td-clickable"
                        onClick={() => setSelectedWorker({ emp, session, status })}
                        title="View profile">
                        <UserAvatar userId={emp.id} name={emp.full_name} avatarUrl={emp.avatar_url}
                          className="adash-avatar" style={{ background: color + '18', color, border: `1.5px solid ${color}35` }} />
                        <div className="adash-emp-info">
                          <span className="adash-emp-name">{emp.full_name || '—'}</span>
                          <span className="adash-emp-email">{emp.email}</span>
                        </div>
                      </div>
                      <div className="adash-td w-dept">
                        {emp.department
                          ? <span className="adash-dept" style={{ background: color + '14', color, border: `1px solid ${color}28` }}>{emp.department}</span>
                          : <span className="adash-muted">—</span>}
                      </div>
                      <div className="adash-td w-status"><StatusBadge type={status.type} label={status.label} startedAt={status.startedAt} /></div>
                      <div className="adash-td w-time adash-mono">
                        {session ? elapsed(session.started_at) : <span className="adash-muted">—</span>}
                      </div>
                      <div className="adash-td w-breaks">
                        {session ? (
                          <div className="adash-breaks-cell">
                            <div className="adash-breaks-footer">
                              <span className={`adash-breaks ${breaks >= 2 ? 'adash-breaks-used' : ''}`}>{breaks}/2</span>
                              <button
                                className="adash-hist-btn"
                                onClick={(e) => { e.stopPropagation(); setExpandedRow(isExpanded ? null : emp.id) }}
                                title={isExpanded ? 'Hide break history' : 'View break history'}
                              >
                                {isExpanded ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
                                {isExpanded ? 'Hide' : 'History'}
                              </button>
                            </div>
                          </div>
                        ) : <span className="adash-muted">—</span>}
                      </div>
                      <div className="adash-td w-activity">
                        {pct !== null ? (
                          <div className="adash-act-wrap">
                            <div className="adash-act-bar">
                              <div className="adash-act-fill" style={{ width: `${pct}%`, background: pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444' }} />
                            </div>
                            <span className="adash-act-pct" style={{ color: pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444' }}>{pct}%</span>
                          </div>
                        ) : <span className="adash-muted">—</span>}
                      </div>
                    </div>
                    {isExpanded && (
                      <BreakHistoryRow emp={emp} breakLogItems={empBreakLog} />
                    )}
                  </Fragment>
                )
              })}
            </div>
          </div>
        </div>

        <div className="adash-side">
          <div className="adash-section-hd">
            <h3 className="adash-section-title">Today's Summary</h3>
          </div>

          <div className="adash-side-block">
            <div className="adash-side-label">Currently Active</div>
            {visible.filter(e => activeSessions[e.id]).length === 0 ? (
              <p className="adash-muted" style={{ fontSize: 12, padding: '10px 0' }}>No one is clocked in right now.</p>
            ) : (
              <div className="adash-activity-list">
                {sorted.filter(e => activeSessions[e.id]).slice(0, 10).map(emp => {
                  const status = getStatus(emp.id, activeSessions, activityMap)
                  const color  = deptColor(emp.department)
                  const c      = STATUS_STYLE[status.type]
                  return (
                    <div key={emp.id} className="adash-activity-row">
                      <UserAvatar userId={emp.id} name={emp.full_name} avatarUrl={emp.avatar_url}
                        className="adash-act-avatar" style={{ background: color + '18', color, border: `1.5px solid ${color}30` }} />
                      <div className="adash-act-info">
                        <span className="adash-act-name">{emp.full_name || emp.email}</span>
                        <span className="adash-act-dept">{emp.department || 'No dept'}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
                        <span className="adash-act-status" style={{ color: c.color }}>{status.label}</span>
                        {status.startedAt && status.type !== 'working' && status.type !== 'offline' && (
                          <span style={{ fontSize: 10, color: c.color, opacity: 0.75, fontVariantNumeric: 'tabular-nums', fontWeight: 600, marginTop: 1 }}>
                            {elapsedShort(status.startedAt)}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="adash-side-block" style={{ marginTop: 16 }}>
            <div className="adash-side-label">Quick Stats</div>
            <div className="adash-qs">
              {[
                { label: 'Clocked in', value: visible.filter(e => activeSessions[e.id]).length, color: '#10b981' },
                { label: 'Working', value: workingCount, color: '#059669' },
                { label: 'On break', value: visible.filter(e => ['break','restroom','pray','coffee'].includes(getStatus(e.id, activeSessions, activityMap).type)).length, color: '#3b82f6' },
                { label: 'Idle', value: visible.filter(e => getStatus(e.id, activeSessions, activityMap).type === 'idle').length, color: '#f59e0b' },
                { label: 'Offline', value: offlineCount, color: '#94a3b8' },
              ].map(({ label, value, color }) => (
                <div key={label} className="adash-qs-row">
                  <span className="adash-qs-label">{label}</span>
                  <span className="adash-qs-value" style={{ color }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {visible.some(e => activeSessions[e.id] && Number(activeSessions[e.id].break_count) > 0) && (
            <div className="adash-side-block" style={{ marginTop: 16 }}>
              <div className="adash-side-label"><TrendingUp size={11} style={{ display: 'inline', marginRight: 4 }} />Break Usage</div>
              <div className="adash-qs">
                {visible.filter(e => activeSessions[e.id] && Number(activeSessions[e.id].break_count) > 0).map(emp => (
                  <div key={emp.id} className="adash-qs-row">
                    <span className="adash-qs-label">{emp.full_name || emp.email}</span>
                    <span className="adash-qs-value" style={{ color: '#3b82f6' }}>{Number(activeSessions[emp.id].break_count)}/2</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

    {selectedWorker && (
      <WorkerProfileModal
        emp={selectedWorker.emp}
        session={selectedWorker.session}
        status={selectedWorker.status}
        onClose={() => setSelectedWorker(null)}
        hideSalary={hideSalary}
      />
    )}
    </>
  )
}
