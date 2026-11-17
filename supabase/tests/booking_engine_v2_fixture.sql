-- Extra fixture for the booking engine v2 migration. Runs after
-- booking_engine_fixture.sql, before the booking engine, wellness and v2
-- migrations. Adds what production already has and the v2 code uses.

ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS pms_contact_name text;

-- Guest identity (verbatim from 20261117160000_guest_journey.sql).
CREATE OR REPLACE FUNCTION public.pms_fold_text(_text text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT pg_catalog.lower(pg_catalog.translate(coalesce(_text, ''),
    'ÁÀÂÄÃÅĄĀÇĆČĎĐÉÈÊËĚĘĒĖÍÌÎÏĪĮİĹĽŁŃŇÑÓÒÔÖŐÕØŌŔŘŚŠŞȘŤȚÚÙÛÜŰŮŪŲÝŸŹŻŽÆŒáàâäãåąāçćčďđéèêëěęēėíìîïīįıĺľłńňñóòôöőõøōŕřśšşșťțúùûüűůūųýÿźżžæœßğĞ',
    'AAAAAAAACCCDDEEEEEEEEIIIIIIILLLNNNOOOOOOOORRSSSSTTUUUUUUUUYYZZZAOaaaaaaaacccddeeeeeeeeiiiiiiilllnnnoooooooorrssssttuuuuuuuuyyzzzaosgG'));
$fn$;
CREATE OR REPLACE FUNCTION public.pms_guest_name_key(_name text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT (
    SELECT CASE
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
CREATE OR REPLACE FUNCTION public.pms_reservation_guest_key(_guest_name text, _contact_name text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT public.pms_guest_name_key(COALESCE(NULLIF(pg_catalog.btrim(_guest_name), ''), NULLIF(pg_catalog.btrim(_contact_name), '')));
$fn$;

-- In-Suite request table (production shape, only the columns read here).
CREATE TABLE IF NOT EXISTS public.insuite_booking_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  reservation_id uuid,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'requested',
  starts_at timestamptz NOT NULL DEFAULT now()
);

-- Top management of the native hotel.
INSERT INTO public.profiles (id, role, is_super_admin, organization_slug, hotel_ids) VALUES
  ('00000000-0000-0000-0000-00000000aaa4', 'top_management', false, 'channex', ARRAY['native-hotel']);
