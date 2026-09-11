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
const COARSE_POINTER_QUERY = "(pointer: coarse)";
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

  [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(3),
  [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(4),
  [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(5),
  [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(6),
  [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(7) {
    height: 27px !important;
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

  /* On ordinary laptop widths the toolbar is often taller than the pricing
     grid header because its many controls wrap to multiple lines. Keep it as
     one stable horizontal control strip instead. */
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
      padding-bottom: 2px;
      scrollbar-width: thin;
    }

    [data-rate-calendar-v2="true"] > div:first-child > div:first-child > div:last-child > * {
      flex: 0 0 auto;
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

    [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(3),
    [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(4),
    [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(5),
    [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(6),
    [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(7) {
      height: 25px !important;
      min-height: 25px !important;
    }
  }

  /* Phones, including wide rotated phones that exceed the usual 767px CSS
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
    padding-bottom: 2px;
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

  /* Rotated phones have extremely little vertical room. In this mode the date
     row remains sticky, while the larger signal block scrolls away with the
     room rows. This avoids a 150-200px sticky header permanently hiding the
     actual prices. */
  [data-rate-calendar-device="mobile-landscape"] > div:first-child {
    padding-top: .2rem !important;
    padding-bottom: .2rem !important;
    gap: .25rem !important;
  }

  [data-rate-calendar-device="mobile-landscape"] > div:first-child details,
  [data-rate-calendar-device="mobile-landscape"] > div:first-child > p.text-\[11px\] {
    display: none !important;
  }

  [data-rate-calendar-device="mobile-landscape"] [data-rate-grid-scroll="true"] {
    touch-action: pan-x pan-y;
    scrollbar-gutter: auto;
  }

  /* A phone rotated sideways is wider than the app's normal mobile breakpoint,
     so RateStrategyGrid otherwise keeps the 200px desktop room-name column.
     Cap it here without changing the user's saved desktop width. */
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

  /* The full multi-lane event band is useful on a desktop, but on a 390-430px
     tall phone it can consume the space of two or three room rows. Event
     details remain available from the Demand row, so hide only the dedicated
     band in landscape. */
  [data-rate-calendar-device="mobile-landscape"]
    [data-rate-grid-scroll="true"] > div > .sticky.top-0 > div:nth-child(8) {
    display: none !important;
  }

  /* Keep numbers readable after the browser applies iPhone landscape scaling. */
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
  // A rotated phone can be 800–950px wide and miss the normal mobile CSS
  // breakpoint. A coarse pointer plus a short side identifies that form factor
  // without turning normal desktop windows into the mobile layout.
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

export function RevenueCalendarExperience() {
  useEffect(() => {
    const cleanups = new Map<HTMLElement, () => void>();
    let raf: number | null = null;

    const attachGestureBridge = (pane: HTMLElement) => {
      if (cleanups.has(pane)) return;

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
          // In portrait, a second fast swipe means "leave the calendar". In
          // landscape the grid is shallow and users need repeated vertical
          // swipes to reach room prices, so only a real top/bottom boundary
          // hands the gesture back to the page.
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

        // The calendar owns vertical movement while it still has room rows to
        // reveal. At a real boundary (or a second quick portrait swipe), hand
        // the movement to the page so the user never gets trapped.
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
        markFrozenColumnMode(card, pane);
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
