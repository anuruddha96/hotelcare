const GRID_CARD = '[data-training="revenue-grid"]';
const GRID_SCROLL = '.relative.overflow-auto.overscroll-x-contain';
const MOBILE_QUERY = '(max-width: 767px)';
const COARSE_POINTER_QUERY = '(pointer: coarse)';
const STYLE_ID = 'rate-calendar-mobile-events-style';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type MobileEventImpact = 'very-high' | 'high' | 'medium' | 'low' | 'none';

export interface MobileEventSummary {
  date: string;
  dateLabel: string;
  count: number;
  countLabel: string;
  impact: MobileEventImpact;
  impactLabel: string;
}

const mobileEventsCss = String.raw`
  [data-mobile-event-summary="true"] {
    position: relative !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    padding: 2px 18px 2px 2px !important;
    overflow: hidden !important;
    text-align: center !important;
  }

  [data-mobile-event-summary="true"] > * {
    display: none !important;
  }

  [data-mobile-event-summary="true"]::before {
    content: attr(data-event-date-label) "\A" attr(data-event-count-label) "\A" attr(data-event-impact-label);
    white-space: pre;
    font-size: 8px;
    line-height: 10px;
    font-weight: 650;
    letter-spacing: -0.01em;
  }

  [data-mobile-event-summary="true"][data-event-has-eye="true"]::after {
    content: "👁";
    position: absolute;
    right: 2px;
    top: 50%;
    transform: translateY(-50%);
    display: grid;
    place-items: center;
    width: 14px;
    height: 14px;
    border-radius: 999px;
    border: 1px solid hsl(var(--border));
    background: hsl(var(--background));
    font-size: 9px;
    line-height: 1;
  }

  [data-mobile-event-summary="true"][data-event-impact="very-high"] {
    box-shadow: inset 2px 0 0 hsl(var(--destructive));
    color: hsl(var(--destructive));
  }

  [data-mobile-event-summary="true"][data-event-impact="high"] {
    box-shadow: inset 2px 0 0 rgb(239 68 68 / .75);
  }

  [data-mobile-event-summary="true"][data-event-impact="medium"] {
    box-shadow: inset 2px 0 0 rgb(245 158 11 / .8);
  }

  [data-mobile-event-summary="true"][data-event-impact="low"] {
    box-shadow: inset 2px 0 0 hsl(var(--border));
  }

  [data-rate-calendar-mobile-events="true"] > .sticky.left-0 > span {
    display: none !important;
  }

  [data-rate-calendar-mobile-events="true"] > .sticky.left-0 > button {
    font-size: 10px !important;
  }
`;

function isPhoneViewport(): boolean {
  if (window.matchMedia?.(MOBILE_QUERY).matches) return true;
  return !!window.matchMedia?.(COARSE_POINTER_QUERY).matches
    && Math.min(window.innerWidth, window.innerHeight) <= 600;
}

function formatDateLabel(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  return `${day} ${MONTHS[monthIndex] ?? match[2]}`;
}

function impactFromEventLines(lines: string[]): { impact: MobileEventImpact; label: string } {
  let best = 0;
  let impact: MobileEventImpact = 'none';
  let label = '';

  for (const line of lines) {
    const match = /—\s*(.+?)\s+impact\s*$/i.exec(line);
    if (!match) continue;
    const normalized = match[1].trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
    const candidate = normalized === 'very high'
      ? { score: 4, impact: 'very-high' as const, label: 'Very High' }
      : normalized === 'high'
        ? { score: 3, impact: 'high' as const, label: 'High' }
        : normalized === 'medium'
          ? { score: 2, impact: 'medium' as const, label: 'Medium' }
          : normalized === 'low'
            ? { score: 1, impact: 'low' as const, label: 'Low' }
            : null;

    if (candidate && candidate.score > best) {
      best = candidate.score;
      impact = candidate.impact;
      label = candidate.label;
    }
  }

  return { impact, label };
}

export function parseMobileEventSummary(title: string): MobileEventSummary {
  const lines = title.split('\n').map((line) => line.trim()).filter(Boolean);
  const date = /^\d{4}-\d{2}-\d{2}/.exec(lines[0] ?? '')?.[0] ?? '';
  const eventLines = lines.filter((line) => /^\d+\.\s+/.test(line));
  const count = eventLines.length;
  const { impact, label: impactLabel } = impactFromEventLines(eventLines);

  return {
    date,
    dateLabel: date ? formatDateLabel(date) : '',
    count,
    countLabel: count === 0 ? 'No events' : count >= 4 ? '4+ events' : `${count} event${count === 1 ? '' : 's'}`,
    impact,
    impactLabel,
  };
}

function findEventRow(card: HTMLElement): HTMLElement | null {
  const pane = card.querySelector<HTMLElement>('[data-rate-grid-scroll="true"]')
    ?? card.querySelector<HTMLElement>(GRID_SCROLL);
  if (!pane) return null;

  const grid = pane.firstElementChild as HTMLElement | null;
  if (!grid) return null;

  const stickyHeader = Array.from(grid.children).find((child) =>
    child instanceof HTMLElement
    && child.classList.contains('sticky')
    && child.classList.contains('top-0')) as HTMLElement | undefined;
  if (!stickyHeader) return null;

  return Array.from(stickyHeader.children).find((child) => {
    if (!(child instanceof HTMLElement)) return false;
    const left = child.firstElementChild as HTMLElement | null;
    return !!left?.querySelector('button[title="Hide event names"], button[title="Show event names"]');
  }) as HTMLElement | null;
}

function clearMobileSummary(cell: HTMLElement) {
  delete cell.dataset.mobileEventSummary;
  delete cell.dataset.eventDateLabel;
  delete cell.dataset.eventCount;
  delete cell.dataset.eventCountLabel;
  delete cell.dataset.eventImpact;
  delete cell.dataset.eventImpactLabel;
  delete cell.dataset.eventHasEye;
  if (cell.dataset.eventOriginalAria === '__none__') cell.removeAttribute('aria-label');
  else if (cell.dataset.eventOriginalAria) cell.setAttribute('aria-label', cell.dataset.eventOriginalAria);
  delete cell.dataset.eventOriginalAria;
}

function enhanceCard(card: HTMLElement, mobile: boolean) {
  const row = findEventRow(card);
  if (!row) return;

  // Use the same compact event summary on desktop and mobile. Narrow date
  // columns cannot display four event titles legibly; the full ranked list is
  // already available from the existing clickable detail dialog / tooltip.
  // This keeps the lane useful at every zoom level without duplicating the
  // date that is already visible directly above it.
  row.dataset.rateCalendarMobileEvents = 'true';
  if (mobile) {
    // The legacy landscape helper hides the Events lane. An inline !important
    // keeps this compact summary visible without touching other rows.
    row.style.setProperty('display', 'flex', 'important');
    row.style.setProperty('max-height', '50px', 'important');
  } else {
    row.style.removeProperty('display');
    row.style.removeProperty('max-height');
  }

  Array.from(row.children).slice(1).forEach((cell) => {
    if (!(cell instanceof HTMLButtonElement)) return;
    const summary = parseMobileEventSummary(cell.getAttribute('title') ?? '');

    if (!cell.dataset.eventOriginalAria) {
      cell.dataset.eventOriginalAria = cell.getAttribute('aria-label') ?? '__none__';
    }
    cell.dataset.mobileEventSummary = 'true';
    cell.dataset.eventDateLabel = summary.dateLabel;
    cell.dataset.eventCount = String(summary.count);
    cell.dataset.eventCountLabel = summary.countLabel;
    cell.dataset.eventImpact = summary.impact;
    cell.dataset.eventImpactLabel = summary.impactLabel;
    cell.dataset.eventHasEye = summary.count > 0 ? 'true' : 'false';

    cell.setAttribute(
      'aria-label',
      summary.count > 0
        ? `${summary.date || 'Date'}: ${summary.countLabel}, ${summary.impactLabel || 'event'} impact. Tap to view ranked event details.`
        : `${summary.date || 'Date'}: no recorded events.`,
    );
  });
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = mobileEventsCss;
  document.head.appendChild(style);
}

/**
 * Compact presentation enhancer for the Rate & Pickup calendar Events row.
 * It never changes rates, demand scoring, event ranking, or any other calendar
 * row. Existing event buttons remain the click targets, so tapping the summary
 * or eye opens the same ranked event detail dialog owned by RateStrategyGrid.
 */
export function installRateCalendarMobileEvents() {
  ensureStyle();

  let frame: number | null = null;
  const enhance = () => {
    frame = null;
    const mobile = isPhoneViewport();
    document.querySelectorAll<HTMLElement>(GRID_CARD).forEach((card) => enhanceCard(card, mobile));
  };
  const schedule = () => {
    if (frame !== null) return;
    frame = window.requestAnimationFrame(enhance);
  };

  const observer = new MutationObserver((records) => {
    if (records.some((record) => {
      if (record.type === 'attributes') return record.attributeName === 'title';
      return record.addedNodes.length > 0 || record.removedNodes.length > 0;
    })) schedule();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['title'],
  });
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', schedule, { passive: true });
  window.visualViewport?.addEventListener('resize', schedule, { passive: true });

  schedule();

  return () => {
    observer.disconnect();
    if (frame !== null) window.cancelAnimationFrame(frame);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
    document.querySelectorAll<HTMLElement>(GRID_CARD).forEach((card) => enhanceCard(card, false));
  };
}
