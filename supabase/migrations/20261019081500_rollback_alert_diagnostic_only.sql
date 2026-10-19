-- 19 Oct 2026: retain unconfirmed rollback counter spikes as diagnostics, not
-- emailed operational failures. Other anomaly kinds remain fully operational.
-- This status is terminal for the email worker: no pretend email sent marker,
-- no retry storm, and no loss of diagnostic evidence.
ALTER TABLE public.system_anomaly_alerts
  DROP CONSTRAINT IF EXISTS system_anomaly_alerts_status_check;
ALTER TABLE public.system_anomaly_alerts
  ADD CONSTRAINT system_anomaly_alerts_status_check
  CHECK (status IN ('pending', 'sending', 'sent', 'observed'));
COMMENT ON COLUMN public.system_anomaly_alerts.status IS
  'observed = diagnostic-only anomaly, retained without sending email; pending/sending/sent are email delivery states.';
