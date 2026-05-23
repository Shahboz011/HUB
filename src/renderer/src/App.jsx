import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import AuthScreen from './components/AuthScreen'
import EmployeeTable from './components/EmployeeTable'
import AdminPanel from './components/AdminPanel'
import EmployeeView from './components/EmployeeView'

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('employees')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) init(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) init(session.user.id)
      else { setProfile(null); setLoading(false) }
    })

    if (window.electronAPI?.onDeepLink) {
      window.electronAPI.onDeepLink((url) => {
        const hash = url.split('#')[1] || url.split('?')[1] || ''
        const params = new URLSearchParams(hash)
        const accessToken = params.get('access_token')
        const refreshToken = params.get('refresh_token')
        if (accessToken && refreshToken) {
          supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        }
      })
    }

    return () => subscription.unsubscribe()
  }, [])

  async function init(userId) {
    const [{ data: profileData }, { data: deptsData }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase.from('departments').select('name').order('name'),
    ])
    if (profileData) setProfile(profileData)
    if (deptsData) setDepartments(deptsData.map(d => d.name))
    setLoading(false)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  if (loading) {
    return (
      <div className="app-loading">
        <div className="loading-spinner" />
        <span>Loading…</span>
      </div>
    )
  }

  if (!session) return <AuthScreen />

  const isAdmin = profile?.role === 'admin'
  const displayName = profile?.full_name || session.user.email

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

        {isAdmin && (
          <nav className="header-nav">
            <button
              className={`nav-tab ${activeTab === 'employees' ? 'active' : ''}`}
              onClick={() => setActiveTab('employees')}
            >
              <svg viewBox="0 0 20 20" fill="currentColor">
                <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
              </svg>
              Employees
            </button>
            <button
              className={`nav-tab ${activeTab === 'admin' ? 'active' : ''}`}
              onClick={() => setActiveTab('admin')}
            >
              <svg viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
              </svg>
              Admin Panel
            </button>
          </nav>
        )}

        <div className="header-right">
          <div className="user-chip">
            <div className="user-avatar">{displayName[0]?.toUpperCase()}</div>
            <div className="user-info">
              <span className="user-name">{displayName}</span>
              <span className={`role-badge ${isAdmin ? 'role-admin' : 'role-employee'}`}>
                {isAdmin ? 'Admin' : 'Employee'}
              </span>
            </div>
          </div>
          <button className="sign-out-btn" onClick={handleSignOut} title="Sign out">
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </header>

      <main className="app-main">
        {isAdmin ? (
          activeTab === 'employees'
            ? <EmployeeTable departments={departments} />
            : <AdminPanel departments={departments} onDepartmentsChange={setDepartments} />
        ) : (
          <EmployeeView profile={profile} />
        )}
      </main>
    </div>
  )
}
