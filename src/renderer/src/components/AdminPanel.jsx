import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function AdminPanel({ departments, onDepartmentsChange }) {
  const [activeSection, setActiveSection] = useState('departments')
  const [employees, setEmployees] = useState([])
  const [loadingEmps, setLoadingEmps] = useState(true)
  const [newDept, setNewDept] = useState('')
  const [deptError, setDeptError] = useState('')
  const [empSearch, setEmpSearch] = useState('')

  useEffect(() => {
    supabase
      .from('profiles')
      .select('*')
      .order('full_name')
      .then(({ data }) => { if (data) setEmployees(data); setLoadingEmps(false) })
  }, [])

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
    if (hasEmployees) { setDeptError(`Cannot delete "${name}" — it has employees assigned to it.`); return }
    setDeptError('')
    await supabase.from('departments').delete().eq('name', name)
    onDepartmentsChange(departments.filter(d => d !== name))
  }

  async function updateEmployee(id, field, value) {
    const parsed = ['hourly_rate', 'hours_worked', 'bonuses', 'fines'].includes(field)
      ? Number(value) || 0
      : value
    setEmployees(prev => prev.map(e => e.id === id ? { ...e, [field]: parsed } : e))
    await supabase.from('profiles').update({ [field]: parsed }).eq('id', id)
  }

  const filteredEmps = employees.filter(e => {
    const q = empSearch.toLowerCase()
    return !empSearch || e.full_name?.toLowerCase().includes(q) || e.email?.toLowerCase().includes(q)
  })

  const deptStats = departments.map(dept => ({
    dept,
    count: employees.filter(e => e.department === dept).length,
  }))

  return (
    <div className="admin-panel">
      <div className="admin-header">
        <h2 className="admin-title">Admin Panel</h2>
        <div className="admin-section-tabs">
          <button className={`section-tab ${activeSection === 'departments' ? 'active' : ''}`} onClick={() => setActiveSection('departments')}>
            Departments
          </button>
          <button className={`section-tab ${activeSection === 'employees' ? 'active' : ''}`} onClick={() => setActiveSection('employees')}>
            Employees
          </button>
        </div>
      </div>

      {activeSection === 'departments' && (
        <div className="dept-manage">
          <p className="admin-subtitle">Create and manage departments. Each employee can be assigned to a department in the Employees section.</p>

          <div className="dept-add-row">
            <input
              type="text"
              value={newDept}
              onChange={e => { setNewDept(e.target.value); setDeptError('') }}
              onKeyDown={e => e.key === 'Enter' && addDepartment()}
              placeholder="Department name (e.g. Engineering)"
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
                <div key={dept} className="dept-list-row">
                  <div className="dept-list-name">{dept}</div>
                  <span className="dept-card-count">{count} employee{count !== 1 ? 's' : ''}</span>
                  <button
                    className="dept-delete-btn"
                    onClick={() => deleteDepartment(dept)}
                    title="Delete department"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeSection === 'employees' && (
        <div className="emp-manage">
          <p className="admin-subtitle">Assign departments, positions, hourly rates, and roles to each registered employee.</p>

          <div className="emp-search-wrap">
            <input
              type="text"
              placeholder="Search employees…"
              value={empSearch}
              onChange={e => setEmpSearch(e.target.value)}
              className="search-input"
              style={{ maxWidth: 300 }}
            />
          </div>

          {loadingEmps ? (
            <p style={{ color: 'var(--text-muted)', marginTop: 16 }}>Loading…</p>
          ) : filteredEmps.length === 0 ? (
            <div className="empty-state" style={{ marginTop: 24, height: 'auto', padding: 32 }}>
              <p>No employees registered yet.</p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>Employees appear here once they sign up in the app.</p>
            </div>
          ) : (
            <div className="emp-manage-table">
              <div className="emp-manage-header">
                <span style={{ flex: 1 }}>Employee</span>
                <span style={{ width: 160 }}>Department</span>
                <span style={{ width: 160 }}>Position</span>
                <span style={{ width: 110 }}>Hourly Rate</span>
                <span style={{ width: 90 }}>Role</span>
              </div>
              {filteredEmps.map(emp => (
                <div key={emp.id} className="emp-manage-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="employee-name">{emp.full_name || '—'}</div>
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
                    onChange={e => updateEmployee(emp.id, 'role', e.target.value)}
                    className={`emp-role-select emp-select ${emp.role === 'admin' ? 'role-admin' : 'role-employee'}`}
                    style={{ width: 90 }}
                  >
                    <option value="employee">Employee</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
