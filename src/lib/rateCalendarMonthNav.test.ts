// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decorateRateMonthNavigation } from './rateCalendarMonthNav';

afterEach(() => { document.body.innerHTML = ''; });

function makeCalendar(): HTMLElement {
  const card = document.createElement('section');
  card.dataset.training = 'revenue-grid';
  card.innerHTML = `<div class="toolbar"><button type="button" class="bg-secondary">All</button><button type="button" class="bg-card" title="Show only Sep 26">Sep 26</button><button type="button" class="bg-card" title="Show only Oct 26">Oct 26</button></div><div class="relative overflow-auto overscroll-x-contain"></div>`;
  document.body.append(card);
  return card;
}

describe('Rate calendar month chooser', () => {
  it('marks the existing month strip as a discoverable, labelled group with the active view', () => {
    const card = makeCalendar();
    const nav = decorateRateMonthNavigation(card);
    expect(nav).not.toBeNull();
    expect(nav?.dataset.rateMonthNavigation).toBe('true');
    expect(nav?.getAttribute('role')).toBe('group');
    expect(nav?.getAttribute('aria-label')).toMatch(/choose a month/i);
    const [all, sep, oct] = Array.from(nav!.querySelectorAll('button'));
    expect(all.getAttribute('aria-label')).toBe('Show all calendar dates');
    expect(all.getAttribute('aria-pressed')).toBe('true');
    expect(sep.getAttribute('aria-pressed')).toBe('false');
    expect(oct.getAttribute('aria-pressed')).toBe('false');
  });

  it('tracks React-selected month classes without taking over button click handlers', () => {
    const card = makeCalendar();
    const nav = decorateRateMonthNavigation(card)!;
    const [all, sep, oct] = Array.from(nav.querySelectorAll('button'));
    const click = vi.fn();
    sep.addEventListener('click', click);
    all.className = 'bg-card';
    sep.className = 'bg-primary';
    decorateRateMonthNavigation(card);
    expect(all.getAttribute('aria-pressed')).toBe('false');
    expect(sep.getAttribute('aria-pressed')).toBe('true');
    expect(oct.getAttribute('aria-pressed')).toBe('false');
    sep.click();
    expect(click).toHaveBeenCalledTimes(1);
    expect(nav.querySelectorAll('button')).toHaveLength(3);
  });

  it('leaves other pages and an unmounted month strip alone', () => {
    const empty = document.createElement('section');
    empty.innerHTML = '<button>Other module</button>';
    expect(decorateRateMonthNavigation(empty)).toBeNull();
    expect(empty.hasAttribute('data-rate-month-navigation')).toBe(false);
  });
});
