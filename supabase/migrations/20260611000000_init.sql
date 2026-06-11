-- =============================================================================
-- PharmaStaff Hub — full schema reconstruction
-- =============================================================================
-- Rebuilt from the application code after the original Supabase project was
-- deleted (no backup existed). Apply this to a fresh Supabase project.
--
-- HOW TO APPLY:
--   Option A (dashboard):  paste this whole file into  SQL Editor → Run.
--   Option B (CLI):        supabase db push   (after `supabase link`).
--
-- ⚠ REVIEW BEFORE TRUSTING PAYROLL:
--   The function `clock_out_session` below controls how paid hours are computed.
--   The exact original formula could not be recovered from the client code, so
--   this is a best-effort reconstruction (gross salary-window time minus unpaid
--   break time; idle is tracked separately and shown as "activity %" in reports).
--   Verify it matches your intended payroll rules before going live.
-- =============================================================================

-- Allow helper functions to reference tables created later in this script.
set check_function_bodies = off;

-- ── Extensions ───────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ── Helper: read the caller's role WITHOUT tripping RLS recursion ─────────────
-- SECURITY DEFINER lets policies on `profiles` call this without recursing into
-- the very policy being evaluated.
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()) in ('admin','subadmin','diller'),
    false
  )
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()) = 'admin',
    false
  )
$$;

-- =============================================================================
-- TABLES
-- =============================================================================

-- ── departments ──────────────────────────────────────────────────────────────
create table if not exists public.departments (
  name        text primary key,
  work_start  text not null default '09:00',   -- ET wall-clock "HH:MM"
  work_end    text not null default '19:00',
  created_at  timestamptz not null default now()
);

-- ── profiles (one row per auth.users) ────────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  full_name    text,                                   -- null until CompleteProfile
  role         text not null default 'employee',       -- employee | subadmin | diller | admin
  department   text references public.departments(name) on update cascade on delete set null,
  position     text,
  hourly_rate  numeric not null default 0,
  hours_worked numeric not null default 0,
  bonuses      numeric not null default 0,
  fines        numeric not null default 0,
  avatar_url   text,
  telegram     text,
  skills       jsonb not null default '[]'::jsonb,
  languages    jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  constraint profiles_role_check check (role in ('employee','subadmin','diller','admin'))
);
create index if not exists profiles_department_idx on public.profiles(department);
create index if not exists profiles_role_idx       on public.profiles(role);

-- ── work_sessions ────────────────────────────────────────────────────────────
create table if not exists public.work_sessions (
  id                             uuid primary key default gen_random_uuid(),
  employee_id                    uuid not null references public.profiles(id) on delete cascade,
  started_at                     timestamptz not null default now(),
  ended_at                       timestamptz,
  duration_hours                 numeric,
  salary_start_at                timestamptz,
  -- idle tracking
  is_idle                        boolean not null default false,
  idle_started_at                timestamptz,
  accumulated_idle_secs          numeric not null default 0,
  -- break tracking
  break_status                   text,                       -- break | restroom | pray | coffee | null
  break_started_at               timestamptz,
  current_break_allowance_secs   integer not null default 0,  -- -1 means unlimited paid
  accumulated_break_secs         numeric not null default 0,
  accumulated_unpaid_break_secs  numeric not null default 0,
  break_count                    integer not null default 0,
  coffee_count                   integer not null default 0,
  used_restroom_secs             integer not null default 0,
  restroom_hour_index            integer not null default 0,
  lunch_used                     boolean not null default false,
  -- early clock-out audit
  early_clockout_initials        text,
  early_clockout_reason          text,
  created_at                     timestamptz not null default now()
);
create index if not exists work_sessions_employee_idx on public.work_sessions(employee_id);
create index if not exists work_sessions_active_idx   on public.work_sessions(employee_id) where ended_at is null;
create index if not exists work_sessions_started_idx  on public.work_sessions(started_at desc);

-- ── break_log ────────────────────────────────────────────────────────────────
create table if not exists public.break_log (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.profiles(id) on delete cascade,
  session_id    uuid references public.work_sessions(id) on delete cascade,
  break_type    text,
  started_at    timestamptz,
  ended_at      timestamptz,
  duration_secs integer,
  paid_secs     integer,
  created_at    timestamptz not null default now()
);
create index if not exists break_log_employee_idx on public.break_log(employee_id);

-- ── screenshots ──────────────────────────────────────────────────────────────
create table if not exists public.screenshots (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.profiles(id) on delete cascade,
  path          text not null,            -- storage key inside the `screenshots` bucket
  taken_at      timestamptz not null default now(),
  active_app    text,
  window_title  text,
  created_at    timestamptz not null default now()
);
create index if not exists screenshots_employee_idx on public.screenshots(employee_id);
create index if not exists screenshots_taken_idx    on public.screenshots(taken_at desc);

-- ── transactions (bonuses / fines) ───────────────────────────────────────────
create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.profiles(id) on delete cascade,
  type         text not null,             -- bonus | fine
  amount       numeric not null,
  note         text default '',
  created_at   timestamptz not null default now(),
  constraint transactions_type_check check (type in ('bonus','fine'))
);
create index if not exists transactions_employee_idx on public.transactions(employee_id);

-- ── invitations ──────────────────────────────────────────────────────────────
create table if not exists public.invitations (
  email        text primary key,
  department   text,
  position     text,
  hourly_rate  numeric default 0,
  created_at   timestamptz not null default now()
);

-- ── activity_blocks (Hubstaff-style 10-min activity windows) ─────────────────
create table if not exists public.activity_blocks (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid references public.profiles(id) on delete cascade,
  session_id       uuid references public.work_sessions(id) on delete cascade,
  block_start      timestamptz,
  block_end        timestamptz,
  active_seconds   integer,
  total_seconds    integer,
  activity_percent numeric,
  was_idle         boolean,
  discard_idle     boolean,
  created_at       timestamptz not null default now()
);
create index if not exists activity_blocks_session_idx on public.activity_blocks(session_id);

-- ── activity_suspicions (macro / low-mouse-variance flags) ───────────────────
create table if not exists public.activity_suspicions (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid references public.profiles(id) on delete cascade,
  session_id   uuid references public.work_sessions(id) on delete cascade,
  reason       text,
  details      jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists activity_suspicions_employee_idx on public.activity_suspicions(employee_id);

-- =============================================================================
-- FUNCTIONS (RPC)
-- =============================================================================

-- get_server_time(): authoritative clock used by every client to correct drift.
create or replace function public.get_server_time()
returns timestamptz
language sql
stable
as $$
  select now()
$$;

-- clock_out_session(p_session_id): closes a session, computes paid hours,
-- and increments the worker's cumulative hours_worked. Returns the hours added.
--
-- ⚠ Best-effort reconstruction — verify against your payroll rules.
-- Paid hours = (ended_at − salary_start_at) − unpaid break time.
-- Idle is NOT subtracted here; it is stored on the session and surfaced as
-- "activity %" in reports (reports do: active = duration − idle).
create or replace function public.clock_out_session(p_session_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session   public.work_sessions%rowtype;
  v_end       timestamptz := now();
  v_gross     numeric;
  v_hours     numeric;
begin
  select * into v_session from public.work_sessions where id = p_session_id;
  if not found then
    raise exception 'work_session % not found', p_session_id;
  end if;

  -- Already closed → return its stored duration, do not double-count.
  if v_session.ended_at is not null then
    return coalesce(v_session.duration_hours, 0);
  end if;

  v_gross := extract(epoch from (v_end - coalesce(v_session.salary_start_at, v_session.started_at)))
             - coalesce(v_session.accumulated_unpaid_break_secs, 0);
  v_hours := greatest(0, v_gross) / 3600.0;

  update public.work_sessions
     set ended_at       = v_end,
         duration_hours = v_hours,
         is_idle        = false,
         idle_started_at = null
   where id = p_session_id;

  update public.profiles
     set hours_worked = coalesce(hours_worked, 0) + v_hours
   where id = v_session.employee_id;

  return v_hours;
end;
$$;

-- =============================================================================
-- NEW-USER TRIGGER
-- =============================================================================
-- When the admin-invite-member Edge Function creates an auth user (with
-- user_metadata = { department, position, hourly_rate }), mirror it into
-- public.profiles. full_name stays NULL so the app shows CompleteProfile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, department, position, hourly_rate)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data->>'department', ''),
    nullif(new.raw_user_meta_data->>'position', ''),
    coalesce((new.raw_user_meta_data->>'hourly_rate')::numeric, 0)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
-- Note: all privileged writes (invite/delete/update member, transactions,
-- department schedule, history wipe) run in Edge Functions with the
-- service-role key, which bypasses RLS. These policies cover the direct
-- client (anon/authenticated) access the app performs.

alter table public.profiles            enable row level security;
alter table public.departments         enable row level security;
alter table public.work_sessions       enable row level security;
alter table public.break_log           enable row level security;
alter table public.screenshots         enable row level security;
alter table public.transactions        enable row level security;
alter table public.invitations         enable row level security;
alter table public.activity_blocks     enable row level security;
alter table public.activity_suspicions enable row level security;

-- ── profiles ──
create policy profiles_select_self_or_staff on public.profiles
  for select using (id = auth.uid() or public.is_staff());
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_admin on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- ── departments (everyone signed-in reads; only admin mutates directly) ──
create policy departments_select_all on public.departments
  for select using (auth.uid() is not null);
create policy departments_insert_admin on public.departments
  for insert with check (public.is_admin());
create policy departments_update_admin on public.departments
  for update using (public.is_admin()) with check (public.is_admin());
create policy departments_delete_admin on public.departments
  for delete using (public.is_admin());

-- ── work_sessions (worker owns their rows; staff can read all) ──
create policy work_sessions_select on public.work_sessions
  for select using (employee_id = auth.uid() or public.is_staff());
create policy work_sessions_insert_self on public.work_sessions
  for insert with check (employee_id = auth.uid());
create policy work_sessions_update_self_or_staff on public.work_sessions
  for update using (employee_id = auth.uid() or public.is_staff())
  with check (employee_id = auth.uid() or public.is_staff());

-- ── break_log ──
create policy break_log_select on public.break_log
  for select using (employee_id = auth.uid() or public.is_staff());
create policy break_log_insert_self on public.break_log
  for insert with check (employee_id = auth.uid());

-- ── screenshots ──
create policy screenshots_select on public.screenshots
  for select using (employee_id = auth.uid() or public.is_staff());
create policy screenshots_insert_self on public.screenshots
  for insert with check (employee_id = auth.uid());

-- ── transactions (worker reads own; staff read all; writes via Edge Fn) ──
create policy transactions_select on public.transactions
  for select using (employee_id = auth.uid() or public.is_staff());

-- ── invitations (staff manage) ──
create policy invitations_all_staff on public.invitations
  for all using (public.is_staff()) with check (public.is_staff());

-- ── activity_blocks ──
create policy activity_blocks_select on public.activity_blocks
  for select using (employee_id = auth.uid() or public.is_staff());
create policy activity_blocks_insert_self on public.activity_blocks
  for insert with check (employee_id = auth.uid());

-- ── activity_suspicions ──
create policy activity_suspicions_select on public.activity_suspicions
  for select using (employee_id = auth.uid() or public.is_staff());
create policy activity_suspicions_insert_self on public.activity_suspicions
  for insert with check (employee_id = auth.uid());

-- =============================================================================
-- REALTIME (postgres_changes subscriptions in the app)
-- =============================================================================
alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.work_sessions;

-- =============================================================================
-- FIRST ADMIN (bootstrap)
-- =============================================================================
-- The app is invite-only and the new project has no admin yet. After you sign
-- up / create your own account, promote it once by running (replace the email):
--
--   update public.profiles set role = 'admin', full_name = 'Your Name'
--   where email = 'you@example.com';
-- =============================================================================
