# Fixes & Improvements — 5 items

## 1. Purchase Invoices — Background uploads + recent summary + status animation

**Problem:** Uploads cancel when user switches tab. No visibility of progress on other tabs. No recent activity summary on the Upload tab.

**Changes (frontend only, `src/pages/PurchaseInvoices.tsx` + new components):**

- **Global upload manager** — lift upload state to a new `UploadQueueContext` (mounted in `PurchaseInvoices`). Each file gets a job: `{ id, name, size, status: 'uploading'|'scanning'|'done'|'error', progress }`. Promises run independently of which tab is active so switching tabs no longer cancels work.
- **Persistent status dock** — fixed bottom-right card that lists active jobs with a smooth Framer Motion progress ring + check/error transitions, collapsible, survives tab switches. Reuses design tokens.
- **Inline status strip** on the Upload tab (current spinner) becomes a richer animated row (per-file pill: file icon + animated progress arc + status label).
- **Recent uploads panel** under the Upload tiles: shows last 10 invoices (merchant, date, total, status badge). Pulls from same `invoices` query, ordered desc, limit 10.
- **"View all invoices →" button** under the panel — calls `setActiveTab('queue')` (already controlled via state from prior work).

## 2. Purchase Invoices — Queue stops at page 14

**Root cause:** `src/pages/PurchaseInvoices.tsx:91` hard-codes `.limit(500)`. With 50 per page that's exactly ~14 pages (a partial 15th).

**Fix:** Switch the queue query to server-side pagination — fetch `range((page-1)*50, page*50-1)` with `{ count: 'exact' }` and drive pagination from the returned `count` so it continues past 500 to the true end. Keep client-side filters working by re-querying when filters change.

## 3. Breakfast — Hotel Memories room 216 missing (70 instead of 71)

**Root cause:** `breakfast-public-lookup` (list mode) reads only from `daily_overview_snapshots`. For Hotel Memories Budapest, the latest snapshot (2026-05-28) contains 70 distinct rooms — room **216** is absent from the PMS daily overview, even though it exists in the `rooms` table (confirmed: 71 active rooms incl. 216 `economy_quadruple`).

**Fix (edge function `supabase/functions/breakfast-public-lookup/index.ts`, list mode):**
After building the snapshot map, also fetch all rooms from the `rooms` table for that hotel and **union** any missing rooms in as `status: 'no_breakfast'` chips (vacant/no PMS row). This guarantees the full 71 rooms always show and is resilient to future PMS gaps. No DB migration needed.

## 4. Housekeeper card — "Add Minibar Item (after completion)" overflows

**File:** `src/components/dashboard/AssignedRoomCard.tsx` (~line 1301)

**Fix:** Allow the button text to wrap on two lines on narrow screens and shrink font:
- `className="w-full ... h-auto min-h-[40px] py-2 whitespace-normal text-xs leading-tight"`
- Replace static label with two-line layout: bold "Add Minibar" + small "(after completion)" subtitle, so it fits cleanly in the button without truncation. Same treatment for the matching dirty linen button for visual parity.

## 5. Location access — ask once, manage from Settings

**Problem:** `AttendanceTracker.tsx:83` calls `getCurrentPosition` on every mount, re-prompting after every refresh.

**Changes:**
- New helper `src/lib/locationPreference.ts` — wraps the Permissions API (`navigator.permissions.query({ name: 'geolocation' })`). Caches the last granted position with timestamp in `localStorage` (`hc.location.lastFix`, `hc.location.optIn`).
- `AttendanceTracker.tsx` — only calls `getCurrentPosition` if `optIn === true` AND `permissions.state !== 'denied'`. If a recent fix (<10 min) is cached, reuse it instead of re-querying. First-time users see a small inline opt-in card ("Use my location for sign-in?  Allow / Skip") rather than a forced browser prompt loop.
- **Settings page entry** — add a "Location access" row in the user/profile settings panel (whichever Settings surface exists in `Header` dropdown). Shows current permission state and a button to: enable (triggers `getCurrentPosition` once), disable (clears opt-in + cached fix), or "Open browser site settings" (deep link instructions when permission is `denied` — browser-level revoke).

## Files touched

- `src/pages/PurchaseInvoices.tsx` — pagination fix, recent panel, view-all button, hook into upload context
- `src/components/purchase-invoices/UploadQueueDock.tsx` (new) — persistent animated status dock
- `src/contexts/UploadQueueContext.tsx` (new)
- `src/components/purchase-invoices/RecentInvoicesPanel.tsx` (new)
- `supabase/functions/breakfast-public-lookup/index.ts` — union rooms table in list mode
- `src/components/dashboard/AssignedRoomCard.tsx` — button fit
- `src/components/dashboard/AttendanceTracker.tsx` + new `src/lib/locationPreference.ts`
- Settings surface (location row) — exact file TBD on implementation (likely a dropdown in `Header.tsx` or existing profile panel)

## Out of scope
- Fixing the PMS sync to backfill room 216 into `daily_overview_snapshots` (frontend union is the safe fix; deeper Previo sync investigation can follow if you want).
- Resumable uploads across full page reloads (background continues across tab switches inside the SPA; a hard browser reload still cancels — that would need Service Worker upload, larger scope).
