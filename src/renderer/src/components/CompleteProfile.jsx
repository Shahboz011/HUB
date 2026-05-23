import { useState } from 'react'
import { Monitor } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function CompleteProfile({ session }) {
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!fullName.trim()) { setError('Please enter your full name'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return }
    setLoading(true)
    setError('')

    const { error: authErr } = await supabase.auth.updateUser({
      password,
      data: { full_name: fullName.trim() },
    })
    if (authErr) { setError(authErr.message); setLoading(false); return }

    const { error: dbErr } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim() })
      .eq('id', session.user.id)
    if (dbErr) { setError(dbErr.message); setLoading(false); return }

    // onAuthStateChange will fire USER_UPDATED → App re-fetches profile → CompleteProfile unmounts
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-logo-wrap">
          <div className="logo-mark" style={{ width: 48, height: 48 }}>
            <Monitor size={22} />
          </div>
        </div>

        <h1 className="auth-title">Welcome!</h1>
        <p className="auth-subtitle">You've been invited. Complete your profile to get started.</p>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label className="form-label">Your Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              className="form-input"
              placeholder="John Smith"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">Create a Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="form-input"
              placeholder="Min. 6 characters"
              minLength={6}
              required
            />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
              You'll use this password to sign in next time.
            </span>
          </div>

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? 'Saving…' : 'Complete Setup'}
          </button>
        </form>
      </div>
    </div>
  )
}
