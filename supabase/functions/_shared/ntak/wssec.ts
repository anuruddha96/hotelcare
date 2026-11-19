/**
 * WS-Security for the NTAK PMS endpoint (9.1.7): Timestamp (NTAK accepts the
 * message for 300 s after Created), BinarySecurityToken with the universal
 * certificate, and an exclusive-c14n XML signature over the Body and the
 * Timestamp; KeyInfo is a DirectReference to the token. Default algorithms
 * mirror the spec's Wss4j example (rsa-sha384 / sha384); rsa-sha256 and
 * rsa-sha512 are also accepted by NTAK.
 *
 * The signed subtrees are serialized directly in exclusive-c14n form (see
 * messages.ts), so digests are computed over the exact bytes sent.
 * verifyEnvelope() re-checks a signed envelope independently of how it was
 * built (used by tests and the self-test action).
 */
import { b64, parseCertificate, pemToDer, normalizePrivateKeyPem } from './x509.ts';

export type SignatureProfile = 'rsa-sha384' | 'rsa-sha256' | 'rsa-sha512';

const NS = {
  soapenv: 'http://schemas.xmlsoap.org/soap/envelope/',
  wsse: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd',
  wsu: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd',
  ds: 'http://www.w3.org/2000/09/xmldsig#',
  excC14n: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  b64: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary',
  x509v3: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3',
};

const PROFILES: Record<SignatureProfile, { sig: string; digest: string; hash: 'SHA-256' | 'SHA-384' | 'SHA-512' }> = {
  'rsa-sha384': { sig: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha384', digest: 'http://www.w3.org/2001/04/xmldsig-more#sha384', hash: 'SHA-384' },
  'rsa-sha256': { sig: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256', digest: 'http://www.w3.org/2001/04/xmlenc#sha256', hash: 'SHA-256' },
  'rsa-sha512': { sig: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha512', digest: 'http://www.w3.org/2001/04/xmlenc#sha512', hash: 'SHA-512' },
};

const te = new TextEncoder();

export function importSigningKey(privateKeyPem: string, profile: SignatureProfile = 'rsa-sha384'): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', pemToDer(normalizePrivateKeyPem(privateKeyPem)) as BufferSource,
    { name: 'RSASSA-PKCS1-v1_5', hash: PROFILES[profile].hash }, false, ['sign']);
}

async function digest(hash: string, data: string): Promise<string> {
  return b64(new Uint8Array(await crypto.subtle.digest(hash, te.encode(data))));
}

const isoMs = (d: Date) => d.toISOString();

export interface SignInput {
  requestXml: string; // root request element with its own xmlns:v9 declaration
  certPem: string;
  key: CryptoKey;
  profile?: SignatureProfile;
  now?: Date;
  ttlSeconds?: number;
}

export async function signEnvelope(input: SignInput): Promise<string> {
  const p = PROFILES[input.profile ?? 'rsa-sha384'];
  const now = input.now ?? new Date();
  const expires = new Date(now.getTime() + (input.ttlSeconds ?? 300) * 1000);
  const bodyId = 'id-' + crypto.randomUUID();
  const tsId = 'TS-' + crypto.randomUUID();
  const tokenId = 'X509-' + crypto.randomUUID();

  const body = `<soapenv:Body xmlns:soapenv="${NS.soapenv}" xmlns:wsu="${NS.wsu}" wsu:Id="${bodyId}">${input.requestXml}</soapenv:Body>`;
  const timestamp = `<wsu:Timestamp xmlns:wsu="${NS.wsu}" wsu:Id="${tsId}"><wsu:Created>${isoMs(now)}</wsu:Created><wsu:Expires>${isoMs(expires)}</wsu:Expires></wsu:Timestamp>`;
  const ref = (id: string, value: string) => `<ds:Reference URI="#${id}"><ds:Transforms><ds:Transform Algorithm="${NS.excC14n}"></ds:Transform></ds:Transforms>`
    + `<ds:DigestMethod Algorithm="${p.digest}"></ds:DigestMethod><ds:DigestValue>${value}</ds:DigestValue></ds:Reference>`;
  const signedInfo = `<ds:SignedInfo xmlns:ds="${NS.ds}"><ds:CanonicalizationMethod Algorithm="${NS.excC14n}"></ds:CanonicalizationMethod>`
    + `<ds:SignatureMethod Algorithm="${p.sig}"></ds:SignatureMethod>`
    + ref(tsId, await digest(p.hash, timestamp)) + ref(bodyId, await digest(p.hash, body)) + '</ds:SignedInfo>';
  const signature = b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', input.key, te.encode(signedInfo))));

  return '<?xml version="1.0" encoding="UTF-8"?>'
    + `<soapenv:Envelope xmlns:soapenv="${NS.soapenv}"><soapenv:Header>`
    + `<wsse:Security xmlns:wsse="${NS.wsse}" soapenv:mustUnderstand="1">`
    + timestamp
    + `<wsse:BinarySecurityToken xmlns:wsu="${NS.wsu}" EncodingType="${NS.b64}" ValueType="${NS.x509v3}" wsu:Id="${tokenId}">${b64(pemToDer(input.certPem))}</wsse:BinarySecurityToken>`
    + `<ds:Signature xmlns:ds="${NS.ds}">${signedInfo}<ds:SignatureValue>${signature}</ds:SignatureValue>`
    + `<ds:KeyInfo><wsse:SecurityTokenReference><wsse:Reference URI="#${tokenId}" ValueType="${NS.x509v3}"></wsse:Reference></wsse:SecurityTokenReference></ds:KeyInfo>`
    + '</ds:Signature></wsse:Security></soapenv:Header>'
    + body + '</soapenv:Envelope>';
}

export interface VerifyResult { ok: boolean; problems: string[] }

/**
 * Independent re-check of an envelope produced by signEnvelope(): extracts the
 * referenced subtrees by id, recomputes digests and verifies the signature
 * with the public key of the embedded token. Valid for envelopes serialized
 * in c14n form (ours); not a general-purpose XML-DSig verifier.
 */
export async function verifyEnvelope(envelope: string): Promise<VerifyResult> {
  const problems: string[] = [];
  const signedInfo = envelope.match(/<ds:SignedInfo[\s\S]*?<\/ds:SignedInfo>/)?.[0];
  const sigValue = envelope.match(/<ds:SignatureValue>([^<]+)<\/ds:SignatureValue>/)?.[1];
  const token = envelope.match(/<wsse:BinarySecurityToken[^>]*>([^<]+)<\/wsse:BinarySecurityToken>/)?.[1];
  if (!signedInfo || !sigValue || !token) return { ok: false, problems: ['signature parts missing'] };
  const sigAlg = signedInfo.match(/SignatureMethod Algorithm="([^"]+)"/)?.[1];
  const profile = Object.values(PROFILES).find((x) => x.sig === sigAlg);
  if (!profile) return { ok: false, problems: [`unsupported signature algorithm ${sigAlg}`] };

  const refs = [...signedInfo.matchAll(/<ds:Reference URI="#([^"]+)">[\s\S]*?<ds:DigestMethod Algorithm="([^"]+)"><\/ds:DigestMethod><ds:DigestValue>([^<]+)<\/ds:DigestValue>/g)];
  if (refs.length < 2) problems.push('expected Body and Timestamp references');
  for (const [, id, alg, value] of refs) {
    const hash = Object.values(PROFILES).find((x) => x.digest === alg)?.hash;
    const open = new RegExp(`<([\\w-]+:[\\w-]+)[^>]*wsu:Id="${id}"[^>]*>`).exec(envelope);
    if (!open || !hash) { problems.push(`reference ${id} not found`); continue; }
    const close = `</${open[1]}>`;
    const end = envelope.indexOf(close, open.index) + close.length;
    const subtree = envelope.slice(open.index, end);
    if (await digest(hash, subtree) !== value) problems.push(`digest mismatch for ${id}`);
  }

  const certPem = `-----BEGIN CERTIFICATE-----\n${token}\n-----END CERTIFICATE-----`;
  const key = await crypto.subtle.importKey('spki', parseCertificate(certPem).spki as BufferSource, { name: 'RSASSA-PKCS1-v1_5', hash: profile.hash }, false, ['verify']);
  const sig = Uint8Array.from(atob(sigValue), (c) => c.charCodeAt(0));
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, te.encode(signedInfo))) problems.push('signature value does not verify');

  const created = envelope.match(/<wsu:Created>([^<]+)<\/wsu:Created>/)?.[1];
  if (!created) problems.push('timestamp missing');
  return { ok: problems.length === 0, problems };
}
