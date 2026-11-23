-- Disposable PostgreSQL acceptance suite for the Phase-3 finance guard.
-- This is NOT a migration. CI runs after ntak_fixture.sql + NTAK SQL checks.
-- Never run against production: it loads the September finance-core migration.
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS balance_due numeric(14,2),
  ADD COLUMN IF NOT EXISTS payment_status text;

CREATE OR REPLACE FUNCTION public.get_user_organization_slug(_uid uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT organization_slug FROM public.profiles WHERE id=_uid
$$;
CREATE OR REPLACE FUNCTION public.get_user_role(_uid uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT role FROM public.profiles WHERE id=_uid
$$;
CREATE OR REPLACE FUNCTION public.can_access_pms_hotel(_uid uuid, _hotel text, _org text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.hotel_access a JOIN public.profiles p ON p.id=a.user_id
    WHERE a.user_id=_uid AND a.hotel_id=_hotel AND p.organization_slug=_org)
$$;

CREATE TABLE IF NOT EXISTS public.guest_folios(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid REFERENCES public.reservations(id),
  guest_id uuid,
  description text,
  amount numeric(14,2),
  charge_type text,
  charge_date date,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.reservation_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid,
  hotel_id text,
  organization_slug text,
  event_type text,
  metadata jsonb,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);
-- The real legacy function is tested independently in the main PMS suite.
-- This stub verifies that reception takes that legacy path, NOT finance-core.
CREATE OR REPLACE FUNCTION public.pms_recalc_reservation_financials(_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM public.reservations WHERE id=_id;
END;
$$;

-- Create real finance tables/functions from the already-applied source, then
-- apply only the NEW correction migration in this disposable database.
\i /tmp/ntak_finance_core_ddl.sql
\i supabase/migrations/20261123201000_ntak_phase3_finance_guard.sql

INSERT INTO public.profiles(id, role, organization_slug)
VALUES
  ('00000000-0000-4000-8000-000000000099','admin','rdhotels'),
  ('00000000-0000-4000-8000-000000000098','admin','channex');
INSERT INTO public.hotel_access(user_id,hotel_id)
VALUES
  ('00000000-0000-4000-8000-000000000099','previo-hotel'),
  ('00000000-0000-4000-8000-000000000098','native-hotel');
INSERT INTO public.reservations(
  id,hotel_id,organization_slug,check_in_date,check_out_date,
  total_amount,currency,balance_due,payment_status,status
) VALUES
  ('00000000-0000-4000-8000-000000000001','previo-hotel','rdhotels',
   '2026-11-23','2026-11-25',200,'EUR',73,'partial','confirmed'),
  ('00000000-0000-4000-8000-000000000002','native-hotel','channex',
   '2026-11-23','2026-11-25',200,'EUR',200,'unpaid','confirmed');

INSERT INTO public.reservation_folios(
  id,organization_slug,hotel_id,reservation_id,folio_type,display_name,
  currency,base_reservation_amount
) VALUES (
  '00000000-0000-4000-8000-000000000003','rdhotels','previo-hotel',
  '00000000-0000-4000-8000-000000000001','master','Main account','EUR',200
);
INSERT INTO public.folio_lines(
  id,folio_id,source_type,description,service_date,
  quantity,unit,currency,gross_unit_price,net_total,vat_code,vat_total,gross_total
) VALUES (
  '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000003',
  'manual','Unmodified external charge','2026-11-23',1,'item','EUR',20,20,'REVIEW_REQUIRED',0,20
);
INSERT INTO public.payments(
  id,organization_slug,hotel_id,reservation_id,folio_id,amount,currency,method,status
) VALUES (
  '00000000-0000-4000-8000-000000000005','rdhotels','previo-hotel',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000003',20,'EUR','cash','recorded'
);

-- The service_date column DEFAULT and 10-parameter function must use the
-- actual Budapest business date, not the UTC connection's CURRENT_DATE.
DO $$
DECLARE d text; def text;
BEGIN
  SELECT pg_get_expr(a.adbin,a.adrelid) INTO d
  FROM pg_attrdef a JOIN pg_attribute c ON c.attrelid=a.adrelid AND c.attnum=a.adnum
  WHERE a.adrelid='public.folio_lines'::regclass AND c.attname='service_date';
  IF d NOT LIKE '%Europe/Budapest%' THEN
    RAISE EXCEPTION 'folio_lines.service_date default is not Budapest-based: %',d;
  END IF;
  SELECT pg_get_functiondef('public.pms_finance_add_charge(uuid,text,numeric,text,numeric,text,text,numeric,uuid,date)'::regprocedure) INTO def;
  IF def NOT LIKE '%_service_date date DEFAULT NULL%' OR def NOT LIKE '%COALESCE(_service_date, (now() AT TIME ZONE ''Europe/Budapest'')::date)%' THEN
    RAISE EXCEPTION 'Add-charge argument default or NULL handling regressed';
  END IF;
END $$;

-- Simulate a receptionist from the external PMS org. Each mutating finance
-- RPC must fail BEFORE the financial-core tables or imported balance change.
DO $
BEGIN
  IF public.pms_finance_is_native_pms('00000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'External reservation classified as native';
  END IF;
  IF NOT public.pms_finance_is_native_pms('00000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'Channex reservation classified as external';
  END IF;
END $;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',false);
SET ROLE authenticated;

DO $$
DECLARE
  ext uuid:='00000000-0000-4000-8000-000000000001'::uuid;
  line uuid:='00000000-0000-4000-8000-000000000004'::uuid;
  pay uuid:='00000000-0000-4000-8000-000000000005'::uuid;
BEGIN
  BEGIN
    PERFORM public.pms_finance_add_charge(ext,'Must fail',1,'item',10,'EUR','REVIEW_REQUIRED',NULL,NULL,NULL);
    RAISE EXCEPTION 'Charge incorrectly accepted for external PMS';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM IS DISTINCT FROM 'EXTERNAL_PMS_LEDGER_READ_ONLY' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.pms_finance_record_payment(ext,10,'EUR','cash',NULL,now());
    RAISE EXCEPTION 'Payment incorrectly accepted for external PMS';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM IS DISTINCT FROM 'EXTERNAL_PMS_LEDGER_READ_ONLY' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.pms_finance_void_charge(line,'Must fail');
    RAISE EXCEPTION 'Void incorrectly accepted for external PMS';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM IS DISTINCT FROM 'EXTERNAL_PMS_LEDGER_READ_ONLY' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.pms_finance_reverse_payment(pay,'Must fail');
    RAISE EXCEPTION 'Reverse incorrectly accepted for external PMS';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM IS DISTINCT FROM 'EXTERNAL_PMS_LEDGER_READ_ONLY' THEN RAISE; END IF;
  END;
END $$;

-- The original reception charge path must remain usable for external hotels.
SELECT public.pms_record_business_folio_item(
  '00000000-0000-4000-8000-000000000001',
  'Reception guest service',12,'other',NULL,NULL
);
RESET ROLE;

DO $$
DECLARE ext uuid:='00000000-0000-4000-8000-000000000001'::uuid;
BEGIN
  IF (SELECT balance_due FROM public.reservations WHERE id=ext) IS DISTINCT FROM 73
     OR (SELECT payment_status FROM public.reservations WHERE id=ext) IS DISTINCT FROM 'partial' THEN
    RAISE EXCEPTION 'External PMS balance/payment_status overwritten';
  END IF;
  IF (SELECT count(*) FROM public.guest_folios WHERE reservation_id=ext) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Reception did not write legacy guest_folios';
  END IF;
  IF (SELECT count(*) FROM public.folio_lines WHERE folio_id='00000000-0000-4000-8000-000000000003') IS DISTINCT FROM 1
     OR (SELECT status FROM public.folio_lines WHERE id='00000000-0000-4000-8000-000000000004') IS DISTINCT FROM 'open'
     OR (SELECT status FROM public.payments WHERE id='00000000-0000-4000-8000-000000000005') IS DISTINCT FROM 'recorded' THEN
    RAISE EXCEPTION 'External finance-core mutation was not prevented';
  END IF;
  -- Even direct service-role recalculation must preserve imported numbers.
  PERFORM public.pms_finance_recalculate_reservation(ext);
  IF (SELECT balance_due FROM public.reservations WHERE id=ext) IS DISTINCT FROM 73 THEN
    RAISE EXCEPTION 'Direct finance recalculation overwrote external balance';
  END IF;
END $$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000098',false);
SET ROLE authenticated;
-- Native channex PMS still records charges with NULL date and payments.
SELECT public.pms_finance_add_charge(
  '00000000-0000-4000-8000-000000000002','Native service',
  1,'item',10,'EUR','REVIEW_REQUIRED',NULL,NULL,NULL
);
SELECT public.pms_finance_record_payment(
  '00000000-0000-4000-8000-000000000002',40,'EUR','cash',NULL,now()
);
RESET ROLE;

DO $$
DECLARE native uuid:='00000000-0000-4000-8000-000000000002'::uuid;
BEGIN
  IF (SELECT balance_due FROM public.reservations WHERE id=native) IS DISTINCT FROM 170
    OR (SELECT payment_status FROM public.reservations WHERE id=native) IS DISTINCT FROM 'partial' THEN
    RAISE EXCEPTION 'Native PMS finance flow regressed';
  END IF;
  IF (SELECT service_date FROM public.folio_lines WHERE description='Native service')
     IS DISTINCT FROM (now() AT TIME ZONE 'Europe/Budapest')::date THEN
    RAISE EXCEPTION 'NULL service_date did not default to Budapest today';
  END IF;
END $$;
