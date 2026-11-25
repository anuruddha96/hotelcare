import { sendEmail } from "./emailSender.ts";
import { estimateAiCost } from "./aiBudget.ts";
import { budapestDate } from "./miraDates.ts";
import type { MiraUsagePolicy } from "./miraUsagePolicy.ts";

type Service = any;
type Identity = {
  userId: string; email?: string | null; firstName?: string | null;
  role?: string | null; hotelId?: string | null; organizationSlug?: string | null;
};
export type Quota = {
  allowed: boolean;
  /** Messages this Budapest month (including this one when allowed). */
  used: number;
  /** Messages in the last 24 hours. */
  usedToday: number;
  /** Monthly limit; null means none. */
  limit: number | null;
  dailyLimit: number;
  remaining: number | null;
  unlimited: boolean;
  tier: MiraUsagePolicy["tier"];
  reason?: "monthly" | "daily" | "no_access";
  duplicate?: boolean;
};

export const OWNER_EMAIL = "anuruddha.dharmasena@gmail.com";
/** The HotelCare team inbox: problem reports, outages and misuse go here too. */
export const SUPPORT_EMAIL = "info@hotelcare.app";
/** One turn this large means a context or tool loop problem worth a look. */
const HIGH_TURN_TOKENS = 120_000;
/** Estimated monthly model cost per person that the administrators hear about. */
const HIGH_MONTH_COST_USD = 15;

export type AlertKind =
  | "quota_reached" | "quota_blocked" | "high_tokens" | "monthly_tokens"
  | "heavy_use" | "abuse" | "outage";

function escapeHtml(s: unknown) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function monthBudapest() {
  return `${budapestDate().slice(0, 7)}-01`;
}

async function usageCounts(service: Service, userId: string) {
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const [month, day] = await Promise.all([
    service.from("assistant_monthly_message_usage").select("message_id", { count: "exact", head: true })
      .eq("user_id", userId).eq("month_start", monthBudapest()),
    service.from("assistant_monthly_message_usage").select("message_id", { count: "exact", head: true })
      .eq("user_id", userId).gte("created_at", since),
  ]);
  return { month: Number(month.count ?? 0), day: Number(day.count ?? 0) };
}

function quotaFrom(policy: MiraUsagePolicy, month: number, day: number, extra: Partial<Quota> = {}): Quota {
  return {
    allowed: true,
    used: month,
    usedToday: day,
    limit: policy.monthlyLimit,
    dailyLimit: policy.dailyLimit,
    remaining: policy.monthlyLimit === null ? null : Math.max(0, policy.monthlyLimit - month),
    unlimited: policy.monthlyLimit === null,
    tier: policy.tier,
    ...extra,
  };
}

/** Current usage, for the app's composer. */
export async function assistantUsageStatus(service: Service, userId: string, policy: MiraUsagePolicy): Promise<Quota> {
  const counts = await usageCounts(service, userId);
  return quotaFrom(policy, counts.month, counts.day, { allowed: policy.tier !== "none" });
}

/**
 * Reserves one message for a person (server only; verify the JWT first).
 * Insert-then-count: the primary key (user_id, message_id) catches a resent
 * message, and a message over a limit is removed again, so two tabs racing at
 * the limit can only both be refused, never both pass.
 */
export async function reserveAssistantMessage(
  service: Service, actor: Identity, messageId: string, policy: MiraUsagePolicy,
): Promise<Quota> {
  if (!/^[a-zA-Z0-9_-]{5,128}$/.test(messageId)) throw new Error("Invalid assistant message identifier");
  if (policy.tier === "none") return quotaFrom(policy, 0, 0, { allowed: false, reason: "no_access", remaining: 0 });

  const { error: insertError } = await service.from("assistant_monthly_message_usage").insert({
    user_id: actor.userId, message_id: messageId, month_start: monthBudapest(),
    organization_slug: actor.organizationSlug ?? null,
  });
  if (insertError) {
    if (String(insertError.code) === "23505") {
      const counts = await usageCounts(service, actor.userId);
      return quotaFrom(policy, counts.month, counts.day, { duplicate: true });
    }
    throw new Error(`Message allowance unavailable: ${insertError.message ?? "insert failed"}`);
  }

  const counts = await usageCounts(service, actor.userId);
  const overDay = counts.day > policy.dailyLimit;
  const overMonth = policy.monthlyLimit !== null && counts.month > policy.monthlyLimit;
  if (overDay || overMonth) {
    await service.from("assistant_monthly_message_usage").delete()
      .eq("user_id", actor.userId).eq("message_id", messageId);
    if (overDay) {
      await notifyAssistantAlert(service, actor, "quota_blocked",
        `Daily safety limit reached: ${policy.dailyLimit} messages in 24 hours (${policy.tier} tier). New messages are paused until the 24-hour window moves on. This is unusual for a person typing; check for a stuck device or misuse.`,
        { period: "day" });
    } else {
      await notifyAssistantAlert(service, actor, "quota_reached",
        `Monthly allowance used: ${policy.monthlyLimit} messages (${policy.tier} tier). New messages are blocked until the 1st. Add the person to the unlimited list if they need more.`);
    }
    return quotaFrom(policy, counts.month - 1, counts.day - 1, {
      allowed: false, reason: overDay ? "daily" : "monthly", remaining: 0,
    });
  }

  // Heavy use is reported, never blocked (owner's rule for leadership roles).
  if (counts.day >= policy.heavyDailyAlert) {
    await notifyAssistantAlert(service, actor, "heavy_use",
      `Heavy use today: ${counts.day} Mira messages in the last 24 hours (${policy.tier} tier; daily safety limit ${policy.dailyLimit}).`,
      { period: "day" });
  }
  if (counts.month >= policy.heavyMonthlyAlert) {
    await notifyAssistantAlert(service, actor, "heavy_use",
      `Heavy use this month: ${counts.month} Mira messages so far (${policy.tier} tier${policy.monthlyLimit ? `; limit ${policy.monthlyLimit}` : "; no monthly limit"}).`);
  }
  return quotaFrom(policy, counts.month, counts.day);
}

export async function refundMonthlyMessage(service: Service, userId: string, messageId: string) {
  const { error } = await service.from("assistant_monthly_message_usage").delete()
    .eq("user_id", userId).eq("message_id", messageId)
    .eq("input_tokens", 0).eq("output_tokens", 0);
  if (error) console.error("assistant monthly refund failed", error.message);
}

/** Detect expensive turns and accumulated per-user spend before the month ends. */
export async function recordAssistantTokenUsage(
  service: Service, actor: Identity, messageId: string, model: string,
  inputTokens: number, outputTokens: number,
) {
  const input = Math.max(0, Math.floor(Number(inputTokens) || 0));
  const output = Math.max(0, Math.floor(Number(outputTokens) || 0));
  const cost = estimateAiCost({ model, inputTokens: input, outputTokens: output });
  const { error } = await service.from("assistant_monthly_message_usage")
    .update({ input_tokens: input, output_tokens: output, estimated_cost_usd: cost })
    .eq("user_id", actor.userId).eq("message_id", messageId);
  if (error) {
    console.error("Assistant token recording failed", error.message);
    return;
  }
  const { data: usage } = await service.from("assistant_monthly_message_usage")
    .select("input_tokens,output_tokens,estimated_cost_usd")
    .eq("user_id", actor.userId).eq("month_start", monthBudapest()).limit(5000);
  const monthlyTokens = (usage ?? []).reduce((n: number, r: any) =>
    n + (Number(r.input_tokens) || 0) + (Number(r.output_tokens) || 0), 0);
  const monthlyUsd = (usage ?? []).reduce((n: number, r: any) =>
    n + (Number(r.estimated_cost_usd) || 0), 0);
  if (input + output >= HIGH_TURN_TOKENS) {
    await notifyAssistantAlert(service, actor, "high_tokens",
      `A single request used ${input.toLocaleString()} input and ${output.toLocaleString()} output tokens; estimated cost $${cost.toFixed(4)}. Review context size and tool call behavior.`);
  }
  if (monthlyUsd >= HIGH_MONTH_COST_USD) {
    await notifyAssistantAlert(service, actor, "monthly_tokens",
      `Usage cost warning: about $${monthlyUsd.toFixed(2)} of model usage this month (${monthlyTokens.toLocaleString()} tokens).`);
  }
}

async function recipientsFor(service: Service, organizationSlug: string | null | undefined, alsoSupport: boolean) {
  const { data: admins } = await service.from("profiles")
    .select("email").eq("organization_slug", organizationSlug ?? "")
    .eq("role", "admin").is("deleted_at", null).limit(50);
  return [...new Set([
    ...(alsoSupport ? [SUPPORT_EMAIL] : []),
    OWNER_EMAIL,
    ...(admins ?? []).map((r: any) => String(r.email ?? "").trim()),
  ].filter(Boolean))] as string[];
}

const ALERT_TITLE: Record<AlertKind, string> = {
  quota_reached: "monthly allowance used",
  quota_blocked: "daily safety limit reached",
  high_tokens: "very large request",
  monthly_tokens: "usage cost warning",
  heavy_use: "heavy use",
  abuse: "possible misuse",
  outage: "Mira could not answer (service problem)",
};

/**
 * One e-mail per person, kind and period: the database's unique key on
 * (user, period start, kind) turns concurrent tabs and repeats into one alert.
 * Day-level alerts store the day as the period start.
 */
export async function notifyAssistantAlert(
  service: Service, actor: Identity, kind: AlertKind, message: string,
  opts: { period?: "month" | "day"; alsoSupport?: boolean; details?: [string, string][] } = {},
): Promise<boolean> {
  const periodStart = opts.period === "day" ? budapestDate() : monthBudapest();
  const { data: event, error } = await service.from("assistant_usage_alert_events").insert({
    user_id: actor.userId, organization_slug: actor.organizationSlug,
    month_start: periodStart, alert_type: kind, message: message.slice(0, 2000),
  }).select("id").maybeSingle();
  if (error || !event) return false; // duplicate or missing migration; never flood e-mail
  const alsoSupport = opts.alsoSupport ?? (kind === "abuse" || kind === "outage");
  const to = await recipientsFor(service, actor.organizationSlug, alsoSupport);
  const subject = `HotelCare · Mira alert: ${ALERT_TITLE[kind]}`;
  const rows: [string, string][] = [
    ["User", actor.firstName || "Unknown"], ["Email", actor.email || "Unavailable"],
    ["User ID", actor.userId], ["Role", actor.role || "Unknown"],
    ["Hotel", actor.hotelId || "Not selected"], ["Organization", actor.organizationSlug || "Unknown"],
    ["Alert", message], ["Period", periodStart],
    ...(opts.details ?? []),
  ];
  const html = `<h2>${escapeHtml(subject)}</h2><table cellpadding="6" style="font:14px/1.5 system-ui,sans-serif;border-collapse:collapse">${rows.map(([k, v]) =>
    `<tr><th style="text-align:left;vertical-align:top">${escapeHtml(k)}</th><td style="white-space:pre-wrap">${escapeHtml(v)}</td></tr>`).join("")}</table>`;
  try {
    const sent = await sendEmail({ admin: service, organizationSlug: actor.organizationSlug,
      to, subject, html, text: rows.map(([k, v]) => `${k}: ${v}`).join("\n") });
    if (sent.ok) {
      await service.from("assistant_usage_alert_events")
        .update({ emailed_at: new Date().toISOString() }).eq("id", event.id);
      return true;
    }
    console.error("HotelCare assistant alert email not delivered", sent.error);
  } catch (error) { console.error("HotelCare assistant alert email failed", error); }
  return false;
}

/**
 * Mira could not answer because a model provider or the system failed.
 * At most one e-mail per organization every 30 minutes, whoever hit it.
 */
export async function notifyMiraOutage(
  service: Service, actor: Identity, details: { stage: string; error: string; threadId?: string | null; question?: string | null },
) {
  try {
    const since = new Date(Date.now() - 30 * 60_000).toISOString();
    const { count } = await service.from("assistant_usage_alert_events")
      .select("id", { count: "exact", head: true })
      .eq("alert_type", "outage").eq("organization_slug", actor.organizationSlug ?? "")
      .gte("created_at", since);
    if ((count ?? 0) > 0) return;
    const error = String(details.error ?? "").replace(/Bearer\s+[\w.-]+/gi, "Bearer [redacted]")
      .replace(/sk-[\w-]{10,}/g, "sk-[redacted]").slice(0, 900);
    await notifyAssistantAlert(service, actor, "outage",
      `Mira could not answer a question (${details.stage}). The person saw an error and could retry or report it.`,
      {
        period: "day",
        alsoSupport: true,
        details: [
          ["Technical error", error || "Not provided"],
          ["Conversation ID", details.threadId ?? "None"],
          ["Question (first 300 characters)", String(details.question ?? "").slice(0, 300) || "—"],
          ["Time (UTC)", new Date().toISOString()],
        ],
      });
  } catch (e) {
    console.error("Mira outage alert failed", e);
  }
}

/** Declined or refused questions in the last 24 hours (scope, misuse). */
export async function countRecentRefusals(service: Service, userId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { count } = await service.from("assistant_audit_log").select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("refused", true).gte("created_at", since);
  return Number(count ?? 0);
}
