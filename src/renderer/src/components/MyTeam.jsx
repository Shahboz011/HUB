import { useState, useEffect } from 'react'
import { Users, Award, Search } from 'lucide-react'
import { supabase } from '../lib/supabase'
import UserAvatar from './UserAvatar'

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
  const breakStart  = session.break_started_at || (live?.ts ?? null)
  const idleStart   = session.idle_started_at  || (live?.ts ?? null)
  if (breakStatus === 'break')    return { type: 'break',    label: 'On Break',    startedAt: breakStart }
  if (breakStatus === 'restroom') return { type: 'restroom', label: 'Rest Room',   startedAt: breakStart }
  if (breakStatus === 'lunch')    return { type: 'lunch',    label: 'Lunch Break', startedAt: breakStart }
  if (isIdle)                     return { type: 'idle',     label: 'Idle',        startedAt: idleStart  }
  return { type: 'working', label: 'Working', startedAt: session.started_at }
}
const STATUS_STYLE = {
  working:  { bg: '#d1fae5', color: '#059669', dot: '#059669' },
  break:    { bg: '#dbeafe', color: '#3b82f6', dot: '#3b82f6' },
  restroom: { bg: '#e0f2fe', color: '#0284c7', dot: '#0284c7' },
  lunch:    { bg: '#ffedd5', color: '#f97316', dot: '#f97316' },
  idle:     { bg: '#fef3c7', color: '#d97706', dot: '#f59e0b' },
  offline:  { bg: '#f1f5f9', color: '#94a3b8', dot: '#cbd5e1' },
}

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

function DonutRing({ value, total, color, size = 52 }) {
  const pct = total > 0 ? value / total : 0
  const r = (size - 10) / 2
  const cx = size / 2, cy = size / 2
  const circ = 2 * Math.PI * r
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e2e8f0" strokeWidth="5" />
      {pct > 0 && (
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${circ * pct} ${circ * (1 - pct)}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`} />
      )}
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize="9.5" fontWeight="700"
        fill={pct > 0 ? color : '#94a3b8'}>
        {Math.round(pct * 100)}%
      </text>
    </svg>
  )
}

function elapsedHHMM(startedAt) {
  const secs = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return `${h}h ${String(m).padStart(2, '0')}m`
}

function activityPct(session) {
  if (!session) return null
  const wall = (Date.now() - new Date(session.started_at).getTime()) / 1000
  if (wall < 30) return 100
  const idle = Number(session.accumulated_idle_secs) || 0
  return Math.round((Math.max(0, wall - idle) / wall) * 100)
}

export default function MyTeam({ managedDept }) {
  const [employees,      setEmployees]      = useState([])
  const [activeSessions, setActiveSessions] = useState({})
  const [activityMap,    setActivityMap]    = useState({})
  const [loading,        setLoading]        = useState(true)
  const [search,         setSearch]         = useState('')
  const [deptFilter,     setDeptFilter]     = useState('All')
  const [,               setTick]           = useState(0)

  useEffect(() => {
    Promise.all([
      supabase.from('profiles').select('*').neq('role', 'admin').order('full_name'),
      supabase.from('work_sessions').select('*').is('ended_at', null),
    ]).then(([{ data: profs }, { data: sessions }]) => {
      if (profs) setEmployees(profs)
      if (sessions) {
        const m = {}; sessions.forEach(s => { m[s.employee_id] = s }); setActiveSessions(m)
      }
      setLoading(false)
    })

    const profSub = supabase.channel('myteam-profs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'profiles' },
        ({ new: r }) => { if (r.role !== 'admin') setEmployees(p => [...p, r].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))) })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' },
        ({ new: r }) => setEmployees(p => p.map(e => e.id === r.id ? r : e)))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'profiles' },
        ({ old: r }) => setEmployees(p => p.filter(e => e.id !== r.id)))
      .subscribe()

    const sessSub = supabase.channel('myteam-sess')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'work_sessions' },
        ({ new: r }) => { if (!r.ended_at) setActiveSessions(p => ({ ...p, [r.employee_id]: r })) })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'work_sessions' },
        ({ new: r }) => {
          if (r.ended_at) setActiveSessions(p => { const n = { ...p }; delete n[r.employee_id]; return n })
          else setActiveSessions(p => ({ ...p, [r.employee_id]: r }))
        })
      .subscribe()

    const actSub = supabase.channel('myteam-activity')
      .on('broadcast', { event: 'status' }, ({ payload }) => {
        setActivityMap(p => ({ ...p, [payload.employee_id]: {
          is_idle: payload.is_idle, break_status: payload.break_status, ts: payload.ts,
        }}))
      }).subscribe()

    const poll = setInterval(async () => {
      const { data } = await supabase.from('work_sessions').select('*').is('ended_at', null)
      if (data) { const m = {}; data.forEach(s => { m[s.employee_id] = s }); setActiveSessions(m) }
    }, 15000)

    const tick = setInterval(() => setTick(t => t + 1), 1000)

    return () => {
      supabase.removeChannel(profSub)
      supabase.removeChannel(sessSub)
      supabase.removeChannel(actSub)
      clearInterval(poll)
      clearInterval(tick)
    }
  }, [])

  if (loading) return <div className="adash-loading">Loading team…</div>

  const allEmployees = managedDept ? employees.filter(e => e.department === managedDept) : employees
  const total        = allEmployees.length
  const activeCount  = allEmployees.filter(e => activeSessions[e.id]).length
  const breakCount   = allEmployees.filter(e => ['break', 'restroom', 'lunch'].includes(getStatus(e.id, activeSessions, activityMap).type)).length
  const idleCount    = allEmployees.filter(e => getStatus(e.id, activeSessions, activityMap).type === 'idle').length
  const offlineCount = allEmployees.filter(e => !activeSessions[e.id]).length

  const ORDER = { working: 0, break: 1, restroom: 2, lunch: 3, idle: 4, offline: 5 }
  const sorted = [...allEmployees].sort((a, b) =>
    ORDER[getStatus(a.id, activeSessions, activityMap).type] -
    ORDER[getStatus(b.id, activeSessions, activityMap).type]
  )

  const departments = managedDept ? [] : ['All', ...Array.from(new Set(employees.map(e => e.department).filter(Boolean))).sort()]

  const filtered = sorted.filter(e => {
    const q = search.toLowerCase()
    const matchSearch = !q || (e.full_name || '').toLowerCase().includes(q) || (e.email || '').toLowerCase().includes(q) || (e.position || '').toLowerCase().includes(q)
    const matchDept   = deptFilter === 'All' || e.department === deptFilter
    return matchSearch && matchDept
  })

  const topPerformers = allEmployees
    .filter(e => activeSessions[e.id])
    .map(e => ({ emp: e, pct: activityPct(activeSessions[e.id]) ?? 0 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5)

  const MEDALS = ['🥇', '🥈', '🥉', '4th', '5th']

  return (
    <div className="myteam">
      {/* ── Header ── */}
      <div className="myteam-header">
        <div>
          <h2 className="myteam-title">My Team</h2>
          <p className="myteam-sub">Manage and monitor your team members</p>
        </div>
        <div className="myteam-controls">
          <div className="myteam-search-wrap">
            <Search size={13} className="myteam-search-icon" />
            <input
              className="myteam-search"
              placeholder="Search by name, position…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {departments.length > 1 && (
            <select className="myteam-dept-select" value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
              {departments.map(d => <option key={d} value={d}>{d === 'All' ? 'All Departments' : d}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="myteam-stats">
        {/* Total — icon card (no ring) */}
        <div className="myteam-stat-card">
          <div className="myteam-stat-icon" style={{ background: '#6366f110', color: '#6366f1' }}>
            <Users size={20} />
          </div>
          <div className="myteam-stat-body">
            <span className="myteam-stat-num">{total}</span>
            <span className="myteam-stat-lbl">Total Members</span>
            <span className="myteam-stat-sub">{activeCount} clocked in today</span>
          </div>
        </div>

        <div className="myteam-stat-card">
          <DonutRing value={activeCount} total={total} color="#10b981" />
          <div className="myteam-stat-body">
            <span className="myteam-stat-num" style={{ color: '#10b981' }}>{activeCount}</span>
            <span className="myteam-stat-lbl">Active</span>
            <span className="myteam-stat-sub" style={{ color: '#10b981' }}>Clocked in</span>
          </div>
        </div>

        <div className="myteam-stat-card">
          <DonutRing value={breakCount} total={total} color="#3b82f6" />
          <div className="myteam-stat-body">
            <span className="myteam-stat-num" style={{ color: '#3b82f6' }}>{breakCount}</span>
            <span className="myteam-stat-lbl">On Break</span>
            <span className="myteam-stat-sub" style={{ color: '#6b7280' }}>Break / Rest / Lunch</span>
          </div>
        </div>

        <div className="myteam-stat-card">
          <DonutRing value={idleCount} total={total} color="#f59e0b" />
          <div className="myteam-stat-body">
            <span className="myteam-stat-num" style={{ color: '#f59e0b' }}>{idleCount}</span>
            <span className="myteam-stat-lbl">Idle</span>
            <span className="myteam-stat-sub" style={{ color: '#6b7280' }}>Away from keyboard</span>
          </div>
        </div>

        <div className="myteam-stat-card">
          <DonutRing value={offlineCount} total={total} color="#94a3b8" />
          <div className="myteam-stat-body">
            <span className="myteam-stat-num" style={{ color: '#94a3b8' }}>{offlineCount}</span>
            <span className="myteam-stat-lbl">Offline</span>
            <span className="myteam-stat-sub" style={{ color: '#6b7280' }}>Not clocked in</span>
          </div>
        </div>
      </div>

      {/* ── Body: table + sidebar ── */}
      <div className="myteam-body">

        {/* Main table */}
        <div className="myteam-main">
          <div className="myteam-table-wrap">
            <div className="myteam-table-head">
              <span className="adash-th mt-w-emp">Employee</span>
              <span className="adash-th mt-w-dept">Department</span>
              <span className="adash-th mt-w-status">Status</span>
              <span className="adash-th mt-w-session">Session</span>
              <span className="adash-th mt-w-prod">Productivity</span>
              <span className="adash-th mt-w-breaks">Breaks</span>
            </div>

            <div className="myteam-table-body">
              {filtered.length === 0 ? (
                <div className="adash-empty">No members match your search.</div>
              ) : filtered.map((emp, i) => {
                const session = activeSessions[emp.id]
                const status  = getStatus(emp.id, activeSessions, activityMap)
                const color   = deptColor(emp.department)
                const pct     = activityPct(session)
                const breaks  = session ? (Number(session.break_count) || 0) : null

                return (
                  <div key={emp.id} className={`myteam-tr ${i % 2 !== 0 ? 'myteam-tr-alt' : ''}`}>
                    <div className="myteam-td mt-w-emp">
                      <UserAvatar userId={emp.id} name={emp.full_name} avatarUrl={emp.avatar_url}
                        className="adash-avatar" style={{ background: color + '18', color, border: `1.5px solid ${color}35` }} />
                      <div className="adash-emp-info">
                        <span className="adash-emp-name">{emp.full_name || '—'}</span>
                        <span className="adash-emp-email">{emp.position || emp.email}</span>
                      </div>
                    </div>

                    <div className="myteam-td mt-w-dept">
                      {emp.department
                        ? <span className="adash-dept" style={{ background: color + '14', color, border: `1px solid ${color}28` }}>{emp.department}</span>
                        : <span className="adash-muted">—</span>}
                    </div>

                    <div className="myteam-td mt-w-status">
                      <StatusBadge type={status.type} label={status.label} startedAt={status.startedAt} />
                    </div>

                    <div className="myteam-td mt-w-session adash-mono">
                      {session ? elapsedHHMM(session.started_at) : <span className="adash-muted">—</span>}
                    </div>

                    <div className="myteam-td mt-w-prod">
                      {pct !== null ? (
                        <div className="adash-act-wrap">
                          <div className="adash-act-bar">
                            <div className="adash-act-fill" style={{
                              width: `${pct}%`,
                              background: pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444',
                            }} />
                          </div>
                          <span className="adash-act-pct" style={{
                            color: pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444',
                          }}>{pct}%</span>
                        </div>
                      ) : <span className="adash-muted">—</span>}
                    </div>

                    <div className="myteam-td mt-w-breaks">
                      {breaks !== null
                        ? <span className={`adash-breaks ${breaks >= 2 ? 'adash-breaks-used' : ''}`}>{breaks}/2</span>
                        : <span className="adash-muted">—</span>}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="myteam-footer">
              Showing {filtered.length} of {total} members
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div className="myteam-side">

          {/* Live activity */}
          <div className="adash-side-block">
            <div className="adash-side-label" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              Team Activity
              <span className="myteam-live-badge">Live</span>
            </div>
            {employees.filter(e => activeSessions[e.id]).length === 0 ? (
              <p className="adash-muted" style={{ fontSize: 12, padding: '8px 0' }}>No one clocked in right now.</p>
            ) : (
              <div className="adash-activity-list">
                {sorted.filter(e => activeSessions[e.id]).slice(0, 8).map(emp => {
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
                        <span style={{ fontSize: 11, fontWeight: 600, color: c.color }}>{status.label}</span>
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

          {/* Top performers */}
          {topPerformers.length > 0 && (
            <div className="adash-side-block" style={{ marginTop: 14 }}>
              <div className="adash-side-label" style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 10 }}>
                <Award size={12} />
                Top Performers
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {topPerformers.map(({ emp, pct }, idx) => {
                  const color = deptColor(emp.department)
                  return (
                    <div key={emp.id} className="myteam-top-row">
                      <span className="myteam-top-rank">{MEDALS[idx]}</span>
                      <UserAvatar userId={emp.id} name={emp.full_name} avatarUrl={emp.avatar_url}
                        className="adash-act-avatar" style={{ width: 26, height: 26, minWidth: 26, fontSize: 10, background: color + '18', color, border: `1.5px solid ${color}30` }} />
                      <span className="myteam-top-name">{emp.full_name || emp.email}</span>
                      <span className="myteam-top-pct" style={{
                        color: pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444',
                      }}>{pct}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Status breakdown */}
          <div className="adash-side-block" style={{ marginTop: 14 }}>
            <div className="adash-side-label" style={{ marginBottom: 10 }}>Status Breakdown</div>
            <div className="adash-qs">
              {[
                { label: 'Working',  value: employees.filter(e => getStatus(e.id, activeSessions, activityMap).type === 'working').length,  color: '#059669' },
                { label: 'On Break', value: breakCount,   color: '#3b82f6' },
                { label: 'Idle',     value: idleCount,    color: '#f59e0b' },
                { label: 'Offline',  value: offlineCount, color: '#94a3b8' },
              ].map(({ label, value, color }) => (
                <div key={label} className="adash-qs-row">
                  <span className="adash-qs-label">{label}</span>
                  <span className="adash-qs-value" style={{ color }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
