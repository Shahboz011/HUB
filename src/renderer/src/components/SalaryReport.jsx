import { useState, useEffect } from 'react'
import { ChevronDown, FileSpreadsheet } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'

function fmt(v) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(v)
}

function calcHours(empId, sessionsMap) {
  const sessions = sessionsMap[empId] || []
  return sessions.reduce((sum, s) => {
    if (s.ended_at) return sum + (Number(s.duration_hours) || 0)
    return sum + (Date.now() - new Date(s.started_at).getTime()) / 3600000
  }, 0)
}

function calcNet(hours, emp) {
  return Math.max(0, hours * Number(emp.hourly_rate) + Number(emp.bonuses) - Number(emp.fines))
}

export default function SalaryReport() {
  const [employees, setEmployees] = useState([])
  const [sessionsMap, setSessionsMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(new Set())

  useEffect(() => {
    async function load() {
      const [{ data: profiles }, { data: sessions }] = await Promise.all([
        supabase.from('profiles').select('*').order('full_name'),
        supabase.from('work_sessions').select('*'),
      ])
      if (profiles) setEmployees(profiles)
      if (sessions) {
        const map = {}
        sessions.forEach(s => {
          if (!map[s.employee_id]) map[s.employee_id] = []
          map[s.employee_id].push(s)
        })
        setSessionsMap(map)
      }
      setLoading(false)
    }

    load()

    // Realtime: clock-in / clock-out
    const sessionSub = supabase
      .channel('sr-sessions')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'work_sessions' },
        ({ new: row }) => {
          setSessionsMap(prev => ({
            ...prev,
            [row.employee_id]: [...(prev[row.employee_id] || []), row],
          }))
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'work_sessions' },
        ({ new: row }) => {
          setSessionsMap(prev => ({
            ...prev,
            [row.employee_id]: (prev[row.employee_id] || []).map(s => s.id === row.id ? row : s),
          }))
        })
      .subscribe()

    // Polling fallback: re-sync sessions every 30s in case realtime events are missed
    const pollId = setInterval(async () => {
      const { data } = await supabase.from('work_sessions').select('*')
      if (data) {
        const map = {}
        data.forEach(s => {
          if (!map[s.employee_id]) map[s.employee_id] = []
          map[s.employee_id].push(s)
        })
        setSessionsMap(map)
      }
    }, 30000)

    return () => {
      supabase.removeChannel(sessionSub)
      clearInterval(pollId)
    }
  }, [])

  function toggle(dept) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(dept)) next.delete(dept)
      else next.add(dept)
      return next
    })
  }

  function exportToExcel() {
    const rows = []
    const grps = {}
    employees.forEach(emp => {
      const key = emp.department || '— Unassigned —'
      if (!grps[key]) grps[key] = []
      grps[key].push(emp)
    })
    Object.entries(grps).sort(([a], [b]) => a.localeCompare(b)).forEach(([dept, emps]) => {
      emps.forEach((emp, i) => {
        const hours = calcHours(emp.id, sessionsMap)
        const base = hours * Number(emp.hourly_rate)
        const net = calcNet(hours, emp)
        rows.push({
          '#': i + 1,
          Department: dept,
          Employee: emp.full_name || '',
          Email: emp.email || '',
          Position: emp.position || '',
          'Hourly Rate ($)': Number(emp.hourly_rate) || 0,
          'Hours Worked': parseFloat(hours.toFixed(2)),
          'Base Pay ($)': parseFloat(base.toFixed(2)),
          'Bonuses ($)': Number(emp.bonuses) || 0,
          'Deductions ($)': Number(emp.fines) || 0,
          'Net Salary ($)': parseFloat(net.toFixed(2)),
        })
      })
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Salary Report')
    XLSX.writeFile(wb, `salary-report-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  if (loading) return <div className="table-loading">Loading salary report…</div>

  const groups = {}
  employees.forEach(emp => {
    const key = emp.department || '— Unassigned —'
    if (!groups[key]) groups[key] = []
    groups[key].push(emp)
  })

  const grandHours = employees.reduce((sum, e) => sum + calcHours(e.id, sessionsMap), 0)
  const grandTotal = employees.reduce((sum, e) => sum + calcNet(calcHours(e.id, sessionsMap), e), 0)
  const grandBonuses = employees.reduce((sum, e) => sum + Number(e.bonuses), 0)
  const grandFines = employees.reduce((sum, e) => sum + Number(e.fines), 0)

  return (
    <div className="sr-wrap">
      <div className="sr-topbar">
        <div>
          <h2 className="sr-title">Salary Report</h2>
          <p className="sr-subtitle">{employees.length} employees · {Object.keys(groups).length} departments</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="sr-export-btn" onClick={exportToExcel}>
            <FileSpreadsheet size={14} />
            Export to Excel
          </button>
          <div className="sr-grand-total">
            <span className="sr-gt-label">Total Payroll</span>
            <span className="sr-gt-value">{fmt(grandTotal)}</span>
          </div>
        </div>
      </div>

      <div className="sr-table">
        {/* Column headers — only visible when any dept is expanded */}
        {expanded.size > 0 && (
          <div className="sr-thead">
            <span className="sr-col-num">#</span>
            <span className="sr-col-emp">Employee</span>
            <span className="sr-col-pos">Position</span>
            <span className="sr-col-rate">Rate</span>
            <span className="sr-col-hrs">Hours</span>
            <span className="sr-col-base">Base Pay</span>
            <span className="sr-col-bonus">Bonus</span>
            <span className="sr-col-fine">Deductions</span>
            <span className="sr-col-net">Net Salary</span>
          </div>
        )}

        {Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([dept, emps]) => {
          const deptHours = emps.reduce((s, e) => s + calcHours(e.id, sessionsMap), 0)
          const deptNet = emps.reduce((s, e) => s + calcNet(calcHours(e.id, sessionsMap), e), 0)
          const deptBonuses = emps.reduce((s, e) => s + Number(e.bonuses), 0)
          const deptFines = emps.reduce((s, e) => s + Number(e.fines), 0)
          const deptBase = emps.reduce((s, e) => s + calcHours(e.id, sessionsMap) * Number(e.hourly_rate), 0)
          const isOpen = expanded.has(dept)

          return (
            <div key={dept} className="sr-dept-block">
              {/* Clickable department summary row */}
              <div className={`sr-dept-header sr-dept-header-clickable ${isOpen ? 'sr-dept-header-open' : ''}`} onClick={() => toggle(dept)}>
                <ChevronDown size={14} className={`sr-dept-chevron ${isOpen ? 'sr-dept-chevron-open' : ''}`} />
                <span className="sr-dept-name">{dept}</span>
                <span className="sr-dept-count">{emps.length} employee{emps.length !== 1 ? 's' : ''}</span>
                <div className="sr-dept-summary">
                  <span className="sr-mono sr-text-muted">{deptHours.toFixed(2)}h</span>
                  <span className="sr-mono sr-bold sr-highlight">{fmt(deptNet)}</span>
                </div>
              </div>

              {/* Expanded: individual rows + subtotal */}
              {isOpen && (
                <>
                  {emps.map((emp, i) => {
                    const hours = calcHours(emp.id, sessionsMap)
                    const base = hours * Number(emp.hourly_rate)
                    const net = calcNet(hours, emp)
                    const hasActive = (sessionsMap[emp.id] || []).some(s => !s.ended_at)
                    return (
                      <div key={emp.id} className={`sr-row ${i % 2 === 1 ? 'sr-row-odd' : ''}`}>
                        <span className="sr-col-num sr-idx">{i + 1}</span>
                        <div className="sr-col-emp">
                          <span className="sr-emp-name">
                            {emp.full_name || '—'}
                            {hasActive && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--positive)', fontWeight: 700 }}>● Live</span>}
                          </span>
                          <span className="sr-emp-email">{emp.email}</span>
                        </div>
                        <span className="sr-col-pos sr-text-muted">{emp.position || '—'}</span>
                        <span className="sr-col-rate sr-mono">${Number(emp.hourly_rate) || 0}/hr</span>
                        <span className="sr-col-hrs sr-mono">{hours.toFixed(2)}h</span>
                        <span className="sr-col-base sr-mono">{fmt(base)}</span>
                        <span className="sr-col-bonus sr-positive">{Number(emp.bonuses) > 0 ? `+${fmt(emp.bonuses)}` : '—'}</span>
                        <span className="sr-col-fine sr-negative">{Number(emp.fines) > 0 ? `-${fmt(emp.fines)}` : '—'}</span>
                        <span className="sr-col-net sr-mono sr-bold">{fmt(net)}</span>
                      </div>
                    )
                  })}

                  <div className="sr-dept-subtotal">
                    <span className="sr-col-num" />
                    <span className="sr-col-emp sr-subtotal-label">{dept} Total</span>
                    <span className="sr-col-pos" />
                    <span className="sr-col-rate" />
                    <span className="sr-col-hrs sr-mono sr-bold">{deptHours.toFixed(2)}h</span>
                    <span className="sr-col-base sr-mono sr-bold">{fmt(deptBase)}</span>
                    <span className="sr-col-bonus sr-positive sr-bold">{deptBonuses > 0 ? `+${fmt(deptBonuses)}` : '—'}</span>
                    <span className="sr-col-fine sr-negative sr-bold">{deptFines > 0 ? `-${fmt(deptFines)}` : '—'}</span>
                    <span className="sr-col-net sr-mono sr-bold sr-highlight">{fmt(deptNet)}</span>
                  </div>
                </>
              )}
            </div>
          )
        })}

        {/* Grand total row */}
        <div className="sr-grand-row">
          <span className="sr-col-num" />
          <span className="sr-col-emp sr-grand-label">Grand Total</span>
          <span className="sr-col-pos" />
          <span className="sr-col-rate" />
          <span className="sr-col-hrs sr-mono">{grandHours.toFixed(1)}h</span>
          <span className="sr-col-base sr-mono">{fmt(employees.reduce((s,e) => s + calcHours(e.id, sessionsMap)*Number(e.hourly_rate), 0))}</span>
          <span className="sr-col-bonus sr-positive">{grandBonuses > 0 ? `+${fmt(grandBonuses)}` : '—'}</span>
          <span className="sr-col-fine sr-negative">{grandFines > 0 ? `-${fmt(grandFines)}` : '—'}</span>
          <span className="sr-col-net sr-grand-net">{fmt(grandTotal)}</span>
        </div>
      </div>
    </div>
  )
}
