/* @vitest-environment jsdom */

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setHousekeeperDragPayload } from './hkAssignmentDnd';

function touchPointerEvent(type: string, x: number, y: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerType: { configurable: true, value: 'touch' },
    pointerId: { configurable: true, value: 7 },
    clientX: { configurable: true, value: x },
    clientY: { configurable: true, value: y },
  });
  return event;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('mobile housekeeper -> room drag bridge', () => {
  it('turns a touch pointer drag into the same housekeeper drop payload used on desktop', () => {
    const onDrop = vi.fn((event: React.DragEvent<HTMLDivElement>) => {
      expect(event.dataTransfer.getData('housekeeperid')).toBe('staff-1');
      expect(event.dataTransfer.getData('housekeepername')).toBe('Christy');
      event.preventDefault();
    });

    const { getByTestId } = render(
      <div id="hotel-room-overview">
        <div
          data-testid="housekeeper"
          draggable
          onDragStart={(event) => setHousekeeperDragPayload(event, { staffId: 'staff-1', staffName: 'Christy' })}
        >
          <svg className="lucide lucide-grip-vertical" aria-hidden="true" />
          Christy
        </div>
        <div
          data-testid="room"
          draggable
          onDragOver={(event) => event.preventDefault()}
          onDrop={onDrop}
        >
          104
        </div>
      </div>,
    );

    const housekeeper = getByTestId('housekeeper');
    const room = getByTestId('room');
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => room),
    });

    housekeeper.dispatchEvent(touchPointerEvent('pointerdown', 20, 100));
    document.dispatchEvent(touchPointerEvent('pointermove', 120, 160));
    document.dispatchEvent(touchPointerEvent('pointerup', 120, 160));

    expect(onDrop).toHaveBeenCalledTimes(1);
  });
});
