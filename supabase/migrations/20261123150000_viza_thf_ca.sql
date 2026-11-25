-- A self-hosted THF presents a certificate from VIZA's own CA, which is not in
-- the public trust store. The PMS must verify the THF against that CA (VIZA
-- guide 3.4), so the CA certificate (public data, PEM) is kept per hotel.
-- NULL = the THF has a publicly trusted certificate (central test THF).
ALTER TABLE public.viza_settings ADD COLUMN IF NOT EXISTS thf_ca_pem text;
