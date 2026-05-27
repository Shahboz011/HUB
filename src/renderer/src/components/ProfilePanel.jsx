import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { Camera, X, Info, KeyRound, AtSign, Tag, Globe } from 'lucide-react'
import * as avatarCache from '../lib/avatarCache'
import UserAvatar from './UserAvatar'

// ── Tag input helper ──────────────────────────────────────────────────────────
function TagInput({ tags, onTagsChange, placeholder }) {
  const [inputVal, setInputVal] = useState('')

  function addTag(raw) {
    const val = raw.trim().replace(/,+$/, '').trim()
    if (!val || tags.includes(val)) return
    onTagsChange([...tags, val])
    setInputVal('')
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(inputVal)
    } else if (e.key === 'Backspace' && inputVal === '' && tags.length > 0) {
      onTagsChange(tags.slice(0, -1))
    }
  }

  return (
    <div className="profile-tag-area">
      {tags.map((t, i) => (
        <span key={i} className="profile-tag">
          {t}
          <button
            className="profile-tag-remove"
            onClick={() => onTagsChange(tags.filter((_, j) => j !== i))}
            tabIndex={-1}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        className="profile-tag-input"
        value={inputVal}
        onChange={e => setInputVal(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => inputVal.trim() && addTag(inputVal)}
        placeholder={tags.length === 0 ? placeholder : ''}
      />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ProfilePanel({ profile: initialProfile, onUpdate }) {
  const [prof, setProf] = useState(initialProfile)

  // Personal info
  const [name, setName]         = useState(initialProfile.full_name || '')
  const [telegram, setTelegram] = useState(initialProfile.telegram || '')
  const [infoSaving, setInfoSaving] = useState(false)
  const [infoSaved,  setInfoSaved]  = useState(false)
  const [infoError,  setInfoError]  = useState('')

  // Skills & languages
  const [skills,   setSkills]   = useState(initialProfile.skills   || [])
  const [langs,    setLangs]    = useState(initialProfile.languages || [])
  const [tagSaving, setTagSaving] = useState(false)
  const [tagSaved,  setTagSaved]  = useState(false)
  const [tagError,  setTagError]  = useState('')

  // Avatar
  const fileInputRef     = useRef(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarError,     setAvatarError]     = useState('')

  // Password
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNew,     setPwNew]     = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwSaving,  setPwSaving]  = useState(false)
  const [pwSaved,   setPwSaved]   = useState(false)
  const [pwError,   setPwError]   = useState('')

  // ── helpers ──
  function applyUpdate(fields) {
    const merged = { ...prof, ...fields }
    setProf(merged)
    onUpdate?.(merged)
  }

  async function saveViaIPC(fields) {
    if (window.electronAPI?.updateMember) {
      const r = await window.electronAPI.updateMember({ userId: prof.id, fields })
      if (!r.ok) throw new Error(r.error || 'Unknown error')
    } else {
      // Fallback: direct Supabase update (works if RLS allows self-update)
      const { error } = await supabase.from('profiles').update(fields).eq('id', prof.id)
      if (error) throw error
    }
  }

  // ── avatar upload ──
  async function handleAvatarFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { setAvatarError('Image must be under 5 MB'); return }
    setAvatarError('')
    setAvatarUploading(true)
    try {
      const arrayBuffer = await file.arrayBuffer()
      // Chunked btoa to avoid call-stack overflow on large files
      const uint8 = new Uint8Array(arrayBuffer)
      let binary = ''
      const CHUNK = 8192
      for (let i = 0; i < uint8.length; i += CHUNK) {
        binary += String.fromCharCode(...uint8.subarray(i, i + CHUNK))
      }
      const base64 = btoa(binary)
      const mimeType = file.type || 'image/jpeg'

      if (window.electronAPI?.uploadAvatar) {
        const r = await window.electronAPI.uploadAvatar({ userId: prof.id, base64, mimeType })
        if (!r.ok) throw new Error(r.error)
        // Push into in-memory cache immediately so every component updates at once
        if (r.dataUrl) avatarCache.set(prof.id, r.dataUrl)
        await saveViaIPC({ avatar_url: r.url })
        applyUpdate({ avatar_url: r.url })
      } else {
        // Web fallback: Supabase storage via anon key
        const ext = mimeType === 'image/png' ? 'png' : 'jpg'
        const path = `${prof.id}/avatar.${ext}`
        const { error: upErr } = await supabase.storage
          .from('avatars').upload(path, file, { upsert: true, contentType: mimeType })
        if (upErr) throw upErr
        const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
        const dataUrl = `data:${mimeType};base64,${base64}`
        avatarCache.set(prof.id, dataUrl)
        await saveViaIPC({ avatar_url: publicUrl })
        applyUpdate({ avatar_url: publicUrl })
      }
    } catch (err) {
      setAvatarError(err.message || 'Upload failed')
    } finally {
      setAvatarUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // ── personal info ──
  async function savePersonalInfo() {
    if (!name.trim()) { setInfoError('Name cannot be empty'); return }
    setInfoSaving(true); setInfoError(''); setInfoSaved(false)
    try {
      // Keep auth metadata in sync
      await supabase.auth.updateUser({ data: { full_name: name.trim() } })
      await saveViaIPC({ full_name: name.trim(), telegram: telegram.trim() })
      applyUpdate({ full_name: name.trim(), telegram: telegram.trim() })
      setInfoSaved(true)
      setTimeout(() => setInfoSaved(false), 2500)
    } catch (err) {
      setInfoError(err.message || 'Save failed')
    } finally {
      setInfoSaving(false)
    }
  }

  // ── skills & languages ──
  async function saveTagFields() {
    setTagSaving(true); setTagError(''); setTagSaved(false)
    try {
      await saveViaIPC({ skills, languages: langs })
      applyUpdate({ skills, languages: langs })
      setTagSaved(true)
      setTimeout(() => setTagSaved(false), 2500)
    } catch (err) {
      setTagError(err.message || 'Save failed')
    } finally {
      setTagSaving(false)
    }
  }

  // ── password ──
  async function changePassword() {
    if (!pwCurrent) { setPwError('Enter your current password'); return }
    if (!pwNew) { setPwError('Enter a new password'); return }
    if (pwNew.length < 6) { setPwError('New password must be at least 6 characters'); return }
    if (pwNew !== pwConfirm) { setPwError('Passwords do not match'); return }
    if (pwNew === pwCurrent) { setPwError('New password must be different from current'); return }
    setPwSaving(true); setPwError(''); setPwSaved(false)
    // Verify current password first
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: prof.email,
      password: pwCurrent,
    })
    if (signInErr) { setPwError('Current password is incorrect'); setPwSaving(false); return }
    // Current password verified — apply the change
    const { error: updateErr } = await supabase.auth.updateUser({ password: pwNew })
    if (updateErr) { setPwError(updateErr.message); setPwSaving(false); return }
    setPwCurrent(''); setPwNew(''); setPwConfirm('')
    setPwSaved(true)
    setTimeout(() => setPwSaved(false), 3000)
    setPwSaving(false)
  }

  return (
    <div className="ev-content-area">
      <div className="ev-page-header">
        <h2 className="ev-page-title">My Profile</h2>
        <p className="ev-page-sub">Update your personal info, photo, skills, and password.</p>
      </div>

      {/* ── Avatar + header ── */}
      <div className="profile-card" style={{ marginBottom: 16 }}>
        <div className="profile-avatar-row">
          <div
            className="profile-avatar-wrap"
            onClick={() => fileInputRef.current?.click()}
            title="Click to change photo"
          >
            {/* UserAvatar reads from the cache — instantly shows photo without a network request */}
            <UserAvatar
              userId={prof.id}
              name={prof.full_name}
              avatarUrl={prof.avatar_url}
              className="profile-big-avatar"
              style={{ background: '#6366f118', border: '3px solid #6366f140', color: '#6366f1', width: 72, height: 72, fontSize: 24, fontWeight: 700 }}
            />
            <div className="profile-avatar-overlay">
              {avatarUploading
                ? <div className="loading-spinner" style={{ width: 18, height: 18, borderWidth: 2, borderColor: '#fff3', borderTopColor: '#fff' }} />
                : <Camera size={18} color="#fff" />
              }
            </div>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleAvatarFile} />
          <div>
            <div className="profile-name-display">{prof.full_name}</div>
            <div className="profile-email-display">{prof.email}</div>
            {avatarError && <p style={{ color: 'var(--color-danger)', fontSize: 12, margin: '4px 0 0' }}>{avatarError}</p>}
          </div>
        </div>
      </div>

      {/* ── Personal info ── */}
      <div className="profile-card" style={{ marginBottom: 16 }}>
        <div className="profile-section-header">
          <span className="profile-section-title">Personal Info</span>
        </div>

        <div className="profile-two-col">
          <div className="profile-field-group">
            <label className="profile-field-label">Full Name</label>
            <input
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setInfoSaved(false) }}
              className="form-input"
              onKeyDown={e => e.key === 'Enter' && savePersonalInfo()}
              placeholder="Your full name"
            />
          </div>
          <div className="profile-field-group">
            <label className="profile-field-label">
              <AtSign size={11} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
              Telegram Username
            </label>
            <input
              type="text"
              value={telegram}
              onChange={e => { setTelegram(e.target.value.replace(/^@/, '')); setInfoSaved(false) }}
              className="form-input"
              placeholder="username (without @)"
              onKeyDown={e => e.key === 'Enter' && savePersonalInfo()}
            />
          </div>
        </div>

        {infoError && <p className="bf-error" style={{ padding: 0, marginTop: 8 }}>{infoError}</p>}

        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className="profile-save-btn"
            onClick={savePersonalInfo}
            disabled={infoSaving}
          >
            {infoSaving ? 'Saving…' : infoSaved ? '✓ Saved' : 'Save Personal Info'}
          </button>
        </div>
      </div>

      {/* ── Skills & Languages ── */}
      <div className="profile-card" style={{ marginBottom: 16 }}>
        <div className="profile-section-header">
          <span className="profile-section-title">Skills &amp; Languages</span>
        </div>

        <div className="profile-field-group" style={{ marginBottom: 14 }}>
          <label className="profile-field-label">
            <Tag size={11} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
            Skills
          </label>
          <TagInput
            tags={skills}
            onTagsChange={setSkills}
            placeholder="Type a skill and press Enter…"
          />
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Press Enter or comma to add · Backspace to remove last
          </span>
        </div>

        <div className="profile-field-group">
          <label className="profile-field-label">
            <Globe size={11} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
            Languages
          </label>
          <TagInput
            tags={langs}
            onTagsChange={setLangs}
            placeholder="Type a language and press Enter…"
          />
        </div>

        {tagError && <p className="bf-error" style={{ padding: 0, marginTop: 8 }}>{tagError}</p>}

        <div style={{ marginTop: 14 }}>
          <button
            className="profile-save-btn"
            onClick={saveTagFields}
            disabled={tagSaving}
          >
            {tagSaving ? 'Saving…' : tagSaved ? '✓ Saved' : 'Save Skills & Languages'}
          </button>
        </div>
      </div>

      {/* ── Read-only info ── */}
      <div className="profile-card" style={{ marginBottom: 16 }}>
        <div className="profile-section-header">
          <span className="profile-section-title">Account Info</span>
        </div>
        <div className="profile-readonly-grid">
          <div className="profile-ro-field">
            <span className="profile-field-label">Email</span>
            <span className="profile-ro-value">{prof.email}</span>
          </div>
          <div className="profile-ro-field">
            <span className="profile-field-label">Department</span>
            <span className="profile-ro-value">{prof.department || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not assigned</span>}</span>
          </div>
          <div className="profile-ro-field">
            <span className="profile-field-label">Position</span>
            <span className="profile-ro-value">{prof.position || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not assigned</span>}</span>
          </div>
          <div className="profile-ro-field">
            <span className="profile-field-label">Role</span>
            <span className={`role-badge ${prof.role === 'admin' ? 'role-admin' : prof.role === 'subadmin' ? 'role-subadmin' : 'role-employee'}`}>
              {prof.role === 'admin' ? 'CEO' : prof.role === 'subadmin' ? 'Sub-Admin' : 'Employee'}
            </span>
          </div>
        </div>
        <div className="profile-admin-note">
          <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          Department, position, and hourly rate are managed by your admin.
        </div>
      </div>

      {/* ── Password change ── */}
      <div className="profile-card">
        <div className="profile-section-header">
          <KeyRound size={15} style={{ color: 'var(--text-muted)' }} />
          <span className="profile-section-title">Change Password</span>
        </div>

        <div className="profile-field-group" style={{ marginBottom: 14 }}>
          <label className="profile-field-label">Current Password</label>
          <input
            type="password"
            value={pwCurrent}
            onChange={e => { setPwCurrent(e.target.value); setPwError(''); setPwSaved(false) }}
            className="form-input"
            placeholder="Enter your current password"
            autoComplete="current-password"
          />
        </div>

        <div className="profile-two-col">
          <div className="profile-field-group">
            <label className="profile-field-label">New Password</label>
            <input
              type="password"
              value={pwNew}
              onChange={e => { setPwNew(e.target.value); setPwError(''); setPwSaved(false) }}
              className="form-input"
              placeholder="Min. 6 characters"
              autoComplete="new-password"
            />
          </div>
          <div className="profile-field-group">
            <label className="profile-field-label">Confirm New Password</label>
            <input
              type="password"
              value={pwConfirm}
              onChange={e => { setPwConfirm(e.target.value); setPwError(''); setPwSaved(false) }}
              className="form-input"
              placeholder="Repeat new password"
              autoComplete="new-password"
              onKeyDown={e => e.key === 'Enter' && changePassword()}
            />
          </div>
        </div>

        {pwError && <p className="bf-error" style={{ padding: 0, marginTop: 8 }}>{pwError}</p>}

        <div style={{ marginTop: 14 }}>
          <button
            className="profile-save-btn"
            onClick={changePassword}
            disabled={pwSaving || !pwCurrent || !pwNew}
          >
            {pwSaving ? 'Verifying…' : pwSaved ? '✓ Password Changed' : 'Change Password'}
          </button>
        </div>
      </div>
    </div>
  )
}
