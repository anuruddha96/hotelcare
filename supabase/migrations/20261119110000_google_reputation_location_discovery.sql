-- Google Reputation: automatic discovery of newly accessible Business Profile
-- listings.
--
-- Listings added to (or shared with) the connected Google account after the
-- first setup were never imported unless a manager re-ran "Discover / refresh
-- locations" by hand, so their reviews were never synced or answered.
-- google-reputation-worker now checks each connection every six hours and
-- stamps the attempt here. New listings are inserted with the existing safe
-- defaults (reply_mode draft_only, auto_reply_enabled false).

alter table public.google_business_connections
  add column if not exists location_discovery_checked_at timestamptz;

comment on column public.google_business_connections.location_discovery_checked_at is
  'Last time google-reputation-worker checked this connection for newly accessible Google Business Profile listings.';
