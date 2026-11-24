#!/usr/bin/env python3
"""
HotelCare THF gateway: a TLS adapter between HotelCare and a self-hosted
VIZA THF ("saját THF").

Why it exists
  A self-hosted THF presents a server certificate signed with
  ecdsa-with-SHA512 (P-521 CA). The cloud runtime that runs HotelCare's VIZA
  client cannot verify that algorithm (rustls: UnsupportedSignatureAlgorithm),
  so it cannot open TLS to the THF directly. This gateway runs on the THF
  server, presents a certificate the runtime accepts (P-256 / SHA-256, issued
  by the gateway's own CA, which HotelCare pins), and opens the real
  connection to the THF with OpenSSL.

What passes through unchanged
  The SOAP request body (byte for byte, including its WS-Security signature),
  the THF's status code and the THF's answer body.

Client certificate
  The THF authenticates the caller with the accommodation provider's NTAK
  certificate (mutual TLS). HotelCare sends that certificate and its key with
  each request, base64-encoded in the X-HC-Client-Cert / X-HC-Client-Key
  headers, inside the TLS connection to this gateway. They are kept in an
  anonymous in-memory file only while the THF connection is set up: never
  written to disk, never logged, never cached between requests.

Scope
  Only POST to the THF service path(s) is accepted, and requests are only
  forwarded to the local THF. The gateway holds no credentials of its own
  apart from its TLS key, so reaching it gives nothing a caller could not
  already do with their own NTAK certificate.

Configuration (environment, defaults in brackets)
  GW_LISTEN_HOST [0.0.0.0]   GW_LISTEN_PORT [443]
  GW_CERT [/etc/hc-thf-gateway/gateway.crt]  GW_KEY [/etc/hc-thf-gateway/gateway.key]
  THF_HOST [127.0.0.1]  THF_PORT [7843]  THF_SERVER_NAME [thf-test.hotelcare.app]
  THF_CA [/etc/hc-thf-gateway/thf-ca.pem]  THF_PATHS [/ws]
  GW_MAX_BODY [4194304]  GW_TIMEOUT [60]
"""
import base64
import http.client
import os
import socket
import ssl
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from xml.sax.saxutils import escape

LISTEN_HOST = os.environ.get("GW_LISTEN_HOST", "0.0.0.0")
LISTEN_PORT = int(os.environ.get("GW_LISTEN_PORT", "443"))
GW_CERT = os.environ.get("GW_CERT", "/etc/hc-thf-gateway/gateway.crt")
GW_KEY = os.environ.get("GW_KEY", "/etc/hc-thf-gateway/gateway.key")
THF_HOST = os.environ.get("THF_HOST", "127.0.0.1")
THF_PORT = int(os.environ.get("THF_PORT", "7843"))
THF_SERVER_NAME = os.environ.get("THF_SERVER_NAME", "thf-test.hotelcare.app")
THF_CA = os.environ.get("THF_CA", "/etc/hc-thf-gateway/thf-ca.pem")
THF_PATHS = {p.strip() for p in os.environ.get("THF_PATHS", "/ws").split(",") if p.strip()}
MAX_BODY = int(os.environ.get("GW_MAX_BODY", str(4 * 1024 * 1024)))
TIMEOUT = float(os.environ.get("GW_TIMEOUT", "60"))
FORWARDED_HEADERS = ("content-type", "soapaction", "accept")


def soap_fault(message: str) -> bytes:
    """Errors come back as a SOAP fault so HotelCare shows the reason as-is."""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">'
        "<soap:Body><soap:Fault><faultcode>soap:Server</faultcode>"
        "<faultstring>HotelCare THF gateway: " + escape(message) + "</faultstring>"
        "</soap:Fault></soap:Body></soap:Envelope>"
    ).encode("utf-8")


def _memory_file(data: bytes) -> int:
    fd = os.memfd_create("hc-thf-gw", os.MFD_CLOEXEC)
    os.write(fd, data)
    return fd


def thf_context(cert_pem: bytes, key_pem: bytes) -> ssl.SSLContext:
    """TLS context towards the THF: verifies the THF's chain, presents the
    caller's NTAK certificate. The PEMs only live in anonymous memory files."""
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.load_verify_locations(cafile=THF_CA)
    # THF_CA may be the issuing (intermediate) CA only, as VIZA's test THF CA is;
    # the THF sends its leaf only. Trust that CA as an anchor, like HotelCare does.
    ctx.verify_flags |= ssl.VERIFY_X509_PARTIAL_CHAIN
    ctx.check_hostname = True
    cert_fd = _memory_file(cert_pem)
    key_fd = _memory_file(key_pem)
    try:
        ctx.load_cert_chain(certfile=f"/proc/self/fd/{cert_fd}", keyfile=f"/proc/self/fd/{key_fd}")
    finally:
        os.close(cert_fd)
        os.close(key_fd)
    return ctx


class Handler(BaseHTTPRequestHandler):
    server_version = "HotelCare-THF-Gateway/1.0"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # request line and status only; never headers or bodies
        sys.stderr.write("%s %s\n" % (self.client_address[0], fmt % args))

    def _reply(self, status: int, body: bytes, content_type: str = "text/xml; charset=utf-8"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)
        self.close_connection = True

    def do_GET(self):
        if self.path == "/healthz":
            return self._reply(200, b"ok\n", "text/plain; charset=utf-8")
        return self._reply(404, b"not found\n", "text/plain; charset=utf-8")

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path not in THF_PATHS:
            return self._reply(404, soap_fault("unknown path"))
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            return self._reply(411, soap_fault("Content-Length required"))
        if length < 0 or length > MAX_BODY:
            return self._reply(413, soap_fault("request too large"))
        body = self.rfile.read(length)
        if len(body) != length:
            return self._reply(400, soap_fault("incomplete request body"))

        cert_b64 = self.headers.get("X-HC-Client-Cert")
        key_b64 = self.headers.get("X-HC-Client-Key")
        if not cert_b64 or not key_b64:
            return self._reply(400, soap_fault("client certificate missing (gateway mode is not enabled for this hotel in HotelCare)"))
        try:
            ctx = thf_context(base64.b64decode(cert_b64, validate=True), base64.b64decode(key_b64, validate=True))
        except (ValueError, ssl.SSLError, OSError) as err:
            return self._reply(400, soap_fault("client certificate not usable (%s)" % type(err).__name__))
        finally:
            cert_b64 = key_b64 = None

        headers = {k: v for k, v in self.headers.items() if k.lower() in FORWARDED_HEADERS}
        headers["Host"] = THF_SERVER_NAME
        headers["Content-Length"] = str(len(body))
        try:
            raw = socket.create_connection((THF_HOST, THF_PORT), timeout=TIMEOUT)
            try:
                tls = ctx.wrap_socket(raw, server_hostname=THF_SERVER_NAME)
            except BaseException:
                raw.close()
                raise
            conn = http.client.HTTPConnection(THF_SERVER_NAME, THF_PORT, timeout=TIMEOUT)
            conn.sock = tls
            try:
                conn.request("POST", self.path, body=body, headers=headers)
                res = conn.getresponse()
                answer = res.read()
                status = res.status
                content_type = res.getheader("Content-Type") or "text/xml; charset=utf-8"
            finally:
                conn.close()
        except ssl.SSLError as err:
            return self._reply(502, soap_fault("TLS connection to the THF failed (%s)" % (err.reason or type(err).__name__)))
        except (OSError, http.client.HTTPException) as err:
            return self._reply(502, soap_fault("THF not reachable (%s)" % type(err).__name__))
        finally:
            ctx = None
        self._reply(status, answer, content_type)


class TLSServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, handler, context: ssl.SSLContext):
        super().__init__(address, handler)
        self.context = context

    def finish_request(self, request, client_address):
        # TLS handshake in the worker thread, so a slow client cannot block accept().
        request.settimeout(TIMEOUT)
        try:
            tls = self.context.wrap_socket(request, server_side=True)
        except (ssl.SSLError, OSError):
            return
        try:
            self.RequestHandlerClass(tls, client_address, self)
        finally:
            try:
                tls.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            tls.close()


def main():
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(GW_CERT, GW_KEY)
    for path in (THF_CA,):
        if not os.path.isfile(path):
            sys.exit("missing %s" % path)
    server = TLSServer((LISTEN_HOST, LISTEN_PORT), Handler, context)
    sys.stderr.write("HotelCare THF gateway on %s:%d -> %s:%d (%s)\n" % (LISTEN_HOST, LISTEN_PORT, THF_HOST, THF_PORT, THF_SERVER_NAME))
    server.serve_forever()


if __name__ == "__main__":
    main()
