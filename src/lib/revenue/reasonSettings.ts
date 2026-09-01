/**
 * One place that connects a pricing decision to the setting behind it.
 *
 * The engine records a machine reason for every stay date it moved or held
 * (`decision_reason`). This map turns that reason into plain words plus the
 * exact automation fields a manager may change, so the price-update card and
 * the automation rules screen can never drift apart.
 */

export interface PickupLadderBand {
  min_days_out: number;
  max_days_out: number | null;
  one: number;
  two: number;
  three_plus: number;
  max_per_day: number;
}

export const DEFAULT_PICKUP_LADDER: PickupLadderBand[] = [
  { min_days_out: 0, max_days_out: 2, one: 4, two: 6, three_plus: 8, max_per_day: 12 },
  { min_days_out: 3, max_days_out: 7, one: 6, two: 9, three_plus: 12, max_per_day: 18 },
  { min_days_out: 8, max_days_out: 30, one: 8, two: 12, three_plus: 16, max_per_day: 24 },
  { min_days_out: 31, max_days_out: 90, one: 12, two: 18, three_plus: 24, max_per_day: 36 },
  { min_days_out: 91, max_days_out: 180, one: 18, two: 27, three_plus: 36, max_per_day: 50 },
  { min_days_out: 181, max_days_out: null, one: 25, two: 38, three_plus: 50, max_per_day: 60 },
];

export function bandLabel(band: PickupLadderBand): string {
  return band.max_days_out == null
    ? `${band.min_days_out}+ days out`
    : `${band.min_days_out}–${band.max_days_out} days out`;
}

export function bandFor(daysOut: number, ladder: PickupLadderBand[] = DEFAULT_PICKUP_LADDER): PickupLadderBand {
  for (const band of ladder) {
    const lower = daysOut >= Number(band.min_days_out);
    const upper = band.max_days_out == null || daysOut <= Number(band.max_days_out);
    if (lower && upper) return band;
  }
  return ladder[ladder.length - 1];
}

/** Occupancy-led lifts: a well-selling date earns more without new pickup. */
export interface OccupancyLiftBand {
  min_occupancy_pct: number;
  min_days_out: number;
  pct: number;
  min_eur: number;
}

export const DEFAULT_OCCUPANCY_LIFT_LADDER: OccupancyLiftBand[] = [
  { min_occupancy_pct: 80, min_days_out: 7, pct: 8, min_eur: 10 },
  { min_occupancy_pct: 70, min_days_out: 14, pct: 5, min_eur: 6 },
  { min_occupancy_pct: 60, min_days_out: 30, pct: 3, min_eur: 4 },
];

export function normaliseOccupancyLadder(value: unknown): OccupancyLiftBand[] {
  if (!Array.isArray(value) || value.length === 0) {
    return DEFAULT_OCCUPANCY_LIFT_LADDER.map((b) => ({ ...b }));
  }
  return value.map((raw: any, index) => ({
    min_occupancy_pct: Number(raw?.min_occupancy_pct ?? DEFAULT_OCCUPANCY_LIFT_LADDER[index]?.min_occupancy_pct ?? 80),
    min_days_out: Number(raw?.min_days_out ?? DEFAULT_OCCUPANCY_LIFT_LADDER[index]?.min_days_out ?? 7),
    pct: Number(raw?.pct ?? 0),
    min_eur: Number(raw?.min_eur ?? 0),
  }));
}

/** Ladder rows saved on a rule, falling back to the shipped defaults. */
export function normaliseLadder(value: unknown): PickupLadderBand[] {
  if (!Array.isArray(value) || value.length === 0) return DEFAULT_PICKUP_LADDER.map((b) => ({ ...b }));
  return value.map((raw: any, index) => ({
    min_days_out: Number(raw?.min_days_out ?? DEFAULT_PICKUP_LADDER[index]?.min_days_out ?? 0),
    max_days_out: raw?.max_days_out === null || raw?.max_days_out === undefined
      ? (DEFAULT_PICKUP_LADDER[index]?.max_days_out ?? null)
      : Number(raw.max_days_out),
    one: Number(raw?.one ?? 0),
    two: Number(raw?.two ?? 0),
    three_plus: Number(raw?.three_plus ?? 0),
    max_per_day: Number(raw?.max_per_day ?? 0),
  }));
}

export interface NumberSetting {
  kind: "number";
  field: string;
  label: string;
  help: string;
  min: number;
  max: number;
  step?: number;
  unit?: "money" | "hours" | "minutes" | "percent" | "days";
}

export interface BooleanSetting {
  kind: "boolean";
  field: string;
  label: string;
  help: string;
}

/** Edits the ladder row that covers the stay date the user is looking at. */
export interface LadderSetting {
  kind: "ladder";
  field: "pickup_increase_ladder";
  label: string;
  help: string;
}

export type ReasonSetting = NumberSetting | BooleanSetting | LadderSetting;

export interface ReasonInfo {
  /** Human title for the reason code. */
  title: string;
  /** One sentence a non-technical manager understands. */
  explain: string;
  /** Fields that decide this behaviour; empty when nothing is configurable. */
  settings: ReasonSetting[];
  /** Shown when there is nothing to change. */
  note?: string;
}

const ladder: LadderSetting = {
  kind: "ladder",
  field: "pickup_increase_ladder",
  label: "Pickup surcharge for this lead time",
  help: "How much a new booking lifts the price for a stay date this far away.",
};

const raiseOnAnyPickup: BooleanSetting = {
  kind: "boolean",
  field: "raise_on_any_pickup",
  label: "Any new booking raises the price",
  help: "When on, even a single genuine booking always produces an increase.",
};

const strongOccupancy: NumberSetting = {
  kind: "number",
  field: "high_occupancy_pct",
  label: "Strong demand starts at",
  help: "At or above this occupancy the pickup surcharge is increased by half.",
  min: 50, max: 100, unit: "percent",
};

export const REASON_SETTINGS: Record<string, ReasonInfo> = {
  genuine_pickup: {
    title: "New booking — price raised",
    explain: "A genuine new reservation arrived for this date, so the price went up by the surcharge set for this lead time.",
    settings: [ladder, strongOccupancy, raiseOnAnyPickup],
  },
  "genuine_pickup+event": {
    title: "New booking and an event",
    explain: "A new reservation arrived and a confirmed event added its one-off uplift on top.",
    settings: [ladder, strongOccupancy],
  },
  single_pickup_hold: {
    title: "One booking was not enough",
    explain: "A single booking was ignored because occupancy was still low. Turn on 'any new booking raises the price' to stop that happening.",
    settings: [raiseOnAnyPickup, ladder],
  },
  daily_budget_spent: {
    title: "Daily movement allowance used up",
    explain: "This date had already moved as much as it is allowed to move in one day.",
    settings: [ladder],
  },
  below_min_movement: {
    title: "The change was too small to send",
    explain: "The calculated move was under the smallest change worth publishing, so nothing was sent.",
    settings: [{
      kind: "number", field: "min_movement_eur", label: "Smallest change worth sending",
      help: "Moves under this amount are skipped.", min: 1, max: 50, unit: "money",
    }],
  },
  direction_cooldown: {
    title: "Direction change is on cooldown",
    explain: "The price moved the other way recently, and a date must wait before turning around.",
    settings: [{
      kind: "number", field: "direction_change_hours", label: "Wait before changing direction",
      help: "Hours a date must wait before reversing an up or down move.", min: 0, max: 72, unit: "hours",
    }],
  },
  cancellation_cooldown: {
    title: "Waiting after a cancellation",
    explain: "A cancellation just landed, and the engine waits before cutting the price in case the room resells.",
    settings: [{
      kind: "number", field: "cancellation_wait_minutes", label: "Wait after a cancellation",
      help: "Minutes to wait after a cancellation before a markdown is allowed.", min: 0, max: 1440, unit: "minutes",
    }],
  },
  manual_hold: {
    title: "A manual price is protected",
    explain: "Someone changed this price by hand recently, so automation stands back — although genuine new pickup may still raise it.",
    settings: [{
      kind: "number", field: "manual_markdown_hold_hours", label: "Protect manual prices for",
      help: "Hours a hand-set price is protected from automatic markdowns.", min: 0, max: 168, unit: "hours",
    }],
  },
  sold_out: {
    title: "The date is sold out",
    explain: "The date counts as sold out, so its closing price is frozen.",
    settings: [{
      kind: "number", field: "sold_out_occupancy_pct", label: "Counts as sold out at",
      help: "Occupancy at or above this level freezes the price.", min: 80, max: 100, unit: "percent",
    }],
  },
  fill_markdown: {
    title: "Filling the date",
    explain: "The date is behind pace inside the fill window, so the price stepped down to win bookings.",
    settings: [
      { kind: "boolean", field: "fill_mode_enabled", label: "Fill mode", help: "Push sales harder inside the selling window." },
      { kind: "number", field: "fill_window_days", label: "Fill window", help: "Days before arrival where fill mode applies.", min: 0, max: 365, unit: "days" },
      { kind: "number", field: "fill_max_total_drop_pct", label: "Most a date may fall", help: "Total drop allowed against the campaign starting price.", min: 0, max: 50, unit: "percent" },
    ],
  },
  on_pace: {
    title: "On pace — no markdown needed",
    explain: "The date is selling as expected for this lead time, so the price held.",
    settings: [
      { kind: "boolean", field: "fill_mode_enabled", label: "Fill mode", help: "Turning this on reacts to a smaller shortfall." },
      { kind: "number", field: "fill_window_days", label: "Fill window", help: "Days before arrival where fill mode applies.", min: 0, max: 365, unit: "days" },
    ],
    note: "Pace targets themselves are set per lead time in the pace target table.",
  },
  occupancy_protected: {
    title: "Selling well — price protected",
    explain: "Occupancy is high enough that the engine refuses to discount this date.",
    settings: [],
    note: "This threshold belongs to the lead-time window rules for the property.",
  },
  awaiting_no_pickup_window: {
    title: "Still waiting for the quiet period",
    explain: "The engine waits a set number of quiet hours before it marks a date down; that wait has not elapsed.",
    settings: [],
    note: "The quiet-period length is part of the lead-time window rules.",
  },
  decrease_frequency: {
    title: "Lowered too recently",
    explain: "This date was already lowered, and its window requires a gap before the next cut.",
    settings: [],
    note: "The gap between markdowns is part of the lead-time window rules.",
  },
  far_out_no_markdown: {
    title: "Too far out to discount",
    explain: "Long-lead dates are never marked down just because no booking arrived today.",
    settings: [],
  },
  bounds_headroom: {
    title: "A room type is at its limit",
    explain: "One room type had reached its price floor or ceiling, so the whole day stayed put to keep every price moving together.",
    settings: [],
    note: "Floors and ceilings are set per room type in the price floors table.",
  },
  low_inventory: {
    title: "Very few rooms left",
    explain: "Too few rooms remain to justify discounting the date.",
    settings: [],
  },
  at_anchor: {
    title: "Already at the seasonal anchor",
    explain: "The price is already at or below the validated anchor for this date, so it cannot fall further.",
    settings: [],
  },
  manual_lock: {
    title: "Locked by a manager",
    explain: "A manager locked this date; automation leaves it completely alone.",
    settings: [],
  },
  stale_data: { title: "The PMS feed is stale", explain: "Occupancy data for this date could not be trusted, so nothing moved.", settings: [] },
  no_price: { title: "No price on file", explain: "There is no current price for this date to move.", settings: [] },
  no_occupancy: { title: "No occupancy reading", explain: "Occupancy for this date is unknown, so no decision could be made.", settings: [] },
  no_pace_data: { title: "No pace target", explain: "No pace target covers this lead time, so the engine held the price.", settings: [] },
  bounds_missing: { title: "No price limits", explain: "This date has no resolvable minimum and maximum price.", settings: [] },
  bounds_invalid: { title: "Price limits conflict", explain: "The maximum price for this date is below its minimum.", settings: [] },

  // --- ADR-first rules -------------------------------------------------------
  net_adr_floor: {
    title: "Lifted to protect the average rate",
    explain:
      "This date was loaded below the price the hotel must ask to actually bank its minimum average rate once channel discounts are taken off, so it was lifted.",
    settings: [
      { kind: "number", field: "minimum_adr", label: "Minimum average rate", help: "The lowest average rate the property accepts, in realised money.", min: 0, max: 1000, unit: "money" },
      { kind: "boolean", field: "net_rate_factor_enabled", label: "Adjust for channel discounts", help: "Measures how far realised rates fall below loaded prices and raises the floors to match." },
      { kind: "number", field: "net_rate_factor_override", label: "Discount factor override", help: "Realised ÷ loaded price. Leave empty to let the engine measure it.", min: 0.6, max: 1, step: 0.01 },
    ],
  },
  occupancy_lift: {
    title: "Selling well — price raised",
    explain:
      "Occupancy for this date is already strong for how far away it is, so the price went up on the strength of demand alone, without waiting for another booking.",
    settings: [
      { kind: "boolean", field: "occupancy_lift_enabled", label: "Occupancy-led increases", help: "Raise well-selling dates even when no new booking arrived in this run." },
      { kind: "number", field: "high_occupancy_pct", label: "Strong demand starts at", help: "Occupancy at or above this counts as strong demand.", min: 50, max: 100, unit: "percent" },
    ],
    note: "The size of each lift is set in the occupancy lift ladder on the rules screen.",
  },
  month_adr_pace: {
    title: "The month is behind its rate target",
    explain:
      "This stay month is running under its average-rate goal, so discounting is frozen for the whole month until it catches up. Only new bookings and strong occupancy can move these dates.",
    settings: [
      { kind: "boolean", field: "month_pace_guard_enabled", label: "Month-end rate guard", help: "Freeze markdowns in any month running below its average-rate target." },
      { kind: "number", field: "adr_target_eur", label: "Average rate target", help: "The rate the property aims to land each month on.", min: 0, max: 1000, unit: "money" },
    ],
  },
  booked_date_brake: {
    title: "Just booked — not discounted",
    explain:
      "This date took a booking very recently. Cutting the price now invites the same guest to cancel and rebook cheaper, so the price is held.",
    settings: [
      { kind: "number", field: "booked_date_brake_hours", label: "Hold after a booking", help: "Hours a freshly booked date is protected from markdowns.", min: 0, max: 336, unit: "hours" },
    ],
  },
  rebook_window: {
    title: "Protected against cancel-and-rebook",
    explain:
      "A cancellation landed on this date recently. The room goes back on sale at the price it was sold at, never cheaper, for the rebooking window.",
    settings: [
      { kind: "number", field: "rebook_window_hours", label: "Rebooking protection", help: "Hours after a cancellation during which the date may not be marked down.", min: 0, max: 336, unit: "hours" },
    ],
  },
  markdown_limit: {
    title: "Already lowered today",
    explain: "This date has taken its allowed number of markdowns for today, so it will not step down again until tomorrow.",
    settings: [
      { kind: "number", field: "max_markdowns_per_day", label: "Markdowns per date per day", help: "How many times one date may be lowered in a single day.", min: 0, max: 10 },
    ],
  },
  one_way_day: {
    title: "It went up earlier today",
    explain: "This date already rose today, and the engine never cuts a price back on the same day it raised it.",
    settings: [],
    note: "This rule has no setting — it protects the price from moving both ways in one day.",
  },
};


export function reasonInfo(reason: string | null | undefined): ReasonInfo {
  const key = String(reason ?? "").trim();
  return REASON_SETTINGS[key] ?? {
    title: key ? key.replace(/_/g, " ") : "No change",
    explain: "This outcome is recorded by the engine and has no setting attached to it.",
    settings: [],
  };
}

/** True when the reason offers something the manager can actually change. */
export function reasonIsEditable(reason: string | null | undefined): boolean {
  return reasonInfo(reason).settings.length > 0;
}

export function daysOutFrom(stayDate: string, now = new Date()): number {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const target = Date.parse(`${stayDate}T00:00:00Z`);
  if (!Number.isFinite(target)) return 0;
  return Math.max(0, Math.round((target - start) / 86_400_000));
}
