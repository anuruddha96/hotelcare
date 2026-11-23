-- Disposable PostgreSQL fixture only. Phase 2 policy is tested separately;
-- this fixture checks the walk-in RPC actually calls the authorization boundary.
CREATE TABLE public.service_catalog_items (
  id uuid PRIMARY KEY, organization_slug text NOT NULL, name text NOT NULL,
  category text NOT NULL, default_gross_price numeric(14,2) NOT NULL,
  currency text NOT NULL DEFAULT 'HUF', vat_rate numeric(7,4),
  allowed_hotel_ids text[] NOT NULL DEFAULT '{}', is_active boolean NOT NULL DEFAULT true,
  requires_manager_approval boolean NOT NULL DEFAULT false, price_editable boolean NOT NULL DEFAULT true
);
CREATE OR REPLACE FUNCTION public.get_user_organization_slug(_actor uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT organization_slug FROM public.profiles WHERE id=_actor
$$;
CREATE OR REPLACE FUNCTION public.pms_assert_business_moment(_hotel_id text,_org_slug text,_moment timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='manager')
    OR NOT public.can_access_pms_hotel(auth.uid(),_hotel_id,_org_slug)
  THEN RAISE EXCEPTION 'BACKDATING_REQUIRES_MANAGER'; END IF;
END $$;
INSERT INTO public.profiles(id,role,organization_slug) VALUES
 ('00000000-0000-4000-8000-000000000074','reception','channex');
INSERT INTO public.hotel_access(user_id,hotel_id) VALUES
 ('00000000-0000-4000-8000-000000000074','channex-test-property');
INSERT INTO public.service_catalog_items(id,organization_slug,name,category,default_gross_price,vat_rate,allowed_hotel_ids) VALUES
 ('00000000-0000-4000-8000-000000000201','channex','Spa','spa',5800,18,ARRAY['channex-test-property']),
 ('00000000-0000-4000-8000-000000000202','channex','Main course','restaurant',4600,5,ARRAY['channex-test-property']),
 ('00000000-0000-4000-8000-000000000203','channex','Other catering','other',1000,27,ARRAY['channex-test-property']),
 ('00000000-0000-4000-8000-000000000204','channex','Alcoholic drinks package','bar',10000,27,ARRAY['channex-test-property']),
 ('00000000-0000-4000-8000-000000000205','other','Other tenant','spa',100,18,ARRAY['different-hotel']);
