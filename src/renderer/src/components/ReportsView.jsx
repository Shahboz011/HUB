import { useState, useEffect, useCallback } from 'react'
import { serverNow } from '../lib/serverTime'
import {
  FileText, Calendar, Users, Clock, DollarSign, TrendingUp,
  ChevronDown, ChevronUp, Download, ShieldAlert, ShieldCheck, Camera, X,
  Search, Activity, CheckCircle2
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchScreenshotUrls } from '../lib/edgeFunctions'
import UserAvatar from './UserAvatar'

const NY = 'America/New_York'

// ── Prohibited apps (shared with AdminPanel via localStorage) ─────────────────
export const PROHIBITED_STORAGE_KEY = 'pharmastaff_prohibited_apps'
export const DEFAULT_PROHIBITED = [
  { pattern: 'youtube',   label: 'YouTube'    },
  { pattern: 'netflix',   label: 'Netflix'    },
  { pattern: 'facebook',  label: 'Facebook'   },
  { pattern: 'instagram', label: 'Instagram'  },
  { pattern: 'tiktok',    label: 'TikTok'     },
  { pattern: 'twitter',   label: 'Twitter / X'},
  { pattern: 'reddit',    label: 'Reddit'     },
  { pattern: 'twitch',    label: 'Twitch'     },
  { pattern: 'disney',    label: 'Disney+'    },
  { pattern: 'steam',     label: 'Steam'      },
  { pattern: 'hulu',      label: 'Hulu'       },
  { pattern: 'spotify',   label: 'Spotify'    },
  { pattern: 'discord',   label: 'Discord'    },
  { pattern: 'pinterest', label: 'Pinterest'  },
  { pattern: 'snapchat',  label: 'Snapchat'   },
]
export function loadProhibited() {
  try {
    const s = localStorage.getItem(PROHIBITED_STORAGE_KEY)
    if (s) return JSON.parse(s)
  } catch {}
  return DEFAULT_PROHIBITED
}
export function saveProhibited(patterns) {
  localStorage.setItem(PROHIBITED_STORAGE_KEY, JSON.stringify(patterns))
}

function matchesProhibited(screenshot, patterns) {
  const app   = (screenshot.active_app   || '').toLowerCase()
  const title = (screenshot.window_title || '').toLowerCase()
  return patterns.find(p => app.includes(p.pattern) || title.includes(p.pattern)) || null
}

// ── Helpers ───────────────────────────────────────────────────────────────────
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
function fmtCurrency(v) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(v || 0)
}
function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: NY })
}
function fmtDateLong(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: NY })
}
function fmtDateKey(iso) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: NY, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso))
  const y = parts.find(p => p.type === 'year').value
  const m = parts.find(p => p.type === 'month').value
  const d = parts.find(p => p.type === 'day').value
  return `${y}-${m}-${d}`
}
function fmtDateKeyDisplay(key) {
  const [y, m, d] = key.split('-')
  return new Date(`${y}-${m}-${d}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  })
}
function actPct(session) {
  const dh = Number(session.duration_hours) || 0
  if (dh === 0) return null
  const totalSecs = dh * 3600
  const idleSecs  = Number(session.accumulated_idle_secs) || 0
  return Math.round((Math.max(0, totalSecs - idleSecs) / totalSecs) * 100)
}
function nyMidnightMs(nowMs) {
  const now = new Date(nowMs)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NY, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
  }).formatToParts(now)
  const get = t => +parts.find(p => p.type === t).value
  const [y, mo, d, h, mn, sc] = [get('year'), get('month'), get('day'), get('hour'), get('minute'), get('second')]
  const nyWallMs   = Date.UTC(y, mo - 1, d, h, mn, sc)
  const nyOffsetMs = now.getTime() - nyWallMs
  return { midnight: Date.UTC(y, mo - 1, d, 0, 0, 0) + nyOffsetMs, y, mo, d, dow: new Date(Date.UTC(y, mo - 1, d)).getUTCDay() }
}
function getRange(periodId) {
  const nowMs = serverNow()
  const now   = new Date(nowMs)
  if (periodId === 'alltime') return { start: null, end: now }
  const { midnight, y, mo, dow } = nyMidnightMs(nowMs)
  if (periodId === 'today') return { start: new Date(midnight), end: now }
  if (periodId === 'week') {
    const daysFromMonday = dow === 0 ? 6 : dow - 1
    return { start: new Date(midnight - daysFromMonday * 86_400_000), end: now }
  }
  if (periodId === 'month') {
    const { midnight: monthStart } = nyMidnightMs(Date.UTC(y, mo - 1, 1, 12, 0, 0))
    return { start: new Date(monthStart), end: now }
  }
  return { start: null, end: now }
}

const PERIODS = [
  { id: 'today',   label: 'Daily'    },
  { id: 'week',    label: 'Weekly'   },
  { id: 'month',   label: 'Monthly'  },
  { id: 'alltime', label: 'All Time' },
]

const SUBTABS = [
  { id: 'overview',   label: 'Overview'      },
  { id: 'byworker',   label: 'By Worker'     },
  { id: 'log',        label: 'Sessions Log'  },
  { id: 'violations', label: 'Violations'    },
]

// Returns true if the session's clock-in time (in NY tz) is after the dept's work_start
function checkLate(startedAt, dept, deptSchedules) {
  if (!deptSchedules || !dept || !startedAt) return false
  const sched = deptSchedules[dept]
  if (!sched?.work_start) return false
  const [wH, wM] = sched.work_start.split(':').map(Number)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NY, hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(new Date(startedAt))
  const h = Number(parts.find(p => p.type === 'hour').value)
  const m = Number(parts.find(p => p.type === 'minute').value)
  return h * 60 + m > wH * 60 + wM
}

function getPeriodStr(period) {
  const now = new Date()
  if (period === 'today') return now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  if (period === 'week') {
    const { start } = getRange('week')
    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
  }
  if (period === 'month') return now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  return 'All Time'
}

// ── Root component ────────────────────────────────────────────────────────────
export default function ReportsView({ managedDept, deptSchedules = {} }) {
  const [period,        setPeriod]        = useState('today')
  const [subTab,        setSubTab]        = useState('overview')
  const [deptFilter,    setDeptFilter]    = useState('all')
  const [statusFilter,  setStatusFilter]  = useState('all')
  const [search,        setSearch]        = useState('')
  const [page,          setPage]          = useState(1)
  const [sessions,      setSessions]      = useState([])
  const [profiles,      setProfiles]      = useState({})
  const [depts,         setDepts]         = useState([])
  const [loading,       setLoading]       = useState(true)
  const [expandedWorker,setExpandedWorker]= useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    let profQuery = supabase.from('profiles')
      .select('id, full_name, email, department, position, hourly_rate, avatar_url')
    if (managedDept) profQuery = profQuery.eq('department', managedDept)
    const { data: profData } = await profQuery
    const profMap = {}
    const allDepts = new Set()
    if (profData) profData.forEach(p => { profMap[p.id] = p; if (p.department) allDepts.add(p.department) })
    setProfiles(profMap)
    setDepts([...allDepts].sort())

    const { start, end } = getRange(period)
    let q = supabase.from('work_sessions').select('*')
    if (start) q = q.gte('started_at', start.toISOString())
    if (end)   q = q.lte('started_at', end.toISOString())
    q = q.order('started_at', { ascending: false })
    const { data: sessData } = await q
    setSessions(sessData || [])
    setLoading(false)
  }, [period, managedDept])

  useEffect(() => { load() }, [load])
  useEffect(() => { setExpandedWorker(null); setPage(1) }, [period, subTab, deptFilter])

  const filtered = sessions.filter(s => {
    const prof = profiles[s.employee_id]
    if (!prof) return false
    if (managedDept && prof.department !== managedDept) return false
    if (deptFilter !== 'all' && prof.department !== deptFilter) return false
    if (statusFilter === 'active' && s.ended_at) return false
    if (statusFilter === 'completed' && !s.ended_at) return false
    return true
  })

  const completed     = filtered.filter(s => s.ended_at)
  const activeNow     = filtered.filter(s => !s.ended_at)
  const totalHours    = completed.reduce((sum, s) => sum + (Number(s.duration_hours) || 0), 0)
  const totalEarned   = completed.reduce((sum, s) => sum + (Number(s.duration_hours) || 0) * (Number(profiles[s.employee_id]?.hourly_rate) || 0), 0)
  const avgActivity   = completed.length ? Math.round(completed.reduce((sum, s) => sum + (actPct(s) ?? 100), 0) / completed.length) : null
  const uniqueWorkers = new Set(filtered.map(s => s.employee_id)).size

  function exportCSV() {
    const rows = [['Worker','Department','Date','Clock In','Clock Out','Hours Worked','Idle (min)','Activity %','Earned ($)','Status']]
    ;[...filtered].reverse().forEach(s => {
      const prof = profiles[s.employee_id]
      const rate = Number(prof?.hourly_rate) || 0
      rows.push([
        prof?.full_name || prof?.email || s.employee_id,
        prof?.department || '',
        fmtDateLong(s.started_at),
        fmtTime(s.started_at),
        s.ended_at ? fmtTime(s.ended_at) : 'Active',
        (Number(s.duration_hours) || 0).toFixed(2),
        ((Number(s.accumulated_idle_secs) || 0) / 60).toFixed(0),
        s.ended_at ? (actPct(s) ?? '') : '',
        s.ended_at ? (Number(s.duration_hours) * rate).toFixed(2) : '',
        s.ended_at ? 'Completed' : 'Active',
      ])
    })
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `PharmaStaff_Report_${period}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const SEL = {
    padding: '6px 10px', borderRadius: 7, border: '1px solid #e2e8f0',
    fontSize: 13, color: '#374151', background: '#fff', cursor: 'pointer',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#f1f5f9', overflow: 'hidden' }}>

      {/* ── Page Header ── */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#0f172a' }}>Reports</h2>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>Home</span><span>›</span><span>Reports</span><span>›</span>
            <span style={{ color: '#2563eb' }}>{PERIODS.find(p => p.id === period)?.label} Report</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={exportCSV}
            disabled={filtered.length === 0}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#374151', fontSize: 13, fontWeight: 500, cursor: filtered.length === 0 ? 'default' : 'pointer', opacity: filtered.length === 0 ? 0.5 : 1 }}
          >
            <Download size={13} /> Export
          </button>
          <button
            onClick={load}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 7, border: 'none', background: '#2563eb', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            Generate Report
          </button>
        </div>
      </div>

      {/* ── Period + Date Bar ── */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: 8, padding: 3, gap: 2 }}>
          {PERIODS.map(p => (
            <button
              key={p.id}
              onClick={() => { setPeriod(p.id); setPage(1) }}
              style={{ padding: '5px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, background: period === p.id ? '#2563eb' : 'transparent', color: period === p.id ? '#fff' : '#64748b', transition: 'all 0.15s' }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#475569', fontSize: 13, border: '1px solid #e2e8f0', borderRadius: 7, padding: '5px 12px', background: '#fff' }}>
          <Calendar size={13} style={{ color: '#94a3b8' }} />
          {getPeriodStr(period)}
        </div>
      </div>

      {/* ── Filter Bar ── */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '10px 24px', display: 'flex', gap: 16, alignItems: 'flex-end', flexShrink: 0, flexWrap: 'wrap' }}>
        {!managedDept && depts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Department</label>
            <select value={deptFilter} onChange={e => { setDeptFilter(e.target.value); setPage(1) }} style={SEL}>
              <option value="all">All Departments</option>
              {depts.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Status</label>
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }} style={SEL}>
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>
        </div>
      </div>

      {/* ── Stats Row ── */}
      {subTab !== 'violations' && (
        <div style={{ padding: '14px 24px', display: 'flex', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
          {[
            { icon: <Users size={18} />, bg: '#eff6ff', clr: '#3b82f6', val: uniqueWorkers, label: 'Total Workers' },
            { icon: <CheckCircle2 size={18} />, bg: '#f0fdf4', clr: '#22c55e', val: `${activeNow.length}${uniqueWorkers > 0 ? ` (${Math.round(activeNow.length / Math.max(uniqueWorkers, 1) * 100)}%)` : ''}`, vClr: '#16a34a', label: 'Active Now' },
            { icon: <Calendar size={18} />, bg: '#faf5ff', clr: '#a855f7', val: filtered.length, label: 'Sessions' },
            { icon: <Clock size={18} />, bg: '#eff6ff', clr: '#3b82f6', val: `${totalHours.toFixed(1)}h`, label: 'Total Hours' },
            { icon: <DollarSign size={18} />, bg: '#f0fdf4', clr: '#22c55e', val: fmtCurrency(totalEarned), sm: true, label: 'Total Salary' },
            { icon: <Activity size={18} />, bg: '#fff7ed', clr: '#f97316', val: avgActivity !== null ? `${avgActivity}%` : '—', label: 'Avg Activity' },
          ].map((s, i) => (
            <div key={i} style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flex: '1 1 140px', minWidth: 120 }}>
              <div style={{ width: 38, height: 38, borderRadius: 9, background: s.bg, color: s.clr, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {s.icon}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: s.sm ? 15 : 20, fontWeight: 700, color: s.vClr || '#0f172a', lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.val}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Sub-tab Nav ── */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex' }}>
          {SUBTABS.map(t => (
            <button
              key={t.id}
              onClick={() => { setSubTab(t.id); setPage(1); setExpandedWorker(null); setSearch('') }}
              style={{ padding: '11px 16px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: subTab === t.id ? 600 : 400, color: subTab === t.id ? (t.id === 'violations' ? '#ef4444' : '#2563eb') : '#64748b', borderBottom: subTab === t.id ? `2px solid ${t.id === 'violations' ? '#ef4444' : '#2563eb'}` : '2px solid transparent', transition: 'all 0.15s', whiteSpace: 'nowrap' }}
            >
              {t.id === 'violations' && <ShieldAlert size={12} style={{ display: 'inline', marginRight: 5, verticalAlign: 'middle' }} />}
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0' }}>
          <div style={{ position: 'relative' }}>
            <Search size={12} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search worker…"
              style={{ paddingLeft: 28, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 7, border: '1px solid #e2e8f0', fontSize: 12, color: '#374151', width: 190, outline: 'none', background: '#f8fafc' }}
            />
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px 24px' }}>
        {loading ? (
          <div className="rep-state">Loading report…</div>
        ) : subTab === 'violations' ? (
          <ViolationsView period={period} managedDept={managedDept} deptFilter={deptFilter} profiles={profiles} />
        ) : subTab === 'byworker' ? (
          <WorkerView sessions={filtered} profiles={profiles} expandedWorker={expandedWorker} setExpandedWorker={setExpandedWorker} search={search} deptSchedules={deptSchedules} />
        ) : subTab === 'log' ? (
          <SessionsLog sessions={filtered} profiles={profiles} search={search} />
        ) : filtered.length === 0 ? (
          <div className="rep-state">No sessions found for this period.</div>
        ) : (
          <OverviewTable sessions={filtered} profiles={profiles} search={search} page={page} setPage={setPage} deptSchedules={deptSchedules} />
        )}
      </div>
    </div>
  )
}

// ── Overview Table ────────────────────────────────────────────────────────────
const PAGE_SIZE = 10

function OverviewTable({ sessions, profiles, search, page, setPage, deptSchedules }) {
  const searched = search
    ? sessions.filter(s => {
        const prof = profiles[s.employee_id]
        const q = search.toLowerCase()
        return (prof?.full_name || prof?.email || '').toLowerCase().includes(q)
          || (prof?.department || '').toLowerCase().includes(q)
      })
    : sessions

  const total      = searched.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const pageItems  = searched.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  if (total === 0) return <div className="rep-state">No sessions match your search.</div>

  const TH = { fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, padding: '10px 12px', whiteSpace: 'nowrap', textAlign: 'left', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }
  const TD = { padding: '10px 12px', fontSize: 13, color: '#374151', verticalAlign: 'middle', borderBottom: '1px solid #f1f5f9' }

  // build page buttons: show up to 5 page numbers
  const pageNums = []
  if (totalPages <= 5) {
    for (let i = 1; i <= totalPages; i++) pageNums.push(i)
  } else if (safePage <= 3) {
    pageNums.push(1, 2, 3, 4, 5)
  } else if (safePage >= totalPages - 2) {
    for (let i = totalPages - 4; i <= totalPages; i++) pageNums.push(i)
  } else {
    for (let i = safePage - 2; i <= safePage + 2; i++) pageNums.push(i)
  }

  return (
    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr>
              <th style={{ ...TH, width: 38, textAlign: 'center' }}>#</th>
              <th style={TH}>Worker</th>
              <th style={TH}>Department</th>
              <th style={TH}>Status</th>
              <th style={TH}>Clock In</th>
              <th style={TH}>Clock Out</th>
              <th style={TH}>Duration</th>
              <th style={TH}>Idle (min)</th>
              <th style={TH}>Activity (%)</th>
              <th style={{ ...TH, textAlign: 'right' }}>Earned ($)</th>
              <th style={TH}>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((s, i) => {
              const prof     = profiles[s.employee_id]
              if (!prof) return null
              const isActive = !s.ended_at
              const late     = checkLate(s.started_at, prof.department, deptSchedules)
              const hours    = Number(s.duration_hours) || 0
              const idleMin  = Math.round((Number(s.accumulated_idle_secs) || 0) / 60)
              const pct      = actPct(s)
              const rate     = Number(prof.hourly_rate) || 0
              const color    = deptColor(prof.department)
              const rowNum   = (safePage - 1) * PAGE_SIZE + i + 1
              const remarks  = !isActive && idleMin > 30 ? `High idle (${idleMin}m)` : '—'
              const remarkClr= idleMin > 30 ? '#f59e0b' : '#94a3b8'

              return (
                <tr key={s.id} style={{ background: i % 2 === 1 ? '#fafafa' : '#fff' }}>
                  <td style={{ ...TD, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>{rowNum}</td>
                  <td style={TD}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <UserAvatar
                        userId={prof.id} name={prof.full_name} avatarUrl={prof.avatar_url}
                        className="rep-avatar"
                        style={{ width: 30, height: 30, fontSize: 11, background: color + '18', color, border: `1.5px solid ${color}35`, flexShrink: 0 }}
                      />
                      <div>
                        <div style={{ fontWeight: 500, color: '#0f172a', fontSize: 13, whiteSpace: 'nowrap' }}>{prof.full_name || prof.email}</div>
                        {prof.position && <div style={{ fontSize: 11, color: '#94a3b8' }}>{prof.position}</div>}
                      </div>
                    </div>
                  </td>
                  <td style={TD}>
                    {prof.department
                      ? <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 5, background: color + '14', color, border: `1px solid ${color}28`, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>{prof.department}</span>
                      : <span style={{ color: '#94a3b8' }}>—</span>}
                  </td>
                  <td style={TD}>
                    {late
                      ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, background: '#fef2f2', color: '#dc2626', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', border: '1px solid #fecaca' }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#dc2626', flexShrink: 0 }} />Late{isActive ? ' · Active' : ''}
                        </span>
                      : isActive
                        ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, background: '#dcfce7', color: '#16a34a', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16a34a', flexShrink: 0 }} />Active
                          </span>
                        : <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, background: '#f1f5f9', color: '#64748b', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>Completed</span>}
                  </td>
                  <td style={{ ...TD, fontFamily: 'monospace', fontSize: 12 }}>{fmtTime(s.started_at)}</td>
                  <td style={{ ...TD, fontFamily: 'monospace', fontSize: 12 }}>{isActive ? <span style={{ color: '#94a3b8' }}>—</span> : fmtTime(s.ended_at)}</td>
                  <td style={{ ...TD, fontFamily: 'monospace', fontSize: 12 }}>{isActive ? <span style={{ color: '#94a3b8' }}>—</span> : `${hours.toFixed(2)}h`}</td>
                  <td style={{ ...TD, fontFamily: 'monospace', fontSize: 12 }}>
                    {idleMin > 0
                      ? <span style={{ color: '#f97316', fontWeight: 600 }}>{idleMin}</span>
                      : <span style={{ color: '#94a3b8' }}>0</span>}
                  </td>
                  <td style={TD}>
                    {pct !== null
                      ? <span style={{ fontWeight: 600, fontSize: 13, color: pct >= 80 ? '#16a34a' : pct >= 50 ? '#f59e0b' : '#ef4444' }}>{pct}%</span>
                      : <span style={{ color: '#94a3b8' }}>—</span>}
                  </td>
                  <td style={{ ...TD, textAlign: 'right', fontWeight: 600, fontSize: 13 }}>
                    {isActive
                      ? <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 400 }}>—</span>
                      : fmtCurrency(hours * rate)}
                  </td>
                  <td style={{ ...TD, fontSize: 12, color: remarkClr, fontWeight: isActive || idleMin > 30 ? 500 : 400 }}>{remarks}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ padding: '11px 16px', borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          Showing {Math.min((safePage - 1) * PAGE_SIZE + 1, total)} to {Math.min(safePage * PAGE_SIZE, total)} of {total} entries
        </span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <PgBtn disabled={safePage === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>‹</PgBtn>
          {pageNums.map(p => (
            <PgBtn key={p} active={safePage === p} onClick={() => setPage(p)}>{p}</PgBtn>
          ))}
          {totalPages > 5 && safePage < totalPages - 2 && <span style={{ fontSize: 12, color: '#94a3b8', padding: '0 2px' }}>…</span>}
          {totalPages > 5 && safePage < totalPages - 2 && (
            <PgBtn active={safePage === totalPages} onClick={() => setPage(totalPages)}>{totalPages}</PgBtn>
          )}
          <PgBtn disabled={safePage === totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>›</PgBtn>
        </div>
      </div>
    </div>
  )
}

function PgBtn({ onClick, disabled, active, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '4px 10px', minWidth: 32, borderRadius: 5, border: '1px solid',
        borderColor: active ? '#2563eb' : '#e2e8f0',
        background: active ? '#2563eb' : '#fff',
        color: disabled ? '#cbd5e1' : active ? '#fff' : '#374151',
        cursor: disabled ? 'default' : 'pointer',
        fontSize: 13, fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  )
}

// ── Violations view ───────────────────────────────────────────────────────────
function ViolationsView({ period, managedDept, deptFilter, profiles }) {
  const [patterns,      setPatterns]      = useState(loadProhibited)
  const [screenshots,   setScreenshots]   = useState([])
  const [loading,       setLoading]       = useState(true)
  const [refreshKey,    setRefreshKey]    = useState(0)
  const [expandedWorker,setExpandedWorker]= useState(null)
  const [loadedImages,  setLoadedImages]  = useState({})
  const [loadingImages, setLoadingImages] = useState(null)
  const [lightbox,      setLightbox]      = useState(null)

  useEffect(() => { setPatterns(loadProhibited()) }, [period])

  useEffect(() => {
    async function load() {
      setLoading(true)
      setExpandedWorker(null)
      setLoadedImages({})
      const { start, end } = getRange(period)
      const BATCH = 1000
      let all = [], from = 0
      while (true) {
        let q = supabase.from('screenshots').select('*')
          .order('taken_at', { ascending: false })
          .range(from, from + BATCH - 1)
        if (start) q = q.gte('taken_at', start.toISOString())
        if (end)   q = q.lte('taken_at', end.toISOString())
        const { data } = await q
        if (!data || data.length === 0) break
        all = all.concat(data)
        if (data.length < BATCH) break
        from += BATCH
      }
      setScreenshots(all)
      setLoading(false)
    }
    load()
  }, [period, refreshKey])

  const violations = screenshots.filter(s => {
    const prof = profiles[s.employee_id]
    if (!prof) return false
    if (managedDept && prof.department !== managedDept) return false
    if (deptFilter !== 'all' && prof.department !== deptFilter) return false
    return matchesProhibited(s, patterns) !== null
  })

  const byWorker = {}
  violations.forEach(v => {
    if (!byWorker[v.employee_id]) byWorker[v.employee_id] = []
    byWorker[v.employee_id].push(v)
  })
  const workers = Object.entries(byWorker).sort((a, b) => b[1].length - a[1].length)

  const labelCounts = {}
  violations.forEach(v => {
    const m = matchesProhibited(v, patterns)
    if (m) labelCounts[m.label] = (labelCounts[m.label] || 0) + 1
  })
  const topApp = Object.entries(labelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—'

  async function toggleWorker(empId) {
    if (expandedWorker === empId) { setExpandedWorker(null); return }
    setExpandedWorker(empId)
    if (loadedImages[empId] !== undefined) return
    setLoadingImages(empId)
    const paths = (byWorker[empId] || []).map(v => v.path)
    const urls  = await fetchScreenshotUrls(paths)
    setLoadedImages(prev => ({ ...prev, [empId]: urls }))
    setLoadingImages(null)
  }

  if (loading) return <div className="rep-state">Scanning screenshots for violations…</div>

  if (patterns.length === 0) {
    return (
      <div className="rep-state" style={{ flexDirection: 'column', gap: 8 }}>
        <ShieldAlert size={32} style={{ color: '#f59e0b' }} />
        <span style={{ fontWeight: 600 }}>No prohibited app rules configured</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Go to Admin Panel → App Rules to add keywords.</span>
      </div>
    )
  }

  return (
    <>
      <div className="rep-stats">
        <div className="rep-stat-card">
          <div className="rep-stat-icon" style={{ background: '#ef444412', color: '#ef4444' }}><ShieldAlert size={18} /></div>
          <div className="rep-stat-body"><span className="rep-stat-num" style={{ color: '#ef4444' }}>{violations.length}</span><span className="rep-stat-lbl">Violations Found</span></div>
        </div>
        <div className="rep-stat-card">
          <div className="rep-stat-icon" style={{ background: '#f9731612', color: '#f97316' }}><Users size={18} /></div>
          <div className="rep-stat-body"><span className="rep-stat-num" style={{ color: '#f97316' }}>{workers.length}</span><span className="rep-stat-lbl">Workers Flagged</span></div>
        </div>
        <div className="rep-stat-card">
          <div className="rep-stat-icon" style={{ background: '#6366f112', color: '#6366f1' }}><Camera size={18} /></div>
          <div className="rep-stat-body"><span className="rep-stat-num">{screenshots.length}</span><span className="rep-stat-lbl">Screenshots Checked</span></div>
        </div>
        <div className="rep-stat-card">
          <div className="rep-stat-icon" style={{ background: '#f59e0b12', color: '#f59e0b' }}><TrendingUp size={18} /></div>
          <div className="rep-stat-body"><span className="rep-stat-num" style={{ fontSize: 14, letterSpacing: 0 }}>{topApp}</span><span className="rep-stat-lbl">Most Seen App</span></div>
        </div>
        <div className="rep-stat-card">
          <div className="rep-stat-icon" style={{ background: '#10b98112', color: '#10b981' }}><FileText size={18} /></div>
          <div className="rep-stat-body"><span className="rep-stat-num">{patterns.length}</span><span className="rep-stat-lbl">Active Rules</span></div>
        </div>
      </div>

      {workers.length === 0 ? (
        <div className="rep-state" style={{ flexDirection: 'column', gap: 10 }}>
          <ShieldCheck size={36} style={{ color: '#10b981' }} />
          <span style={{ color: '#10b981', fontWeight: 700, fontSize: 15 }}>No violations found</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Checked {screenshots.length} screenshot{screenshots.length !== 1 ? 's' : ''} against {patterns.length} rule{patterns.length !== 1 ? 's' : ''}.
          </span>
          <button className="rep-refresh-btn" onClick={() => setRefreshKey(k => k + 1)} disabled={loading}>
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>
      ) : (
        <div className="rep-viol-wrap">
          <div className="rep-viol-head">
            <span className="rep-th" style={{ flex: 1 }}>Employee</span>
            <span className="rep-th" style={{ width: 90, textAlign: 'center' }}>Violations</span>
            <span className="rep-th" style={{ width: 160 }}>Last Detected</span>
            <span className="rep-th" style={{ flex: 1 }}>Apps Detected</span>
            <button className="rep-refresh-btn" onClick={() => setRefreshKey(k => k + 1)} disabled={loading} title="Refresh violations">
              {loading ? '…' : '↻ Refresh'}
            </button>
          </div>

          {workers.map(([empId, empViolations]) => {
            const prof   = profiles[empId]
            if (!prof) return null
            const color  = deptColor(prof.department)
            const isOpen = expandedWorker === empId
            const images = loadedImages[empId] || []
            const latest = empViolations[0]
            const labels = [...new Set(empViolations.map(v => matchesProhibited(v, patterns)?.label).filter(Boolean))]

            return (
              <div key={empId} className="rep-viol-block">
                <div className={`rep-viol-row ${isOpen ? 'rep-viol-row-open' : ''}`}>
                  <div className="rep-td rep-td-emp">
                    <UserAvatar userId={prof.id} name={prof.full_name} avatarUrl={prof.avatar_url}
                      className="rep-avatar" style={{ background: color + '18', color, border: `1.5px solid ${color}35` }} />
                    <div className="rep-emp-info">
                      <span className="rep-emp-name">{prof.full_name || prof.email}</span>
                      <span className="rep-emp-meta" style={{ color }}>{prof.department || '—'}</span>
                    </div>
                  </div>
                  <div style={{ width: 90, display: 'flex', justifyContent: 'center' }}>
                    <span className="rep-viol-badge">{empViolations.length}</span>
                  </div>
                  <div style={{ width: 160, fontSize: 12, color: 'var(--text-secondary)' }}>
                    {latest && new Date(latest.taken_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: NY })}
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                    {labels.map(label => (
                      <span key={label} className="rep-viol-app-tag">{label}</span>
                    ))}
                  </div>
                  <div style={{ width: 86, display: 'flex', justifyContent: 'flex-end' }}>
                    <button className="rep-expand-btn" onClick={() => toggleWorker(empId)}>
                      {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      {isOpen ? 'Collapse' : 'Evidence'}
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="rep-viol-detail">
                    {loadingImages === empId ? (
                      <div style={{ padding: '14px 16px', color: 'var(--text-muted)', fontSize: 12 }}>Loading screenshots…</div>
                    ) : (
                      <div className="rep-viol-ss-grid">
                        {empViolations.map((v, i) => {
                          const matched = matchesProhibited(v, patterns)
                          const imgUrl  = images[i]
                          return (
                            <div
                              key={v.id}
                              className="rep-viol-ss-card"
                              onClick={() => imgUrl && setLightbox({ url: imgUrl, meta: v, matched })}
                              style={{ cursor: imgUrl ? 'pointer' : 'default' }}
                            >
                              {imgUrl
                                ? <img src={imgUrl} alt="" className="rep-viol-thumb" />
                                : <div className="rep-viol-thumb-ph"><Camera size={20} style={{ color: 'var(--text-muted)' }} /></div>}
                              <div className="rep-viol-ss-info">
                                <span className="rep-viol-ss-time">
                                  {new Date(v.taken_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: NY })}
                                </span>
                                {matched && <span className="rep-viol-app-tag" style={{ fontSize: 10 }}>{matched.label}</span>}
                                {v.active_app && <span className="rep-viol-app-name" title={v.active_app}>{v.active_app}</span>}
                                {v.window_title && <span className="rep-viol-win-title" title={v.window_title}>{v.window_title}</span>}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {lightbox && (
        <div className="rep-lightbox" onClick={() => setLightbox(null)}>
          <div className="rep-lb-inner" onClick={e => e.stopPropagation()}>
            <img src={lightbox.url} alt="" className="rep-lb-img" />
            <div className="rep-lb-meta">
              <div className="rep-lb-time">
                {new Date(lightbox.meta.taken_at).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: NY })}
              </div>
              {lightbox.matched && <span className="rep-viol-app-tag">{lightbox.matched.label}</span>}
              {lightbox.meta.active_app && <div className="rep-lb-app">{lightbox.meta.active_app}</div>}
              {lightbox.meta.window_title && <div className="rep-lb-wintitle">{lightbox.meta.window_title}</div>}
            </div>
            <button className="rep-lb-close" onClick={() => setLightbox(null)}><X size={16} /> Close</button>
          </div>
        </div>
      )}
    </>
  )
}

// ── By Worker view ────────────────────────────────────────────────────────────
function WorkerView({ sessions, profiles, expandedWorker, setExpandedWorker, search, deptSchedules }) {
  const byWorker = {}
  sessions.forEach(s => {
    const prof = profiles[s.employee_id]
    if (search) {
      const q = search.toLowerCase()
      if (!(prof?.full_name || prof?.email || '').toLowerCase().includes(q) && !(prof?.department || '').toLowerCase().includes(q)) return
    }
    if (!byWorker[s.employee_id]) byWorker[s.employee_id] = []
    byWorker[s.employee_id].push(s)
  })
  const workers = Object.entries(byWorker).sort((a, b) =>
    b[1].reduce((s, x) => s + (Number(x.duration_hours) || 0), 0) -
    a[1].reduce((s, x) => s + (Number(x.duration_hours) || 0), 0)
  )

  if (workers.length === 0) return <div className="rep-state">No workers match your search.</div>

  return (
    <div className="rep-worker-wrap">
      <div className="rep-worker-head">
        <span className="rep-th">Employee</span>
        <span className="rep-th rep-th-c">Days Worked</span>
        <span className="rep-th rep-th-c">Sessions</span>
        <span className="rep-th rep-th-c">Total Hours</span>
        <span className="rep-th rep-th-c">Avg Activity</span>
        <span className="rep-th rep-th-r">Total Earned</span>
        <span style={{ width: 96 }} />
      </div>

      {workers.map(([empId, empSessions]) => {
        const prof      = profiles[empId]
        if (!prof) return null
        const done      = empSessions.filter(s => s.ended_at)
        const totalH    = done.reduce((sum, s) => sum + (Number(s.duration_hours) || 0), 0)
        const rate      = Number(prof.hourly_rate) || 0
        const avgAct    = done.length ? Math.round(done.reduce((sum, s) => sum + (actPct(s) ?? 100), 0) / done.length) : null
        const isOpen    = expandedWorker === empId
        const color     = deptColor(prof.department)
        const active    = empSessions.filter(s => !s.ended_at).length
        const daysWorked= new Set(empSessions.map(s => fmtDateKey(s.started_at))).size
        const lateCount = empSessions.filter(s => checkLate(s.started_at, prof.department, deptSchedules)).length

        return (
          <div key={empId} className="rep-worker-block">
            <div className={`rep-worker-row ${isOpen ? 'rep-worker-row-open' : ''}`}>
              <div className="rep-td rep-td-emp">
                <UserAvatar userId={prof.id} name={prof.full_name} avatarUrl={prof.avatar_url}
                  className="rep-avatar" style={{ background: color + '18', color, border: `1.5px solid ${color}35` }} />
                <div className="rep-emp-info">
                  <span className="rep-emp-name">{prof.full_name || prof.email}</span>
                  <span className="rep-emp-meta" style={{ color }}>{prof.department || '—'}{prof.position ? ` · ${prof.position}` : ''}</span>
                </div>
              </div>
              <div className="rep-td rep-td-c" style={{ flexDirection: 'column', gap: 2 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{daysWorked}</span>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>day{daysWorked !== 1 ? 's' : ''}</span>
              </div>
              <div className="rep-td rep-td-c" style={{ gap: 6 }}>
                <span className="rep-sess-count">{empSessions.length}</span>
                {active > 0 && <span className="rep-live-dot" title="Active now" />}
                {lateCount > 0 && (
                  <span title={`${lateCount} late clock-in${lateCount !== 1 ? 's' : ''}`} style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 20, background: '#fef2f2', color: '#dc2626', fontSize: 11, fontWeight: 600, border: '1px solid #fecaca' }}>
                    {lateCount}✕ Late
                  </span>
                )}
              </div>
              <div className="rep-td rep-td-c rep-mono">{totalH.toFixed(2)}h</div>
              <div className="rep-td rep-td-c">
                {avgAct !== null ? (
                  <div className="rep-act-wrap">
                    <div className="rep-act-bar"><div className="rep-act-fill" style={{ width: `${avgAct}%`, background: avgAct >= 80 ? '#10b981' : avgAct >= 50 ? '#f59e0b' : '#ef4444' }} /></div>
                    <span className="rep-act-pct" style={{ color: avgAct >= 80 ? '#10b981' : avgAct >= 50 ? '#f59e0b' : '#ef4444' }}>{avgAct}%</span>
                  </div>
                ) : <span className="rep-muted">—</span>}
              </div>
              <div className="rep-td rep-td-r rep-earn">{fmtCurrency(totalH * rate)}</div>
              <div className="rep-td" style={{ width: 96, justifyContent: 'flex-end' }}>
                <button className="rep-expand-btn" onClick={() => setExpandedWorker(isOpen ? null : empId)}>
                  {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  {isOpen ? 'Collapse' : `${empSessions.length} session${empSessions.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>

            {isOpen && (
              <div className="rep-sessions-panel">
                <div className="rep-sp-head">
                  <span className="rep-sth">Date</span>
                  <span className="rep-sth">Status</span>
                  <span className="rep-sth">Clock In</span>
                  <span className="rep-sth">Clock Out</span>
                  <span className="rep-sth">Duration</span>
                  <span className="rep-sth">Idle Deducted</span>
                  <span className="rep-sth">Activity</span>
                  <span className="rep-sth rep-sth-r">Earned</span>
                </div>
                {empSessions.map((s, i) => {
                  const isActive = !s.ended_at
                  const late     = checkLate(s.started_at, prof.department, deptSchedules)
                  const hours    = Number(s.duration_hours) || 0
                  const idleMin  = Math.round((Number(s.accumulated_idle_secs) || 0) / 60)
                  const pct      = actPct(s)
                  return (
                    <div key={s.id} className={`rep-sp-row ${i % 2 === 1 ? 'rep-sp-odd' : ''} ${isActive ? 'rep-sp-active' : ''}`}>
                      <span className="rep-sd">{fmtDateLong(s.started_at)}</span>
                      <span className="rep-sd">
                        {late
                          ? <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, background: '#fef2f2', color: '#dc2626', fontSize: 11, fontWeight: 600, border: '1px solid #fecaca' }}>Late</span>
                          : isActive
                            ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 20, background: '#dcfce7', color: '#16a34a', fontSize: 11, fontWeight: 600 }}>
                                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#16a34a' }} />Active
                              </span>
                            : <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, background: '#f1f5f9', color: '#64748b', fontSize: 11 }}>On time</span>}
                      </span>
                      <span className="rep-sd rep-mono">{fmtTime(s.started_at)}</span>
                      <span className="rep-sd rep-mono">{isActive ? <span className="rep-live-pill">● Active</span> : fmtTime(s.ended_at)}</span>
                      <span className="rep-sd rep-mono">{isActive ? <span className="rep-muted">—</span> : `${hours.toFixed(2)}h`}</span>
                      <span className="rep-sd rep-mono">{idleMin > 0 ? <span className="rep-idle-val">−{idleMin}m</span> : <span className="rep-muted">—</span>}</span>
                      <span className="rep-sd">{pct !== null ? <span style={{ color: pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444', fontWeight: 600, fontSize: 12 }}>{pct}%</span> : <span className="rep-muted">—</span>}</span>
                      <span className="rep-sd rep-sd-r rep-earn">{isActive ? <span className="rep-muted" style={{ fontSize: 11 }}>In progress</span> : fmtCurrency(hours * rate)}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Sessions Log view ─────────────────────────────────────────────────────────
function SessionsLog({ sessions, profiles, search }) {
  const searched = search
    ? sessions.filter(s => {
        const prof = profiles[s.employee_id]
        const q = search.toLowerCase()
        return (prof?.full_name || prof?.email || '').toLowerCase().includes(q)
          || (prof?.department || '').toLowerCase().includes(q)
      })
    : sessions

  const byDate = {}
  searched.forEach(s => { const k = fmtDateKey(s.started_at); if (!byDate[k]) byDate[k] = []; byDate[k].push(s) })
  const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a))

  if (sortedDates.length === 0) return <div className="rep-state">No sessions match your search.</div>

  return (
    <div className="rep-log-wrap">
      <div className="rep-log-head">
        <span className="rep-lh">Employee</span>
        <span className="rep-lh">Department</span>
        <span className="rep-lh">Clock In</span>
        <span className="rep-lh">Clock Out</span>
        <span className="rep-lh">Duration</span>
        <span className="rep-lh">Idle</span>
        <span className="rep-lh">Activity</span>
        <span className="rep-lh rep-lh-r">Earned</span>
      </div>
      {sortedDates.map(dateKey => {
        const dateSessions = byDate[dateKey]
        const dateHours    = dateSessions.filter(s => s.ended_at).reduce((sum, s) => sum + (Number(s.duration_hours) || 0), 0)
        const dateEarned   = dateSessions.filter(s => s.ended_at).reduce((sum, s) => sum + (Number(s.duration_hours) || 0) * (Number(profiles[s.employee_id]?.hourly_rate) || 0), 0)
        return (
          <div key={dateKey} className="rep-date-group">
            <div className="rep-date-hdr">
              <span className="rep-date-label">{fmtDateKeyDisplay(dateKey)}</span>
              <span className="rep-date-summary">{dateSessions.length} session{dateSessions.length !== 1 ? 's' : ''}&nbsp;·&nbsp;{dateHours.toFixed(1)}h&nbsp;·&nbsp;{fmtCurrency(dateEarned)}</span>
            </div>
            {dateSessions.map((s, i) => {
              const prof     = profiles[s.employee_id]
              if (!prof) return null
              const isActive = !s.ended_at
              const hours    = Number(s.duration_hours) || 0
              const idleMin  = Math.round((Number(s.accumulated_idle_secs) || 0) / 60)
              const pct      = actPct(s)
              const rate     = Number(prof.hourly_rate) || 0
              const color    = deptColor(prof.department)
              return (
                <div key={s.id} className={`rep-log-row ${i % 2 === 1 ? 'rep-log-odd' : ''} ${isActive ? 'rep-log-active' : ''}`}>
                  <div className="rep-ld rep-ld-emp">
                    <UserAvatar userId={prof.id} name={prof.full_name} avatarUrl={prof.avatar_url}
                      className="rep-log-avatar" style={{ background: color + '18', color, border: `1.5px solid ${color}35` }} />
                    <span className="rep-log-name">{prof.full_name || prof.email}</span>
                  </div>
                  <div className="rep-ld">{prof.department ? <span className="rep-dept-chip" style={{ background: color + '14', color, border: `1px solid ${color}28` }}>{prof.department}</span> : <span className="rep-muted">—</span>}</div>
                  <span className="rep-ld rep-mono">{fmtTime(s.started_at)}</span>
                  <span className="rep-ld rep-mono">{isActive ? <span className="rep-live-pill">● Active</span> : fmtTime(s.ended_at)}</span>
                  <span className="rep-ld rep-mono">{isActive ? <span className="rep-muted">—</span> : `${hours.toFixed(2)}h`}</span>
                  <span className="rep-ld rep-mono">{idleMin > 0 ? <span className="rep-idle-val">−{idleMin}m</span> : <span className="rep-muted">—</span>}</span>
                  <span className="rep-ld">{pct !== null ? <span style={{ color: pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444', fontWeight: 600, fontSize: 12 }}>{pct}%</span> : <span className="rep-muted">—</span>}</span>
                  <span className="rep-ld rep-ld-r rep-earn">{isActive ? <span className="rep-muted" style={{ fontSize: 11 }}>In progress</span> : fmtCurrency(hours * rate)}</span>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
