/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { todayBudapest } from '@/lib/budapestTime';

// Keep the test focused on which room owns the manager update, not on
// housekeeping mutations, photo upload, or database access.
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [] }),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'housekeeper-1' }, profile: { role: 'housekeeping' } }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ language: 'en' }),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/gozsduWorkPresentation', () => ({
  gozsduWorkPresentation: (assignment: unknown) => assignment,
}));
vi.mock('./ExtraRoomPhotos', () => ({ ExtraRoomPhotos: () => null }));
vi.mock('./RoomCommunicationPanel', () => ({ RoomCommunicationPanel: () => null }));
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

afterEach(cleanup);

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
});
