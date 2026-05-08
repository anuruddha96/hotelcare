-- Create the Previo test hotel under the hotelcare organization, plus its PMS configuration
INSERT INTO public.hotel_configurations (hotel_id, hotel_name, organization_id, is_active)
VALUES (
  'previo-test',
  'Previo Test Hotel (730099)',
  '6a594a40-baa9-4cc4-bb70-44178d2f4b99',
  true
)
ON CONFLICT (hotel_id) DO UPDATE SET
  hotel_name = EXCLUDED.hotel_name,
  organization_id = EXCLUDED.organization_id,
  is_active = EXCLUDED.is_active;

INSERT INTO public.pms_configurations (
  hotel_id, pms_type, pms_hotel_id, is_active, sync_enabled,
  credentials_secret_name, auto_sync_enabled, connection_mode
) VALUES (
  'previo-test', 'previo', '730099', true, true,
  'PREVIO_HOTEL_TEST', false, 'manual'
)
ON CONFLICT DO NOTHING;