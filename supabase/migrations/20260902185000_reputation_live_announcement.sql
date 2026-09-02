alter table public.system_announcements
  add column if not exists dedupe_key text;

create unique index if not exists system_announcements_dedupe_key_uidx
  on public.system_announcements (dedupe_key);

create or replace function public.publish_reputation_live_announcement(target_org_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  org_slug text;
  announcement_id uuid;
begin
  select slug into org_slug
  from public.organizations
  where id = target_org_id;

  if org_slug is null then
    return null;
  end if;

  insert into public.system_announcements (
    title,
    body,
    tone,
    target_org_slugs,
    target_roles,
    starts_at,
    ends_at,
    published,
    pinned,
    created_by,
    dedupe_key
  ) values (
    'Reputation is now connected to Google',
    'HotelCare has successfully accessed live Google Business Profile reviews. The Reputation module can now sync reviews and prepare AI-assisted replies. Automatic publishing remains controlled by the rules saved for each location; lower-rated and high-risk reviews stay in the manager approval flow.',
    'info',
    array[org_slug],
    array['admin', 'manager', 'top_management', 'top_management_manager'],
    now(),
    null,
    true,
    true,
    null,
    'reputation-google-api-live:' || target_org_id::text
  )
  on conflict (dedupe_key) do nothing
  returning id into announcement_id;

  if announcement_id is null then
    select id into announcement_id
    from public.system_announcements
    where dedupe_key = 'reputation-google-api-live:' || target_org_id::text
    limit 1;
  end if;

  return announcement_id;
end;
$$;

revoke all on function public.publish_reputation_live_announcement(uuid) from public, anon, authenticated;
grant execute on function public.publish_reputation_live_announcement(uuid) to service_role;

create or replace function public.notify_reputation_live_on_first_google_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.publish_reputation_live_announcement(new.organization_id);
  return new;
end;
$$;

revoke all on function public.notify_reputation_live_on_first_google_review() from public, anon, authenticated;

drop trigger if exists trg_google_review_reputation_live_announcement on public.google_reviews;
create trigger trg_google_review_reputation_live_announcement
after insert on public.google_reviews
for each row
execute function public.notify_reputation_live_on_first_google_review();

comment on column public.system_announcements.dedupe_key is
  'Optional stable event key used by server-side announcement producers to prevent duplicate notices.';
comment on function public.publish_reputation_live_announcement(uuid) is
  'Publishes the one-time HotelCare Reputation launch notice after live Google review access is confirmed.';
