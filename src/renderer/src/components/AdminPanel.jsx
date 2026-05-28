import { useState, useEffect } from 'react'
import { ArrowLeft, UserPlus, ChevronRight, Trash2, Clock, ShieldAlert } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { loadProhibited, saveProhibited, DEFAULT_PROHIBITED } from './ReportsView'

// Safe IPC wrapper — works in Electron; falls back gracefully in browser preview
const electronAPI = window.electronAPI ?? {
  inviteMember:     async () => ({ ok: false, error: 'Not running in Electron. Please use the desktop app.' }),
  deleteMember:     async () => ({ ok: false, error: 'Not running in Electron. Please use the desktop app.' }),
  updateMember:     async () => ({ ok: false, error: 'Not running in Electron. Please use the desktop app.' }),
  updateDepartment: async () => ({ ok: false, error: 'Not running in Electron. Please use the desktop app.' }),
  copyToClipboard:  async (text) => { try { await navigator.clipboard.writeText(text) } catch {} },
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

const DEPT_COLORS = [
  '#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981',
  '#3b82f6','#14b8a6','#f97316','#ef4444','#06b6d4',
]
function deptColor(dept) {
  if (!dept) return '#94a3b8'
  let hash = 0
  for (let i = 0; i < dept.length; i++) hash = dept.charCodeAt(i) + ((hash << 5) - hash)
  return DEPT_COLORS[Math.abs(hash) % DEPT_COLORS.length]
}
function initials(name) {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

// ── Department detail: members + invite ──────────────────────────────────────
function DeptMembers({ dept, employees, departments, onBack, onEmployeeUpdate, onEmployeeDelete, currentUserId, isSuperAdmin = true, schedule = null, onScheduleChange }) {
  const [showInvite, setShowInvite] = useState(false)
  const [workStart,   setWorkStart]   = useState(schedule?.work_start?.slice(0,5) || '09:00')
  const [workEnd,     setWorkEnd]     = useState(schedule?.work_end?.slice(0,5)   || '19:00')
  const [schedSaving, setSchedSaving] = useState(false)
  const [schedMsg,    setSchedMsg]    = useState('')

  async function saveSchedule() {
    setSchedSaving(true); setSchedMsg('')
    const result = await electronAPI.updateDepartment({ name: dept, fields: { work_start: workStart, work_end: workEnd } })
    if (result.ok) {
      setSchedMsg('✓ Saved')
      onScheduleChange?.({ work_start: workStart, work_end: workEnd })
    } else {
      setSchedMsg('Error: ' + result.error)
    }
    setSchedSaving(false)
    setTimeout(() => setSchedMsg(''), 3000)
  }
  const [invEmail, setInvEmail] = useState('')
  const [invPosition, setInvPosition] = useState('')
  const [invRate, setInvRate] = useState('')
  const [inviting, setInviting] = useState(false)
  const [createdCredentials, setCreatedCredentials] = useState(null) // { email, tempPassword }
  const [invErr, setInvErr] = useState('')
  const [copied, setCopied] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deleteErr, setDeleteErr] = useState('')

  const members = employees.filter(e => e.department === dept)
  const color = deptColor(dept)

  async function sendInvite() {
    if (!invEmail.trim()) { setInvErr('Email is required'); return }
    setInviting(true); setInvErr(''); setCreatedCredentials(null); setCopied(false)

    const rate = Number(invRate) || 0
    const result = await electronAPI.inviteMember({
      email: invEmail.trim(),
      department: dept,
      position: invPosition.trim(),
      hourly_rate: rate,
    })

    if (!result.ok) { setInvErr(result.error); setInviting(false); return }

    await supabase.from('invitations').upsert(
      { email: invEmail.trim(), department: dept, position: invPosition.trim(), hourly_rate: rate },
      { onConflict: 'email' }
    )

    setCreatedCredentials({ email: invEmail.trim(), tempPassword: result.tempPassword })
    setInvEmail(''); setInvPosition(''); setInvRate('')
    setInviting(false)
  }

  async function copyCredentials() {
    const { email, tempPassword } = createdCredentials
    const text = `PharmaStaff Hub Login\nEmail: ${email}\nTemp Password: ${tempPassword}\n\nOpen the app and sign in. You will be asked to set your name and a new password.`
    await electronAPI.copyToClipboard(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  async function removeMember(emp) {
    await supabase.from('profiles').update({ department: null }).eq('id', emp.id)
    onEmployeeUpdate(emp.id, 'department', null)
  }

  async function deleteEmployee(emp) {
    setDeleteErr('')
    const result = await electronAPI.deleteMember({ userId: emp.id })
    if (!result.ok) { setDeleteErr(`Failed to delete ${emp.email || emp.id}: ${result.error}`); setConfirmDeleteId(null); return }
    onEmployeeDelete(emp.id)
    setConfirmDeleteId(null)
  }

  return (
    <div className="dept-detail-wrap">
      <div className="att-topbar">
        {onBack && (
          <button className="att-back-btn" onClick={onBack}>
            <ArrowLeft size={16} />
            Departments
          </button>
        )}
        <span className="att-breadcrumb">{dept}</span>

        <button
          className="dept-invite-btn"
          onClick={() => { setShowInvite(v => !v); setCreatedCredentials(null); setInvErr('') }}
          style={{ marginLeft: 'auto' }}
        >
          <UserPlus size={14} />
          Invite Member
        </button>
      </div>

      {/* ── Work Schedule ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <Clock size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', flexShrink: 0 }}>Work Schedule</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Salary starts</label>
          <input type="time" value={workStart} onChange={e => setWorkStart(e.target.value)} className="form-input" style={{ width: 120, padding: '4px 8px', fontSize: 13 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Salary ends</label>
          <input type="time" value={workEnd} onChange={e => setWorkEnd(e.target.value)} className="form-input" style={{ width: 120, padding: '4px 8px', fontSize: 13 }} />
        </div>
        <button className="dept-add-btn" onClick={saveSchedule} disabled={schedSaving} style={{ padding: '5px 14px', fontSize: 12 }}>
          {schedSaving ? 'Saving…' : 'Save Schedule'}
        </button>
        {schedMsg && <span style={{ fontSize: 12, color: schedMsg.startsWith('✓') ? 'var(--positive)' : 'var(--negative)', fontWeight: 600 }}>{schedMsg}</span>}
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          Salary counts from {workStart} → {workEnd}
        </span>
      </div>

      {/* Invite form */}
      {showInvite && (
        <div className="dept-invite-form">
          <h4 className="dept-invite-title">Invite to {dept}</h4>
          <div className="dept-invite-fields">
            <input
              type="email"
              value={invEmail}
              onChange={e => { setInvEmail(e.target.value); setInvErr('') }}
              placeholder="worker@email.com"
              className="form-input"
              style={{ flex: 2 }}
              onKeyDown={e => e.key === 'Enter' && sendInvite()}
            />
            <input
              type="text"
              value={invPosition}
              onChange={e => setInvPosition(e.target.value)}
              placeholder="Position (e.g. Driver)"
              className="form-input"
              style={{ flex: 2 }}
            />
            <div className="rate-input-wrap" style={{ flex: 1 }}>
              <span className="rate-symbol">$</span>
              <input
                type="number"
                min="0"
                step="1"
                value={invRate}
                onChange={e => setInvRate(e.target.value)}
                placeholder="0"
                className="rate-input"
              />
              <span className="rate-suffix">/hr</span>
            </div>
            <button
              className="dept-add-btn"
              onClick={sendInvite}
              disabled={inviting || !isValidEmail(invEmail.trim())}
            >
              {inviting ? 'Creating…' : 'Add Member'}
            </button>
          </div>
          {invErr && <p className="bf-error" style={{ marginTop: 8 }}>{invErr}</p>}

          {/* Credentials card shown after successful creation */}
          {createdCredentials && (
            <div className="cred-card">
              <div className="cred-card-header">
                <UserPlus size={15} style={{ color: 'var(--positive)' }} />
                <span>Account created! Share these credentials with the employee.</span>
              </div>
              <div className="cred-fields">
                <div className="cred-row">
                  <span className="cred-label">Email</span>
                  <span className="cred-value">{createdCredentials.email}</span>
                </div>
                <div className="cred-row">
                  <span className="cred-label">Temp Password</span>
                  <span className="cred-value cred-password">{createdCredentials.tempPassword}</span>
                </div>
              </div>
              <button className="cred-copy-btn" onClick={copyCredentials}>
                {copied ? '✓ Copied!' : 'Copy Credentials'}
              </button>
              <p className="cred-note">The employee opens the app, signs in with these credentials, then sets their own name and new password.</p>
            </div>
          )}

          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            No email is sent — share the credentials directly via WhatsApp, SMS, or in person.
          </p>
        </div>
      )}

      {/* Member list */}
      {members.length === 0 ? (
        <div className="empty-state" style={{ marginTop: 32, height: 'auto', padding: 32 }}>
          <p>No members in this department yet.</p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            Click "Invite Member" above to send an invite.
          </p>
        </div>
      ) : (
        <div className="dept-member-list">
          {members.map(emp => {
            const color = deptColor(emp.department)
            return (
              <div key={emp.id} className="dept-member-card">
                <div className="dept-member-avatar" style={{ background: color + '18', border: `2px solid ${color}40`, color }}>
                  {initials(emp.full_name)}
                </div>
                <div className="dept-member-info">
                  <div className="dept-member-name">{emp.full_name || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Setup pending…</span>}</div>
                  <div className="dept-member-email">{emp.email}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                    {emp.position && <span className="ev-dept-tag" style={{ background: '#6366f115', color: '#6366f1', border: '1px solid #6366f130', fontSize: 11 }}>{emp.position}</span>}
                    <span className="ev-rate-chip" style={{ fontSize: 11 }}>${Number(emp.hourly_rate) || 0}/hr</span>
                    <span className={`role-badge ${emp.role === 'admin' ? 'role-admin' : emp.role === 'subadmin' ? 'role-subadmin' : emp.role === 'diller' ? 'role-diller' : 'role-employee'}`} style={{ fontSize: 10 }}>{emp.role}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                  {confirmDeleteId === emp.id ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="dept-remove-btn dept-delete-confirm-btn" onClick={() => deleteEmployee(emp)}>Delete?</button>
                      <button className="dept-remove-btn" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="dept-remove-btn" onClick={() => removeMember(emp)} title="Remove from department">Remove</button>
                      {emp.id !== currentUserId && (
                        <button className="dept-remove-btn dept-delete-icon-btn" onClick={() => { setConfirmDeleteId(emp.id); setDeleteErr('') }} title="Delete user permanently">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {deleteErr && <p className="bf-error" style={{ marginTop: 12 }}>{deleteErr}</p>}
    </div>
  )
}

// ── Main AdminPanel ───────────────────────────────────────────────────────────
export default function AdminPanel({ departments, onDepartmentsChange, deptSchedules = {}, onSchedulesChange, currentUserId, isSuperAdmin = true, managedDept = null }) {
  const [activeSection, setActiveSection] = useState('departments')
  const [selectedDept, setSelectedDept] = useState(null)
  const [employees, setEmployees] = useState([])
  const [loadingEmps, setLoadingEmps] = useState(true)
  const [newDept, setNewDept] = useState('')
  const [deptError, setDeptError] = useState('')
  const [empSearch, setEmpSearch] = useState('')

  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deleteErr, setDeleteErr] = useState('')

  // Invite form state (Members tab)
  const [invEmail, setInvEmail] = useState('')
  const [invDept, setInvDept] = useState('')
  const [invPosition, setInvPosition] = useState('')
  const [invRate, setInvRate] = useState('')
  const [inviting, setInviting] = useState(false)
  const [invCredentials, setInvCredentials] = useState(null)
  const [invCopied, setInvCopied] = useState(false)
  const [invErr, setInvErr] = useState('')

  useEffect(() => {
    supabase
      .from('profiles')
      .select('*')
      .order('full_name')
      .then(({ data }) => { if (data) setEmployees(data); setLoadingEmps(false) })
  }, [])

  function updateLocalEmployee(id, field, value) {
    setEmployees(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e))
  }

  function removeLocalEmployee(id) {
    setEmployees(prev => prev.filter(e => e.id !== id))
  }

  async function handleDeleteEmployee(emp) {
    setDeleteErr('')
    const result = await electronAPI.deleteMember({ userId: emp.id })
    if (!result.ok) { setDeleteErr(`Failed to delete ${emp.email || emp.id}: ${result.error}`); setConfirmDeleteId(null); return }
    removeLocalEmployee(emp.id)
    setConfirmDeleteId(null)
  }

  async function addDepartment() {
    const name = newDept.trim()
    if (!name) return
    if (departments.includes(name)) { setDeptError('Department already exists'); return }
    setDeptError('')
    const { error } = await supabase.from('departments').insert({ name })
    if (error) { setDeptError(error.message); return }
    onDepartmentsChange([...departments, name].sort())
    setNewDept('')
  }

  async function deleteDepartment(name) {
    const hasEmployees = employees.some(e => e.department === name)
    if (hasEmployees) { setDeptError(`Cannot delete "${name}" — it has members assigned to it.`); return }
    setDeptError('')
    await supabase.from('departments').delete().eq('name', name)
    onDepartmentsChange(departments.filter(d => d !== name))
  }

  async function updateEmployee(id, field, value) {
    const parsed = ['hourly_rate', 'hours_worked', 'bonuses', 'fines'].includes(field)
      ? Number(value) || 0
      : value
    updateLocalEmployee(id, field, parsed)
    // Use service-key IPC (bypasses RLS) — falls back to anon client if IPC not available
    if (typeof electronAPI.updateMember === 'function') {
      const result = await electronAPI.updateMember({ userId: id, fields: { [field]: parsed } })
      if (!result.ok) {
        console.error('[updateEmployee] Save failed:', result.error)
        alert(`Failed to save: ${result.error}`)
      }
    } else {
      const { error } = await supabase.from('profiles').update({ [field]: parsed }).eq('id', id)
      if (error) {
        console.error('[updateEmployee] Supabase error:', error)
        alert(`Failed to save: ${error.message}`)
      }
    }
  }

  async function sendInvite() {
    if (!invEmail.trim()) { setInvErr('Email is required'); return }
    setInviting(true); setInvErr(''); setInvCredentials(null); setInvCopied(false)

    const rate = Number(invRate) || 0
    const result = await electronAPI.inviteMember({
      email: invEmail.trim(),
      department: invDept || null,
      position: invPosition.trim() || null,
      hourly_rate: rate,
    })

    if (!result.ok) { setInvErr(result.error); setInviting(false); return }

    await supabase.from('invitations').upsert(
      { email: invEmail.trim(), department: invDept || null, position: invPosition.trim() || null, hourly_rate: rate },
      { onConflict: 'email' }
    )

    setInvCredentials({ email: invEmail.trim(), tempPassword: result.tempPassword })
    setInvEmail(''); setInvDept(''); setInvPosition(''); setInvRate('')
    setInviting(false)
    // Refresh member list so the new user appears immediately
    const { data: fresh } = await supabase.from('profiles').select('*').order('full_name')
    if (fresh) setEmployees(fresh)
  }

  async function copyInvCredentials() {
    const { email, tempPassword } = invCredentials
    const text = `PharmaStaff Hub Login\nEmail: ${email}\nTemp Password: ${tempPassword}\n\nOpen the app and sign in. You will be asked to set your name and a new password.`
    await electronAPI.copyToClipboard(text)
    setInvCopied(true)
    setTimeout(() => setInvCopied(false), 2500)
  }

  const filteredEmps = employees.filter(e => {
    const q = empSearch.toLowerCase()
    const matchSearch = !empSearch || e.full_name?.toLowerCase().includes(q) || e.email?.toLowerCase().includes(q)
    const matchDept = managedDept ? e.department === managedDept : true
    return matchSearch && matchDept
  })

  const deptStats = departments.map(dept => ({
    dept,
    count: employees.filter(e => e.department === dept).length,
  }))

  // Sub-admin: jump straight to their department view
  if (managedDept) {
    return (
      <DeptMembers
        dept={managedDept}
        employees={employees}
        departments={departments}
        onBack={null}
        onEmployeeUpdate={updateLocalEmployee}
        onEmployeeDelete={removeLocalEmployee}
        currentUserId={currentUserId}
        schedule={deptSchedules[managedDept]}
        onScheduleChange={s => onSchedulesChange?.(prev => ({ ...prev, [managedDept]: s }))}
      />
    )
  }

  if (selectedDept) {
    return (
      <DeptMembers
        dept={selectedDept}
        employees={employees}
        departments={departments}
        onBack={() => setSelectedDept(null)}
        onEmployeeUpdate={updateLocalEmployee}
        onEmployeeDelete={removeLocalEmployee}
        currentUserId={currentUserId}
        schedule={deptSchedules[selectedDept]}
        onScheduleChange={s => onSchedulesChange?.(prev => ({ ...prev, [selectedDept]: s }))}
      />
    )
  }

  return (
    <div className="admin-panel">
      <div className="admin-header">
        <h2 className="admin-title">Admin Panel</h2>
        <div className="admin-section-tabs">
          <button className={`section-tab ${activeSection === 'departments' ? 'active' : ''}`} onClick={() => setActiveSection('departments')}>
            Departments
          </button>
          <button className={`section-tab ${activeSection === 'members' ? 'active' : ''}`} onClick={() => setActiveSection('members')}>
            Members
          </button>
          <button className={`section-tab ${activeSection === 'apprules' ? 'active' : ''}`} onClick={() => setActiveSection('apprules')}>
            App Rules
          </button>
        </div>
      </div>

      {/* ── DEPARTMENTS ── */}
      {activeSection === 'departments' && (
        <div className="dept-manage">
          <p className="admin-subtitle">Create departments. Click a department to view and manage its members.</p>

          <div className="dept-add-row">
            <input
              type="text"
              value={newDept}
              onChange={e => { setNewDept(e.target.value); setDeptError('') }}
              onKeyDown={e => e.key === 'Enter' && addDepartment()}
              placeholder="Department name (e.g. Dispatch)"
              className="form-input dept-add-input"
            />
            <button className="dept-add-btn" onClick={addDepartment} disabled={!newDept.trim()}>
              + Add Department
            </button>
          </div>

          {deptError && <div className="auth-error" style={{ marginTop: 0 }}>{deptError}</div>}

          {departments.length === 0 ? (
            <div className="empty-state" style={{ marginTop: 32, height: 'auto', padding: 32 }}>
              <p>No departments yet.</p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>Add your first department above to get started.</p>
            </div>
          ) : (
            <div className="dept-list">
              {deptStats.map(({ dept, count }) => (
                <div key={dept} className="dept-list-row dept-list-row-clickable" onClick={() => setSelectedDept(dept)}>
                  <div className="dept-list-name" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: deptColor(dept), flexShrink: 0, display: 'inline-block' }} />
                    {dept}
                  </div>
                  <span className="dept-card-count">{count} member{count !== 1 ? 's' : ''}</span>
                  <ChevronRight size={14} style={{ color: 'var(--text-muted)', marginLeft: 'auto', marginRight: 4, flexShrink: 0 }} />
                  <button
                    className="dept-delete-btn"
                    onClick={e => { e.stopPropagation(); deleteDepartment(dept) }}
                    title="Delete department"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── MEMBERS ── */}
      {activeSection === 'members' && (
        <div className="emp-manage">
          {/* Invite form */}
          <div className="invite-section">
            <h3 className="invite-title">
              <UserPlus size={16} />
              Invite a Member
            </h3>
            <p className="admin-subtitle" style={{ marginBottom: 12 }}>
              Enter the worker's email — a login and temp password are created instantly. No email is sent.
            </p>
            <div className="invite-fields">
              <input
                type="email"
                value={invEmail}
                onChange={e => { setInvEmail(e.target.value); setInvErr('') }}
                placeholder="worker@email.com"
                className="form-input"
                style={{ flex: 2, minWidth: 180 }}
              />
              <select
                value={invDept}
                onChange={e => setInvDept(e.target.value)}
                className="emp-select"
                style={{ flex: 1.5, minWidth: 140 }}
              >
                <option value="">— No department —</option>
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <input
                type="text"
                value={invPosition}
                onChange={e => setInvPosition(e.target.value)}
                placeholder="Position"
                className="form-input"
                style={{ flex: 1.5, minWidth: 130 }}
              />
              <div className="rate-input-wrap" style={{ minWidth: 100 }}>
                <span className="rate-symbol">$</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={invRate}
                  onChange={e => setInvRate(e.target.value)}
                  placeholder="0"
                  className="rate-input"
                  style={{ width: 52 }}
                />
                <span className="rate-suffix">/hr</span>
              </div>
              <button
                className="dept-add-btn"
                onClick={sendInvite}
                disabled={inviting || !isValidEmail(invEmail.trim())}
              >
                {inviting ? 'Creating…' : 'Add Member'}
              </button>
            </div>
            {invErr && <p className="bf-error" style={{ marginTop: 8 }}>{invErr}</p>}

            {invCredentials && (
              <div className="cred-card">
                <div className="cred-card-header">
                  <UserPlus size={15} style={{ color: 'var(--positive)' }} />
                  <span>Account created! Share these credentials with the employee.</span>
                </div>
                <div className="cred-fields">
                  <div className="cred-row">
                    <span className="cred-label">Email</span>
                    <span className="cred-value">{invCredentials.email}</span>
                  </div>
                  <div className="cred-row">
                    <span className="cred-label">Temp Password</span>
                    <span className="cred-value cred-password">{invCredentials.tempPassword}</span>
                  </div>
                </div>
                <button className="cred-copy-btn" onClick={copyInvCredentials}>
                  {invCopied ? '✓ Copied!' : 'Copy Credentials'}
                </button>
                <p className="cred-note">Employee opens the app, signs in with these, then sets their own name and new password.</p>
              </div>
            )}

            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
              No email sent — share credentials via WhatsApp, SMS, or in person.
            </p>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', marginTop: 24, paddingTop: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <p className="admin-subtitle" style={{ margin: 0 }}>All registered members. Assign department, position, rate, and role.</p>
              <input
                type="text"
                placeholder="Search members…"
                value={empSearch}
                onChange={e => setEmpSearch(e.target.value)}
                className="search-input"
                style={{ maxWidth: 220 }}
              />
            </div>

            {loadingEmps ? (
              <p style={{ color: 'var(--text-muted)', marginTop: 16 }}>Loading…</p>
            ) : filteredEmps.length === 0 ? (
              <div className="empty-state" style={{ marginTop: 24, height: 'auto', padding: 32 }}>
                <p>No members registered yet.</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>Members appear here once they accept an invite and complete setup.</p>
              </div>
            ) : (
              <div className="emp-manage-table">
                <div className="emp-manage-header">
                  <span style={{ flex: 1 }}>Member</span>
                  <span style={{ width: 160 }}>Department</span>
                  <span style={{ width: 160 }}>Position</span>
                  <span style={{ width: 110 }}>Hourly Rate</span>
                  <span style={{ width: 90 }}>Role</span>
                  <span style={{ width: 80 }} />
                </div>
                {filteredEmps.map(emp => (
                  <div key={emp.id} className="emp-manage-row">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="employee-name">
                        {emp.full_name || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 12 }}>Setup pending…</span>}
                      </div>
                      <div className="employee-id">{emp.email}</div>
                    </div>

                    <select
                      value={emp.department || ''}
                      onChange={e => updateEmployee(emp.id, 'department', e.target.value)}
                      className="emp-select"
                      style={{ width: 160 }}
                    >
                      <option value="">— Unassigned —</option>
                      {departments.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>

                    <input
                      type="text"
                      value={emp.position || ''}
                      onChange={e => updateEmployee(emp.id, 'position', e.target.value)}
                      placeholder="Position title"
                      className="emp-text-input"
                      style={{ width: 160 }}
                    />

                    <div className="rate-input-wrap" style={{ width: 110 }}>
                      <span className="rate-symbol">$</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={emp.hourly_rate ?? 0}
                        onChange={e => updateEmployee(emp.id, 'hourly_rate', e.target.value)}
                        className="rate-input"
                        style={{ width: 52 }}
                      />
                      <span className="rate-suffix">/hr</span>
                    </div>

                    <select
                      value={emp.role}
                      onChange={e => {
                        const newRole = e.target.value
                        if (emp.id === currentUserId && newRole !== 'admin') {
                          if (!window.confirm('You are about to remove your own admin access. You will be locked out of the admin panel. Continue?')) return
                        }
                        if (newRole === 'admin' && emp.role !== 'admin') {
                          if (!window.confirm(`Grant full CEO access to ${emp.full_name || emp.email}? They will have access to all departments and data.`)) return
                        }
                        if ((newRole === 'subadmin' || newRole === 'diller') && !emp.department) {
                          window.alert('Assign a department to this user first before setting this role.')
                          return
                        }
                        if (newRole === 'subadmin') {
                          if (!window.confirm(`Make ${emp.full_name || emp.email} a Sub-Admin for the "${emp.department}" department? They will only see their department.`)) return
                        }
                        if (newRole === 'diller') {
                          if (!window.confirm(`Make ${emp.full_name || emp.email} a Diller for the "${emp.department}" department? They will see team status and breaks but no salary data.`)) return
                        }
                        updateEmployee(emp.id, 'role', newRole)
                      }}
                      className={`emp-role-select emp-select ${emp.role === 'admin' ? 'role-admin' : emp.role === 'subadmin' ? 'role-subadmin' : emp.role === 'diller' ? 'role-diller' : 'role-employee'}`}
                      style={{ width: 120 }}
                    >
                      <option value="employee">Employee</option>
                      <option value="subadmin">Sub-Admin</option>
                      <option value="diller">Diller</option>
                      <option value="admin">CEO / Admin</option>
                    </select>

                    <div style={{ width: 80, display: 'flex', justifyContent: 'flex-end' }}>
                      {emp.id !== currentUserId && (
                        confirmDeleteId === emp.id ? (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="dept-remove-btn dept-delete-confirm-btn" onClick={() => handleDeleteEmployee(emp)} style={{ padding: '4px 8px', fontSize: 11 }}>Delete?</button>
                            <button className="dept-remove-btn" onClick={() => setConfirmDeleteId(null)} style={{ padding: '4px 8px', fontSize: 11 }}>No</button>
                          </div>
                        ) : (
                          <button
                            className="dept-remove-btn dept-delete-icon-btn"
                            onClick={() => { setConfirmDeleteId(emp.id); setDeleteErr('') }}
                            title="Permanently delete this user"
                          >
                            <Trash2 size={13} />
                          </button>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {deleteErr && <p className="bf-error" style={{ marginTop: 12 }}>{deleteErr}</p>}
          </div>
        </div>
      )}

      {/* ── APP RULES ── */}
      {activeSection === 'apprules' && <ProhibitedAppsManager />}
    </div>
  )
}

// ── Prohibited Apps Manager ───────────────────────────────────────────────────
function ProhibitedAppsManager() {
  const [patterns,    setPatterns]    = useState(loadProhibited)
  const [newPattern,  setNewPattern]  = useState('')
  const [newLabel,    setNewLabel]    = useState('')
  const [saved,       setSaved]       = useState(false)

  function persist(updated) {
    setPatterns(updated)
    saveProhibited(updated)
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }

  function add() {
    const p = newPattern.trim().toLowerCase()
    if (!p) return
    if (patterns.some(x => x.pattern === p)) return
    const label = newLabel.trim() || (p.charAt(0).toUpperCase() + p.slice(1))
    persist([...patterns, { pattern: p, label }])
    setNewPattern(''); setNewLabel('')
  }

  function remove(pattern) {
    persist(patterns.filter(x => x.pattern !== pattern))
  }

  function resetDefaults() {
    persist(DEFAULT_PROHIBITED)
  }

  return (
    <div className="dept-manage">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
        <div>
          <p className="admin-subtitle" style={{ marginBottom: 4 }}>
            Keywords to flag in screenshots. If a worker's <strong>app name</strong> or <strong>window title</strong> contains any keyword, it shows as a violation in Reports → Violations.
          </p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Chrome shows the tab title in the window title — so "youtube" will catch any YouTube tab.
          </p>
        </div>
        <button className="dept-remove-btn" onClick={resetDefaults} style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}>
          Reset to Defaults
        </button>
      </div>

      <div className="dept-add-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input
          type="text" value={newPattern}
          onChange={e => setNewPattern(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Keyword (e.g. youtube)"
          className="form-input" style={{ flex: 2, minWidth: 140 }}
        />
        <input
          type="text" value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Display name (optional)"
          className="form-input" style={{ flex: 2, minWidth: 140 }}
        />
        <button className="dept-add-btn" onClick={add} disabled={!newPattern.trim()}>
          + Add Rule
        </button>
        {saved && <span style={{ fontSize: 12, color: 'var(--positive)', fontWeight: 600 }}>✓ Saved</span>}
      </div>

      {patterns.length === 0 ? (
        <div className="empty-state" style={{ height: 'auto', padding: 28, marginTop: 16 }}>
          <p>No rules configured.</p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Add a keyword above or click Reset to Defaults.</p>
        </div>
      ) : (
        <div className="app-rules-list">
          <div className="app-rules-head">
            <span>Display Name</span>
            <span>Keyword Pattern</span>
            <span />
          </div>
          {patterns.map(({ pattern, label }) => (
            <div key={pattern} className="app-rules-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShieldAlert size={13} style={{ color: '#ef4444', flexShrink: 0 }} />
                <span style={{ fontWeight: 600, fontSize: 13 }}>{label}</span>
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>"{pattern}"</span>
              <button className="dept-remove-btn" onClick={() => remove(pattern)} title="Remove rule">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
