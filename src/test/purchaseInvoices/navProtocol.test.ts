import { describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { sha3_512Hex } from '../../../supabase/functions/_shared/purchaseInvoices/sha3';
import {
  navPasswordHash, navRequestSignature, newNavRequestId, signatureTimestampMask, validateNavCredentials,
} from '../../../supabase/functions/_shared/purchaseInvoices/navCrypto';
import {
  buildQueryInvoiceData, buildQueryInvoiceDigest, buildQueryTaxpayer, NavConfigError, NAV_BASE_URLS, softwareFromEnv,
} from '../../../supabase/functions/_shared/purchaseInvoices/navRequest';
import * as navRequestModule from '../../../supabase/functions/_shared/purchaseInvoices/navRequest';
import {
  classifyNavError, decodeInvoiceData, NavApiError, navSourceKey, navVatRateToKind, parseInvoiceDataResponse,
  parseInvoiceDataXml, parseInvoiceDigestResponse, parseNavEnvelope, parseTaxpayerResponse,
} from '../../../supabase/functions/_shared/purchaseInvoices/navResponse';
import { NavClient } from '../../../supabase/functions/_shared/purchaseInvoices/navClient';
import { parseXml, XmlParseError } from '../../../supabase/functions/_shared/purchaseInvoices/xml';
import {
  isSyncDue, nextRetryDelayMs, planBackfillWindows, planIncrementalWindows, planInitialWindows, splitDateRange, splitTimestampRange,
} from '../../../supabase/functions/_shared/purchaseInvoices/navSyncPlan';
import {
  digestResponseXml, emptyDataResponseXml, errorResponseXml, invoiceDataResponseXml, invoiceDataXml, TEST_AUTH, TEST_SOFTWARE, validTaxCore,
} from './navFixtures';

describe('NAV v3.0 cryptography (Interface Specification 1.3.2 / 1.5)', () => {
  it('implements FIPS 202 SHA3-512', () => {
    expect(sha3_512Hex('')).toBe('a69f73cca23a9ac5c8b567dc185a756e97c982164fe25859e0d1dcc1475c80a615b2123af1f5f94c11e3e9402c3ac558f500199d95b6d3e301758586281dcd26');
    expect(sha3_512Hex('abc')).toBe('b751850b1a57168a5693cd924b6b096e08f621827444f70d884f5d0240d2712e10e116e9192af3c91a7ec57647e3934057340b4cf408d5a56592f8274eec53f0');
    expect(sha3_512Hex('x'.repeat(200))).toHaveLength(128); // multi-block absorb
  });

  it('reproduces the official NAV index-hash example', () => {
    expect(sha3_512Hex('CREATEQWJjZDEyMzQ=').toUpperCase()).toBe(
      '4317798460962869BC67F07C48EA7E4A3AFA301513CEB87B8EB94ECF92BC220A89C480F87F0860E85E29A3B6C0463D4F29712C5AD48104A6486CE839DC2F24CB',
    );
  });

  it('computes the query requestSignature from requestId + YYYYMMDDhhmmss + signing key', () => {
    expect(signatureTimestampMask('2017-12-30T18:25:45.000Z')).toBe('20171230182545');
    expect(navRequestSignature('TSTKFT1222564', '2017-12-30T18:25:45.000Z', 'ce-8f5e-215119fa7dd621DLMRHRLH2S')).toBe(
      '0493F2F0247A2DF076775631FFDFA8B6D39D051F4928D26426CD29895EEDB24960A23E4C6443A54806EA8B0E126A7B97940169FEADE6EE42FC99E3BE6F74AB04',
    );
    expect(() => signatureTimestampMask('2017-12-30 18:25:45')).toThrow();
  });

  it('hashes the password with uppercase SHA-512', async () => {
    expect(await navPasswordHash('Secret&Pass<1>')).toBe(
      '05F045EF4F8B84D3B729902DC7A86EBB85616D2F1FA68015AD3867E9CB80973D2ACDA3E1C2B58C8BBBB9A56A6703A73DF4968FFFF31C0EC8C08432AA88466FFC',
    );
  });

  it('generates unique request ids within the NAV pattern', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newNavRequestId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^[+a-zA-Z0-9_]{1,30}$/);
  });

  it('validates credential shape without echoing secrets', () => {
    const bad = validateNavCredentials({ login: 'ab', password: '', signingKey: 'short' });
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(' ')).not.toContain('short');
    const good = validateNavCredentials({ login: 'abcdef123456789', password: 'x', signingKey: TEST_AUTH.signingKey, exchangeKey: '1234567890ABCDEF' });
    expect(good).toMatchObject({ ok: true, errors: [] });
  });
});

describe('NAV request builders', () => {
  it('builds a schema-shaped INBOUND digest request', async () => {
    const req = await buildQueryInvoiceDigest(TEST_AUTH, TEST_SOFTWARE, { page: 1, issueDate: { from: '2026-10-01', to: '2026-10-31' } }, new Date('2026-11-17T08:00:00.123Z'));
    const root = parseXml(req.xml);
    expect(root.local).toBe('QueryInvoiceDigestRequest');
    expect(root.attrs.xmlns).toBe('http://schemas.nav.gov.hu/OSA/3.0/api');
    expect(req.xml).toContain('<common:requestVersion>3.0</common:requestVersion>');
    expect(req.xml).toContain('<common:passwordHash cryptoType="SHA-512">05F045EF');
    expect(req.xml).toContain('cryptoType="SHA3-512"');
    expect(req.xml).toContain('<invoiceDirection>INBOUND</invoiceDirection>');
    expect(req.xml).not.toContain(TEST_AUTH.password);
    expect(req.xml).not.toContain(TEST_AUTH.signingKey);
    expect(req.timestamp).toBe('2026-11-17T08:00:00.123Z');
    const signature = navRequestSignature(req.requestId, req.timestamp, TEST_AUTH.signingKey);
    expect(req.xml).toContain(signature);
  });

  it('enforces the 35-day query window and exactly one mandatory parameter', async () => {
    await expect(buildQueryInvoiceDigest(TEST_AUTH, TEST_SOFTWARE, { page: 1, issueDate: { from: '2026-01-01', to: '2026-02-15' } })).rejects.toThrow(NavConfigError);
    await expect(buildQueryInvoiceDigest(TEST_AUTH, TEST_SOFTWARE, { page: 1 })).rejects.toThrow(NavConfigError);
    await expect(buildQueryInvoiceDigest(TEST_AUTH, TEST_SOFTWARE, { page: 0, issueDate: { from: '2026-01-01', to: '2026-01-02' } })).rejects.toThrow(NavConfigError);
  });

  it('escapes user-controlled values', async () => {
    const req = await buildQueryInvoiceData(TEST_AUTH, TEST_SOFTWARE, { invoiceNumber: 'A<&>"1', supplierTaxNumber: '10773381-2-44' });
    expect(req.xml).toContain('<invoiceNumber>A&lt;&amp;&gt;&quot;1</invoiceNumber>');
    expect(req.xml).toContain('<supplierTaxNumber>10773381</supplierTaxNumber>');
    expect(parseXml(req.xml).local).toBe('QueryInvoiceDataRequest');
  });

  it('never exposes write operations', () => {
    const exported = Object.keys(navRequestModule).join(' ');
    expect(exported).not.toMatch(/manageInvoice|manageAnnulment|tokenExchange/i);
    expect(NAV_BASE_URLS.test).toBe('https://api-test.onlineszamla.nav.gov.hu/invoiceService/v3');
    expect(NAV_BASE_URLS.production).toBe('https://api.onlineszamla.nav.gov.hu/invoiceService/v3');
  });

  it('requires a configured software identity', () => {
    expect(() => softwareFromEnv(() => undefined)).toThrow(NavConfigError);
    const sw = softwareFromEnv((k) => ({ NAV_SOFTWARE_DEV_TAX_NUMBER: '12345676-2-42', NAV_SOFTWARE_DEV_NAME: 'Dev Kft', NAV_SOFTWARE_DEV_CONTACT: 'dev@example.test' } as Record<string, string>)[k]);
    expect(sw.softwareId).toBe('HU12345676-HCARE01');
    expect(sw.softwareId).toMatch(/^[0-9A-Z-]{18}$/);
  });

  it('builds a taxpayer query with the 8-digit core', async () => {
    const req = await buildQueryTaxpayer(TEST_AUTH, TEST_SOFTWARE, 'HU12345676');
    expect(req.xml).toContain('<taxNumber>12345676</taxNumber>');
  });
});

describe('XML reader safety', () => {
  it('rejects DTDs and entity declarations', () => {
    expect(() => parseXml('<!DOCTYPE x [<!ENTITY a "b">]><x>&a;</x>')).toThrow(XmlParseError);
  });
  it('decodes standard and numeric entities and CDATA', () => {
    const root = parseXml('<a x="1&amp;2"><b>&lt;Ft&#x20;&#337;&gt;</b><c><![CDATA[<raw>]]></c></a>');
    expect(root.attrs.x).toBe('1&2');
    expect(root.children[0].text).toBe('<Ft ő>');
    expect(root.children[1].text).toBe('<raw>');
  });
  it('rejects malformed documents', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(XmlParseError);
    expect(() => parseXml('<a></a><b/>')).toThrow(XmlParseError);
  });
});

describe('NAV response parsing', () => {
  const supplierA = validTaxCore('2400000');

  it('parses digest pages, derives gross and keeps STORNO signs', () => {
    const page = parseInvoiceDigestResponse(digestResponseXml([
      { invoiceNumber: 'A-1', supplierTaxNumber: supplierA, invoiceNetAmount: 100000, invoiceVatAmount: 27000 },
      { invoiceNumber: 'A-2', supplierTaxNumber: supplierA, invoiceOperation: 'STORNO', originalInvoiceNumber: 'A-1', modificationIndex: 1, invoiceNetAmount: -100000, invoiceVatAmount: -27000 },
    ], 1, 2));
    expect(page.currentPage).toBe(1);
    expect(page.availablePage).toBe(2);
    expect(page.digests).toHaveLength(2);
    expect(page.digests[0]).toMatchObject({ invoiceNumber: 'A-1', grossAmount: 127000, currency: 'HUF', customerTaxNumber: '12345676' });
    expect(page.digests[1]).toMatchObject({ invoiceOperation: 'STORNO', grossAmount: -127000, originalInvoiceNumber: 'A-1' });
    expect(navSourceKey(page.digests[0])).not.toBe(navSourceKey(page.digests[1]));
  });

  it('classifies NAV errors for retry decisions', () => {
    expect(() => parseNavEnvelope(errorResponseXml('INVALID_SECURITY_USER'), 401)).toThrow(NavApiError);
    try { parseNavEnvelope(errorResponseXml('INVALID_SECURITY_USER'), 401); } catch (e) {
      expect((e as NavApiError).category).toBe('auth');
      expect((e as NavApiError).retryable).toBe(false);
      expect((e as NavApiError).safeSummary().message).toMatch(/technical user/);
    }
    expect(classifyNavError('MAINTENANCE_MODE', 503)).toEqual({ category: 'maintenance', retryable: true });
    expect(classifyNavError('OPERATION_FAILED', 500)).toEqual({ category: 'transient', retryable: true });
    expect(classifyNavError('INVALID_REQUEST_SIGNATURE', 400)).toEqual({ category: 'config', retryable: false });
    expect(classifyNavError('BAD_QUERY_PARAM_RANGE_EXCEEDED', 400)).toEqual({ category: 'query', retryable: false });
    expect(classifyNavError(null, 502)).toEqual({ category: 'transient', retryable: true });
    const exception = '<GeneralExceptionResponse xmlns="http://schemas.nav.gov.hu/NTCA/1.0/common"><funcCode>ERROR</funcCode><errorCode>OPERATION_FAILED</errorCode><message>x</message></GeneralExceptionResponse>';
    expect(() => parseNavEnvelope(exception, 500)).toThrow(/x/);
    expect(() => parseNavEnvelope('<html>Bad gateway</html', 502)).toThrow(NavApiError);
  });

  it('decodes plain and gzip-compressed invoice data and parses VAT summaries', async () => {
    const xml = invoiceDataXml();
    const plain = parseInvoiceDataResponse(invoiceDataResponseXml(Buffer.from(xml).toString('base64'), false));
    expect(plain?.compressed).toBe(false);
    const decoded = await decodeInvoiceData(plain!.invoiceDataBase64, false);
    const detail = parseInvoiceDataXml(decoded);
    expect(detail).toMatchObject({
      invoiceNumber: 'SZ-2026/0042', netAmount: 120000, vatAmount: 28000, grossAmount: 148000, currency: 'HUF',
      deliveryDate: '2026-11-02', paymentDate: '2026-11-18', paymentMethod: 'TRANSFER',
    });
    expect(detail.supplier).toMatchObject({ taxpayerId: '10773381', taxNumber: '10773381-2-44', bankAccountNumber: '11111111-22222222-33333333' });
    expect(detail.customer).toMatchObject({ taxpayerId: '12345676', name: 'RD Hotel Kft.' });
    expect(detail.vatSummary.map((v) => [v.vatRate.rate, v.net, v.vat])).toEqual([[27, 100000, 27000], [5, 20000, 1000]]);
    expect(detail.lines).toHaveLength(2);

    const gz = gzipSync(Buffer.from(xml), { level: 1 }).toString('base64');
    const compressed = parseInvoiceDataResponse(invoiceDataResponseXml(gz, true));
    expect(compressed?.compressed).toBe(true);
    expect(parseInvoiceDataXml(await decodeInvoiceData(compressed!.invoiceDataBase64, true)).grossAmount).toBe(148000);
  });

  it('maps exempt, reverse-charge, EU and foreign-currency invoices', async () => {
    const xml = invoiceDataXml({
      currency: 'EUR', exchangeRate: 395.12,
      vatLines: [{ rate: 'AAM', net: 5000, vat: 0 }, { rate: 'REVERSE', net: 10000, vat: 0 }, { rate: 'EUFAD37', net: 3000, vat: 0 }, { rate: '0.18', net: 10000, vat: 1800 }],
    });
    const detail = parseInvoiceDataXml(xml);
    expect(detail.currency).toBe('EUR');
    expect(detail.exchangeRate).toBe(395.12);
    expect(detail.vatSummary.map((v) => navVatRateToKind(v.vatRate))).toEqual(['aam_exempt', 'kba_reverse', 'eu_intra', 'reduced_18']);
    expect(detail.netAmountHUF).toBeCloseTo(28000 * 395.12, 2);
  });

  it('parses correction references and empty data responses', () => {
    const detail = parseInvoiceDataXml(invoiceDataXml({ invoiceNumber: 'S-2', reference: { originalInvoiceNumber: 'S-1', modificationIndex: 1 }, vatLines: [{ rate: '0.27', net: -1000, vat: -270 }] }));
    expect(detail.reference).toEqual({ originalInvoiceNumber: 'S-1', modifyWithoutMaster: false, modificationIndex: 1 });
    expect(detail.grossAmount).toBe(-1270);
    expect(parseInvoiceDataResponse(emptyDataResponseXml())).toBeNull();
  });

  it('parses taxpayer responses', () => {
    const xml = `<QueryTaxpayerResponse xmlns="http://schemas.nav.gov.hu/OSA/3.0/api" xmlns:common="http://schemas.nav.gov.hu/NTCA/1.0/common" xmlns:base="http://schemas.nav.gov.hu/OSA/3.0/base"><common:header><common:requestId>X</common:requestId><common:timestamp>2026-11-17T10:00:00.000Z</common:timestamp><common:requestVersion>3.0</common:requestVersion></common:header><common:result><common:funcCode>OK</common:funcCode></common:result><software/><infoDate>2026-11-17T10:00:00.000Z</infoDate><taxpayerValidity>true</taxpayerValidity><taxpayerData><taxpayerName>RD HOTEL KFT</taxpayerName><taxNumberDetail><base:taxpayerId>12345676</base:taxpayerId><base:vatCode>2</base:vatCode><base:countyCode>42</base:countyCode></taxNumberDetail><incorporation>ORGANIZATION</incorporation></taxpayerData></QueryTaxpayerResponse>`;
    expect(parseTaxpayerResponse(xml)).toMatchObject({ valid: true, name: 'RD HOTEL KFT', taxNumber: '12345676-2-42', incorporation: 'ORGANIZATION' });
  });
});

describe('NAV client: pagination, retries, rate limits, auth failures', () => {
  const supplier = validTaxCore('2400000');
  const makeClient = (fetchImpl: typeof fetch, sleep = vi.fn(async (_ms: number) => {})) => {
    let clock = Date.parse('2026-11-17T08:00:00Z');
    const now = () => new Date(clock);
    const advance = async (ms: number) => { clock += ms; await sleep(ms); };
    return { client: new NavClient({ environment: 'test', auth: TEST_AUTH, software: TEST_SOFTWARE, fetchImpl, sleep: advance, now, maxAttempts: 3 }), sleep };
  };

  it('follows every page of a digest query', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const page = Number(String(init?.body).match(/<page>(\d+)<\/page>/)?.[1]);
      return new Response(digestResponseXml([{ invoiceNumber: `P-${page}`, supplierTaxNumber: supplier }], page, 3), { status: 200 });
    }) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);
    const result = await client.queryInvoiceDigestAll({ insDate: { from: '2026-11-01T00:00:00.000Z', to: '2026-11-17T00:00:00.000Z' } });
    expect(result.pages).toBe(3);
    expect(result.digests.map((d) => d.invoiceNumber)).toEqual(['P-1', 'P-2', 'P-3']);
    expect((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toBe('https://api-test.onlineszamla.nav.gov.hu/invoiceService/v3/queryInvoiceDigest');
  });

  it('retries transient failures with a fresh request id each attempt', async () => {
    const bodies: string[] = [];
    let call = 0;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(String(init?.body));
      call++;
      if (call === 1) return new Response(errorResponseXml('OPERATION_FAILED'), { status: 500 });
      if (call === 2) throw new TypeError('network down');
      return new Response(digestResponseXml([], 1, 0), { status: 200 });
    }) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);
    const page = await client.queryInvoiceDigest({ page: 1, issueDate: { from: '2026-11-01', to: '2026-11-02' } });
    expect(page.availablePage).toBe(0);
    expect(call).toBe(3);
    const ids = bodies.map((b) => b.match(/<common:requestId>([^<]+)</)?.[1]);
    expect(new Set(ids).size).toBe(3);
  });

  it('fails fast on authentication errors', async () => {
    const fetchImpl = vi.fn(async () => new Response(errorResponseXml('INVALID_SECURITY_USER'), { status: 401 })) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);
    await expect(client.queryTaxpayer('12345676')).rejects.toMatchObject({ category: 'auth', code: 'INVALID_SECURITY_USER' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('paces queryInvoiceData to at most one request per second', async () => {
    const xml = Buffer.from(invoiceDataXml()).toString('base64');
    const fetchImpl = vi.fn(async () => new Response(invoiceDataResponseXml(xml, false), { status: 200 })) as unknown as typeof fetch;
    const sleep = vi.fn(async () => {});
    const { client } = makeClient(fetchImpl, sleep);
    await client.queryInvoiceData({ invoiceNumber: 'SZ-2026/0042', supplierTaxNumber: '10773381' });
    await client.queryInvoiceData({ invoiceNumber: 'SZ-2026/0042', supplierTaxNumber: '10773381' });
    expect(sleep).toHaveBeenCalledWith(1100);
  });

  it('returns null when NAV has no single valid instance', async () => {
    const fetchImpl = vi.fn(async () => new Response(emptyDataResponseXml(), { status: 200 })) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);
    expect(await client.queryInvoiceData({ invoiceNumber: 'X', supplierTaxNumber: '10773381' })).toBeNull();
  });
});

describe('NAV sync planning', () => {
  it('splits ranges into windows inside the 35-day limit', () => {
    const windows = splitDateRange('2026-01-01', '2026-04-30');
    expect(windows[0]).toEqual({ from: '2026-01-01', to: '2026-01-31' });
    for (const w of windows) expect((Date.parse(w.to) - Date.parse(w.from)) / 864e5).toBeLessThanOrEqual(35);
    expect(windows.at(-1)!.to).toBe('2026-04-30');
    const ts = splitTimestampRange('2026-01-01T00:00:00.000Z', '2026-03-15T12:00:00.000Z');
    for (const w of ts) expect((Date.parse(w.to) - Date.parse(w.from)) / 864e5).toBeLessThanOrEqual(35);
  });

  it('plans incremental windows with overlap, backfill and resumable history', () => {
    const now = new Date('2026-11-17T12:00:00Z');
    const inc = planIncrementalWindows({ cursor: '2026-11-17T10:00:00.000Z', now, overlapMinutes: 60 });
    expect(inc).toEqual([{ from: '2026-11-17T09:00:00.000Z', to: '2026-11-17T12:00:00.000Z' }]);
    expect(planIncrementalWindows({ cursor: null, now, initialLookbackDays: 3 })[0].from).toBe('2026-11-14T12:00:00.000Z');
    expect(planBackfillWindows(now, 40).at(-1)!.to).toBe('2026-11-17');
    expect(planInitialWindows('2026-01-01', '2026-10-31', now)[0].from).toBe('2026-11-01');
  });

  it('backs off failures by category', () => {
    expect(nextRetryDelayMs(1, 'transient')).toBe(5 * 60_000);
    expect(nextRetryDelayMs(3, 'transient')).toBe(20 * 60_000);
    expect(nextRetryDelayMs(20, 'transient')).toBe(6 * 3_600_000);
    expect(nextRetryDelayMs(1, 'auth')).toBe(24 * 3_600_000);
    expect(isSyncDue({ enabled: true, lastAttemptAt: '2026-11-17T11:00:00Z', nextRetryAt: null, intervalMinutes: 120, now: new Date('2026-11-17T12:00:00Z') })).toBe(false);
    expect(isSyncDue({ enabled: false, lastAttemptAt: null, nextRetryAt: null, intervalMinutes: 120, now: new Date() })).toBe(false);
    expect(isSyncDue({ enabled: true, lastAttemptAt: null, nextRetryAt: '2030-01-01T00:00:00Z', intervalMinutes: 1, now: new Date('2026-11-17T12:00:00Z') })).toBe(false);
  });
});
