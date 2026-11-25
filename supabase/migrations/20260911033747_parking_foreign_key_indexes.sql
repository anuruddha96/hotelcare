-- Cover parking foreign keys used by deletes and audit lookups. These are
-- deliberately separate from the feature migration because the Supabase
-- advisor identified them after the initial schema was installed.

create index parking_settings_updated_by_idx
  on public.parking_settings (updated_by)
  where updated_by is not null;

create index parking_batches_created_by_idx
  on public.parking_batches (created_by);

create index parking_tickets_batch_idx
  on public.parking_tickets (batch_id);

create index parking_tickets_issued_by_idx
  on public.parking_tickets (issued_by)
  where issued_by is not null;

create index parking_tickets_voided_by_idx
  on public.parking_tickets (voided_by)
  where voided_by is not null;

create index parking_tickets_cancellation_reported_by_idx
  on public.parking_tickets (cancellation_reported_by)
  where cancellation_reported_by is not null;

create index parking_tickets_updated_by_idx
  on public.parking_tickets (updated_by)
  where updated_by is not null;

create index parking_events_actor_idx
  on public.parking_ticket_events (actor_id)
  where actor_id is not null;

create index parking_access_granted_by_idx
  on public.parking_user_access (granted_by)
  where granted_by is not null;
