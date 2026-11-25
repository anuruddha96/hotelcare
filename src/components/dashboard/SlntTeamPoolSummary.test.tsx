import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc,
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: vi.fn(),
  },
}));
vi.mock('@/lib/budapestTime', () => ({ todayBudapest: () => '2026-10-25' }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ language: 'en' }) }));
vi.mock('./SlntSimpleAvailabilityCalendar', () => ({
  SlntSimpleAvailabilityCalendar: () => <div data-testid="availability-placeholder" />,
}));
vi.mock('./SlntTeamBRoomPreview', () => ({
  SlntTeamBRoomPreview: () => <div data-testid="room-preview" />,
}));

import { SlntTeamPoolSummary } from './SlntTeamPoolSummary';

describe('SLNT Team B manager tiles', () => {
  it('renders nine distinct interactive status tiles and preserves room drill-down', async () => {
    rpc.mockResolvedValue({
      data: [{
        room_id: 'room-1', room_number: '101', room_name: '101',
        assignment_id: null, assigned_to: null, assignment_status: null,
        supervisor_approved: false, is_checkout_room: false, is_optional: false, pms_metadata: {},
      }],
      error: null,
    });
    const { container, unmount } = render(
      <SlntTeamPoolSummary selectedDate="2026-10-25" staff={[]} />,
    );
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('slnt_team_b_pool_v6', { p_service_date: '2026-10-25' }));

    const tiles = container.querySelectorAll('[data-training^="slnt-summary-"]');
    expect(tiles).toHaveLength(9);
    const pending = screen.getByRole('button', { name: /Pending.*1 rooms, view details/i });
    const inProgress = screen.getByRole('button', { name: /In progress.*0 rooms, view details/i });
    expect(pending).toHaveClass('from-amber-50');
    expect(inProgress).toHaveClass('from-blue-50');
    expect(pending).toHaveClass('min-w-0');

    fireEvent.click(pending);
    expect(await screen.findByTestId('room-preview')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    unmount();
  });
});
