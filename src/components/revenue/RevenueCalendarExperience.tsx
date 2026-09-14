import { useEffect } from "react";

/**
 * Progressive enhancement for the revenue rate calendar.
 *
 * RateStrategyGrid deliberately owns the pricing / selection / publishing
 * behaviour. This helper is only responsible for the viewport experience:
 * keeping the dense calendar readable, making native scrolling feel light,
 * and preventing touch users from getting trapped inside the nested scroller.
 *
 * Important: nothing in this file writes prices, inventory, restrictions or
 * PMS data. It is safe to mount for every organisation/property because it is
 * activated only for [data-training="revenue-grid"].
 */

const GRID_CARD = '[data-training="revenue-grid"]';
const GRID_SCROLL = ".relative.overflow-auto.overscroll-x-contain";
const MOBILE_QUERY = "(max-width: 767px)";
const COARSE_POINTER_QUERY = "(pointer: coarse)";
const QUICK_SWIPE_MS = 700;
const AXIS_LOCK_PX = 8;
const SWIPE_MIN_PX = 28;
const SCROLL_IDLE_MS = 120;

const calendarCss = String.raw`
  [data-rate-calendar-v2="true"] {
    width: 100%;
    min-width: 0;
  }

  /* Reclaim vertical space for the decision grid. The calendar header used to
     consume enough height that only a few room/rate rows were visible on a
     laptop even though the screen had plenty of useful width. */
  [data-rate-calendar-v2="true"] > div:first-child {
    gap: .3rem !important;
    padding-top: .55rem !important;
    padding-bottom: .35rem !important;
  }

  [data-rate-calendar-v2="true"] > div:first-child p.text-\[11px\] {
    margin-top: 0 !important;
    margin-bottom: 0 !important;
    line-height: 1.1 !important;
  }

  [data-rate-grid-scroll="true"] {
    overscroll-behavior-x: contain !important;
    overscroll-behavior-y: auto !important;
    scrollbar-gutter: stable;
    -webkit-overflow-scrolling: touch;
    scroll-behavior: auto;
    isolation: isolate;
  }

  /* Backdrop blur is expensive while a large table is moving in Chrome and
     makes the sticky header repaint on virtually every scroll frame. Opaque
     card backgrounds keep the hierarchy just as clear without that cost. */
  [data-rate-grid-scroll="true"] .backdrop-blur,
  [data-rate-grid-scroll="true"] .backdrop-blur-sm,
  [data-rate-grid-scroll="true"] .backdrop-blur-md {
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
  }

  /* During an active scroll, visual transitions are decoration rather than
     information. Suspending them removes avoidable paint/compositing work; the
     normal hover/change animations come back as soon as scrolling settles. */
  [data-rate-calendar-scrolling="true"] [data-rate-grid-scroll="true"] button,
  [data-rate-calendar-scrolling="true"] [data-rate-grid-scroll="true"] [class*="transition-"] {
    transition-duration: 0s !important;
  }

  [data-rate-calendar-scrolling="true"] [data-rate-grid-scroll="true"] [class*="animate-"] {
    animation-play-state: paused !important;
  }

  /* Keep the sticky decision header deterministic. Pickup/event text is not
     allowed to grow over the date row: detailed values remain available from
     the existing tooltips / demand detail UI. */
  [data-rate-grid-scroll="true"] > div > .sticky.top-0 {
    background: hsl(var(--card));
  }

  [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:first-child {
    height: 18px !important;
    min-height: 18px !important;
    overflow: hidden !important;
  }

  [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(2) {
    position: relative;
    z-index: 3;
    height: 38px !important;
    min-height: 38px !important;
    overflow: hidden !important;
    background: hsl(var(--card));
  }

  [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(3),
  [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(4),
  [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(5),
  [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(6),
  [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(7) {
    height: 24px !important;
    min-height: 24px !important;
    overflow: hidden !important;
  }

  [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(3) > div,
  [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(4) > div,
  [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(5) > div,
  [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(6) > div,
  [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(7) > div {
    min-height: 0 !important;
    overflow: hidden !important;
    line-height: 1 !important;
  }

  /* Events can have many simultaneous chips. Keep one compact lane in the
     always-sticky block so an event-heavy period can never push dates/prices
     off screen. Demand details are still available by opening the date. */
  [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(8) {
    max-height: 30px !important;
    overflow: hidden !important;
  }

  @media (min-width: 768px) {
    [data-rate-calendar-v2="true"] > div:first-child button.h-8,
    [data-rate-calendar-v2="true"] > div:first-child .h-8 {
      min-height: 28px;
    }

    [data-rate-calendar-v2="true"] details {
      line-height: 1.1;
    }

    /* The explanatory sentence is useful on small screens where controls are
       less obvious, but on desktop it duplicates the tooltips and costs a full
       row of pricing visibility. */
    [data-rate-calendar-v2="true"] > div:first-child > p.text-\[11px\] {
      display: none !important;
    }
  }

  /* Laptop widths are where the original toolbar wrapped into several rows and
     noticeably reduced rate visibility. Keep every action available but make
     the actions a single native horizontal strip. */
  @media (min-width: 768px) and (max-width: 1600px) {
    [data-rate-calendar-v2="true"] > div:first-child > div:first-child {
      align-items: stretch !important;
      flex-direction: column !important;
    }

    [data-rate-calendar-v2="true"] > div:first-child > div:first-child > div:last-child {
      width: 100%;
      flex-wrap: nowrap !important;
      overflow-x: auto;
      overscroll-behavior-x: contain;
      padding-bottom: 1px;
      scrollbar-width: thin;
    }

    [data-rate-calendar-v2="true"] > div:first-child > div:first-child > div:last-child > * {
      flex: 0 0 auto;
    }
  }

  @media (max-width: 767px) {
    [data-rate-calendar-v2="true"] > div:first-child {
      padding: .4rem .45rem .25rem !important;
      gap: .25rem !important;
    }

    [data-rate-calendar-v2="true"] > div:first-child > div:first-child {
      gap: .3rem !important;
    }

    [data-rate-calendar-v2="true"] > div:first-child button.h-8,
    [data-rate-calendar-v2="true"] > div:first-child .h-8 {
      height: 30px !important;
      min-height: 30px !important;
    }

    [data-rate-grid-scroll="true"] {
      touch-action: pan-x pan-y;
      scrollbar-gutter: auto;
    }

    [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:first-child {
      height: 16px !important;
      min-height: 16px !important;
    }

    [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(2) {
      height: 34px !important;
      min-height: 34px !important;
    }

    [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(3),
    [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(4),
    [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(5),
    [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(6),
    [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(7) {
      height: 22px !important;
      min-height: 22px !important;
    }
  }

  /* Phones, including wide rotated phones that exceed the usual CSS mobile
     breakpoint, use one horizontally scrollable toolbar row instead of several
     wrapped rows. */
  [data-rate-calendar-device="mobile-portrait"] > div:first-child > div:first-child,
  [data-rate-calendar-device="mobile-landscape"] > div:first-child > div:first-child {
    align-items: stretch !important;
    flex-direction: column !important;
  }

  [data-rate-calendar-device="mobile-portrait"] > div:first-child > div:first-child > div:last-child,
  [data-rate-calendar-device="mobile-landscape"] > div:first-child > div:first-child > div:last-child {
    width: 100%;
    flex-wrap: nowrap !important;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    padding-bottom: 1px;
    scrollbar-width: none;
  }

  [data-rate-calendar-device="mobile-portrait"] > div:first-child > div:first-child > div:last-child::-webkit-scrollbar,
  [data-rate-calendar-device="mobile-landscape"] > div:first-child > div:first-child > div:last-child::-webkit-scrollbar {
    display: none;
  }

  [data-rate-calendar-device="mobile-portrait"] > div:first-child > div:first-child > div:last-child > *,
  [data-rate-calendar-device="mobile-landscape"] > div:first-child > div:first-child > div:last-child > * {
    flex: 0 0 auto;
  }

  /* Rotated phones have very little vertical room. Keep the proven compact
     landscape behaviour: the date row remains prominent, the signal rows are
     tiny, and the dedicated event lane is removed because the Demand/date UI
     already exposes the underlying event detail. */
  [data-rate-calendar-device="mobile-landscape"] > div:first-child {
    padding-top: .2rem !important;
    padding-bottom: .2rem !important;
    gap: .2rem !important;
  }

  [data-rate-calendar-device="mobile-landscape"] > div:first-child details,
  [data-rate-calendar-device="mobile-landscape"] > div:first-child > p.text-\[11px\] {
    display: none !important;
  }

  [data-rate-calendar-device="mobile-landscape"] [data-rate-grid-scroll="true"] {
    touch-action: pan-x pan-y;
    scrollbar-gutter: auto;
  }

  [data-rate-calendar-device="mobile-landscape"][data-rate-calendar-rail="false"]
    [data-rate-grid-scroll="true"] .sticky.left-0 {
    width: 132px !important;
    min-width: 132px !important;
    max-width: 132px !important;
    padding-left: .4rem !important;
    padding-right: .35rem !important;
    font-size: 10px !important;
  }

  [data-rate-calendar-device="mobile-landscape"]
    [data-rate-grid-scroll="true"] > div > .sticky.top-0 {
    position: relative !important;
    top: auto !important;
  }

  [data-rate-calendar-device="mobile-landscape"]
    [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:first-child {
    height: 14px !important;
    min-height: 14px !important;
    font-size: 9px !important;
  }

  [data-rate-calendar-device="mobile-landscape"]
    [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(2) {
    position: sticky !important;
    top: 0 !important;
    z-index: 55 !important;
    height: 30px !important;
    min-height: 30px !important;
  }

  [data-rate-calendar-device="mobile-landscape"]
    [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(3),
  [data-rate-calendar-device="mobile-landscape"]
    [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(4),
  [data-rate-calendar-device="mobile-landscape"]
    [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(5),
  [data-rate-calendar-device="mobile-landscape"]
    [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(6),
  [data-rate-calendar-device="mobile-landscape"]
    [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(7) {
    height: 20px !important;
    min-height: 20px !important;
    font-size: 10px !important;
  }

  [data-rate-calendar-device="mobile-landscape"]
    [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(8) {
    display: none !important;
  }

  [data-rate-calendar-device="mobile-landscape"]
    [data-rate-grid-scroll="true"] button,
  [data-rate-calendar-device="mobile-landscape"]
    [data-rate-grid-scroll="true"] span {
    text-size-adjust: 100%;
    -webkit-text-size-adjust: 100%;
  }
`;

type GestureState = {
  startX: number;
  startY: number;
  lastY: number;
  axis: "x" | "y" | null;
  escapeToPage: boolean;
};

function findScrollPane(card: HTMLElement): HTMLElement | null {
  const exact = card.querySelector<HTMLElement>(GRID_SCROLL);
  if (exact) return exact;

  // Defensive fallback in case utility classes are refactored later.
  return Array.from(card.querySelectorAll<HTMLElement>("div")).find((el) => {
    const style = getComputedStyle(el);
    return (style.overflowX === "auto" || style.overflowX === "scroll") && el.scrollWidth > el.clientWidth;
  }) ?? null;
}

function isPhoneViewport(): boolean {
  if (window.matchMedia(MOBILE_QUERY).matches) return true;
  // Rotated phones can be 800–950px wide and miss the ordinary mobile CSS
  // breakpoint. Coarse pointer + short side identifies that form factor while
  // leaving narrow desktop browser windows in desktop mode.
  return window.matchMedia(COARSE_POINTER_QUERY).matches && Math.min(window.innerWidth, window.innerHeight) <= 600;
}

function deviceMode(): "desktop" | "mobile-portrait" | "mobile-landscape" {
  if (!isPhoneViewport()) return "desktop";
  return window.innerWidth > window.innerHeight ? "mobile-landscape" : "mobile-portrait";
}

function markFrozenColumnMode(card: HTMLElement, pane: HTMLElement) {
  const firstSticky = pane.querySelector<HTMLElement>(".sticky.left-0");
  if (!firstSticky) return;
  const inlineWidth = Number.parseFloat(firstSticky.style.width || "");
  card.dataset.rateCalendarRail = Number.isFinite(inlineWidth) && inlineWidth <= 64 ? "true" : "false";
}

function mutationNeedsEnhancement(records: MutationRecord[]): boolean {
  for (const record of records) {
    const target = record.target instanceof Element ? record.target : null;
    const targetCard = target?.closest<HTMLElement>(GRID_CARD) ?? null;

    // Once a calendar is enhanced, ordinary React cell / hover / toast churn
    // must never trigger another document-wide scan.
    if (targetCard && targetCard.dataset.rateCalendarV2 !== "true") return true;

    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches(GRID_CARD) || node.querySelector(GRID_CARD)) return true;
      const addedCard = node.closest<HTMLElement>(GRID_CARD);
      if (addedCard && addedCard.dataset.rateCalendarV2 !== "true") return true;
    }
  }
  return false;
}

export function RevenueCalendarExperience() {
  useEffect(() => {
    const gestureCleanups = new Map<HTMLElement, () => void>();
    const scrollCleanups = new Map<HTMLElement, () => void>();
    const railObservers = new Map<HTMLElement, ResizeObserver>();
    let raf: number | null = null;

    const attachGestureBridge = (pane: HTMLElement) => {
      if (gestureCleanups.has(pane)) return;

      let state: GestureState | null = null;
      let lastVerticalGestureAt = 0;

      const onTouchStart = (event: TouchEvent) => {
        if (!isPhoneViewport() || event.touches.length !== 1) return;
        const touch = event.touches[0];
        const landscape = deviceMode() === "mobile-landscape";
        state = {
          startX: touch.clientX,
          startY: touch.clientY,
          lastY: touch.clientY,
          axis: null,
          // In portrait, a second fast vertical swipe means "leave the grid".
          // Landscape is intentionally different because its grid is shallow.
          escapeToPage: !landscape && Date.now() - lastVerticalGestureAt < QUICK_SWIPE_MS,
        };
      };

      const onTouchMove = (event: TouchEvent) => {
        if (!state || event.touches.length !== 1 || event.defaultPrevented) return;
        const touch = event.touches[0];
        const dx = touch.clientX - state.startX;
        const dy = touch.clientY - state.startY;

        if (!state.axis) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_LOCK_PX) return;
          state.axis = Math.abs(dx) > Math.abs(dy) * 1.12 ? "x" : "y";
        }
        if (state.axis !== "y") return;

        const fingerDelta = state.lastY - touch.clientY;
        state.lastY = touch.clientY;

        const atTop = pane.scrollTop <= 1;
        const atBottom = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 1;
        const wantsPageDown = fingerDelta > 0;
        const wantsPageUp = fingerDelta < 0;
        const boundaryEscape = (atBottom && wantsPageDown) || (atTop && wantsPageUp);

        if (state.escapeToPage || boundaryEscape) {
          event.preventDefault();
          if (fingerDelta) window.scrollBy({ top: fingerDelta, left: 0, behavior: "auto" });
        }
      };

      const finishGesture = (event?: TouchEvent) => {
        if (!state) return;
        const touch = event?.changedTouches?.[0];
        const endX = touch?.clientX ?? state.startX;
        const endY = touch?.clientY ?? state.lastY;
        const dx = endX - state.startX;
        const dy = endY - state.startY;
        if ((state.axis === "y" || Math.abs(dy) > Math.abs(dx)) && Math.abs(dy) >= SWIPE_MIN_PX) {
          lastVerticalGestureAt = Date.now();
        }
        state = null;
      };

      pane.addEventListener("touchstart", onTouchStart, { passive: true });
      pane.addEventListener("touchmove", onTouchMove, { passive: false });
      pane.addEventListener("touchend", finishGesture, { passive: true });
      pane.addEventListener("touchcancel", finishGesture, { passive: true });

      gestureCleanups.set(pane, () => {
        pane.removeEventListener("touchstart", onTouchStart);
        pane.removeEventListener("touchmove", onTouchMove);
        pane.removeEventListener("touchend", finishGesture);
        pane.removeEventListener("touchcancel", finishGesture);
      });
    };

    const attachScrollState = (card: HTMLElement, pane: HTMLElement) => {
      if (scrollCleanups.has(pane)) return;
      let idleTimer: number | null = null;
      let frame: number | null = null;

      const settle = () => {
        idleTimer = null;
        card.dataset.rateCalendarScrolling = "false";
      };

      const onScroll = () => {
        if (frame === null) {
          frame = window.requestAnimationFrame(() => {
            frame = null;
            card.dataset.rateCalendarScrolling = "true";
          });
        }
        if (idleTimer !== null) window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(settle, SCROLL_IDLE_MS);
      };

      pane.addEventListener("scroll", onScroll, { passive: true });
      scrollCleanups.set(pane, () => {
        pane.removeEventListener("scroll", onScroll);
        if (frame !== null) window.cancelAnimationFrame(frame);
        if (idleTimer !== null) window.clearTimeout(idleTimer);
        delete card.dataset.rateCalendarScrolling;
      });
    };

    const attachRailObserver = (card: HTMLElement, pane: HTMLElement) => {
      const firstSticky = pane.querySelector<HTMLElement>(".sticky.left-0");
      if (!firstSticky || railObservers.has(firstSticky)) return;
      const observer = new ResizeObserver(() => markFrozenColumnMode(card, pane));
      observer.observe(firstSticky);
      railObservers.set(firstSticky, observer);
    };

    const enhance = () => {
      raf = null;
      const mode = deviceMode();
      document.querySelectorAll<HTMLElement>(GRID_CARD).forEach((card) => {
        const pane = findScrollPane(card);
        if (!pane) return;
        card.dataset.rateCalendarV2 = "true";
        card.dataset.rateCalendarDevice = mode;
        pane.dataset.rateGridScroll = "true";
        markFrozenColumnMode(card, pane);
        attachGestureBridge(pane);
        attachScrollState(card, pane);
        attachRailObserver(card, pane);
      });
    };

    const scheduleEnhance = () => {
      if (raf !== null) return;
      raf = window.requestAnimationFrame(enhance);
    };

    const observer = new MutationObserver((records) => {
      if (mutationNeedsEnhancement(records)) scheduleEnhance();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", scheduleEnhance, { passive: true });
    window.addEventListener("orientationchange", scheduleEnhance, { passive: true });
    window.visualViewport?.addEventListener("resize", scheduleEnhance, { passive: true });

    scheduleEnhance();
    return () => {
      observer.disconnect();
      if (raf !== null) window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", scheduleEnhance);
      window.removeEventListener("orientationchange", scheduleEnhance);
      window.visualViewport?.removeEventListener("resize", scheduleEnhance);
      gestureCleanups.forEach((cleanup) => cleanup());
      gestureCleanups.clear();
      scrollCleanups.forEach((cleanup) => cleanup());
      scrollCleanups.clear();
      railObservers.forEach((resizeObserver) => resizeObserver.disconnect());
      railObservers.clear();
    };
  }, []);

  return <style data-revenue-calendar-v2>{calendarCss}</style>;
}

export default RevenueCalendarExperience;
