import { verifyAdmin, json, corsHeaders } from '../_shared/auth.ts'

// Uniform distribution: 32 chars divides 256 byte values evenly — no modulo bias
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function generateTempPassword(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return 'PSH-' + Array.from(bytes, b => CHARS[b % CHARS.length]).join('')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const auth = await verifyAdmin(req, ['admin', 'subadmin'])
  if (auth instanceof Response) return auth

  const { email, department, position, hourly_rate } = await req.json()
  if (!email) return json({ ok: false, error: 'email is required' }, 400)

  const tempPassword = generateTempPassword()

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${serviceKey}`,
      'apikey':        serviceKey,
    },
    body: JSON.stringify({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { department, position, hourly_rate },
    }),
  })

  if (res.status === 200 || res.status === 201) {
    return json({ ok: true, tempPassword })
  }

  const body = await res.json().catch(() => ({}))
  const msg  = body?.msg || body?.message || body?.error_description || 'Unknown error'
  return json({ ok: false, error: msg }, res.status)
})
