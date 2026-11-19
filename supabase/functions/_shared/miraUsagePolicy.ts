// How much each person may use Mira. Pure TypeScript, shared by the chat
// functions and the usage endpoint, covered by Deno tests.
//
// Owner's rule (19 Nov 2026):
// - Housekeepers, maintenance and breakfast staff do not get Mira at all.
// - Managers, housekeeping managers, top management, controlling, HR and
//   front office managers use it without a monthly limit. Heavy use is
//   reported to the administrators, and a high daily safety cap stops a
//   runaway script or a misused account.
// - Everyone else who has Mira gets a higher limit than before (it was 20 a
//   month), so normal work is never interrupted.

import { capabilitiesFor, type AccessSubject } from "./accessPolicy.ts";

export type MiraUsageTier = "none" | "leadership" | "standard";

export type MiraUsagePolicy = {
  tier: MiraUsageTier;
  /** Messages per Budapest month; null means no monthly limit. */
  monthlyLimit: number | null;
  /** Safety cap per rolling 24 hours. */
  dailyLimit: number;
  /** Administrators are told when a person reaches this many in a day. */
  heavyDailyAlert: number;
  /** … or this many in a month. */
  heavyMonthlyAlert: number;
};

export const LEADERSHIP_DAILY_CAP = 300;
export const STANDARD_MONTHLY_LIMIT = 300;
export const STANDARD_DAILY_LIMIT = 60;

const LEADERSHIP_ROLES = new Set(["admin", "top_management", "controlling", "hr", "manager", "housekeeping_manager"]);
/** Reception on a manager permission level runs the front office. */
const FRONT_OFFICE_MANAGER_PERMISSIONS = new Set(["manager", "reception_manager"]);

export function isFrontOfficeManager(subject: AccessSubject): boolean {
  const caps = capabilitiesFor(subject);
  return caps.accessRole === "reception" && FRONT_OFFICE_MANAGER_PERMISSIONS.has(String(subject?.role ?? ""));
}

export function miraUsagePolicyFor(subject: AccessSubject, opts: { unlimitedOverride?: boolean } = {}): MiraUsagePolicy {
  const caps = capabilitiesFor(subject);
  if (!caps.mira) {
    return { tier: "none", monthlyLimit: 0, dailyLimit: 0, heavyDailyAlert: 0, heavyMonthlyAlert: 0 };
  }
  const leadership = opts.unlimitedOverride === true ||
    subject?.is_super_admin === true ||
    LEADERSHIP_ROLES.has(caps.accessRole) ||
    isFrontOfficeManager(subject);
  if (leadership) {
    return {
      tier: "leadership",
      monthlyLimit: null,
      dailyLimit: LEADERSHIP_DAILY_CAP,
      heavyDailyAlert: 120,
      heavyMonthlyAlert: 1500,
    };
  }
  return {
    tier: "standard",
    monthlyLimit: STANDARD_MONTHLY_LIMIT,
    dailyLimit: STANDARD_DAILY_LIMIT,
    heavyDailyAlert: 45,
    heavyMonthlyAlert: 240,
  };
}

/** What the person is told when a limit stops a message. */
export function limitReachedMessage(policy: MiraUsagePolicy, reason: "monthly" | "daily" | "no_access"): string {
  if (reason === "no_access" || policy.tier === "none") return "Mira is not part of your role.";
  if (reason === "daily") {
    return `You have sent ${policy.dailyLimit} messages to Mira in the last 24 hours, which is the daily safety limit. Please try again later; your administrator has been told.`;
  }
  return `You have used your ${policy.monthlyLimit} Mira messages for this month. The allowance resets on the 1st; ask your administrator if you need more.`;
}
