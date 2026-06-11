import { verifyAdmin, json, corsHeaders } from '../_shared/auth.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const auth = await verifyAdmin(req, ['admin', 'subadmin'])
  if (auth instanceof Response) return auth

  const body = await req.json()
  const { action } = body

  if (action === 'insert') {
    const { employee_id, type, amount, note } = body
    if (!employee_id || !type || amount === undefined) {
      return json({ ok: false, error: 'employee_id, type, and amount are required' }, 400)
    }
    const { data, error } = await auth.serviceClient
      .from('transactions')
      .insert({ employee_id, type, amount, note: note ?? '' })
      .select()
      .single()
    if (error) return json({ ok: false, error: error.message }, 500)
    return json({ ok: true, tx: data })

  } else if (action === 'update') {
    const { txId, fields } = body
    if (!txId || !fields) return json({ ok: false, error: 'txId and fields are required' }, 400)
    const { error } = await auth.serviceClient
      .from('transactions')
      .update(fields)
      .eq('id', txId)
    if (error) return json({ ok: false, error: error.message }, 500)
    return json({ ok: true })

  } else if (action === 'delete') {
    const { txId } = body
    if (!txId) return json({ ok: false, error: 'txId is required' }, 400)
    const { error } = await auth.serviceClient
      .from('transactions')
      .delete()
      .eq('id', txId)
    if (error) return json({ ok: false, error: error.message }, 500)
    return json({ ok: true })

  } else {
    return json({ ok: false, error: `Unknown action '${action}'` }, 400)
  }
})
