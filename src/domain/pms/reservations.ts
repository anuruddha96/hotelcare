export const RESERVATION_STATUSES = [
  "tentative",
  "confirmed",
  "checked_in",
  "checked_out",
  "cancelled",
  "no_show",
] as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<ReservationStatus, readonly ReservationStatus[]> = {
  tentative: ["confirmed", "cancelled"],
  confirmed: ["checked_in", "cancelled", "no_show"],
  checked_in: ["checked_out"],
  checked_out: [],
  cancelled: [],
  no_show: [],
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_STAY_NIGHTS = 730;

function parseIsoDate(value: string): Date {
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new Error(`Invalid ISO date: ${value}`);
  }

  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${value}`);
  }

  return parsed;
}

export function canTransitionReservationStatus(
  from: ReservationStatus,
  to: ReservationStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertReservationStatusTransition(
  from: ReservationStatus,
  to: ReservationStatus,
): void {
  if (!canTransitionReservationStatus(from, to)) {
    throw new Error(`Invalid reservation status transition: ${from} -> ${to}`);
  }
}

/**
 * Expands a hotel stay into arrival-inclusive, departure-exclusive night dates.
 * UTC date arithmetic deliberately avoids DST/timezone drift.
 */
export function expandStayNights(arrivalDate: string, departureDate: string): string[] {
  const arrival = parseIsoDate(arrivalDate);
  const departure = parseIsoDate(departureDate);

  if (departure.getTime() <= arrival.getTime()) {
    throw new Error("Departure date must be after arrival date");
  }

  const nights: string[] = [];
  const cursor = new Date(arrival.getTime());

  while (cursor.getTime() < departure.getTime()) {
    nights.push(cursor.toISOString().slice(0, 10));
    if (nights.length > MAX_STAY_NIGHTS) {
      throw new Error(`Stay cannot exceed ${MAX_STAY_NIGHTS} nights`);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return nights;
}

export interface InventoryInputs {
  physicalInventory: number;
  reserved: number;
  outOfOrder: number;
  blocks: number;
  overbookingAllowance?: number;
}

function assertInventoryInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

/**
 * Canonical sellable-inventory formula for the future HotelCare PMS.
 * The result is clamped at zero so downstream callers never publish a negative count.
 */
export function calculateAvailableInventory({
  physicalInventory,
  reserved,
  outOfOrder,
  blocks,
  overbookingAllowance = 0,
}: InventoryInputs): number {
  assertInventoryInteger("physicalInventory", physicalInventory);
  assertInventoryInteger("reserved", reserved);
  assertInventoryInteger("outOfOrder", outOfOrder);
  assertInventoryInteger("blocks", blocks);
  assertInventoryInteger("overbookingAllowance", overbookingAllowance);

  return Math.max(
    0,
    physicalInventory - reserved - outOfOrder - blocks + overbookingAllowance,
  );
}

export interface ReservationExternalIdentity {
  hotelId: string;
  sourceSystem: string;
  externalReservationId: string;
}

/**
 * Stable, delimiter-safe identity used to make external reservation ingestion idempotent.
 */
export function buildReservationIdempotencyKey({
  hotelId,
  sourceSystem,
  externalReservationId,
}: ReservationExternalIdentity): string {
  const hotel = hotelId.trim();
  const source = sourceSystem.trim().toLowerCase();
  const externalId = externalReservationId.trim();

  if (!hotel || !source || !externalId) {
    throw new Error("hotelId, sourceSystem and externalReservationId are required");
  }

  return ["pms-reservation", hotel, source, externalId]
    .map((part) => encodeURIComponent(part))
    .join(":");
}
