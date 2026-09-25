export type CarryForwardServiceType = 'towel_change' | 'full_clean';
export type CarryForwardReason = 'dnd' | 'no_service';

export interface HousekeepingCarryForward {
  active: true;
  propertyId: 'mika-downtown' | 'ottofiori' | 'gozsdu-court' | 'memories-budapest' | string;
  sourceBusinessDate: string;
  originalDueDate: string;
  serviceType: CarryForwardServiceType;
  reason: CarryForwardReason;
  attemptCount: number;
  policySource: string | null;
  instruction: string;
}

const normalized = (value?: string | null) =>
  String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const PORTFOLIO_ALIASES = new Set([
  'mika-downtown',
  'hotel mika downtown',
  'mika downtown',
  'ottofiori',
  'hotel ottofiori',
  'gozsdu-court',
  'gozsdu court budapest',
]);

export function isPortfolioCarryForwardHotel(hotel?: string | null): boolean {
  return PORTFOLIO_ALIASES.has(normalized(hotel));
}

/**
 * Shared reader for the structured cross-day housekeeping service debt.
 * The database decides eligibility; UI callers only parse and present it.
 */
export function getHousekeepingCarryForward(
  previousDayContext?: unknown,
): HousekeepingCarryForward | null {
  if (!previousDayContext || typeof previousDayContext !== 'object') return null;
  const raw = (previousDayContext as Record<string, unknown>).carry_forward;
  if (!raw || typeof raw !== 'object') return null;

  const carry = raw as Record<string, unknown>;
  if (carry.active !== true) return null;

  const serviceType = carry.service_type;
  const reason = carry.reason;
  const sourceBusinessDate = String(carry.source_business_date || '').trim();
  const originalDueDate = String(carry.original_due_date || sourceBusinessDate).trim();
  const propertyId = String(carry.property_id || '').trim();
  const policySource = typeof carry.policy_source === 'string' ? carry.policy_source : null;
  const rawAttempt = Number(carry.attempt_count ?? 1);
  const attemptCount = Number.isInteger(rawAttempt) && rawAttempt > 0 ? rawAttempt : 1;

  if (serviceType !== 'towel_change' && serviceType !== 'full_clean') return null;
  if (reason !== 'dnd' && reason !== 'no_service') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceBusinessDate)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(originalDueDate)) return null;

  const serviceLabel = serviceType === 'full_clean'
    ? propertyId === 'gozsdu-court'
      ? 'Complete Textile Change'
      : 'full room cleaning (Change Room)'
    : 'towel change';
  const reasonLabel = reason === 'dnd'
    ? 'this room was DND'
    : 'the guest declined housekeeping (No Service)';
  const action = serviceType === 'full_clean'
    ? propertyId === 'gozsdu-court'
      ? 'Please attempt the Complete Textile Change today.'
      : 'Please attempt the full cleaning today.'
    : 'Please attempt the towel change today.';

  const fallback = attemptCount > 1
    ? `${serviceLabel} remains outstanding. Originally due ${originalDueDate}; yesterday (${sourceBusinessDate}) ${reasonLabel}, so it was not completed. ${action}`
    : `Yesterday (${sourceBusinessDate}) ${reasonLabel}, so the scheduled ${serviceLabel} was not completed. ${action}`;

  const instruction = typeof carry.instruction === 'string' && carry.instruction.trim()
    ? carry.instruction.trim()
    : fallback;

  return {
    active: true,
    propertyId,
    sourceBusinessDate,
    originalDueDate,
    serviceType,
    reason,
    attemptCount,
    policySource,
    instruction,
  };
}

export function effectiveCarryServiceFlags(input: {
  towelChangeRequired?: boolean | null;
  linenChangeRequired?: boolean | null;
  carryForward?: HousekeepingCarryForward | null;
  isCheckout?: boolean;
}) {
  if (input.isCheckout) {
    return { towelChangeRequired: false, linenChangeRequired: false };
  }

  const naturalFull = !!input.linenChangeRequired;
  const carryFull = input.carryForward?.serviceType === 'full_clean';
  const linenChangeRequired = naturalFull || carryFull;

  // Full clean / Change Room already includes towels, so do not paint two
  // separate service requirements when the stronger task is active.
  const towelChangeRequired = !linenChangeRequired && (
    !!input.towelChangeRequired
    || input.carryForward?.serviceType === 'towel_change'
  );

  return { towelChangeRequired, linenChangeRequired };
}
