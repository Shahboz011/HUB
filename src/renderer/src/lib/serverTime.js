import { supabase } from './supabase'

let _offset = 0 // ms: serverTime - clientTime (positive = server ahead)

export async function syncServerTime() {
  try {
    const t0 = Date.now()
    const { data } = await supabase.rpc('get_server_time')
    if (!data) return
    const t1 = Date.now()
    // Use midpoint of round-trip to approximate network latency
    _offset = new Date(data).getTime() - Math.round((t0 + t1) / 2)
  } catch {}
}

// Returns current time in ms, corrected to server time
export function serverNow() {
  return Date.now() + _offset
}

// Returns ISO string of server-corrected current time
export function serverNowISO() {
  return new Date(serverNow()).toISOString()
}

// Returns how many seconds the client clock differs from server (absolute value)
export function getClockDriftSecs() {
  return Math.round(Math.abs(_offset) / 1000)
}
