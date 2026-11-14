import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReservationCalendar } from '../ReservationCalendar';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/budapestTime', () => ({ todayBudapest: () => '2026-11-13' }));
const updateReservation = vi.fn().mockResolvedValue({ ok: true });
vi.mock('@/lib/pmsLifecycle', () => ({
  updateReservation: (...args: unknown[]) => updateReservation(...args),
  LifecycleError: class extends Error { translationKey = null; },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// jsdom has no PointerEvent: without this, clientX/button are dropped.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill;
}

const rooms = [
  { id: 'r1', room_number: '101', room_type: 'Double', status: 'clean' },
  { id: 'r2', room_number: '102', room_type: 'Double', status: 'clean' },
];

describe('ReservationCalendar drag & resize', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-13T10:00:00'));
  beforeEach(() => updateReservation.mockClear());

  const reservations = [
    { id: 'a', reservation_number: 'RES-1', status: 'confirmed', room_id: 'r1', check_in_date: '2026-11-14', check_out_date: '2026-11-16', pms_guest_name: 'Anna Move', balance_due: 0 },
  ];

  const drag = (el: HTMLElement, fromX: number, toX: number) => {
    // jsdom has no layout: give the bar a box so edge detection works.
    el.getBoundingClientRect = () => ({ left: 0, right: 172, width: 172, top: 0, bottom: 32, height: 32, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: fromX, clientY: 10 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: toX, clientY: 10 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: toX, clientY: 10 });
  };

  it('asks for confirmation before moving dates, and saves only after Apply', async () => {
    const onChanged = vi.fn();
    render(<MemoryRouter><ReservationCalendar rooms={rooms} reservations={reservations} basePath="/x" editable onChanged={onChanged} /></MemoryRouter>);
    drag(screen.getByRole('button', { name: /^Anna Move/ }), 80, 80 + 88); // one day later

    expect(await screen.findByText('pms.cal.confirmTitle')).toBeTruthy();
    expect(screen.getByText(/2026-11-15 → 2026-11-17/)).toBeTruthy();
    expect(updateReservation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'pms.cal.apply' }));
    await waitFor(() => expect(updateReservation).toHaveBeenCalledWith({
      reservationId: 'a', checkIn: '2026-11-15', checkOut: '2026-11-17', roomId: null,
    }));
    expect(onChanged).toHaveBeenCalled();
  });

  it('dragging the right edge changes only the check-out date', async () => {
    render(<MemoryRouter><ReservationCalendar rooms={rooms} reservations={reservations} basePath="/x" editable /></MemoryRouter>);
    drag(screen.getByRole('button', { name: /^Anna Move/ }), 170, 170 + 88);
    expect(await screen.findByText(/2026-11-14 → 2026-11-17/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'pms.cal.apply' }));
    await waitFor(() => expect(updateReservation).toHaveBeenCalledWith({
      reservationId: 'a', checkIn: null, checkOut: '2026-11-17', roomId: null,
    }));
  });

  it('cancel discards the change and nothing is saved', async () => {
    render(<MemoryRouter><ReservationCalendar rooms={rooms} reservations={reservations} basePath="/x" editable /></MemoryRouter>);
    drag(screen.getByRole('button', { name: /^Anna Move/ }), 80, 80 + 176);
    fireEvent.click(await screen.findByRole('button', { name: 'common.cancel' }));
    await waitFor(() => expect(screen.queryByText('pms.cal.confirmTitle')).toBeNull());
    expect(updateReservation).not.toHaveBeenCalled();
  });

  it('is read-only when not editable (Previo hotels)', () => {
    render(<MemoryRouter><ReservationCalendar rooms={rooms} reservations={reservations} basePath="/x" /></MemoryRouter>);
    drag(screen.getByRole('button', { name: /^Anna Move/ }), 80, 80 + 88);
    expect(screen.queryByText('pms.cal.confirmTitle')).toBeNull();
  });
});
