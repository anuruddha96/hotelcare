-- Run only in an empty, disposable CI database.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
CREATE TABLE public.guests(id uuid PRIMARY KEY,date_of_birth date,postal_code text,nationality text,country text);
CREATE TABLE public.reservations(id uuid PRIMARY KEY,hotel_id text,check_in_date date,check_out_date date,actual_check_in timestamptz,actual_check_out timestamptz);
CREATE TABLE public.reservation_guests(reservation_id uuid,guest_id uuid,ifa_status text);
CREATE TABLE public.ntak_guest_ids(hotel_id text,guest_id uuid,vendeg_id text);
CREATE TABLE public.ntak_daily_closures(hotel_id text,closed_day date,accepted_once boolean,needs_correction boolean DEFAULT false,correction_detected_at timestamptz,updated_at timestamptz,snapshot jsonb,PRIMARY KEY(hotel_id,closed_day));
CREATE TABLE public.reservation_folios(id uuid PRIMARY KEY,hotel_id text);
CREATE TABLE public.folio_lines(id uuid PRIMARY KEY,folio_id uuid,service_date date,room_id uuid,gross_total numeric,vat_rate numeric,currency text,status text,source_type text,service_catalog_item_id uuid);
CREATE TABLE public.payments(id uuid PRIMARY KEY,reservation_id uuid,hotel_id text,amount numeric,currency text,method text,status text,received_at timestamptz);
\ir ../migrations/20261124010300_ntak_phase7_ifa_corrections.sql
INSERT INTO guests VALUES ('00000000-0000-0000-0000-000000000001','1986-01-01','1111','RU','HU');
INSERT INTO reservations VALUES ('00000000-0000-0000-0000-000000000002','test','2026-11-01','2026-11-03',NULL,NULL);
INSERT INTO reservation_guests VALUES ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','KOTELES');
INSERT INTO ntak_guest_ids VALUES ('test','00000000-0000-0000-0000-000000000001','stable-id');
INSERT INTO ntak_daily_closures(hotel_id,closed_day,accepted_once,snapshot) VALUES
('test','2026-11-01',true,'{"closure":{"nights":[{"guests":[{"vendegId":"stable-id"}]}]}}'),
('test','2026-11-02',false,'{"closure":{"nights":[{"guests":[{"vendegId":"stable-id"}]}]}}'),
('test','2026-11-10',true,'{"closure":{"nights":[{"guests":[{"vendegId":"other-id"}]}]}}'),
('other','2026-11-01',true,'{"closure":{"nights":[{"guests":[{"vendegId":"stable-id"}]}]}}');
UPDATE guests SET date_of_birth='1987-02-11';
DO $$ BEGIN
 IF (SELECT count(*) FROM ntak_daily_closures WHERE needs_correction) <> 1 OR NOT (SELECT needs_correction FROM ntak_daily_closures WHERE hotel_id='test' AND closed_day='2026-11-01') THEN RAISE EXCEPTION 'DOB edit scope incorrect'; END IF;
END $$;
UPDATE ntak_daily_closures SET needs_correction=false;
UPDATE reservation_guests SET ifa_status='im5';
DO $$ BEGIN
 IF (SELECT count(*) FROM ntak_daily_closures WHERE needs_correction) <> 1 OR NOT (SELECT needs_correction FROM ntak_daily_closures WHERE hotel_id='test' AND closed_day='2026-11-01') THEN RAISE EXCEPTION 'IFA edit scope incorrect'; END IF;
END $$;
UPDATE ntak_daily_closures SET needs_correction=false;
INSERT INTO reservation_folios VALUES ('00000000-0000-0000-0000-000000000003','test');
INSERT INTO folio_lines(id,folio_id,service_date,gross_total) VALUES ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000003','2026-11-01',400);
DO $$ BEGIN
 IF (SELECT count(*) FROM ntak_daily_closures WHERE needs_correction) <> 1 THEN RAISE EXCEPTION 'Charge insertion scope incorrect'; END IF;
END $$;
UPDATE ntak_daily_closures SET needs_correction=false;
UPDATE folio_lines SET gross_total=500;
DO $$ BEGIN
 IF (SELECT count(*) FROM ntak_daily_closures WHERE needs_correction) <> 1 THEN RAISE EXCEPTION 'Charge edit scope incorrect'; END IF;
END $$;
UPDATE ntak_daily_closures SET needs_correction=false;
INSERT INTO payments VALUES ('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000002','test',1000,'HUF','cash','completed','2026-10-30T10:00:00Z');
DO $$ BEGIN
 IF (SELECT count(*) FROM ntak_daily_closures WHERE needs_correction) <> 1 OR NOT (SELECT needs_correction FROM ntak_daily_closures WHERE hotel_id='test' AND closed_day='2026-11-01') THEN RAISE EXCEPTION 'Advance payment correction day incorrect'; END IF;
END $$;
UPDATE ntak_daily_closures SET needs_correction=false;
UPDATE payments SET amount=1200;
DO $$ BEGIN
 IF (SELECT count(*) FROM ntak_daily_closures WHERE needs_correction) <> 1 THEN RAISE EXCEPTION 'Payment edit scope incorrect'; END IF;
END $$;
-- Deliberately break bookkeeping; all four source writes must survive.
CREATE OR REPLACE FUNCTION public.ntak_phase7_dirty_guest(_guest uuid,_reservation uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic NTAK bookkeeping failure'; END $$;
CREATE OR REPLACE FUNCTION public.ntak_phase7_dirty_day(_hotel text,_day date)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic NTAK bookkeeping failure'; END $$;
UPDATE public.guests SET date_of_birth='1987-02-12';
UPDATE public.reservation_guests SET ifa_status='KOTELES';
UPDATE public.folio_lines SET gross_total=501;
UPDATE public.payments SET amount=1201;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM guests WHERE date_of_birth='1987-02-12') OR NOT EXISTS(SELECT 1 FROM reservation_guests WHERE ifa_status='KOTELES')
 OR NOT EXISTS(SELECT 1 FROM folio_lines WHERE gross_total=501) OR NOT EXISTS(SELECT 1 FROM payments WHERE amount=1201)
 THEN RAISE EXCEPTION 'NTAK bookkeeping failure blocked source write'; END IF;
END $$;
ROLLBACK;
