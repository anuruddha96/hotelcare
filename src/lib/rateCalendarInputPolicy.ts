/*
 * Read-only, scoped input enhancements for Rate & Pickup.
 * Keep the existing pricing/selection implementation as the single source of
 * truth. No server requests or rate writes take place here.
 */
const CARD_SELECTOR = '[data-training="revenue-grid"]';
const PANE_SELECTOR = '.relative.overflow-auto.overscroll-x-contain';
const CONTROL_SELECTOR = '[data-rate-calendar-input-toggle]';
const PREF_KEY = 'rate-calendar-vertical-wheel-mode';
const LONG_RANGE_DAYS = 90;

export type RateCalendarWheelMode = 'page' | 'rows';

export type WheelIntent = Pick<WheelEvent,
  'deltaX' | 'deltaY' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'defaultPrevented'>;

/** Horizontal trackpads, browser/calendar zoom and deliberate row scrolling stay native. */
export function shouldScrollRateCalendarPage(
  wheel: WheelIntent,
  mode: RateCalendarWheelMode,
  expanded: boolean,
): boolean {
  if (expanded || mode === 'rows' || wheel.defaultPrevented || wheel.ctrlKey || wheel.metaKey || wheel.shiftKey || wheel.altKey) return false;
  return Math.abs(wheel.deltaY) > Math.max(1, Math.abs(wheel.deltaX) * 1.15);
}

export function wheelPixels(delta: number, deltaMode: number, viewportHeight: number): number {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * viewportHeight;
  return delta;
}

function wheelPreference(): RateCalendarWheelMode {
  try { return localStorage.getItem(PREF_KEY) === 'rows' ? 'rows' : 'page'; }
  catch { return 'page'; }
}

/** Prefer the real dashboard scroller; window.scrollBy does nothing in nested layouts. */
function scrollPageOutsideGrid(pane: HTMLElement, delta: number): void {
  let ancestor = pane.parentElement;
  while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
    const overflow = getComputedStyle(ancestor).overflowY;
    if (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') {
      const limit = ancestor.scrollHeight - ancestor.clientHeight;
      if (limit > 1 && ((delta > 0 && ancestor.scrollTop < limit - 1) || (delta < 0 && ancestor.scrollTop > 1))) {
        ancestor.scrollBy({ top: delta, behavior: 'auto' });
        return;
      }
    }
    ancestor = ancestor.parentElement;
  }
  window.scrollBy({ top: delta, behavior: 'auto' });
}

interface EnhancedCalendar {
  pane: HTMLElement;
  button: HTMLButtonElement;
}

/** Call once before React mounts so the idle-pointer guard precedes the grid's window listener. */
export function installRateCalendarInputPolicy(): () => void {
  const calendars = new Map<HTMLElement, EnhancedCalendar>();
  let mode = wheelPreference();
  let frame: number | null = null;

  const updateButtons = () => {
    for (const { button } of calendars.values()) {
      const rows = mode === 'rows';
      button.textContent = rows ? 'Scroll: rows' : 'Scroll: page';
      button.setAttribute('aria-pressed', String(rows));
      button.title = rows
        ? 'Mouse wheel moves calendar rows. Click to scroll the page instead. Horizontal scrolling stays available.'
        : 'Mouse wheel scrolls past the calendar. Click to scroll calendar rows, or hold Alt while scrolling for one gesture.';
    }
  };

  const enhance = () => {
    frame = null;
    for (const [card, { button }] of calendars) {
      if (!card.isConnected) { button.remove(); calendars.delete(card); }
    }
    document.querySelectorAll<HTMLElement>(CARD_SELECTOR).forEach((card) => {
      const pane = card.querySelector<HTMLElement>(PANE_SELECTOR);
      if (!pane) return;
      const previous = calendars.get(card);
      if (previous && previous.pane !== pane) {
        previous.button.remove();
        calendars.delete(card);
      }
      // Only long horizons relax the old paint-every-cell rule. Short ranges
      // keep their original instant back-scroll behavior.
      card.dataset.rateCalendarLong = String(card.querySelectorAll('button[data-date]').length > LONG_RANGE_DAYS);
      const existing = calendars.get(card);
      if (existing && existing.button.isConnected) return;
      const headerActions = card.firstElementChild?.firstElementChild?.lastElementChild;
      if (!(headerActions instanceof HTMLElement)) return;
      existing?.button.remove();
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.rateCalendarInputToggle = 'true';
      button.className = 'rate-calendar-wheel-toggle';
      button.setAttribute('aria-label', 'Toggle vertical mouse wheel between scrolling page and calendar rows');
      button.addEventListener('click', () => {
        mode = mode === 'page' ? 'rows' : 'page';
        try { localStorage.setItem(PREF_KEY, mode); } catch { /* private browsing */ }
        updateButtons();
      });
      headerActions.appendChild(button);
      calendars.set(card, { pane, button });
      updateButtons();
    });
  };

  const scheduleEnhance = () => {
    if (frame === null) frame = requestAnimationFrame(enhance);
  };

  const mutationObserver = new MutationObserver((records) => {
    // Never rescan the entire calendar for ordinary price, hover or toast
    // changes. React range changes add date buttons; route changes add a card.
    const changed = records.some((record) => {
      const nodes = [...record.addedNodes, ...record.removedNodes];
      return nodes.some((node) => node instanceof Element && (
        node.matches(CARD_SELECTOR) || !!node.querySelector(CARD_SELECTOR) ||
        node.matches('button[data-date], ' + CONTROL_SELECTOR) ||
        !!node.querySelector('button[data-date], ' + CONTROL_SELECTOR)
      ));
    });
    if (changed) scheduleEnhance();
  });

  const onWheel = (event: WheelEvent) => {
    if (!(event.target instanceof Element)) return;
    const pane = event.target.closest<HTMLElement>(PANE_SELECTOR);
    const card = pane?.closest<HTMLElement>(CARD_SELECTOR);
    if (!pane || !card || !shouldScrollRateCalendarPage(event, mode, card.classList.contains('fixed'))) return;
    const dy = wheelPixels(event.deltaY, event.deltaMode, pane.clientHeight);
    if (dy === 0) return;
    event.preventDefault();
    scrollPageOutsideGrid(pane, dy);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (calendars.size === 0 || event.pointerType !== 'mouse' || event.buttons !== 0 || !(event.target instanceof Element)) return;
    const pane = event.target.closest<HTMLElement>(PANE_SELECTOR);
    if (!pane || !pane.closest(CARD_SELECTOR)) return;
    // React's normal cell hover/pointer handlers have already run at the app
    // root. Suppress only the later legacy window listener, which otherwise
    // starts a continuous requestAnimationFrame edge-scroll just by hovering.
    event.stopImmediatePropagation();
  };

  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || !(event.target instanceof Element)) return;
    const pane = event.target.closest<HTMLElement>(PANE_SELECTOR);
    if (!pane || !pane.closest(CARD_SELECTOR)) return;
    // The existing drag-to-select edge-scroller must stand down immediately
    // when a mouse drag finishes inside the pane, even without pointerleave.
    pane.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
  };

  document.addEventListener('wheel', onWheel, { capture: true, passive: false });
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerup', onPointerUp, { passive: true });
  mutationObserver.observe(document.body, { childList: true, subtree: true });
  scheduleEnhance();

  return () => {
    mutationObserver.disconnect();
    if (frame !== null) cancelAnimationFrame(frame);
    document.removeEventListener('wheel', onWheel, true);
    window.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    for (const [card, { button }] of calendars) {
      button.remove();
      delete card.dataset.rateCalendarLong;
    }
    calendars.clear();
  };
}
