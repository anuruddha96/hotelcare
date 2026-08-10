# Revenue page: push straight away, smoother mobile, simpler look

## 1. Remove the second review step (fixes the broken dialog in the screenshots)

The "Change prices for 2026-08-16" dialog already shows an exact preview of every price that will change. Sending those changes then re-opening "Send price changes to Previo" is a duplicate preview, and that second dialog is what is visually breaking (overlapping buttons, wrapped consent label, an amber technical panel squeezed into the footer).

Changes:

- The day tool's primary button becomes **"Update N prices in Previo"** — it saves the drafts and pushes them in the same action, no consent checkbox, no second dialog.
- A secondary **"Save as draft"** stays for users who want to stage changes.
- Result feedback is immediate and specific:
  - all good: "12 prices are live in Previo".
  - partial/failed: an inline result panel listing each rejected date + room type with Previo's own reason (rate-write scope off, unknown pricelist, sequential-occupancy, etc.) and a **Retry failed** button. Nothing silently stays in draft.
- The same "push now" behaviour is used by the bulk editor and the pickup board re-price actions.
- The old "Send price changes to Previo" dialog is kept only as a **Pending changes** list for anything that failed or was deliberately saved as draft; it is rebuilt with a clean two-column layout, the amber technical block and the "Check write access" / "Sync rate plans" buttons moved out into the admin-only tools bar.

## 2. Rate & pickup calendar position

Placed directly after "Today's Sales & ADR Goal" (the sales performance graph), before the pickup charts. Pickup horizon, movement board and everything technical follow below.

## 3. Mobile KPI strip in "How August 2026 is performing"

Current behaviour is a `setInterval` nudging `scrollLeft` by 1px every 40ms — that is why it looks choppy in the preview and stalls on a real phone (iOS pauses timers and momentum scrolling fights the writes).

Replacement:

- `requestAnimationFrame` drift with sub-pixel accumulation, paused when the tab or the card is not visible (IntersectionObserver), so it starts working on the device.
- It **stops at the last card** instead of jumping back to the start.
- **Page-scroll linked**: as the user scrolls the page down, the strip advances left proportionally (scroll progress across the card's viewport range mapped onto the strip's scrollable width), eased so it glides.
- Any touch/drag hands control to the user permanently for that session; snap points keep cards aligned.

## 4. Mobile Rate & pickup calendar

- **Expand button** opens the calendar full-screen (own sheet, no page chrome, landscape-friendly, larger cells) purely for pricing work.
- **Multi-day selection on touch**: long-press a date header to enter select mode, then tap dates to add/remove; drag across headers also works. A floating bar shows "4 days selected · Change prices".
- Sticky date header and room-type column in the expanded view; horizontal swipe moves week by week.

## 5. Simpler, lighter page

- Long paragraphs replaced by short labels plus an info icon (e.g. the pricelist explainer, pickup explainers, the "prices are written to Previo…" text).
- Card headers shortened; one accent colour for pickup; consistent spacing and fewer boxed notes.
- Technical wording ("rate-write scope", "pricelist ids", "drafts") only shown to admins; managers see plain language.

## 6. "Recently updated" price signal that persists

- Each price cell carries a small blue dot when its last confirmed change is within the freshness window, sourced from `rate_change_audit` (the same data the hover card uses), so it survives reloads and stays until the next change.
- The dot fades from solid (today) to outline (this week) and disappears after that; hover/tap still gives "changed 2h ago by Ravi, €154 → €165 (+7%)".
- The dot is only set from **confirmed** Previo writes, so it never claims an update that did not land.

## Technical notes

- `src/components/revenue/RateStrategyGrid.tsx`: day tool save+push path, result panel, pending-changes dialog rebuild, touch multi-select, expanded sheet, freshness dots.
- `src/lib/rateDrafts.ts`: add `saveAndPush` returning per-row outcomes so all three entry points share one path.
- `src/components/revenue/MonthPerformanceHeader.tsx`: rAF + scroll-linked strip, clamp at end, visibility pause.
- `src/pages/RevenueHotelDetail.tsx`: section order, copy trimming, admin-only technical blocks.
- `src/hooks/useRateAudit.ts`: expose last-change timestamp per cell key for the freshness dots.
