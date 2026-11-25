// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OperationsNavigation } from './OperationsNavigation';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ profile: { role: 'top_management', organization_slug: 'rdhotels' } }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));
vi.mock('@/hooks/usePurchaseInvoiceAccess', () => ({
  usePurchaseInvoiceAccess: () => ({ hasAccess: false }),
}));
vi.mock('@/hooks/useAccessPolicy', () => ({
  useAccessPolicy: () => ({ accessRole: 'top_management', priceList: false, reviews: true }),
}));
vi.mock('@/lib/accessPolicy', () => ({ hrNavigationFor: () => [] }));
vi.mock('@/lib/roleAccess', () => ({
  canAccessChannelManager: () => false,
  canAccessLegacyModules: () => false,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('OperationsNavigation active module visibility', () => {
  it('reveals the active module after arrows narrow the strip, on tab changes and resize, without overriding manual scrolling', () => {
    let width = 340;
    const isScroller = (el: HTMLElement) => el.classList.contains('scrollbar-hide');
    const visibleWidth = (el: HTMLElement) =>
      width - (el.parentElement?.querySelector('button[aria-label="Scroll modules left"]') ? 80 : 0);
    const rect = (left: number, w: number): DOMRect => ({
      x: left, y: 0, left, right: left + w, top: 0, bottom: 40, width: w, height: 40,
      toJSON: () => ({}),
    });

    // JSDOM has no layout: model the scroll strip and its tab positions,
    // including the width lost when the overflow controls appear.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return isScroller(this) ? visibleWidth(this) : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return isScroller(this) ? 900 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (isScroller(this)) return rect(0, visibleWidth(this));
      const strip = this.closest<HTMLElement>('.scrollbar-hide');
      if (strip && this.tagName === 'BUTTON') {
        const index = Array.from(strip.querySelectorAll('button')).indexOf(this);
        return rect(index * 100 - strip.scrollLeft, 100);
      }
      return rect(0, 0);
    });

    const view = (current: string) => (
      <MemoryRouter initialEntries={['/rdhotels/revenue/ottofiori']}>
        <OperationsNavigation current={current} />
      </MemoryRouter>
    );
    const { rerender } = render(view('revenue'));
    const nav = screen.getByRole('navigation');
    const strip = nav.querySelector<HTMLElement>('.scrollbar-hide')!;
    const revenue = screen.getByRole('button', { name: 'nav.revenue' });
    expect(revenue.getAttribute('aria-current')).toBe('page');
    expect(strip.scrollLeft).toBe(540);
    expect(revenue.getBoundingClientRect().right).toBeLessThanOrEqual(strip.getBoundingClientRect().right);

    strip.scrollLeft = 0;
    fireEvent.scroll(strip);
    expect(strip.scrollLeft).toBe(0);

    rerender(view('housekeeping'));
    const housekeeping = screen.getByRole('button', { name: 'nav.housekeeping' });
    expect(housekeeping.getAttribute('aria-current')).toBe('page');
    expect(strip.scrollLeft).toBe(240);

    width = 260;
    fireEvent(window, new Event('resize'));
    expect(strip.scrollLeft).toBe(320);
    expect(housekeeping.getBoundingClientRect().right).toBeLessThanOrEqual(strip.getBoundingClientRect().right);
  });
});
