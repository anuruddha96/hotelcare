// Pure alert enrichment. PostgreSQL rollback counters cannot, by themselves, prove
// failed application writes or data loss. Keep this independent of Supabase/I/O.
const MAX_EVIDENCE_AGE_MS = 120_000;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRecent(instant, capturedAtMs) {
  const parsed = Date.parse(String(instant ?? ""));
  return Number.isFinite(parsed) && Number.isFinite(capturedAtMs)
    && Math.abs(capturedAtMs - parsed) <= MAX_EVIDENCE_AGE_MS;
}

export function enrichRollbackAlert(alert, rollbackEvidence, realtimeEvidence, capturedAt = new Date()) {
  if (alert.kind !== "rollback_storm") return alert;

  const oldDetails = isRecord(alert.details) ? alert.details : {};
  const captureMs = capturedAt instanceof Date ? capturedAt.getTime() : Date.parse(String(capturedAt));
  const sameDetection = isRecent(alert.detected_at, captureMs);
  const windowSeconds = Number(rollbackEvidence?.diagnostic_window_seconds);
  const usableRollbackEvidence = sameDetection && isRecord(rollbackEvidence)
    && Number.isFinite(windowSeconds) && windowSeconds >= 30 && windowSeconds <= 1800;
  const usableRealtimeEvidence = sameDetection && isRecord(realtimeEvidence)
    && isRecent(realtimeEvidence.sampled_at, captureMs);
  const attached = usableRollbackEvidence || usableRealtimeEvidence;

  return {
    ...alert,
    // A separate deadlock_spike alarm already exists for verified deadlocks.
    // Don't equate rollback volume or percentage with an application failure.
    severity: "warning",
    title: "Unusually high PostgreSQL rollback rate (cause unconfirmed)",
    details: {
      ...oldDetails,
      ...(usableRollbackEvidence ? rollbackEvidence : {}),
      ...(usableRealtimeEvidence ? { realtime_evidence: realtimeEvidence } : {}),
      evidence_status: attached ? "sampled_context_only" : "unavailable_or_outside_alert_window",
      severity_basis: "Unconfirmed rollback counter spike. No verified write failure or data loss.",
      log_correlation: "SQL errors and HTTP failures are not measured by pg_stat_database; correlate with PostgreSQL, Edge and request logs for this alert's timestamp.",
      interpretation: "A rollback is a transaction outcome, not proof that a user operation failed. Query and Realtime samples do not identify the cause.",
      ...(!sameDetection ? {
        investigation_hint: "Delayed alert: current query/Realtime samples intentionally excluded because they belong to another time window.",
      } : {}),
    },
  };
}
