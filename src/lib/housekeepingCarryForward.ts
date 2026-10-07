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


export type CarryForwardDisplayInput = {
  serviceType: CarryForwardServiceType;
  reason: CarryForwardReason;
  sourceBusinessDate: string;
  originalDueDate?: string | null;
  attemptCount?: number | null;
  propertyId?: string | null;
};

export type CarryForwardHousekeeperCopy = {
  action: string;
  reason: string;
  message: string;
  icon: '🧺' | '🧹';
};

export type CarryForwardManagerCopy = {
  action: string;
  summary: string;
  detail: string | null;
  reasonLabel: 'DND' | 'No Service';
};

function carryForwardAction(input: CarryForwardDisplayInput): string {
  if (input.serviceType === 'towel_change') return 'Towel change today';
  if (input.propertyId === 'gozsdu-court') return 'Complete textile change today';
  return 'Full room clean today';
}

/**
 * Housekeeper copy is deliberately short and action-first. The backend keeps
 * the full lineage/audit instruction; operational cards should not expose that
 * technical history as the task itself.
 */
export function getCarryForwardHousekeeperCopy(
  input: CarryForwardDisplayInput,
): CarryForwardHousekeeperCopy {
  const action = carryForwardAction(input);
  const reasonLabel = input.reason === 'dnd' ? 'DND' : 'No Service';
  const reason = `Missed yesterday — ${reasonLabel}`;
  return {
    action,
    reason,
    message: `${action}. ${reason}.`,
    icon: input.serviceType === 'towel_change' ? '🧺' : '🧹',
  };
}

/**
 * Managers get the same clear action plus dated lineage. This is intentionally
 * human-readable rather than exposing previous_day_context or other backend
 * implementation details.
 */
export function getCarryForwardManagerCopy(
  input: CarryForwardDisplayInput,
): CarryForwardManagerCopy {
  const action = carryForwardAction(input);
  const reasonLabel = input.reason === 'dnd' ? 'DND' : 'No Service';
  const originalDueDate = input.originalDueDate || input.sourceBusinessDate;
  const attemptCount = Number.isInteger(input.attemptCount) && Number(input.attemptCount) > 0
    ? Number(input.attemptCount)
    : 1;
  const serviceLabel = input.serviceType === 'towel_change'
    ? 'Towel change'
    : input.propertyId === 'gozsdu-court'
      ? 'Complete textile change'
      : 'Full room clean';

  return {
    action,
    reasonLabel,
    summary: `${serviceLabel} carried from ${input.sourceBusinessDate} · ${reasonLabel}`,
    detail: attemptCount > 1
      ? `Originally due ${originalDueDate} · attempt ${attemptCount}`
      : `Originally due ${originalDueDate}`,
  };
}
