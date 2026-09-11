# Rate Calendar V2 — implementation summary

First implementation focuses on the two highest-value improvements that can be delivered safely without touching revenue calculations or Previo publishing code:

1. **More usable viewport** — responsive compaction of the calendar's own header / intelligence rows so more room rows remain visible.
2. **Mobile scroll escape** — a gesture bridge that prevents users becoming trapped in the nested calendar scroller. At a boundary the page scrolls immediately; a second quick vertical swipe also hands control to the page while horizontal date movement remains native.

The enhancement is isolated in `RevenueCalendarExperience.tsx` and mounted globally through the already-present `PointerEventsGuard`. It activates only when the rate calendar exists.

Further V2 phases can add optional room-group collapse, compact Market Intelligence drawer behaviour, and any additional density changes after this interaction layer is verified on real iOS / Android devices.
