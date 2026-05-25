import { useState, useEffect, useCallback, useRef } from 'react'
import { FixedSizeList as List } from 'react-window'
import AutoSizer from 'react-virtualized-auto-sizer'
import { Search, History } from 'lucide-react'
import { supabase } from '../lib/supabase'
import AttendanceView from './AttendanceView'

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

function calcSalary(hours, rate, bonuses, fines) {
  return Math.max(0, Number(hours) * Number(rate) + Number(bonuses) - Number(fines))
}

function sessionElapsed(startedAt) {
  const secs = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m ${String(s).padStart(2, '0')}s`
}

function AvatarBadge({ name, department }) {
  const color = deptColor(department)
  const initials = name ? name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?'
  return (
    <div className="avatar-badge" style={{ backgroundColor: color + '18', border: `1.5px solid ${color}40`, color }}>
      {initials}
    </div>
  )
}

function TableRow({ index, style, data }) {
  const { employees, onFieldChange, activeSessions, onViewHistory } = data
  const emp = employees[index]
  const isEven = index % 2 === 0
  const color = deptColor(emp.department)
  const salary = calcSalary(emp.hours_worked, emp.hourly_rate, emp.bonuses, emp.fines)
  const session = activeSessions[emp.id]
  const rate = Number(emp.hourly_rate) || 0
  const sessionEarned = session ? ((Date.now() - new Date(session.started_at).getTime()) / 3600000) * rate : 0

  return (
    <div style={style} className={`table-row ${isEven ? 'row-even' : 'row-odd'}`}>
      <div className="col col-index">{index + 1}</div>

      <div className="col col-employee">
        <AvatarBadge name={emp.full_name} department={emp.department} />
        <div className="employee-info">
          <span className="employee-name">{emp.full_name || '—'}</span>
          <span className="employee-id">{emp.email}</span>
        </div>
      </div>

      <div className="col col-dept">
        {emp.department ? (
          <span className="dept-tag" style={{ backgroundColor: color + '15', color, border: `1px solid ${color}30` }}>
            {emp.department}
          </span>
        ) : (
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Unassigned</span>
        )}
      </div>

      <div className="col col-live">
        {session ? (
          <div className="live-badge">
            <span className="live-badge-dot" />
            <div className="live-badge-info">
              <span className="live-badge-time">{sessionElapsed(session.started_at)}</span>
              <span className="live-badge-earned">{fmt(sessionEarned)}</span>
            </div>
          </div>
        ) : (
          <span className="live-badge-off">Offline</span>
        )}
      </div>

      <div className="col col-input">
        <input
          type="number" min="0" max="744" step="1"
          value={emp.hours_worked ?? 0}
          onChange={e => onFieldChange(emp.id, 'hours_worked', e.target.value)}
          className="salary-input hours-input"
        />
      </div>

      <div className="col col-rate">
        <span className="rate-badge">${Number(emp.hourly_rate ?? 0)}/hr</span>
      </div>

      <div className="col col-input">
        <input
          type="number" min="0" step="10"
          value={emp.bonuses ?? 0}
          onChange={e => onFieldChange(emp.id, 'bonuses', e.target.value)}
          className="salary-input bonus-input"
        />
      </div>

      <div className="col col-input">
        <input
          type="number" min="0" step="10"
          value={emp.fines ?? 0}
          onChange={e => onFieldChange(emp.id, 'fines', e.target.value)}
          className="salary-input fine-input"
        />
      </div>

      <div className="col col-salary">
        <span className="salary-value">{fmt(salary)}</span>
      </div>

      <div className="col col-view">
        <button className="view-hist-btn" onClick={() => onViewHistory(emp)} title="View attendance history">
          <History size={14} />
          History
        </button>
      </div>
    </div>
  )
}

function TableHeader() {
  return (
    <div className="table-header">
      <div className="col col-index">#</div>
      <div className="col col-employee">Employee</div>
      <div className="col col-dept">Department</div>
      <div className="col col-live">Live Status</div>
      <div className="col col-input">Hours</div>
      <div className="col col-rate">Rate</div>
      <div className="col col-input">Bonus ($)</div>
      <div className="col col-input">Fine ($)</div>
      <div className="col col-salary">Net Salary</div>
      <div className="col col-view" />
    </div>
  )
}

function SummaryBar({ employees }) {
  const totals = employees.reduce((acc, emp) => {
    acc.salary += calcSalary(emp.hours_worked, emp.hourly_rate, emp.bonuses, emp.fines)
    acc.bonuses += Number(emp.bonuses)
    acc.fines += Number(emp.fines)
    acc.hours += Number(emp.hours_worked)
    return acc
  }, { salary: 0, bonuses: 0, fines: 0, hours: 0 })

  return (
    <div className="summary-bar">
      <div className="summary-item">
        <span className="summary-label">Employees</span>
        <span className="summary-value neutral">{employees.length}</span>
      </div>
      <div className="summary-divider" />
      <div className="summary-item">
        <span className="summary-label">Total Hours</span>
        <span className="summary-value neutral">{Math.round(totals.hours).toLocaleString()}h</span>
      </div>
      <div className="summary-divider" />
      <div className="summary-item">
        <span className="summary-label">Bonuses</span>
        <span className="summary-value positive">{fmt(totals.bonuses)}</span>
      </div>
      <div className="summary-divider" />
      <div className="summary-item">
        <span className="summary-label">Fines</span>
        <span className="summary-value negative">{fmt(totals.fines)}</span>
      </div>
      <div className="summary-divider" />
      <div className="summary-item">
        <span className="summary-label">Total Payroll</span>
        <span className="summary-value highlight">{fmt(totals.salary)}</span>
      </div>
    </div>
  )
}

export default function EmployeeTable({ departments }) {
  const [employees, setEmployees] = useState([])
  const [activeSessions, setActiveSessions] = useState({})
  const [, setTick] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterDept, setFilterDept] = useState('All')
  const [saving, setSaving] = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState(null)
  const debounceRefs = useRef({})

  useEffect(() => {
    Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('work_sessions').select('*').is('ended_at', null),
    ]).then(([{ data: profiles }, { data: sessions }]) => {
      if (profiles) setEmployees(profiles)
      if (sessions) {
        const map = {}
        sessions.forEach(s => { map[s.employee_id] = s })
        setActiveSessions(map)
      }
      setLoading(false)
    })

    // Realtime: employee profile changes (dept/rate assigned, hours updated)
    const profileSub = supabase
      .channel('admin-profiles')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'profiles' },
        ({ new: row }) => setEmployees(prev => [...prev, row].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' },
        ({ new: row }) => setEmployees(prev => prev.map(e => e.id === row.id ? row : e)))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'profiles' },
        ({ old: row }) => setEmployees(prev => prev.filter(e => e.id !== row.id)))
      .subscribe()

    // Realtime: clock-in / clock-out events
    const sessionSub = supabase
      .channel('admin-sessions')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'work_sessions' },
        ({ new: row }) => {
          if (!row.ended_at) setActiveSessions(prev => ({ ...prev, [row.employee_id]: row }))
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'work_sessions' },
        ({ new: row }) => {
          if (row.ended_at) {
            setActiveSessions(prev => { const next = { ...prev }; delete next[row.employee_id]; return next })
          }
        })
      .subscribe()

    // Polling fallback: re-sync active sessions every 15s in case realtime events are missed
    const pollId = setInterval(async () => {
      const { data } = await supabase.from('work_sessions').select('*').is('ended_at', null)
      if (data) {
        const map = {}
        data.forEach(s => { map[s.employee_id] = s })
        setActiveSessions(map)
      }
    }, 15000)

    return () => {
      supabase.removeChannel(profileSub)
      supabase.removeChannel(sessionSub)
      clearInterval(pollId)
    }
  }, [])

  // Drive live badge re-renders
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const onFieldChange = useCallback((id, field, value) => {
    const parsed = Number(value) || 0
    setEmployees(prev => prev.map(e => e.id === id ? { ...e, [field]: parsed } : e))
    const key = `${id}-${field}`
    clearTimeout(debounceRefs.current[key])
    debounceRefs.current[key] = setTimeout(async () => {
      setSaving(true)
      await supabase.from('profiles').update({ [field]: parsed }).eq('id', id)
      setSaving(false)
    }, 800)
  }, [])

  const deptOptions = ['All', ...departments]
  const filtered = employees.filter(emp => {
    const q = search.toLowerCase()
    const matchSearch = !search || emp.full_name?.toLowerCase().includes(q) || emp.email?.toLowerCase().includes(q)
    const matchDept = filterDept === 'All' || emp.department === filterDept
    return matchSearch && matchDept
  })

  if (loading) return <div className="table-loading">Loading employees…</div>

  if (selectedEmployee) {
    return <AttendanceView employee={selectedEmployee} onBack={() => setSelectedEmployee(null)} />
  }

  return (
    <div className="table-container">
      <div className="toolbar">
        <div className="search-wrap">
          <Search size={14} className="search-icon" />
          <input
            type="text" placeholder="Search by name or email…"
            value={search} onChange={e => setSearch(e.target.value)}
            className="search-input"
          />
        </div>
        <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className="dept-filter">
          {deptOptions.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <span className="row-count">{filtered.length} employees</span>
        {saving && <span className="saving-badge">Saving…</span>}
      </div>

      <TableHeader />

      <div className="list-wrapper">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <p>{employees.length === 0 ? 'No employees yet.' : 'No results match your search.'}</p>
            {employees.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                Employees appear here after they register. Use Admin Panel → Employees to assign their department and rate.
              </p>
            )}
          </div>
        ) : (
          <AutoSizer>
            {({ height, width }) => (
              <List
                height={height} width={width}
                itemCount={filtered.length} itemSize={52}
                itemData={{ employees: filtered, onFieldChange, activeSessions, onViewHistory: setSelectedEmployee }}
                overscanCount={10}
              >
                {TableRow}
              </List>
            )}
          </AutoSizer>
        )}
      </div>

      <SummaryBar employees={employees} />
    </div>
  )
}
