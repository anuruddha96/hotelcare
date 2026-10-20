// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureIdleVisualBackdrop, clearIdleVisualBackdrop } from './idleVisualBackdrop';

beforeEach(() => {
  clearIdleVisualBackdrop();
});

afterEach(() => {
  clearIdleVisualBackdrop();
  document.getElementById('root')?.remove();
});

describe('inert blurred backdrop for the idle refresh screen', () => {
  it('preserves a recognizable but noninteractive workspace after React unmounts', () => {
    const root = document.createElement('div');
    root.id = 'root';
    root.innerHTML = [
      '<main id="hotel-board"><header>Gozsdu room board</header>',
      '<button id="room-action">Assign room</button>',
      '<input id="guest-name" value="Private guest name" />',
      '<img id="room-photo" src="https://example.com/room.jpg" />',
      '<iframe src="https://example.com/iframe"></iframe></main>',
    ].join('');
    document.body.append(root);

    captureIdleVisualBackdrop();
    root.remove(); // Represents the authenticated shell being unmounted.

    const frozen = document.getElementById('hotelcare-idle-frozen-workspace');
    expect(frozen).not.toBeNull();
    expect(frozen?.textContent).toContain('Gozsdu room board');
    expect(frozen?.getAttribute('aria-hidden')).toBe('true');
    expect(frozen?.hasAttribute('inert')).toBe(true);
    expect(frozen?.style.filter).toContain('blur(15px)');
    expect(frozen?.querySelector('#room-action')).toBeNull();
    expect(frozen?.querySelector('button')?.getAttribute('tabindex')).toBe('-1');
    expect(frozen?.querySelector('input')?.value).toBe('');
    expect(frozen?.querySelector('img')?.getAttribute('src')).toBeNull();
    expect(frozen?.querySelector('iframe')).toBeNull();
  });

  it('avoids duplicate frozen layers and removes them on reset', () => {
    const root = document.createElement('div');
    root.id = 'root';
    root.textContent = 'HotelCare';
    document.body.append(root);
    captureIdleVisualBackdrop();
    captureIdleVisualBackdrop();
    expect(document.querySelectorAll('#hotelcare-idle-frozen-workspace')).toHaveLength(1);
    clearIdleVisualBackdrop();
    expect(document.getElementById('hotelcare-idle-frozen-workspace')).toBeNull();
  });
});
