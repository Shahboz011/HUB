import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import { Monitor, Users, Settings2, BarChart3, LogOut, Download, X, RotateCcw, LayoutDashboard, UserCheck } from 'lucide-react'
import AuthScreen from './components/AuthScreen'
import EmployeeTable from './components/EmployeeTable'
import AdminPanel from './components/AdminPanel'
import EmployeeView from './components/EmployeeView'
import SalaryReport from './components/SalaryReport'
import CompleteProfile from './components/CompleteProfile'
import AdminDashboard from './components/AdminDashboard'
import MyTeam from './components/MyTeam'

const ADMIN_NAV = [
  { id: 'dashboard', label: 'Dashboard',    icon: <LayoutDashboard size={15} /> },
  { id: 'myteam',    label: 'My Team',      icon: <UserCheck size={15} /> },
  { id: 'employees', label: 'Employees',    icon: <Users size={15} /> },
  { id: 'admin',     label: 'Admin Panel',  icon: <Settings2 size={15} /> },
  { id: 'salary',    label: 'Salary Report',icon: <BarChart3 size={15} /> },
]

function UpdateBanner({ state, progress, version, onRestart, onDismiss }) {
  if (state === 'downloading') {
    return (
      <div className="update-banner">
        <div className="update-banner-icon">
          <Download size={18} />
        </div>
        <div className="update-banner-body">
          <span className="update-banner-title">Downloading update{version ? ` v${version}` : ''}…</span>
          <div className="update-progress-track">
            <div className="update-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="update-banner-desc">{progress}% — will notify you when ready</span>
        </div>
        <button className="update-banner-close" onClick={onDismiss} title="Dismiss">
          <X size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="update-banner">
      <div className="update-banner-icon">
        <Download size={18} />
      </div>
      <div className="update-banner-body">
        <span className="update-banner-title">Update ready to install</span>
        <span className="update-banner-desc">A new version has been downloaded. Restart to apply.</span>
      </div>
      <div className="update-banner-actions">
        <button className="update-banner-later" onClick={onDismiss}>Later</button>
        <button className="update-banner-restart" onClick={onRestart}>
          <RotateCcw size={13} />
          Restart Now
        </button>
      </div>
      <button className="update-banner-close" onClick={onDismiss} title="Dismiss">
        <X size={14} />
      </button>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('dashboard')
  const [updateState, setUpdateState] = useState(null) // null | 'downloading' | 'ready'
  const [updateProgress, setUpdateProgress] = useState(0)
  const [updateVersion, setUpdateVersion] = useState('')
  const [appVersion, setAppVersion] = useState('')

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

    window.electronAPI?.getVersion?.().then(v => { if (v) setAppVersion(v) })

    if (window.electronAPI?.onUpdateAvailable) {
      window.electronAPI.onUpdateAvailable((version) => {
        setUpdateVersion(version || '')
        setUpdateProgress(0)
        setUpdateState('downloading')
      })
    }
    if (window.electronAPI?.onUpdateProgress) {
      window.electronAPI.onUpdateProgress((percent) => setUpdateProgress(percent))
    }
    if (window.electronAPI?.onUpdateReady) {
      window.electronAPI.onUpdateReady(() => setUpdateState('ready'))
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

  const isSuperAdmin = profile?.role === 'admin'
  const isSubAdmin   = profile?.role === 'subadmin'
  const isAnyAdmin   = isSuperAdmin || isSubAdmin
  const managedDept  = isSubAdmin ? (profile?.department || null) : null
  const displayName  = profile?.full_name || session.user.email

  // Employee users get the full-screen sidebar layout — no top header
  if (!isAnyAdmin) {
    return (
      <div className="app" style={{ overflow: 'hidden' }}>
        <EmployeeView profile={profile} onSignOut={handleSignOut} />
        {updateState && <UpdateBanner state={updateState} progress={updateProgress} version={updateVersion} onRestart={() => window.electronAPI?.installUpdate()} onDismiss={() => setUpdateState(null)} />}
      </div>
    )
  }

  const roleBadgeLabel = isSuperAdmin ? 'CEO' : 'Sub-Admin'
  const roleBadgeClass = isSuperAdmin ? 'role-admin' : 'role-subadmin'

  return (
    <div className="admin-shell">
      {/* ── Admin sidebar ── */}
      <aside className="admin-sidebar">
        <div className="admin-sb-brand">
          <div className="logo-mark" style={{ width: 32, height: 32 }}>
            <Monitor size={16} />
          </div>
          <div>
            <div className="admin-sb-title">SCC</div>
            <div className="admin-sb-sub">{managedDept ? managedDept : 'Command Center'}</div>
          </div>
        </div>

        <nav className="admin-sb-nav">
          {ADMIN_NAV.map(item => (
            <button
              key={item.id}
              className={`admin-sb-item ${activeTab === item.id ? 'admin-sb-active' : ''}`}
              onClick={() => setActiveTab(item.id)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        {appVersion && <div className="admin-sb-version">v{appVersion}</div>}

        <div className="admin-sb-footer">
          <div className="admin-sb-user">
            <div className="admin-sb-avatar">{displayName[0]?.toUpperCase()}</div>
            <div className="admin-sb-userinfo">
              <span className="admin-sb-username">{displayName}</span>
              <span className={`role-badge ${roleBadgeClass}`}>{roleBadgeLabel}</span>
            </div>
          </div>
          <button className="admin-sb-signout" onClick={handleSignOut} title="Sign out">
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="admin-content">
        {activeTab === 'dashboard'  && <AdminDashboard adminName={displayName} managedDept={managedDept} />}
        {activeTab === 'myteam'     && <MyTeam managedDept={managedDept} />}
        {activeTab === 'employees'  && <main className="app-main"><EmployeeTable departments={departments} managedDept={managedDept} /></main>}
        {activeTab === 'salary'     && <main className="app-main"><SalaryReport managedDept={managedDept} /></main>}
        {activeTab === 'admin'      && <main className="app-main"><AdminPanel departments={departments} onDepartmentsChange={setDepartments} currentUserId={profile?.id} isSuperAdmin={isSuperAdmin} managedDept={managedDept} /></main>}
      </div>

      {updateState && <UpdateBanner state={updateState} progress={updateProgress} version={updateVersion} onRestart={() => window.electronAPI?.installUpdate()} onDismiss={() => setUpdateState(null)} />}
    </div>
  )
}
