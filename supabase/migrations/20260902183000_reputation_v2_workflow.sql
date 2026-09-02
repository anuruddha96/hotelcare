alter table public.google_business_locations
  add column if not exists reply_tone text not null default 'warm_professional',
  add column if not exists reply_language_mode text not null default 'match_guest',
  add column if not exists auto_reply_enabled boolean not null default false,
  add column if not exists auto_reply_delay_minutes integer not null default 15,
  add column if not exists require_approval_below_rating integer not null default 4,
  add column if not exists reply_signature text,
  add column if not exists brand_context text;

alter table public.google_reviews
  add column if not exists ai_summary text,
  add column if not exists ai_risk_level text,
  add column if not exists ai_confidence numeric(4,3),
  add column if not exists draft_edited_at timestamptz,
  add column if not exists draft_edited_by uuid references public.profiles(id) on delete set null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'google_business_locations_reply_tone_check') then
    alter table public.google_business_locations add constraint google_business_locations_reply_tone_check
      check (reply_tone in ('warm_professional','friendly_concise','formal','luxury_hospitality'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'google_business_locations_reply_language_mode_check') then
    alter table public.google_business_locations add constraint google_business_locations_reply_language_mode_check
      check (reply_language_mode in ('match_guest','english','hungarian'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'google_business_locations_auto_reply_delay_check') then
    alter table public.google_business_locations add constraint google_business_locations_auto_reply_delay_check
      check (auto_reply_delay_minutes between 0 and 1440);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'google_business_locations_approval_rating_check') then
    alter table public.google_business_locations add constraint google_business_locations_approval_rating_check
      check (require_approval_below_rating between 1 and 5);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'google_reviews_ai_risk_level_check') then
    alter table public.google_reviews add constraint google_reviews_ai_risk_level_check
      check (ai_risk_level is null or ai_risk_level in ('low','medium','high'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'google_reviews_ai_confidence_check') then
    alter table public.google_reviews add constraint google_reviews_ai_confidence_check
      check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1));
  end if;
end $$;

create table if not exists public.google_review_reply_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  hotel_id text,
  google_location_id uuid references public.google_business_locations(id) on delete cascade,
  review_id uuid not null references public.google_reviews(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('draft_generated','draft_edited','approved','published','auto_published','publish_failed','sync_detected_reply')),
  reply_text text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists google_review_reply_events_review_idx on public.google_review_reply_events(review_id, created_at desc);
create index if not exists google_review_reply_events_org_idx on public.google_review_reply_events(organization_id, created_at desc);

alter table public.google_review_reply_events enable row level security;
revoke all on public.google_review_reply_events from anon, authenticated;

comment on table public.google_review_reply_events is 'Server-only audit trail for Google review reply drafting, editing, approvals and publishing.';
