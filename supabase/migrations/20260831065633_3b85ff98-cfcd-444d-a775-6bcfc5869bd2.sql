INSERT INTO public.restaurant_webhook_sources (property_slug, hotel_id, secret_name, outlet_slugs, is_active)
VALUES
  ('mika', '759ab802-4cb0-457c-a65f-40af62d98ed0', 'RESTAURANT_WEBHOOK_SECRET_MIKA', ARRAY['brunch','restaurant','mitico'], true),
  ('ottofiori', 'e375d541-10b5-4486-a92a-cbf0cac09ee9', 'RESTAURANT_WEBHOOK_SECRET_OTTOFIORI', ARRAY['brunch','restaurant','mitico'], true),
  ('gozsdu', '969b9987-f577-4cda-aa2c-6b0eb6c3ef41', 'RESTAURANT_WEBHOOK_SECRET_GOZSDU', ARRAY['brunch','restaurant','mitico'], true)
ON CONFLICT (property_slug) DO UPDATE
  SET hotel_id = EXCLUDED.hotel_id,
      outlet_slugs = EXCLUDED.outlet_slugs,
      is_active = true,
      updated_at = now();