import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReservationCalendar } from '../ReservationCalendar';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/budapestTime', () => ({ todayBudapest: () => '2026-11-13' }));

const rooms = [
  { id: 'r1', room_number: '101', room_type: 'Double', status: 'dirty' },
  { id: 'r2', room_number: '102', room_type: 'Double', status: 'clean' },
];
const day = (offset: number) => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

describe('ReservationCalendar attention view', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-13T10:00:00'));

  const reservations = [
    // Arriving today into a dirty room: needs action.
    { id: 'a', status: 'confirmed', room_id: 'r1', check_in_date: day(0), check_out_date: day(2), pms_guest_name: 'Anna Urgent', balance_due: 0, source: 'previo' },
    // Paid, clean room, later arrival: nothing to do.
    { id: 'b', status: 'confirmed', room_id: 'r2', check_in_date: day(3), check_out_date: day(5), pms_guest_name: 'Bob Fine', balance_due: 0, source: 'previo' },
  ];

  it('marks only the booking that needs action and counts it', () => {
    render(<MemoryRouter><ReservationCalendar rooms={rooms} reservations={reservations} basePath="/x" /></MemoryRouter>);
    const toggle = screen.getByRole('button', { name: /pms.planner.needsAction/ });
    expect(toggle.textContent).toContain('1');
    expect(screen.getByRole('button', { name: /Anna Urgent.*pms.attention.room_not_ready/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Bob Fine, pms\.cal\.status_\w+, \d+ pms\.cal\.nights?, [^,]+ to [^,]+$/ })).toBeTruthy();
  });

  it('fades bookings that need nothing when the focus toggle is on', () => {
    render(<MemoryRouter><ReservationCalendar rooms={rooms} reservations={reservations} basePath="/x" /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /pms.planner.needsAction/ }));
    expect(screen.getByRole('button', { name: /^Bob Fine/ }).className).toContain('opacity-25');
    expect(screen.getByRole('button', { name: /^Anna Urgent/ }).className).not.toContain('opacity-25');
  });

  it('shows nightly occupancy under the dates', () => {
    render(<MemoryRouter><ReservationCalendar rooms={rooms} reservations={reservations} basePath="/x" /></MemoryRouter>);
    expect(screen.getAllByLabelText('pms.planner.occupancy').length).toBe(1);
    expect(screen.getAllByText('50%').length).toBeGreaterThan(0);
  });
});

describe('ReservationCalendar floating lane and channel badges', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-13T10:00:00'));
  const lane = [
    { id: 'f1', reservation_number: 'RES-9', status: 'confirmed', room_id: null, check_in_date: '2026-11-18', check_out_date: '2026-11-20', pms_guest_name: 'Flora Floating', balance_due: 0, source: 'previo', pms_channel: 'Booking.com XML' },
    { id: 'f2', reservation_number: 'RES-10', status: 'confirmed', room_id: null, check_in_date: '2026-11-14', check_out_date: '2026-11-15', pms_guest_name: 'Uma Urgent', balance_due: 0, source: 'previo', pms_channel: 'AgodaXML' },
  ];
  const twoRooms = [
    { id: 'r1', room_number: '101', room_type: 'Double', status: 'clean' },
    { id: 'r2', room_number: '201', room_type: 'Triple', status: 'clean' },
  ];

  it('draws bookings without a room in their own lane, and warns only about the one arriving tomorrow', () => {
    render(<MemoryRouter><ReservationCalendar rooms={twoRooms} reservations={lane} basePath="/x" pmsName="Previo" /></MemoryRouter>);
    expect(screen.getByRole('group', { name: 'pms.cal.floating: 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Flora Floating, pms\.cal\.statusFloating, 2 pms\.cal\.nights, 2026-11-18 to 2026-11-20$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Uma Urgent.*pms.attention.unassigned/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /pms.planner.needsAction/ }).textContent).toContain('1');
    expect(screen.getByText(/1 pms.cal.floatingUrgent/)).toBeTruthy();
  });

  it('shows the sales channel as a brand badge on each booking', () => {
    const { container } = render(<MemoryRouter><ReservationCalendar rooms={twoRooms} reservations={lane} basePath="/x" /></MemoryRouter>);
    expect(container.querySelector('[data-channel="booking"]')?.textContent).toBe('B.');
    expect(container.querySelector('[data-channel="agoda"]')?.textContent).toBe('a');
  });
});
