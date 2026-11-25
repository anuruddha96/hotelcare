-- =====================================================================
-- OTA channel economics: gross revenue, commission and net revenue per
-- stay night, by channel.
--
-- * Source-agnostic. Previo hotels read the revenue feed
--   (revenue_booking_nights, the same nights and booked rule as the
--   Revenue page). HotelCare-PMS hotels read their own reservations, with
--   the exact commission from the Channex booking revision.
-- * Read-time calculation. Nothing on the reservation sync path changes:
--   no triggers, no new columns on reservations.
-- * Commission source, best first:
--     statement      imported OTA statement / payout line (exact)
--     channex        ota_commission in the Channex booking revision (exact)
--     ota_note       Booking.com commission in the Previo note (exact)
--     terms          ota_commercial_terms for the booking date (estimate)
--     no_commission  direct and other non-OTA channels
--     none           OTA without terms yet (commission unknown)
--
-- Commercial terms below were read in the extranets on 2026-11-18.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------

-- "1061.47", "1,061.47", "1.061,47" or "1061,47" -> numeric. Never raises.
create or replace function public.ota_parse_amount(s text)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  v text;
begin
  if s is null then
    return null;
  end if;
  v := regexp_replace(s, '[^0-9.,]', '', 'g');
  if v = '' then
    return null;
  end if;
  if strpos(v, ',') > 0 and strpos(v, '.') > 0 then
    -- whichever separator comes last is the decimal separator
    if strpos(reverse(v), ',') < strpos(reverse(v), '.') then
      v := replace(replace(v, '.', ''), ',', '.');
    else
      v := replace(v, ',', '');
    end if;
  elsif strpos(v, ',') > 0 then
    if v ~ '^[0-9]{1,3}(,[0-9]{3})+$' then
      v := replace(v, ',', '');
    else
      v := replace(v, ',', '.');
    end if;
  end if;
  if v !~ '^[0-9]+(\.[0-9]+)?$' then
    return null;
  end if;
  return v::numeric;
exception when others then
  return null;
end;
$$;

-- Previo source labels ("770\n Booking.com XML"), Channex ota_name
-- ("BookingCom", "Offline") and HotelCare sources ("website") -> channel key.
create or replace function public.ota_channel_key(p_source text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when s = '' then 'direct'
    when s ~* '^(booking\.?com|bookingcom)' then 'booking_com'
    when s ~* 'agoda' then 'agoda'
    when s ~* '(expedia|hotels\.com|vrbo)' then 'expedia'
    when s ~* 'hotelbeds' then 'hotelbeds'
    when s ~* '(edreams|odigeo)' then 'edreams'
    when s ~* '(trip\.com|ctrip)' then 'trip_com'
    when s ~* 'hoteltonight' then 'hoteltonight'
    when s ~* 'airbnb' then 'airbnb'
    when s ~* 'google' then 'google'
    when s ~* '(reservation\+|previo global|booking engine|website|^web$)' then 'direct_web'
    when s ~* '^(direct|offline|walk.?in|phone|e-?mail)' then 'direct'
    when s ~* 'reloc' then 'relocation'
    when s ~* '(no-?show|penalty)' then 'penalty'
    else 'other'
  end
  from (
    select btrim(regexp_replace(regexp_replace(regexp_replace(coalesce(p_source, ''),
             '(\\n|\s)+', ' ', 'g'),
             '^\s*[0-9]{1,6}\s+', ''),
             '\s*(V2XML|XML)\s*$', '', 'i')) as s
  ) x
$$;

-- ota: commission applies; wholesale: net-rate partner; direct/other: no commission.
create or replace function public.ota_channel_type(p_channel_key text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_channel_key in ('booking_com', 'agoda', 'expedia', 'edreams', 'trip_com', 'hoteltonight', 'airbnb') then 'ota'
    when p_channel_key in ('hotelbeds') then 'wholesale'
    when p_channel_key in ('direct', 'direct_web', 'google') then 'direct'
    else 'other'
  end
$$;

-- Booking.com block that Previo writes into reservations.special_requests:
--   Total price <span ...>72.27 EUR</span> ...
--   Partner&039;s room name <span ...>Deluxe Double - General - Breakfast included (Mobile(App) Rate (ID 0))</span>
--   ... total commission amount calculated by Booking.com (16.06 EUR) ... (Payout type Virtual credit card)
create or replace function public.ota_parse_note(p_note text)
returns table (
  note_total numeric,
  note_commission numeric,
  note_currency text,
  payout_type text,
  rate_label text,
  rate_plan_ref text,
  meal_plan text,
  ota_booked_on date
)
language sql
stable
set search_path = public
as $$
  with n as (
    select replace(replace(replace(coalesce(p_note, ''), '&lt;', '<'), '&gt;', '>'), '&amp;', '&') as t
  ),
  f as (
    select
      regexp_match(t, 'Total price\s*(?:<[^>]*>)?\s*([0-9][0-9.,]*)\s*(EUR|HUF)', 'i') as tp,
      regexp_match(t, 'commission amount calculated by Booking\.com\s*\(([0-9][0-9.,]*)\s*(EUR|HUF)\)', 'i') as cm,
      (regexp_match(t, 'Payout type\s*([^<)]{1,40})', 'i'))[1] as payout,
      btrim((regexp_match(t, 'room name\s*(?:<[^>]*>)?\s*([^<]{1,240})', 'i'))[1]) as room_name,
      (regexp_match(t, 'Meals\s*(?:<[^>]*>)?\s*([^<]{1,60})', 'i'))[1] as meals,
      (regexp_match(t, 'Created\s*(?:<[^>]*>)?\s*([0-9]{4}-[0-9]{2}-[0-9]{2})', 'i'))[1] as created
    from n
  )
  select
    public.ota_parse_amount(f.tp[1]),
    public.ota_parse_amount(f.cm[1]),
    upper(coalesce(f.cm[2], f.tp[2])),
    nullif(btrim(f.payout), ''),
    nullif(btrim((regexp_match(f.room_name, '\(([^()]*(?:\([^()]*\)[^()]*)*)\(ID\s*[0-9]+\)\)$'))[1]), ''),
    (regexp_match(f.room_name, '\(ID\s*([0-9]+)\)\)$'))[1],
    nullif(btrim(f.meals), ''),
    case when f.created ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then f.created::date end
  from f
$$;

-- ---------------------------------------------------------------------
-- 1. Commercial terms per hotel x channel x booking-date period
-- ---------------------------------------------------------------------
create table if not exists public.ota_commercial_terms (
  id                   uuid primary key default gen_random_uuid(),
  hotel_id             text not null,
  channel_key          text not null,
  listing_ref          text,                         -- OTA property id; informational
  applies_by_default   boolean not null default true, -- false: second listing (e.g. Made Inn inside Gozsdu Court)
  amount_basis         text not null check (amount_basis in ('gross', 'net')), -- what the PMS receives
  commission_pct       numeric(5,2) not null check (commission_pct >= 0 and commission_pct < 100),
  extra_commission_pct numeric(5,2) not null default 0 check (extra_commission_pct >= 0 and extra_commission_pct < 100),
  city_tax_pct         numeric(7,4) not null default 0 check (city_tax_pct >= 0 and city_tax_pct < 50), -- on top of the room price
  vat_pct              numeric(5,2),
  payment_fee_pct      numeric(5,2) not null default 0,
  valid_from           date not null,                -- compared with the BOOKING date
  valid_to             date,
  source               text not null default 'extranet' check (source in ('extranet', 'statement', 'contract', 'manual')),
  verified_at          timestamptz,
  verified_by          uuid,
  notes                text,
  created_by           uuid default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint ota_terms_period_ok check (valid_to is null or valid_to >= valid_from),
  constraint ota_terms_total_ok check (commission_pct + extra_commission_pct < 100)
);

create index if not exists ota_commercial_terms_lookup
  on public.ota_commercial_terms (hotel_id, channel_key, valid_from desc);

alter table public.ota_commercial_terms enable row level security;

drop policy if exists "Revenue users view OTA terms" on public.ota_commercial_terms;
create policy "Revenue users view OTA terms" on public.ota_commercial_terms
  for select to authenticated
  using ((public.is_revenue_user(auth.uid()) or coalesce(public.is_super_admin(auth.uid()), false))
         and public.user_can_access_hotel(auth.uid(), hotel_id));

drop policy if exists "Revenue users add OTA terms" on public.ota_commercial_terms;
create policy "Revenue users add OTA terms" on public.ota_commercial_terms
  for insert to authenticated
  with check ((public.is_revenue_user(auth.uid()) or coalesce(public.is_super_admin(auth.uid()), false))
              and public.user_can_access_hotel(auth.uid(), hotel_id));

drop policy if exists "Revenue users edit OTA terms" on public.ota_commercial_terms;
create policy "Revenue users edit OTA terms" on public.ota_commercial_terms
  for update to authenticated
  using ((public.is_revenue_user(auth.uid()) or coalesce(public.is_super_admin(auth.uid()), false))
         and public.user_can_access_hotel(auth.uid(), hotel_id))
  with check ((public.is_revenue_user(auth.uid()) or coalesce(public.is_super_admin(auth.uid()), false))
              and public.user_can_access_hotel(auth.uid(), hotel_id));

drop policy if exists "Revenue users remove OTA terms" on public.ota_commercial_terms;
create policy "Revenue users remove OTA terms" on public.ota_commercial_terms
  for delete to authenticated
  using ((public.is_revenue_user(auth.uid()) or coalesce(public.is_super_admin(auth.uid()), false))
         and public.user_can_access_hotel(auth.uid(), hotel_id));

drop trigger if exists ota_commercial_terms_updated_at on public.ota_commercial_terms;
create trigger ota_commercial_terms_updated_at
  before update on public.ota_commercial_terms
  for each row execute function public.update_updated_at_column();

-- Seed: terms as read in the extranets on 2026-11-18. Booking.com rows are a
-- fallback only; the exact commission comes from the Previo note or statement.
-- Made Inn's listings feed hotel_id 'gozsdu-court' (applies_by_default = false).
insert into public.ota_commercial_terms
  (hotel_id, channel_key, listing_ref, applies_by_default, amount_basis, commission_pct, extra_commission_pct,
   city_tax_pct, vat_pct, valid_from, valid_to, source, verified_at, notes)
select v.hotel_id, v.channel_key, v.listing_ref, v.dflt, v.basis, v.pct, v.extra, v.tax, v.vat,
       v.vfrom::date, v.vto::date, 'extranet', '2026-11-18 12:00:00+01'::timestamptz, v.notes
from (values
  -- Booking.com: 18% on bookings made from the switch date, 23% before
  ('gozsdu-court',      'booking_com', '185220',    true,  'gross', 23, 0,  3.8095, 5::numeric,  '2000-01-01', '2026-08-23', 'Before the 24 Aug 2026 switch'),
  ('gozsdu-court',      'booking_com', '185220',    true,  'gross', 18, 0,  3.8095, 5,  '2026-08-24', null,         'Preferred, Genius, Mobile rate'),
  ('gozsdu-court',      'booking_com', '272495',    false, 'gross', 23, 0,  3.8095, 5,  '2000-01-01', '2026-10-28', 'Made Inn listing'),
  ('gozsdu-court',      'booking_com', '272495',    false, 'gross', 18, 0,  3.8095, 5,  '2026-10-29', null,         'Made Inn listing'),
  ('memories-budapest', 'booking_com', '4020101',   true,  'gross', 23, 0,  3.8095, 5,  '2000-01-01', '2026-08-23', null),
  ('memories-budapest', 'booking_com', '4020101',   true,  'gross', 18, 0,  3.8095, 5,  '2026-08-24', null,         null),
  ('mika-downtown',     'booking_com', '2143082',   true,  'gross', 23, 0,  3.8095, 5,  '2000-01-01', '2026-08-23', null),
  ('mika-downtown',     'booking_com', '2143082',   true,  'gross', 18, 0,  3.8095, 5,  '2026-08-24', null,         null),
  ('ottofiori',         'booking_com', '14416321',  true,  'gross', 23, 0,  3.8095, 5,  '2000-01-01', '2026-08-24', null),
  ('ottofiori',         'booking_com', '14416321',  true,  'gross', 18, 0,  3.8095, 5,  '2026-08-25', null,         null),
  -- Agoda: base 15% + AGP. Amounts arrive net (payout + city tax): verified at Gozsdu, Ottofiori and Memories
  ('gozsdu-court',      'agoda',       '162363',    true,  'net',   15, 10, 3.8095, 5,  '2022-05-30', null,         'AGP Standard 10%; promos: Early 5%, Mobile 10%, Private Sale 10%'),
  ('gozsdu-court',      'agoda',       '243891',    false, 'net',   15, 8,  3.8095, 5,  '2023-11-09', null,         'Made Inn listing; AGP Basic 8%'),
  ('mika-downtown',     'agoda',       '4607588',   true,  'net',   15, 12, 3.8095, 5,  '2022-05-30', null,         'AGP Standard 12%'),
  ('memories-budapest', 'agoda',       '5877720',   true,  'net',   15, 0,  3.8095, 5,  '2000-01-01', null,         'No AGP; amount arrives net (payout + city tax), checked on booking 2068427205'),
  ('ottofiori',         'agoda',       '75934965',  true,  'net',   15, 0,  3.8095, 5,  '2000-01-01', null,         'No AGP; seasonal promos 10-20% + Private Sale 10%'),
  -- Expedia: 20% compensation; Expedia Collect -> the virtual card carries the net amount
  ('gozsdu-court',      'expedia',     '2932912',   true,  'net',   20, 0,  3.3898, 18, '2024-02-28', null,         'Expedia Collect'),
  ('gozsdu-court',      'expedia',     '4685703',   false, 'net',   20, 0,  3.3898, 18, '2024-02-28', null,         'Made Inn listing, Expedia Collect'),
  ('memories-budapest', 'expedia',     '30107684',  true,  'net',   20, 0,  3.3898, 18, '2024-02-28', null,         'Expedia Collect'),
  ('mika-downtown',     'expedia',     '18242625',  true,  'net',   20, 0,  3.3898, 18, '2024-02-28', null,         'Expedia Collect'),
  ('ottofiori',         'expedia',     '117985847', true,  'net',   20, 0,  3.3898, 18, '2025-06-25', null,         'Expedia Traveller Preference; virtual card on all bookings')
) as v(hotel_id, channel_key, listing_ref, dflt, basis, pct, extra, tax, vat, vfrom, vto, notes)
where not exists (
  select 1 from public.ota_commercial_terms t
  where t.hotel_id = v.hotel_id and t.channel_key = v.channel_key
    and t.listing_ref is not distinct from v.listing_ref and t.valid_from = v.vfrom::date
);

-- ---------------------------------------------------------------------
-- 2. Imported OTA statement / payout lines (no guest names are stored)
-- ---------------------------------------------------------------------
create table if not exists public.ota_statement_lines (
  id                   uuid primary key default gen_random_uuid(),
  hotel_id             text not null,
  channel_key          text not null,
  listing_ref          text not null default '',
  statement_period     date not null,   -- Booking.com: first day of the checkout month; Agoda: payout date
  ota_reservation_code text not null,   -- Booking.com reservation number / Agoda booking ID (= reservations.pms_voucher)
  booked_at            timestamptz,
  check_in             date,
  check_out            date,
  status               text,
  room_nights          integer,
  commission_pct       numeric(6,3),
  original_amount      numeric(12,2),
  gross_amount         numeric(12,2),   -- Booking.com "Final amount" / Agoda "Reference sell inclusive"
  commission_amount    numeric(12,2),
  payout_amount        numeric(12,2),   -- Agoda "Payout amount"
  currency             text not null default 'EUR',
  source_file          text,
  import_batch         uuid,
  imported_at          timestamptz not null default now(),
  imported_by          uuid default auth.uid(),
  constraint ota_statement_lines_unique unique (channel_key, listing_ref, statement_period, ota_reservation_code)
);

create index if not exists ota_statement_lines_hotel_code
  on public.ota_statement_lines (hotel_id, ota_reservation_code);

alter table public.ota_statement_lines enable row level security;

drop policy if exists "Revenue users view OTA statements" on public.ota_statement_lines;
create policy "Revenue users view OTA statements" on public.ota_statement_lines
  for select to authenticated
  using ((public.is_revenue_user(auth.uid()) or coalesce(public.is_super_admin(auth.uid()), false))
         and public.user_can_access_hotel(auth.uid(), hotel_id));

drop policy if exists "Revenue users import OTA statements" on public.ota_statement_lines;
create policy "Revenue users import OTA statements" on public.ota_statement_lines
  for insert to authenticated
  with check ((public.is_revenue_user(auth.uid()) or coalesce(public.is_super_admin(auth.uid()), false))
              and public.user_can_access_hotel(auth.uid(), hotel_id));

drop policy if exists "Revenue users re-import OTA statements" on public.ota_statement_lines;
create policy "Revenue users re-import OTA statements" on public.ota_statement_lines
  for update to authenticated
  using ((public.is_revenue_user(auth.uid()) or coalesce(public.is_super_admin(auth.uid()), false))
         and public.user_can_access_hotel(auth.uid(), hotel_id))
  with check ((public.is_revenue_user(auth.uid()) or coalesce(public.is_super_admin(auth.uid()), false))
              and public.user_can_access_hotel(auth.uid(), hotel_id));

drop policy if exists "Revenue users remove OTA statements" on public.ota_statement_lines;
create policy "Revenue users remove OTA statements" on public.ota_statement_lines
  for delete to authenticated
  using ((public.is_revenue_user(auth.uid()) or coalesce(public.is_super_admin(auth.uid()), false))
         and public.user_can_access_hotel(auth.uid(), hotel_id));

-- Booking-level lookups from the revenue feed into reservations
create index if not exists reservations_pms_reservation_idx
  on public.reservations (hotel_id, pms_reservation_id)
  where pms_reservation_id is not null;

-- ---------------------------------------------------------------------
-- 3. Per stay night economics (internal; service role and the RPC below)
-- ---------------------------------------------------------------------
create or replace function public.ota_economics_nights(p_hotel_id text, p_from date, p_to date)
returns table (
  stay_date          date,
  booking_ref        text,
  ota_code           text,
  data_source        text,
  channel_key        text,
  channel_type       text,
  booked_on          date,
  room_nights        integer,
  priced_nights      integer,  -- room nights with a non-zero price (ADR denominator, as on the Revenue page)
  amount             numeric,  -- value as the PMS holds it (city tax and extras included)
  city_tax           numeric,
  revenue_ex_tax     numeric,  -- amount - city_tax
  gross_revenue      numeric,  -- what the guest paid, excl. city tax
  commission         numeric,  -- null = unknown
  net_revenue        numeric,  -- what the hotel keeps
  amount_basis       text,     -- gross | net (net: the OTA already deducted commission)
  commission_source  text,
  commission_rate    numeric,  -- rate on the commissionable room value (0.18 = 18%)
  rate_label         text,
  meal_plan          text,
  payout_type        text,
  currency           text
)
language sql
stable
set search_path = public
as $$
with
settings as (
  select
    coalesce((select upper(s.base_currency) from public.hotel_revenue_settings s
              where s.hotel_id = p_hotel_id and s.base_currency is not null limit 1), 'EUR') as cur,
    -- HotelCare is the PMS of record (native ARI), or there is no Previo feed
    not (public.pms_ari_native_hotel(p_hotel_id)
         or not exists (select 1 from public.revenue_booking_nights x where x.hotel_id = p_hotel_id)) as has_previo
),
-- A. Previo hotels: revenue feed nights, booked rule identical to the Revenue page
previo_nights as (
  select n.stay_date, n.res_id as booking_ref, coalesce(n.nightly_price_eur, 0)::numeric as amt,
         n.source_name as channel_raw, n.created_at_pms as created_raw
  from public.revenue_booking_nights n
  where n.hotel_id = p_hotel_id
    and n.stay_date between p_from and p_to
    and n.res_id is not null
    and n.status_id is not null and n.status_id not in (7, 8)
    and not (n.stay_from is not null and n.stay_to is not null and n.stay_to <= n.stay_from)
    and not (coalesce(btrim(n.source_name, E' \t\r\n'), '') = ''
             and n.stay_from is not null and n.stay_to is not null and n.stay_to - n.stay_from > 366)
),
-- B. HotelCare PMS hotels (no Previo feed): nights from HotelCare reservations
native_nights as (
  select gs::date as stay_date, r.id::text as booking_ref,
         coalesce(r.total_amount, 0)::numeric / greatest(r.check_out_date - r.check_in_date, 1) as amt,
         coalesce(nullif(btrim(r.ota_name), ''), nullif(btrim(r.pms_channel), ''), r.source) as channel_raw,
         r.created_at as created_raw
  from settings s
  join public.reservations r on not s.has_previo
  cross join lateral generate_series(greatest(r.check_in_date, p_from)::timestamp,
                                     least(r.check_out_date - 1, p_to)::timestamp, interval '1 day') gs
  where r.hotel_id = p_hotel_id
    and r.status::text not in ('cancelled', 'no_show')
    and r.check_in_date <= p_to
    and r.check_out_date > p_from
),
nights as (
  select 'previo'::text as data_source, pn.* from previo_nights pn
  union all
  select 'hotelcare'::text, nn.* from native_nights nn
),
booking_base as (
  select x.data_source, x.booking_ref,
         max(x.channel_raw) filter (where coalesce(btrim(x.channel_raw, E' \t\r\n'), '') <> '') as channel_raw,
         min(x.created_raw) as created_min,
         min(x.stay_date) as first_night,
         sum(x.amt) as range_amt
  from nights x
  group by x.data_source, x.booking_ref
),
-- Whole-stay PMS value of each Previo booking (all stay dates, not only the range)
previo_totals as (
  select n.res_id as booking_ref, sum(coalesce(n.nightly_price_eur, 0))::numeric as b_amt,
         min(n.created_at_pms) as created_pms
  from public.revenue_booking_nights n
  where n.hotel_id = p_hotel_id
    and n.res_id in (select bb.booking_ref from booking_base bb where bb.data_source = 'previo')
    and n.status_id is not null and n.status_id not in (7, 8)
  group by n.res_id
),
-- One reservation row per Previo booking, preferring the one with the OTA note
previo_res as (
  select distinct on (r.pms_reservation_id)
         r.pms_reservation_id as booking_ref, r.pms_voucher, r.pms_channel, r.special_requests
  from public.reservations r
  where r.hotel_id = p_hotel_id
    and r.pms_reservation_id in (select bb.booking_ref from booking_base bb where bb.data_source = 'previo')
  order by r.pms_reservation_id,
           (coalesce(r.special_requests, '') ilike '%commission amount%') desc,
           r.updated_at desc nulls last
),
parsed as (
  select pr.booking_ref, pr.pms_voucher, pr.pms_channel, p.*
  from previo_res pr
  left join lateral public.ota_parse_note(pr.special_requests) p on true
),
native_res as (
  select r.id::text as booking_ref,
         coalesce(nullif(btrim(r.ota_reservation_code), ''), r.pms_voucher) as ota_code,
         upper(nullif(btrim(r.currency), '')) as res_currency,
         r.channex_booking_id, r.channex_room_index,
         coalesce(r.total_amount, 0)::numeric as total_amount
  from public.reservations r
  where r.hotel_id = p_hotel_id
    and r.id in (select case when bb.data_source = 'hotelcare' then bb.booking_ref::uuid end
                 from booking_base bb where bb.data_source = 'hotelcare')
),
cx as (
  select distinct on (c.channex_booking_id) c.channex_booking_id, c.payload
  from public.channex_booking_revisions c
  where c.hotel_id = p_hotel_id
    and c.channex_booking_id in (select nr.channex_booking_id from native_res nr where nr.channex_booking_id is not null)
  order by c.channex_booking_id, c.created_at desc
),
booking as (
  select
    bb.data_source,
    bb.booking_ref,
    coalesce(pa.pms_voucher, nr.ota_code) as ota_code,
    public.ota_channel_key(coalesce(nullif(btrim(bb.channel_raw, E' \t\r\n'), ''), pa.pms_channel)) as channel_key,
    coalesce(pa.ota_booked_on,
             (coalesce(pt.created_pms, bb.created_min) at time zone 'Europe/Budapest')::date,
             bb.first_night) as booked_on,
    case when bb.data_source = 'previo' then s.cur else coalesce(nr.res_currency, s.cur) end as currency,
    coalesce(pt.b_amt, bb.range_amt) as b_amt,
    pa.note_total, pa.note_commission, pa.note_currency, pa.payout_type, pa.rate_label, pa.meal_plan,
    -- a voucher shared by two PMS bookings shares one note
    coalesce(pt.b_amt, bb.range_amt)
      / nullif(sum(coalesce(pt.b_amt, bb.range_amt)) over (partition by coalesce(pa.pms_voucher, bb.booking_ref)), 0) as note_share,
    nr.channex_booking_id, nr.channex_room_index, nr.total_amount as native_total,
    nr.total_amount / nullif(sum(nr.total_amount) over (partition by nr.channex_booking_id), 0) as cx_share
  from booking_base bb
  cross join settings s
  left join previo_totals pt on bb.data_source = 'previo' and pt.booking_ref = bb.booking_ref
  left join parsed pa on bb.data_source = 'previo' and pa.booking_ref = bb.booking_ref
  left join native_res nr on bb.data_source = 'hotelcare' and nr.booking_ref = bb.booking_ref
),
stmt as (
  select distinct on (l.ota_reservation_code, l.channel_key)
         l.ota_reservation_code, l.channel_key, l.gross_amount, l.commission_amount, upper(l.currency) as currency
  from public.ota_statement_lines l
  where l.hotel_id = p_hotel_id
    and l.gross_amount > 0
    and l.commission_amount is not null
    and l.ota_reservation_code in (select b.ota_code from booking b where b.ota_code is not null)
  order by l.ota_reservation_code, l.channel_key, l.statement_period desc, l.imported_at desc
),
priced as (
  select
    b.*,
    public.ota_channel_type(b.channel_key) as channel_type,
    t.amount_basis as terms_basis,
    (t.commission_pct + t.extra_commission_pct) / 100.0 as terms_rate,
    coalesce(t.city_tax_pct, 0) / 100.0 as tax,
    st.gross_amount as st_gross,
    st.commission_amount as st_comm,
    public.ota_parse_amount(coalesce(cx.payload -> 'rooms' -> b.channex_room_index ->> 'ota_commission',
                                     (public.ota_parse_amount(cx.payload ->> 'ota_commission') * b.cx_share)::text)) as cx_comm,
    coalesce(public.ota_parse_amount(cx.payload -> 'rooms' -> b.channex_room_index ->> 'amount'), b.native_total) as cx_total
  from booking b
  left join lateral (
    select ct.amount_basis, ct.commission_pct, ct.extra_commission_pct, ct.city_tax_pct
    from public.ota_commercial_terms ct
    where ct.hotel_id = p_hotel_id
      and ct.channel_key = b.channel_key
      and b.booked_on >= ct.valid_from
      and (ct.valid_to is null or b.booked_on <= ct.valid_to)
    order by ct.applies_by_default desc, ct.valid_from desc
    limit 1
  ) t on true
  left join stmt st on st.ota_reservation_code = b.ota_code and st.channel_key = b.channel_key and st.currency = b.currency
  left join cx on cx.channex_booking_id = b.channex_booking_id
),
sourced as (
  select p.*,
    case
      when p.st_gross > 0 and p.st_comm is not null then 'statement'
      when p.cx_comm > 0 and p.cx_total > 0 then 'channex'
      when p.note_commission is not null and p.note_total > 0 and p.note_currency = p.currency then 'ota_note'
      when p.terms_rate is not null then 'terms'
      when p.channel_type in ('direct', 'other') then 'no_commission'
      else 'none'
    end as src
  from priced p
),
rated as (
  select s.*,
    case
      when s.src = 'statement' then coalesce(s.terms_basis, 'gross')
      when s.src = 'terms' then s.terms_basis
      else 'gross'
    end as basis,
    case s.src
      when 'statement' then s.st_comm / s.st_gross
      when 'channex' then s.cx_comm * (1 + s.tax) / s.cx_total
      when 'ota_note' then s.note_commission * (1 + s.tax) / s.note_total
      when 'terms' then s.terms_rate
      when 'no_commission' then 0::numeric
      else null::numeric
    end as rate,
    -- commissionable value incl. city tax, as the PMS would hold it
    case
      when s.src = 'statement' and coalesce(s.terms_basis, 'gross') = 'gross' then s.st_gross * (1 + s.tax)
      when s.src = 'channex' then s.cx_total
      when s.src = 'ota_note' then s.note_total * coalesce(s.note_share, 1)
      else null::numeric
    end as t_incl
  from sourced s
),
factored as (
  select r.*,
    -- share of the PMS value that is the OTA room price; the rest are extras sold
    -- by the hotel (no city tax, no commission). Shortened stays scale down.
    case when r.t_incl is not null and r.b_amt > 0 then least(1::numeric, r.t_incl / r.b_amt) else 1::numeric end as k
  from rated r
),
night_calc as (
  select
    x.stay_date, x.booking_ref, x.data_source, x.amt,
    f.ota_code, f.channel_key, f.channel_type, f.booked_on, f.basis, f.src, f.rate, f.tax, f.k,
    f.rate_label, f.meal_plan, f.payout_type, f.currency,
    x.amt * f.k * f.tax / (1 + f.tax) as ctax
  from nights x
  join factored f on f.data_source = x.data_source and f.booking_ref = x.booking_ref
),
night_comm as (
  select n.*,
    n.amt - n.ctax as rev_ex,
    case
      when n.rate is null then null::numeric
      when n.basis = 'net' then (n.amt - n.ctax) * n.rate / nullif(1 - n.rate, 0)
      else n.rate * n.amt * n.k / (1 + n.tax)
    end as comm
  from night_calc n
)
select
  nc.stay_date,
  nc.booking_ref,
  nc.ota_code,
  nc.data_source,
  nc.channel_key,
  nc.channel_type,
  nc.booked_on,
  count(*)::integer,
  (count(*) filter (where nc.amt <> 0))::integer,
  round(sum(nc.amt), 4),
  round(sum(nc.ctax), 4),
  round(sum(nc.rev_ex), 4),
  round(sum(case when nc.basis = 'net' then nc.rev_ex + coalesce(nc.comm, 0) else nc.rev_ex end), 4),
  round(sum(nc.comm), 4),
  round(sum(case when nc.basis = 'net' then nc.rev_ex else nc.rev_ex - coalesce(nc.comm, 0) end), 4),
  nc.basis,
  nc.src,
  round(nc.rate, 4),
  nc.rate_label,
  nc.meal_plan,
  nc.payout_type,
  nc.currency
from night_comm nc
group by nc.stay_date, nc.booking_ref, nc.ota_code, nc.data_source, nc.channel_key, nc.channel_type, nc.booked_on,
         nc.basis, nc.src, nc.rate, nc.rate_label, nc.meal_plan, nc.payout_type, nc.currency
order by nc.stay_date, nc.booking_ref
$$;

revoke all on function public.ota_economics_nights(text, date, date) from public, anon, authenticated;
grant execute on function public.ota_economics_nights(text, date, date) to service_role;

-- ---------------------------------------------------------------------
-- 4. RPC for the Revenue page: same rows, revenue users of the hotel only
-- ---------------------------------------------------------------------
create or replace function public.revenue_channel_economics(p_hotel_id text, p_from date, p_to date)
returns table (
  stay_date          date,
  booking_ref        text,
  ota_code           text,
  data_source        text,
  channel_key        text,
  channel_type       text,
  booked_on          date,
  room_nights        integer,
  priced_nights      integer,
  amount             numeric,
  city_tax           numeric,
  revenue_ex_tax     numeric,
  gross_revenue      numeric,
  commission         numeric,
  net_revenue        numeric,
  amount_basis       text,
  commission_source  text,
  commission_rate    numeric,
  rate_label         text,
  meal_plan          text,
  payout_type        text,
  currency           text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or not ((public.is_revenue_user(auth.uid()) or coalesce(public.is_super_admin(auth.uid()), false))
             and public.user_can_access_hotel(auth.uid(), p_hotel_id)) then
    raise exception 'Not authorised to view channel economics for this hotel' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'Choose a stay range of up to 400 days' using errcode = '22023';
  end if;
  return query select * from public.ota_economics_nights(p_hotel_id, p_from, p_to);
end;
$$;

revoke all on function public.revenue_channel_economics(text, date, date) from public, anon;
grant execute on function public.revenue_channel_economics(text, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Monthly summary per channel (trend charts, management views)
-- ---------------------------------------------------------------------
create or replace function public.revenue_channel_economics_monthly(p_hotel_id text, p_from date, p_to date)
returns table (
  month                    date,
  channel_key              text,
  channel_type             text,
  commission_source        text,
  amount_basis             text,
  currency                 text,
  room_nights              integer,
  priced_nights            integer,
  bookings                 integer,
  amount                   numeric,
  city_tax                 numeric,
  revenue_ex_tax           numeric,
  gross_revenue            numeric,
  commission               numeric,
  net_revenue              numeric,
  unknown_commission_gross numeric  -- gross revenue of OTA bookings without terms (commission unknown)
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or not ((public.is_revenue_user(auth.uid()) or coalesce(public.is_super_admin(auth.uid()), false))
             and public.user_can_access_hotel(auth.uid(), p_hotel_id)) then
    raise exception 'Not authorised to view channel economics for this hotel' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'Choose a stay range of up to 400 days' using errcode = '22023';
  end if;
  return query
    select date_trunc('month', e.stay_date)::date,
           e.channel_key, e.channel_type, e.commission_source, e.amount_basis, e.currency,
           sum(e.room_nights)::integer,
           sum(e.priced_nights)::integer,
           count(distinct e.booking_ref)::integer,
           round(sum(e.amount), 2),
           round(sum(e.city_tax), 2),
           round(sum(e.revenue_ex_tax), 2),
           round(sum(e.gross_revenue), 2),
           round(sum(coalesce(e.commission, 0)), 2),
           round(sum(e.net_revenue), 2),
           round(coalesce(sum(e.gross_revenue) filter (where e.commission is null), 0), 2)
    from public.ota_economics_nights(p_hotel_id, p_from, p_to) e
    group by 1, 2, 3, 4, 5, 6
    order by 1, 2, 4, 5;
end;
$$;

revoke all on function public.revenue_channel_economics_monthly(text, date, date) from public, anon;
grant execute on function public.revenue_channel_economics_monthly(text, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. Statement check: each imported statement line against the PMS
--    booking, the Booking.com note and the contract terms
-- ---------------------------------------------------------------------
create or replace function public.ota_statement_check_rows(p_hotel_id text, p_from date, p_to date)
returns table (
  channel_key          text,
  listing_ref          text,
  statement_period     date,
  ota_reservation_code text,
  status               text,
  booked_at            timestamptz,
  check_in             date,
  check_out            date,
  room_nights          integer,
  statement_gross      numeric,
  statement_commission numeric,
  statement_pct        numeric,
  payout_amount        numeric,
  currency             text,
  in_pms               boolean,
  pms_booking_ref      text,
  pms_status           text,
  note_total           numeric,
  note_commission      numeric,
  terms_pct            numeric,
  expected_commission  numeric
)
language sql
stable
set search_path = public
as $$
  with l as (
    select x.*
    from public.ota_statement_lines x
    where x.hotel_id = p_hotel_id
      and x.statement_period between p_from and p_to
  ),
  r as (
    select distinct on (res.pms_voucher)
           res.pms_voucher, res.pms_reservation_id, res.special_requests, res.status::text as status
    from public.reservations res
    where res.hotel_id = p_hotel_id
      and res.pms_voucher in (select l.ota_reservation_code from l)
    order by res.pms_voucher,
             (coalesce(res.special_requests, '') ilike '%commission amount%') desc,
             res.updated_at desc nulls last
  )
  select
    l.channel_key, l.listing_ref, l.statement_period, l.ota_reservation_code, l.status, l.booked_at,
    l.check_in, l.check_out, l.room_nights, l.gross_amount, l.commission_amount,
    case when l.gross_amount > 0 then round(100 * l.commission_amount / l.gross_amount, 2) end,
    l.payout_amount, l.currency,
    r.pms_voucher is not null, r.pms_reservation_id, r.status,
    p.note_total, p.note_commission,
    t.pct,
    case when t.pct is not null and l.gross_amount is not null then round(l.gross_amount * t.pct / 100, 2) end
  from l
  left join r on r.pms_voucher = l.ota_reservation_code
  left join lateral public.ota_parse_note(r.special_requests) p on true
  left join lateral (
    select ct.commission_pct + ct.extra_commission_pct as pct
    from public.ota_commercial_terms ct
    where ct.hotel_id = p_hotel_id
      and ct.channel_key = l.channel_key
      and (ct.listing_ref is null or l.listing_ref = '' or ct.listing_ref = l.listing_ref)
      and coalesce((l.booked_at at time zone 'Europe/Budapest')::date, l.check_in) >= ct.valid_from
      and (ct.valid_to is null or coalesce((l.booked_at at time zone 'Europe/Budapest')::date, l.check_in) <= ct.valid_to)
    order by (ct.listing_ref = nullif(l.listing_ref, '')) desc nulls last, ct.applies_by_default desc, ct.valid_from desc
    limit 1
  ) t on true
  order by l.statement_period desc, l.channel_key, l.check_out, l.ota_reservation_code
$$;

revoke all on function public.ota_statement_check_rows(text, date, date) from public, anon, authenticated;
grant execute on function public.ota_statement_check_rows(text, date, date) to service_role;

create or replace function public.revenue_ota_statement_check(p_hotel_id text, p_from date, p_to date)
returns table (
  channel_key          text,
  listing_ref          text,
  statement_period     date,
  ota_reservation_code text,
  status               text,
  booked_at            timestamptz,
  check_in             date,
  check_out            date,
  room_nights          integer,
  statement_gross      numeric,
  statement_commission numeric,
  statement_pct        numeric,
  payout_amount        numeric,
  currency             text,
  in_pms               boolean,
  pms_booking_ref      text,
  pms_status           text,
  note_total           numeric,
  note_commission      numeric,
  terms_pct            numeric,
  expected_commission  numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or not ((public.is_revenue_user(auth.uid()) or coalesce(public.is_super_admin(auth.uid()), false))
             and public.user_can_access_hotel(auth.uid(), p_hotel_id)) then
    raise exception 'Not authorised to view channel economics for this hotel' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 800 then
    raise exception 'Choose a statement period range of up to 800 days' using errcode = '22023';
  end if;
  return query select * from public.ota_statement_check_rows(p_hotel_id, p_from, p_to);
end;
$$;

revoke all on function public.revenue_ota_statement_check(text, date, date) from public, anon;
grant execute on function public.revenue_ota_statement_check(text, date, date) to authenticated, service_role;

-- Statement import: which OTA reservation codes belong to this hotel's bookings
create or replace function public.revenue_match_ota_codes(p_hotel_id text, p_codes text[])
returns table (ota_code text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or not ((public.is_revenue_user(auth.uid()) or coalesce(public.is_super_admin(auth.uid()), false))
             and public.user_can_access_hotel(auth.uid(), p_hotel_id)) then
    raise exception 'Not authorised to view channel economics for this hotel' using errcode = '42501';
  end if;
  if coalesce(array_length(p_codes, 1), 0) > 5000 then
    raise exception 'Too many reservation codes in one request' using errcode = '22023';
  end if;
  return query
    select distinct r.pms_voucher
    from public.reservations r
    where r.hotel_id = p_hotel_id and r.pms_voucher = any (p_codes)
    union
    select distinct r.ota_reservation_code
    from public.reservations r
    where r.hotel_id = p_hotel_id and r.ota_reservation_code = any (p_codes);
end;
$$;

revoke all on function public.revenue_match_ota_codes(text, text[]) from public, anon;
grant execute on function public.revenue_match_ota_codes(text, text[]) to authenticated, service_role;

-- Helpers are pure functions; nobody anonymous needs them
revoke all on function public.ota_parse_amount(text) from public, anon;
revoke all on function public.ota_channel_key(text) from public, anon;
revoke all on function public.ota_channel_type(text) from public, anon;
revoke all on function public.ota_parse_note(text) from public, anon;
grant execute on function public.ota_parse_amount(text) to authenticated, service_role;
grant execute on function public.ota_channel_key(text) to authenticated, service_role;
grant execute on function public.ota_channel_type(text) to authenticated, service_role;
grant execute on function public.ota_parse_note(text) to authenticated, service_role;

comment on function public.revenue_channel_economics(text, date, date) is
  'Gross revenue, OTA commission and net revenue per stay night and channel. Exact where an OTA statement, Channex revision or Booking.com note exists; contract terms otherwise.';
comment on table public.ota_commercial_terms is
  'OTA commission terms per hotel, channel and booking-date period. Used when no exact commission is available.';
comment on table public.ota_statement_lines is
  'Imported OTA statement and payout lines (Booking.com reservation statements, Agoda earnings). No guest names.';
comment on function public.revenue_channel_economics_monthly(text, date, date) is
  'Monthly gross revenue, commission and net revenue per channel and commission source.';
comment on function public.revenue_ota_statement_check(text, date, date) is
  'Imported OTA statement lines compared with the PMS booking, the Booking.com note and the contract terms.';
