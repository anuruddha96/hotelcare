-- Optional In-Suite guest personalization. Printed QR access never discloses
-- occupant names until surname + departure date have been verified.
ALTER TABLE public.insuite_devices
  ADD COLUMN IF NOT EXISTS guest_verify_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guest_verify_locked_until timestamptz;
COMMENT ON COLUMN public.insuite_devices.guest_verify_failures
  IS 'Server-side failed self-verification attempts; never exposed to guest browser.';
