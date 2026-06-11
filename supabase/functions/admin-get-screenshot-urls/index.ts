import { verifyAdmin, json, corsHeaders } from '../_shared/auth.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const auth = await verifyAdmin(req, ['admin', 'subadmin', 'diller'])
  if (auth instanceof Response) return auth

  const { paths } = await req.json()
  if (!Array.isArray(paths) || paths.length === 0) return json({ ok: true, signedUrls: [] })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const res = await fetch(`${supabaseUrl}/storage/v1/object/sign/screenshots`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${serviceKey}`,
      'apikey':        serviceKey,
    },
    body: JSON.stringify({ paths, expiresIn: 3600 }),
  })

  if (!res.ok) return json({ ok: false, error: `Storage API ${res.status}` }, 500)

  const data = await res.json()
  const signedUrls = (Array.isArray(data) ? data : []).map((entry: any) =>
    entry.signedURL ? `${supabaseUrl}/storage/v1${entry.signedURL}` : null
  )

  return json({ ok: true, signedUrls })
})
