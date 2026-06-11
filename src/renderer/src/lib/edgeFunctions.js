import { supabase } from './supabase'

/**
 * Calls a Supabase Edge Function and normalises the response to
 * { ok: bool, error?: string, ...rest }.
 * The user's JWT is attached automatically by the Supabase JS client.
 */
export async function callEdgeFn(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) return { ok: false, error: error.message || 'Network error' }
  return data ?? { ok: false, error: 'Empty response from function' }
}

/**
 * Fetches screenshot paths from private Supabase Storage via signed URLs
 * (1-hour expiry). Returns an array parallel to `paths`; null entries mean
 * the file was not found or the signed-URL request failed.
 */
export async function fetchScreenshotUrls(paths) {
  if (!paths?.length) return []
  const { data, error } = await supabase.storage
    .from('screenshots')
    .createSignedUrls(paths, 3600)
  if (error) {
    console.error('[screenshots] createSignedUrls top-level error:', error.message, error)
    return paths.map(() => null)
  }
  if (!data) {
    console.error('[screenshots] createSignedUrls returned null data')
    return paths.map(() => null)
  }
  // Log any per-entry failures so the exact RLS error is visible in DevTools
  data.forEach((entry, i) => {
    if (!entry.signedUrl) console.warn(`[screenshots] no signedUrl for path[${i}] ${paths[i]}:`, entry.error ?? 'no error field')
  })
  return data.map(entry => entry.signedUrl ?? null)
}
