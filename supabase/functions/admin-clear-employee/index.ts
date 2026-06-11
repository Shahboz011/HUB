import { verifyAdmin, json, corsHeaders } from '../_shared/auth.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Destructive wipe is super-admin only
  const auth = await verifyAdmin(req, ['admin'])
  if (auth instanceof Response) return auth

  const { userId, scope } = await req.json()
  if (!userId) return json({ ok: false, error: 'userId is required' }, 400)

  if (scope === 'screenshots') {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Best-effort storage prefix delete (non-fatal if it fails)
    await fetch(`${supabaseUrl}/storage/v1/object/delete/screenshots`, {
      method: 'DELETE',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${serviceKey}`,
        'apikey':        serviceKey,
      },
      body: JSON.stringify({ prefixes: [`${userId}/`] }),
    }).catch(() => {})

    const { error } = await auth.serviceClient
      .from('screenshots')
      .delete()
      .eq('employee_id', userId)
    if (error) return json({ ok: false, error: error.message }, 500)
    return json({ ok: true })

  } else if (scope === 'history') {
    // Delete break_log first (non-fatal — table may be empty)
    await auth.serviceClient
      .from('break_log')
      .delete()
      .eq('employee_id', userId)

    // Delete all ended sessions
    const { error: sessErr } = await auth.serviceClient
      .from('work_sessions')
      .delete()
      .eq('employee_id', userId)
      .not('ended_at', 'is', null)
    if (sessErr) return json({ ok: false, error: sessErr.message }, 500)

    // Reset cumulative hours on the profile
    const { error: profErr } = await auth.serviceClient
      .from('profiles')
      .update({ hours_worked: 0 })
      .eq('id', userId)
    if (profErr) return json({ ok: false, error: profErr.message }, 500)

    return json({ ok: true })

  } else {
    return json({ ok: false, error: `Unknown scope '${scope}'` }, 400)
  }
})
