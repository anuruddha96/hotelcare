alter table public.google_business_locations
  add column if not exists google_account_name text;

create index if not exists google_business_locations_account_idx
  on public.google_business_locations(google_account_name);
