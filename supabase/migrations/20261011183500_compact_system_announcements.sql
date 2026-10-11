-- Support short announcement banners with an optional details view.
-- Existing announcements continue to display their full message by default.
alter table public.system_announcements
  add column if not exists compact boolean not null default false;
