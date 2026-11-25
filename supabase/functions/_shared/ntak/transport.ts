/**
 * HTTPS transport to the NTAK SOAP endpoint (Deno edge runtime only).
 *
 * The universal certificate authenticates the TLS connection (mTLS) and signs
 * the message. NTAK whitelists source IPs, and Supabase Edge Functions have
 * no fixed egress IP, so requests can go through an HTTP CONNECT proxy on a
 * fixed-IP host (NTAK_EGRESS_PROXY_URL): the tunnel keeps TLS end-to-end, the
 * proxy never sees the key or the payload.
 */

export interface TransportOptions {
  url: string;
  certPem: string;
  keyPem: string;
  proxyUrl?: string | null;
  proxyUser?: string | null;
  proxyPassword?: string | null;
  /** Extra trusted CA certificates (PEM), e.g. the private CA of a self-hosted THF (VIZA guide 3.4). Added to the default roots. */
  caCertsPem?: string | null;
  /**
   * Gateway mode for a self-hosted VIZA THF (ops/viza-thf-gateway): the TLS
   * connection goes to the HotelCare THF gateway on the THF server instead of
   * the THF itself, and the client certificate and key are handed to the
   * gateway with the request (gatewayCredentialHeaders), which opens the
   * mutual-TLS connection to the THF. Requires caCertsPem (the gateway's CA),
   * so the key is only sent to a server holding a certificate from that CA.
   * Never used for NTAK.
   */
  forwardClientCredentials?: boolean;
  timeoutMs?: number;
}

/** Headers that carry the client certificate and key to the THF gateway (base64 of the PEM text). */
export function gatewayCredentialHeaders(certPem: string, keyPem: string): Record<string, string> {
  const b64 = (pem: string) => btoa(pem.trim() + '\n');
  return { 'X-HC-Client-Cert': b64(certPem), 'X-HC-Client-Key': b64(keyPem) };
}

export interface TransportResult {
  status: number; // 0 when the request never got an HTTP answer
  body: string;
  error: string | null;
  /** TLS/certificate failure: stop automatic sending until fixed (6.1.4). */
  certificateProblem: boolean;
  elapsedMs: number;
}

const CERT_HINTS = /certificate (expired|revoked|unknown)|bad certificate|unknown ca|handshake failure|tlsv1 alert|certificate_required|access denied/i;

export async function postSoap(envelope: string, opts: TransportOptions): Promise<TransportResult> {
  const started = Date.now();
  if (!URL.canParse(opts.url) || new URL(opts.url).protocol !== 'https:') {
    return { status: 0, body: '', error: 'Reporting endpoint requires HTTPS', certificateProblem: false, elapsedMs: 0 };
  }
  // deno-lint-ignore no-explicit-any
  const DenoAny = (globalThis as any).Deno;
  if (!DenoAny?.createHttpClient) {
    return { status: 0, body: '', error: 'mTLS client (Deno.createHttpClient) is not available in this runtime', certificateProblem: false, elapsedMs: 0 };
  }
  const proxy = opts.proxyUrl
    ? { url: opts.proxyUrl, ...(opts.proxyUser ? { basicAuth: { username: opts.proxyUser, password: opts.proxyPassword ?? '' } } : {}) }
    : undefined;
  let client: { close(): void } | null = null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30000);
  try {
    const caCerts = splitPemCertificates(opts.caCertsPem);
    const viaGateway = opts.forwardClientCredentials === true;
    if (viaGateway && !caCerts.length) {
      return { status: 0, body: '', error: 'THF gateway mode needs the gateway CA certificate (thf_ca_pem)', certificateProblem: true, elapsedMs: 0 };
    }
    client = DenoAny.createHttpClient({
      // Gateway mode: no client certificate on this hop; the gateway presents it to the THF.
      ...(viaGateway ? {} : { cert: opts.certPem, key: opts.keyPem }),
      ...(proxy ? { proxy } : {}),
      ...(caCerts.length ? { caCerts } : {}),
    });
    const res = await fetch(opts.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: '""',
        ...(viaGateway ? gatewayCredentialHeaders(opts.certPem, opts.keyPem) : {}),
      },
      body: envelope,
      redirect: 'error',
      signal: ctrl.signal,
      // deno-lint-ignore no-explicit-any
      ...({ client } as any),
    });
    const body = await res.text();
    const certificateProblem = (res.status === 401 || res.status === 403) && !/Envelope/i.test(body);
    return { status: res.status, body, error: res.ok || /Envelope/i.test(body) ? null : `HTTP ${res.status}`, certificateProblem, elapsedMs: Date.now() - started };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { status: 0, body: '', error: ctrl.signal.aborted ? 'timeout' : message, certificateProblem: CERT_HINTS.test(message), elapsedMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
    try { client?.close(); } catch { /* ignore */ }
  }
}

/** Every certificate block of a PEM bundle, each as its own PEM string. */
export function splitPemCertificates(pem: string | null | undefined): string[] {
  return String(pem ?? '').match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
}

/** Retry schedule after server/network errors: 1, 10 and 60 minutes, then stop (7.5). */
export function nextRetryDelayMinutes(attempt: number): number | null {
  return [1, 10, 60][attempt - 1] ?? null;
}
