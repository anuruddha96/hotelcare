-- Throwaway local database for mira_v2_e2e.ts: the production columns of the
-- tables Mira touches (no production data), the Mira v2 migration applied on
-- top, and fictitious people and rooms. Never run against a real project.
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN CREATE ROLE authenticator LOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT service_role TO authenticator;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table public.profiles (id uuid primary key, email text, full_name text, role text, created_at timestamptz default now(), updated_at timestamptz default now(), last_login timestamptz default now(), assigned_hotel text, nickname text, profile_picture_url text, phone_number text, preferred_language text default 'en', organization_slug text, hotel_id text, is_super_admin boolean default false, acts_as_housekeeper boolean default false, deleted_at timestamptz, deleted_by uuid, ui_preferences jsonb default '{}', job_title text, access_role text);
CREATE FUNCTION public.pi_user_hotel() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.pi_user_org() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT organization_slug FROM public.profiles WHERE id = auth.uid() $$;

create table public.organizations (id uuid primary key default gen_random_uuid(), name text, slug text, settings jsonb default '{}', subscription_tier text default 'basic', is_active boolean default true, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.hotel_configurations (id uuid primary key default gen_random_uuid(), hotel_id text, hotel_name text, organization_id uuid, settings jsonb default '{}', is_active boolean default true, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.rooms (id uuid primary key default gen_random_uuid(), hotel text, room_number text, room_type text default 'standard', floor_number integer, status text default 'clean', last_cleaned_at timestamptz, last_cleaned_by uuid, notes text, created_at timestamptz default now(), updated_at timestamptz default now(), room_name text, bed_type text, checkout_time timestamptz, is_checkout_room boolean default false, guest_count integer default 0, is_dnd boolean default false, dnd_marked_at timestamptz, dnd_marked_by uuid, guest_nights_stayed integer default 0, towel_change_required boolean default false, linen_change_required boolean default false, organization_slug text, pms_metadata jsonb);
create table public.room_assignments (id uuid primary key default gen_random_uuid(), room_id uuid, assigned_to uuid, assigned_by uuid, assignment_date date default CURRENT_DATE, assignment_type text, status text, priority integer default 1, estimated_duration integer, notes text, completed_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(), started_at timestamptz, supervisor_approved boolean default false, supervisor_approved_by uuid, supervisor_approved_at timestamptz, ready_to_clean boolean default false, is_dnd boolean default false, dnd_marked_at timestamptz, dnd_marked_by uuid, completion_photos text[] default '{}', break_periods jsonb default '[]', total_break_time_minutes integer default 0, organization_slug text, manager_instruction_text text, service_result text, supervisor_review_outcome text, supervisor_reviewed_by uuid, supervisor_reviewed_at timestamptz);
create table public.tickets (id uuid primary key default gen_random_uuid(), ticket_number text, title text, description text, room_number text, priority text, status text, created_by uuid, assigned_to uuid, created_at timestamptz default now(), updated_at timestamptz default now(), closed_at timestamptz, hotel text, category text, sla_due_date timestamptz, department text, organization_slug text, on_hold boolean default false, hold_reason text, pending_supervisor_approval boolean default false);
create table public.housekeeping_notes (id uuid primary key default gen_random_uuid(), room_id uuid, assignment_id uuid, note_type text default 'general', content text, created_by uuid, is_resolved boolean default false, created_at timestamptz default now(), organization_slug text);
create table public.staff_attendance (id uuid primary key default gen_random_uuid(), user_id uuid, check_in_time timestamptz default now(), check_out_time timestamptz, work_date date default CURRENT_DATE, status text, organization_slug text);
create table public.assistant_threads (id uuid primary key default gen_random_uuid(), user_id uuid, organization_slug text default public.pi_user_org(), hotel_id text default public.pi_user_hotel(), title text default 'New chat', created_at timestamptz default now(), updated_at timestamptz default now(), title_locked boolean default false, pinned_at timestamptz, project_id uuid, last_read_at timestamptz default now(), last_reply_at timestamptz, follow_up_status text default 'none');
create table public.assistant_messages (id uuid primary key default gen_random_uuid(), thread_id uuid references public.assistant_threads(id) on delete cascade, user_id uuid, role text, content text default '', model text, scopes_used text[] default '{}', refused boolean default false, created_at timestamptz default now(), attachments jsonb default '[]');
create table public.assistant_audit_log (id uuid primary key default gen_random_uuid(), user_id uuid, organization_slug text, hotel_id text, role text, question text default '', refused boolean default false, scopes_used text[] default '{}', model text, created_at timestamptz default now(), thread_id uuid, input_tokens integer, output_tokens integer, duration_ms integer, workflow text);
create table public.assistant_monthly_message_usage (user_id uuid references auth.users(id), message_id text, month_start date, organization_slug text, input_tokens integer default 0, output_tokens integer default 0, estimated_cost_usd numeric default 0, created_at timestamptz default now(), primary key (user_id, message_id));
create table public.assistant_unlimited_users (user_id uuid primary key, enabled boolean default true, reason text, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.assistant_usage_alert_events (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id), organization_slug text, month_start date not null, alert_type text not null
  constraint assistant_usage_alert_events_alert_type_check check (alert_type = any (array['quota_reached','quota_blocked','high_tokens','monthly_tokens'])),
  message text, emailed_at timestamptz, created_at timestamptz default now(), unique (user_id, month_start, alert_type));
create table public.assistant_projects (id uuid primary key default gen_random_uuid(), user_id uuid, organization_slug text, name text, instructions text default '', created_at timestamptz default now(), updated_at timestamptz default now());
create table public.assistant_issue_reports (id uuid primary key default gen_random_uuid(), user_id uuid, organization_slug text, hotel_id text, thread_id uuid, category text default 'other', severity text default 'normal', title text, user_description text, ai_summary text, current_route text, module text, tab text, entity_type text, entity_id text, device text, app_language text, status text default 'new', admin_notes text, resolved_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.ai_usage_log (id uuid primary key default gen_random_uuid(), organization_slug text, hotel_id text, function_name text, model text, input_tokens integer default 0, output_tokens integer default 0, web_searches integer default 0, estimated_cost_usd numeric default 0, ok boolean default true, error text, created_at timestamptz default now());
create table public.email_settings (organization_slug text, from_name text default 'Hotel Care', from_email text default 'onboarding@resend.dev', reply_to text, transactional_enabled boolean default true, digest_enabled boolean default true);

-- The Mira v2 migration on top (path passed by the runner).
\i :migration

-- A known worker secret for the daily report (production keeps it in Vault).
CREATE OR REPLACE FUNCTION public.mira_usage_worker_secret() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT 'local-e2e-worker-secret-0123456789abcdef'::text $$;

GRANT USAGE ON SCHEMA public, auth TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- ------------------------------------------------------------------ people
INSERT INTO auth.users (id) VALUES
  ('a0000000-0000-0000-0000-000000000001'), ('a0000000-0000-0000-0000-000000000002'),
  ('a0000000-0000-0000-0000-000000000003'), ('a0000000-0000-0000-0000-000000000004'),
  ('a0000000-0000-0000-0000-000000000005'), ('a0000000-0000-0000-0000-000000000006'),
  ('a0000000-0000-0000-0000-000000000007'), ('a0000000-0000-0000-0000-000000000008');
INSERT INTO public.organizations (id, name, slug) VALUES ('287a9a1d-543c-4c5a-a890-798c23006aab', 'RD Hotels', 'rdhotels');
INSERT INTO public.hotel_configurations (hotel_id, hotel_name, organization_id) VALUES
  ('memories-budapest', 'Hotel Memories Budapest', '287a9a1d-543c-4c5a-a890-798c23006aab'),
  ('gozsdu-court', 'Gozsdu Court', '287a9a1d-543c-4c5a-a890-798c23006aab');
INSERT INTO public.profiles (id, email, full_name, nickname, role, access_role, organization_slug, assigned_hotel) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'manager@example.test', 'Petra Manager', 'petra_01', 'manager', 'manager', 'rdhotels', 'memories-budapest'),
  ('a0000000-0000-0000-0000-000000000002', 'reception@example.test', 'Rita Reception', 'rita_02', 'reception', NULL, 'rdhotels', 'memories-budapest'),
  ('a0000000-0000-0000-0000-000000000003', 'housekeeper@example.test', 'Hanna Housekeeper', 'hanna_03', 'housekeeping', NULL, 'rdhotels', 'memories-budapest'),
  ('a0000000-0000-0000-0000-000000000004', 'cleaner@example.test', 'Sofia', 'Sofia_101', 'housekeeping', NULL, 'rdhotels', 'memories-budapest'),
  ('a0000000-0000-0000-0000-000000000005', 'hkmanager@example.test', 'Eszter Kovács', 'Eszter_0005', 'manager', 'housekeeping_manager', 'rdhotels', 'memories-budapest'),
  ('a0000000-0000-0000-0000-000000000006', 'supervisor@example.test', 'Bea', 'Bea_007', 'manager', 'housekeeping_supervisor', 'rdhotels', 'memories-budapest'),
  ('a0000000-0000-0000-0000-000000000007', 'owner.admin@e2e-hotel.com', 'Owner Admin', 'admin_07', 'admin', NULL, 'rdhotels', 'memories-budapest'),
  ('a0000000-0000-0000-0000-000000000008', 'busy@example.test', 'Busy Receptionist', 'busy_08', 'reception', NULL, 'rdhotels', 'memories-budapest');

-- ------------------------------------------------------------------ rooms
INSERT INTO public.rooms (id, hotel, room_number, floor_number, status, organization_slug) VALUES
  ('b0000000-0000-0000-0000-000000000038', 'Hotel Memories Budapest', '038', 0, 'clean', 'rdhotels'),
  ('b0000000-0000-0000-0000-000000000101', 'Hotel Memories Budapest', '101', 1, 'dirty', 'rdhotels'),
  ('b1000000-0000-0000-0000-000000000038', 'Gozsdu Court', '038', 0, 'clean', 'rdhotels');

-- Room 038 on Monday 16 November: cleaned by Sofia, ASSIGNED by Eszter (the
-- housekeeping manager), APPROVED by Bea (the supervisor) at 10:58 Budapest.
INSERT INTO public.room_assignments (room_id, assigned_to, assigned_by, assignment_date, assignment_type, status, started_at, completed_at,
  supervisor_approved, supervisor_approved_by, supervisor_approved_at, organization_slug) VALUES
  ('b0000000-0000-0000-0000-000000000038', 'a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000005', '2026-11-16', 'daily_cleaning', 'completed',
   '2026-11-16T09:15:36Z', '2026-11-16T09:47:48Z', true, 'a0000000-0000-0000-0000-000000000006', '2026-11-16T09:58:49Z', 'rdhotels'),
  ('b0000000-0000-0000-0000-000000000038', 'a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000005', '2026-11-13', 'daily_cleaning', 'completed',
   '2026-11-13T13:14:11Z', '2026-11-13T13:40:59Z', true, 'a0000000-0000-0000-0000-000000000005', '2026-11-13T13:46:23Z', 'rdhotels'),
  ('b1000000-0000-0000-0000-000000000038', 'a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000005', '2026-11-16', 'checkout_cleaning', 'completed',
   '2026-11-16T11:00:00Z', '2026-11-16T11:40:00Z', true, 'a0000000-0000-0000-0000-000000000005', '2026-11-16T12:00:00Z', 'rdhotels');

-- ------------------------------------------------------------------ usage
-- The manager already sent 25 messages this month (the old limit was 20).
INSERT INTO public.assistant_monthly_message_usage (user_id, message_id, month_start, organization_slug, created_at, estimated_cost_usd)
SELECT 'a0000000-0000-0000-0000-000000000001', 'seed-mgr-' || g, date_trunc('month', now() AT TIME ZONE 'Europe/Budapest')::date, 'rdhotels',
       now() - interval '30 hours' - (g || ' minutes')::interval, 0.01
FROM generate_series(1, 25) g;
-- The busy receptionist sent 60 messages in the last 24 hours (daily limit).
INSERT INTO public.assistant_monthly_message_usage (user_id, message_id, month_start, organization_slug, created_at)
SELECT 'a0000000-0000-0000-0000-000000000008', 'seed-busy-' || g, date_trunc('month', now() AT TIME ZONE 'Europe/Budapest')::date, 'rdhotels',
       now() - (g || ' minutes')::interval
FROM generate_series(1, 60) g;
