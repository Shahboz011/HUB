-- =============================================================================
-- Storage buckets + policies
-- =============================================================================
-- avatars     — PUBLIC  (read by URL). Path: <userId>/avatar.<ext>
-- screenshots — PRIVATE (signed URLs only). Path: <userId>/<ts>_screen.jpg
-- Files live under a per-user folder, so the first path segment is the owner id.
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', false)
on conflict (id) do update set public = excluded.public;

-- ── avatars ──────────────────────────────────────────────────────────────────
-- Public read; each user may write only into their own <userId>/ folder.
drop policy if exists "avatars public read"   on storage.objects;
drop policy if exists "avatars owner write"    on storage.objects;
drop policy if exists "avatars owner update"   on storage.objects;
drop policy if exists "avatars owner delete"   on storage.objects;

create policy "avatars public read" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "avatars owner write" on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars owner update" on storage.objects
  for update using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars owner delete" on storage.objects
  for delete using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── screenshots ──────────────────────────────────────────────────────────────
-- Workers upload into their own folder. Reads (for signed URLs created with the
-- caller's JWT in AttendanceView/ReportsView) are allowed for the owner and for
-- staff. The admin-get-screenshot-urls Edge Function uses the service key and
-- bypasses these policies entirely.
drop policy if exists "screenshots owner write" on storage.objects;
drop policy if exists "screenshots read"        on storage.objects;

create policy "screenshots owner write" on storage.objects
  for insert with check (
    bucket_id = 'screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "screenshots read" on storage.objects
  for select using (
    bucket_id = 'screenshots'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_staff()
    )
  );
