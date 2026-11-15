/**
 * Minimal WS-Security (X.509 token + XML-DSig) for the THF SOAP endpoint.
 *
 * Instead of a generic canonicalizer, the envelope is SERIALIZED in exclusive-
 * c14n form from the start: every namespace is declared on the element where
 * it is first used, attributes are written in a fixed order, there is no
 * whitespace between tags. Digests are then computed over the exact bytes we
 * send, which is what the verifier's c14n of the parsed document yields for
 * subtrees built this way.
 *
 * Algorithms mirror the guide's sample: rsa-sha384 signature; digests sha-256.
 * TO VERIFY against the UAT THF once the NTAK test certificates arrive.
 */

const NS = {
  soapenv: 'http://schemas.xmlsoap.org/soap/envelope/',
  v1: 'http://vizainfo.hu/thf/v1',
  wsse: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd',
  wsu: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd',
  ds: 'http://www.w3.org/2000/09/xmldsig#',
  excC14n: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  b64: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary',
  x509v3: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3',
  rsaSha384: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha384',
  sha256: 'http://www.w3.org/2001/04/xmlenc#sha256',
};

const te = new TextEncoder();

export function b64encode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) bin += String.fromCharCode(...arr.subarray(i, i + chunk));
  return btoa(bin);
}

export function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----(BEGIN|END)[^-]+-----/g, '').replace(/[\s\r\n]/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function importRsaKey(pemPkcs8: string, hash: 'SHA-256' | 'SHA-384'): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    pemToDer(pemPkcs8),
    { name: 'RSASSA-PKCS1-v1_5', hash },
    false,
    ['sign'],
  );
}

export async function sha256(data: string | Uint8Array): Promise<Uint8Array> {
  const bytes = typeof data === 'string' ? te.encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

/** Sign the accommodation validation string: SHA-256 via RSA (spec 3.2–3.3). */
export async function signEllenorzoString(ellenorzoString: string, signKey: CryptoKey): Promise<string> {
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signKey, te.encode(ellenorzoString));
  return b64encode(sig);
}

export interface SignedEnvelopeInput {
  /** Inner request XML using the v1: prefix (from messages.ts builders). */
  bodyXml: string;
  /** PMS (NTAK) client certificate, PEM; goes into the BinarySecurityToken. */
  clientCertPem: string;
  /** Private key (PKCS8 PEM) matching the client certificate. */
  clientKey: CryptoKey;
  now?: Date;
  ttlMinutes?: number;
}

const iso = (d: Date) => d.toISOString(); // ms precision, Z zone

/**
 * Build the complete signed SOAP envelope. The Body (with every namespace it
 * uses declared on itself) and the Timestamp are signed.
 */
export async function buildSignedEnvelope(input: SignedEnvelopeInput): Promise<string> {
  const now = input.now ?? new Date();
  const expires = new Date(now.getTime() + (input.ttlMinutes ?? 10) * 60000);
  const bodyId = 'id-' + crypto.randomUUID();
  const tsId = 'TS-' + crypto.randomUUID();
  const tokenId = 'X509-' + crypto.randomUUID();

  // Exclusive-c14n-shaped subtrees: each namespace is declared exactly where
  // exc-c14n first emits it (soapenv + wsu on Body because Body uses both;
  // v1 on the request's root element inside bodyXml), attributes in c14n
  // order, no inter-tag whitespace and no self-closing tags.
  const bodyC14n =
    `<soapenv:Body xmlns:soapenv="${NS.soapenv}" xmlns:wsu="${NS.wsu}" wsu:Id="${bodyId}">${input.bodyXml}</soapenv:Body>`;
  const timestampC14n =
    `<wsu:Timestamp xmlns:wsu="${NS.wsu}" wsu:Id="${tsId}">`
    + `<wsu:Created>${iso(now)}</wsu:Created>`
    + `<wsu:Expires>${iso(expires)}</wsu:Expires>`
    + `</wsu:Timestamp>`;

  const bodyDigest = b64encode(await sha256(bodyC14n));
  const tsDigest = b64encode(await sha256(timestampC14n));

  const signedInfoC14n =
    `<ds:SignedInfo xmlns:ds="${NS.ds}">`
    + `<ds:CanonicalizationMethod Algorithm="${NS.excC14n}"></ds:CanonicalizationMethod>`
    + `<ds:SignatureMethod Algorithm="${NS.rsaSha384}"></ds:SignatureMethod>`
    + `<ds:Reference URI="#${bodyId}">`
    + `<ds:Transforms><ds:Transform Algorithm="${NS.excC14n}"></ds:Transform></ds:Transforms>`
    + `<ds:DigestMethod Algorithm="${NS.sha256}"></ds:DigestMethod>`
    + `<ds:DigestValue>${bodyDigest}</ds:DigestValue>`
    + `</ds:Reference>`
    + `<ds:Reference URI="#${tsId}">`
    + `<ds:Transforms><ds:Transform Algorithm="${NS.excC14n}"></ds:Transform></ds:Transforms>`
    + `<ds:DigestMethod Algorithm="${NS.sha256}"></ds:DigestMethod>`
    + `<ds:DigestValue>${tsDigest}</ds:DigestValue>`
    + `</ds:Reference>`
    + `</ds:SignedInfo>`;

  const signature = b64encode(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', input.clientKey, te.encode(signedInfoC14n)));
  const token = b64encode(pemToDer(input.clientCertPem));

  return '<?xml version="1.0" encoding="UTF-8"?>'
    + `<soapenv:Envelope xmlns:soapenv="${NS.soapenv}">`
    + '<soapenv:Header>'
    + `<wsse:Security xmlns:wsse="${NS.wsse}" soapenv:mustUnderstand="1">`
    + `<wsse:BinarySecurityToken xmlns:wsu="${NS.wsu}" EncodingType="${NS.b64}" ValueType="${NS.x509v3}" wsu:Id="${tokenId}">${token}</wsse:BinarySecurityToken>`
    + timestampC14n
    + `<ds:Signature xmlns:ds="${NS.ds}">`
    + signedInfoC14n
    + `<ds:SignatureValue>${signature}</ds:SignatureValue>`
    + '<ds:KeyInfo>'
    + `<wsse:SecurityTokenReference><wsse:Reference URI="#${tokenId}" ValueType="${NS.x509v3}"></wsse:Reference></wsse:SecurityTokenReference>`
    + '</ds:KeyInfo>'
    + '</ds:Signature>'
    + '</wsse:Security>'
    + '</soapenv:Header>'
    + bodyC14n
    + '</soapenv:Envelope>';
}
