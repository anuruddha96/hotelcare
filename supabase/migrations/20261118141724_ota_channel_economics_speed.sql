-- =====================================================================
-- OTA channel economics: speed.
--
-- Calling the helper functions once per booking (SET search_path and a
-- PL/pgSQL exception block per call) made one month at Gozsdu take ~1.3 s
-- and timed out multi-month ranges. The note parsing and channel mapping
-- are now inline in the two report functions, each note label is parsed
-- on a short window instead of the whole note, and bounded repeats are
-- gone from the captures. Three months at Gozsdu: ~2 s -> ~0.5 s in testing,
-- with identical results (all 1,987 rows of Gozsdu October compared).
-- ota_parse_amount becomes a plain SQL expression (no exception block).
-- =====================================================================

create or replace function public.ota_parse_amount(s text)
returns numeric
language sql
immutable
set search_path = public
as $$
  -- "1061.47", "1,061.47", "1.061,47" or "1061,47" -> numeric; anything else -> null (never raises)
  select case
    when v ~ '^[0-9]{1,3}(,[0-9]{3})+(\.[0-9]+)?$' then replace(v, ',', '')::numeric
    when v ~ '^[0-9]{1,3}(\.[0-9]{3})+(,[0-9]+)?$' then replace(replace(v, '.', ''), ',', '.')::numeric
    when v ~ '^[0-9]+(\.[0-9]+)?$' then v::numeric
    when v ~ '^[0-9]+,[0-9]+$' then replace(v, ',', '.')::numeric
  end
  from (select regexp_replace(coalesce(s, ''), '[^0-9.,]', '', 'g') as v) x
$$;

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
  left join lateral (
    -- Booking.com block in the Previo note, parsed inline (a function call per booking is ~40x slower)
    select
      (case when m.tp ~ '^[0-9]{1,3}(,[0-9]{3})+(\.[0-9]+)?$' then replace(m.tp, ',', '')::numeric when m.tp ~ '^[0-9]{1,3}(\.[0-9]{3})+(,[0-9]+)?$' then replace(replace(m.tp, '.', ''), ',', '.')::numeric when m.tp ~ '^[0-9]+(\.[0-9]+)?$' then m.tp::numeric when m.tp ~ '^[0-9]+,[0-9]+$' then replace(m.tp, ',', '.')::numeric end) as note_total,
      (case when m.cm ~ '^[0-9]{1,3}(,[0-9]{3})+(\.[0-9]+)?$' then replace(m.cm, ',', '')::numeric when m.cm ~ '^[0-9]{1,3}(\.[0-9]{3})+(,[0-9]+)?$' then replace(replace(m.cm, '.', ''), ',', '.')::numeric when m.cm ~ '^[0-9]+(\.[0-9]+)?$' then m.cm::numeric when m.cm ~ '^[0-9]+,[0-9]+$' then replace(m.cm, ',', '.')::numeric end) as note_commission,
      upper(coalesce(m.cm_cur, m.tp_cur)) as note_currency,
      nullif(btrim(m.payout), '') as payout_type,
      nullif(btrim((regexp_match(m.room_name, '\(([^()]*(?:\([^()]*\)[^()]*)*)\(ID\s*[0-9]+\)\)$'))[1]), '') as rate_label,
      nullif(btrim(m.meals), '') as meal_plan,
      case when m.created ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then m.created::date end as ota_booked_on
    from (
      select t.tp[1] as tp, t.tp[2] as tp_cur, t.cm[1] as cm, t.cm[2] as cm_cur, t.payout, t.room_name, t.meals, t.created
      from (
        -- Each label is located with strpos and its pattern runs on a short window there; a
        -- case-insensitive regex over the whole note cost ~1 ms per booking. The whole note is
        -- searched only when the window misses and the label occurs again (no difference on
        -- 4,000 real notes). Captures use [^<]+ cut with left(): a bounded {1,240} repeat alone
        -- cost ~0.5 ms per call. "offset 0" keeps each level from being inlined, so every
        -- expression runs once per booking.
        select
          case when w.p_tp > 0 then coalesce(regexp_match(substr(w.t, greatest(w.p_tp - 8, 1), 200), 'Total price\s*(?:<[^>]*>)?\s*([0-9][0-9.,]*)\s*(EUR|HUF)', 'i'),
                                             case when strpos(substr(w.lt, w.p_tp + 1), 'total price') > 0 then regexp_match(w.t, 'Total price\s*(?:<[^>]*>)?\s*([0-9][0-9.,]*)\s*(EUR|HUF)', 'i') end) end as tp,
          case when w.p_cm > 0 then coalesce(regexp_match(substr(w.t, greatest(w.p_cm - 8, 1), 200), 'commission amount calculated by Booking\.com\s*\(([0-9][0-9.,]*)\s*(EUR|HUF)\)', 'i'),
                                             case when strpos(substr(w.lt, w.p_cm + 1), 'commission amount calculated by booking.com') > 0 then regexp_match(w.t, 'commission amount calculated by Booking\.com\s*\(([0-9][0-9.,]*)\s*(EUR|HUF)\)', 'i') end) end as cm,
          left(case when w.p_po > 0 then coalesce((regexp_match(substr(w.t, greatest(w.p_po - 8, 1), 200), 'Payout type\s*([^<)]+)', 'i'))[1],
                                             case when strpos(substr(w.lt, w.p_po + 1), 'payout type') > 0 then (regexp_match(w.t, 'Payout type\s*([^<)]+)', 'i'))[1] end) end, 40) as payout,
          btrim(left(case when w.p_rn > 0 then coalesce((regexp_match(substr(w.t, greatest(w.p_rn - 8, 1), 400), 'room name\s*(?:<[^>]*>)?\s*([^<]+)', 'i'))[1],
                                             case when strpos(substr(w.lt, w.p_rn + 1), 'room name') > 0 then (regexp_match(w.t, 'room name\s*(?:<[^>]*>)?\s*([^<]+)', 'i'))[1] end) end, 240)) as room_name,
          left(case when w.p_me > 0 then coalesce((regexp_match(substr(w.t, greatest(w.p_me - 8, 1), 200), 'Meals\s*(?:<[^>]*>)?\s*([^<]+)', 'i'))[1],
                                             case when strpos(substr(w.lt, w.p_me + 1), 'meals') > 0 then (regexp_match(w.t, 'Meals\s*(?:<[^>]*>)?\s*([^<]+)', 'i'))[1] end) end, 60) as meals,
          case when w.p_cr > 0 then coalesce((regexp_match(substr(w.t, greatest(w.p_cr - 8, 1), 200), 'Created\s*(?:<[^>]*>)?\s*([0-9]{4}-[0-9]{2}-[0-9]{2})', 'i'))[1],
                                             case when strpos(substr(w.lt, w.p_cr + 1), 'created') > 0 then (regexp_match(w.t, 'Created\s*(?:<[^>]*>)?\s*([0-9]{4}-[0-9]{2}-[0-9]{2})', 'i'))[1] end) end as created
        from (
          select n.t, n.lt,
                 strpos(n.lt, 'total price') as p_tp,
                 strpos(n.lt, 'commission amount calculated by booking.com') as p_cm,
                 strpos(n.lt, 'payout type') as p_po,
                 strpos(n.lt, 'room name') as p_rn,
                 strpos(n.lt, 'meals') as p_me,
                 strpos(n.lt, 'created') as p_cr
          from (select x.t, lower(x.t) as lt
                from (select replace(replace(replace(coalesce(pr.special_requests, ''), '&lt;', '<'), '&gt;', '>'), '&amp;', '&') as t offset 0) x
                offset 0) n
          offset 0
        ) w
        offset 0
      ) t
      offset 0
    ) m
  ) p on true
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
    case
      when cs.s = '' then 'direct'
      when cs.s ~* '^(booking\.?com|bookingcom)' then 'booking_com'
      when cs.s ~* 'agoda' then 'agoda'
      when cs.s ~* '(expedia|hotels\.com|vrbo)' then 'expedia'
      when cs.s ~* 'hotelbeds' then 'hotelbeds'
      when cs.s ~* '(edreams|odigeo)' then 'edreams'
      when cs.s ~* '(trip\.com|ctrip)' then 'trip_com'
      when cs.s ~* 'hoteltonight' then 'hoteltonight'
      when cs.s ~* 'airbnb' then 'airbnb'
      when cs.s ~* 'google' then 'google'
      when cs.s ~* '(reservation\+|previo global|booking engine|website|^web$)' then 'direct_web'
      when cs.s ~* '^(direct|offline|walk.?in|phone|e-?mail)' then 'direct'
      when cs.s ~* 'reloc' then 'relocation'
      when cs.s ~* '(no-?show|penalty)' then 'penalty'
      else 'other'
    end as channel_key,
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
  -- same mapping as ota_channel_key(), inline for speed
  cross join lateral (
    select btrim(regexp_replace(regexp_replace(regexp_replace(coalesce(coalesce(nullif(btrim(bb.channel_raw, E' \t\r\n'), ''), pa.pms_channel), ''),
             '(\\n|\s)+', ' ', 'g'), '^\s*[0-9]{1,6}\s+', ''), '\s*(V2XML|XML)\s*$', '', 'i')) as s offset 0
  ) cs
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
    case
      when b.channel_key in ('booking_com', 'agoda', 'expedia', 'edreams', 'trip_com', 'hoteltonight', 'airbnb') then 'ota'
      when b.channel_key in ('hotelbeds') then 'wholesale'
      when b.channel_key in ('direct', 'direct_web', 'google') then 'direct'
      else 'other'
    end as channel_type,
    t.amount_basis as terms_basis,
    (t.commission_pct + t.extra_commission_pct) / 100.0 as terms_rate,
    coalesce(t.city_tax_pct, 0) / 100.0 as tax,
    st.gross_amount as st_gross,
    st.commission_amount as st_comm,
    case when cx.payload is not null then
      public.ota_parse_amount(coalesce(cx.payload -> 'rooms' -> b.channex_room_index ->> 'ota_commission',
                                       (public.ota_parse_amount(cx.payload ->> 'ota_commission') * b.cx_share)::text))
    end as cx_comm,
    coalesce(case when cx.payload is not null then public.ota_parse_amount(cx.payload -> 'rooms' -> b.channex_room_index ->> 'amount') end,
             b.native_total) as cx_total
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
  left join lateral (
    -- Booking.com block in the Previo note, parsed inline (a function call per booking is ~40x slower)
    select
      (case when m.tp ~ '^[0-9]{1,3}(,[0-9]{3})+(\.[0-9]+)?$' then replace(m.tp, ',', '')::numeric when m.tp ~ '^[0-9]{1,3}(\.[0-9]{3})+(,[0-9]+)?$' then replace(replace(m.tp, '.', ''), ',', '.')::numeric when m.tp ~ '^[0-9]+(\.[0-9]+)?$' then m.tp::numeric when m.tp ~ '^[0-9]+,[0-9]+$' then replace(m.tp, ',', '.')::numeric end) as note_total,
      (case when m.cm ~ '^[0-9]{1,3}(,[0-9]{3})+(\.[0-9]+)?$' then replace(m.cm, ',', '')::numeric when m.cm ~ '^[0-9]{1,3}(\.[0-9]{3})+(,[0-9]+)?$' then replace(replace(m.cm, '.', ''), ',', '.')::numeric when m.cm ~ '^[0-9]+(\.[0-9]+)?$' then m.cm::numeric when m.cm ~ '^[0-9]+,[0-9]+$' then replace(m.cm, ',', '.')::numeric end) as note_commission,
      upper(coalesce(m.cm_cur, m.tp_cur)) as note_currency,
      nullif(btrim(m.payout), '') as payout_type,
      nullif(btrim((regexp_match(m.room_name, '\(([^()]*(?:\([^()]*\)[^()]*)*)\(ID\s*[0-9]+\)\)$'))[1]), '') as rate_label,
      nullif(btrim(m.meals), '') as meal_plan,
      case when m.created ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then m.created::date end as ota_booked_on
    from (
      select t.tp[1] as tp, t.tp[2] as tp_cur, t.cm[1] as cm, t.cm[2] as cm_cur, t.payout, t.room_name, t.meals, t.created
      from (
        -- Each label is located with strpos and its pattern runs on a short window there; a
        -- case-insensitive regex over the whole note cost ~1 ms per booking. The whole note is
        -- searched only when the window misses and the label occurs again (no difference on
        -- 4,000 real notes). Captures use [^<]+ cut with left(): a bounded {1,240} repeat alone
        -- cost ~0.5 ms per call. "offset 0" keeps each level from being inlined, so every
        -- expression runs once per booking.
        select
          case when w.p_tp > 0 then coalesce(regexp_match(substr(w.t, greatest(w.p_tp - 8, 1), 200), 'Total price\s*(?:<[^>]*>)?\s*([0-9][0-9.,]*)\s*(EUR|HUF)', 'i'),
                                             case when strpos(substr(w.lt, w.p_tp + 1), 'total price') > 0 then regexp_match(w.t, 'Total price\s*(?:<[^>]*>)?\s*([0-9][0-9.,]*)\s*(EUR|HUF)', 'i') end) end as tp,
          case when w.p_cm > 0 then coalesce(regexp_match(substr(w.t, greatest(w.p_cm - 8, 1), 200), 'commission amount calculated by Booking\.com\s*\(([0-9][0-9.,]*)\s*(EUR|HUF)\)', 'i'),
                                             case when strpos(substr(w.lt, w.p_cm + 1), 'commission amount calculated by booking.com') > 0 then regexp_match(w.t, 'commission amount calculated by Booking\.com\s*\(([0-9][0-9.,]*)\s*(EUR|HUF)\)', 'i') end) end as cm,
          left(case when w.p_po > 0 then coalesce((regexp_match(substr(w.t, greatest(w.p_po - 8, 1), 200), 'Payout type\s*([^<)]+)', 'i'))[1],
                                             case when strpos(substr(w.lt, w.p_po + 1), 'payout type') > 0 then (regexp_match(w.t, 'Payout type\s*([^<)]+)', 'i'))[1] end) end, 40) as payout,
          btrim(left(case when w.p_rn > 0 then coalesce((regexp_match(substr(w.t, greatest(w.p_rn - 8, 1), 400), 'room name\s*(?:<[^>]*>)?\s*([^<]+)', 'i'))[1],
                                             case when strpos(substr(w.lt, w.p_rn + 1), 'room name') > 0 then (regexp_match(w.t, 'room name\s*(?:<[^>]*>)?\s*([^<]+)', 'i'))[1] end) end, 240)) as room_name,
          left(case when w.p_me > 0 then coalesce((regexp_match(substr(w.t, greatest(w.p_me - 8, 1), 200), 'Meals\s*(?:<[^>]*>)?\s*([^<]+)', 'i'))[1],
                                             case when strpos(substr(w.lt, w.p_me + 1), 'meals') > 0 then (regexp_match(w.t, 'Meals\s*(?:<[^>]*>)?\s*([^<]+)', 'i'))[1] end) end, 60) as meals,
          case when w.p_cr > 0 then coalesce((regexp_match(substr(w.t, greatest(w.p_cr - 8, 1), 200), 'Created\s*(?:<[^>]*>)?\s*([0-9]{4}-[0-9]{2}-[0-9]{2})', 'i'))[1],
                                             case when strpos(substr(w.lt, w.p_cr + 1), 'created') > 0 then (regexp_match(w.t, 'Created\s*(?:<[^>]*>)?\s*([0-9]{4}-[0-9]{2}-[0-9]{2})', 'i'))[1] end) end as created
        from (
          select n.t, n.lt,
                 strpos(n.lt, 'total price') as p_tp,
                 strpos(n.lt, 'commission amount calculated by booking.com') as p_cm,
                 strpos(n.lt, 'payout type') as p_po,
                 strpos(n.lt, 'room name') as p_rn,
                 strpos(n.lt, 'meals') as p_me,
                 strpos(n.lt, 'created') as p_cr
          from (select x.t, lower(x.t) as lt
                from (select replace(replace(replace(coalesce(r.special_requests, ''), '&lt;', '<'), '&gt;', '>'), '&amp;', '&') as t offset 0) x
                offset 0) n
          offset 0
        ) w
        offset 0
      ) t
      offset 0
    ) m
  ) p on true
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

-- CREATE OR REPLACE keeps privileges; restated so this file stands on its own.
revoke all on function public.ota_economics_nights(text, date, date) from public, anon, authenticated;
grant execute on function public.ota_economics_nights(text, date, date) to service_role;
revoke all on function public.ota_statement_check_rows(text, date, date) from public, anon, authenticated;
grant execute on function public.ota_statement_check_rows(text, date, date) to service_role;
revoke all on function public.ota_parse_amount(text) from public, anon;
grant execute on function public.ota_parse_amount(text) to authenticated, service_role;
