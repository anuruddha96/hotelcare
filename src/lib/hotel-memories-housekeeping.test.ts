import { describe, expect, it } from 'vitest';
import {
  getGuestDeclinedServiceComment,
  isGuestDeclinedService,
} from './hotel-memories-housekeeping';

describe('guest-declined housekeeping outcomes', () => {
  it('uses the first-class service_result', () => {
    expect(isGuestDeclinedService('guest_declined', null)).toBe(true);
    expect(isGuestDeclinedService('cleaned', null)).toBe(false);
  });

  it('keeps legacy NO_SERVICE records compatible', () => {
    expect(
      isGuestDeclinedService(
        null,
        '[NO_SERVICE] Guest confirmed no service required',
      ),
    ).toBe(true);
  });

  it('shows only the final no-service comment when a green-board marker also exists', () => {
    const notes = [
      '[GREEN_BOARD_CLEAN_REQUEST] Green Clean My Room card seen at the door — cleaning requested.',
      '[NO_SERVICE]',
      '[NO_BOARD_NO_CLEANING] Door checked — no green Clean My Room card / no cleaning request. Guest asked to skip today.',
    ].join('\n');

    expect(getGuestDeclinedServiceComment(notes)).toBe('Guest asked to skip today.');
  });

  it('extracts the housekeeper comment from a generic legacy no-service record', () => {
    expect(
      getGuestDeclinedServiceComment(
        '[NO_SERVICE] Guest confirmed no service required — Guest sleeping',
      ),
    ).toBe('Guest sleeping');
  });
});
