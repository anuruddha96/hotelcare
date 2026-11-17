-- Guest journey: one guest profile per person per hotel, built from every stay.
--
-- A guest is recognised across bookings by a name key: letter case, accents,
-- word order ("Kovács Anna" = "Anna Kovacs"), titles and initials are ignored.
-- Nothing is copied into reservations: Previo, Channex, website and manual
-- bookings keep their own data and are matched at read time, so the Previo
-- import is never touched and no reservation trigger fires.
--
-- Staff-entered preferences live on one guests row per person (the oldest one
-- with that name key). For Previo guests that row is created the first time
-- somebody saves a preference.
--
-- Stay details come from the modules that already record them: minibar,
-- breakfast attendance, In-Suite orders and requests.

-- ------------------------------------------------------------ name key
-- These four are pure functions (no table access, fully qualified calls), so
-- they carry no search_path setting: that keeps them inlinable and about six
-- times faster, which matters because the directory runs them on every row.

-- Lower case without accents: "Kovács" -> "kovacs".
CREATE OR REPLACE FUNCTION public.pms_fold_text(_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $fn$
  SELECT pg_catalog.lower(pg_catalog.translate(coalesce(_text, ''),
    'ÁÀÂÄÃÅĄĀÇĆČĎĐÉÈÊËĚĘĒĖÍÌÎÏĪĮİĹĽŁŃŇÑÓÒÔÖŐÕØŌŔŘŚŠŞȘŤȚÚÙÛÜŰŮŪŲÝŸŹŻŽÆŒáàâäãåąāçćčďđéèêëěęēėíìîïīįıĺľłńňñóòôöőõøōŕřśšşșťțúùûüűůūųýÿźżžæœßğĞ',
    'AAAAAAAACCCDDEEEEEEEEIIIIIIILLLNNNOOOOOOOORRSSSSTTUUUUUUUUYYZZZAOaaaaaaaacccddeeeeeeeeiiiiiiilllnnnoooooooorrssssttuuuuuuuuyyzzzaosgG'));
$fn$;

CREATE OR REPLACE FUNCTION public.pms_guest_name_key(_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $fn$
  SELECT (
    SELECT CASE
             -- One word ("Anna", "Guest") cannot identify a person.
             WHEN count(*) < 2 THEN NULL
             WHEN string_agg(t, ' ' ORDER BY t) = ANY ('{"guest ota","guest unknown","name no","guest test","guest walk","guest walkin","guest house"}'::text[])
               THEN NULL
             ELSE string_agg(t, ' ' ORDER BY t)
           END
      FROM pg_catalog.unnest(pg_catalog.regexp_split_to_array(public.pms_fold_text(_name), '[^[:alnum:]]+')) AS t
     WHERE pg_catalog.length(t) > 1
       AND t <> ALL ('{mr,mrs,ms,miss,mx,dr,prof,herr,frau,mme,mlle,sir,ur,urne,sig,sra,sr}'::text[])
  );
$fn$;

-- The guest name a reservation carries itself (PMS / OTA / website booking).
CREATE OR REPLACE FUNCTION public.pms_reservation_guest_key(_guest_name text, _contact_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $fn$
  SELECT public.pms_guest_name_key(COALESCE(NULLIF(pg_catalog.btrim(_guest_name), ''), NULLIF(pg_catalog.btrim(_contact_name), '')));
$fn$;

-- Name as shown on a profile: titles dropped, spaces tidied ("Dr.  Anna Kovács" -> "Anna Kovács").
CREATE OR REPLACE FUNCTION public.pms_guest_display_name(_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $fn$
  SELECT NULLIF(pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.regexp_replace(coalesce(_name, ''),
           '^\s*(mr|mrs|ms|miss|mx|dr|prof|herr|frau|mme|mlle)\.?\s+', '', 'i'), '\s+', ' ', 'g')), '');
$fn$;

GRANT EXECUTE ON FUNCTION public.pms_fold_text(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.pms_guest_name_key(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.pms_guest_display_name(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.pms_reservation_guest_key(text, text) TO PUBLIC;

CREATE INDEX IF NOT EXISTS reservations_hotel_guest_key_idx
  ON public.reservations (hotel_id, public.pms_reservation_guest_key(pms_guest_name, pms_contact_name))
  WHERE pms_missing_since IS NULL;
CREATE INDEX IF NOT EXISTS guests_hotel_name_key_idx
  ON public.guests (hotel_id, public.pms_guest_name_key(first_name || ' ' || last_name));

-- ------------------------------------------------------------ identity
-- Resolves a profile key ('n:<name key>' or 'g:<guest id>') to its hotel,
-- name key and guest rows. Internal helper.
CREATE OR REPLACE FUNCTION public.pms_guest_identity(_hotel_id text, _key text,
  OUT hotel_id text, OUT name_key text, OUT guest_ids uuid[], OUT primary_guest_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_gid uuid;
BEGIN
  IF _key ~* '^g:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_gid := substr(_key, 3)::uuid;
    SELECT g.hotel_id, public.pms_guest_name_key(g.first_name || ' ' || g.last_name)
      INTO hotel_id, name_key
      FROM public.guests g WHERE g.id = v_gid;
    IF hotel_id IS NULL THEN RETURN; END IF;
  ELSIF _key LIKE 'n:%' THEN
    hotel_id := NULLIF(btrim(_hotel_id), '');
    name_key := public.pms_guest_name_key(substr(_key, 3));
    IF hotel_id IS NULL OR name_key IS NULL THEN hotel_id := NULL; RETURN; END IF;
  ELSE
    RETURN;
  END IF;

  SELECT array_agg(g.id ORDER BY g.created_at, g.id), (array_agg(g.id ORDER BY g.created_at, g.id))[1]
    INTO guest_ids, primary_guest_id
    FROM public.guests g
   WHERE g.hotel_id = pms_guest_identity.hotel_id
     AND ((name_key IS NOT NULL AND public.pms_guest_name_key(g.first_name || ' ' || g.last_name) = name_key)
          OR g.id = v_gid);
  guest_ids := COALESCE(guest_ids, '{}');
END;
$fn$;

-- ------------------------------------------------------------ profile
CREATE OR REPLACE FUNCTION public.pms_guest_profile(_hotel_id text, _key text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  idn record;
  v_tz text;
  v_today date;
  p public.guests%ROWTYPE;
  v_out jsonb;
BEGIN
  SELECT * INTO idn FROM public.pms_guest_identity(_hotel_id, _key);
  IF idn.hotel_id IS NULL THEN RETURN NULL; END IF;
  IF NOT public.can_access_pms_hotel(auth.uid(), idn.hotel_id, NULL) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF idn.primary_guest_id IS NULL AND NOT EXISTS (
       SELECT 1 FROM public.reservations r
        WHERE r.hotel_id = idn.hotel_id AND r.pms_missing_since IS NULL
          AND public.pms_reservation_guest_key(r.pms_guest_name, r.pms_contact_name) = idn.name_key) THEN
    RETURN NULL;
  END IF;
  v_tz := COALESCE((SELECT c.timezone FROM public.channex_connections c WHERE c.hotel_id = idn.hotel_id LIMIT 1), 'Europe/Budapest');
  v_today := (now() AT TIME ZONE v_tz)::date;
  IF idn.primary_guest_id IS NOT NULL THEN
    SELECT * INTO p FROM public.guests WHERE id = idn.primary_guest_id;
  END IF;

  WITH stays AS (
    SELECT r.id, r.reservation_number, r.status::text AS status,
           r.check_in_date AS ci, r.check_out_date AS co,
           greatest(r.check_out_date - r.check_in_date, 0) AS nights,
           r.room_id, btrim(rm.room_number) AS room_number,
           COALESCE(rt.name, rm.room_type, r.room_type_requested) AS room_type,
           COALESCE(NULLIF(btrim(r.ota_name), ''), NULLIF(btrim(r.pms_channel), ''), r.source) AS channel,
           r.total_amount, r.currency, r.adults, r.children,
           NULLIF(btrim(r.special_requests), '') AS special_requests,
           COALESCE(NULLIF(btrim(r.pms_guest_name), ''), NULLIF(btrim(g.first_name || ' ' || g.last_name), ''), NULLIF(btrim(r.pms_contact_name), '')) AS name,
           COALESCE(NULLIF(btrim(r.pms_contact_email), ''), g.email) AS email,
           COALESCE(NULLIF(btrim(r.pms_contact_phone), ''), g.phone) AS phone,
           r.status::text NOT IN ('cancelled', 'no_show') AS counts
      FROM public.reservations r
      LEFT JOIN public.rooms rm ON rm.id = r.room_id
      LEFT JOIN public.room_types rt ON rt.id = r.room_type_id
      LEFT JOIN public.guests g ON g.id = r.guest_id
     WHERE r.hotel_id = idn.hotel_id
       AND r.pms_missing_since IS NULL
       AND ((idn.name_key IS NOT NULL AND public.pms_reservation_guest_key(r.pms_guest_name, r.pms_contact_name) = idn.name_key)
            OR r.guest_id = ANY (idn.guest_ids))
  ),
  -- Minibar and breakfast belong to the guest who slept the night before.
  minibar AS (
    SELECT s.id AS stay_id, mi.name, sum(u.quantity_used)::int AS qty
      FROM stays s
      JOIN public.room_minibar_usage u ON u.room_id = s.room_id
       AND (u.usage_date AT TIME ZONE v_tz)::date > s.ci
       AND (u.usage_date AT TIME ZONE v_tz)::date <= s.co
      JOIN public.minibar_items mi ON mi.id = u.minibar_item_id
     WHERE s.counts AND s.room_id IS NOT NULL AND u.quantity_used > 0
     GROUP BY s.id, mi.name
  ),
  breakfast AS (
    SELECT s.id AS stay_id, count(DISTINCT b.stay_date)::int AS days
      FROM stays s
      JOIN public.breakfast_attendance b ON b.hotel_id = idn.hotel_id
       AND btrim(b.room_number) = s.room_number
       AND b.stay_date > s.ci AND b.stay_date <= s.co
     WHERE s.counts AND s.room_number IS NOT NULL AND COALESCE(b.served_count, 0) > 0
     GROUP BY s.id
  ),
  orders AS (
    SELECT o.reservation_id AS stay_id, count(DISTINCT o.id)::int AS orders,
           array_agg(DISTINCT l.name_snapshot) FILTER (WHERE l.name_snapshot IS NOT NULL) AS items
      FROM public.insuite_orders o
      LEFT JOIN public.insuite_order_lines l ON l.order_id = o.id
     WHERE o.reservation_id IN (SELECT id FROM stays WHERE counts)
       AND COALESCE(o.status, '') NOT IN ('cancelled', 'rejected', 'declined')
     GROUP BY o.reservation_id
  ),
  -- In-Suite requests carry the room, not the booking: count those made
  -- between noon on arrival day and noon on departure day.
  requests AS (
    SELECT s.id AS stay_id, q.request_type AS type, count(*)::int AS n
      FROM stays s
      JOIN public.insuite_service_requests q ON q.room_id = s.room_id
       AND q.created_at >= (s.ci + time '12:00') AT TIME ZONE v_tz
       AND q.created_at < (s.co + time '12:00') AT TIME ZONE v_tz
     WHERE s.counts AND s.room_id IS NOT NULL
     GROUP BY s.id, q.request_type
  ),
  detail AS (
    SELECT s.*,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('name', m.name, 'qty', m.qty) ORDER BY m.qty DESC, m.name)
                       FROM minibar m WHERE m.stay_id = s.id), '[]'::jsonb) AS minibar,
           COALESCE((SELECT b.days FROM breakfast b WHERE b.stay_id = s.id), 0) AS breakfast_days,
           COALESCE((SELECT o.orders FROM orders o WHERE o.stay_id = s.id), 0) AS insuite_orders,
           COALESCE((SELECT to_jsonb(o.items) FROM orders o WHERE o.stay_id = s.id), '[]'::jsonb) AS insuite_items,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('type', q.type, 'count', q.n) ORDER BY q.n DESC, q.type)
                       FROM requests q WHERE q.stay_id = s.id), '[]'::jsonb) AS requests
      FROM stays s
  ),
  live AS (SELECT * FROM detail WHERE counts),
  main_currency AS (SELECT mode() WITHIN GROUP (ORDER BY currency) AS cur FROM live WHERE currency IS NOT NULL),
  latest AS (SELECT * FROM detail ORDER BY counts DESC, ci DESC LIMIT 1)
  SELECT jsonb_build_object(
    'key', CASE WHEN idn.name_key IS NOT NULL THEN 'n:' || idn.name_key ELSE 'g:' || idn.primary_guest_id END,
    'hotel_id', idn.hotel_id,
    'guest_id', idn.primary_guest_id,
    'profile_count', cardinality(idn.guest_ids),
    'has_profile', idn.primary_guest_id IS NOT NULL,
    'name', public.pms_guest_display_name(COALESCE(NULLIF(btrim(p.first_name || ' ' || p.last_name), ''), (SELECT name FROM latest))),
    'email', COALESCE(p.email, (SELECT email FROM live WHERE email IS NOT NULL ORDER BY ci DESC LIMIT 1)),
    'phone', COALESCE(p.phone, (SELECT phone FROM live WHERE phone IS NOT NULL ORDER BY ci DESC LIMIT 1)),
    'nationality', p.nationality,
    'country', p.country,
    'language', p.preferences->>'language',
    'vip', COALESCE(p.vip_status, 'regular') = 'vip',
    'company_name', p.company_name,
    'notes', p.notes,
    'tags', COALESCE(p.preferences->'tags', '[]'::jsonb),
    'dietary', p.preferences->>'dietary',
    'marketing_consent', (p.preferences->>'marketing_consent')::boolean,
    'id_on_file', p.id_document_number IS NOT NULL,
    'stats', jsonb_build_object(
      'stays', (SELECT count(DISTINCT ci) FROM live),
      'reservations', (SELECT count(*) FROM live),
      'nights', COALESCE((SELECT sum(nights) FROM live), 0),
      'avg_nights', (SELECT round(avg(nights), 1) FROM live),
      'spend', (SELECT round(sum(total_amount), 2) FROM live WHERE currency IS NOT DISTINCT FROM (SELECT cur FROM main_currency)),
      'currency', (SELECT cur FROM main_currency),
      'first_stay', (SELECT min(ci) FROM live),
      'last_stay', (SELECT max(co) FROM live WHERE ci <= v_today),
      'next_arrival', (SELECT min(ci) FROM live WHERE ci >= v_today AND status IN ('pending', 'confirmed')),
      'in_house', EXISTS (SELECT 1 FROM live WHERE status = 'checked_in'),
      'cancelled', (SELECT count(*) FROM detail WHERE NOT counts)
    ),
    'learned', jsonb_build_object(
      'room_types', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', room_type, 'stays', n) ORDER BY n DESC, room_type)
                                FROM (SELECT room_type, count(*)::int AS n FROM live WHERE room_type IS NOT NULL GROUP BY room_type ORDER BY 2 DESC, 1 LIMIT 3) x), '[]'::jsonb),
      'rooms', COALESCE((SELECT jsonb_agg(jsonb_build_object('room', room_number, 'stays', n) ORDER BY n DESC, room_number)
                           FROM (SELECT room_number, count(*)::int AS n FROM live WHERE room_number IS NOT NULL GROUP BY room_number ORDER BY 2 DESC, 1 LIMIT 3) x), '[]'::jsonb),
      'channels', COALESCE((SELECT jsonb_agg(jsonb_build_object('channel', channel, 'stays', n) ORDER BY n DESC, channel)
                              FROM (SELECT channel, count(DISTINCT ci)::int AS n FROM live WHERE channel IS NOT NULL GROUP BY channel) x), '[]'::jsonb),
      'minibar', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'qty', qty) ORDER BY qty DESC, name)
                             FROM (SELECT name, sum(qty)::int AS qty FROM minibar GROUP BY name ORDER BY 2 DESC, 1 LIMIT 5) x), '[]'::jsonb),
      'minibar_stays', (SELECT count(DISTINCT stay_id) FROM minibar),
      'breakfast_days', COALESCE((SELECT sum(breakfast_days) FROM live), 0),
      'breakfast_nights', COALESCE((SELECT sum(nights) FROM live WHERE room_number IS NOT NULL), 0),
      'insuite_orders', COALESCE((SELECT sum(insuite_orders) FROM live), 0),
      'insuite_items', COALESCE((SELECT jsonb_agg(DISTINCT i.item) FROM live, jsonb_array_elements_text(live.insuite_items) AS i(item)), '[]'::jsonb),
      'requests', COALESCE((SELECT jsonb_agg(jsonb_build_object('type', type, 'count', n) ORDER BY n DESC, type)
                              FROM (SELECT type, sum(n)::int AS n FROM requests GROUP BY type) x), '[]'::jsonb),
      'children_stays', (SELECT count(*) FROM live WHERE children > 0),
      'max_party', (SELECT max(adults + children) FROM live)
    ),
    'stays', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'reservation_number', reservation_number, 'status', status,
        'check_in_date', ci, 'check_out_date', co, 'nights', nights,
        'room_number', room_number, 'room_type', room_type, 'channel', channel,
        'total_amount', total_amount, 'currency', currency, 'adults', adults, 'children', children,
        'special_requests', left(special_requests, 600), 'minibar', minibar, 'breakfast_days', breakfast_days,
        'insuite_orders', insuite_orders, 'insuite_items', insuite_items, 'requests', requests
      ) ORDER BY ci DESC, reservation_number) FROM (SELECT * FROM detail ORDER BY ci DESC LIMIT 100) d), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END;
$fn$;

-- ------------------------------------------------------------ save preferences
-- _patch keys (all optional): tags text[], dietary text, notes text, vip boolean, nationality 'HU'.
CREATE OR REPLACE FUNCTION public.pms_guest_profile_save(_hotel_id text, _key text, _patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  idn record;
  v_gid uuid;
  v_name text;
  v_email text;
  v_phone text;
  v_org text;
  v_tags text[];
  v_prefs jsonb;
  v_nat text;
BEGIN
  SELECT * INTO idn FROM public.pms_guest_identity(_hotel_id, _key);
  IF idn.hotel_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF auth.uid() IS NULL OR NOT public.can_access_pms_hotel(auth.uid(), idn.hotel_id, NULL) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(_patch, '{}'::jsonb)) <> 'object' THEN RAISE EXCEPTION 'INVALID_PATCH'; END IF;

  v_gid := idn.primary_guest_id;
  IF v_gid IS NULL THEN
    -- First preference for a guest known only from bookings: create the profile
    -- from the latest stay. The reservations themselves are not changed.
    WITH mine AS (
      SELECT r.status::text NOT IN ('cancelled', 'no_show') AS counts, r.check_in_date,
             COALESCE(NULLIF(btrim(r.pms_guest_name), ''), NULLIF(btrim(r.pms_contact_name), '')) AS name,
             NULLIF(btrim(r.pms_contact_email), '') AS email, NULLIF(btrim(r.pms_contact_phone), '') AS phone
        FROM public.reservations r
       WHERE r.hotel_id = idn.hotel_id AND r.pms_missing_since IS NULL
         AND public.pms_reservation_guest_key(r.pms_guest_name, r.pms_contact_name) = idn.name_key
    )
    SELECT (SELECT name FROM mine ORDER BY counts DESC, check_in_date DESC LIMIT 1),
           (SELECT email FROM mine WHERE email IS NOT NULL ORDER BY counts DESC, check_in_date DESC LIMIT 1),
           (SELECT phone FROM mine WHERE phone IS NOT NULL ORDER BY counts DESC, check_in_date DESC LIMIT 1)
      INTO v_name, v_email, v_phone;
    v_name := public.pms_guest_display_name(v_name);
    IF v_name IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    SELECT o.slug INTO v_org
      FROM public.hotel_configurations hc JOIN public.organizations o ON o.id = hc.organization_id
     WHERE hc.hotel_id = idn.hotel_id;
    INSERT INTO public.guests (hotel_id, organization_slug, first_name, last_name, email, phone, preferences)
    VALUES (idn.hotel_id, v_org, split_part(v_name, ' ', 1), btrim(substr(v_name, length(split_part(v_name, ' ', 1)) + 1)),
            v_email, v_phone, jsonb_build_object('profile_source', 'bookings'))
    RETURNING id INTO v_gid;
  END IF;

  SELECT COALESCE(preferences, '{}'::jsonb) INTO v_prefs FROM public.guests WHERE id = v_gid FOR UPDATE;

  IF _patch ? 'tags' THEN
    IF jsonb_typeof(_patch->'tags') <> 'array' THEN RAISE EXCEPTION 'INVALID_TAGS'; END IF;
    SELECT array_agg(DISTINCT left(btrim(x), 40)) INTO v_tags
      FROM jsonb_array_elements_text(_patch->'tags') x WHERE btrim(x) <> '';
    IF cardinality(v_tags) > 24 THEN RAISE EXCEPTION 'TOO_MANY_TAGS'; END IF;
    v_prefs := v_prefs || jsonb_build_object('tags', to_jsonb(COALESCE(v_tags, '{}'::text[])));
  END IF;
  IF _patch ? 'dietary' THEN
    v_prefs := CASE WHEN NULLIF(btrim(_patch->>'dietary'), '') IS NULL THEN v_prefs - 'dietary'
                    ELSE v_prefs || jsonb_build_object('dietary', left(btrim(_patch->>'dietary'), 300)) END;
  END IF;
  IF _patch ? 'nationality' THEN
    v_nat := upper(NULLIF(btrim(_patch->>'nationality'), ''));
    IF v_nat IS NOT NULL AND v_nat !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'INVALID_NATIONALITY'; END IF;
  END IF;

  UPDATE public.guests SET
    preferences = v_prefs || jsonb_build_object('updated_by', auth.uid(), 'updated_at', now()),
    notes = CASE WHEN _patch ? 'notes' THEN NULLIF(left(btrim(_patch->>'notes'), 2000), '') ELSE notes END,
    vip_status = CASE WHEN _patch ? 'vip' THEN CASE WHEN (_patch->>'vip')::boolean THEN 'vip' ELSE 'regular' END ELSE vip_status END,
    nationality = CASE WHEN _patch ? 'nationality' THEN v_nat ELSE nationality END,
    updated_at = now()
  WHERE id = v_gid;

  RETURN jsonb_build_object('ok', true, 'guest_id', v_gid,
    'key', CASE WHEN idn.name_key IS NOT NULL THEN 'n:' || idn.name_key ELSE 'g:' || v_gid END);
END;
$fn$;

-- ------------------------------------------------------------ reception signals
-- For a list of reservations (today's arrivals, in-house, ...): is the guest
-- returning, how often, and what reception should know before check-in.
CREATE OR REPLACE FUNCTION public.pms_guest_signals(_reservation_ids uuid[])
RETURNS TABLE (
  reservation_id uuid,
  profile_key text,
  previous_stays integer,
  last_stay_end date,
  group_size integer,
  vip boolean,
  tags jsonb,
  dietary text,
  notes text,
  guest_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH t AS (
    SELECT r.id, r.hotel_id, r.check_in_date, r.guest_id,
           COALESCE(public.pms_reservation_guest_key(r.pms_guest_name, r.pms_contact_name),
                    public.pms_guest_name_key(g.first_name || ' ' || g.last_name)) AS k
      FROM public.reservations r
      LEFT JOIN public.guests g ON g.id = r.guest_id
     WHERE r.id = ANY (_reservation_ids[1:300])
       AND public.can_access_pms_hotel(auth.uid(), r.hotel_id, NULL)
  ),
  -- Two separate joins (name key, guest row) so each uses its index.
  gx AS (
    SELECT t.id AS tid, g.id AS gid, g.created_at
      FROM t JOIN public.guests g
        ON g.hotel_id = t.hotel_id AND public.pms_guest_name_key(g.first_name || ' ' || g.last_name) = t.k
    UNION
    SELECT t.id, g.id, g.created_at FROM t JOIN public.guests g ON g.id = t.guest_id
  ),
  ids AS (
    SELECT t.id AS tid, (SELECT array_agg(gx.gid ORDER BY gx.created_at, gx.gid) FROM gx WHERE gx.tid = t.id) AS gids
      FROM t
  ),
  m AS (
    SELECT t.id AS tid, p.id, p.check_in_date, p.check_out_date
      FROM t JOIN public.reservations p
        ON p.hotel_id = t.hotel_id AND p.pms_missing_since IS NULL
       AND public.pms_reservation_guest_key(p.pms_guest_name, p.pms_contact_name) = t.k
     WHERE p.status::text NOT IN ('cancelled', 'no_show')
    UNION
    SELECT ids.tid, p.id, p.check_in_date, p.check_out_date
      FROM ids JOIN public.reservations p ON p.guest_id = ANY (ids.gids)
     WHERE p.pms_missing_since IS NULL AND p.status::text NOT IN ('cancelled', 'no_show')
  )
  SELECT t.id,
         CASE WHEN t.k IS NOT NULL THEN 'n:' || t.k WHEN ids.gids IS NOT NULL THEN 'g:' || ids.gids[1] END,
         (SELECT count(DISTINCT m.check_in_date)::int FROM m WHERE m.tid = t.id AND m.id <> t.id AND m.check_out_date <= t.check_in_date),
         (SELECT max(m.check_out_date) FROM m WHERE m.tid = t.id AND m.id <> t.id AND m.check_out_date <= t.check_in_date),
         (SELECT count(*)::int FROM m WHERE m.tid = t.id AND m.check_in_date = t.check_in_date),
         COALESCE(pg.vip_status, 'regular') = 'vip',
         COALESCE(pg.preferences->'tags', '[]'::jsonb),
         pg.preferences->>'dietary',
         left(pg.notes, 300),
         ids.gids[1]
    FROM t
    JOIN ids ON ids.tid = t.id
    LEFT JOIN public.guests pg ON pg.id = ids.gids[1];
$fn$;

-- ------------------------------------------------------------ directory
-- Same contract as before plus profile_key and tags; one row per person.
CREATE OR REPLACE FUNCTION public.pms_guest_directory(_hotel_ids text[], _term text DEFAULT NULL, _limit int DEFAULT 50, _offset int DEFAULT 0)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
  WITH needle AS (
    SELECT CASE WHEN length(trim(coalesce(_term, ''))) >= 2
             THEN '%' || replace(replace(replace(trim(_term), '\', '\\'), '%', '\%'), '_', '\_') || '%' END AS p,
           -- Accent- and word-order-insensitive match on the name key.
           CASE WHEN length(trim(coalesce(_term, ''))) >= 2
             THEN COALESCE(public.pms_guest_name_key(_term), btrim(public.pms_fold_text(_term))) END AS f
  ),
  gk AS (
    SELECT g.*, COALESCE('n:' || public.pms_guest_name_key(g.first_name || ' ' || g.last_name), 'g:' || g.id) AS ident
      FROM guests g
     WHERE g.hotel_id = ANY(_hotel_ids)
  ),
  prim AS (
    SELECT DISTINCT ON (hotel_id, ident) * FROM gk ORDER BY hotel_id, ident, created_at, id
  ),
  res AS (
    SELECT r.hotel_id, r.status, r.check_in_date::date AS ci, r.check_out_date::date AS co,
           r.total_amount, r.currency,
           nullif(trim(regexp_replace(coalesce(r.pms_guest_name, r.pms_contact_name, ''), '\s+', ' ', 'g')), '') AS nm,
           nullif(trim(r.pms_contact_email), '') AS email,
           nullif(trim(r.pms_contact_phone), '') AS phone,
           coalesce(nullif(trim(r.ota_name), ''), nullif(trim(r.pms_channel), ''), r.source) AS channel,
           COALESCE('n:' || public.pms_reservation_guest_key(r.pms_guest_name, r.pms_contact_name), gk.ident) AS ident
      FROM reservations r
      LEFT JOIN gk ON gk.id = r.guest_id
     WHERE r.hotel_id = ANY(_hotel_ids)
       AND r.pms_missing_since IS NULL
       AND r.status NOT IN ('cancelled', 'no_show')
  ),
  stays AS (
    SELECT hotel_id, ident,
           max(nm) AS nm,
           count(DISTINCT ci) AS stays,
           sum(greatest(co - ci, 0)) AS nights,
           min(ci) AS first_stay,
           max(co) FILTER (WHERE ci <= current_date) AS last_stay,
           min(ci) FILTER (WHERE ci >= current_date AND status IN ('pending', 'confirmed')) AS next_arrival,
           bool_or(status = 'checked_in') AS in_house,
           sum(total_amount) AS spend,
           max(currency) AS currency,
           (array_agg(email ORDER BY ci DESC) FILTER (WHERE email IS NOT NULL))[1] AS email,
           (array_agg(phone ORDER BY ci DESC) FILTER (WHERE phone IS NOT NULL))[1] AS phone,
           array_agg(DISTINCT channel) FILTER (WHERE channel IS NOT NULL) AS channels
      FROM res
     WHERE ident IS NOT NULL
     GROUP BY hotel_id, ident
  ),
  directory AS (
    SELECT CASE WHEN p.id IS NOT NULL THEN 'profile' ELSE 'bookings' END AS kind,
           COALESCE(s.hotel_id, p.hotel_id) || '|' || COALESCE(s.ident, p.ident) AS key,
           COALESCE(s.ident, p.ident) AS profile_key,
           p.id AS guest_id,
           COALESCE(s.hotel_id, p.hotel_id) AS hotel_id,
           COALESCE(NULLIF(trim(p.first_name || ' ' || p.last_name), ''), s.nm) AS name,
           COALESCE(p.email, s.email) AS email,
           COALESCE(p.phone, s.phone) AS phone,
           COALESCE(p.nationality, p.country) AS nationality,
           p.vip_status, p.company_name,
           COALESCE(p.preferences->'tags', '[]'::jsonb) AS tags,
           COALESCE(s.stays, 0) AS stays, COALESCE(s.nights, 0) AS nights,
           s.first_stay, s.last_stay, s.next_arrival, COALESCE(s.in_house, false) AS in_house,
           s.spend, s.currency, s.channels
      FROM stays s
      FULL JOIN prim p ON p.hotel_id = s.hotel_id AND p.ident = s.ident
  )
  SELECT to_jsonb(d.*) || jsonb_build_object('total_count', count(*) OVER ())
    FROM directory d CROSS JOIN needle n
   WHERE n.p IS NULL OR d.name ILIKE n.p OR d.email ILIKE n.p OR d.phone ILIKE n.p OR strpos(d.profile_key, n.f) > 0
   ORDER BY d.in_house DESC, d.next_arrival NULLS LAST, d.last_stay DESC NULLS LAST, d.name
   LIMIT least(greatest(coalesce(_limit, 50), 1), 200) OFFSET greatest(coalesce(_offset, 0), 0);
$fn$;

-- ------------------------------------------------------------ grants
REVOKE ALL ON FUNCTION public.pms_guest_identity(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pms_guest_profile(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pms_guest_profile_save(text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pms_guest_signals(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pms_guest_directory(text[], text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pms_guest_profile(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pms_guest_profile_save(text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pms_guest_signals(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pms_guest_directory(text[], text, int, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pms_guest_identity(text, text) TO service_role;
