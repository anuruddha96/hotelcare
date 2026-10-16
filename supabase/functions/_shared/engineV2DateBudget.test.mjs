import test from "node:test";
import assert from "node:assert/strict";
import { checkOttofioriMarkdownBudget, MARKDOWN_BUDGET_STATUSES } from "./engineV2DateBudget.ts";
const date = "2026-10-29";
const candidate = (movement = -4, days_out = 13) => ({
  id: "current", stay_date: date, direction: "decrease", status: "queued", movement, days_out,
});
const opts = (decisions) => ({
  decisionId: "current", stayDate: date, decisions,
  windows: [{ min_days_out: 8, max_days_out: 14, max_daily_decrease: 12 }],
  defaultCap: 15, maxMarkdowns: 4,
});
test("counts the candidate only once for its whole 13-cell date", () => {
  assert.equal(checkOttofioriMarkdownBudget(opts([candidate()])).allowed, true);
});
test("matches production: accepted/confirmed/partial movements consume the cap", () => {
  const earlier = ["accepted", "confirmed", "partial"].map((status, i) => ({
    ...candidate(-4), id: `old-${i}`, status,
  }));
  const result = checkOttofioriMarkdownBudget(opts([...earlier, candidate()]));
  assert.equal(result.allowed, false);
  assert.match(result.reason, /€16.*€12/);
});
test("matches production: January €10 request against €6 cap holds whole date", () => {
  const inputs = [candidate(-5, 84), { ...candidate(-5, 84), id: "earlier", status: "confirmed" }];
  const result = checkOttofioriMarkdownBudget({
    ...opts(inputs),
    windows: [{ min_days_out: 61, max_days_out: 90, max_daily_decrease: 6 }],
  });
  assert.equal(result.allowed, false);
});
test("accepted, confirmed and partial statuses must never be silently excluded", () => {
  for (const status of ["queued", "accepted", "confirmed", "published", "partial"]) {
    assert.ok(MARKDOWN_BUDGET_STATUSES.includes(status));
  }
});
test("a held or superseded candidate is never allowed to publish", () => {
  for (const status of ["held", "superseded", "failed"]) {
    assert.equal(checkOttofioriMarkdownBudget(opts([{ ...candidate(), status }])).allowed, false);
  }
});
test("no markdown may publish in a zero-decrease long-lead window", () => {
  const result = checkOttofioriMarkdownBudget({
    ...opts([candidate(-3, 101)]),
    windows: [{ min_days_out: 91, max_days_out: 180, max_daily_decrease: 0 }],
  });
  assert.equal(result.allowed, false);
});
test("a safe date remains eligible when another date has exhausted its budget", () => {
  const other = { ...candidate(-20), id: "other", stay_date: "2026-10-30", status: "accepted" };
  assert.equal(checkOttofioriMarkdownBudget(opts([candidate(), other])).allowed, true);
});
test("a fifth markdown is held even if the euro cap is available", () => {
  const decisions = [candidate(-1), ...["accepted", "confirmed", "partial", "published"].map((status, i) => ({
    ...candidate(-1), id: `past-${i}`, status,
  }))];
  assert.equal(checkOttofioriMarkdownBudget(opts(decisions)).allowed, false);
});
