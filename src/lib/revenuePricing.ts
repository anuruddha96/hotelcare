// Pure rule-engine for RPG-style revenue pricing.
// Output is both numbers (for recommendation rows) and a breakdown
// (for driver chips in the day-detail panel).

export type Aggressiveness = "low" | "medium" | "high";

export interface PricingMultipliers {
  basePriceEur?: number; // from room_types.base_price_eur (reference room)
  minPriceEur?: number;
  maxPriceEur?: number;
  dowPercent: Record<number, number>;       // 0..6 (Mon..Sun)
  monthlyPercent: Record<number, number>;   // 1..12
  leadTimePercent: Record<string, number>;  // bucket -> %
  occupancyTargetPct?: number;              // 0..100
  occupancyAggressiveness?: Aggressiveness;
}

export interface PickupTier { min: number; max: number; increase: number; }

export interface EngineSettings {
  floor_price_eur: number;
  max_daily_change_eur: number;
  weekday_decrease_eur: number;
  weekend_decrease_eur: number;
  pickup_increase_tiers: PickupTier[];
}

export interface PriceInput {
  date: string;
  daysOut: number;
  dow: number;          // 0..6 Mon-first
  isWeekend: boolean;
  currentRate: number | null;
  occupancyPct: number | null;
  pickupDelta: number;
  bookingsNow: number | null;
}

export type DriverKind = "base" | "dow" | "month" | "lead" | "occupancy" | "pickup" | "weekday_decrease" | "clamp";

export interface PricingDriver {
  kind: DriverKind;
  label: string;
  detail: string;       // human readable description
  effectEur: number;    // signed € contribution
  multiplier?: number;  // optional, for display
  source: string;       // settings table name, for tooltip
}

export interface PriceResult {
  basePriceEur: number;
  rawRate: number;     // before clamping
  finalRate: number;   // after clamp
  deltaEur: number;    // finalRate - currentRate (or 0)
  drivers: PricingDriver[];
}

export function leadTimeBucket(daysOut: number): string {
  if (daysOut >= 180) return "6m_plus";
  if (daysOut >= 90) return "3m_plus";
  if (daysOut >= 45) return "1_5_to_3m";
  if (daysOut >= 28) return "4_6w";
  if (daysOut >= 14) return "2_4w";
  if (daysOut >= 7) return "1_2w";
  if (daysOut >= 4) return "4_7d";
  if (daysOut >= 2) return "2_3d";
  return "last_day";
}

export const DOW_NAMES = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
export const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const LEAD_LABELS: Record<string,string> = {
  "6m_plus": "6 months+", "3m_plus": "3-6 months", "1_5_to_3m": "1.5-3 months",
  "4_6w": "4-6 weeks", "2_4w": "2-4 weeks", "1_2w": "1-2 weeks",
  "4_7d": "4-7 days", "2_3d": "2-3 days", "last_day": "Last day",
};

function pct(v: number) { return Math.round(v * 10) / 10; }

export function computeSuggestedRate(
  input: PriceInput,
  settings: EngineSettings,
  m: PricingMultipliers,
): PriceResult {
  const drivers: PricingDriver[] = [];
  const base = m.basePriceEur ?? input.currentRate ?? settings.floor_price_eur;

  drivers.push({
    kind: "base", label: "Base price",
    detail: m.basePriceEur != null ? "from Rooms Setup" : "from current rate",
    effectEur: base, source: "room_types.base_price_eur",
  });

  let rate = base;

  // DOW adjustment
  const dowPct = m.dowPercent[input.dow] ?? 0;
  if (dowPct !== 0) {
    const before = rate;
    rate = rate * (1 + dowPct / 100);
    drivers.push({
      kind: "dow", label: `DOW (${DOW_NAMES[input.dow]})`,
      detail: `${dowPct >= 0 ? "+" : ""}${pct(dowPct)}%`,
      effectEur: rate - before, multiplier: 1 + dowPct / 100,
      source: "dow_adjustments",
    });
  }

  // Monthly adjustment
  const month = parseInt(input.date.slice(5, 7), 10);
  const monPct = m.monthlyPercent[month] ?? 0;
  if (monPct !== 0) {
    const before = rate;
    rate = rate * (1 + monPct / 100);
    drivers.push({
      kind: "month", label: `Month (${MONTH_NAMES[month - 1]})`,
      detail: `${monPct >= 0 ? "+" : ""}${pct(monPct)}%`,
      effectEur: rate - before, multiplier: 1 + monPct / 100,
      source: "monthly_adjustments",
    });
  }

  // Lead time
  const bucket = leadTimeBucket(input.daysOut);
  const leadPct = m.leadTimePercent[bucket] ?? 0;
  if (leadPct !== 0) {
    const before = rate;
    rate = rate * (1 + leadPct / 100);
    drivers.push({
      kind: "lead", label: `Lead time (${LEAD_LABELS[bucket]})`,
      detail: `${leadPct >= 0 ? "+" : ""}${pct(leadPct)}%`,
      effectEur: rate - before, multiplier: 1 + leadPct / 100,
      source: "lead_time_adjustments",
    });
  }

  // Occupancy target multiplier (light: ±5% gap × aggressiveness factor)
  if (m.occupancyTargetPct != null && input.occupancyPct != null) {
    const gap = (input.occupancyPct - m.occupancyTargetPct) / 100; // -1..1
    const factor = m.occupancyAggressiveness === "high" ? 0.5
      : m.occupancyAggressiveness === "low" ? 0.15 : 0.3;
    const occMult = 1 + gap * factor;
    if (Math.abs(occMult - 1) > 0.001) {
      const before = rate;
      rate = rate * occMult;
      drivers.push({
        kind: "occupancy",
        label: `Occupancy ${input.occupancyPct}% vs ${m.occupancyTargetPct}%`,
        detail: `${(occMult - 1) >= 0 ? "+" : ""}${pct((occMult - 1) * 100)}%`,
        effectEur: rate - before, multiplier: occMult,
        source: "occupancy_targets",
      });
    }
  }

  // Pickup tier or weekday decrease
  if (input.pickupDelta > 0) {
    const tier = settings.pickup_increase_tiers.find(
      t => input.pickupDelta >= t.min && input.pickupDelta <= t.max,
    );
    if (tier) {
      rate = rate + tier.increase;
      drivers.push({
        kind: "pickup", label: `Pickup +${input.pickupDelta} bookings`,
        detail: `tier €${tier.increase}`,
        effectEur: tier.increase,
        source: "hotel_revenue_settings.pickup_increase_tiers",
      });
    }
  } else if ((input.bookingsNow ?? 0) === 0 && input.daysOut > 7) {
    const dec = input.isWeekend ? settings.weekend_decrease_eur : settings.weekday_decrease_eur;
    rate = rate - dec;
    drivers.push({
      kind: "weekday_decrease",
      label: input.isWeekend ? "Weekend slow demand" : "Weekday slow demand",
      detail: `−€${dec}`, effectEur: -dec,
      source: "hotel_revenue_settings",
    });
  }

  // Clamp daily change & floor / room min/max
  const ref = input.currentRate ?? base;
  let clamped = rate;
  if (settings.max_daily_change_eur > 0) {
    const maxUp = ref + settings.max_daily_change_eur;
    const maxDown = ref - settings.max_daily_change_eur;
    if (clamped > maxUp) clamped = maxUp;
    if (clamped < maxDown) clamped = maxDown;
  }
  const floor = Math.max(settings.floor_price_eur, m.minPriceEur ?? 0);
  if (clamped < floor) clamped = floor;
  if (m.maxPriceEur && clamped > m.maxPriceEur) clamped = m.maxPriceEur;

  if (Math.abs(clamped - rate) > 0.5) {
    drivers.push({
      kind: "clamp", label: "Clamped",
      detail: `to [€${Math.round(floor)}, €${Math.round(m.maxPriceEur ?? 9999)}] / max daily ±€${settings.max_daily_change_eur}`,
      effectEur: clamped - rate,
      source: "hotel_revenue_settings + room_types",
    });
  }

  const finalRate = Math.round(clamped);
  return {
    basePriceEur: Math.round(base),
    rawRate: Math.round(rate),
    finalRate,
    deltaEur: input.currentRate != null ? finalRate - input.currentRate : 0,
    drivers,
  };
}
