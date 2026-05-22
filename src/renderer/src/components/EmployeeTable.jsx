import { useState, useCallback } from 'react'
import { FixedSizeList as List } from 'react-window'
import AutoSizer from 'react-virtualized-auto-sizer'

const DEPT_COLORS = {
  Engineering:       '#6366f1',
  Product:           '#8b5cf6',
  Design:            '#ec4899',
  Marketing:         '#f59e0b',
  Sales:             '#10b981',
  Finance:           '#3b82f6',
  HR:                '#14b8a6',
  Operations:        '#f97316',
  Legal:             '#ef4444',
  'Customer Success':'#06b6d4',
}

function calculateSalary(hoursWorked, hourlyRate, bonuses, fines) {
  return Math.max(0, hoursWorked * hourlyRate + Number(bonuses) - Number(fines))
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(value)
}

function AvatarBadge({ initials, department }) {
  const color = DEPT_COLORS[department] || '#6366f1'
  return (
    <div
      className="avatar-badge"
      style={{ backgroundColor: color + '22', border: `1.5px solid ${color}55`, color }}
    >
      {initials}
    </div>
  )
}

function TableRow({ index, style, data }) {
  const { employees, onBonusChange, onFineChange } = data
  const emp = employees[index]
  const isEven = index % 2 === 0
  const salary = calculateSalary(emp.hoursWorked, emp.hourlyRate, emp.bonuses, emp.fines)
  const deptColor = DEPT_COLORS[emp.department] || '#6366f1'

  return (
    <div style={style} className={`table-row ${isEven ? 'row-even' : 'row-odd'}`}>
      <div className="col col-index">{index + 1}</div>

      <div className="col col-employee">
        <AvatarBadge initials={emp.avatar} department={emp.department} />
        <div className="employee-info">
          <span className="employee-name">{emp.name}</span>
          <span className="employee-id">{emp.id}</span>
        </div>
      </div>

      <div className="col col-dept">
        <span
          className="dept-tag"
          style={{
            backgroundColor: deptColor + '18',
            color: deptColor,
            border: `1px solid ${deptColor}33`,
          }}
        >
          {emp.department}
        </span>
      </div>

      <div className="col col-position">
        <span className="position-text">{emp.position}</span>
      </div>

      <div className="col col-number">
        <span className="value-pill">{emp.hoursWorked}h</span>
      </div>

      <div className="col col-number">
        <span className="value-pill">{formatCurrency(emp.hourlyRate)}</span>
      </div>

      <div className="col col-input">
        <input
          type="number"
          min="0"
          step="10"
          value={emp.bonuses}
          onChange={(e) => onBonusChange(emp.id, e.target.value)}
          className="salary-input bonus-input"
          placeholder="0"
        />
      </div>

      <div className="col col-input">
        <input
          type="number"
          min="0"
          step="10"
          value={emp.fines}
          onChange={(e) => onFineChange(emp.id, e.target.value)}
          className="salary-input fine-input"
          placeholder="0"
        />
      </div>

      <div className="col col-salary">
        <span className="salary-value">{formatCurrency(salary)}</span>
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
      <div className="col col-position">Position</div>
      <div className="col col-number">Hours</div>
      <div className="col col-number">Rate</div>
      <div className="col col-input">Bonus ($)</div>
      <div className="col col-input">Fine ($)</div>
      <div className="col col-salary">Net Salary</div>
    </div>
  )
}

function SummaryBar({ employees }) {
  const totals = employees.reduce(
    (acc, emp) => {
      acc.salary += calculateSalary(emp.hoursWorked, emp.hourlyRate, emp.bonuses, emp.fines)
      acc.bonuses += Number(emp.bonuses)
      acc.fines += Number(emp.fines)
      return acc
    },
    { salary: 0, bonuses: 0, fines: 0 }
  )

  return (
    <div className="summary-bar">
      <div className="summary-item">
        <span className="summary-label">Total Employees</span>
        <span className="summary-value neutral">{employees.length}</span>
      </div>
      <div className="summary-divider" />
      <div className="summary-item">
        <span className="summary-label">Total Bonuses</span>
        <span className="summary-value positive">{formatCurrency(totals.bonuses)}</span>
      </div>
      <div className="summary-divider" />
      <div className="summary-item">
        <span className="summary-label">Total Fines</span>
        <span className="summary-value negative">{formatCurrency(totals.fines)}</span>
      </div>
      <div className="summary-divider" />
      <div className="summary-item">
        <span className="summary-label">Total Payroll</span>
        <span className="summary-value highlight">{formatCurrency(totals.salary)}</span>
      </div>
    </div>
  )
}

export default function EmployeeTable({ initialEmployees }) {
  const [employees, setEmployees] = useState(initialEmployees)
  const [search, setSearch] = useState('')
  const [filterDept, setFilterDept] = useState('All')

  const departments = ['All', ...new Set(initialEmployees.map((e) => e.department))].sort()

  const filtered = employees.filter((emp) => {
    const matchSearch =
      search === '' ||
      emp.name.toLowerCase().includes(search.toLowerCase()) ||
      emp.id.toLowerCase().includes(search.toLowerCase())
    const matchDept = filterDept === 'All' || emp.department === filterDept
    return matchSearch && matchDept
  })

  const onBonusChange = useCallback((id, value) => {
    setEmployees((prev) =>
      prev.map((emp) => (emp.id === id ? { ...emp, bonuses: value } : emp))
    )
  }, [])

  const onFineChange = useCallback((id, value) => {
    setEmployees((prev) =>
      prev.map((emp) => (emp.id === id ? { ...emp, fines: value } : emp))
    )
  }, [])

  const itemData = { employees: filtered, onBonusChange, onFineChange }

  return (
    <div className="table-container">
      <div className="toolbar">
        <div className="search-wrap">
          <svg className="search-icon" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
              clipRule="evenodd"
            />
          </svg>
          <input
            type="text"
            placeholder="Search by name or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search-input"
          />
        </div>
        <select
          value={filterDept}
          onChange={(e) => setFilterDept(e.target.value)}
          className="dept-filter"
        >
          {departments.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <span className="row-count">{filtered.length} employees</span>
      </div>

      <TableHeader />

      <div className="list-wrapper">
        <AutoSizer>
          {({ height, width }) => (
            <List
              height={height}
              width={width}
              itemCount={filtered.length}
              itemSize={56}
              itemData={itemData}
              overscanCount={10}
            >
              {TableRow}
            </List>
          )}
        </AutoSizer>
      </div>

      <SummaryBar employees={employees} />
    </div>
  )
}
