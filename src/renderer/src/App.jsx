import { useMemo } from 'react'
import EmployeeTable from './components/EmployeeTable'
import { generateMockEmployees } from './data/mockEmployees'

export default function App() {
  const employees = useMemo(() => generateMockEmployees(300), [])

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <div className="logo-mark">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
          </div>
          <div>
            <h1 className="app-title">Salary Command Center</h1>
            <p className="app-subtitle">Payroll management &amp; calculation engine</p>
          </div>
        </div>
        <div className="header-right">
          <div className="status-dot" />
          <span className="status-text">Live Session</span>
        </div>
      </header>

      <main className="app-main">
        <EmployeeTable initialEmployees={employees} />
      </main>
    </div>
  )
}
