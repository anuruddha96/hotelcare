// Shared helpers for talking to the Sales Dashboard - RD Hotels Supabase project.
// The dashboard is the single source of truth for restaurant/brunch bookings of
// every RD property; HotelCare mirrors them into public.restaurant_reservations.

export const BUDAPEST_TZ = "Europe/Budapest";

export function dashboardConfig(): { url: string; key: string } | null {
  const url = Deno.env.get("SALES_DASHBOARD_SUPABASE_URL");
  const key = Deno.env.get("SALES_DASHBOARD_SERVICE_KEY");
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

function tzOffsetMinutes(instant: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) parts[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === "24" ? "00" : parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUTC - instant.getTime()) / 60000;
}

/** Wall-clock time in Budapest converted to a real UTC instant. */
export function budapestWallClockToUtc(y: number, m: number, d: number, h = 0, mi = 0): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi, 0);
  const offset = tzOffsetMinutes(new Date(guess), BUDAPEST_TZ);
  return new Date(guess - offset * 60000);
}

/** [startUtc, endUtc) covering one Budapest calendar day (YYYY-MM-DD). */
export function budapestDayRange(date: string): { start: Date; end: Date } {
  const [y, m, d] = date.split("-").map(Number);
  const start = budapestWallClockToUtc(y, m, d, 0, 0);
  const end = new Date(start.getTime() + 26 * 3600_000);
  // Recompute the exact next-midnight to stay DST-correct.
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const exactEnd = budapestWallClockToUtc(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    0,
    0,
  );
  return { start, end: exactEnd > start ? exactEnd : end };
}

/** Budapest calendar date (YYYY-MM-DD) of a UTC instant. */
export function budapestDate(iso: string | Date): string {
  const dt = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUDAPEST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dt);
}

/** Outlets whose bookings belong on the /bb Reservations tab. */
export function isRestaurantOutlet(slug: string | null | undefined): boolean {
  const s = String(slug ?? "").toLowerCase();
  if (!s) return true;
  if (s.includes("museum") || s.includes("transfer") || s.includes("parking")) return false;
  return true;
}
