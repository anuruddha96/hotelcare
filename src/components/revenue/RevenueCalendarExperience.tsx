import { useEffect } from "react";

/**
 * Progressive enhancement for the revenue rate calendar.
 *
 * RateStrategyGrid is deliberately feature rich: it owns horizontal dates,
 * vertical room rows, long-press range selection and sticky pricing signals.
 * On touch devices that can create a nested-scroll trap because the calendar
 * may consume repeated vertical swipes that the user intended for the page.
 *
 * This helper leaves all pricing / publishing logic untouched and only improves
 * viewport behaviour:
 *  - compact the non-essential calendar chrome so more room rows are visible;
 *  - keep horizontal date panning native and fluid;
 *  - let a vertical swipe escape to the page at a grid boundary immediately;
 *  - let a second quick vertical swipe escape to the page even mid-grid;
 *  - adapt the density for portrait phones and rotated / landscape phones.
 *
 * It is mounted globally by PointerEventsGuard, but activates only when the
 * Rate & pickup calendar is present.
 */

const GRID_CARD = '[data-training="revenue-grid"]';
const GRID_SCROLL = ".relative.overflow-auto.overscroll-x-contain";
const MOBILE_QUERY = "(max-width: 767px)";
const QUICK_SWIPE_MS = 700;
const AXIS_LOCK_PX = 8;
const SWIPE_MIN_PX = 28;

const calendarCss = String.raw`
  [data-rate-calendar-v2="true"] {
    width: 100%;
    min-width: 0;
  }

  [data-rate-calendar-v2="true"] > div:first-child {
    gap: .375rem !important;
    padding-top: .65rem !important;
    padding-bottom: .45rem !important;
  }

  [data-rate-calendar-v2="true"] > div:first-child p.text-\[11px\] {
    margin-top: 0 !important;
    margin-bottom: 0 !important;
    line-height: 1.15 !important;
  }

  [data-rate-grid-scroll="true"] {
    overscroll-behavior-x: contain !important;
    overscroll-behavior-y: auto !important;
    scrollbar-gutter: stable;
    -webkit-overflow-scrolling: touch;
    scroll-behavior: auto;
  }

  /* The information rows are valuable, but do not need the same height as a
     room price row. Reclaiming these pixels gives the decision grid more of
     the viewport without removing Pickup / Occupancy / Left / Min stay / Demand. */
  [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:first-child {
    height: 20px !important;
    min-height: 20px !important;
  }

  [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(2) {
    height: 40px !important;
    min-height: 40px !important;
  }

  [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(n+3) {
    min-height: 27px !important;
  }

  @media (min-width: 768px) {
    [data-rate-calendar-v2="true"] > div:first-child button.h-8,
    [data-rate-calendar-v2="true"] > div:first-child .h-8 {
      min-height: 28px;
    }

    [data-rate-calendar-v2="true"] details {
      line-height: 1.15;
    }
  }

  @media (max-width: 767px) {
    [data-rate-calendar-v2="true"] > div:first-child {
      padding: .5rem .5rem .35rem !important;
    }

    [data-rate-calendar-v2="true"] > div:first-child > div:first-child {
      gap: .35rem !important;
    }

    [data-rate-calendar-v2="true"] > div:first-child button.h-8,
    [data-rate-calendar-v2="true"] > div:first-child .h-8 {
      height: 30px !important;
      min-height: 30px !important;
    }

    [data-rate-grid-scroll="true"] {
      touch-action: pan-x pan-y;
    }

    [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:first-child {
      height: 18px !important;
      min-height: 18px !important;
    }

    [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(2) {
      height: 36px !important;
      min-height: 36px !important;
    }

    [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(n+3) {
      min-height: 25px !important;
    }
  }

  /* Rotated phones have very little vertical room. Keep the calendar controls
     compact and let the grid use the remaining viewport instead of spending it
     on explanatory chrome. */
  [data-rate-calendar-device="mobile-landscape"] > div:first-child {
    padding-top: .3rem !important;
    padding-bottom: .25rem !important;
  }

  [data-rate-calendar-device="mobile-landscape"] > div:first-child details,
  [data-rate-calendar-device="mobile-landscape"] > div:first-child > p.text-\[11px\] {
    display: none !important;
  }

  [data-rate-calendar-device="mobile-landscape"] [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:first-child {
    height: 16px !important;
    min-height: 16px !important;
  }

  [data-rate-calendar-device="mobile-landscape"] [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(2) {
    height: 32px !important;
    min-height: 32px !important;
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

function deviceMode(): "desktop" | "mobile-portrait" | "mobile-landscape" {
  const mobile = window.matchMedia(MOBILE_QUERY).matches;
  if (!mobile) return "desktop";
  return window.innerWidth > window.innerHeight ? "mobile-landscape" : "mobile-portrait";
}

export function RevenueCalendarExperience() {
  useEffect(() => {
    const cleanups = new Map<HTMLElement, () => void>();
    let raf: number | null = null;

    const attachGestureBridge = (pane: HTMLElement) => {
      if (cleanups.has(pane)) return;

      let state: GestureState | null = null;
      let lastVerticalGestureAt = 0;

      const onTouchStart = (event: TouchEvent) => {
        if (!window.matchMedia(MOBILE_QUERY).matches || event.touches.length !== 1) return;
        const touch = event.touches[0];
        state = {
          startX: touch.clientX,
          startY: touch.clientY,
          lastY: touch.clientY,
          axis: null,
          escapeToPage: Date.now() - lastVerticalGestureAt < QUICK_SWIPE_MS,
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

        // The first vertical gesture can still browse room rows inside the
        // calendar. At a boundary, or on a second quick vertical swipe, hand
        // the movement to the page so the user never gets trapped in the grid.
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

      cleanups.set(pane, () => {
        pane.removeEventListener("touchstart", onTouchStart);
        pane.removeEventListener("touchmove", onTouchMove);
        pane.removeEventListener("touchend", finishGesture);
        pane.removeEventListener("touchcancel", finishGesture);
      });
    };

    const enhance = () => {
      raf = null;
      const mode = deviceMode();
      document.querySelectorAll<HTMLElement>(GRID_CARD).forEach((card) => {
        card.dataset.rateCalendarV2 = "true";
        card.dataset.rateCalendarDevice = mode;
        const pane = findScrollPane(card);
        if (!pane) return;
        pane.dataset.rateGridScroll = "true";
        attachGestureBridge(pane);
      });
    };

    const scheduleEnhance = () => {
      if (raf !== null) return;
      raf = window.requestAnimationFrame(enhance);
    };

    const observer = new MutationObserver(scheduleEnhance);
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
      cleanups.forEach((cleanup) => cleanup());
      cleanups.clear();
    };
  }, []);

  return <style data-revenue-calendar-v2>{calendarCss}</style>;
}

export default RevenueCalendarExperience;
