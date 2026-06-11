import { verifyAdmin, json, corsHeaders } from '../_shared/auth.ts'

// Mirror of the C2 whitelist in the Electron main process.
// Both layers enforce it independently — the Edge Function is the authoritative one.
const ALLOWED_FIELDS = new Set([
  'full_name', 'department', 'position',
  'hourly_rate', 'hours_worked', 'bonuses', 'fines',
])

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const auth = await verifyAdmin(req, ['admin', 'subadmin'])
  if (auth instanceof Response) return auth

  const { userId, fields } = await req.json()
  if (!userId || !fields) return json({ ok: false, error: 'userId and fields are required' }, 400)

  const safe: Record<string, unknown> = {}
  const stripped: string[] = []
  for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
    if (ALLOWED_FIELDS.has(k)) safe[k] = v
    else stripped.push(k)
  }
  if (stripped.length) {
    console.warn(`[update-member] caller=${auth.callerId} stripped forbidden fields:`, stripped)
  }
  if (Object.keys(safe).length === 0) {
    return json({ ok: false, error: 'No permitted fields to update' }, 400)
  }

  const { error } = await auth.serviceClient
    .from('profiles')
    .update(safe)
    .eq('id', userId)

  if (error) return json({ ok: false, error: error.message }, 500)
  return json({ ok: true })
})
