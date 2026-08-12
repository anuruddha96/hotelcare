# Instant price publishing, smarter defaults, and a properly translated Revenue module

## 1. Make price pushes feel instant (no waiting, no drafts)

Today `revenue-enqueue-rates` does a lot of work before it answers: it de-dupes, deletes superseded drafts, inserts one draft row per cell, then inserts one push item per cell, and only then starts the background worker. For a 6-month bulk edit that is thousands of rows written while the user watches a spinner.

New behaviour:

- The moment you confirm an edit, the calendar updates locally and the change dots appear immediately (optimistic, before any network reply).
- The publish call returns as soon as the request is accepted (a run row plus the raw payload), typically well under a second regardless of range size. All expansion, de-duplication, Previo sending and verification happens in the background worker.
- No draft state in the UI, no "check now", no blocking progress modal. The user can keep editing other dates while earlier ones publish.
- A small non-blocking status pill ("Sending 1,240 prices to Previo…") with an animated progress bar sits in the calendar toolbar, counts down as the background run reports progress, then fades to "All prices live" and disappears.
- Errors are the only interruption: if any cell fails after retries, the pill turns red with "12 prices did not land — review", and those cells get the red dot they already have today.
- Bulk edits are chunked server-side so a very long range keeps making visible progress instead of finishing in one lump.

## 2. Rate & pickup calendar range and pickup defaults

- On desktop the calendar defaults to the **6m** range; mobile keeps the current shorter default.
- Add a **1.5 months (45d)** option to the range choices.
- The chosen range is remembered per user (and per device type), so whatever you last picked is what you get next time.
- Same treatment for the charts: on desktop, Pickup & occupancy horizon and the other range-driven graphs default to their widest option (6m), also remembered per user.
- The calendar's pickup window defaults to **today + yesterday** (2 days) instead of today only, and remains changeable from the existing "Pickup:" selector.

## 3. Today's Sales & ADR Goal joins the page sync

The panel currently shows "Not synced yet" and only refreshes on its own schedule. It will subscribe to the page-level sync: pressing "Sync now" (or an automatic sync finishing) refreshes this panel too, and its label reflects the shared last-sync time.

## 4. Real translations for Revenue Management

The Revenue module is almost entirely hard-coded English, which is why switching to Magyar changes nothing there.

- Move every user-visible Revenue string (calendar, toolbars, KPI cards, bulk editor, automation settings, pickup board, sales/ADR panel, tooltips and legends) into the existing translation system, with full Hungarian coverage and the other supported languages.
- Keep layout resilient to longer words: labels wrap or truncate with a tooltip instead of pushing the grid, buttons and KPI cards size to content with sensible minimums, and the calendar's sticky left column stays aligned.

## Technical notes

- `revenue-enqueue-rates`: accept and persist the payload plus a run row, return `runId` immediately, and move draft/item expansion, supersede-deletion and worker kickoff into `EdgeRuntime.waitUntil`. Keep the existing auth, hotel-access and per-cell de-dup rules.
- `revenue-push-drafts`: chunked processing with per-run progress counters so the UI pill can show live progress; keep the existing gap-free occupancy ladder to avoid Previo error 3092.
- Client: `publishRates` becomes fire-and-forget with an optimistic local mirror and immediate audit-dot insertion; a lightweight run-progress subscription drives the pill.
- Range/pickup defaults stored per user in local preferences, seeded from `useIsMobile`.
- Translations added to the existing `*-translations.ts` files consumed by `useTranslation`.

## Validation

- Publish 1 day, 30 days, and a full 6-month range and confirm the dialog closes and the grid shows new prices within about a second in each case.
- Confirm background verification eventually marks all cells confirmed, and that a forced failure surfaces as a red pill plus red cells.
- Check desktop defaults (6m calendar, 6m horizon, pickup = today + yesterday) and that changing them persists across reloads.
- Switch to Magyar and walk through the whole Revenue page checking for untranslated text and broken layout.
