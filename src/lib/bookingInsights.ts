/** Types and financial definitions for the Previo booking-history decision board. */
export interface BookingInsightDay {
  day: string; bookings: number; cancellations: number; booked_nights: number; cancelled_nights: number;
  booked_value: number; cancelled_value: number;
}
export interface BookingInsightSummary {
  bookings: number; cancellations: number; booked_room_items: number; known_los_items: number;
  booked_nights: number; cancelled_nights: number; booked_value: number; cancelled_value: number;
  avg_los: number | null; avg_booking_lead: number | null; avg_cancel_lead: number | null;
  cancellations_after_arrival: number; bookings_after_arrival: number; unknown_channels: number;
}
export interface InsightPrevious { bookings: number; cancellations: number; booked_value: number; cancelled_value: number; }
export interface InsightCohort { booked_reservations: number; ever_had_cancelled_nights: number; }
export interface InsightChannel { name: string; bookings: number; room_stays: number; room_nights: number; value_eur: number; adr: number | null; }
export interface InsightDistribution { bucket: string; count: number; value_eur?: number; }
export interface InsightArrivalMonth { month: string; bookings: number; room_stays: number; booked_value: number; }
export interface InsightWeekday { weekday: number; bookings: number; booked_value: number; }
export interface BookingInsights {
  period_days: number;
  currency_code?: string | null;
  summary: BookingInsightSummary;
  previous: InsightPrevious;
  cohort: InsightCohort;
  daily: BookingInsightDay[];
  channels: InsightChannel[];
  room_types: InsightChannel[];
  los: InsightDistribution[];
  booking_lead: InsightDistribution[];
  cancellation_lead: InsightDistribution[];
  arrival_months: InsightArrivalMonth[];
  weekdays: InsightWeekday[];
  first_cancellation_recorded_at: string | null;
  first_archive_capture_at: string | null;
}
export const validNumber = (value: unknown): number => {
  const n = Number(value);
  return value === null || value === undefined || !Number.isFinite(n) ? 0 : n;
};
/** A percent change requires a real reference period. */
export function bookingChangePct(current: number, prior: number): number | null {
  return prior > 0 ? Math.round(((current - prior) / prior) * 100) : null;
}
/** This is *observed cancellation incidence to date*, NOT an eventual cancellation rate. */
export function observedCohortIncidence(cohort: InsightCohort): number | null {
  return cohort.booked_reservations > 0
    ? (100 * cohort.ever_had_cancelled_nights) / cohort.booked_reservations
    : null;
}
/** The scheduled-stay coverage makes explicit how much LOS evidence is available. */
export function scheduledLosCoverage(summary: BookingInsightSummary): number | null {
  return summary.booked_room_items > 0 ? 100 * summary.known_los_items / summary.booked_room_items : null;
}
export const fmtPct = (value: number | null, digits = 0): string => value === null ? "—" : value.toFixed(digits) + "%";

export function formatBookingMoney(amount: number | null | undefined, code: string | null | undefined): string {
  const value = validNumber(amount);
  return code && /^[A-Z]{3}$/.test(code)
    ? new Intl.NumberFormat("en-GB",{style:"currency",currency:code,maximumFractionDigits:0}).format(value)
    : value.toLocaleString("en-GB") + " (currency unavailable)";
}
