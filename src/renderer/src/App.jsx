import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import * as avatarCache from './lib/avatarCache'
import { Monitor, Users, Settings2, BarChart3, LogOut, Download, X, RotateCcw, LayoutDashboard, UserCheck, Timer, ChevronLeft, UserCircle2, ClipboardList } from 'lucide-react'
import AuthScreen from './components/AuthScreen'
import EmployeeTable from './components/EmployeeTable'
import AdminPanel from './components/AdminPanel'
import EmployeeView from './components/EmployeeView'
import SalaryReport from './components/SalaryReport'
import CompleteProfile from './components/CompleteProfile'
import AdminDashboard from './components/AdminDashboard'
import MyTeam from './components/MyTeam'
import ProfilePanel from './components/ProfilePanel'
import ReportsView from './components/ReportsView'

const ADMIN_NAV = [
  { id: 'dashboard', label: 'Dashboard',    icon: <LayoutDashboard size={15} /> },
  { id: 'myteam',    label: 'My Team',      icon: <UserCheck size={15} /> },
  { id: 'employees', label: 'Employees',    icon: <Users size={15} /> },
  { id: 'reports',   label: 'Reports',      icon: <ClipboardList size={15} /> },
  { id: 'admin',     label: 'Admin Panel',  icon: <Settings2 size={15} /> },
  { id: 'salary',    label: 'Salary Report',icon: <BarChart3 size={15} /> },
  { id: 'profile',   label: 'My Profile',   icon: <UserCircle2 size={15} /> },
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
  const [deptSchedules, setDeptSchedules] = useState({}) // { deptName: { clock_in_open, work_start } }
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('dashboard')
  const [workerMode, setWorkerMode] = useState(false) // sub-admin can switch to their own worker screen
  const [updateState, setUpdateState] = useState(null) // null | 'downloading' | 'ready'
  const [updateProgress, setUpdateProgress] = useState(0)
  const [updateVersion, setUpdateVersion] = useState('')
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    // Load disk-cached avatars into memory immediately — before auth resolves
    avatarCache.init()

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
      supabase.from('departments').select('*').order('name'),
    ])
    if (profileData) setProfile(profileData)
    if (deptsData) {
      setDepartments(deptsData.map(d => d.name))
      const sched = {}
      deptsData.forEach(d => { sched[d.name] = { work_start: d.work_start || '09:00', work_end: d.work_end || '19:00' } })
      setDeptSchedules(sched)
    }
    setLoading(false)

    // Background: prefetch all user avatars so they render instantly everywhere
    supabase
      .from('profiles')
      .select('id, avatar_url')
      .not('avatar_url', 'is', null)
      .then(({ data }) => { if (data?.length) avatarCache.prefetch(data) })
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
  const isDiller     = profile?.role === 'diller'
  const isAnyAdmin   = isSuperAdmin || isSubAdmin || isDiller
  const managedDept  = (isSubAdmin || isDiller) ? (profile?.department || null) : null
  const displayName  = profile?.full_name || session.user.email

  // Employee users get the full-screen sidebar layout — no top header
  if (!isAnyAdmin) {
    return (
      <div className="app" style={{ overflow: 'hidden' }}>
        <EmployeeView profile={profile} onSignOut={handleSignOut} deptSchedule={deptSchedules[profile?.department]} />
        {updateState && <UpdateBanner state={updateState} progress={updateProgress} version={updateVersion} onRestart={() => window.electronAPI?.installUpdate()} onDismiss={() => setUpdateState(null)} />}
      </div>
    )
  }

  const roleBadgeLabel = isSuperAdmin ? 'CEO' : isDiller ? 'Diller' : 'Sub-Admin'
  const roleBadgeClass = isSuperAdmin ? 'role-admin' : isDiller ? 'role-diller' : 'role-subadmin'

  // Sub-admin / diller switched to their own worker/timer screen
  if ((isSubAdmin || isDiller) && workerMode) {
    return (
      <div className="app" style={{ overflow: 'hidden' }}>
        <EmployeeView profile={profile} onSignOut={handleSignOut} deptSchedule={deptSchedules[profile?.department]} />
        {/* Floating button to return to admin panel */}
        <button
          onClick={() => setWorkerMode(false)}
          style={{
            position: 'fixed', top: 12, right: 12, zIndex: 9999,
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#6366f1', color: '#fff', border: 'none',
            borderRadius: 7, padding: '7px 13px', fontSize: 12,
            fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 8px #6366f140',
          }}
          title="Back to Admin Panel"
        >
          <ChevronLeft size={14} />
          Admin Panel
        </button>
        {updateState && <UpdateBanner state={updateState} progress={updateProgress} version={updateVersion} onRestart={() => window.electronAPI?.installUpdate()} onDismiss={() => setUpdateState(null)} />}
      </div>
    )
  }

  return (
    <div className="admin-shell">
      {/* ── Admin sidebar ── */}
      <aside className="admin-sidebar">
        <div className="admin-sb-brand">
          <div className="logo-mark" style={{ width: 32, height: 32 }}>
            <Monitor size={16} />
          </div>
          <div>
            <div className="admin-sb-title">PharmaStaff</div>
            <div className="admin-sb-sub">{managedDept ? managedDept : 'Hub'}</div>
          </div>
        </div>

        <nav className="admin-sb-nav">
          {ADMIN_NAV.filter(item =>
            isDiller ? !['reports', 'admin', 'salary'].includes(item.id) : true
          ).map(item => (
            <button
              key={item.id}
              className={`admin-sb-item ${activeTab === item.id ? 'admin-sb-active' : ''}`}
              onClick={() => setActiveTab(item.id)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
          {/* Sub-admins and dillers are also workers — give them access to their own timer */}
          {(isSubAdmin || isDiller) && (
            <button
              className="admin-sb-item"
              onClick={() => setWorkerMode(true)}
              title="Switch to your worker / clock-in screen"
            >
              <Timer size={15} />
              My Work
            </button>
          )}
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
        {activeTab === 'dashboard'  && <AdminDashboard adminName={displayName} managedDept={managedDept} hideSalary={isDiller} />}
        {activeTab === 'myteam'     && <MyTeam managedDept={managedDept} hideSalary={isDiller} />}
        {activeTab === 'employees'  && <main className="app-main"><EmployeeTable departments={departments} managedDept={managedDept} hideSalary={isDiller} /></main>}
        {activeTab === 'reports'    && !isDiller && <ReportsView managedDept={managedDept} deptSchedules={deptSchedules} />}
        {activeTab === 'salary'     && !isDiller && <main className="app-main"><SalaryReport managedDept={managedDept} /></main>}
        {activeTab === 'admin'      && !isDiller && <main className="app-main"><AdminPanel departments={departments} onDepartmentsChange={setDepartments} deptSchedules={deptSchedules} onSchedulesChange={setDeptSchedules} currentUserId={profile?.id} isSuperAdmin={isSuperAdmin} managedDept={managedDept} /></main>}
        {activeTab === 'profile'    && (
          <div style={{ flex: 1, overflowY: 'auto', minWidth: 0 }}>
            <ProfilePanel profile={profile} onUpdate={setProfile} />
          </div>
        )}
      </div>

      {updateState && <UpdateBanner state={updateState} progress={updateProgress} version={updateVersion} onRestart={() => window.electronAPI?.installUpdate()} onDismiss={() => setUpdateState(null)} />}
    </div>
  )
}
