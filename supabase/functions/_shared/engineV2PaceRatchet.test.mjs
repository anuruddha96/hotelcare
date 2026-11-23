import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PACE_POLICY_FIELDS, PACE_POLICY_DEFAULTS, resolvePaceSettings, coercePaceField, paceGridFloor, paceCellCeiling,
  paceZoneFor, paceQuietHours, expectedOccupancyPct, resolvePaceTier, decidePaceRatchet,
  paceRaiseStep, localMinutesAt, pacePeakEvent, paceCurateEvents, paceEventKey,
} from './engineV2PaceRatchet.ts';
import { DEFAULT_DECISION_SETTINGS } from './engineV2Core.ts';

// Hotel Ottofiori's saved configuration on 18 Nov 2026.
const paceBands = [
  { min_days_out: 0, max_days_out: 1, target_occupancy_pct: 95 },
  { min_days_out: 2, max_days_out: 3, target_occupancy_pct: 90 },
  { min_days_out: 4, max_days_out: 7, target_occupancy_pct: 82 },
  { min_days_out: 8, max_days_out: 14, target_occupancy_pct: 70 },
  { min_days_out: 15, max_days_out: 30, target_occupancy_pct: 55 },
  { min_days_out: 31, max_days_out: 60, target_occupancy_pct: 40 },
  { min_days_out: 61, max_days_out: 120, target_occupancy_pct: 10 },
  { min_days_out: 121, max_days_out: 180, target_occupancy_pct: 5 },
  { min_days_out: 181, max_days_out: 365, target_occupancy_pct: 3 },
];
const windowRules = [
  { id: 'w0_2', min_days_out: 0, max_days_out: 0, max_daily_decrease: 140, max_daily_increase: 30, no_pickup_wait_hours: 1, min_hours_between_decreases: 1, require_above_anchor: false },
  { id: 'w0_2', min_days_out: 1, max_days_out: 3, max_daily_decrease: 20, max_daily_increase: 40, no_pickup_wait_hours: 3, min_hours_between_decreases: 3, require_above_anchor: false },
  { id: 'w3_7', min_days_out: 4, max_days_out: 7, max_daily_decrease: 15, max_daily_increase: 45, no_pickup_wait_hours: 4, min_hours_between_decreases: 4, require_above_anchor: false },
  { id: 'w8_30', min_days_out: 8, max_days_out: 30, max_daily_decrease: 12, max_daily_increase: 50, no_pickup_wait_hours: 6, min_hours_between_decreases: 6, require_above_anchor: false },
  { id: 'w31_90', min_days_out: 31, max_days_out: 120, max_daily_decrease: 10, max_daily_increase: 60, no_pickup_wait_hours: 12, min_hours_between_decreases: 8, require_above_anchor: false },
];
const NOW = new Date('2026-11-19T11:00:00Z'); // 12:00 in Budapest
const core = (patch = {}) => ({
  ...DEFAULT_DECISION_SETTINGS, now: NOW, paceBands, windowRules,
  minMovementEur: 3, directionChangeHours: 4, maxMarkdownsPerDay: 4, maxMarkdownDepthPct: 15,
  rebookWindowHours: 4, bookedDateBrakeHours: 4, soldOutOccupancyPct: 100, cancellationWaitMinutes: 60,
  ...patch,
});
const S = resolvePaceSettings({ mode: 'shadow' });
const settings = (patch = {}) => resolvePaceSettings({ mode: 'shadow', ...patch });

// An ordinary date in the booking window: 15 days out, 67% sold — on its curve (65% expected).
const input = (patch = {}) => ({
  stayDate: '2026-12-04', daysOut: 15, currentPrice: 140, occupancyPct: 66.7, roomsSold: 14, roomsRemaining: 7,
  pickup1h: 0, pickup6h: 0, pickup24h: 0, pickup48h: 0, pickup7d: 0, observedPickup6h: 0,
  cancellations24h: 0, hoursSinceLastPickup: 40, lastCancellationAt: null,
  lastDirection: null, lastDecisionAt: null, lastDecreaseAt: null,
  movedUpTodayEur: 0, movedDownTodayEur: 0, manualHoldUntil: null, holdKind: null,
  minPrice: 80, maxPrice: 500, adrFloor: null, anchorPrice: 137, crossed60Occupancy: false,
  pendingEventUplift: 0, market: { median: 113, sampleSize: 5, ageHours: 3 },
  campaignStartPrice: 200, recentPeakPrice: 200, markdownsToday: 0, ...patch,
});
const facts = (patch = {}) => ({
  tier: 'normal', tierSource: 'default', basePrice: 130, lowestCellPrice: 128, highestCellPrice: 230,
  convertingPrice: null, convertedAt: null, freshPickup: null, localMinutes: 12 * 60,
  sellableRooms: 21, dateCeilingEur: null, respectWindowCaps: false, ...patch,
});
const decide = (i = {}, f = {}, s = S, c = {}) => decidePaceRatchet(input(i), core(c), s, facts(f));
// Behind its curve by about 12 points: 52% sold against 65% expected.
const BEHIND = { occupancyPct: 52.4, roomsSold: 11, roomsRemaining: 10 };
// A fresh booking: unspent in the ledger and inside the quiet window.
const booked = (n = 1, patch = {}) => ({ pickup24h: n, pickup6h: n, pickup1h: n, observedPickup6h: n, hoursSinceLastPickup: 0.2, ...patch });

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
test('defaults carry the owner brief: €65 banked floor, 7-day cancellation, 3-day sell-down, 2 rooms may stay unsold', () => {
  assert.equal(S.floor_net_eur, 65);
  assert.equal(S.free_cancel_days, 7);
  assert.equal(S.sell_down_days, 3);
  assert.equal(S.unsold_ok_rooms, 2);
  assert.equal(S.ceiling_eur, 500);
  assert.ok(S.peak_ceiling_eur > 500);
  // €65 banked at 75% of list needs an €87 list price on the cheapest cell.
  assert.equal(paceGridFloor(S), 87);
  assert.equal(PACE_POLICY_DEFAULTS.mode, 'off');
});

test('saved settings are clamped to their safe range and unknown keys are ignored', () => {
  const s = resolvePaceSettings({
    mode: 'banana', floor_net_eur: 5, max_step_eur: 9999, raise_pct_normal: '9', unsold_ok_rooms: 2.6,
    net_rate_factor: 0, drop_all_guards: true, sister_hotels: ['gozsdu-court', 'DROP TABLE', 42],
    supervised_until: 'not a date',
  });
  assert.equal(s.mode, 'off');
  assert.equal(s.floor_net_eur, PACE_POLICY_FIELDS.floor_net_eur.min);
  assert.equal(s.max_step_eur, 80); // never above what the database guard accepts
  assert.equal(s.raise_pct_normal, 9);
  assert.equal(s.unsold_ok_rooms, 3);
  assert.equal(s.net_rate_factor, 0.5);
  assert.equal(s.drop_all_guards, undefined);
  assert.deepEqual(s.sister_hotels, ['gozsdu-court']);
  assert.equal(s.supervised_until, null);
  assert.equal(coercePaceField('floor_net_eur', 'abc'), null);
  assert.equal(coercePaceField('floor_net_eur', null), null);
});

test('cross-field sanity: a tier raise range is never inverted and Peak ceiling is never under the normal one', () => {
  const s = resolvePaceSettings({ raise_min_eur_normal: 40, raise_max_eur_normal: 10, peak_ceiling_eur: 200, ceiling_eur: 600, max_step_eur: 30 });
  assert.ok(s.raise_max_eur_normal >= s.raise_min_eur_normal);
  assert.ok(s.raise_max_eur_normal <= 30);
  assert.ok(s.raise_max_eur_peak <= 30);
  assert.ok(s.peak_ceiling_eur >= s.ceiling_eur);
});

test('zones follow the cancellation deadline and the sell-down window', () => {
  assert.equal(paceZoneFor(0, S), 'arrival_day');
  for (const d of [1, 2, 3]) assert.equal(paceZoneFor(d, S), 'sell_down');
  for (const d of [4, 7]) assert.equal(paceZoneFor(d, S), 'close_in');
  for (const d of [8, 30]) assert.equal(paceZoneFor(d, S), 'booking_window');
  for (const d of [31, 120]) assert.equal(paceZoneFor(d, S), 'far_out');
  assert.equal(paceQuietHours('arrival_day', S), 1);
  assert.equal(paceQuietHours('booking_window', S), 6);
});

test('the booking curve is interpolated: no 30-point cliff at a band edge', () => {
  assert.equal(expectedOccupancyPct(0, paceBands), 95);
  assert.equal(expectedOccupancyPct(11, paceBands), 70);
  const d60 = expectedOccupancyPct(60, paceBands);
  const d61 = expectedOccupancyPct(61, paceBands);
  assert.ok(Math.abs(d60 - d61) < 2, `${d60} vs ${d61}`);
  assert.ok(d61 > 20 && d61 < 40);
  // Monotone: never expects MORE rooms sold further from arrival.
  let last = 101;
  for (let d = 0; d <= 365; d++) { const v = expectedOccupancyPct(d, paceBands); assert.ok(v <= last + 1e-9, `day ${d}`); last = v; }
  assert.equal(expectedOccupancyPct(10, []), null);
});

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------
const tierIn = (patch = {}) => ({ manual: null, events: [], specialRatio: null, occupancyPct: 30, expectedPct: 40, daysOut: 45, ...patch });
const ev = (patch = {}) => ({ title: 'Some concert', venue: 'Somewhere', expectedImpact: 'high', confidence: 1, approved: true, source: 'ai', ...patch });

test('a manager tag always wins and can carry its own ceiling', () => {
  const r = resolvePaceTier(tierIn({ manual: { tier: 'peak', status: 'confirmed', ceilingEur: 700 }, events: [] }), S);
  assert.equal(r.tier, 'peak'); assert.equal(r.source, 'manual'); assert.equal(r.ceilingEur, 700); assert.equal(r.review, null);
  assert.equal(resolvePaceTier(tierIn({ manual: { tier: 'normal', status: 'confirmed' }, events: [ev({ venue: 'Puskás Aréna' })] }), S).tier, 'normal');
});

const STADIUM_EVENTS = [
  ev({ title: 'Nickelback', venue: 'Puskás Aréna' }),
  ev({ title: 'UEFA Champions League Final', venue: 'Budapest' }),
  ev({ title: 'Formula 1 Hungarian Grand Prix', venue: 'Hungaroring' }),
  ev({ title: "New Year's Eve Celebrations (Szilveszter)", venue: 'Budapest' }),
  ev({ title: 'Sziget Festival', venue: 'Óbudai-sziget' }),
];

test('a stadium-scale event is always flagged for a manager, and is Peak once prices or bookings back it', () => {
  for (const e of STADIUM_EVENTS) {
    // Backed by the sister hotels' own pricing for the date.
    const priced = resolvePaceTier(tierIn({ events: [e], specialRatio: 1.6 }), S);
    assert.equal(priced.tier, 'peak', e.title); assert.equal(priced.source, 'event'); assert.equal(priced.review?.kind, 'peak_event');
    // Backed by this hotel's own early bookings.
    const booking = resolvePaceTier(tierIn({ events: [e], occupancyPct: 62, expectedPct: 40, daysOut: 45 }), S);
    assert.equal(booking.tier, 'peak', e.title); assert.equal(booking.review?.kind, 'peak_event');
  }
});

test('an event title alone is only a candidate: High and flagged, never Peak on the feed’s word', () => {
  for (const e of STADIUM_EVENTS) {
    const r = resolvePaceTier(tierIn({ events: [e] }), S);
    assert.equal(r.tier, 'high', e.title); assert.equal(r.source, 'event'); assert.equal(r.review?.kind, 'peak_event');
    assert.match(r.detail, /until a manager confirms/);
  }
  // A manager's confirmation is what makes it Peak without other evidence.
  assert.equal(resolvePaceTier(tierIn({ manual: { tier: 'peak', status: 'confirmed' }, events: [STADIUM_EVENTS[0]] }), S).tier, 'peak');
});

test('look-alike titles from the live event feed are not stadium events', () => {
  // All four are real rows from Ottofiori's feed on 18 Nov 2026.
  for (const e of [
    ev({ title: 'UEFA Europa League Final', venue: 'Waldstadion, Frankfurt', expectedImpact: 'low' }),
    ev({ title: "Pre-New Year's Eve Gala Concert of the 100 Member Gypsy Orchestra", venue: 'Budapest Congress Center', expectedImpact: 'medium' }),
    ev({ title: '68th International Mathematical Olympiad', venue: 'Various venues in Budapest', source: 'ai_auto' }),
    ev({ title: 'Jazz evening', venue: 'Margitsziget Open-Air Stage' }),
  ]) {
    assert.equal(pacePeakEvent(e), false, e.title);
    const r = resolvePaceTier(tierIn({ events: [e], specialRatio: 1.2 }), S);
    assert.equal(r.tier, 'normal', e.title); assert.equal(r.review, null, e.title);
  }
});

test('a hand-entered event replaces same-titled automatic copies on other dates', () => {
  const rows = [
    { title: 'Formula 1 Hungarian Grand Prix', source: 'ai', from: '2027-05-28' },
    { title: 'Formula 1  Hungarian Grand Prix ', source: 'ai', from: '2027-06-16' },
    { title: 'Formula 1 Hungarian Grand Prix', source: 'manual', from: '2027-07-23' },
    { title: 'Sziget Festival', source: 'ai', from: '2027-08-10' },
  ];
  assert.deepEqual(paceCurateEvents(rows).map((r) => r.from), ['2027-07-23', '2027-08-10']);
  // Nothing hand-entered: nothing is dropped.
  assert.equal(paceCurateEvents(rows.filter((r) => r.source !== 'manual')).length, 3);
  assert.equal(paceEventKey('  Formula 1 — Hungarian  Grand Prix! '), 'formula 1 hungarian grand prix');
  assert.equal(paceEventKey('Szilveszter (Óév búcsúztató)'), 'szilveszter óév búcsúztató');
});

test('unapproved, low-confidence or garbled events are not evidence', () => {
  for (const e of [
    ev({ venue: 'Puskás Aréna', approved: false }),
    ev({ venue: 'Puskás Aréna', confidence: 0.5 }),
    ev({ title: 'Vf6rf6smarty Te9r Christmas Market �', venue: 'Puskás Aréna' }),
    ev({ title: '', venue: 'Puskás Aréna' }),
  ]) assert.equal(resolvePaceTier(tierIn({ events: [e] }), S).tier, 'normal');
});

test('a 50-day "high impact" market label changes nothing by itself', () => {
  const r = resolvePaceTier(tierIn({ events: [ev({ title: 'Advent Bazilika Christmas Market', venue: 'St Stephen Basilica' })] }), S);
  assert.equal(r.tier, 'normal');
});

test('arena concerts, sister-hotel pricing and early pace make a date High', () => {
  assert.equal(resolvePaceTier(tierIn({ events: [ev({ title: 'Bryan Adams Concert', venue: 'MVM Dome' })] }), S).tier, 'high');
  assert.equal(resolvePaceTier(tierIn({ events: [ev({ title: 'Krúbi', venue: 'MVM Dome', expectedImpact: 'medium' })] }), S).tier, 'normal');
  const sister = resolvePaceTier(tierIn({ specialRatio: 1.4 }), S);
  assert.equal(sister.tier, 'high'); assert.equal(sister.review, null);
  const twice = resolvePaceTier(tierIn({ specialRatio: 2.1 }), S);
  assert.equal(twice.tier, 'high'); assert.equal(twice.review?.kind, 'peak_prices');
  assert.equal(resolvePaceTier(tierIn({ occupancyPct: 62, expectedPct: 40, daysOut: 45 }), S).tier, 'high');
  // Pace alone never upgrades a date inside the cancellation deadline, or a nearly empty one.
  assert.equal(resolvePaceTier(tierIn({ occupancyPct: 99, expectedPct: 82, daysOut: 5 }), S).tier, 'normal');
  assert.equal(resolvePaceTier(tierIn({ occupancyPct: 30, expectedPct: 10, daysOut: 90 }), S).tier, 'normal');
});

test('a dismissed review stops the Peak signal for that date; a pending one does not act as a manager tag', () => {
  const puskas = [ev({ title: 'Nickelback', venue: 'Puskás Aréna' })];
  const dismissed = resolvePaceTier(tierIn({ manual: { tier: 'peak', status: 'dismissed' }, events: puskas, specialRatio: 2.2 }), S);
  // Dismissed: no Peak, no new review — the sister-hotel pricing still makes it High.
  assert.equal(dismissed.tier, 'high'); assert.equal(dismissed.source, 'sister_prices'); assert.equal(dismissed.review, null);
  assert.equal(resolvePaceTier(tierIn({ manual: { tier: 'peak', status: 'dismissed' }, events: puskas }), S).tier, 'normal');
  // Waiting for review: the row itself decides nothing, the evidence does.
  const pending = resolvePaceTier(tierIn({ manual: { tier: 'peak', status: 'needs_review' }, events: puskas, specialRatio: 1.6 }), S);
  assert.equal(pending.tier, 'peak'); assert.equal(pending.source, 'event');
  const unbacked = resolvePaceTier(tierIn({ manual: { tier: 'peak', status: 'needs_review' }, events: puskas }), S);
  assert.equal(unbacked.tier, 'high'); assert.equal(unbacked.source, 'event');
  assert.equal(resolvePaceTier(tierIn({ manual: { tier: 'peak', status: 'needs_review' }, events: [] }), S).tier, 'normal');
});

// ---------------------------------------------------------------------------
// The ratchet: bookings raise
// ---------------------------------------------------------------------------
test('one booking raises a Normal date by about 7% — Ricsi’s €8–11 step', () => {
  const d = decide(booked());
  assert.equal(d.direction, 'increase');
  assert.equal(d.movement, 10); // 7% of €140
  assert.equal(d.targetPrice, 150);
  assert.equal(d.reason, 'revenue_director_yield'); // the name the database guard recognises
  assert.equal(d.trace.policyReason, 'pickup_ratchet');
  assert.match(d.reasonDetail, /Pace ratchet · normal · booking window/);
  assert.equal(decide({ ...booked(), currentPrice: 110 }).movement, 8); // the €8 minimum
});

test('High and Peak dates take Ricsi’s bigger steps: about €18–22 and €50–70', () => {
  assert.equal(decide(booked(), { tier: 'high' }).movement, 18);
  assert.equal(decide({ ...booked(), currentPrice: 170 }, { tier: 'high' }).movement, 22);
  assert.equal(decide({ ...booked(), currentPrice: 150 }, { tier: 'peak' }).movement, 53);
  assert.equal(decide({ ...booked(), currentPrice: 200 }, { tier: 'peak', highestCellPrice: 290 }).movement, 70);
  // No single move exceeds €80, whatever the tier and the multipliers.
  assert.equal(decide({ ...booked(3), currentPrice: 300, roomsRemaining: 1, occupancyPct: 95.2 }, { tier: 'peak', highestCellPrice: 390 }).movement, 80);
});

test('more bookings together earn more; far-out bookings earn more', () => {
  assert.equal(decide(booked(2)).movement, 16);  // ×1.6
  assert.equal(decide(booked(3)).movement, 22);  // ×2.2
  // 45 days out, on pace for that lead time (47% sold): ×1.3.
  assert.equal(decide({ ...booked(), daysOut: 45, occupancyPct: 42.9, roomsRemaining: 12 }).movement, 13);
  // 75 days out, on pace (19% sold): ×1.6.
  assert.equal(decide({ ...booked(), daysOut: 75, occupancyPct: 19, roomsRemaining: 17 }).movement, 16);
});

test('a booking on a date far behind its curve earns half; one far ahead earns more; the last rooms earn most', () => {
  assert.equal(decide({ ...booked(), occupancyPct: 14.3, roomsRemaining: 18 }).movement, 5);  // cold ×0.5
  assert.equal(decide({ ...booked(), occupancyPct: 81, roomsRemaining: 4 }).movement, 13);    // hot ×1.3
  assert.equal(decide({ ...booked(), occupancyPct: 85.7, roomsRemaining: 3 }).movement, 16);  // hot ×1.3, scarce ×1.25
  assert.equal(decide({ ...booked(), occupancyPct: 95.2, roomsRemaining: 1 }).movement, 19);  // hot ×1.3, last room ×1.5
});

test('a date that is High only because of its pace is not rewarded twice for the same bookings', () => {
  // 7 Dec 2026 in the shadow run: €278, 76% sold against 61% expected, 18 days out, High by pace.
  const hot = { ...booked(), daysOut: 18, currentPrice: 278, occupancyPct: 76.2, roomsSold: 16, roomsRemaining: 5 };
  const f = { lowestCellPrice: 260, highestCellPrice: 380, basePrice: 200 };
  const byPace = decide(hot, { ...f, tier: 'high', tierSource: 'pace' });
  assert.equal(byPace.movement, 36);            // 13% of €278, not 16.9% (€47)
  // An event or the sister hotels are separate evidence: pace on top of them still counts.
  assert.equal(decide(hot, { ...f, tier: 'high', tierSource: 'event' }).movement, 45 + 2); // 13% × 1.3
  assert.equal(decide(hot, { ...f, tier: 'high', tierSource: 'sister_prices' }).movement, 47);
  assert.equal(decide(hot, { ...f, tier: 'high', tierSource: 'manual' }).movement, 47);
  // The helper in isolation, and the cold side is untouched.
  const base = { current: 200, tier: 'high', zone: 'booking_window', bookings: 1, daysOut: 18, roomsLeft: 8, supervisedFactor: 1 };
  assert.equal(paceRaiseStep({ ...base, paceGap: 20 }, S), 34);
  assert.equal(paceRaiseStep({ ...base, paceGap: 20, tierFromPace: true }, S), 26);
  assert.equal(paceRaiseStep({ ...base, paceGap: -20, tierFromPace: true }, S), paceRaiseStep({ ...base, paceGap: -20 }, S));
  assert.equal(paceRaiseStep({ ...base, paceGap: 0, tierFromPace: true }, S), 26);
});

test('no raise without a fresh booking: occupancy, events and stale pickup do not lift a price', () => {
  assert.equal(decide({ occupancyPct: 90, roomsRemaining: 2 }).direction, 'hold');
  assert.equal(decide({ occupancyPct: 81, roomsRemaining: 4 }, { tier: 'peak' }).direction, 'hold');
  // An unspent booking from 20 hours ago is not fresh pickup.
  const stale = decide({ pickup24h: 1, hoursSinceLastPickup: 20 }, { freshPickup: 0 });
  assert.notEqual(stale.direction, 'increase');
});

test('a rise is capped per day by tier', () => {
  // Normal: 20% of €140 = €28 a day. €24 already spent leaves €4.
  const d = decide({ ...booked(), movedUpTodayEur: 24 });
  assert.equal(d.movement, 4);
  assert.equal(decide({ ...booked(), movedUpTodayEur: 28 }).direction, 'hold');
});

// ---------------------------------------------------------------------------
// Decay in the booking window
// ---------------------------------------------------------------------------
test('quiet hours decay a date by about 2% only while it is behind its booking curve', () => {
  const behind = decide(BEHIND);
  assert.equal(behind.direction, 'decrease');
  assert.equal(behind.movement, -3); // 2% of €140
  assert.equal(behind.reason, 'revenue_director_fill');
  assert.equal(behind.trace.policyReason, 'pace_decay');
  assert.equal(decide().reason, 'on_pace');
  assert.equal(decide({ occupancyPct: 76.2, roomsRemaining: 5 }).reason, 'ahead_of_pace');
  // 20 points or more behind: 3%.
  assert.equal(decide({ occupancyPct: 38.1, roomsRemaining: 13 }).movement, -4);
});

test('a booking stops the decay for the quiet window, and cuts only run in selling hours', () => {
  assert.equal(decide({ ...BEHIND, hoursSinceLastPickup: 2 }, { freshPickup: 0 }).reason, 'awaiting_quiet_window');
  assert.equal(decide(BEHIND, { localMinutes: 3 * 60 }).reason, 'outside_selling_hours');
  assert.equal(decide(BEHIND, { localMinutes: 22 * 60 + 30 }).reason, 'outside_selling_hours');
});

test('cuts stay within 5% of the last price that converted while that memory is fresh', () => {
  const twoDaysAgo = new Date(NOW.getTime() - 48 * 3_600_000).toISOString();
  const held = decide({ ...BEHIND, currentPrice: 143 }, { convertingPrice: 150, convertedAt: twoDaysAgo });
  assert.equal(held.reason, 'converting_price_guard'); // floor is €143 (150 − 5%)
  const partial = decide({ ...BEHIND, currentPrice: 145 }, { convertingPrice: 150, convertedAt: twoDaysAgo });
  assert.equal(partial.movement, -2); // 145 → 143, not the full €3
  const fourDaysAgo = new Date(NOW.getTime() - 96 * 3_600_000).toISOString();
  const expired = decide({ ...BEHIND, currentPrice: 143 }, { convertingPrice: 150, convertedAt: fourDaysAgo });
  assert.equal(expired.movement, -3);
});

test('before the cancellation deadline a date never falls under 80% of its seasonal base', () => {
  const atFloor = decide({ currentPrice: 105, occupancyPct: 14.3, roomsRemaining: 18 }, { basePrice: 130, lowestCellPrice: 95 });
  assert.equal(atFloor.reason, 'base_floor'); // 80% of €130 = €104
  // Inside the deadline the same date may sell down.
  const inside = decide({ daysOut: 5, currentPrice: 105, occupancyPct: 14.3, roomsRemaining: 18 }, { basePrice: 130, lowestCellPrice: 95 });
  assert.equal(inside.direction, 'decrease');
});

// ---------------------------------------------------------------------------
// Far out: glide to the seasonal base
// ---------------------------------------------------------------------------
test('an empty date far above its seasonal base glides down in time for the booking window', () => {
  // Tuesday 17 Nov as it stood eight weeks out: €340 against a base near €115.
  const d = decide({ daysOut: 57, currentPrice: 340, occupancyPct: 14.3, roomsRemaining: 18, hoursSinceLastPickup: null },
    { basePrice: 115, lowestCellPrice: 325, highestCellPrice: 430 });
  assert.equal(d.direction, 'decrease');
  assert.equal(d.trace.policyReason, 'far_out_glide');
  assert.equal(d.movement, -5); // (340 − 132) over 22 days, two moves a day
  // Closer to the window the step is capped at 3% of the price.
  const late = decide({ daysOut: 36, currentPrice: 340, occupancyPct: 14.3, roomsRemaining: 18, hoursSinceLastPickup: null },
    { basePrice: 115, lowestCellPrice: 325, highestCellPrice: 430 });
  assert.equal(late.movement, -10);
});

test('far-out dates inside their band still test lower when quiet and behind pace', () => {
  const far = { daysOut: 57, occupancyPct: 14.3, roomsRemaining: 18, hoursSinceLastPickup: null };
  const inside = decide({ ...far, currentPrice: 130 }, { basePrice: 115 });
  assert.equal(inside.direction, 'decrease');
  assert.equal(inside.trace.policyReason, 'far_out_pace_decay');
  assert.equal(decide({ ...far, currentPrice: 340, occupancyPct: 61.9, roomsRemaining: 8 }, { basePrice: 115, lowestCellPrice: 325 }).reason, 'ahead_of_pace');
  assert.equal(decide({ ...far, currentPrice: 340 }, { basePrice: null, lowestCellPrice: 325 }).reason, 'no_seasonal_base');
  assert.equal(decide({ ...far, currentPrice: 640 }, { basePrice: 115, tier: 'peak', lowestCellPrice: 620, highestCellPrice: 730 }).reason, 'peak_review_hold');
});

test('the glide and pace decay never undershoot the guarded base share or daily cap', () => {
  // Walk one date from 60 days out to 35, two evaluations a day.
  let price = 250; const base = 110; const bandHigh = Math.round(base * 1.15);
  for (let daysOut = 60; daysOut >= 35; daysOut--) {
    const dayStart = price; let movedDown = 0; let markdowns = 0; let lastDecreaseAt = null;
    for (const hour of [7.5, 20]) {
      const now = new Date(Date.UTC(2026, 10, 19, 0, Math.round((hour - 1) * 60)));
      const d = decidePaceRatchet(
        input({ daysOut, currentPrice: price, occupancyPct: 9.5, roomsRemaining: 19, hoursSinceLastPickup: null,
          movedDownTodayEur: movedDown, markdownsToday: markdowns, lastDecreaseAt,
          lastDirection: markdowns ? 'decrease' : null, lastDecisionAt: lastDecreaseAt }),
        core({ now }), S, facts({ basePrice: base, lowestCellPrice: price - 12, highestCellPrice: price + 90, localMinutes: Math.round(hour * 60) }));
      if (d.direction === 'decrease') {
        price += d.movement; movedDown += Math.abs(d.movement); markdowns += 1; lastDecreaseAt = now.toISOString();
      }
      assert.notEqual(d.direction, 'increase');
    }
    assert.ok(price >= Math.round(base * S.base_floor_pct / 100), `undershot guarded base share at ${daysOut}: ${price}`);
    assert.ok(dayStart - price <= Math.round(dayStart * 0.05) + 1, `fell too fast at ${daysOut}`);
  }
  assert.ok(price >= Math.round(base * S.base_floor_pct / 100));
  assert.ok(price < bandHigh);
});

// ---------------------------------------------------------------------------
// Final sell-down (the last 3 days)
// ---------------------------------------------------------------------------
test('sell-down cuts are sized to rooms left versus the pickup still expected', () => {
  // Saturday 21 Nov, three days out: 5 rooms left at €435. A €5 step was 1%.
  const sat = { daysOut: 3, currentPrice: 435, occupancyPct: 76.2, roomsRemaining: 5, hoursSinceLastPickup: 30 };
  const f = { lowestCellPrice: 420, highestCellPrice: 499, basePrice: 300 };
  const d = decide(sat, f);
  assert.equal(d.direction, 'decrease');
  assert.equal(d.trace.policyReason, 'sell_down');
  assert.equal(d.movement, -13); // 3% of €435
  // Four left: one room of pressure, a gentler 2%.
  assert.equal(decide({ ...sat, roomsRemaining: 4, occupancyPct: 81 }, f).movement, -9);
  // Three left: about one more is expected to sell anyway — no cut.
  assert.equal(decide({ ...sat, roomsRemaining: 3, occupancyPct: 85.7 }, f).reason, 'sell_down_on_track');
  // Two left: inside the tolerance, the last rooms keep their price.
  assert.equal(decide({ ...sat, roomsRemaining: 2, occupancyPct: 90.5 }, f).reason, 'last_rooms_hold');
  // A nearly empty date one day out gets the largest step.
  assert.equal(decide({ daysOut: 1, currentPrice: 120, occupancyPct: 42.9, roomsRemaining: 12, hoursSinceLastPickup: 30 }, { lowestCellPrice: 108 }).movement, -8); // 7%
});

test('the price that converts is held while rooms still have to sell; an on-track date is raised', () => {
  const lock = decide({ daysOut: 2, currentPrice: 150, occupancyPct: 66.7, roomsRemaining: 7, ...booked() });
  assert.equal(lock.direction, 'hold');
  assert.equal(lock.reason, 'converting_price_lock');
  const raise = decide({ daysOut: 2, currentPrice: 150, occupancyPct: 90.5, roomsRemaining: 2, ...booked() });
  assert.equal(raise.direction, 'increase');
  assert.equal(raise.movement, 13); // 7% of €150 × scarce 1.25
});

test('the sell-down day cap is 15% of the price, not a flat €20', () => {
  const d = decide({ daysOut: 3, currentPrice: 435, occupancyPct: 76.2, roomsRemaining: 5, hoursSinceLastPickup: 30, movedDownTodayEur: 60 },
    { lowestCellPrice: 420, highestCellPrice: 499 });
  assert.equal(d.movement, -5); // €65 allowance, €60 spent
  assert.equal(decide({ daysOut: 3, currentPrice: 435, occupancyPct: 76.2, roomsRemaining: 5, hoursSinceLastPickup: 30, movedDownTodayEur: 65 },
    { lowestCellPrice: 420, highestCellPrice: 499 }).reason, 'daily_budget_spent');
});

// ---------------------------------------------------------------------------
// Arrival day
// ---------------------------------------------------------------------------
const today = (patch = {}) => ({ daysOut: 0, currentPrice: 120, occupancyPct: 71.4, roomsRemaining: 6, hoursSinceLastPickup: 5, ...patch });
const todayFacts = (minutes, patch = {}) => ({ localMinutes: minutes, lowestCellPrice: 108, ...patch });

test('arrival day steps down 3%, then 5%, then 8% as the day goes on', () => {
  assert.equal(decide(today(), todayFacts(10 * 60)).movement, -4);
  assert.equal(decide(today(), todayFacts(14 * 60)).movement, -6);
  assert.equal(decide(today(), todayFacts(17 * 60)).movement, -10);
  assert.equal(decide(today(), todayFacts(17 * 60)).trace.policyReason, 'arrival_day_discovery');
});

test('arrival day: gentle when one room is over the tolerance, silent outside selling hours and for the last rooms', () => {
  assert.equal(decide(today({ roomsRemaining: 3, occupancyPct: 85.7 }), todayFacts(17 * 60)).movement, -4);
  assert.equal(decide(today(), todayFacts(7 * 60)).reason, 'outside_selling_hours');
  assert.equal(decide(today(), todayFacts(22 * 60 + 5)).reason, 'outside_selling_hours');
  assert.equal(decide(today({ roomsRemaining: 2, occupancyPct: 90.5 }), todayFacts(17 * 60)).reason, 'last_rooms_hold');
});

test('arrival day: a booking fixes the price for two hours; the first step afterwards is the gentle one', () => {
  const locked = decide(today({ ...booked(), hoursSinceLastPickup: 0.3 }), todayFacts(17 * 60));
  assert.equal(locked.reason, 'converting_price_lock');
  // The booking has been counted, 90 minutes have passed: still held.
  assert.equal(decide(today({ hoursSinceLastPickup: 1.5 }), todayFacts(17 * 60, { freshPickup: 0 })).reason, 'converting_price_lock');
  // Three hours on, still unsold: resume with 3%, not the evening 8%.
  assert.equal(decide(today({ hoursSinceLastPickup: 3 }), todayFacts(17 * 60, { freshPickup: 0 })).movement, -4);
});

test('arrival day: two bookings in a row earn one small step up, never a jump', () => {
  const d = decide(today({ ...booked(2), hoursSinceLastPickup: 0.2 }), todayFacts(15 * 60));
  assert.equal(d.direction, 'increase');
  assert.equal(d.movement, 6); // 3% × 1.6
  const last = decide(today({ ...booked(), roomsRemaining: 2, occupancyPct: 90.5 }), todayFacts(15 * 60));
  assert.equal(last.movement, 5); // 3% × scarce 1.25, rounded
});

test('arrival day may fall 30% in total and no further', () => {
  const spent = decide(today({ movedDownTodayEur: 36 }), todayFacts(18 * 60));
  assert.equal(spent.reason, 'daily_budget_spent'); // 30% of €120
});

// ---------------------------------------------------------------------------
// Guardrails
// ---------------------------------------------------------------------------
test('the floor is what the hotel banks: the cheapest cell never goes under €87 list (€65 after discounts)', () => {
  const near = decide({ daysOut: 2, currentPrice: 100, occupancyPct: 42.9, roomsRemaining: 12, hoursSinceLastPickup: 30 }, { lowestCellPrice: 89 });
  assert.equal(near.movement, -2); // only €2 of room left above the floor
  const at = decide({ daysOut: 2, currentPrice: 98, occupancyPct: 42.9, roomsRemaining: 12, hoursSinceLastPickup: 30 }, { lowestCellPrice: 87 });
  assert.equal(at.reason, 'price_floor');
});

test('a sold-out room type under the floor never lifts a date, but still stops it falling', () => {
  // 22 Nov 2026: Economy (sold out) 1 guest at €84, Twin (on sale) at €130 / €145.
  const pinned = { lowestCellPrice: 84, lowestSellableCellPrice: 130, highestCellPrice: 218 };
  const quiet = decide({ ...BEHIND, daysOut: 4, currentPrice: 145 }, pinned);
  assert.equal(quiet.direction, 'hold');
  assert.equal(quiet.reason, 'floor_pinned');
  assert.match(quiet.reasonDetail, /nothing left to sell is priced at €84/);
  assert.match(quiet.reasonDetail, /cheapest bookable price is €130/);
  // A booking still raises it.
  assert.equal(decide({ ...BEHIND, daysOut: 4, currentPrice: 145, ...booked() }, pinned).direction, 'increase');
  // When the hotel asks for it, a BOOKABLE price under the floor is lifted, by exactly what that price needs.
  const LIFT = settings({ floor_lift: 1 });
  const lift = decide({ daysOut: 89, currentPrice: 84, occupancyPct: 0, roomsSold: 0, roomsRemaining: 21 },
    { lowestCellPrice: 60, lowestSellableCellPrice: 72, highestCellPrice: 396 }, LIFT);
  assert.equal(lift.direction, 'increase'); assert.equal(lift.movement, 15);
  assert.equal(lift.trace.policyReason, 'net_floor_lift');
  // With no availability detail the cheapest cell decides, as before.
  const plain = decide({ daysOut: 89, currentPrice: 84, occupancyPct: 0, roomsSold: 0, roomsRemaining: 21 },
    { lowestCellPrice: 72, highestCellPrice: 396 }, LIFT);
  assert.equal(plain.movement, 15);
  // A date held at the floor by a bookable price keeps the ordinary wording.
  const atFloor = decide({ ...BEHIND, daysOut: 4, currentPrice: 97 }, { lowestCellPrice: 87, lowestSellableCellPrice: 87, highestCellPrice: 180 });
  assert.equal(atFloor.reason, 'price_floor');
});

test('holds are named for what actually holds the price', () => {
  // An empty date at its seasonal band is still eligible for a guarded test.
  const edge = decide({ daysOut: 69, currentPrice: 114, occupancyPct: 0, roomsSold: 0, roomsRemaining: 21, hoursSinceLastPickup: null },
    { basePrice: 98, lowestCellPrice: 101, highestCellPrice: 204 });
  assert.equal(edge.direction, 'decrease'); assert.equal(edge.trace.policyReason, 'far_out_pace_decay');
  // A sold-out room type UNDER the floor is described as under it, not at it.
  const under = decide({ ...BEHIND, daysOut: 3, currentPrice: 136 }, { lowestCellPrice: 75, lowestSellableCellPrice: 121, highestCellPrice: 209 });
  assert.equal(under.reason, 'floor_pinned');
  assert.match(under.reasonDetail, /priced at €75 on this date, under the €87 list floor/);
  const at = decide({ ...BEHIND, daysOut: 3, currentPrice: 136 }, { lowestCellPrice: 87, lowestSellableCellPrice: 121, highestCellPrice: 209 });
  assert.match(at.reasonDetail, /priced at €87 on this date, at the €87 list floor/);
  // The real floor before the cancellation deadline keeps its own name.
  const floor = decide({ ...BEHIND, daysOut: 15, currentPrice: 105 }, { basePrice: 130, lowestCellPrice: 95, highestCellPrice: 195 });
  assert.equal(floor.reason, 'base_floor');
});

test('a sold-out date says sold out even when it has no price left on sale', () => {
  const d = decide({ currentPrice: null, occupancyPct: 100, roomsSold: 21, roomsRemaining: 0 });
  assert.equal(d.reason, 'sold_out');
  assert.equal(decide({ currentPrice: null }).reason, 'no_price');
});

test('a far-out High date keeps a bigger band but still decays when empty and behind pace', () => {
  // Base €100: a Normal date glides above €115, a High date only above €130.
  const far = { daysOut: 67, currentPrice: 125, occupancyPct: 0, roomsSold: 0, roomsRemaining: 21, hoursSinceLastPickup: null };
  const f = { basePrice: 100, lowestCellPrice: 112, highestCellPrice: 215 };
  assert.equal(decide(far, { ...f, tier: 'normal' }).trace.policyReason, 'far_out_glide');
  const high = decide(far, { ...f, tier: 'high', tierSource: 'event' });
  assert.equal(high.direction, 'decrease'); assert.equal(high.trace.policyReason, 'far_out_pace_decay');
  const above = decide({ ...far, currentPrice: 177 }, { ...f, lowestCellPrice: 164, highestCellPrice: 267, tier: 'high', tierSource: 'event' });
  assert.equal(above.trace.policyReason, 'far_out_glide');
  assert.match(above.reasonDetail, /up to €130/);
  // The High band is never tighter than the ordinary one.
  const tight = settings({ glide_band_pct: 40, glide_band_pct_high: 10 });
  assert.equal(decide({ ...far, currentPrice: 135 }, { ...f, lowestCellPrice: 122, tier: 'high' }, tight).trace.policyReason, 'far_out_pace_decay');
});

test('a price a person set under the floor is left alone: never cut further, never raised without a booking', () => {
  assert.equal(S.floor_lift, 0); // lifting is a choice the hotel has to make
  // 19 Nov 2026: a manager priced tonight's cheapest room at €82 by hand, €5 under the €87 list floor.
  const quiet = { daysOut: 2, currentPrice: 92, occupancyPct: 42.9, roomsRemaining: 12, hoursSinceLastPickup: 30 };
  const d = decide(quiet, { lowestCellPrice: 82 });
  assert.equal(d.direction, 'hold'); assert.equal(d.movement, 0);
  assert.equal(d.reason, 'price_floor');
  assert.match(d.reasonDetail, /cheapest bookable price of this date \(€82\) is already under the €87 list floor/);
  // The same on the arrival day, at any hour, and far out.
  for (const minutes of [9 * 60, 13 * 60, 18 * 60, 21 * 60]) {
    const t = decide({ ...quiet, daysOut: 0, hoursSinceLastPickup: 5 }, { lowestCellPrice: 82, localMinutes: minutes });
    assert.equal(t.direction, 'hold', `arrival day ${minutes}`);
  }
  const far = decide({ daysOut: 88, currentPrice: 84, occupancyPct: 0, roomsSold: 0, roomsRemaining: 21, hoursSinceLastPickup: null },
    { lowestCellPrice: 72, highestCellPrice: 396, basePrice: 60 });
  assert.equal(far.direction, 'hold'); assert.equal(far.reason, 'price_floor');
  // A sold-out room type even cheaper does not change the story: the bookable price is what is under the floor.
  const both = decide(quiet, { lowestCellPrice: 70, lowestSellableCellPrice: 82 });
  assert.equal(both.reason, 'price_floor');
  assert.match(both.reasonDetail, /\(€82\) is already under/);
  // A genuine booking still raises it, by the ordinary step and no more.
  const sold = decide({ ...quiet, daysOut: 15, occupancyPct: 66.7, roomsRemaining: 7, ...booked() }, { lowestCellPrice: 82 });
  assert.equal(sold.direction, 'increase');
  assert.equal(sold.trace.policyReason, 'pickup_ratchet');
  assert.equal(sold.movement, decide({ ...quiet, daysOut: 15, occupancyPct: 66.7, roomsRemaining: 7, ...booked() }, { lowestCellPrice: 120 }).movement);
});

test('when the hotel asks for it, a date already under the floor is lifted back to it, booking or not', () => {
  const LIFT = settings({ floor_lift: 1 });
  const d = decide({ daysOut: 2, currentPrice: 92, occupancyPct: 42.9, roomsRemaining: 12, hoursSinceLastPickup: 30 }, { lowestCellPrice: 80 }, LIFT);
  assert.equal(d.direction, 'increase');
  assert.equal(d.movement, 7);
  assert.equal(d.trace.policyReason, 'net_floor_lift');
  // …but a manager's protected price is not overridden.
  const held = decide({ daysOut: 2, currentPrice: 92, occupancyPct: 42.9, roomsRemaining: 12, hoursSinceLastPickup: 30,
    manualHoldUntil: new Date(NOW.getTime() + 3_600_000).toISOString(), holdKind: 'soft' }, { lowestCellPrice: 80 }, LIFT);
  assert.equal(held.reason, 'manual_hold');
  // The switch is a whole number: anything else is read as off or on, never as "half".
  assert.equal(settings({ floor_lift: 0.4 }).floor_lift, 0);
  assert.equal(settings({ floor_lift: 7 }).floor_lift, 1);
  assert.equal(settings({ floor_lift: 'yes' }).floor_lift, 0);
});

test('ordinary dates stop at €500 on their dearest cell; Peak dates and manager ceilings may go higher', () => {
  const capped = decide({ ...booked(), currentPrice: 400 }, { highestCellPrice: 495 });
  assert.equal(capped.movement, 5);
  assert.equal(decide({ ...booked(), currentPrice: 400 }, { highestCellPrice: 500 }).direction, 'hold');
  assert.equal(decide({ ...booked(), currentPrice: 400 }, { highestCellPrice: 495, tier: 'peak' }).movement, 80);
  assert.equal(decide({ ...booked(), currentPrice: 400 }, { highestCellPrice: 495, dateCeilingEur: 520 }).movement, 25);
});

test('manager locks, stale data, missing occupancy and sold-out dates never move', () => {
  const until = new Date(NOW.getTime() + 3_600_000).toISOString();
  assert.equal(decide({ ...booked(), manualHoldUntil: until, holdKind: 'hard' }).reason, 'manual_lock');
  assert.equal(decide({ ...BEHIND, manualHoldUntil: until, holdKind: 'soft' }).reason, 'manual_hold');
  assert.equal(decide({ ...booked(), manualHoldUntil: until, holdKind: 'soft' }).direction, 'increase'); // genuine pickup may lift a soft hold
  assert.equal(decide({ ...booked(), dataStale: true }).reason, 'stale_data');
  assert.equal(decide({ ...booked(), occupancyPct: null }).reason, 'no_occupancy');
  assert.equal(decide({ ...booked(), currentPrice: null }).reason, 'no_price');
  assert.equal(decide({ ...booked(), roomsRemaining: 0, occupancyPct: 100 }).reason, 'sold_out');
});

test('shared cooldowns still apply: spacing between cuts, cuts per day, cancellations', () => {
  const behind = BEHIND;
  const hourAgo = new Date(NOW.getTime() - 3_600_000).toISOString();
  assert.equal(decide({ ...behind, lastDecreaseAt: hourAgo, lastDirection: 'decrease', lastDecisionAt: hourAgo }).reason, 'decrease_frequency');
  assert.equal(decide({ ...behind, markdownsToday: 3 }).reason, 'markdown_limit'); // booking window: 3 a day
  assert.equal(decide({ ...behind, lastCancellationAt: new Date(NOW.getTime() - 20 * 60_000).toISOString() }).reason, 'cancellation_cooldown');
  assert.equal(decide({ ...behind, movedDownTodayEur: 7 }).reason, 'daily_budget_spent'); // 5% of €140
});

test('live mode never plans beyond the caps the database trigger enforces', () => {
  const sat = { daysOut: 3, currentPrice: 435, occupancyPct: 76.2, roomsRemaining: 5, hoursSinceLastPickup: 30 };
  const f = { lowestCellPrice: 420, highestCellPrice: 499 };
  // Saved window cap for 1–3 days out is €20 a day.
  assert.equal(decide({ ...sat, movedDownTodayEur: 13 }, { ...f, respectWindowCaps: true }).movement, -7);
  assert.equal(decide({ ...sat, movedDownTodayEur: 20 }, { ...f, respectWindowCaps: true }).reason, 'daily_budget_spent');
  // Arrival day: eight cuts in policy, but the saved rule allows four.
  assert.equal(decide(today({ markdownsToday: 4 }), todayFacts(17 * 60, { respectWindowCaps: true })).reason, 'markdown_limit');
  assert.equal(decide(today({ markdownsToday: 4 }), todayFacts(17 * 60)).direction, 'decrease');
});

test('newly live: every step and cap is halved until the supervised period ends', () => {
  const supervised = settings({ supervised_until: new Date(NOW.getTime() + 86_400_000).toISOString() });
  const d = decide(booked(), {}, supervised);
  assert.equal(d.movement, 5);
  assert.equal(d.trace.supervised, true);
  const over = settings({ supervised_until: new Date(NOW.getTime() - 60_000).toISOString() });
  assert.equal(decide(booked(), {}, over).movement, 10);
});

test('the thin competitor scan no longer vetoes a rise that a real booking justified', () => {
  // Market median €113 used to cap a €140 soft date at €136.
  assert.equal(decide(booked()).movement, 10);
});

test('helper: local minutes in Budapest', () => {
  assert.equal(localMinutesAt(new Date('2026-11-19T11:30:00Z')), 12 * 60 + 30);
  assert.equal(localMinutesAt(new Date('2026-07-01T22:15:00Z')), 15); // summer time
});

test('raise helper respects the hard bounds in isolation', () => {
  for (const tier of ['normal', 'high', 'peak']) for (const current of [60, 100, 250, 800]) for (const bookings of [1, 2, 5]) {
    const step = paceRaiseStep({ current, tier, zone: 'far_out', bookings, daysOut: 90, paceGap: 30, roomsLeft: 1, supervisedFactor: 1 }, S);
    assert.ok(Number.isInteger(step) && step >= S.min_step_eur && step <= S.max_step_eur, `${tier} ${current} ${bookings}: ${step}`);
  }
});

// ---------------------------------------------------------------------------
// Invariants over thousands of random situations
// ---------------------------------------------------------------------------
test('invariants hold for 6,000 random dates, settings and times', () => {
  let seed = 20261119;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const between = (lo, hi) => lo + rnd() * (hi - lo);
  let moves = 0;
  for (let i = 0; i < 6000; i++) {
    const s = resolvePaceSettings({
      mode: 'live',
      floor_net_eur: between(40, 120), net_rate_factor: between(0.6, 1), unsold_ok_rooms: Math.floor(between(0, 4)),
      raise_pct_normal: between(1, 25), raise_pct_peak: between(5, 80), decay_pct_selldown: between(0.5, 12),
      day_cap_pct_arrival: between(5, 60), max_step_eur: between(5, 80), min_step_eur: Math.floor(between(1, 6)),
      conv_guard_pct: between(0, 30), base_floor_pct: between(50, 100), glide_band_pct: between(0, 60),
      glide_band_pct_high: between(0, 120), floor_lift: rnd() < 0.5 ? 1 : 0,
      supervised_until: rnd() < 0.2 ? new Date(NOW.getTime() + 3_600_000).toISOString() : null,
    });
    const gridFloor = paceGridFloor(s);
    const daysOut = pick([0, 0, 1, 2, 3, 4, 6, 7, 8, 14, 21, 30, 31, 45, 60, 90, 120]);
    const current = Math.round(between(60, 700));
    const lowest = current - Math.round(between(0, 20));
    const highest = current + Math.round(between(0, 120));
    // On a third of the dates the cheapest cells belong to sold-out room types.
    const sellable = rnd() < 0.33 ? lowest + Math.round(between(0, 60)) : (rnd() < 0.5 ? lowest : undefined);
    const left = Math.floor(between(0, 22));
    const occ = Math.round((1 - left / 21) * 1000) / 10;
    const bookings = rnd() < 0.3 ? Math.ceil(between(0, 3)) : 0;
    const tier = pick(['normal', 'normal', 'high', 'peak']);
    const respect = rnd() < 0.5;
    const hard = rnd() < 0.05;
    const inp = input({
      daysOut, currentPrice: current, occupancyPct: occ, roomsRemaining: left,
      pickup24h: bookings, pickup6h: bookings, pickup1h: bookings,
      cancellations24h: rnd() < 0.1 ? 1 : 0,
      hoursSinceLastPickup: bookings ? between(0, 1) : pick([null, 0.5, 2, 5, 30, 200]),
      movedUpTodayEur: rnd() < 0.3 ? Math.round(between(0, 60)) : 0,
      movedDownTodayEur: rnd() < 0.3 ? Math.round(between(0, 60)) : 0,
      markdownsToday: Math.floor(between(0, 6)),
      lastDecreaseAt: rnd() < 0.3 ? new Date(NOW.getTime() - between(0.2, 30) * 3_600_000).toISOString() : null,
      lastDirection: pick([null, 'increase', 'decrease']),
      lastDecisionAt: rnd() < 0.5 ? new Date(NOW.getTime() - between(0.2, 30) * 3_600_000).toISOString() : null,
      lastCancellationAt: rnd() < 0.1 ? new Date(NOW.getTime() - between(0.1, 10) * 3_600_000).toISOString() : null,
      manualHoldUntil: hard || rnd() < 0.05 ? new Date(NOW.getTime() + 3_600_000).toISOString() : null,
      holdKind: hard ? 'hard' : 'soft',
    });
    const f = facts({
      tier, basePrice: rnd() < 0.85 ? Math.round(between(80, 400)) : null,
      lowestCellPrice: lowest, highestCellPrice: highest, lowestSellableCellPrice: sellable,
      convertingPrice: rnd() < 0.4 ? Math.round(between(60, 700)) : null,
      convertedAt: rnd() < 0.4 ? new Date(NOW.getTime() - between(0, 300) * 3_600_000).toISOString() : null,
      freshPickup: rnd() < 0.5 ? null : bookings,
      localMinutes: Math.floor(between(0, 1440)), respectWindowCaps: respect,
      dateCeilingEur: rnd() < 0.05 ? Math.round(between(300, 1200)) : null,
    });
    const d = decidePaceRatchet(inp, core(), s, f);
    const ceiling = f.dateCeilingEur ?? (tier === 'peak' ? s.peak_ceiling_eur : s.ceiling_eur);
    const ctx = JSON.stringify({ i, daysOut, current, lowest, highest, left, bookings, tier, d: { dir: d.direction, mv: d.movement, why: d.reason, policy: d.trace.policyReason } });

    assert.ok(Number.isInteger(d.movement), ctx);
    assert.equal(d.blocked, d.direction === 'hold', ctx);
    if (d.direction === 'hold') { assert.equal(d.movement, 0, ctx); continue; }
    moves++;
    assert.equal(d.targetPrice, current + d.movement, ctx);
    assert.ok(Math.abs(d.movement) <= 80, ctx);                       // the database's hard step limit
    assert.ok(Math.abs(d.movement) <= s.max_step_eur, ctx);
    assert.ok(Math.abs(d.movement) >= s.min_step_eur, ctx);
    assert.ok(!hard, ctx);                                              // a manager lock is absolute
    assert.ok(left > 0, ctx);                                           // a sold-out date never moves
    if (d.direction === 'decrease') {
      assert.equal(d.reason, 'revenue_director_fill', ctx);
      assert.ok(d.movement < 0, ctx);
      assert.ok(lowest + d.movement >= gridFloor, ctx);                 // the cheapest cell stays on or above the floor
      assert.ok(left > s.unsold_ok_rooms, ctx);                         // the last rooms are never discounted
      assert.equal(inp.manualHoldUntil, null, ctx);                     // a manager's price is never undercut
      assert.ok(!(d.trace.tier === 'peak' && daysOut > s.sell_down_days), ctx);
      const net = Math.max(0, inp.pickup24h - inp.cancellations24h);
      const fresh = f.freshPickup == null ? net : Math.min(net, f.freshPickup);
      assert.ok(fresh === 0, ctx);                                      // never cut a date that just converted
      if (respect) {
        const win = windowRules.find((w) => daysOut >= w.min_days_out && daysOut <= w.max_days_out);
        assert.ok(inp.movedDownTodayEur + Math.abs(d.movement) <= win.max_daily_decrease, ctx);
        assert.ok(inp.markdownsToday < 4, ctx);
      }
    } else {
      assert.equal(d.reason, 'revenue_director_yield', ctx);
      assert.ok(d.movement > 0, ctx);
      assert.ok(highest + d.movement <= ceiling, ctx);                  // the dearest cell stays on or under the ceiling
      const net = Math.max(0, inp.pickup24h - inp.cancellations24h);
      // A rise needs a genuine booking — or, where the hotel switched lifting on, a BOOKABLE price under the floor.
      assert.ok(net > 0 || (d.trace.policyReason === 'net_floor_lift' && (sellable ?? lowest) < gridFloor), ctx);
      assert.ok(d.trace.policyReason !== 'net_floor_lift' || s.floor_lift === 1, ctx);
      if (d.trace.policyReason === 'net_floor_lift') {
        // The lift is exactly what the cheapest bookable price needs, never more.
        assert.ok((sellable ?? lowest) + d.movement <= Math.max(gridFloor, (sellable ?? lowest)), ctx);
      }
    }
  }
  assert.ok(moves > 500, `only ${moves} moves — the fuzz is not exercising the planner`);
});

test('uncapped pricing follows the highest cell and honors a manager date ceiling', () => {
  const settings = resolvePaceSettings({ uncapped_prices: 1, quiet_hours_far: 1 });
  assert.equal(settings.quiet_hours_far, 1);
  for (const highest of [500, 900, 1200, 5000]) {
    assert.equal(paceCellCeiling(settings, 'normal', highest), highest + settings.max_step_eur);
  }
  assert.equal(paceCellCeiling(settings, 'peak', 1200, 1250), 1250);
  assert.equal(paceCellCeiling(resolvePaceSettings({}), 'normal', 510), 500);
});
