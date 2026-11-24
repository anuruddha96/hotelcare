-- Self-hosted VIZA THF reached through the HotelCare THF gateway
-- (ops/viza-thf-gateway). A self-hosted THF presents a certificate signed with
-- ecdsa-with-SHA512, which the edge runtime cannot verify. With this flag on,
-- HotelCare opens TLS to the gateway on the THF server (pinned to thf_ca_pem,
-- the gateway's CA) and hands it the hotel's NTAK client certificate with each
-- request; the gateway opens the mutual-TLS connection to the THF. Messages and
-- their signatures pass through unchanged. Default false: direct connection.
ALTER TABLE public.viza_settings ADD COLUMN IF NOT EXISTS thf_via_gateway boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.viza_settings.thf_via_gateway IS
  'Self-hosted THF via the HotelCare THF gateway (ops/viza-thf-gateway); thf_ca_pem then holds the gateway CA.';
