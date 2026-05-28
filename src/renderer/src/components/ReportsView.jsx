import { useState, useEffect, useCallback } from 'react'
import {
  FileText, Calendar, Users, Clock, DollarSign, TrendingUp,
  ChevronDown, ChevronUp, Download, ShieldAlert, ShieldCheck, Camera, X
} from 'lucide-react'
import { supabase } from '../lib/supabase'
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

// ── Shared helpers ────────────────────────────────────────────────────────────
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
function getRange(periodId) {
  const now = new Date()
  if (periodId === 'alltime') return { start: null, end: null }
  if (periodId === 'today') {
    const s = new Date(now); s.setHours(0, 0, 0, 0)
    return { start: s, end: now }
  }
  if (periodId === 'week') {
    const s = new Date(now)
    const day = s.getDay()
    s.setDate(s.getDate() - (day === 0 ? 6 : day - 1))
    s.setHours(0, 0, 0, 0)
    return { start: s, end: now }
  }
  if (periodId === 'month') {
    return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now }
  }
  return { start: null, end: null }
}

const PERIOD_LABELS = { today: 'Today', week: 'This Week', month: 'This Month', alltime: 'All Time' }

// ── Root component ────────────────────────────────────────────────────────────
export default function ReportsView({ managedDept }) {
  const [period,         setPeriod]         = useState('today')
  const [viewMode,       setViewMode]       = useState('worker') // 'worker' | 'log' | 'violations'
  const [deptFilter,     setDeptFilter]     = useState('all')
  const [sessions,       setSessions]       = useState([])
  const [profiles,       setProfiles]       = useState({})
  const [depts,          setDepts]          = useState([])
  const [loading,        setLoading]        = useState(true)
  const [expandedWorker, setExpandedWorker] = useState(null)

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
  useEffect(() => { setExpandedWorker(null) }, [period, viewMode, deptFilter])

  const filtered = sessions.filter(s => {
    const prof = profiles[s.employee_id]
    if (!prof) return false
    if (managedDept && prof.department !== managedDept) return false
    if (deptFilter !== 'all' && prof.department !== deptFilter) return false
    return true
  })

  const completed    = filtered.filter(s => s.ended_at)
  const totalHours   = completed.reduce((sum, s) => sum + (Number(s.duration_hours) || 0), 0)
  const totalEarned  = completed.reduce((sum, s) => sum + (Number(s.duration_hours) || 0) * (Number(profiles[s.employee_id]?.hourly_rate) || 0), 0)
  const avgActivity  = completed.length ? Math.round(completed.reduce((sum, s) => sum + (actPct(s) ?? 100), 0) / completed.length) : null
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
    a.download = `PharmaStaff_Report_${PERIOD_LABELS[period].replace(' ','')}_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const isViolations = viewMode === 'violations'

  return (
    <div className="rep-wrap">
      {/* Header */}
      <div className="rep-header">
        <div>
          <h2 className="rep-title">Attendance Reports</h2>
          <p className="rep-sub">
            {isViolations
              ? `Prohibited app usage detected from screenshots${managedDept ? ` — ${managedDept}` : ''}`
              : `Clock-in / clock-out records, hours worked, and earnings${managedDept ? ` — ${managedDept}` : ''}`}
          </p>
        </div>
        {!isViolations && (
          <button className="rep-export-btn" onClick={exportCSV} disabled={filtered.length === 0}>
            <Download size={14} />
            Export CSV
          </button>
        )}
      </div>

      {/* Toolbar */}
      <div className="rep-toolbar">
        <div className="rep-period-tabs">
          {Object.entries(PERIOD_LABELS).map(([id, label]) => (
            <button key={id} className={`rep-period-tab ${period === id ? 'rep-period-active' : ''}`} onClick={() => setPeriod(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="rep-toolbar-right">
          {!managedDept && depts.length > 1 && (
            <select className="rep-dept-select" value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
              <option value="all">All Departments</option>
              {depts.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          <div className="rep-view-toggle">
            <button className={`rep-view-btn ${viewMode === 'worker' ? 'rep-view-active' : ''}`} onClick={() => setViewMode('worker')}>
              <Users size={12} />By Worker
            </button>
            <button className={`rep-view-btn ${viewMode === 'log' ? 'rep-view-active' : ''}`} onClick={() => setViewMode('log')}>
              <FileText size={12} />Sessions Log
            </button>
            <button className={`rep-view-btn rep-view-btn-danger ${viewMode === 'violations' ? 'rep-view-active-danger' : ''}`} onClick={() => setViewMode('violations')}>
              <ShieldAlert size={12} />Violations
            </button>
          </div>
        </div>
      </div>

      {/* Summary stats — hidden in violations mode (violations has its own) */}
      {!isViolations && (
        <div className="rep-stats">
          <div className="rep-stat-card">
            <div className="rep-stat-icon" style={{ background: '#6366f112', color: '#6366f1' }}><Users size={18} /></div>
            <div className="rep-stat-body"><span className="rep-stat-num">{uniqueWorkers}</span><span className="rep-stat-lbl">Workers</span></div>
          </div>
          <div className="rep-stat-card">
            <div className="rep-stat-icon" style={{ background: '#3b82f612', color: '#3b82f6' }}><Calendar size={18} /></div>
            <div className="rep-stat-body"><span className="rep-stat-num">{filtered.length}</span><span className="rep-stat-lbl">Sessions</span></div>
          </div>
          <div className="rep-stat-card">
            <div className="rep-stat-icon" style={{ background: '#10b98112', color: '#10b981' }}><Clock size={18} /></div>
            <div className="rep-stat-body"><span className="rep-stat-num">{totalHours.toFixed(1)}h</span><span className="rep-stat-lbl">Total Hours</span></div>
          </div>
          <div className="rep-stat-card">
            <div className="rep-stat-icon" style={{ background: '#f59e0b12', color: '#f59e0b' }}><TrendingUp size={18} /></div>
            <div className="rep-stat-body"><span className="rep-stat-num">{avgActivity !== null ? `${avgActivity}%` : '—'}</span><span className="rep-stat-lbl">Avg Activity</span></div>
          </div>
          <div className="rep-stat-card">
            <div className="rep-stat-icon" style={{ background: '#05966912', color: '#059669' }}><DollarSign size={18} /></div>
            <div className="rep-stat-body"><span className="rep-stat-num">{fmtCurrency(totalEarned)}</span><span className="rep-stat-lbl">Total Earned</span></div>
          </div>
        </div>
      )}

      {/* Content */}
      {isViolations ? (
        <ViolationsView period={period} managedDept={managedDept} deptFilter={deptFilter} profiles={profiles} />
      ) : loading ? (
        <div className="rep-state">Loading report…</div>
      ) : filtered.length === 0 ? (
        <div className="rep-state">No sessions found for this period.</div>
      ) : viewMode === 'worker' ? (
        <WorkerView sessions={filtered} profiles={profiles} expandedWorker={expandedWorker} setExpandedWorker={setExpandedWorker} />
      ) : (
        <SessionsLog sessions={filtered} profiles={profiles} />
      )}
    </div>
  )
}

// ── Violations view ───────────────────────────────────────────────────────────
function ViolationsView({ period, managedDept, deptFilter, profiles }) {
  const [patterns,      setPatterns]      = useState(loadProhibited)
  const [screenshots,   setScreenshots]   = useState([])
  const [loading,       setLoading]       = useState(true)
  const [refreshKey,    setRefreshKey]    = useState(0)
  const [expandedWorker,setExpandedWorker]= useState(null)
  const [loadedImages,  setLoadedImages]  = useState({}) // { empId: string[] }
  const [loadingImages, setLoadingImages] = useState(null)
  const [lightbox,      setLightbox]      = useState(null) // { url, meta }

  // Re-read patterns from localStorage each time this view mounts / period changes
  useEffect(() => { setPatterns(loadProhibited()) }, [period])

  useEffect(() => {
    async function load() {
      setLoading(true)
      setExpandedWorker(null)
      setLoadedImages({})
      const { start, end } = getRange(period)

      // Supabase REST API caps at 1000 rows — paginate to get everything
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

  // Most commonly detected app label
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
    const urls  = window.electronAPI?.fetchScreenshotImages
      ? await window.electronAPI.fetchScreenshotImages(paths)
      : null
    setLoadedImages(prev => ({ ...prev, [empId]: urls || [] }))
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
      {/* Violation stats */}
      <div className="rep-stats">
        <div className="rep-stat-card">
          <div className="rep-stat-icon" style={{ background: '#ef444412', color: '#ef4444' }}><ShieldAlert size={18} /></div>
          <div className="rep-stat-body"><span className="rep-stat-num" style={{ color: '#ef4444' }}>{violations.length}</span><span className="rep-stat-lbl">Violations Found</span></div>
        </div>
        <div className="rep-stat-card">
          <div className="rep-stat-icon" style={{ background: '#f97316' + '12', color: '#f97316' }}><Users size={18} /></div>
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
            <button
              className="rep-refresh-btn"
              onClick={() => setRefreshKey(k => k + 1)}
              disabled={loading}
              title="Refresh violations"
            >
              {loading ? '…' : '↻ Refresh'}
            </button>
          </div>

          {workers.map(([empId, empViolations]) => {
            const prof    = profiles[empId]
            if (!prof) return null
            const color   = deptColor(prof.department)
            const isOpen  = expandedWorker === empId
            const images  = loadedImages[empId] || []
            const latest  = empViolations[0]
            const labels  = [...new Set(empViolations.map(v => matchesProhibited(v, patterns)?.label).filter(Boolean))]

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
                              {imgUrl ? (
                                <img src={imgUrl} alt="" className="rep-viol-thumb" />
                              ) : (
                                <div className="rep-viol-thumb-ph"><Camera size={20} style={{ color: 'var(--text-muted)' }} /></div>
                              )}
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

      {/* Lightbox */}
      {lightbox && (
        <div className="rep-lightbox" onClick={() => setLightbox(null)}>
          <div className="rep-lb-inner" onClick={e => e.stopPropagation()}>
            <img src={lightbox.url} alt="" className="rep-lb-img" />
            <div className="rep-lb-meta">
              <div className="rep-lb-time">
                {new Date(lightbox.meta.taken_at).toLocaleString('en-US', {
                  weekday: 'long', month: 'long', day: 'numeric',
                  hour: '2-digit', minute: '2-digit', timeZone: NY
                })}
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
function WorkerView({ sessions, profiles, expandedWorker, setExpandedWorker }) {
  const byWorker = {}
  sessions.forEach(s => {
    if (!byWorker[s.employee_id]) byWorker[s.employee_id] = []
    byWorker[s.employee_id].push(s)
  })
  const workers = Object.entries(byWorker).sort((a, b) =>
    b[1].reduce((s, x) => s + (Number(x.duration_hours) || 0), 0) -
    a[1].reduce((s, x) => s + (Number(x.duration_hours) || 0), 0)
  )

  return (
    <div className="rep-worker-wrap">
      <div className="rep-worker-head">
        <span className="rep-th">Employee</span>
        <span className="rep-th rep-th-c">Sessions</span>
        <span className="rep-th rep-th-c">Total Hours</span>
        <span className="rep-th rep-th-c">Avg Activity</span>
        <span className="rep-th rep-th-r">Total Earned</span>
        <span style={{ width: 96 }} />
      </div>

      {workers.map(([empId, empSessions]) => {
        const prof    = profiles[empId]
        if (!prof) return null
        const done    = empSessions.filter(s => s.ended_at)
        const totalH  = done.reduce((sum, s) => sum + (Number(s.duration_hours) || 0), 0)
        const rate    = Number(prof.hourly_rate) || 0
        const avgAct  = done.length ? Math.round(done.reduce((sum, s) => sum + (actPct(s) ?? 100), 0) / done.length) : null
        const isOpen  = expandedWorker === empId
        const color   = deptColor(prof.department)
        const active  = empSessions.filter(s => !s.ended_at).length

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
              <div className="rep-td rep-td-c">
                <span className="rep-sess-count">{empSessions.length}</span>
                {active > 0 && <span className="rep-live-dot" title="Active now" />}
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
                  <span className="rep-sth">Clock In</span>
                  <span className="rep-sth">Clock Out</span>
                  <span className="rep-sth">Duration</span>
                  <span className="rep-sth">Idle Deducted</span>
                  <span className="rep-sth">Activity</span>
                  <span className="rep-sth rep-sth-r">Earned</span>
                </div>
                {empSessions.map((s, i) => {
                  const isActive = !s.ended_at
                  const hours    = Number(s.duration_hours) || 0
                  const idleMin  = Math.round((Number(s.accumulated_idle_secs) || 0) / 60)
                  const pct      = actPct(s)
                  return (
                    <div key={s.id} className={`rep-sp-row ${i % 2 === 1 ? 'rep-sp-odd' : ''} ${isActive ? 'rep-sp-active' : ''}`}>
                      <span className="rep-sd">{fmtDateLong(s.started_at)}</span>
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
function SessionsLog({ sessions, profiles }) {
  const byDate = {}
  sessions.forEach(s => { const k = fmtDateKey(s.started_at); if (!byDate[k]) byDate[k] = []; byDate[k].push(s) })
  const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a))

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
        const dateHours  = dateSessions.filter(s => s.ended_at).reduce((sum, s) => sum + (Number(s.duration_hours) || 0), 0)
        const dateEarned = dateSessions.filter(s => s.ended_at).reduce((sum, s) => sum + (Number(s.duration_hours) || 0) * (Number(profiles[s.employee_id]?.hourly_rate) || 0), 0)
        return (
          <div key={dateKey} className="rep-date-group">
            <div className="rep-date-hdr">
              <span className="rep-date-label">{fmtDateKeyDisplay(dateKey)}</span>
              <span className="rep-date-summary">{dateSessions.length} session{dateSessions.length !== 1 ? 's' : ''}&nbsp;·&nbsp;{dateHours.toFixed(1)}h&nbsp;·&nbsp;{fmtCurrency(dateEarned)}</span>
            </div>
            {dateSessions.map((s, i) => {
              const prof    = profiles[s.employee_id]
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
