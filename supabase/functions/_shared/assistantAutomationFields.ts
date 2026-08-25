// Allowlist of revenue automation rule fields the Hotel Care Assistant may
// propose changes to, with safe ranges. Shared by `assistant-chat` (which only
// proposes a diff) and `assistant-apply-automation-change` (which writes it
// after the user confirms). Anything not listed here can never be written by
// the assistant.

export type FieldSpec =
  | { kind: "boolean"; label: string }
  | { kind: "number"; label: string; min: number; max: number; integer?: boolean };

export const AUTOMATION_FIELDS: Record<string, FieldSpec> = {
  is_enabled: { kind: "boolean", label: "Automation enabled" },
  auto_publish: { kind: "boolean", label: "Publish changes automatically" },

  // Pickup driven increases
  positive_pickup_enabled: { kind: "boolean", label: "React to positive pickup" },
  pickup_lookback_hours: { kind: "number", label: "Pickup lookback (hours)", min: 1, max: 168, integer: true },
  second_pickup_surcharge: { kind: "number", label: "Second pickup surcharge", min: 0, max: 200 },
  maximum_increase: { kind: "number", label: "Max increase per action", min: 0, max: 500 },
  max_daily_increase_per_date: { kind: "number", label: "Max increase per date per day", min: 0, max: 1000 },
  strong_demand_increase: { kind: "number", label: "Strong demand increase", min: 0, max: 500 },

  // Markdown / no pickup
  no_pickup_enabled: { kind: "boolean", label: "Mark down when there is no pickup" },
  no_pickup_lookback_hours: { kind: "number", label: "No-pickup lookback (hours)", min: 1, max: 336, integer: true },
  no_pickup_decrease: { kind: "number", label: "No-pickup markdown step", min: 0, max: 200 },
  max_daily_decrease_per_date: { kind: "number", label: "Max markdown per date per day", min: 0, max: 1000 },
  minimum_adr: { kind: "number", label: "Minimum ADR floor", min: 0, max: 5000 },
  manual_markdown_hold_hours: { kind: "number", label: "Hold after a manual price (hours)", min: 0, max: 168, integer: true },

  // Occupancy guards
  protect_high_occupancy: { kind: "boolean", label: "Protect high occupancy dates" },
  markdown_max_occupancy_pct: { kind: "number", label: "Stop markdown above occupancy %", min: 0, max: 100 },
  low_occupancy_pct: { kind: "number", label: "Low occupancy threshold %", min: 0, max: 100 },
  high_occupancy_pct: { kind: "number", label: "High occupancy threshold %", min: 0, max: 100 },
  sold_out_guard_enabled: { kind: "boolean", label: "Sold-out guard" },
  sold_out_occupancy_pct: { kind: "number", label: "Sold-out occupancy %", min: 0, max: 100 },
  short_window_guard_enabled: { kind: "boolean", label: "Short-window guard" },
  short_window_days: { kind: "number", label: "Short window (days)", min: 0, max: 60, integer: true },
  short_window_min_occupancy_pct: { kind: "number", label: "Short window min occupancy %", min: 0, max: 100 },

  // Lead time shaping
  smart_pricing_enabled: { kind: "boolean", label: "Smart lead-time pricing" },
  lead_bands_enabled: { kind: "boolean", label: "Lead-time bands" },
  near_term_days: { kind: "number", label: "Near-term window (days)", min: 0, max: 120, integer: true },
  long_lead_days: { kind: "number", label: "Long-lead window (days)", min: 0, max: 365, integer: true },
  immediate_window_days: { kind: "number", label: "Immediate window (days)", min: 0, max: 30, integer: true },
  immediate_markdown_step: { kind: "number", label: "Immediate markdown step", min: 0, max: 200 },
  immediate_sell_mode_enabled: { kind: "boolean", label: "Immediate sell mode" },

  // Far out
  far_out_enabled: { kind: "boolean", label: "Far-out surcharge" },
  far_out_days: { kind: "number", label: "Far-out threshold (days)", min: 0, max: 365, integer: true },
  far_out_surcharge: { kind: "number", label: "Far-out surcharge", min: 0, max: 500 },
  far_out_floor_topup_enabled: { kind: "boolean", label: "Far-out floor top-up" },
  far_out_floor_topup_days: { kind: "number", label: "Far-out top-up threshold (days)", min: 0, max: 365, integer: true },
  far_out_floor_topup_threshold: { kind: "number", label: "Far-out top-up price floor", min: 0, max: 5000 },
  far_out_floor_topup_amount: { kind: "number", label: "Far-out top-up amount", min: 0, max: 500 },

  // Demand signals
  spike_detection_enabled: { kind: "boolean", label: "Booking spike detection" },
  spike_threshold_pct: { kind: "number", label: "Spike threshold %", min: 0, max: 500 },
  spike_lookback_days: { kind: "number", label: "Spike lookback (days)", min: 1, max: 90, integer: true },
  event_surcharge_eur: { kind: "number", label: "Event surcharge", min: 0, max: 500 },
  event_surcharge_auto: { kind: "boolean", label: "Apply event surcharge automatically" },

  // Cancellations & cadence
  cancellation_markdown_enabled: { kind: "boolean", label: "Mark down after cancellations" },
  cancellation_wait_minutes: { kind: "number", label: "Cancellation wait (minutes)", min: 0, max: 1440, integer: true },
  evaluation_interval_minutes: { kind: "number", label: "Evaluation interval (minutes)", min: 15, max: 1440, integer: true },
  future_booking_window_days: { kind: "number", label: "Horizon handled (days)", min: 1, max: 365, integer: true },
  whole_number_prices: { kind: "boolean", label: "Whole-number prices" },
};

export type ValidatedChange = { field: string; label: string; value: boolean | number };

/**
 * Validate a proposed set of field changes against the allowlist. Unknown
 * fields and out-of-range values are rejected rather than silently clamped, so
 * the model gets told what it did wrong.
 */
export function validateChanges(
  input: unknown,
): { ok: true; changes: ValidatedChange[] } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "changes must be an object of field -> value" };
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) return { ok: false, error: "No fields to change" };
  if (entries.length > 20) return { ok: false, error: "Too many fields in one change (max 20)" };

  const changes: ValidatedChange[] = [];
  for (const [field, raw] of entries) {
    const spec = AUTOMATION_FIELDS[field];
    if (!spec) {
      return {
        ok: false,
        error: `Field "${field}" cannot be changed by the assistant. Allowed fields: ${Object.keys(AUTOMATION_FIELDS).join(", ")}`,
      };
    }
    if (spec.kind === "boolean") {
      if (typeof raw !== "boolean") return { ok: false, error: `Field "${field}" must be true or false` };
      changes.push({ field, label: spec.label, value: raw });
      continue;
    }
    const value = typeof raw === "string" ? Number(raw) : raw;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, error: `Field "${field}" must be a number` };
    }
    if (value < spec.min || value > spec.max) {
      return { ok: false, error: `Field "${field}" must be between ${spec.min} and ${spec.max}` };
    }
    if (spec.integer && !Number.isInteger(value)) {
      return { ok: false, error: `Field "${field}" must be a whole number` };
    }
    changes.push({ field, label: spec.label, value });
  }
  return { ok: true, changes };
}

/** Roles allowed to change revenue automation through the assistant. */
export function canChangeAutomation(role: string | null | undefined): boolean {
  return ["admin", "manager", "top_management", "top_management_manager"].includes(role ?? "");
}
