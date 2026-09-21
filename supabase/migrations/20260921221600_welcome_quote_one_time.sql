-- Curated welcome quotes are separate from motivational_quotes: the latter is fed by
-- an unreviewed AI refresh job and must never be used for attributed welcome text.
-- Stable quote keys are never recycled: impressions survive role and hotel changes.
create table if not exists public.welcome_quote_catalog (
  quote_key text primary key,
  quote_text text not null check (char_length(quote_text) between 12 and 240),
  author text not null check (char_length(trim(author)) > 2),
  source_url text not null check (source_url ~ '^https://'),
  practical_takeaway text not null,
  audiences text[] not null check (cardinality(audiences) > 0),
  tone text not null default 'motivational' check (tone in ('motivational', 'practical', 'humorous')),
  quality_rank smallint not null default 3 check (quality_rank between 1 and 5),
  verified_at timestamptz not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists welcome_quote_catalog_unique_wording on public.welcome_quote_catalog (lower(btrim(quote_text)));
create index if not exists welcome_quote_catalog_active_idx on public.welcome_quote_catalog (is_active) where is_active;

create table if not exists public.welcome_quote_impressions (
  user_id uuid not null references auth.users(id) on delete cascade,
  quote_key text not null references public.welcome_quote_catalog(quote_key) on delete restrict,
  shown_at timestamptz not null default now(),
  primary key (user_id, quote_key)
);
create index if not exists welcome_quote_impressions_user_idx on public.welcome_quote_impressions(user_id);

-- There are no client write permissions to either table, and no broad read of
-- other employees' impression history. Only the narrowly scoped RPC can claim.
alter table public.welcome_quote_catalog enable row level security;
alter table public.welcome_quote_impressions enable row level security;
revoke all on public.welcome_quote_catalog from public, anon, authenticated;
revoke all on public.welcome_quote_impressions from public, anon, authenticated;

-- Every quotation below is transcribed from the linked source. HotelCare's
-- practical takeaway is authored separately and is never displayed as a quote.
-- 'hospitality' marks genuinely cross-functional thoughts, not a random pool.
insert into public.welcome_quote_catalog
(quote_key, quote_text, author, source_url, practical_takeaway, audiences, tone, quality_rank, verified_at)
values
('clear-habits', 'Habits are the compound interest of self-improvement.', 'James Clear', 'https://jamesclear.com/quote/atomic-habits', 'A careful habit each day adds up.', array['hospitality'], 'motivational', 5, now()),
('clear-systems', 'Goals are good for setting a direction, but systems are best for making progress.', 'James Clear', 'https://jamesclear.com/quote/atomic-habits', 'Improve a repeatable process, not only its target.', array['housekeeping_leadership','reception_leadership','maintenance_leadership','marketing_leadership','finance_leadership','hotel_management','executive','admin','supervisor'], 'practical', 5, now()),
('franklin-prevention', 'An ounce of prevention is worth a pound of cure.', 'Benjamin Franklin', 'https://ushistory.org/franklin/philadelphia/fire.htm', 'Flag a small defect before a guest notices it.', array['housekeeping','housekeeping_leadership','maintenance','maintenance_leadership','breakfast','admin','supervisor'], 'practical', 5, now()),
('meyer-hospitality', 'Hospitality exists when you believe the other person is on your side.', 'Danny Meyer', 'https://www.kqed.org/bayareabites/431/danny-meyer-at-the-commonwealth-club', 'Help the guest feel supported.', array['reception','reception_leadership','breakfast','hotel_management','executive','marketing','marketing_leadership','hospitality'], 'motivational', 5, now()),
('drucker-time', 'Time is the scarcest resource. Unless it is managed, nothing else can be managed.', 'Peter Drucker', 'https://drucker.institute/quote-library/', 'Choose your highest-impact task first.', array['maintenance','maintenance_leadership','finance','finance_leadership','hotel_management','executive','admin','supervisor'], 'practical', 4, now()),
('marriott-colleagues', 'Take care of associates and they''ll take care of your customers.', 'J. Willard Marriott', 'https://www.marriott.com/culture-and-values/j-willard-marriott.mi', 'Helping colleagues helps guests.', array['hospitality','housekeeping_leadership','reception_leadership','maintenance_leadership','marketing_leadership','finance_leadership','hr','hotel_management','executive','supervisor'], 'motivational', 5, now()),
('covey-listen', 'Seek first to understand, then to be understood.', 'Stephen R. Covey', 'https://www.franklincovey.com/courses/the-7-habits/habit-5/', 'Listen carefully before responding.', array['hospitality','reception','reception_leadership','hr','hotel_management','executive','supervisor'], 'practical', 5, now()),
('allen-notes', 'Your mind is for having ideas, not holding them.', 'David Allen', 'https://gettingthingsdone.com/about/', 'Record the details the next shift needs.', array['hospitality','housekeeping','reception','maintenance','finance','hr','admin','supervisor'], 'practical', 5, now()),
('godin-culture', 'People like us do things like this.', 'Seth Godin', 'https://seths.blog/2013/07/people-like-us-do-stuff-like-this/', 'Set the standard with your daily actions.', array['housekeeping','housekeeping_leadership','marketing','marketing_leadership','hr','hotel_management','executive','supervisor'], 'motivational', 4, now()),
('clear-trajectory', 'You should be far more concerned with your current trajectory than with your current results.', 'James Clear', 'https://jamesclear.com/quotes/you-should-be-far-more-concerned-with-your-current-trajectory-than-with-your-current-results', 'Look at the direction of improvement.', array['housekeeping_leadership','maintenance_leadership','finance','finance_leadership','marketing','marketing_leadership','hotel_management','executive','supervisor'], 'motivational', 4, now()),
('clear-learning', 'The surest way to prevent yourself from learning a topic is to believe you already know it.', 'James Clear', 'https://jamesclear.com/3-2-1/november-14-2019', 'Stay curious about new ways to work.', array['hospitality','housekeeping','maintenance','maintenance_leadership','admin','hr','supervisor'], 'motivational', 4, now()),
('clear-identity', 'Every action you take is a vote for the type of person you wish to become.', 'James Clear', 'https://jamesclear.com/identity-votes', 'One careful task at a time builds your craft.', array['housekeeping','breakfast','maintenance','marketing','hr','supervisor','hospitality'], 'motivational', 4, now()),
('covey-decisions', 'I am not a product of my circumstances. I am a product of my decisions.', 'Stephen R. Covey', 'https://mp.franklincovey.com/habit-1/', 'Own the next action you can control.', array['housekeeping','reception','maintenance','breakfast','marketing','finance','admin','hospitality'], 'motivational', 4, now()),
('covey-leadership', 'Leadership is communicating to people their worth and potential so clearly, that they see it in themselves.', 'Stephen R. Covey', 'https://www.franklincovey.com/books/the-7-habits-of-highly-effective-people/', 'Help colleagues see what they do well.', array['housekeeping_leadership','reception_leadership','maintenance_leadership','marketing_leadership','finance_leadership','hr','hotel_management','executive','supervisor'], 'motivational', 5, now()),
('sinek-care', 'Leadership is not about being in charge; it’s about taking care of those in your charge.', 'Simon Sinek', 'https://simonsinek.com/business/keynotes/leaders-eat-last', 'Lead by supporting the people doing the work.', array['housekeeping_leadership','reception_leadership','maintenance_leadership','marketing_leadership','finance_leadership','hr','hotel_management','executive','supervisor'], 'motivational', 5, now()),
('drucker-management-humor', 'So much of what we call management consists of making it difficult for people to work.', 'Peter Drucker', 'https://drucker.institute/quote-library/', 'Remove unnecessary steps from the shift.', array['housekeeping_leadership','reception_leadership','maintenance_leadership','marketing_leadership','finance_leadership','hotel_management','executive','admin','supervisor'], 'humorous', 4, now()),
('drucker-execution', 'Strategy is a commodity. Execution is an art.', 'Peter Drucker', 'https://drucker.institute/quote-library/', 'Turn the plan into an action.', array['marketing','marketing_leadership','finance_leadership','hotel_management','executive','admin'], 'motivational', 4, now())
on conflict (quote_key) do update set
  quote_text = excluded.quote_text,
  author = excluded.author,
  source_url = excluded.source_url,
  practical_takeaway = excluded.practical_takeaway,
  audiences = excluded.audiences,
  tone = excluded.tone,
  quality_rank = excluded.quality_rank,
  verified_at = excluded.verified_at,
  is_active = true;

-- This function is the only path for assigning quotes to employees. It derives
-- the role from the authenticated profile; the caller cannot impersonate a role
-- or specify another user. Advisory locking prevents concurrent requests from
-- ever claiming the same quote twice for one user (including two devices).
create or replace function public.claim_welcome_quote(p_seen_keys text[] default '{}'::text[])
returns table (quote_key text, quote_text text, author text)
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_role text;
  v_audience text;
  v_key text;
  v_text text;
  v_author text;
begin
  if v_user is null then
    return;
  end if;

  select p.role::text into v_role
  from public.profiles p
  where p.id = v_user and p.deleted_at is null;
  if not found then
    return;
  end if;

  v_audience := case v_role
    when 'housekeeping' then 'housekeeping'
    when 'housekeeping_manager' then 'housekeeping_leadership'
    when 'reception' then 'reception'
    when 'front_office' then 'reception'
    when 'reception_manager' then 'reception_leadership'
    when 'maintenance' then 'maintenance'
    when 'maintenance_manager' then 'maintenance_leadership'
    when 'breakfast_staff' then 'breakfast'
    when 'marketing' then 'marketing'
    when 'marketing_manager' then 'marketing_leadership'
    when 'control_finance' then 'finance'
    when 'control_manager' then 'finance_leadership'
    when 'finance_manager' then 'finance_leadership'
    when 'hr' then 'hr'
    when 'manager' then 'hotel_management'
    when 'back_office_manager' then 'hotel_management'
    when 'top_management' then 'executive'
    when 'top_management_manager' then 'executive'
    when 'admin' then 'admin'
    when 'supervisor' then 'supervisor'
    else 'hospitality'
  end;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 19091221));

  -- Import previously seen local-browser keys from older HotelCare releases.
  -- Limit import size and only recognize keys that exist in the curated list.
  insert into public.welcome_quote_impressions(user_id, quote_key)
  select v_user, q.quote_key
  from public.welcome_quote_catalog q
  where q.quote_key = any(coalesce(p_seen_keys[1:500], '{}'::text[]))
  on conflict do nothing;

  select q.quote_key, q.quote_text, q.author
    into v_key, v_text, v_author
  from public.welcome_quote_catalog q
  where q.is_active
    and (v_audience = any(q.audiences) or 'hospitality' = any(q.audiences))
    and not exists (
      select 1 from public.welcome_quote_impressions s
      where s.user_id = v_user and s.quote_key = q.quote_key
    )
  order by q.quality_rank desc, md5(q.quote_key || v_user::text)
  limit 1;

  if v_key is null then
    return; -- No repeat, even when the catalogue is exhausted.
  end if;

  insert into public.welcome_quote_impressions(user_id, quote_key) values (v_user, v_key);
  return query select v_key, v_text, v_author;
end;
$$;
revoke all on function public.claim_welcome_quote(text[]) from public, anon;
grant execute on function public.claim_welcome_quote(text[]) to authenticated;
comment on function public.claim_welcome_quote(text[]) is 'Atomically serve at most one unseen curated quote for the signed-in user; never repeat across roles, hotels, devices or sessions.';
