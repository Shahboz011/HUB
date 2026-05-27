/**
 * avatarCache — in-process singleton for avatar images.
 *
 * On app start:
 *   1. init() reads all cached files from disk (IPC → main) and populates _cache.
 *   2. After login, App.jsx calls prefetch(profiles) to download any missing ones
 *      in the background; the cache is updated and all subscribers are notified.
 *
 * Components:
 *   - Use get(userId) to retrieve a data: URL synchronously.
 *   - Use subscribe(fn) to re-render when the cache updates.
 *   - UserAvatar.jsx wraps this automatically.
 */

const _cache = new Map()        // userId (string) → data: URL
const _listeners = new Set()    // Set<() => void>
let _initPromise = null         // deduplicate concurrent init() calls

// ── subscribe / notify ────────────────────────────────────────────────────────

export function subscribe(fn) {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}

function _notify() {
  _listeners.forEach(fn => fn())
}

// ── read / write ──────────────────────────────────────────────────────────────

/** Synchronously return the cached data URL for a user, or undefined. */
export function get(userId) {
  return _cache.get(String(userId))
}

/** Store a data URL in memory (and notify subscribers). Does NOT write to disk. */
export function set(userId, dataUrl) {
  _cache.set(String(userId), dataUrl)
  _notify()
}

/** Remove a user's entry (call when avatar is deleted or changed). */
export function invalidate(userId) {
  _cache.delete(String(userId))
  _notify()
}

// ── initialisation ────────────────────────────────────────────────────────────

/**
 * Load all disk-cached avatar files into memory.
 * Safe to call multiple times — deduplicated to one IPC round-trip.
 */
export function init() {
  if (_initPromise) return _initPromise
  _initPromise = (async () => {
    if (!window.electronAPI?.loadAvatarCache) return
    try {
      const map = await window.electronAPI.loadAvatarCache()   // { userId: dataUrl }
      let added = 0
      for (const [id, dataUrl] of Object.entries(map)) {
        _cache.set(id, dataUrl)
        added++
      }
      if (added > 0) _notify()
    } catch { /* non-fatal */ }
  })()
  return _initPromise
}

// ── background prefetch ───────────────────────────────────────────────────────

const _fetching = new Set()   // userIds currently being fetched (avoid duplicate requests)

/**
 * For each entry in `users` that has an avatar_url but is not yet cached,
 * ask the main process to download + disk-cache it, then populate memory.
 *
 * users: Array<{ id: string, avatar_url: string | null }>
 */
export async function prefetch(users) {
  if (!window.electronAPI?.fetchAndCacheAvatars) return

  const toFetch = users
    .filter(u => u.avatar_url && !_cache.has(String(u.id)) && !_fetching.has(String(u.id)))
    .map(u => {
      // Strip cache-busting query params before sending to main
      let cleanUrl = u.avatar_url
      try { cleanUrl = new URL(u.avatar_url).origin + new URL(u.avatar_url).pathname } catch {}
      return { userId: String(u.id), url: cleanUrl }
    })

  if (toFetch.length === 0) return

  toFetch.forEach(({ userId }) => _fetching.add(userId))

  try {
    const newEntries = await window.electronAPI.fetchAndCacheAvatars(toFetch)  // { userId: dataUrl }
    let added = 0
    for (const [id, dataUrl] of Object.entries(newEntries)) {
      _cache.set(id, dataUrl)
      added++
    }
    if (added > 0) _notify()
  } catch { /* non-fatal */ } finally {
    toFetch.forEach(({ userId }) => _fetching.delete(userId))
  }
}
