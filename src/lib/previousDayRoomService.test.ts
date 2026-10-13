import { describe, expect, it } from 'vitest';
import { frozenPreviousRoomService } from './previousDayRoomService';

describe('frozen previous-day housekeeping room board', () => {
  it('shows yesterday\'s due change room even after today\'s normal cycle cleared it', () => {
    const historical = frozenPreviousRoomService({
      towel_change_required: false,
      linen_change_required: false,
      final_state: {
        is_checkout_room_at_close: false,
        towel_change_required_for_assignment: false,
        linen_change_required_for_assignment: true,
      },
    }, 'daily_cleaning');
    expect(historical.isCheckout).toBe(false);
    expect(historical.linenChangeRequired).toBe(true);
    expect(historical.towelChangeRequired).toBe(false);
  });
  it('never borrows current room flags if no historical snapshot exists', () => {
    const historical = frozenPreviousRoomService(null, 'daily_cleaning');
    expect(historical.towelChangeRequired).toBe(false);
    expect(historical.linenChangeRequired).toBe(false);
  });
  it('does not show stayover service on past checkout', () => {
    const historical = frozenPreviousRoomService({
      final_state: { is_checkout_room_at_close: true, linen_change_required_for_assignment: true },
    }, 'checkout_cleaning');
    expect(historical.isCheckout).toBe(true);
    expect(historical.linenChangeRequired).toBe(false);
  });
});
