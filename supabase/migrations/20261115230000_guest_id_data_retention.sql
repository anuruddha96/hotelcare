-- Guest ID data retention (Hungarian VIZA rule + GDPR storage limitation).
--
-- Why: the accommodation may keep the guest identification data it records
-- for VIZA only until the last day of the first year after the stay
-- (2016. évi CLVI. tv. 9/H. §). HotelCare stored these fields on guests with
-- no end date. This erases them automatically once that day has passed.
--
-- What is erased: document type and number, date and place of birth, sex,
-- mother's name, visa number and the document-reader snapshot.
-- What stays: name, contact and billing details, nationality, and every
-- reservation, folio and invoice (accounting records with their own
-- retention). Passport images are never stored in the first place.
--
-- The deadline counts from the guest's latest departure across all their
-- non-cancelled reservations; a guest with no stay counts from the last time
-- their record was touched. A guest with a current or future booking is
-- therefore never erased.

alter table public.guests
  add column if not exists id_data_erased_at timestamptz;

comment on column public.guests.id_data_erased_at is
  'When the VIZA identification fields were erased by guest_id_data_purge() (retention: 31 December of the year after the last stay).';

create table if not exists public.guest_id_data_purge_log (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  as_of date not null,
  guests_erased integer not null
);

alter table public.guest_id_data_purge_log enable row level security;
-- No policies: readable by service role / database owner only.
revoke all on public.guest_id_data_purge_log from public, anon, authenticated;

create or replace function public.guest_id_data_purge(p_today date default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := coalesce(p_today, (now() at time zone 'Europe/Budapest')::date);
  v_count integer := 0;
begin
  with last_stay as (
    select
      g.id,
      coalesce(
        (select max(greatest(r.check_out_date, coalesce((r.actual_check_out at time zone 'Europe/Budapest')::date, r.check_out_date)))
           from public.reservations r
          where r.guest_id = g.id
            and r.status <> 'cancelled'),
        (greatest(g.created_at, g.updated_at) at time zone 'Europe/Budapest')::date
      ) as ref_date
    from public.guests g
    where g.id_document_type is not null
       or g.id_document_number is not null
       or g.date_of_birth is not null
       or g.birth_place is not null
       or g.gender is not null
       or g.mother_name is not null
       or g.visa_number is not null
       or g.document_scan is not null
  ),
  erased as (
    update public.guests g
       set id_document_type = null,
           id_document_number = null,
           date_of_birth = null,
           birth_place = null,
           gender = null,
           mother_name = null,
           visa_number = null,
           document_scan = null,
           id_data_erased_at = now()
      from last_stay s
     where s.id = g.id
       -- Past 31 December of the year after the last stay.
       and v_today > make_date(extract(year from s.ref_date)::int + 1, 12, 31)
    returning g.id
  )
  select count(*) into v_count from erased;

  insert into public.guest_id_data_purge_log (as_of, guests_erased) values (v_today, v_count);
  return v_count;
end;
$$;

comment on function public.guest_id_data_purge(date) is
  'Erases VIZA identification fields from guests whose last stay ended before the previous calendar year. Runs daily; returns the number of guests erased.';

revoke all on function public.guest_id_data_purge(date) from public, anon, authenticated;

-- Daily at 03:25 UTC. Re-runnable.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'guest-id-data-purge-daily') then
      perform cron.unschedule('guest-id-data-purge-daily');
    end if;
    perform cron.schedule('guest-id-data-purge-daily', '25 3 * * *', $cron$ select public.guest_id_data_purge(); $cron$);
  end if;
end;
$$;
