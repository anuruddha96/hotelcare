// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installRateCalendarInputPolicy,
  shouldScrollRateCalendarPage,
  wheelPixels,
} from './rateCalendarInputPolicy';

const vertical = {
  deltaX: 0, deltaY: 80, ctrlKey: false, metaKey: false,
  shiftKey: false, altKey: false, defaultPrevented: false,
};

describe('Rate & Pickup wheel policy', () => {
  it('lets ordinary vertical wheels escape the embedded calendar by default', () => {
    expect(shouldScrollRateCalendarPage(vertical, 'page', false)).toBe(true);
    expect(shouldScrollRateCalendarPage({ ...vertical, deltaX: 90 }, 'page', false)).toBe(false);
    expect(shouldScrollRateCalendarPage({ ...vertical, deltaY: 0 }, 'page', false)).toBe(false);
  });

  it('retains native zoom, horizontal, explicit row and full-screen interactions', () => {
    expect(shouldScrollRateCalendarPage(vertical, 'rows', false)).toBe(false);
    expect(shouldScrollRateCalendarPage(vertical, 'page', true)).toBe(false);
    for (const key of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey', 'defaultPrevented'] as const) {
      expect(shouldScrollRateCalendarPage({ ...vertical, [key]: true }, 'page', false)).toBe(false);
    }
  });

  it('normalizes mouse wheel line/page units, but leaves pixel deltas alone', () => {
    expect(wheelPixels(3, 0, 600)).toBe(3);
    expect(wheelPixels(3, 1, 600)).toBe(48);
    expect(wheelPixels(-1, 2, 600)).toBe(-600);
  });
});

describe('Rate & Pickup document integration', () => {
  let uninstall: (() => void) | undefined;
  let queued: Map<number, FrameRequestCallback>;
  let nextFrame: number;

  const flushFrames = () => {
    const frames = [...queued.values()];
    queued.clear();
    frames.forEach(callback => callback(0));
  };

  beforeEach(() => {
    localStorage.removeItem('rate-calendar-vertical-wheel-mode');
    document.body.innerHTML = '';
    queued = new Map();
    nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextFrame;
      queued.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => queued.delete(id));
    vi.stubGlobal('scrollBy', vi.fn());
  });

  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    localStorage.removeItem('rate-calendar-vertical-wheel-mode');
  });

  it('adds a page/rows option and sends wheel movement to the actual page scroller', () => {
    document.body.innerHTML = `
      <main id="dashboard" style="overflow-y: auto">
        <section data-training="revenue-grid">
          <header><div><h2>Rate & pickup</h2><div id="toolbar"></div></div></header>
          <div><div id="pane" class="relative overflow-auto overscroll-x-contain">
            <div><div class="sticky top-0"><button data-date="2026-09-18">18</button></div></div>
          </div>
        </section>
      </main>`;
    const dashboard = document.getElementById('dashboard')!;
    const pane = document.getElementById('pane')!;
    Object.defineProperties(dashboard, {
      scrollHeight: { configurable: true, value: 1800 },
      clientHeight: { configurable: true, value: 500 },
    });
    Object.defineProperty(pane, 'clientHeight', { configurable: true, value: 300 });
    const dashboardScroll = vi.fn();
    dashboard.scrollBy = dashboardScroll;

    uninstall = installRateCalendarInputPolicy();
    flushFrames();
    const toggle = document.querySelector<HTMLButtonElement>('[data-rate-calendar-input-toggle]')!;
    expect(toggle).not.toBeNull();
    expect(toggle.textContent).toBe('Scroll: page');

    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 80 });
    pane.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(dashboardScroll).toHaveBeenCalledWith({ top: 80, behavior: 'auto' });

    toggle.click();
    expect(toggle.textContent).toBe('Scroll: rows');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    const rowWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 70 });
    pane.dispatchEvent(rowWheel);
    expect(rowWheel.defaultPrevented).toBe(false);
    expect(dashboardScroll).toHaveBeenCalledTimes(1);

    const zoomWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 80, ctrlKey: true });
    pane.dispatchEvent(zoomWheel);
    expect(zoomWheel.defaultPrevented).toBe(false);
  });
});
