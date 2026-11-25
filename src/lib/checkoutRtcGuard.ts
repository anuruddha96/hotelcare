export type CheckoutRtcGuardInput = {
  isCheckout: boolean;
  assignmentType?: string | null;
  assignmentStatus?: string | null;
  readyToClean?: boolean | null;
};

export type ManualRtcConfirmationInput = {
  pmsRtcToday: boolean;
  checkedOutToday?: boolean | null;
  pmsHold?: boolean | null;
};

/**
 * RTC is an operational release for an active checkout-cleaning assignment.
 * Daily/stayover rooms and completed work must never receive this action.
 */
export function canOfferCheckoutRtc(input: CheckoutRtcGuardInput): boolean {
  return input.isCheckout
    && input.assignmentType === 'checkout_cleaning'
    && input.assignmentStatus !== 'completed';
}

/**
 * Intercept a manager's Mark Clean action when the checkout has not yet gone
 * through RTC. This preserves the normal housekeeping sequence while still
 * allowing an explicit "already cleaned" override after confirmation.
 */
export function shouldInterceptCheckoutMarkClean(input: CheckoutRtcGuardInput): boolean {
  return canOfferCheckoutRtc(input) && input.readyToClean !== true;
}

/**
 * If PMS has not positively released the room, a manual RTC click must ask
 * the user to confirm that the guest has physically left.
 */
export function shouldConfirmManualRtc(input: ManualRtcConfirmationInput): boolean {
  return input.pmsHold === true
    || (!input.pmsRtcToday && input.checkedOutToday !== true);
}
