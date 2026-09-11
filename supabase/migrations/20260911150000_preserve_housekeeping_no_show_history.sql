-- Preserve no-show as an "ever happened on this business date" flag.
-- The room/PMS metadata may change after the reservation state changes, but the
-- historical housekeeping board must continue to show that a no-show occurred.

alter table public.housekeeping_room_snapshots
  add column if not exists had_no_show boolean not null default false;

create or replace function public.trg_preserve_housekeeping_snapshot_no_show()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meta jsonb := coalesce(new.pms_metadata, '{}'::jsonb);
  v_status text := lower(trim(coalesce(
    v_meta ->> 'reservationStatus',
    v_meta ->> 'reservation_status',
    v_meta ->> 'pmsStatus',
    v_meta ->> 'pms_status',
    v_meta ->> 'bookingStatus',
    v_meta ->> 'booking_status',
    v_meta ->> 'guestStatus',
    v_meta ->> 'guest_status',
    v_meta ->> 'status',
    v_meta #>> '{reservation,status}',
    v_meta #>> '{reservation,state}',
    ''
  )));
  v_detected boolean := false;
begin
  v_detected :=
    lower(coalesce(v_meta ->> 'isNoShow', 'false')) = 'true'
    or lower(coalesce(v_meta ->> 'noShow', 'false')) = 'true'
    or lower(coalesce(v_meta ->> 'no_show', 'false')) = 'true'
    or lower(coalesce(v_meta ->> 'guestNoShow', 'false')) = 'true'
    or lower(coalesce(v_meta ->> 'reservationNoShow', 'false')) = 'true'
    or v_status in ('no_show', 'no-show', 'noshow', 'no show')
    or lower(coalesce(new.room_notes, '')) like '%no show%'
    or lower(coalesce(new.room_notes, '')) like '%no-show%';

  if tg_op = 'UPDATE' then
    new.had_no_show := coalesce(old.had_no_show, false)
      or coalesce(new.had_no_show, false)
      or v_detected;
  else
    new.had_no_show := coalesce(new.had_no_show, false) or v_detected;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_preserve_housekeeping_snapshot_no_show
  on public.housekeeping_room_snapshots;

create trigger trg_preserve_housekeeping_snapshot_no_show
before insert or update on public.housekeeping_room_snapshots
for each row execute function public.trg_preserve_housekeeping_snapshot_no_show();

-- Backfill no-show evidence already present in immutable historical snapshots.
update public.housekeeping_room_snapshots s
set had_no_show = true,
    updated_at = greatest(coalesce(s.updated_at, now()), now())
where not coalesce(s.had_no_show, false)
  and (
    lower(coalesce(s.pms_metadata ->> 'isNoShow', 'false')) = 'true'
    or lower(coalesce(s.pms_metadata ->> 'noShow', 'false')) = 'true'
    or lower(coalesce(s.pms_metadata ->> 'no_show', 'false')) = 'true'
    or lower(coalesce(s.pms_metadata ->> 'guestNoShow', 'false')) = 'true'
    or lower(coalesce(s.pms_metadata ->> 'reservationNoShow', 'false')) = 'true'
    or lower(trim(coalesce(
      s.pms_metadata ->> 'reservationStatus',
      s.pms_metadata ->> 'reservation_status',
      s.pms_metadata ->> 'pmsStatus',
      s.pms_metadata ->> 'pms_status',
      s.pms_metadata ->> 'bookingStatus',
      s.pms_metadata ->> 'booking_status',
      s.pms_metadata ->> 'guestStatus',
      s.pms_metadata ->> 'guest_status',
      s.pms_metadata ->> 'status',
      s.pms_metadata #>> '{reservation,status}',
      s.pms_metadata #>> '{reservation,state}',
      ''
    ))) in ('no_show', 'no-show', 'noshow', 'no show')
    or lower(coalesce(s.room_notes, '')) like '%no show%'
    or lower(coalesce(s.room_notes, '')) like '%no-show%'
  );

revoke all on function public.trg_preserve_housekeeping_snapshot_no_show() from public, anon, authenticated;
