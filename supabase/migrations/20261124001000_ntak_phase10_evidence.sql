-- Phase 10: signed wire evidence, separate from the reusable unsigned
-- ntak_messages.request_xml template. One row for each send and each poll.
CREATE TABLE IF NOT EXISTS public.ntak_message_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.ntak_messages(id) ON DELETE RESTRICT,
  hotel_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test','production')),
  kind text NOT NULL CHECK (kind IN ('booking','event','closure','start_date')),
  ref text NOT NULL,
  phase text NOT NULL CHECK (phase IN ('send','verify')),
  uzenet_id uuid NOT NULL,
  query_id uuid,
  sent_at timestamptz NOT NULL,
  evidence_day date NOT NULL,
  request_xml text,
  response_xml text,
  processing_id uuid,
  status text NOT NULL,
  http_status integer,
  completed_at timestamptz,
  CHECK ((phase = 'verify') = (query_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ntak_evidence_send_once ON public.ntak_message_evidence(uzenet_id) WHERE phase = 'send';
CREATE UNIQUE INDEX IF NOT EXISTS ntak_evidence_verify_once ON public.ntak_message_evidence(uzenet_id, query_id) WHERE phase = 'verify';
CREATE INDEX IF NOT EXISTS ntak_evidence_hotel_day ON public.ntak_message_evidence(hotel_id, evidence_day, sent_at, id) WHERE phase = 'send';
CREATE INDEX IF NOT EXISTS ntak_evidence_attempt ON public.ntak_message_evidence(hotel_id, uzenet_id, sent_at);
ALTER TABLE public.ntak_message_evidence ENABLE ROW LEVEL SECURITY;
-- Only the service role can access this table; the leadership-only edge action
-- authorizes the selected hotel before reading. Never expose to staff directly.
REVOKE ALL ON public.ntak_message_evidence FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ntak_message_evidence TO service_role;
COMMENT ON TABLE public.ntak_message_evidence IS 'NTAK signed SOAP request/response per send and verification attempt; no private key or transport credentials. Missing legacy evidence must not be reconstructed.';
