import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomStatePeriodManager, suggestedLastDay, type RoomStatePeriod } from './RoomStatePeriodManager';

const mocks = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), toastSuccess: vi.fn(), toastError: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ profile: { role: 'manager', organization_slug: 'channex' } }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/lib/budapestTime', () => ({ todayBudapest: () => '2026-11-23' }));
vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

function selectPeriods(data: RoomStatePeriod[]) {
  const query = {
    select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockResolvedValue({ data, error: null });
  mocks.from.mockReturnValue(query);
}

describe('dated room state editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectPeriods([]);
    mocks.rpc.mockResolvedValue({ data: 'new-period', error: null });
  });

  it('suggests yesterday as the last affected day to release an older period today', () => {
    const period: RoomStatePeriod = {
      id: 'p1', state: 'out_of_order', from_date: '2026-11-20',
      to_date: '2026-11-25', reason: 'Repair', created_at: '2026-11-20',
    };
    expect(suggestedLastDay(period, '2026-11-23')).toBe('2026-11-22');
    expect(suggestedLastDay({ ...period, from_date: '2026-11-23' }, '2026-11-23')).toBe('2026-11-23');
  });

  it('records a dated period through the authenticated RPC, never a direct room status write', async () => {
    const refresh = vi.fn();
    render(<RoomStatePeriodManager hotelId="channex-test-property" roomId="room-103"
      roomNumber="103" active onChanged={refresh} />);
    const reason = await screen.findByPlaceholderText('ntak.phase4.reasonPlaceholder');
    fireEvent.change(reason, { target: { value: 'Heating repair' } });
    fireEvent.click(screen.getByRole('button', { name: 'ntak.phase4.add' }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith(
      'pms_add_room_state_period',
      { _hotel_id: 'channex-test-property', _room_id: 'room-103',
        _state: 'out_of_order', _from_date: '2026-11-23',
        _to_date: '2026-11-23', _reason: 'Heating repair' },
    ));
    expect(mocks.from).toHaveBeenCalledWith('room_state_periods');
    expect(refresh).toHaveBeenCalled();
  });
});
