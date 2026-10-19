import test from "node:test";
import assert from "node:assert/strict";
import { enrichRollbackAlert, shouldEmailAnomalyAlert } from "./rollbackClassification.mjs";

const capturedAt = new Date("2026-10-16T21:00:30.000Z");
const base = {
  id: "anomaly-1", kind: "rollback_storm", severity: "critical",
  title: "Database rollback/error storm detected", detected_at: "2026-10-16T21:00:01Z",
  details: { rollbacks: 21303, commits: 1874, rollback_ratio_percent: 91.91 },
};
const queries = { diagnostic_window_seconds: 299.9, authenticated_request_setup_calls: 95, top_query_deltas: [{ calls: 378, category: "realtime_wal_reader" }] };
const realtime = { sampled_at: "2026-10-16T21:00:05Z", table_change_intervals: [{ table_name: "rooms", updated: 426 }] };

test("high rollback count alone is warning, without asserting failed writes", () => {
  const alert = enrichRollbackAlert(base, queries, realtime, capturedAt);
  assert.equal(alert.severity, "warning");
  assert.match(alert.title, /cause unconfirmed/);
  assert.match(alert.details.severity_basis, /No verified write failure/);
  assert.equal(alert.details.rollbacks, 21303);
});

test("recent evidence is labeled contextual, not causal", () => {
  const alert = enrichRollbackAlert(base, queries, realtime, capturedAt);
  assert.equal(alert.details.evidence_status, "sampled_context_only");
  assert.equal(alert.details.authenticated_request_setup_calls, 95);
  assert.equal(alert.details.realtime_evidence.table_change_intervals[0].updated, 426);
  assert.match(alert.details.log_correlation, /SQL errors and HTTP failures/);
});

test("delayed emails never attribute a newer snapshot to an older alert", () => {
  const old = { ...base, detected_at: "2026-10-16T20:20:01Z" };
  const alert = enrichRollbackAlert(old, queries, realtime, capturedAt);
  assert.equal(alert.details.evidence_status, "unavailable_or_outside_alert_window");
  assert.equal(alert.details.top_query_deltas, undefined);
  assert.equal(alert.details.realtime_evidence, undefined);
  assert.match(alert.details.investigation_hint, /Delayed alert/);
});

test("missing, stale or malformed diagnostics are not presented as evidence", () => {
  for (const queryEvidence of [null, {}, { diagnostic_window_seconds: 0 }, { diagnostic_window_seconds: 999999 }]) {
    const alert = enrichRollbackAlert(base, queryEvidence, { sampled_at: "2026-10-16T20:20:01Z" }, capturedAt);
    assert.equal(alert.details.evidence_status, "unavailable_or_outside_alert_window");
    assert.equal(alert.details.realtime_evidence, undefined);
  }
});

test("missing capture clock cannot attach unrelated counters", () => {
  const alert = enrichRollbackAlert(base, queries, realtime, "invalid clock");
  assert.equal(alert.details.evidence_status, "unavailable_or_outside_alert_window");
});

test("other system alerts retain their verified severity and evidence", () => {
  const deadlock = { ...base, kind: "deadlock_spike", title: "Deadlocks", details: { deadlocks: 3 } };
  assert.equal(enrichRollbackAlert(deadlock, queries, realtime, capturedAt), deadlock);
});

test("rollback-only alerts stay recorded without generating email", () => {
  assert.equal(shouldEmailAnomalyAlert(base), false);
  assert.equal(shouldEmailAnomalyAlert(enrichRollbackAlert(base, queries, realtime, capturedAt)), false);
});

test("verified deadlock and hot-query alert emails remain active", () => {
  for (const kind of ["deadlock_spike", "query_loop", "query_cpu_hotspot"]) {
    assert.equal(shouldEmailAnomalyAlert({ ...base, kind }), true);
  }
});
