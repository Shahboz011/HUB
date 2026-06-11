import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export type AuthOk = {
  callerId: string
  callerRole: string
  serviceClient: SupabaseClient
}

/**
 * Verifies the caller's JWT and confirms their role is in allowedRoles.
 * Returns an AuthOk on success, or a ready-to-return error Response on failure.
 * The serviceClient in AuthOk uses the service-role key and can bypass RLS.
 */
export async function verifyAdmin(
  req: Request,
  allowedRoles: string[] = ['admin', 'subadmin'],
): Promise<AuthOk | Response> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ ok: false, error: 'Missing or malformed Authorization header' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey    = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Ask Supabase Auth to validate the token — cannot be faked by caller
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: authError } = await callerClient.auth.getUser()
  if (authError || !user) {
    return json({ ok: false, error: 'Invalid or expired token' }, 401)
  }

  // Confirm role against the database — JWT claims alone are not trusted for role
  const serviceClient = createClient(supabaseUrl, serviceKey)
  const { data: profile } = await serviceClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !allowedRoles.includes(profile.role)) {
    console.warn(`[auth] forbidden: user=${user.id} role=${profile?.role} required=${allowedRoles}`)
    return json({ ok: false, error: `Role '${profile?.role}' is not permitted for this action` }, 403)
  }

  return { callerId: user.id, callerRole: profile.role, serviceClient }
}
