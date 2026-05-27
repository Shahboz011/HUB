/**
 * UserAvatar — drop-in replacement for every initials-only avatar in the app.
 *
 * Shows a cached photo if available, otherwise falls back to initials with the
 * existing coloured background.  Automatically triggers a background fetch
 * when `avatarUrl` is provided but the image isn't in the cache yet, and
 * re-renders once it arrives.
 *
 * Usage — just pass the same className + style you already have:
 *
 *   <UserAvatar
 *     userId={emp.id}
 *     name={emp.full_name}
 *     avatarUrl={emp.avatar_url}
 *     className="adash-avatar"
 *     style={{ background: color + '18', color, border: `1.5px solid ${color}35` }}
 *   />
 */

import { useState, useEffect } from 'react'
import * as avatarCache from '../lib/avatarCache'

export default function UserAvatar({ userId, name, avatarUrl, className, style }) {
  // Start with whatever is already in the cache (synchronous — no flash)
  const [src, setSrc] = useState(() => (userId ? avatarCache.get(String(userId)) : undefined))

  useEffect(() => {
    if (!userId) return

    const id = String(userId)

    // Subscribe so we re-render the moment the image lands in the cache
    const unsub = avatarCache.subscribe(() => setSrc(avatarCache.get(id)))

    // If we have a URL but no cached image yet, trigger a background download
    if (avatarUrl && !avatarCache.get(id)) {
      avatarCache.prefetch([{ id, avatar_url: avatarUrl }])
    }

    return unsub
  }, [userId, avatarUrl])

  const initials = name
    ? name.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  return (
    <div
      className={className}
      style={{ ...style, overflow: 'hidden', position: 'relative' }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'cover', display: 'block',
          }}
        />
      ) : initials}
    </div>
  )
}
