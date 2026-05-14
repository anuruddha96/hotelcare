## What's actually happening

The Revenue live-sync calls `previo-pull-rates`, which in turn hits `https://api.previo.app/rest/calendar`. Previo replies:

```
405 {"code":405,"error":"Action 'getAction' is unknown","message":null}
```

This is Previo's standard "this endpoint/action doesn't exist for your account" response. The other Previo functions in this project (`previo-pms-sync`, `previo-sync-rooms`, `previo-sync-reservations`) only ever use `/rest/rooms` — there is no proven REST calendar/rates endpoint enabled for this hotel. So the live rate pull was never going to work against this Previo deployment, regardless of credentials.

The real problem is therefore not "the API is broken" — it's that we treat a *legitimately unsupported* endpoint as a hard error and surface it as red banner spam every login.

## Fix (no DB / no UI redesign)

### 1. `supabase/functions/previo-pull-rates/index.ts`
- After calling `/rest/calendar`, if the response is `404`, `405`, or the body contains `"is unknown"` / `"Action '` (Previo's "endpoint not enabled" signal), return:
  ```json
  { "ok": true, "supported": false, "upserted": 0, "total": 0,
    "message": "Previo live rate pull is not enabled for this hotel — use the XLSX upload." }
  ```
  instead of `{ ok: false, error: "Previo 405: ..." }`.
- All other failure modes (auth, 5xx, network) still return `ok: false` so we keep visibility into real outages.

### 2. `src/contexts/LiveSyncContext.tsx` — `runRevenue`
- When the response contains `supported === false`:
  - set `tasks.revenue` to `{ status: "idle", lastAt: now, meta: { supported: false, message } }` (no `error` status, no toast).
  - flip a session-scoped flag (`sessionStorage["liveSync.revenue.unsupported.<hotelId>"] = "1"`) so subsequent auto-triggers in the same session skip the call entirely (manual "Refresh" still bypasses it).
- Real errors continue to set `status: "error"` as today.

### 3. `src/pages/Revenue.tsx` — top banner
- Add a third visual state alongside success / error:
  - if `revenue.meta?.supported === false` → render a **muted info banner** (`bg-muted text-muted-foreground`, info icon) reading "Live rate sync isn't enabled for this hotel in Previo — upload the XLSX files below to keep numbers fresh." Hide the red treatment.
- Same change in `LiveSyncIndicator` popover: show "Not available" pill (neutral) for revenue task instead of red "Error".

### 4. `src/components/layout/LiveSyncIndicator.tsx`
- Treat `status === "idle"` with `meta?.supported === false` as a non-issue: don't count it toward the overall "partial/error" pill colour. The pill stays green when only PMS is healthy and Revenue is "not supported".

## Out of scope
- No attempt to discover an alternative Previo rates endpoint — that would be guesswork without Previo docs/account confirmation. The XLSX upload path remains the source of truth for rates until Previo confirms a working endpoint.
- No DB migration. No changes to `runPmsRefresh` (PMS sync is healthy).

## Result for the user
- The red "Live sync failed · Previo 405 …" banner disappears.
- Revenue page shows a calm info note explaining live rates aren't enabled and pointing at upload.
- Header LiveSync pill stays green when PMS is fine.
- Next login won't re-fire the failing call repeatedly.
