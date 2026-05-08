## What's happening

Edge function logs show the auth call succeeds (`Previo authenticated successfully via PREVIO_API_USERNAME/PASSWORD`) but the very next line crashes:

```
SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
   at file:///…/previo-sync-rooms/index.ts:50:23   ← await response.json()
```

So the issue is **not** the Lovable preview/gateway and **not** auth. Previo is returning a `2xx` response whose **body is HTML**, not JSON. The function then blindly calls `response.json()` and the parse error bubbles up to the UI as the toast you're seeing.

I tested `https://api.previo.app/rest/rooms` directly:
- `/rest/rooms` (no auth) → `401 application/json` ✅ (correct REST endpoint)
- `/v2/rest/rooms` → `301` redirect to `https://help.previo.app/en/doc/api-access/` (HTML)

The most likely cause is one of:
1. The PREVIO_API_USERNAME/PASSWORD credentials authenticate but the account doesn't have REST API permission on hotel `730099`, so Previo serves an HTML error/redirect page with a 200 body.
2. A misconfigured `PREVIO_API_BASE_URL` secret pointing somewhere that returns HTML on success.
3. The hotel id header (`X-Previo-Hotel-ID: 730099`) is not the right one for this account, so Previo returns a help page.

Right now we can't tell which, because the function discards the response body before logging it.

## Fix

### 1. `supabase/functions/_shared/previoAuth.ts`
On a successful (`response.ok`) response, peek at `Content-Type`. If it isn't JSON, read the body as text and throw a descriptive error like:
```
Previo returned non-JSON (200, text/html) from /rest/rooms via <source>: <first 300 chars of body>
```
Also log `response.status`, `content-type`, final `response.url` (to detect cross-host redirects), and the resolved `baseUrl` so we can see where the HTML really came from.

### 2. `supabase/functions/previo-sync-rooms/index.ts`
Replace the bare `await response.json()` (line 80) with a safe parse:
- Read `await response.text()` once.
- Try `JSON.parse`; on failure throw `Previo /rest/rooms returned non-JSON (status=…, content-type=…): <snippet>`.
- Re-use the same pattern in the `previewOnly`, `importLocal`, and default branches.

The existing `pms_sync_history` failure-logger already captures `error.message`, so the import history row will now show the real Previo body snippet instead of the JSON-parse stack.

### 3. Same hardening in the other Previo functions that consume `response.json()`
`previo-test-connection`, `previo-pms-sync`, `previo-poll-checkouts`, `previo-pull-rates`, `previo-sync-reservations`, `previo-update-room-status`, `previo-update-minibar` — apply the same `safeJson` helper from `_shared/previoAuth.ts` so any future Previo HTML response surfaces a clean diagnostic instead of `Unexpected token '<'`.

### 4. `src/components/dashboard/RoomManagement.tsx`
No behaviour change needed — the existing error toast + import-history row will now display the real Previo error string instead of an HTML snippet. I'll just shorten the inline preview-error line to use the new clearer message verbatim.

## After deploy

Click **Refresh preview** once. The toast / import-history entry will tell us exactly what Previo returned (status, content-type, body snippet, final URL). Based on that we'll know whether to:
- Update the per-hotel Previo credential (most likely),
- Fix `PREVIO_API_BASE_URL`, or
- Adjust the hotel ID header/path.

No DB schema changes. No UI redesign.
