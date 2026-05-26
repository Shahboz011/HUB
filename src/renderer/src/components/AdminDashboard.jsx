import { useState, useEffect } from 'react'
import { Users, Wifi, Coffee, WifiOff, TrendingUp } from 'lucide-react'
import { supabase } from '../lib/supabase'

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
  if (!session) return { type: 'offline', label: 'Offline' }
  const live = activityMap[empId]
  const breakStatus = live ? live.break_status : session.break_status
  const isIdle   = live ? live.is_idle  : session.is_idle
  if (breakStatus === 'break')    return { type: 'break',    label: 'On Break'     }
  if (breakStatus === 'restroom') return { type: 'restroom', label: 'Rest Room'    }
  if (breakStatus === 'lunch')    return { type: 'lunch',    label: 'Lunch Break'  }
  if (isIdle)                     return { type: 'idle',     label: 'Idle'         }
  return { type: 'working', label: 'Working' }
}

const STATUS_STYLE = {
  working:  { bg: '#d1fae5', color: '#059669', dot: '#059669' },
  break:    { bg: '#dbeafe', color: '#3b82f6', dot: '#3b82f6' },
  restroom: { bg: '#e0f2fe', color: '#0284c7', dot: '#0284c7' },
  lunch:    { bg: '#ffedd5', color: '#f97316', dot: '#f97316' },
  idle:     { bg: '#fef3c7', color: '#d97706', dot: '#f59e0b' },
  offline:  { bg: '#f1f5f9', color: '#94a3b8', dot: '#cbd5e1' },
}

function StatusBadge({ type, label }) {
  const c = STATUS_STYLE[type] || STATUS_STYLE.offline
  return (
    <span className="adash-status-badge" style={{ background: c.bg, color: c.color }}>
      <span className="adash-status-dot" style={{ background: c.dot }} />
      {label}
    </span>
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

export default function AdminDashboard({ adminName, managedDept }) {
  const [employees,     setEmployees]     = useState([])
  const [activeSessions, setActiveSessions] = useState({})
  const [activityMap,   setActivityMap]   = useState({})
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

    const poll = setInterval(async () => {
      const { data } = await supabase.from('work_sessions').select('*').is('ended_at', null)
      if (data) { const m = {}; data.forEach(s => { m[s.employee_id] = s }); setActiveSessions(m) }
    }, 15000)

    return () => {
      supabase.removeChannel(profSub)
      supabase.removeChannel(sessSub)
      supabase.removeChannel(actSub)
      clearInterval(poll)
    }
  }, [])

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  if (loading) return <div className="adash-loading">Loading dashboard…</div>

  const visible = managedDept ? employees.filter(e => e.department === managedDept) : employees

  const workingCount  = visible.filter(e => getStatus(e.id, activeSessions, activityMap).type === 'working').length
  const awayCount     = visible.filter(e => ['break','restroom','lunch','idle'].includes(getStatus(e.id, activeSessions, activityMap).type)).length
  const offlineCount  = visible.filter(e => !activeSessions[e.id]).length

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: NY,
  })

  const ORDER = { working: 0, break: 1, restroom: 2, lunch: 3, idle: 4, offline: 5 }
  const sorted = [...visible].sort((a, b) =>
    ORDER[getStatus(a.id, activeSessions, activityMap).type] -
    ORDER[getStatus(b.id, activeSessions, activityMap).type]
  )

  return (
    <div className="adash">
      <div className="adash-header">
        <div>
          <h2 className="adash-title">Dashboard{managedDept ? ` — ${managedDept}` : ''}</h2>
          <p className="adash-welcome">Welcome back, <strong>{adminName}</strong>! Here's what's happening with your team today.</p>
        </div>
        <span className="adash-date">{today}</span>
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

                return (
                  <div key={emp.id} className={`adash-tr ${i % 2 === 0 ? '' : 'adash-tr-alt'}`}>
                    <div className="adash-td w-emp">
                      <div className="adash-avatar" style={{ background: color + '18', color, border: `1.5px solid ${color}35` }}>
                        {initials(emp.full_name)}
                      </div>
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
                    <div className="adash-td w-status"><StatusBadge type={status.type} label={status.label} /></div>
                    <div className="adash-td w-time adash-mono">
                      {session ? elapsed(session.started_at) : <span className="adash-muted">—</span>}
                    </div>
                    <div className="adash-td w-breaks">
                      {breaks !== null
                        ? <span className={`adash-breaks ${breaks >= 2 ? 'adash-breaks-used' : ''}`}>{breaks}/2</span>
                        : <span className="adash-muted">—</span>}
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
                      <div className="adash-act-avatar" style={{ background: color + '18', color, border: `1.5px solid ${color}30` }}>
                        {initials(emp.full_name)}
                      </div>
                      <div className="adash-act-info">
                        <span className="adash-act-name">{emp.full_name || emp.email}</span>
                        <span className="adash-act-dept">{emp.department || 'No dept'}</span>
                      </div>
                      <span className="adash-act-status" style={{ color: c.color }}>{status.label}</span>
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
                { label: 'On break', value: visible.filter(e => ['break','restroom','lunch'].includes(getStatus(e.id, activeSessions, activityMap).type)).length, color: '#3b82f6' },
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
  )
}
