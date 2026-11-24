/**
 * Transport tests (no network).
 *   deno test supabase/functions/_shared/ntak/transport_test.ts
 */
import { strict as assert } from 'node:assert';
import { gatewayCredentialHeaders, postSoap } from './transport.ts';

const CERT = '-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----';
const KEY = '-----BEGIN PRIVATE KEY-----\nMIIEfake\n-----END PRIVATE KEY-----\n';

Deno.test('gateway headers carry the PEM text base64-encoded, one trailing newline', () => {
  const h = gatewayCredentialHeaders(CERT, KEY);
  assert.deepEqual(Object.keys(h).sort(), ['X-HC-Client-Cert', 'X-HC-Client-Key']);
  assert.equal(atob(h['X-HC-Client-Cert']), CERT + '\n');
  assert.equal(atob(h['X-HC-Client-Key']), KEY.trim() + '\n');
  assert.ok(!/[\r\n]/.test(h['X-HC-Client-Key']), 'header values must be single-line');
});

Deno.test('gateway mode refuses to send the key without a pinned gateway CA', async () => {
  const res = await postSoap('<x/>', { url: 'https://thf.example.test/ws', certPem: CERT, keyPem: KEY, forwardClientCredentials: true, caCertsPem: null });
  assert.equal(res.status, 0);
  assert.equal(res.certificateProblem, true);
  assert.match(res.error ?? '', /gateway CA/);
});

Deno.test('plain https is still required', async () => {
  const res = await postSoap('<x/>', { url: 'http://thf.example.test/ws', certPem: CERT, keyPem: KEY, forwardClientCredentials: true, caCertsPem: CERT });
  assert.match(res.error ?? '', /HTTPS/);
});
