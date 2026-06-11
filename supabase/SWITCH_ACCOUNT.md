# Switching to a new Supabase project

The original project (`oewfgyiuyeetsxebowaa`) was deleted with no backup, so its
data is gone. This rebuilds everything in a fresh project. Workers re-register.

## 1. Create the project
1. https://supabase.com → **New project**. Pick a region close to your users.
2. Save the DB password somewhere safe.
3. From **Project Settings → API**, copy:
   - **Project URL** → `https://<NEW_REF>.supabase.co`
   - **anon public** key
   - **service_role** key  (secret — never ships in the client bundle)

## 2. Create the schema
SQL Editor → New query → paste & run, in this order:
1. `supabase/migrations/20260611000000_init.sql`   (tables, RPCs, RLS, trigger)
2. `supabase/migrations/20260611000100_storage.sql` (avatars + screenshots buckets)

> ⚠ Review `clock_out_session` in the init migration — it controls paid hours and
> is a best-effort reconstruction.

## 3. Deploy the Edge Functions
```
supabase login
supabase link --project-ref <NEW_REF>
supabase functions deploy admin-invite-member admin-delete-member \
  admin-update-member admin-update-department admin-manage-transaction \
  admin-clear-employee admin-get-screenshot-urls
```
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically into deployed functions — no manual secrets needed.

## 4. Repoint the client (done in code once new keys are provided)
- `src/renderer/src/lib/supabase.js` — URL + anon key
- `src/renderer/index.html` — CSP `connect-src` / `wss` / `img-src`
- `src/main/index.js` — `SUPABASE_URL`
- `run-migration.mjs` — project ref + service key (one-off helper, optional)

## 5. Bootstrap the first admin
Sign up in the app, then in SQL Editor:
```sql
update public.profiles set role = 'admin', full_name = 'Your Name'
where email = 'you@example.com';
```

## 6. Auth settings
- **Authentication → Providers → Email**: enable, and turn **Confirm email** OFF
  (invites create users with `email_confirm: true`; workers sign in immediately).
