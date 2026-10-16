import test from 'node:test';
import assert from 'node:assert/strict';
import { activePublicationDecision, guardOttofioriPublication } from './ottofioriPublicationGuard.ts';

const date = '2026-11-06';
function fixture() {
  const drafts = [2, 2, 2, 3, 4].flatMap((capacity, kind) =>
    Array.from({ length: capacity }, (_, index) => ({
      id: `draft-${kind}-${index}`, stay_date: date, obk_id: `kind-${kind}`, occupancy: index + 1,
      old_price: 200 + kind * 20 + index * 10, new_price: 194 + kind * 20 + index * 10,
      decision_id: 'decision', intent_source: 'automation_markdown', currency: 'EUR',
    })));
  return {
    hotelId: 'ottofiori', drafts,
    decisions: [{ id: 'decision', hotel_id: 'ottofiori', stay_date: date, status: 'queued',
      direction: 'decrease', movement: -6, cells_simulated: 13 }],
    mappedCells: drafts.map((d) => ({ ...d, price: d.old_price })),
    manifest: { [date]: { decision_id: 'decision', expected_cells: 13 } },
  };
}
function blocked(f) {
  const result = guardOttofioriPublication(f);
  assert.equal(result.allowed.length, 0);
  assert.equal(result.blocked.length, 1);
  return result;
}

test('complete queued column preserves all 13 uniform targets', () => {
  const f = fixture();
  assert.deepEqual(guardOttofioriPublication(f), { allowed: f.drafts, blocked: [] });
});
test('reproduces first-child budget hold with 12 surviving drafts: none can publish', () => {
  const f = fixture();
  f.decisions[0].status = 'held';
  f.drafts.shift();
  const result = blocked(f);
  assert.match(result.blocked[0].reason, /held/);
});
for (const status of ['held', 'failed', 'shadow', 'superseded', 'accepted', 'confirmed', 'partial']) {
  test(`non-queued ${status} decision cannot be replayed despite negative movement`, () => {
    const f = fixture(); f.decisions[0].status = status; blocked(f);
  });
}
test('a queued HOLD with nonzero movement is rejected', () => {
  const f = fixture(); f.decisions[0].direction = 'hold'; blocked(f);
});
test('a queued zero-movement decision is rejected', () => {
  const f = fixture(); f.decisions[0].movement = 0; blocked(f);
});
test('missing durable decision fails closed', () => {
  const f = fixture(); f.decisions = []; blocked(f);
});
test('wrong hotel or date cannot satisfy a decision ID', () => {
  const f = fixture(); f.decisions[0].hotel_id = 'another-hotel'; blocked(f);
  f.decisions[0].hotel_id = 'ottofiori'; f.decisions[0].stay_date = '2026-11-07'; blocked(f);
});
test('recent human manager edit protects the complete AI column', () => {
  const f = fixture(); f.drafts.forEach((d) => { d.intent_source = 'manual'; d.decision_reason = 'ai_review'; });
  f.protectedDates = new Set([date]); blocked(f);
});
test('12 active drafts cannot masquerade as a complete date', () => {
  const f = fixture(); f.drafts.pop(); blocked(f);
});
test('a truncated mirror cannot authorize a truncated manifest', () => {
  const f = fixture(); f.drafts.pop(); f.mappedCells.pop();
  f.decisions[0].cells_simulated = 12; f.manifest[date].expected_cells = 12; blocked(f);
});
test('a duplicate cell cannot conceal a missing occupancy level', () => {
  const f = fixture(); f.drafts[12] = { ...f.drafts[11], id: 'duplicate' }; blocked(f);
});
test('an unmapped or duplicated mirror cell blocks the date', () => {
  const f = fixture(); f.mappedCells[12] = { ...f.mappedCells[11] }; blocked(f);
});
test('a stale old price blocks the complete column', () => {
  const f = fixture(); f.mappedCells[4].price += 1; blocked(f);
});
test('one child with a different delta cannot publish', () => {
  const f = fixture(); f.drafts[4].new_price += 1; blocked(f);
});
test('fractional or foreign-currency targets are rejected', () => {
  const f = fixture(); f.drafts[4].new_price += .5; blocked(f);
  const other = fixture(); other.drafts[4].currency = 'HUF'; blocked(other);
});
test('missing manifest and mismatched decision manifest fail closed', () => {
  const f = fixture(); f.manifest = null; blocked(f);
  const other = fixture(); other.manifest[date].decision_id = 'other'; blocked(other);
});
test('a valid increase can publish uniformly', () => {
  const f = fixture(); f.decisions[0].direction = 'increase'; f.decisions[0].movement = 6;
  f.drafts.forEach((d) => { d.new_price = d.old_price + 6; });
  assert.equal(guardOttofioriPublication(f).allowed.length, 13);
});
test('one unsafe date does not block an independent safe complete date', () => {
  const f = fixture(); const bad = fixture();
  bad.drafts.forEach((d) => { d.stay_date = '2026-11-07'; d.decision_id = 'bad'; });
  bad.decisions[0] = { ...bad.decisions[0], id: 'bad', stay_date: '2026-11-07', status: 'held' };
  f.drafts.push(...bad.drafts); f.decisions.push(...bad.decisions);
  const result = guardOttofioriPublication(f);
  assert.equal(result.allowed.length, 13); assert.equal(result.blocked[0].stayDate, '2026-11-07');
});
test('ordinary human edits remain deliverable without an automation manifest', () => {
  const f = fixture(); f.drafts = [{ ...f.drafts[0], decision_id: null, intent_source: 'manual' }];
  f.decisions = []; f.manifest = null;
  assert.equal(guardOttofioriPublication(f).allowed.length, 1);
});
test('other hotels retain their existing publication behavior', () => {
  const f = fixture(); f.hotelId = 'another-hotel'; f.decisions = []; f.manifest = null;
  assert.deepEqual(guardOttofioriPublication(f), { allowed: f.drafts, blocked: [] });
});
test('last-moment decision check catches a hold after preflight', () => {
  const f = fixture(); assert.equal(activePublicationDecision(f.decisions[0], date), true);
  f.decisions[0].status = 'held'; assert.equal(activePublicationDecision(f.decisions[0], date), false);
});
