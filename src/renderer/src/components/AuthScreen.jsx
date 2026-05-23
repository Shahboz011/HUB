import { useState } from 'react'
import { Monitor } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function AuthScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-logo-wrap">
          <div className="logo-mark" style={{ width: 48, height: 48 }}>
            <Monitor size={22} />
          </div>
        </div>

        <h1 className="auth-title">Salary Command Center</h1>
        <p className="auth-subtitle">Sign in to your account</p>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="form-input"
              placeholder="you@company.com"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="form-input"
              placeholder="••••••••"
              required
            />
          </div>

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p style={{ marginTop: 24, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
          No account?<br />
          <span style={{ color: 'var(--text-secondary)' }}>Ask your admin to send you an invite.</span>
        </p>
      </div>
    </div>
  )
}
