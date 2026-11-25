import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOMATION_FIELDS, validateChanges, mergePolicyChanges, describeDateTier, policyFieldLabel, stayDateLabel,
  canChangeAutomation,
} from './assistantAutomationFields.ts';
import { PACE_POLICY_FIELDS, resolvePaceSettings } from './engineV2PaceRatchet.ts';

const TODAY = '2026-11-18';
const check = (changes) => validateChanges(changes, { today: TODAY });

test('plain rule columns validate exactly as before', () => {
  const ok = check({ minimum_adr: 90, is_enabled: true });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.changes, [
    { target: 'rule', field: 'minimum_adr', label: AUTOMATION_FIELDS.minimum_adr.label, value: 90 },
    { target: 'rule', field: 'is_enabled', label: AUTOMATION_FIELDS.is_enabled.label, value: true },
  ]);
  assert.equal(check({ minimum_adr: -5 }).ok, false);
  assert.equal(check({ is_enabled: 'yes' }).ok, false);
  assert.equal(check({ nonsense_field: 1 }).ok, false);
  assert.equal(check({}).ok, false);
  assert.equal(check(null).ok, false);
});

test('a policy number is accepted inside its safe range, with its unit in the label', () => {
  const ok = check({ 'policy.floor_net_eur': 70, 'policy.sell_down_days': '4' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.changes.map((c) => [c.target, c.key, c.value]), [
    ['policy', 'floor_net_eur', 70], ['policy', 'sell_down_days', 4],
  ]);
  assert.match(ok.changes[0].label, /Lowest banked rate.*\(€\)/);
  assert.equal(policyFieldLabel('raise_pct_normal'), 'Raise per booking, Normal dates (%)');
});

test('a policy number outside its range, fractional where whole is needed, or unknown is refused', () => {
  const { min, max } = PACE_POLICY_FIELDS.floor_net_eur;
  assert.match(check({ 'policy.floor_net_eur': min - 1 }).error, /between/);
  assert.match(check({ 'policy.floor_net_eur': max + 1 }).error, /between/);
  assert.match(check({ 'policy.sell_down_days': 2.5 }).error, /whole number/);
  assert.match(check({ 'policy.floor_net_eur': 'cheap' }).error, /must be a number/);
  assert.match(check({ 'policy.made_up': 3 }).error, /not a pricing-policy setting/);
});

test('the policy mode and its internal keys can never be changed from chat', () => {
  for (const field of ['policy.mode', 'policy.supervised_until', 'policy.sister_hotels', 'policy.pre_live', 'policy.__proto__', 'policy.constructor']) {
    assert.equal(check({ [field]: 'live' }).ok, false, field);
    assert.equal(check({ [field]: 1 }).ok, false, field);
  }
  assert.equal(check({ pace_policy: { mode: 'live' } }).ok, false);
});

test('a stay date can be tagged normal, high or peak, dismissed, or handed back to automatic', () => {
  const ok = check({ 'tier.2026-12-31': 'Peak', 'tier.2027-01-01': 'automatic', 'tier.2026-12-30': 'dismiss' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.changes.map((c) => [c.target, c.stayDate, c.value]), [
    ['tier', '2026-12-31', 'peak'], ['tier', '2027-01-01', 'auto'], ['tier', '2026-12-30', 'dismissed'],
  ]);
  assert.equal(ok.changes[0].label, 'Date tier — Thu 31 Dec 2026');
  assert.equal(stayDateLabel('2027-07-23'), 'Fri 23 Jul 2027');
  assert.match(check({ 'tier.2026-12-31': 'super' }).error, /must be one of/);
  assert.match(check({ 'tier.2026-12-31': 5 }).error, /must be one of/);
});

test('dates must be real, not in the past and not absurdly far ahead', () => {
  assert.match(check({ 'tier.31-12-2026': 'peak' }).error, /YYYY-MM-DD/);
  assert.match(check({ 'tier.2026-02-30': 'peak' }).error, /not a real calendar date/);
  assert.match(check({ 'tier.2026-11-10': 'peak' }).error, /in the past/);
  assert.match(check({ 'tier.2028-06-01': 'peak' }).error, /days ahead/);
  // Yesterday is tolerated: the server clock is UTC, the hotel's day is not.
  assert.equal(check({ 'tier.2026-11-17': 'high' }).ok, true);
  assert.match(check({ 'ceiling.2026-11-10': 700 }).error, /in the past/);
});

test('a per-date highest price is whole euros between 100 and 3000, or null to remove it', () => {
  const ok = check({ 'ceiling.2026-12-31': 900, 'ceiling.2027-01-01': null });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.changes.map((c) => [c.target, c.stayDate, c.value]), [
    ['ceiling', '2026-12-31', 900], ['ceiling', '2027-01-01', null],
  ]);
  assert.match(check({ 'ceiling.2026-12-31': 50 }).error, /between 100 and 3000/);
  assert.match(check({ 'ceiling.2026-12-31': 5000 }).error, /between 100 and 3000/);
  assert.match(check({ 'ceiling.2026-12-31': 700.5 }).error, /whole number of euros/);
});

test('one proposal carries at most forty fields', () => {
  const many = Object.fromEntries(Array.from({ length: 41 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 11, 1 + i)).toISOString().slice(0, 10);
    return [`tier.${d}`, 'high'];
  }));
  assert.match(check(many).error, /max 40/);
  assert.equal(check(Object.fromEntries(Object.entries(many).slice(0, 40))).ok, true);
});

test('policy changes merge into the saved JSON without touching the mode or anything else', () => {
  const saved = { mode: 'shadow', sister_hotels: ['gozsdu-court'], supervised_until: null, floor_net_eur: 65, pre_live: { x: 1 } };
  const changes = check({ 'policy.floor_net_eur': 70, 'policy.unsold_ok_rooms': 1, minimum_adr: 90 }).changes;
  const merged = mergePolicyChanges(saved, changes);
  assert.deepEqual(merged.next, { ...saved, floor_net_eur: 70, unsold_ok_rooms: 1 });
  assert.equal(merged.before.floor_net_eur, 65);
  assert.equal(merged.after.floor_net_eur, 70);
  assert.equal(merged.after.mode, 'shadow');
  assert.deepEqual(merged.adjusted, []);
  // The saved object itself is never mutated.
  assert.equal(saved.floor_net_eur, 65);
  // An empty or odd saved value starts from the defaults.
  assert.equal(mergePolicyChanges(null, changes).before.floor_net_eur, resolvePaceSettings({}).floor_net_eur);
  assert.equal(mergePolicyChanges('junk', changes).next.floor_net_eur, 70);
});

test('a change that would drag another setting along must name it: nothing moves unseen', () => {
  // Smallest raise above the largest raise for the same tier: the engine would lift the largest.
  const changes = check({ 'policy.raise_min_eur_normal': 40 }).changes;
  const merged = mergePolicyChanges({ mode: 'live' }, changes);
  assert.deepEqual(merged.adjusted, ['policy.raise_max_eur_normal would also move from 25 to 40; include it in the same change']);
  // Naming both in one proposal is clean.
  const both = check({ 'policy.raise_min_eur_normal': 40, 'policy.raise_max_eur_normal': 60 }).changes;
  assert.deepEqual(mergePolicyChanges({ mode: 'live' }, both).adjusted, []);
  // A value the engine would read differently from what was asked is reported too.
  const capped = check({ 'policy.raise_max_eur_peak': 80, 'policy.max_step_eur': 30 }).changes;
  const report = mergePolicyChanges({ mode: 'live' }, capped).adjusted.join(' | ');
  assert.match(report, /policy\.raise_max_eur_peak would be read as 30, not 80/);
  assert.match(report, /policy\.raise_max_eur_high would also move from 45 to 30/);
  // A change with no ties reports nothing.
  assert.deepEqual(mergePolicyChanges({ mode: 'live' }, check({ 'policy.floor_net_eur': 70 }).changes).adjusted, []);
  // Rule-only changes never trip the policy check, even over an odd saved policy.
  assert.deepEqual(mergePolicyChanges({ mode: 'live', raise_min_eur_normal: 60 }, check({ minimum_adr: 90 }).changes).adjusted, []);
});

test('date tags read plainly in a before/after card', () => {
  assert.equal(describeDateTier(null), 'automatic');
  assert.equal(describeDateTier({ tier: 'peak', status: 'confirmed' }), 'peak');
  assert.equal(describeDateTier({ tier: 'peak', status: 'needs_review' }), 'peak candidate (awaiting review)');
  assert.equal(describeDateTier({ tier: 'normal', status: 'dismissed' }), 'dismissed');
});

test('only management roles may change automation', () => {
  for (const role of ['admin', 'manager', 'top_management', 'top_management_manager']) assert.equal(canChangeAutomation(role), true);
  for (const role of ['housekeeper', 'reception', '', null, undefined]) assert.equal(canChangeAutomation(role), false);
});
