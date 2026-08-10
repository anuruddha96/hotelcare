# Rate activity trail, cell history on hover, amount presets, and drag-select of dates

## 1. See what you changed — a real activity trail

Today every draft and push is stored (`revenue_rate_drafts`) but nothing writes a durable history row, so there is no "who changed what, when". `rate_change_audit` exists and is only read by the export function.

- Every drafted price change and every successful Previo push writes one `rate_change_audit` row: stay date, room type, occupancy, old price, new price, delta (value and %), source (day tool, cell edit, demand grading, autopilot), and the user.
- New **Activity** panel on the Revenue page under the Rate & pickup calendar: newest first, filterable by date range, room type, user, and action (drafted / pushed / failed / demand graded). Each line reads in plain words: "09 Aug 18:12 — you raised Deluxe Queen, 2 guests, 17 Aug from €111 to €123 (+€12, +11%) — pushed to Previo".
- Group rows made in one action (a whole-day change of 13 prices shows as one expandable entry).
- The panel also lists demand gradings and signal actions already stored in `revenue_signal_actions`, so "I already acted on this" is visible in one place.

## 2. Hover a price cell to see its story

Hovering (or tapping on mobile) any rate cell shows a small card:

```text
Deluxe Queen · 2 guests · 17 Aug
Current   €123
Last change  +€12 (+11%)  ·  9 Aug 18:12 by Nuwan
Pushed to Previo  9 Aug 18:14
Before    €111
```

Cells changed in the last 7 days get a subtle corner marker so recent activity is scannable without hovering. Pending (unpushed) drafts keep their existing draft styling and the card says "draft — not sent yet".

## 3. Push only with admin / top-management consent

- The push edge function keeps its role check and is tightened so only `admin` and top-management roles can push; other roles can draft only.
- The push dialog gains an explicit confirmation step listing the number of prices, date span and total effect, with a typed-free single "Approve and push" action, and the approver is recorded in the audit trail.
- Autopilot/automated paths never push for Ottofiori without an approved draft.

## 4. "Change prices for …" dialog — amount-first with real presets

- Default mode becomes **Change by amount** (RD Hotels rarely uses %).
- Preset chips become one-click amounts: **+1, +2, +8, +11, +18, +22** in the hotel's currency, plus **−1, −2** for softening; the percent presets move behind a small "%" toggle.
- The amount field keeps −/+ steppers for fine tuning.
- Title shows the real selection: "Change prices for 17 Aug" or "Change prices for 17–21 Aug (5 dates)".

## 5. Select several dates by dragging across the date row

- Press and drag across the date header to select a range; the selected columns highlight while dragging.
- Ctrl/Cmd-click (and a "+" tap target on touch) adds non-contiguous dates to the selection.
- Releasing the drag opens the same change-prices dialog pre-filled with the selected dates; the "Days from here" control switches to "Selected dates (N)".
- Applying computes each cell separately per date × room type × occupancy from that cell's own current price, so percentages and amounts land correctly everywhere. Selection clears after saving or on Escape.
- On touch, the same is available via a "Select dates" toggle that turns the header into tappable multi-select.

## 6. Carried over from earlier requests

Included in this pass:
- Currency label fix and mobile day-tool sheet (already delivered) stay as-is.
- Events row wiring for the calendar and manual event entry, if not yet visible.

Still open, not in this pass unless you say so:
- SLNT evening scheduling workflow and supervisor venue coverage diagram.
- Housekeeper-card status counters (done / in progress / pending / DND).

## Technical notes

- Migration: allow inserts into `rate_change_audit` from the app for revenue roles (RLS scoped to the user's organization), plus an index on `(hotel_id, performed_at desc)`.
- `RateStrategyGrid.tsx`: new `selectedDates` state driven by pointer-drag on the date header; day tool reads the selection instead of a single `dayTool` date; amount-first modes and preset chips; audit rows written alongside `revenue_rate_drafts` upserts.
- New `src/components/revenue/RateCellHistory.tsx` (hover card) fed by a `useRateChangeHistory` hook that loads recent `rate_change_audit` rows for the visible window and indexes them by date/room/occupancy.
- New `src/components/revenue/RateActivityPanel.tsx` reading `rate_change_audit` joined with `profiles` for names, merged with `revenue_signal_actions`.
- `supabase/functions/revenue-push-drafts/index.ts`: restrict `PUSH_ROLES` to admin/top-management, record an audit row per pushed price with the approver id, keep grouped-occupancy push behaviour.
- No changes to SLNT-specific behaviour beyond the shared calendar UI; HUF formatting is used wherever the hotel's base currency is HUF.
