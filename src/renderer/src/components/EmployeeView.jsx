import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

function fmt(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value)
}

export default function EmployeeView({ profile }) {
  const [fresh, setFresh] = useState(profile)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!profile?.id) return
    setLoading(true)
    supabase.from('profiles').select('*').eq('id', profile.id).single()
      .then(({ data }) => { if (data) setFresh(data); setLoading(false) })
  }, [profile?.id])

  if (loading) return <div className="ev-loading">Loading your salary info…</div>

  if (!fresh?.department) {
    return (
      <div className="ev-wrap">
        <div className="ev-card" style={{ textAlign: 'center', gap: 16 }}>
          <div className="auth-logo-wrap">
            <div className="logo-mark" style={{ width: 48, height: 48 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
            </div>
          </div>
          <h2 className="ev-name">Welcome, {fresh?.full_name || 'Employee'}!</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            Your account is active but your department hasn't been assigned yet.
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Contact your admin — they will assign your department, position, and hourly rate. Your salary info will appear here once set up.
          </p>
        </div>
      </div>
    )
  }

  const hours = Number(fresh.hours_worked) || 0
  const rate = Number(fresh.hourly_rate) || 0
  const bonuses = Number(fresh.bonuses) || 0
  const fines = Number(fresh.fines) || 0
  const base = hours * rate
  const net = Math.max(0, base + bonuses - fines)
  const initials = fresh.full_name
    ? fresh.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  return (
    <div className="ev-wrap">
      <div className="ev-card">
        <div className="ev-header">
          <div className="ev-avatar" style={{ background: '#6366f118', border: '2px solid #6366f140', color: '#6366f1' }}>
            {initials}
          </div>
          <div>
            <h2 className="ev-name">{fresh.full_name || 'Employee'}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span className="ev-dept-tag" style={{ background: '#6366f115', color: '#6366f1', border: '1px solid #6366f130' }}>
                {fresh.department}
              </span>
              {fresh.position && <span className="ev-position">{fresh.position}</span>}
            </div>
          </div>
        </div>

        <div className="ev-grid">
          <div className="ev-stat-card">
            <span className="ev-stat-label">Hours Worked</span>
            <span className="ev-stat-value">{hours}h</span>
          </div>
          <div className="ev-stat-card">
            <span className="ev-stat-label">Hourly Rate</span>
            <span className="ev-stat-value">${rate}/hr</span>
          </div>
          <div className="ev-stat-card">
            <span className="ev-stat-label">Base Pay</span>
            <span className="ev-stat-value">{fmt(base)}</span>
          </div>
          <div className="ev-stat-card ev-positive">
            <span className="ev-stat-label">Bonuses</span>
            <span className="ev-stat-value">{fmt(bonuses)}</span>
          </div>
          <div className="ev-stat-card ev-negative">
            <span className="ev-stat-label">Deductions</span>
            <span className="ev-stat-value">{fmt(fines)}</span>
          </div>
          <div className="ev-stat-card ev-highlight">
            <span className="ev-stat-label">Net Salary</span>
            <span className="ev-stat-value ev-big">{fmt(net)}</span>
          </div>
        </div>

        <p className="ev-note">Hours, bonuses, and deductions are managed by your admin.</p>
      </div>
    </div>
  )
}
