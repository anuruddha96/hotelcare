## What's happening

The toast `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` comes from the **automatic** Previo room preview that runs when you open the Rooms tab. The browser called `previo-sync-rooms` while the function was being redeployed (the latest deploy finished at 10:52:43 UTC), so the gateway briefly returned an HTML error page instead of JSON. `supabase.functions.invoke` tried to `JSON.parse` that HTML and threw.

The Import-from-Previo button itself has the same exposure — any transient HTML response from the gateway (cold start, 502/503, deployment roll) will surface as that scary "Unexpected token" toast even though nothing is wrong with the data.

## Proposed fix (frontend only — no code in this mode)

Make the Previo calls in `RoomManagement.tsx` resilient to non-JSON responses and silent on the auto-load:

1. `fetchPrevioPreview()`
   - Wrap the response handling so a JSON-parse failure or transient gateway HTML is mapped to a clean `"Previo preview is temporarily unavailable, please retry"` message.
   - Because this runs automatically on tab open, **suppress the toast** on auto-load failures and only show an inline hint inside the "Extracted rooms before import" card. The toast should only appear when the user clicks **Refresh preview** explicitly.
   - Add a one-shot retry (single retry after ~800 ms) to absorb the deploy/cold-start race.

2. `handleImportFromPrevio()`
   - Same JSON-parse guard so the import button never shows the raw `<!DOCTYPE` text.
   - On failure, write a `failed` entry to the local `importHistory` state immediately (in addition to the server-side log) so the Import History panel always reflects the latest attempt.

3. Inline status in the preview card
   - Show a small muted line under "Extracted rooms before import" when the last fetch failed: `"Last preview attempt failed — click Refresh preview to retry."`
   - Keep the existing table/empty-state untouched.

No edge-function or database changes are needed; the previously deployed `previo-sync-rooms` returns proper JSON now and the per-hotel secret has just been updated.

## Verification

- Open `/rdhotels` → Rooms tab → no toast on first load.
- Click **Refresh preview** → either rooms appear or a clean error toast.
- Click **Import from Previo** → toast shows either `"Imported N of M rooms"` or the precise Previo error; never raw HTML.
- New entry appears in Import History for both success and failure.

## Technical details

- Files touched: `src/components/dashboard/RoomManagement.tsx` only.
- Helper: a small `safeInvoke(name, body)` wrapper local to the file that catches `SyntaxError` from `supabase.functions.invoke` (it happens inside the SDK when the body isn't JSON) and returns `{ data: null, error: new Error('Previo gateway returned a non-JSON response (likely a transient deploy/cold-start). Please retry.') }`.
- Retry policy: at most one extra attempt for `previewOnly`; never auto-retry for `importLocal` (avoid duplicate writes).
