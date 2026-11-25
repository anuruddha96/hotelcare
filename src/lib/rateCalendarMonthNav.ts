/** Small DOM-only enhancement around RateStrategyGrid's existing month buttons.
 * React retains ownership of month selection and the pricing data. We never
 * replace a button, dispatch a synthetic click or change a rate. */
const CARD = '[data-training="revenue-grid"]';
const MONTH = 'button[title^="Show only "]';

type MonthNav = { element: HTMLElement; observer: MutationObserver; onClick: (event: MouseEvent) => void };

/** Exposed separately to test the accessibility contract without mounting React. */
export function decorateRateMonthNavigation(card: HTMLElement): HTMLElement | null {
  const monthButton = card.querySelector<HTMLButtonElement>(MONTH);
  const nav = monthButton?.parentElement;
  if (!nav) return null;

  nav.dataset.rateMonthNavigation = 'true';
  nav.setAttribute('role', 'group');
  nav.setAttribute('aria-label', 'Month view: choose a month or display all dates');
  const buttons = Array.from(nav.children).filter((child): child is HTMLButtonElement => child instanceof HTMLButtonElement);
  buttons.forEach((button, index) => {
    const selected = index === 0
      ? button.classList.contains('bg-secondary')
      : button.classList.contains('bg-primary');
    button.setAttribute('aria-pressed', String(selected));
    if (index === 0) button.setAttribute('aria-label', 'Show all calendar dates');
  });
  return nav;
}

export function installRateCalendarMonthNav(): () => void {
  const navigations = new Map<HTMLElement, MonthNav>();
  let frame: number | null = null;

  const scan = () => {
    frame = null;
    for (const [card, record] of navigations) {
      if (!card.isConnected || !record.element.isConnected) {
        record.observer.disconnect();
        record.element.removeEventListener('click', record.onClick);
        navigations.delete(card);
      }
    }
    document.querySelectorAll<HTMLElement>(CARD).forEach((card) => {
      const nav = decorateRateMonthNavigation(card);
      if (!nav || navigations.has(card)) return;
      const observer = new MutationObserver(() => {
        // Month changes update only button classes. Watch just this tiny strip,
        // not the thousands of rate cells (and never observe our aria writes).
        decorateRateMonthNavigation(card);
      });
      observer.observe(nav, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
      const onClick = (event: MouseEvent) => {
        const target = event.target instanceof Element ? event.target.closest('button') : null;
        if (!(target instanceof HTMLButtonElement) || target.parentElement !== nav) return;
        // The mobile month strip scrolls horizontally. Keep the tapped option
        // in view without scrolling the entire page or changing the selection.
        if (window.matchMedia('(max-width: 767px)').matches) {
          const navBounds = nav.getBoundingClientRect();
          const targetBounds = target.getBoundingClientRect();
          const left = nav.scrollLeft + targetBounds.left - navBounds.left - 72;
          nav.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
        }
      };
      nav.addEventListener('click', onClick);
      navigations.set(card, { element: nav, observer, onClick });
    });
  };

  const schedule = () => {
    if (frame === null) frame = window.requestAnimationFrame(scan);
  };
  const docObserver = new MutationObserver((records) => {
    const relevant = records.some((record) => {
      const nodes = [...record.addedNodes, ...record.removedNodes];
      return nodes.some((node) => node instanceof Element && (
        node.matches(CARD) || !!node.querySelector(CARD) ||
        node.matches(MONTH) || !!node.querySelector(MONTH)
      ));
    });
    if (relevant) schedule();
  });
  docObserver.observe(document.body, { subtree: true, childList: true });
  schedule();

  return () => {
    docObserver.disconnect();
    if (frame !== null) window.cancelAnimationFrame(frame);
    for (const record of navigations.values()) {
      record.observer.disconnect();
      record.element.removeEventListener('click', record.onClick);
    }
    navigations.clear();
  };
}
