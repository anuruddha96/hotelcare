// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { gozsduBucketFromHeading, gozsduDropBucket } from './gozsduRoomDropTarget';

function section(heading: string): HTMLElement {
  const root = document.createElement('section');
  root.innerHTML = `<div><span class="text-sm font-semibold">${heading}</span></div><div><div data-room-id="test-room"><span class="badge">Room</span></div></div>`;
  document.body.appendChild(root);
  return root;
}

describe('Gozsdu room overview drag destinations', () => {
  it('recognizes the three operational cleaning groups', () => {
    expect(gozsduBucketFromHeading('Checkout Rooms')).toBe('checkout');
    expect(gozsduBucketFromHeading('Second-day service rooms')).toBe('service');
    expect(gozsduBucketFromHeading('Other rooms')).toBe('other');
  });

  it('accepts a drop on a room chip or empty space inside the target group', () => {
    const target = section('Second-day service rooms');
    expect(gozsduDropBucket(target.querySelector('[data-room-id]'))).toBe('service');
    expect(gozsduDropBucket(target.querySelector('div:last-child'))).toBe('service');
    target.remove();
  });

  it('never turns no-show, unavailable, or public areas into a cleaning destination', () => {
    for (const name of ['No show', 'Not available rooms', 'Public Areas']) {
      const target = section(name);
      expect(gozsduDropBucket(target.querySelector('[data-room-id]'))).toBeNull();
      target.remove();
    }
    expect(gozsduDropBucket(null)).toBeNull();
  });
});
