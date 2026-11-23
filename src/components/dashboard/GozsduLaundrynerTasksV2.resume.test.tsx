import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GozsduLaundrynerTasksV2 } from './GozsduLaundrynerTasksV2';

const mocks = vi.hoisted(() => ({ fail: false, ready: true, rpc: vi.fn() }));
const date = '2026-11-23';
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({
  user: { id: 'cleaner-1' },
  profile: { assigned_hotel: 'gozsdu-court', organization_slug: 'rdhotels' },
}) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ language: 'en', t: (key: string) => key }) }));
vi.mock('@/lib/budapestTime', () => ({ todayBudapest: () => '2026-11-23' }));
vi.mock('@/lib/gozsduLinenCatalogue', () => ({
  loadHotelLinenCatalogue: async () => [{ id: 'sheet', name: 'Sheet' }],
  gozsduLinenLabel: () => 'Sheet',
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: (table: string) => {
    const result = (single = false) => {
      const room = { id: 'room-1', room_number: '1001', hotel: 'gozsdu-court', status: 'dirty',
        is_checkout_room: true, is_dnd: false, pms_metadata: {
          lastPmsRefreshDate: date, checkedOutToday: true, readyToClean: mocks.ready,
        } };
      const rows = table === 'rooms' ? [room] : table === 'room_assignments' ? [{
        id: 'assignment-1', room_id: 'room-1', assigned_to: 'cleaner-1', assignment_type: 'checkout_cleaning',
        status: 'in_progress', ready_to_clean: true, pms_hold: false, is_dnd: false,
      }] : [];
      return { data: single ? room : rows, error: mocks.fail && table === 'rooms' ? { message: 'Offline' } : null };
    };
    const query = {
      select: () => query, eq: () => query, in: () => query,
      maybeSingle: async () => result(true),
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  },
  rpc: mocks.rpc,
  channel: () => {
    const channel = { on: () => channel, subscribe: () => channel };
    return channel;
  },
  removeChannel: vi.fn(),
} }));

describe('Gozsdu linen drafts on app return', () => {
  beforeEach(() => {
    mocks.fail = false; mocks.ready = true; mocks.rpc.mockClear();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

  async function openDraft() {
    render(<GozsduLaundrynerTasksV2 />);
    const roomButton = await screen.findByRole('button', { name: /1001,/ });
    await act(async () => { fireEvent.click(roomButton); });
    const dialog = await screen.findByRole('dialog');
    const quantity = within(dialog).getByRole('spinbutton');
    fireEvent.change(quantity, { target: { value: '3' } });
    return { dialog, quantity };
  }

  it('keeps entered quantities during an offline return, blocks saving, and recovers without losing the draft', async () => {
    const { quantity } = await openDraft();
    mocks.fail = true;
    vi.useFakeTimers();
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(650);
    });
    vi.useRealTimers();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('spinbutton')).toBe(quantity);
    expect(quantity).toHaveValue(3);
    expect(within(dialog).getByRole('button', { name: /Save collected linen/i })).toBeDisabled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.fail = false;
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /Refresh/i })); });
    expect(quantity).toHaveValue(3);
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: /Save collected linen/i })).toBeEnabled();
  });

  it('still closes entry when a successful read proves the checkout is no longer released', async () => {
    await openDraft();
    mocks.ready = false;
    vi.useFakeTimers();
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(650);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});