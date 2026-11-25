// Allowlist of revenue automation rule fields the Hotel Care Assistant may
// propose changes to, with safe ranges. Shared by `assistant-chat` (which only
// proposes a diff) and `assistant-apply-automation-change` (which writes it
// after the user confirms). Anything not listed here can never be written by
// the assistant.
//
// Three families of field names:
//   • a plain rule column                      e.g. `minimum_adr`
//   • a pace-ratchet policy number             e.g. `policy.floor_net_eur`
//   • a stay-date tag or per-date ceiling      e.g. `tier.2026-12-31`, `ceiling.2026-12-31`
// The policy's on/off/shadow/live mode is deliberately NOT changeable here.

import { PACE_POLICY_FIELDS, resolvePaceSettings, type PaceNumericKey, type PaceSettings } from "./engineV2PaceRatchet.ts";

export const POLICY_PREFIX = "policy.";
export const TIER_PREFIX = "tier.";
export const CEILING_PREFIX = "ceiling.";

/** What a person may set a stay date to. */
export const DATE_TIER_VALUES = ["normal", "high", "peak", "dismissed", "auto"] as const;
export type DateTierValue = typeof DATE_TIER_VALUES[number];

export const DATE_CEILING_MIN_EUR = 100;
export const DATE_CEILING_MAX_EUR = 3000;
/** Stay dates may be tagged from yesterday (time zones) to this many days ahead. */
export const DATE_TAG_HORIZON_DAYS = 400;

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

export type ValidatedChange =
  | { target: "rule"; field: string; label: string; value: boolean | number }
  | { target: "policy"; field: string; label: string; value: number; key: PaceNumericKey }
  | { target: "tier"; field: string; label: string; value: DateTierValue; stayDate: string }
  | { target: "ceiling"; field: string; label: string; value: number | null; stayDate: string };

const UNIT_SUFFIX: Record<string, string> = {
  EUR: " (€)", "%": " (%)", hours: " (hours)", minutes: " (minutes)", days: " (days)",
  rooms: " (rooms)", x: " (×)", points: " (points)", hour: " (hour of day)",
};

/** Human label for one pace-policy number, with its unit. */
export function policyFieldLabel(key: PaceNumericKey): string {
  const spec = PACE_POLICY_FIELDS[key] as { label: string; unit?: string };
  return `${spec.label}${spec.unit ? UNIT_SUFFIX[spec.unit] ?? "" : ""}`;
}

/** "Thu 31 Dec 2026" for a YYYY-MM-DD stay date. */
export function stayDateLabel(stayDate: string): string {
  const d = new Date(`${stayDate}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }).format(d).replace(",", "");
}

function validStayDate(value: string, todayIso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "must be a date written YYYY-MM-DD";
  const at = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(at) || new Date(at).toISOString().slice(0, 10) !== value) return "is not a real calendar date";
  const today = Date.parse(`${todayIso}T00:00:00Z`);
  const days = Math.round((at - today) / 86_400_000);
  if (days < -1) return "is in the past";
  if (days > DATE_TAG_HORIZON_DAYS) return `is more than ${DATE_TAG_HORIZON_DAYS} days ahead`;
  return null;
}

/**
 * Validate a proposed set of field changes against the allowlist. Unknown
 * fields and out-of-range values are rejected rather than silently clamped, so
 * the model gets told what it did wrong.
 */
export function validateChanges(
  input: unknown,
  options: { today?: string } = {},
): { ok: true; changes: ValidatedChange[] } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "changes must be an object of field -> value" };
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) return { ok: false, error: "No fields to change" };
  if (entries.length > 40) return { ok: false, error: "Too many fields in one change (max 40)" };
  const todayIso = options.today && /^\d{4}-\d{2}-\d{2}$/.test(options.today)
    ? options.today
    : new Date().toISOString().slice(0, 10);

  const changes: ValidatedChange[] = [];
  for (const [field, raw] of entries) {
    if (field.startsWith(POLICY_PREFIX)) {
      const key = field.slice(POLICY_PREFIX.length);
      if (!Object.prototype.hasOwnProperty.call(PACE_POLICY_FIELDS, key)) {
        return {
          ok: false,
          error: `"${field}" is not a pricing-policy setting. Read get_automation_rules for the settings that exist; the policy mode (off, shadow, live) cannot be changed from chat.`,
        };
      }
      const spec = PACE_POLICY_FIELDS[key as PaceNumericKey] as { min: number; max: number; integer?: boolean };
      const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return { ok: false, error: `Field "${field}" must be a number` };
      }
      if (value < spec.min || value > spec.max) {
        return { ok: false, error: `Field "${field}" must be between ${spec.min} and ${spec.max}` };
      }
      if (spec.integer && !Number.isInteger(value)) {
        return { ok: false, error: `Field "${field}" must be a whole number` };
      }
      changes.push({
        target: "policy", field, key: key as PaceNumericKey,
        label: policyFieldLabel(key as PaceNumericKey), value: Math.round(value * 1000) / 1000,
      });
      continue;
    }
    if (field.startsWith(TIER_PREFIX)) {
      const stayDate = field.slice(TIER_PREFIX.length);
      const problem = validStayDate(stayDate, todayIso);
      if (problem) return { ok: false, error: `Field "${field}": the date ${problem}` };
      const typed = typeof raw === "string" ? raw.trim().toLowerCase() : "";
      const value = typed === "automatic" ? "auto" : typed === "dismiss" ? "dismissed" : typed;
      if (!(DATE_TIER_VALUES as readonly string[]).includes(value)) {
        return { ok: false, error: `Field "${field}" must be one of: ${DATE_TIER_VALUES.join(", ")}` };
      }
      changes.push({ target: "tier", field, stayDate, label: `Date tier — ${stayDateLabel(stayDate)}`, value: value as DateTierValue });
      continue;
    }
    if (field.startsWith(CEILING_PREFIX)) {
      const stayDate = field.slice(CEILING_PREFIX.length);
      const problem = validStayDate(stayDate, todayIso);
      if (problem) return { ok: false, error: `Field "${field}": the date ${problem}` };
      if (raw === null) {
        changes.push({ target: "ceiling", field, stayDate, label: `Highest price — ${stayDateLabel(stayDate)} (€)`, value: null });
        continue;
      }
      const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
      if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
        return { ok: false, error: `Field "${field}" must be a whole number of euros, or null to remove it` };
      }
      if (value < DATE_CEILING_MIN_EUR || value > DATE_CEILING_MAX_EUR) {
        return { ok: false, error: `Field "${field}" must be between ${DATE_CEILING_MIN_EUR} and ${DATE_CEILING_MAX_EUR}` };
      }
      changes.push({ target: "ceiling", field, stayDate, label: `Highest price — ${stayDateLabel(stayDate)} (€)`, value });
      continue;
    }
    const spec = AUTOMATION_FIELDS[field];
    if (!spec) {
      return {
        ok: false,
        error: `Field "${field}" cannot be changed by the assistant. Allowed fields: ${Object.keys(AUTOMATION_FIELDS).join(", ")}, policy.<setting>, tier.<YYYY-MM-DD>, ceiling.<YYYY-MM-DD>`,
      };
    }
    if (spec.kind === "boolean") {
      if (typeof raw !== "boolean") return { ok: false, error: `Field "${field}" must be true or false` };
      changes.push({ target: "rule", field, label: spec.label, value: raw });
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
    changes.push({ target: "rule", field, label: spec.label, value });
  }
  return { ok: true, changes };
}

/**
 * Merge policy numbers into the saved policy JSON and read the result back the
 * way the pricing engine will. A value the engine would adjust (for example a
 * smallest raise above the largest raise) is reported instead of saved, so
 * what a person approves is exactly what runs.
 */
export function mergePolicyChanges(
  savedPolicy: unknown,
  changes: ValidatedChange[],
): { next: Record<string, unknown>; before: PaceSettings; after: PaceSettings; adjusted: string[] } {
  const base = savedPolicy && typeof savedPolicy === "object" && !Array.isArray(savedPolicy)
    ? { ...(savedPolicy as Record<string, unknown>) }
    : {};
  const before = resolvePaceSettings(base);
  const next = { ...base };
  for (const change of changes) if (change.target === "policy") next[change.key] = change.value;
  const after = resolvePaceSettings(next);
  const adjusted: string[] = [];
  const requested = new Set<string>();
  for (const change of changes) {
    if (change.target !== "policy") continue;
    requested.add(change.key);
    if (Math.abs(after[change.key] - change.value) > 1e-9) {
      adjusted.push(`${change.field} would be read as ${after[change.key]}, not ${change.value}, because it conflicts with another setting`);
    }
  }
  // Some settings are tied together (a tier's largest raise is never under its
  // smallest; the Peak ceiling is never under the ordinary one). A change that
  // would drag another setting along must name that setting too.
  if (requested.size > 0) {
    for (const key of Object.keys(PACE_POLICY_FIELDS) as PaceNumericKey[]) {
      if (requested.has(key)) continue;
      if (Math.abs(after[key] - before[key]) > 1e-9) {
        adjusted.push(`${POLICY_PREFIX}${key} would also move from ${before[key]} to ${after[key]}; include it in the same change`);
      }
    }
  }
  return { next, before, after, adjusted };
}

/** How a stay date's current tag reads in a before/after card. */
export function describeDateTier(row: { tier?: string | null; status?: string | null } | null | undefined): string {
  if (!row || !row.tier) return "automatic";
  if (row.status === "dismissed") return "dismissed";
  if (row.status === "needs_review") return `${row.tier} candidate (awaiting review)`;
  return String(row.tier);
}

/** Roles allowed to change revenue automation through the assistant. */
export function canChangeAutomation(role: string | null | undefined): boolean {
  return ["admin", "manager", "top_management", "top_management_manager"].includes(role ?? "");
}
