/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { todayBudapest } from '@/lib/budapestTime';

// Keep the test focused on which room owns the manager update, not on
// housekeeping mutations, photo upload, or database access.
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    // Production returns a Map for Gozsdu building mapping and an array for notes.
    data: queryKey[0] === 'gozsdu-housekeeper-building-map' ? new Map() : [],
  }),
}));
const mockedAuth = vi.hoisted(() => ({ role: 'housekeeping' }));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'housekeeper-1' }, profile: { role: mockedAuth.role } }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ language: 'en' }),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/gozsduWorkPresentation', () => ({
  gozsduWorkPresentation: (assignment: unknown) => assignment,
}));
vi.mock('./ExtraRoomPhotos', () => ({ ExtraRoomPhotos: () => null }));
vi.mock('./RoomCommunicationPanel', () => ({ RoomCommunicationPanel: ({ roomNumber }: { roomNumber: string }) => <p>Bed setup for room {roomNumber}</p> }));
vi.mock('./AssignedRoomCardLegacy', () => ({
  AssignedRoomCard: ({ assignment, roomNotices }: {
    assignment: { rooms: { room_number: string } };
    roomNotices?: React.ReactNode;
  }) => (
    <article data-testid={`room-card-${assignment.rooms.room_number}`}>
      <h2>Room {assignment.rooms.room_number}</h2>
      {roomNotices}
    </article>
  ),
}));

import { AssignedRoomCard } from './AssignedRoomCard';

function assignment(roomNumber: string, withManagerUpdate: boolean) {
  return {
    id: `assignment-${roomNumber}`,
    room_id: `room-${roomNumber}`,
    assignment_type: 'daily_cleaning',
    status: 'assigned',
    priority: 1,
    estimated_duration: 25,
    notes: '',
    rooms: {
      room_number: roomNumber,
      hotel: 'Hotel Memories Budapest',
      status: 'dirty',
      room_name: null,
      floor_number: 1,
      guest_nights_stayed: 4,
      towel_change_required: true,
      linen_change_required: false,
      pms_metadata: withManagerUpdate
        ? { roomTypeChangeNotice: { date: todayBudapest(), to: 'daily', by: 'Melani', nightsStayed: 4 } }
        : {},
    },
  };
}

afterEach(() => {
  cleanup();
  mockedAuth.role = 'housekeeping';
});

describe('housekeeper manager update ownership', () => {
  it('places the update inside Room 130, not between Room 111 and Room 130', () => {
    render(
      <>
        <AssignedRoomCard assignment={assignment('111', false) as any} onStatusUpdate={() => {}} />
        <AssignedRoomCard assignment={assignment('130', true) as any} onStatusUpdate={() => {}} />
      </>,
    );

    const room111 = screen.getByTestId('room-card-111');
    const room130 = screen.getByTestId('room-card-130');
    expect(within(room111).queryByText(/Manager update/i)).toBeNull();
    expect(within(room130).getByText('Manager update · Room 130')).not.toBeNull();
    expect(room130.textContent).toContain('Changed by Melani');
    expect(screen.getByText('Manager update · Room 130').closest('article')).toBe(room130);
  });

  it('renders Memories room status, RTC and dirty action inside the same task card', () => {
    const room206 = {
      ...assignment('206', false),
      assigned_to: 'housekeeper-1',
      assignment_type: 'checkout_cleaning',
      ready_to_clean: true,
    };
    render(<AssignedRoomCard assignment={room206 as any} onStatusUpdate={() => {}} />);

    const card = screen.getByTestId('room-card-206');
    expect(within(card).getByRole('region', { name: 'Live room and checkout status' })).not.toBeNull();
    expect(within(card).getByText('Room: Dirty')).not.toBeNull();
    expect(within(card).getByText('✓ RTC · Ready to Clean')).not.toBeNull();
    expect(within(card).getByRole('button', { name: /Mark Room Dirty/i })).not.toBeNull();
    expect(screen.getByRole('region', { name: 'Live room and checkout status' }).closest('article')).toBe(card);
  });

  it('does not create a separate Memories status card for other hotels', () => {
    const otherHotelRoom = {
      ...assignment('201', false),
      rooms: { ...assignment('201', false).rooms, hotel: 'Hotel Ottofiori Budapest' },
    };
    render(<AssignedRoomCard assignment={otherHotelRoom as any} onStatusUpdate={() => {}} />);
    expect(screen.queryByRole('region', { name: 'Live room and checkout status' })).toBeNull();
  });

  it.each([
    'Hotel Ottofiori Budapest',
    'Hotel Mika Downtown',
    'Gozsdu Court Budapest',
    'slnt-group',
  ])('keeps extra-photo action within the shared room card at %s', (hotel) => {
    const assignedRoom = {
      ...assignment('207', false),
      status: 'in_progress',
      rooms: { ...assignment('207', false).rooms, hotel },
    };
    render(<AssignedRoomCard assignment={assignedRoom as any} onStatusUpdate={() => {}} />);

    const card = screen.getByTestId('room-card-207');
    expect(within(card).getByRole('button', { name: /Add more room photos/i })).not.toBeNull();
    expect(screen.getAllByRole('button', { name: /Add more room photos/i })).toHaveLength(1);
  });

  it('keeps the manager bed-setup editor inside the relevant room card for other hotels', () => {
    mockedAuth.role = 'manager';
    const assignedRoom = {
      ...assignment('209', false),
      rooms: { ...assignment('209', false).rooms, hotel: 'Hotel Ottofiori Budapest' },
    };
    render(<AssignedRoomCard assignment={assignedRoom as any} onStatusUpdate={() => {}} />);

    const card = screen.getByTestId('room-card-209');
    fireEvent.click(within(card).getByRole('button', { name: 'Edit bed setup' }));
    expect(within(card).getByText('Bed setup for room 209')).not.toBeNull();
  });
});
