# HotelCare THF gateway (self-hosted VIZA THF)

A small TLS adapter that runs **on a self-hosted VIZA THF server** ("saját THF").

## Why
A self-hosted THF presents a server certificate signed with `ecdsa-with-SHA512` (P-521 CA,
"TESZT VIZA THF ServerAuthSigning CA 2023" in the test system). The Supabase edge runtime that
runs HotelCare's VIZA client cannot verify that algorithm and refuses the connection
(`invalid peer certificate: UnsupportedSignatureAlgorithm`, confirmed 23 and 24 Nov 2026).
The central THF is not affected.

## How it works
```
HotelCare (edge function) --TLS, gateway CA pinned--> relay 34.116.154.20 (CONNECT :443)
    --> gateway :443 on the THF server --mutual TLS with the hotel's NTAK certificate--> THF :7843
```
- The SOAP request body (including its WS-Security signature), the THF's status and its
  answer pass through unchanged.
- The THF still checks the hotel's NTAK client certificate. HotelCare sends the certificate and
  its key with each request in `X-HC-Client-Cert` / `X-HC-Client-Key` (base64 PEM), inside the
  TLS connection to the gateway. The gateway keeps them in an anonymous in-memory file while it
  opens the THF connection: never on disk, never logged, never kept between requests.
- HotelCare only sends the key when the gateway's certificate chains to the pinned gateway CA
  (`viza_settings.thf_ca_pem`); without a pinned CA it refuses.
- The gateway accepts only `POST /ws` (plus `GET /healthz`) and forwards only to the local THF.
  It holds no credentials apart from its own TLS key.
- Errors come back as a SOAP fault starting with `HotelCare THF gateway:`.

## Install (as root on the THF server)
1. Free port 443: the THF installer publishes `7843:8443`; remove any extra `443:8443` mapping
   from the THF's `docker-compose.yml` and run `docker compose up -d` in the THF directory.
2. Put the THF server CA certificate (PEM) next to these files, then:
   `sudo FQDN=thf-test.hotelcare.app THF_CA_FILE=./viza-thf-ca.pem ./install.sh`
3. The script prints the gateway CA. Copy it into HotelCare.
4. The firewall must allow tcp 443 from the relay (34.116.154.20) only.

## HotelCare settings for the hotel
`viza_settings`: `thf_url = https://<FQDN>/ws`, `thf_ca_pem = <gateway CA>`, `thf_via_gateway = true`.
With `thf_via_gateway = false` (default) HotelCare connects directly, as before.

## Check
- `curl --cacert /etc/hc-thf-gateway/ca.crt --resolve <FQDN>:443:127.0.0.1 https://<FQDN>/healthz` → `ok`
- `journalctl -u hc-thf-gateway` shows one line per request (address, request line, status).

## Remove
`systemctl disable --now hc-thf-gateway && rm -rf /opt/hc-thf-gateway /etc/hc-thf-gateway /etc/systemd/system/hc-thf-gateway.service && userdel hcgw`,
then set `thf_via_gateway = false` in HotelCare.

## Production note
For a hotel running its own THF the gateway runs on that hotel's THF server and receives that
hotel's own NTAK key per request. A key-less variant (the gateway asks HotelCare to sign the TLS
handshake instead of receiving the key) is possible later if required.
