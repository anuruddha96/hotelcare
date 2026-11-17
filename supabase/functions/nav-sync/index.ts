/**
 * NAV Online Számla incoming-invoice sync (read-only).
 *
 *  - Scheduled (pg_cron, x-worker-secret): every due, enabled connection.
 *  - Manual "Sync now": controlling / admins of the caller's organization.
 *
 * After new NAV data arrives (and at least daily) the organization is
 * reconciled. A NAV failure is recorded on the connection with back-off and
 * never blocks document uploads.
 */
import { authorizeCaller, corsHeaders, InputError, json, serviceDb, type Db } from "../_shared/purchaseInvoices/piAuth.ts";
import { syncConnection, type NavConnectionRow, type SyncOutcome } from "../_shared/purchaseInvoices/navSyncRunner.ts";
import { isSyncDue } from "../_shared/purchaseInvoices/navSyncPlan.ts";
import { runReconciliation } from "../_shared/purchaseInvoices/reconcileRunner.ts";

const CONNECTION_COLUMNS = "id, organization_slug, company_id, environment, tax_number, enabled, sync_from_date, initial_sync_through, " +
  "initial_sync_completed_at, ins_date_cursor, last_backfill_at, consecutive_failures, last_attempt_at, next_retry_at";

function budgetMs(): number {
  const seconds = Number(Deno.env.get("NAV_SYNC_BUDGET_SECONDS") ?? "110");
  return Math.min(380, Math.max(30, Number.isFinite(seconds) ? seconds : 110)) * 1000;
}

async function settingsByOrg(db: Db, orgs: string[]) {
  const map = new Map<string, Record<string, unknown>>();
  if (!orgs.length) return map;
  const { data } = await db.from("pi_module_settings").select("organization_slug, auto_reconcile, sync_interval_minutes, backfill_days").in("organization_slug", orgs);
  for (const row of data ?? []) map.set(row.organization_slug, row);
  return map;
}

async function reconcileAfterSync(db: Db, orgs: Set<string>, settings: Map<string, Record<string, unknown>>) {
  const results: Record<string, unknown> = {};
  for (const org of orgs) {
    if (settings.get(org)?.auto_reconcile === false) { results[org] = "auto_reconcile_disabled"; continue; }
    const result = await runReconciliation(db, org);
    results[org] = { status: result.status, runs: result.runs, summary: result.result?.summary ?? null, error: result.error ?? null };
  }
  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const started = Date.now();
  try {
    if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
    const db = serviceDb();
    const caller = await authorizeCaller(req, db, { allowWorker: true });
    if (caller instanceof Response) return caller;
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const deadlineMs = started + budgetMs();

    let connections: NavConnectionRow[] = [];
    let trigger: "manual" | "schedule" = "schedule";
    if (caller.kind === "worker") {
      const { data, error } = await db.from("pi_nav_connections").select(CONNECTION_COLUMNS).eq("enabled", true).order("last_attempt_at", { ascending: true, nullsFirst: true });
      if (error) throw new Error(error.message);
      const settings = await settingsByOrg(db, [...new Set<string>((data ?? []).map((c: NavConnectionRow) => c.organization_slug))]);
      connections = (data ?? []).filter((c: NavConnectionRow & { last_attempt_at: string | null; next_retry_at: string | null }) => {
        // A history load in progress continues on every tick; back-off still applies.
        const loadingHistory = !c.initial_sync_completed_at && !!c.sync_from_date;
        return isSyncDue({
          enabled: c.enabled, lastAttemptAt: c.last_attempt_at, nextRetryAt: c.next_retry_at,
          // 5 minutes of slack so a 30-minute cron tick is never skipped by jitter.
          intervalMinutes: (loadingHistory ? 30 : Number(settings.get(c.organization_slug)?.sync_interval_minutes ?? 120)) - 5, now: new Date(),
        });
      });
    } else {
      if (!caller.canControlNav) return json({ ok: false, error: "Only controlling or an organization administrator can start a NAV sync" }, 403);
      trigger = "manual";
      let query = db.from("pi_nav_connections").select(CONNECTION_COLUMNS).eq("organization_slug", caller.organizationSlug).eq("enabled", true);
      if (body.connection_id) query = query.eq("id", String(body.connection_id));
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      if (!data?.length) throw new InputError("No enabled NAV connection to sync. Test and enable a connection in Settings first.");
      const recent = data.find((c: { last_attempt_at: string | null }) => c.last_attempt_at && Date.now() - Date.parse(c.last_attempt_at) < 90_000);
      if (recent && body.connection_id) throw new InputError("A NAV sync for this company ran less than two minutes ago");
      connections = data;
    }

    const settings = await settingsByOrg(db, [...new Set(connections.map((c) => c.organization_slug))]);
    const outcomes: SyncOutcome[] = [];
    const changedOrgs = new Set<string>();
    for (const conn of connections) {
      if (Date.now() > deadlineMs - 5_000) break;
      const outcome = await syncConnection(db, conn, {
        trigger,
        requestedBy: caller.kind === "user" ? caller.userId : null,
        deadlineMs,
        backfillDays: Number(settings.get(conn.organization_slug)?.backfill_days ?? 45),
        forceBackfill: body.backfill === true && caller.kind === "user",
      });
      outcomes.push(outcome);
      if (outcome.upserted > 0 || outcome.details > 0 || (outcome.status === "completed" && !conn.initial_sync_completed_at)) {
        changedOrgs.add(conn.organization_slug);
      }
    }

    // Reporting-delay windows move with the calendar, so each organization with
    // NAV enabled is also re-evaluated at least once a day.
    if (caller.kind === "worker") {
      const orgs = [...new Set(connections.map((c) => c.organization_slug))];
      const { data: allEnabled } = await db.from("pi_nav_connections").select("organization_slug").eq("enabled", true);
      for (const row of allEnabled ?? []) orgs.push(row.organization_slug);
      const unique = [...new Set(orgs)];
      if (unique.length) {
        const { data: states } = await db.from("pi_reconcile_state").select("organization_slug, last_finished_at").in("organization_slug", unique);
        const last = new Map<string, string | null>((states ?? []).map((s: { organization_slug: string; last_finished_at: string | null }) => [s.organization_slug, s.last_finished_at]));
        for (const org of unique) {
          const finished = last.get(org);
          if (!finished || Date.now() - Date.parse(finished) > 20 * 3_600_000) changedOrgs.add(org);
        }
      }
      const extra = await settingsByOrg(db, [...changedOrgs].filter((o) => !settings.has(o)));
      for (const [k, v] of extra) settings.set(k, v);
    } else if (outcomes.some((o) => o.status !== "skipped")) {
      changedOrgs.add(caller.organizationSlug);
    }
    const reconciliation = Date.now() < deadlineMs + 25_000 ? await reconcileAfterSync(db, changedOrgs, settings) : {};

    return json({
      ok: true,
      synced: outcomes.map((o) => ({
        connection_id: o.connectionId, status: o.status, run_id: o.runId, pages: o.pages, invoices: o.digests,
        saved: o.upserted, details: o.details, details_failed: o.detailsFailed, error: o.error ?? null,
      })),
      skipped_for_time: connections.length - outcomes.length,
      reconciliation,
    });
  } catch (cause) {
    if (cause instanceof InputError) return json({ ok: false, error: cause.message }, cause.status);
    console.error("nav-sync failed", cause instanceof Error ? cause.message : "unknown error");
    return json({ ok: false, error: "NAV sync failed" }, 500);
  }
});
