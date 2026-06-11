import { verifyAdmin, json, corsHeaders } from '../_shared/auth.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Deleting auth users is super-admin only — subadmins cannot do this
  const auth = await verifyAdmin(req, ['admin'])
  if (auth instanceof Response) return auth

  const { userId } = await req.json()
  if (!userId) return json({ ok: false, error: 'userId is required' }, 400)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${serviceKey}`,
      'apikey':        serviceKey,
    },
  })

  if (res.status === 200 || res.status === 204) return json({ ok: true })
  return json({ ok: false, error: `Auth delete failed with status ${res.status}` }, res.status)
})
