import { sendEmail } from "./emailSender.ts";
import { estimateAiCost } from "./aiBudget.ts";

type Service = any;
type Identity = {
  userId: string; email?: string | null; firstName?: string | null;
  role?: string | null; hotelId?: string | null; organizationSlug?: string | null;
};
type Quota = { allowed: boolean; used: number; limit: number | null; remaining: number | null; unlimited: boolean; duplicate?: boolean };
const OWNER_EMAIL = "anuruddha.dharmasena@gmail.com";
const HIGH_TURN_TOKENS = 8_000;
const HIGH_MONTH_TOKENS = 80_000;

function escapeHtml(s: unknown) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function monthBudapest() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest", year: "numeric", month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find(p => p.type === "year")?.value;
  const month = parts.find(p => p.type === "month")?.value;
  return `${year}-${month}-01`;
}

/** Server-only atomic slot reservation. Caller must verify the JWT first. */
export async function reserveMonthlyMessage(service: Service, actor: Identity, messageId: string): Promise<Quota> {
  if (!/^[a-zA-Z0-9_-]{5,128}$/.test(messageId))
    throw new Error("Invalid assistant message identifier");
  const { data, error } = await service.rpc("reserve_assistant_monthly_message", {
    _user_id: actor.userId, _message_id: messageId, _organization_slug: actor.organizationSlug,
  });
  if (error || !data) throw new Error(`Monthly allowance unavailable: ${error?.message ?? "no response"}`);
  const quota = data as Quota;
  if (quota.remaining === 0 || !quota.allowed) {
    await notifyAssistantAlert(service, actor, "quota_reached",
      `Monthly allowance: ${quota.used}/20 messages used. New user messages are blocked until the first day of the next Budapest-local month.`);
  }
  return quota;
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
      `A single request used ${input.toLocaleString()} input and ${output.toLocaleString()} output tokens using ${model}; estimated cost $ ${cost.toFixed(4)}. Review context size and tool call behavior.`);
  }
  if (monthlyTokens >= HIGH_MONTH_TOKENS) {
    await notifyAssistantAlert(service, actor, "monthly_tokens",
      `Early usage warning: ${monthlyTokens.toLocaleString()} tokens this month, estimated cost $${monthlyUsd.toFixed(2)}. Review the assistant history and model routing.`);
  }
}

export async function notifyAssistantAlert(
  service: Service, actor: Identity,
  kind: "quota_reached" | "high_tokens" | "monthly_tokens",
  message: string,
) {
  // Insert first with unique user/month/type constraint; concurrent tabs emit one alert.
  const { data: event, error } = await service.from("assistant_usage_alert_events").insert({
    user_id: actor.userId, organization_slug: actor.organizationSlug,
    month_start: monthBudapest(), alert_type: kind, message,
  }).select("id").maybeSingle();
  if (error || !event) return; // duplicate or missing migration; never flood e-mail
  const { data: admins } = await service.from("profiles")
    .select("email").eq("organization_slug", actor.organizationSlug ?? "")
    .eq("role", "admin").is("deleted_at", null).limit(50);
  const to = [...new Set([OWNER_EMAIL, ...(admins ?? []).map((r: any) => r.email)].filter(Boolean))] as string[];
  const subject = `HotelCare Assistant alert: ${kind.replaceAll("_", " ")}`;
  const rows = [
    ["User", actor.firstName || "Unknown"], ["Email", actor.email || "Unavailable"],
    ["User ID", actor.userId], ["Role", actor.role || "Unknown"],
    ["Hotel", actor.hotelId || "Not selected"], ["Organization", actor.organizationSlug || "Unknown"],
    ["Alert", message], ["Month", monthBudapest()],
  ];
  const html = `<h2>${escapeHtml(subject)}</h2><table>${rows.map(([k,v]) =>
    `<tr><th style="text-align:left;padding:6px">${escapeHtml(k)}</th><td style="padding:6px">${escapeHtml(v)}</td></tr>`).join("")}</table>`;
  try {
    const sent = await sendEmail({ admin: service, organizationSlug: actor.organizationSlug,
      to, subject, html, text: rows.map(([k,v]) => `${k}: ${v}`).join("\n") });
    if (sent.ok) await service.from("assistant_usage_alert_events")
      .update({ emailed_at: new Date().toISOString() }).eq("id", event.id);
    else console.error("HotelCare assistant alert email not delivered", sent.error);
  } catch (error) { console.error("HotelCare assistant alert email failed", error); }
}
