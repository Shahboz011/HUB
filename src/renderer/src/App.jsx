import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import { Monitor, Users, Settings2, BarChart3, LogOut } from 'lucide-react'
import AuthScreen from './components/AuthScreen'
import EmployeeTable from './components/EmployeeTable'
import AdminPanel from './components/AdminPanel'
import EmployeeView from './components/EmployeeView'
import SalaryReport from './components/SalaryReport'
import CompleteProfile from './components/CompleteProfile'

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

  // New invited user: show profile setup before anything else
  if (profile && !profile.full_name) return <CompleteProfile session={session} />

  const isAdmin = profile?.role === 'admin'
  const displayName = profile?.full_name || session.user.email

  // Employee users get the full-screen sidebar layout — no top header
  if (!isAdmin) {
    return (
      <div className="app" style={{ overflow: 'hidden' }}>
        <EmployeeView profile={profile} onSignOut={handleSignOut} />
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <div className="logo-mark">
            <Monitor size={18} />
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
              <Users size={15} />
              Employees
            </button>
            <button
              className={`nav-tab ${activeTab === 'admin' ? 'active' : ''}`}
              onClick={() => setActiveTab('admin')}
            >
              <Settings2 size={15} />
              Admin Panel
            </button>
            <button
              className={`nav-tab ${activeTab === 'salary' ? 'active' : ''}`}
              onClick={() => setActiveTab('salary')}
            >
              <BarChart3 size={15} />
              Salary Report
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
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className="app-main">
        {activeTab === 'employees' ? <EmployeeTable departments={departments} />
          : activeTab === 'salary' ? <SalaryReport />
          : <AdminPanel departments={departments} onDepartmentsChange={setDepartments} />
        }
      </main>
    </div>
  )
}
