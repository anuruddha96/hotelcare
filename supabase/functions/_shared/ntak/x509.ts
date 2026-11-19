/**
 * Minimal DER/X.509 toolkit for the NTAK universal certificate (6.1):
 *  - PKCS#10 CSR generation: RSA 4096, SHA-256, keyUsage + clientAuth,
 *    a fresh key pair for every request (each private key may be used once);
 *  - certificate parsing (subject, issuer, serial, validity, public key);
 *  - key/certificate matching and PKCS#1 -> PKCS#8 conversion for keys
 *    generated outside HotelCare.
 * WebCrypto only, no dependencies.
 */

// ---------------------------------------------------------------------------
// DER encoding

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

function len(n: number): Uint8Array {
  if (n < 0x80) return new Uint8Array([n]);
  const bytes: number[] = [];
  while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

export const tlv = (tag: number, body: Uint8Array) => concat(new Uint8Array([tag]), len(body.length), body);
export const seq = (...parts: Uint8Array[]) => tlv(0x30, concat(...parts));
export const set = (...parts: Uint8Array[]) => tlv(0x31, concat(...parts));
export const derNull = () => new Uint8Array([0x05, 0x00]);
export const octets = (b: Uint8Array) => tlv(0x04, b);
export const bitString = (b: Uint8Array, unused = 0) => tlv(0x03, concat(new Uint8Array([unused]), b));
export const utf8 = (s: string) => tlv(0x0c, new TextEncoder().encode(s));
export const bool = (v: boolean) => new Uint8Array([0x01, 0x01, v ? 0xff : 0x00]);
export const ctx = (n: number, body: Uint8Array, constructed = true) => tlv((constructed ? 0xa0 : 0x80) | n, body);

export function int(value: number | Uint8Array): Uint8Array {
  let b = typeof value === 'number' ? new Uint8Array([value & 0xff]) : value;
  while (b.length > 1 && b[0] === 0 && (b[1] & 0x80) === 0) b = b.subarray(1);
  if (b[0] & 0x80) b = concat(new Uint8Array([0]), b);
  return tlv(0x02, b);
}

export function oid(dotted: string): Uint8Array {
  const parts = dotted.split('.').map(Number);
  const out = [40 * parts[0] + parts[1]];
  for (const p of parts.slice(2)) {
    const stack = [p & 0x7f];
    let v = p >>> 7;
    while (v > 0) { stack.unshift((v & 0x7f) | 0x80); v >>>= 7; }
    out.push(...stack);
  }
  return tlv(0x06, new Uint8Array(out));
}

// ---------------------------------------------------------------------------
// DER decoding

export interface Tlv { tag: number; start: number; end: number; header: number; bytes: Uint8Array }

export function readTlv(buf: Uint8Array, offset = 0): Tlv {
  const tag = buf[offset];
  let l = buf[offset + 1];
  let header = 2;
  if (l & 0x80) {
    const n = l & 0x7f;
    l = 0;
    for (let i = 0; i < n; i++) l = (l * 256) + buf[offset + 2 + i];
    header += n;
  }
  const start = offset + header;
  const end = start + l;
  if (end > buf.length) throw new Error('Truncated DER');
  return { tag, start, end, header, bytes: buf.subarray(offset, end) };
}

export function children(buf: Uint8Array, parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  let o = parent.start;
  while (o < parent.end) { const t = readTlv(buf, o); out.push(t); o = t.end; }
  return out;
}

function oidToString(b: Uint8Array): string {
  const out = [Math.floor(b[0] / 40), b[0] % 40];
  let v = 0;
  for (const x of b.subarray(1)) { v = (v * 128) + (x & 0x7f); if (!(x & 0x80)) { out.push(v); v = 0; } }
  return out.join('.');
}

const NAME_OIDS: Record<string, string> = {
  '2.5.4.3': 'CN', '2.5.4.5': 'serialNumber', '2.5.4.6': 'C', '2.5.4.7': 'L', '2.5.4.8': 'ST', '2.5.4.10': 'O',
  '2.5.4.11': 'OU', '2.5.4.97': 'organizationIdentifier', '1.2.840.113549.1.9.1': 'emailAddress',
};

function parseName(buf: Uint8Array, name: Tlv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rdn of children(buf, name)) for (const atv of children(buf, rdn)) {
    const [type, value] = children(buf, atv);
    const k = NAME_OIDS[oidToString(buf.subarray(type.start, type.end))] ?? oidToString(buf.subarray(type.start, type.end));
    const v = new TextDecoder().decode(buf.subarray(value.start, value.end));
    out[k] = out[k] ? `${out[k]}, ${v}` : v;
  }
  return out;
}

function parseTime(buf: Uint8Array, t: Tlv): string {
  const s = new TextDecoder().decode(buf.subarray(t.start, t.end));
  const m = t.tag === 0x17
    ? s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/)
    : s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) throw new Error(`Unsupported certificate time ${s}`);
  const year = t.tag === 0x17 ? (Number(m[1]) >= 50 ? 1900 : 2000) + Number(m[1]) : Number(m[1]);
  return new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]))).toISOString();
}

// ---------------------------------------------------------------------------
// PEM

export function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----(BEGIN|END)[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function b64(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i += 0x8000) bin += String.fromCharCode(...arr.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function derToPem(der: Uint8Array | ArrayBuffer, label: string): string {
  const lines = b64(der).match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

export const pemLabel = (pem: string) => pem.match(/-----BEGIN ([^-]+)-----/)?.[1] ?? null;

/** First certificate of a PEM bundle (NTAK may deliver a chain). */
export function firstCertificatePem(pem: string): string | null {
  return pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)?.[0] ?? null;
}

/** Accept PKCS#8 ("PRIVATE KEY") or PKCS#1 ("RSA PRIVATE KEY"); return PKCS#8 PEM. */
export function normalizePrivateKeyPem(pem: string): string {
  const label = pemLabel(pem);
  if (label === 'PRIVATE KEY') return derToPem(pemToDer(pem), 'PRIVATE KEY');
  if (label === 'RSA PRIVATE KEY') {
    const pkcs8 = seq(int(0), seq(oid('1.2.840.113549.1.1.1'), derNull()), octets(pemToDer(pem)));
    return derToPem(pkcs8, 'PRIVATE KEY');
  }
  if (label === 'ENCRYPTED PRIVATE KEY') throw new Error('Encrypted private keys are not supported: export the key without a password');
  throw new Error('Unrecognized private key format');
}

// ---------------------------------------------------------------------------
// Certificates

export interface CertificateInfo {
  serialHex: string;
  subject: Record<string, string>;
  issuer: Record<string, string>;
  notBefore: string;
  notAfter: string;
  spki: Uint8Array;
}

export function parseCertificate(pem: string): CertificateInfo {
  const der = pemToDer(pem);
  const cert = readTlv(der);
  const [tbs] = children(der, cert);
  const f = children(der, tbs);
  const i = f[0].tag === 0xa0 ? 1 : 0; // optional explicit version
  const serial = der.subarray(f[i].start, f[i].end);
  const validity = children(der, f[i + 3]);
  return {
    serialHex: Array.from(serial, (b) => b.toString(16).padStart(2, '0')).join('').replace(/^00(?=[89a-f])/, ''),
    issuer: parseName(der, f[i + 2]),
    subject: parseName(der, f[i + 4]),
    notBefore: parseTime(der, validity[0]),
    notAfter: parseTime(der, validity[1]),
    spki: der.slice(f[i + 5].start - f[i + 5].header, f[i + 5].end),
  };
}

/** RSA modulus (hex) from SubjectPublicKeyInfo DER. */
export function rsaModulusFromSpki(spki: Uint8Array): string {
  const top = readTlv(spki);
  const [, bits] = children(spki, top);
  const inner = spki.subarray(bits.start + 1, bits.end); // skip unused-bits byte
  const rsa = readTlv(inner);
  const [n] = children(inner, rsa);
  return Array.from(inner.subarray(n.start, n.end), (b) => b.toString(16).padStart(2, '0')).join('').replace(/^(00)+/, '');
}

const b64urlToHex = (s: string) => Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').replace(/^(00)+/, '');

/** True when the PKCS#8 private key belongs to the certificate. */
export async function keyMatchesCertificate(keyPem: string, certPem: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(normalizePrivateKeyPem(keyPem)) as BufferSource, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, true, ['sign']);
  const jwk = await crypto.subtle.exportKey('jwk', key);
  return !!jwk.n && b64urlToHex(jwk.n) === rsaModulusFromSpki(parseCertificate(certPem).spki);
}

/** NTAK treats the universal certificate as expired 3 days before notAfter (6.1). */
export function effectiveExpiry(notAfterIso: string): Date {
  return new Date(Date.parse(notAfterIso) - 3 * 86400000);
}

// ---------------------------------------------------------------------------
// CSR

export interface CsrResult { csrPem: string; privateKeyPem: string; spkiSha256: string }

/** PKCS#10 request as in the spec's openssl example (12.1.3). */
export async function generateCsr(commonName: string, modulusLength = 4096): Promise<CsrResult> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  ) as CryptoKeyPair;
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));

  const subject = seq(set(seq(oid('2.5.4.3'), utf8(commonName))));
  const keyUsage = seq(oid('2.5.29.15'), bool(true), octets(bitString(new Uint8Array([0xe0]), 5)));
  const extKeyUsage = seq(oid('2.5.29.37'), octets(seq(oid('1.3.6.1.5.5.7.3.2'))));
  const extensionRequest = seq(oid('1.2.840.113549.1.9.14'), set(seq(keyUsage, extKeyUsage)));
  const info = seq(int(0), subject, spki, ctx(0, extensionRequest));
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, info as BufferSource));
  const csr = seq(info, seq(oid('1.2.840.113549.1.1.11'), derNull()), bitString(signature));

  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', spki as BufferSource));
  return { csrPem: derToPem(csr, 'CERTIFICATE REQUEST'), privateKeyPem: derToPem(pkcs8, 'PRIVATE KEY'), spkiSha256: b64(digest) };
}

export async function spkiSha256(spki: Uint8Array): Promise<string> {
  return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', spki as BufferSource)));
}
