import { describe, expect, it } from 'vitest';
import {
  canOfferCheckoutRtc,
  shouldConfirmManualRtc,
  shouldInterceptCheckoutMarkClean,
} from './checkoutRtcGuard';

describe('checkout RTC guard', () => {
  it('offers RTC only for active checkout-cleaning work', () => {
    expect(canOfferCheckoutRtc({
      isCheckout: true,
      assignmentType: 'checkout_cleaning',
      assignmentStatus: 'assigned',
    })).toBe(true);

    expect(canOfferCheckoutRtc({
      isCheckout: false,
      assignmentType: 'daily_cleaning',
      assignmentStatus: 'assigned',
    })).toBe(false);

    expect(canOfferCheckoutRtc({
      isCheckout: true,
      assignmentType: 'checkout_cleaning',
      assignmentStatus: 'completed',
    })).toBe(false);
  });

  it('intercepts Mark Clean until an active checkout has gone through RTC', () => {
    expect(shouldInterceptCheckoutMarkClean({
      isCheckout: true,
      assignmentType: 'checkout_cleaning',
      assignmentStatus: 'assigned',
      readyToClean: false,
    })).toBe(true);

    expect(shouldInterceptCheckoutMarkClean({
      isCheckout: true,
      assignmentType: 'checkout_cleaning',
      assignmentStatus: 'assigned',
      readyToClean: true,
    })).toBe(false);
  });

  it('requires physical-checkout confirmation when PMS has not released the room', () => {
    expect(shouldConfirmManualRtc({
      pmsRtcToday: false,
      checkedOutToday: false,
      pmsHold: true,
    })).toBe(true);

    expect(shouldConfirmManualRtc({
      pmsRtcToday: true,
      checkedOutToday: true,
      pmsHold: false,
    })).toBe(false);
  });
});
