# Rate & Pickup Calendar V2

This iteration improves the existing HotelCare revenue calendar without changing pricing, pickup, PMS sync, rate publishing, or automation logic.

## UX goals

- Preserve the full HotelCare intelligence layer while reclaiming vertical space for room types.
- Keep desktop pricing dense and stable.
- Make portrait phones easier to navigate without trapping the user inside the nested calendar scroller.
- Make rotated / landscape phones use the short viewport more efficiently.
- Preserve horizontal date panning, long-press date selection, cell-range selection, sticky headers, audit markers, and Previo publishing.

## Mobile gesture behavior

The calendar still supports vertical room-row browsing. A vertical swipe immediately hands off to the page when the grid is already at its top or bottom boundary. If the user makes another vertical swipe within 700 ms, that second gesture is treated as an intentional request to continue down/up the page and is handed to the window even when the grid is mid-scroll.

Horizontal gestures remain native calendar/date scrolling. Existing long-press selection remains authoritative: if the RateStrategyGrid selection handler has already claimed a gesture, the page-scroll bridge does not interfere.

## Density

Calendar chrome is compacted responsively, especially the month/date and market-signal header rows. Landscape phones hide explanatory legend text while retaining the actual pricing signals and controls, allowing more room rows to remain visible.

## Safety

The enhancement is progressive and activates only on `[data-training="revenue-grid"]`. It does not write rates, change Supabase data, alter revenue calculations, or change Previo API behavior.
