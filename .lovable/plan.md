# Mobile-first Revenue: one screen, prices in two taps

Goal: on a phone the Revenue page should feel like a small pricing app, not a desktop dashboard squeezed into 440px. Everything a revenue manager needs at a red light: see today, see the next days, change a price, done.

## What is wrong today

On mobile the Revenue tab renders, in order: month performance strip, the full rate grid, market intelligence chart, events panel, pickup movement board, today's sales & ADR goal, then a tools bar with segments, year over year, competitor rates, morning e-mail (plus more for admins). That is seven heavy analytical blocks and several charts below the fold, on a screen where only one thing matters: the prices.

## New mobile layout (below 768px only — desktop untouched)

The Revenue page gets a dedicated mobile shell with three tabs at the bottom of the screen:

```text
[ Prices ]   [ Today ]   [ More ]
```

### 1. Prices (default tab)

- **Day strip** at the top: horizontally scrollable dates, each showing date, occupancy dot and the lead price. Tap a date to open it.
- **Day card list** below: one card per room type for the selected date, showing the current price big, occupancy/rooms left, and a pickup arrow. No horizontal matrix scrolling on mobile.
- **Edit in place**: each card has −/+ steppers and a tap-to-type price. Change lands as a pending edit shown in a footer bar: "3 prices changed · Update". One tap publishes, background push, confirmation toast. No consent dialog, no second review step.
- **Bulk over days**: a "Change several days" button opens the existing bulk flow as a full-height bottom sheet (date range, room types, +/− amount or %, presets). Same engine as today, mobile chrome.
- Long-press a card to see its history sheet (existing cell history, unchanged logic).
- The full grid is still reachable via "Open full grid" for anyone who wants the matrix.

### 2. Today

One compact screen: today's rooms sold, revenue, ADR vs target, occupancy, and pickup for the next 7 days as a single small bar row. Nothing else. This replaces the current Today's Sales & ADR Goal card's five-series chart on mobile.

### 3. More

Everything analytical moves behind this tab as a plain list: Market intelligence, Events, Pickup movements, Segments & channels, Year over year, Competitor rates, Morning e-mail, and (admin only) Demand desk, Revenue pulse, AI intelligence, Automation settings, Sync history. Each opens full-screen. Nothing analytical renders on the Prices tab, so the page paints fast.

## Noise removal

- Recommendations / strategy recommendation surfaces are hidden on mobile (they are not used).
- Technical wording (drafts, pricelist ids, rate-write scope) stays admin-only.
- Long explainer paragraphs become an info icon.

## Interaction quality bar

- Every tap target ≥ 44px; price steppers large enough for one thumb.
- Sheets are full-height with a fixed header, a single scrolling body and a pinned action bar (never overlapping the list).
- Optimistic price update with a clear pending → confirmed state; failures surface inline with a Retry.

## Technical notes

- New `src/components/revenue/mobile/` folder: `MobileRevenueShell.tsx` (tab shell), `MobileDayStrip.tsx`, `MobilePriceDayList.tsx`, `MobilePriceCard.tsx`, `MobileTodayPanel.tsx`, `MobileMoreList.tsx`.
- `src/pages/RevenueHotelDetail.tsx` branches on `useIsMobile()`: mobile renders the shell, desktop keeps the current tree exactly as-is.
- Data comes from the same `useRevenueHotelData` result already loaded — no new queries, no schema or Edge Function changes.
- Publishing reuses `rateDrafts.ts` / `revenue-enqueue-rates`; pricing, safety, ladder and automation logic are untouched.
- Existing components (`BulkPriceEditor`, `RateCellHistory`, `MarketIntelligenceChart`, etc.) are reused inside mobile sheets rather than rewritten.

## Order

1. Mobile shell + Prices tab with day strip, day cards, inline editing and publish
2. Today tab
3. More tab and removal of the analytical stack from the mobile Prices view
