create or replace function public.normalize_pms_sync_history_legacy_values()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Canonicalize legacy/current caller aliases before table CHECK constraints.
  -- This keeps observability reliable without changing the PMS write path.
  if new.sync_type = 'room_status_update' then
    new.sync_type := 'status_update';
  end if;

  if new.direction = 'push' then
    new.direction := 'to_previo';
  elsif new.direction = 'pull' then
    new.direction := 'from_previo';
  end if;

  -- An intentional skip (for example guest-declined/no-service) is a
  -- successful processing outcome; the reason remains in the data JSON.
  if new.sync_status = 'skipped' then
    new.sync_status := 'success';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalize_pms_sync_history_legacy_values on public.pms_sync_history;
create trigger trg_normalize_pms_sync_history_legacy_values
before insert or update of sync_type, direction, sync_status
on public.pms_sync_history
for each row
execute function public.normalize_pms_sync_history_legacy_values();
