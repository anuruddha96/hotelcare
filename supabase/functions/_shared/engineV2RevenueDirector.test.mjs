import test from 'node:test';
import assert from 'node:assert/strict';
import { decideRevenueDirector, committedMovement } from './engineV2RevenueDirector.ts';
import { DEFAULT_DECISION_SETTINGS } from './engineV2Core.ts';

const now = new Date('2026-10-30T10:00:00Z');
const settings = {
  ...DEFAULT_DECISION_SETTINGS, now, minMovementEur: 2,
  fill: { enabled: true, windowDays: 93, maxTotalDropPct: 20 },
  paceBands: [
    { min_days_out: 0, max_days_out: 7, target_occupancy_pct: 95 },
    { min_days_out: 8, max_days_out: 14, target_occupancy_pct: 85 },
    { min_days_out: 15, max_days_out: 30, target_occupancy_pct: 75 },
    { min_days_out: 31, max_days_out: 60, target_occupancy_pct: 60 },
    { min_days_out: 61, max_days_out: 93, target_occupancy_pct: 40 },
  ],
};
const context = { targetAdr: 140, minimumAdr: 130, projectedAdr: 155, requiredRemainingAdr: 127, netRateFactor: .8, confirmedHighEvent: false };
const input = (patch = {}) => ({
  stayDate: '2026-11-09', daysOut: 10, currentPrice: 185, occupancyPct: 30, roomsSold: 6, roomsRemaining: 15,
  pickup1h: 0, pickup6h: 0, pickup24h: 0, pickup48h: 0, pickup7d: 0, cancellations24h: 0,
  hoursSinceLastPickup: 80, lastCancellationAt: null, lastDirection: null, lastDecisionAt: null, lastDecreaseAt: null,
  movedUpTodayEur: 0, movedDownTodayEur: 0, manualHoldUntil: null, holdKind: null,
  minPrice: 110, maxPrice: 500, adrFloor: 220, hardAdrFloor: 220, monthFloor: 220, monthMarkdownsFrozen: true,
  anchorPrice: 160, crossed60Occupancy: false, pendingEventUplift: 0,
  market: { median: null, sampleSize: 0, ageHours: null }, campaignStartPrice: 185, recentPeakPrice: 185, markdownsToday: 0,
  ...patch,
});
test('rejected and dry-run proposals cannot perpetually renew movement cooldowns', () => {
  for (const status of ['held','shadow','superseded','failed']) assert.equal(committedMovement({ status, direction:'decrease', movement:-6 }), false);
  for (const status of ['queued','accepted','confirmed','published','partial']) assert.equal(committedMovement({ status, direction:'decrease', movement:-6 }), true);
});
test('soft night acts before D-7 despite a portfolio ADR floor above its price', () => {
  const d = decideRevenueDirector(input(),settings,context);
  assert.equal(d.direction,'decrease'); assert.ok(d.movement >= -15);
});
test('a 90% night with fresh pickup yields upward inside cancellation window', () => {
  const d = decideRevenueDirector(input({daysOut:4,occupancyPct:90.5,roomsSold:19,roomsRemaining:2,pickup24h:2}),settings,context);
  assert.equal(d.direction,'increase');
});
test('scarce final-week inventory is never automatically discounted', () => {
  const d = decideRevenueDirector(input({daysOut:4,occupancyPct:95.2,roomsSold:20,roomsRemaining:1}),settings,context);
  assert.notEqual(d.direction,'decrease');
});
test('one booking on a soft date holds the offer without raising or undercutting', () => {
  assert.equal(decideRevenueDirector(input({pickup24h:1}),settings,context).reason,'pickup_conversion_hold');
});
test('freshness, human locks, cancellation/rebooking and daily budgets still block', () => {
  for (const patch of [
    {dataStale:true},
    {manualHoldUntil:'2026-10-31T10:00:00Z',holdKind:'hard'},
    {manualHoldUntil:'2026-10-31T10:00:00Z',holdKind:'soft',pickup24h:3},
    {lastCancellationAt:'2026-10-30T09:00:00Z'},
    {markdownsToday:1},
    {movedDownTodayEur:20},
  ]) assert.equal(decideRevenueDirector(input(patch),settings,context).direction,'hold',JSON.stringify(patch));
});
test('major event with established demand protects ADR without automatic event-only increases', () => {
  const d = decideRevenueDirector(input({occupancyPct:65,roomsRemaining:7}),settings,{...context,confirmedHighEvent:true});
  assert.equal(d.direction,'hold'); assert.equal(d.reason,'event_demand_protected');
  assert.notEqual(decideRevenueDirector(input({pendingEventUplift:10}),settings,{...context,confirmedHighEvent:true}).direction,'increase');
});
test('poor projected ADR prevents weak-price markdowns further out', () => {
  assert.equal(decideRevenueDirector(input({currentPrice:130,campaignStartPrice:130,recentPeakPrice:130}),settings,{...context,projectedAdr:120,requiredRemainingAdr:150}).reason,'portfolio_adr_budget');
});
test('fill mode respects the actual far-out cap and waiting period', () => {
  const farSettings = { ...settings, windowRules: [{id:'w31_90',min_days_out:61,max_days_out:93,max_daily_decrease:3,max_daily_increase:12,no_pickup_wait_hours:48,min_hours_between_decreases:48,require_above_anchor:false}] };
  const night = input({daysOut:70,occupancyPct:0,roomsRemaining:21,hoursSinceLastPickup:72});
  assert.equal(decideRevenueDirector(night,farSettings,context).movement,-3);
  assert.equal(decideRevenueDirector({...night,hoursSinceLastPickup:30},farSettings,context).direction,'hold');
  assert.equal(decideRevenueDirector({...night,lastDecreaseAt:'2026-10-29T00:00:00Z'},farSettings,context).direction,'hold');
});
test('sold out dates do not change; sparse competitor evidence cannot drive an uplift', () => {
  assert.equal(decideRevenueDirector(input({occupancyPct:100,roomsRemaining:0}),settings,context).reason,'sold_out');
  assert.equal(decideRevenueDirector(input({market:{median:500,sampleSize:1,ageHours:1}}),settings,context).direction,'decrease');
});

test('opt-in €1 test responds to an overpriced soft date without synthetic churn', () => {
  const candidate = input({
    daysOut: 35, occupancyPct: 56, roomsSold: 12, roomsRemaining: 9,
    currentPrice: 185, campaignStartPrice: 185, recentPeakPrice: 185,
    hoursSinceLastPickup: 80,
    market: { median: 150, sampleSize: 4, ageHours: 3 },
  });
  const enabled = { ...settings, minMovementEur: 1, maxMarkdownsPerDay: 2 };
  assert.equal(decideRevenueDirector(candidate, enabled, context).reason, 'on_pace');
  const testMove = decideRevenueDirector(candidate, enabled, { ...context, microPriceTestEnabled: true });
  assert.equal(testMove.direction, 'decrease');
  assert.equal(testMove.movement, -1);
  assert.equal(testMove.reason, 'revenue_director_fill');
  assert.match(testMove.reasonDetail, /Measured €1 price test/);
});
test('€1 test respects market quality, demand evidence, safety and high events', () => {
  const candidate = input({
    daysOut: 35, occupancyPct: 56, roomsSold: 12, roomsRemaining: 9,
    currentPrice: 185, campaignStartPrice: 185, recentPeakPrice: 185,
    hoursSinceLastPickup: 80,
    market: { median: 150, sampleSize: 4, ageHours: 3 },
  });
  const enabled = { ...settings, minMovementEur: 1, maxMarkdownsPerDay: 2 };
  const allow = { ...context, microPriceTestEnabled: true };
  const noTests = [
    { market: { median: 150, sampleSize: 1, ageHours: 3 } },
    { market: { median: 150, sampleSize: 4, ageHours: 90 } },
    { currentPrice: 160 },
    { pickup24h: 1 },
    { hoursSinceLastPickup: 3 },
    { markdownsToday: 2 },
    { lastCancellationAt: '2026-10-30T09:30:00Z' },
    { manualHoldUntil: '2026-10-31T10:00:00Z', holdKind: 'hard' },
    { movedUpTodayEur: 5 },
    { occupancyPct: 90, roomsRemaining: 2 },
  ];
  for (const patch of noTests) {
    const decision = decideRevenueDirector({ ...candidate, ...patch }, enabled, allow);
    assert.notEqual(decision.reasonDetail.includes('Measured €1 price test') && decision.direction === 'decrease', true, JSON.stringify(patch));
  }
  assert.notEqual(
    decideRevenueDirector(candidate, enabled, { ...allow, confirmedHighEvent: true }).direction, 'decrease'
  );
});
