import { verifyAdmin, json, corsHeaders } from '../_shared/auth.ts'

const ALLOWED_FIELDS = new Set(['work_start', 'work_end'])

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const auth = await verifyAdmin(req, ['admin', 'subadmin'])
  if (auth instanceof Response) return auth

  const { name, fields } = await req.json()
  if (!name || !fields) return json({ ok: false, error: 'name and fields are required' }, 400)

  const safe: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
    if (ALLOWED_FIELDS.has(k)) safe[k] = v
  }
  if (Object.keys(safe).length === 0) {
    return json({ ok: false, error: 'No permitted fields to update' }, 400)
  }

  const { error } = await auth.serviceClient
    .from('departments')
    .update(safe)
    .eq('name', name)

  if (error) return json({ ok: false, error: error.message }, 500)
  return json({ ok: true })
})
