import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  installConfiguredGozsduCheckoutRecovery,
  isConfiguredGozsduReservationSearch,
  isConfiguredGozsduRoster,
} from './previoConfiguredGozsduCheckoutRecovery.ts';

const hotelId = '756543';
const url = 'https://api.previo.app/x1/hotel/searchReservations';
const body = `<request><hotId>${hotelId}</hotId><term><from>2026-09-21</from><to>2026-09-22</to></term></request>`;
const reservation = (status: number, from: string, to: string) =>
  `<reservation><statusId>${status}</statusId><from>${from}</from><to>${to}</to><object><objId>1856763</objId><name>1BBALC-5002</name></object></reservation>`;
const xml = (content = '') => `<reservations>${content}</reservations>`;

// These pure checks prevent accidental cross-tenant response interception.
test('only the currently configured Gozsdu hotel is intercepted', () => {
  assert.equal(isConfiguredGozsduRoster('https://api.previo.app/rest/rooms', hotelId, hotelId), true);
  assert.equal(isConfiguredGozsduRoster('https://api.previo.app/rest/rooms', '102572', hotelId), false);
  assert.equal(isConfiguredGozsduReservationSearch(url, body, hotelId), true);
  assert.equal(isConfiguredGozsduReservationSearch(url, body.replace(hotelId, '102572'), hotelId), false);
  assert.equal(isConfiguredGozsduReservationSearch(url, body.replace('<term>', '<term><termType>check-out</termType>'), hotelId), false);
});

test('only explicit departures release 5002; in-house extensions and missing evidence do not', async () => {
  const original = globalThis.fetch;
  let overlap = xml();
  let checkouts = xml();
  const called: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = typeof input === 'string' ? input : input.toString();
    const requestBody = String(init?.body ?? '');
    called.push(requestBody);
    if (target.includes('/rest/rooms')) return Response.json([{roomId: 1856763, name: '1BBALC-5002'}]);
    if (requestBody.includes('<termType>overlap</termType>')) return new Response(overlap);
    if (requestBody.includes('<termType>check-out</termType>')) return new Response(checkouts);
    return new Response(xml());
  };
  try {
    installConfiguredGozsduCheckoutRecovery(hotelId);
    // Capture a valid physical-room roster, allowing its unique local alias.
    await globalThis.fetch('https://api.previo.app/rest/rooms', {headers: {'X-Previo-Hotel-ID': hotelId}});
    let output = await (await globalThis.fetch(url, {method: 'POST', body})).text();
    assert.doesNotMatch(output, /<statusId>9<\/statusId>/, 'missing evidence cannot mark RTC');
    checkouts = xml(reservation(9, '2026-09-20', '2026-09-21'));
    output = await (await globalThis.fetch(url, {method: 'POST', body})).text();
    assert.match(output, /<statusId>9<\/statusId>/);
    assert.match(output, /<name>5002<\/name>/, 'full Previo name is safely mapped to unique local room');
    overlap = xml(reservation(5, '2026-09-21', '2026-09-25'));
    output = await (await globalThis.fetch(url, {method: 'POST', body})).text();
    assert.doesNotMatch(output, /<statusId>9<\/statusId>/, 'current in-house reservation blocks stale checkout');
    assert.match(output, /<statusId>5<\/statusId>/);
    const other = body.replace(hotelId, '102572');
    await globalThis.fetch(url, {method: 'POST', body: other});
    assert.equal(called.at(-1), other, 'another hotel is passed through unchanged');
  } finally {
    globalThis.fetch = original;
  }
});
