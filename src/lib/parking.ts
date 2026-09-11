export const PARKING_MAX_BATCH_SIZE = 2000;

export type ParkingAccess = 'none' | 'issue' | 'manage';
export type ParkingStoredStatus = 'available' | 'issued' | 'void';
export type ParkingDisplayStatus = ParkingStoredStatus | 'expired';
export type ParkingSearchStatus = 'all' | ParkingDisplayStatus;

export const PARKING_MANAGER_ROLES = [
  'admin',
  'top_management',
  'top_management_manager',
  'manager',
  'reception_manager',
  'back_office_manager',
] as const;

export const PARKING_ISSUER_ROLES = [
  ...PARKING_MANAGER_ROLES,
  'reception',
  'front_office',
] as const;

export interface ParkingSettings {
  id: string;
  organization_slug: string;
  hotel_id: string;
  provider_name: string;
  notification_emails: string[];
  default_validity_days: number;
  vendor_auto_email: boolean;
  guest_email_enabled: boolean;
  sender_email: string;
  reply_to: string | null;
  brand_name: string;
  parking_instructions: string;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export interface ParkingBatch {
  id: string;
  range_start: string;
  range_end: string;
  ticket_count: number;
  expires_on: string | null;
  label: string | null;
  created_at: string;
  created_by: string;
  available: number;
  issued: number;
  void: number;
}

export interface ParkingTicket {
  id: string;
  organization_slug: string;
  hotel_id: string;
  batch_id: string;
  reference: string;
  reference_search: string;
  status: ParkingStoredStatus;
  expires_on: string | null;
  issued_at: string | null;
  issued_by: string | null;
  valid_from: string | null;
  valid_to: string | null;
  reservation_ref: string | null;
  reservation_search: string;
  guest_name: string | null;
  guest_email: string | null;
  room_number: string | null;
  notes: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  cancellation_reported_at: string | null;
  cancellation_reported_by: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export interface ParkingTicketEvent {
  id: string;
  ticket_id: string;
  event_type: 'issued' | 'updated' | 'voided' | 'cancellation_reported' | 'cancellation_reopened';
  actor_id: string | null;
  actor_name: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface ParkingStockSummary {
  total: number;
  available: number;
  active: number;
  expired: number;
  void: number;
  unreported_expired: number;
}

export interface ParkingAccessUser {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
  role_access: ParkingAccess;
  granted_access: ParkingAccess;
  effective_access: ParkingAccess;
}

export type ParkingRangePreview =
  | {
      ok: true;
      prefix: string;
      firstNumber: bigint;
      lastNumber: bigint;
      width: number;
      count: number;
      canonicalStart: string;
      canonicalEnd: string;
    }
  | { ok: false; error: string };

export function roleParkingAccess(
  role: string | null | undefined,
  isSuperAdmin = false,
): ParkingAccess {
  if (isSuperAdmin) return 'manage';
  if (role && (PARKING_MANAGER_ROLES as readonly string[]).includes(role)) return 'manage';
  if (role && (PARKING_ISSUER_ROLES as readonly string[]).includes(role)) return 'issue';
  return 'none';
}

export function normalizeParkingReference(value: string | null | undefined): string {
  return (value || '').toLocaleLowerCase('en-US').replace(/[^a-z0-9]/g, '');
}

export function previewParkingRange(startValue: string, endValue: string): ParkingRangePreview {
  const start = startValue.trim();
  const end = endValue.trim();
  if (!start || !end || start.length > 100 || end.length > 100) {
    return { ok: false, error: 'Enter the first and last ticket reference.' };
  }

  const startMatch = start.match(/^(.*?)(\d+)$/);
  const endMatch = end.match(/^(.*?)(\d+)$/);
  if (!startMatch || !endMatch || startMatch[2].length > 18 || endMatch[2].length > 18) {
    return { ok: false, error: 'Each ticket reference must end with a number.' };
  }

  const prefix = startMatch[1];
  const endPrefix = endMatch[1] || prefix;
  if (prefix !== endPrefix) {
    return { ok: false, error: 'The first and last reference must use the same prefix.' };
  }

  const firstNumber = BigInt(startMatch[2]);
  const lastNumber = BigInt(endMatch[2]);
  if (lastNumber < firstNumber) {
    return { ok: false, error: 'The last number must not be lower than the first.' };
  }

  const countValue = lastNumber - firstNumber + 1n;
  if (countValue > BigInt(PARKING_MAX_BATCH_SIZE)) {
    return { ok: false, error: `A batch can contain at most ${PARKING_MAX_BATCH_SIZE} tickets.` };
  }

  const width = Math.max(startMatch[2].length, endMatch[2].length);
  const canonicalStart = `${prefix}${firstNumber.toString().padStart(width, '0')}`;
  const canonicalEnd = `${prefix}${lastNumber.toString().padStart(width, '0')}`;
  return {
    ok: true,
    prefix,
    firstNumber,
    lastNumber,
    width,
    count: Number(countValue),
    canonicalStart,
    canonicalEnd,
  };
}

export function todayISO(date = new Date(), timeZone = 'Europe/Budapest'): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const { year, month, day } = values;
  return `${year}-${month}-${day}`;
}

export function addDaysISO(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function parkingDisplayStatus(
  ticket: Pick<ParkingTicket, 'status' | 'valid_to'>,
  today = todayISO(),
): ParkingDisplayStatus {
  if (ticket.status === 'void') return 'void';
  if (ticket.status === 'available') return 'available';
  return ticket.valid_to && ticket.valid_to < today ? 'expired' : 'issued';
}

export function parseNotificationEmails(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[;,\n]/)
        .map((email) => email.trim().toLocaleLowerCase('en-US'))
        .filter(Boolean),
    ),
  );
}

export function parkingErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message || '').trim();
    if (message) return message.replace(/^.*?error:\s*/i, '');
  }
  if (typeof error === 'string' && error.trim()) return error.trim();
  return fallback;
}
