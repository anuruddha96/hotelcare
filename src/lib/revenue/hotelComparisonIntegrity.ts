import type { ReconciliationDay } from "@/lib/kpiReconciliation";

/** Independent PMS inventory evidence for one room type on one stay date. */
export type ComparisonAvailabilityRow = {
  hotel_id: string;
  stay_date: string;
  availability: number | null;
  captured_at: string | null;
};

export type ComparisonSyncState = {
  scope?: string | null;
  last_success_at?: string | null;
};

export type ComparisonIntegrity = {
  bookingsVerified: boolean;
  pricesVerified: boolean;
  issue: string | null;
  priceIssue: string | null;
};

type Options = {
  rows: ReconciliationDay[];
  month: string;
  today: string; // Europe/Budapest YYYY-MM-DD; NOT the browser's UTC date.
  availability: ComparisonAvailabilityRow[];
  sync: ComparisonSyncState | null | undefined;
  reconciliationFetchedAt: number;
  availabilityFetchedAt: number;
  syncFetchedAt: number;
  nowMs?: number;
};

const MAX_SYNC_AGE_MS = 90 * 60_000;
const CAPTURE_GRACE_MS = 5 * 60_000;
const invalid = (issue: string): ComparisonIntegrity => ({
  bookingsVerified: false, pricesVerified: false, issue, priceIssue: null,
});
const numeric = (value: unknown) => value !== null && value !== undefined && value !== ""
  && Number.isFinite(Number(value)) ? Number(value) : NaN;

/**
 * A generated calendar spine is NOT proof that Previo reservations have synced.
 * In particular, a month with past nights loaded and future nights missing
 * looks deceptively complete unless cross-checked against PMS inventory.
 *
 * Fail closed: unavailable metrics must never be silently displayed as zero.
 * For future dates, require a recent, completed PMS sync, a reconciliation
 * fetched after that sync, and independent availability for EVERY date.
 */
export function validateHotelComparisonData({
  rows, month, today, availability, sync, reconciliationFetchedAt,
  availabilityFetchedAt, syncFetchedAt, nowMs = Date.now(),
}: Options): ComparisonIntegrity {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return invalid("Invalid month");
  const [year, mm] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  const monthEnd = `${month}-${String(daysInMonth).padStart(2, "0")}`;
  const unique = new Map(rows.map((day) => [day.stay_date, day]));
  if (rows.length !== daysInMonth || unique.size !== daysInMonth
      || Array.from({ length: daysInMonth }, (_, i) =>
        `${month}-${String(i + 1).padStart(2, "0")}`).some((date) => !unique.has(date))) {
    return invalid("Complete monthly reservation data is unavailable");
  }

  let missingPrices = 0;
  let anyBookingEvidence = false;
  for (const day of rows) {
    const capacity = numeric(day.commercial_capacity);
    const sold = numeric(day.commercial_sold);
    const unpriced = numeric(day.unpriced_nights);
    const gross = numeric(day.room_revenue_gross);
    if (!Number.isInteger(capacity) || capacity <= 0
        || !Number.isInteger(sold) || sold < 0 || sold > capacity
        || !Number.isInteger(unpriced) || unpriced < 0 || unpriced > sold
        || !Number.isFinite(gross) || gross < 0
        || (day.flags ?? []).includes("overbooked_or_duplicate")) {
      return invalid("PMS room counts or booking revenue failed validation");
    }
    if (sold > 0 && !day.bookings_captured_at) {
      return invalid("Reservation capture date is missing");
    }
    anyBookingEvidence ||= sold > 0;
    missingPrices += unpriced;
  }

  // No recorded bookings anywhere in a month cannot be distinguished from
  // an unpopulated calendar spine without independent evidence.
  if (!anyBookingEvidence && monthEnd < today) {
    return invalid("No independently verified historical booking data");
  }

  if (monthEnd >= today) {
    const successAt = Date.parse(sync?.last_success_at ?? "");
    if (sync?.scope === "this_property") return invalid("PMS sync in progress");
    if (!Number.isFinite(successAt) || successAt > nowMs + CAPTURE_GRACE_MS
        || nowMs - successAt > MAX_SYNC_AGE_MS) {
      return invalid("A recent successful PMS sync could not be verified");
    }
    if (reconciliationFetchedAt < successAt
        || availabilityFetchedAt < successAt
        || syncFetchedAt <= 0) {
      return invalid("Waiting for booking and inventory data from the latest PMS sync");
    }

    const dates = rows.filter((day) => day.stay_date >= today);
    const byDate = new Map<string, ComparisonAvailabilityRow[]>();
    for (const row of availability) {
      if (row.stay_date < today || row.stay_date > monthEnd) continue;
      byDate.set(row.stay_date, [...(byDate.get(row.stay_date) ?? []), row]);
    }

    for (const day of dates) {
      const entries = byDate.get(day.stay_date);
      if (!entries?.length) return invalid("Future PMS availability is missing for some dates");
      let remaining = 0;
      for (const entry of entries) {
        const rooms = numeric(entry.availability);
        const capturedAt = Date.parse(entry.captured_at ?? "");
        if (!Number.isInteger(rooms) || rooms < 0
            || !Number.isFinite(capturedAt)
            || capturedAt < successAt - CAPTURE_GRACE_MS
            || nowMs - capturedAt > MAX_SYNC_AGE_MS) {
          return invalid("Future PMS inventory is incomplete or outdated");
        }
        remaining += rooms;
      }
      // Previo availability may temporarily differ by a room or two because
      // of overbooking/room moves; material missing bookings never pass.
      const tolerance = Math.max(2, Math.ceil(day.commercial_capacity * 0.05));
      const unaccounted = day.commercial_capacity - day.commercial_sold - remaining;
      if (Math.abs(unaccounted) > tolerance) {
        return invalid("PMS availability and booked room-nights do not reconcile");
      }
      if (day.commercial_sold > 0) {
        const capturedAt = Date.parse(day.bookings_captured_at ?? "");
        if (!Number.isFinite(capturedAt)
            || capturedAt < successAt - CAPTURE_GRACE_MS) {
          return invalid("Future reservations have not completed the latest PMS sync");
        }
      }
    }
  }

  return {
    bookingsVerified: true,
    pricesVerified: missingPrices === 0,
    issue: null,
    priceIssue: missingPrices ? `${missingPrices} sold room-nights have no verified price` : null,
  };
}
