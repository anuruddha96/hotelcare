#!/usr/bin/env bash
# Install or update the HotelCare THF gateway on a self-hosted VIZA THF server.
#
#   sudo FQDN=thf-test.hotelcare.app THF_CA_FILE=./viza-thf-ca.pem ./install.sh
#
# FQDN         the THF server name HotelCare uses (also the THF certificate name)
# THF_CA_FILE  CA certificate (PEM) that issued the THF's server certificate
# THF_PORT     host port of the THF (default 7843, the installer's default)
#
# Port 443 must be free: HotelCare reaches the THF server through its fixed-IP
# relay, which only tunnels to port 443. The gateway takes 443; the THF stays
# on THF_PORT. Re-running keeps the existing gateway certificate.
set -euo pipefail
FQDN="${FQDN:?set FQDN, e.g. thf-test.hotelcare.app}"
THF_CA_FILE="${THF_CA_FILE:?set THF_CA_FILE to the THF server CA certificate (PEM)}"
THF_PORT="${THF_PORT:-7843}"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }
openssl x509 -in "$THF_CA_FILE" -noout >/dev/null || { echo "THF_CA_FILE is not a PEM certificate" >&2; exit 1; }
if ss -ltnH 'sport = :443' | grep -q . && ! systemctl is-active --quiet hc-thf-gateway; then
  echo "port 443 is in use by another program (remove the THF's 443 port mapping first)" >&2; exit 1
fi

id hcgw >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin hcgw
install -d -m 0755 /opt/hc-thf-gateway
install -m 0644 "$SRC_DIR/gateway.py" /opt/hc-thf-gateway/gateway.py
install -d -m 0750 -o root -g hcgw /etc/hc-thf-gateway
install -m 0644 "$THF_CA_FILE" /etc/hc-thf-gateway/thf-ca.pem

cd /etc/hc-thf-gateway
if [ ! -s gateway.crt ] || [ ! -s gateway.key ]; then
  (
    umask 077
    openssl ecparam -name prime256v1 -genkey -noout -out ca.key
    openssl req -x509 -new -key ca.key -sha256 -days 1095 \
      -subj "/O=Ceylon Business Services Kft./CN=HotelCare THF Gateway CA ($FQDN)" \
      -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" -out ca.crt
    openssl ecparam -name prime256v1 -genkey -noout -out gateway.key
    openssl req -new -key gateway.key -subj "/CN=$FQDN" -out gateway.csr
    printf "subjectAltName=DNS:%s\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\n" "$FQDN" > leaf.ext
    openssl x509 -req -in gateway.csr -CA ca.crt -CAkey ca.key -set_serial "0x$(openssl rand -hex 16)" \
      -sha256 -days 825 -extfile leaf.ext -out gateway.crt
    # The CA key is not kept: replacing the certificate means a new CA, pinned again in HotelCare.
    rm -f ca.key gateway.csr leaf.ext
  )
  chmod 0644 ca.crt gateway.crt
  chown root:hcgw gateway.key
  chmod 0640 gateway.key
fi
printf "THF_SERVER_NAME=%s\nTHF_PORT=%s\n" "$FQDN" "$THF_PORT" > /etc/hc-thf-gateway/env

install -m 0644 "$SRC_DIR/hc-thf-gateway.service" /etc/systemd/system/hc-thf-gateway.service
systemctl daemon-reload
systemctl enable hc-thf-gateway >/dev/null
systemctl restart hc-thf-gateway
sleep 1
systemctl is-active hc-thf-gateway
echo "--- Gateway CA for HotelCare (viza_settings.thf_ca_pem):"
cat /etc/hc-thf-gateway/ca.crt
