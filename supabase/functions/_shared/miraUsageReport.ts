// Daily Mira usage report for the administrators: how much each person used
// Mira yesterday, this week and this month, what it cost, and anything that
// needs a look (heavy use, declined questions, misuse or outage alerts).
// Counts only, never the questions themselves.

export type UsageRow = { user_id: string; created_at: string; estimated_cost_usd?: number | string | null };
export type AuditRefusal = { user_id: string; created_at: string };
export type AlertRow = { user_id: string; alert_type: string; created_at: string; message?: string | null };
export type PersonRow = { id: string; full_name?: string | null; nickname?: string | null; role?: string | null; access_role?: string | null };

export type PersonUsage = {
  userId: string;
  name: string;
  role: string;
  tier: string;
  yesterday: number;
  week: number;
  month: number;
  costMonthUsd: number;
  declinedYesterday: number;
  declinedWeek: number;
  alerts: string[];
};

export type ReportWindow = { dayStart: string; dayEnd: string; weekStart: string; monthStart: string };

const ALERT_LABEL: Record<string, string> = {
  quota_reached: "monthly allowance used",
  quota_blocked: "daily safety limit",
  heavy_use: "heavy use",
  abuse: "possible misuse",
  outage: "service problem",
  high_tokens: "very large request",
  monthly_tokens: "cost warning",
};

export function aggregateUsage(input: {
  usage: UsageRow[];
  refusals: AuditRefusal[];
  alerts: AlertRow[];
  people: Map<string, PersonRow>;
  window: ReportWindow;
  describe: (person: PersonRow | undefined) => { role: string; tier: string };
}): PersonUsage[] {
  const { window } = input;
  const inDay = (iso: string) => iso >= window.dayStart && iso < window.dayEnd;
  const inWeek = (iso: string) => iso >= window.weekStart && iso < window.dayEnd;
  const inMonth = (iso: string) => iso >= window.monthStart && iso < window.dayEnd;
  const byUser = new Map<string, PersonUsage>();
  const entry = (userId: string) => {
    let row = byUser.get(userId);
    if (!row) {
      const person = input.people.get(userId);
      const { role, tier } = input.describe(person);
      row = {
        userId,
        name: String(person?.full_name || person?.nickname || "Unknown user").trim(),
        role, tier, yesterday: 0, week: 0, month: 0, costMonthUsd: 0,
        declinedYesterday: 0, declinedWeek: 0, alerts: [],
      };
      byUser.set(userId, row);
    }
    return row;
  };
  for (const u of input.usage) {
    const row = entry(u.user_id);
    if (inDay(u.created_at)) row.yesterday += 1;
    if (inWeek(u.created_at)) row.week += 1;
    if (inMonth(u.created_at)) {
      row.month += 1;
      row.costMonthUsd += Number(u.estimated_cost_usd) || 0;
    }
  }
  for (const r of input.refusals) {
    const row = entry(r.user_id);
    if (inDay(r.created_at)) row.declinedYesterday += 1;
    if (inWeek(r.created_at)) row.declinedWeek += 1;
  }
  for (const a of input.alerts) {
    if (!inDay(a.created_at)) continue;
    const label = ALERT_LABEL[a.alert_type] ?? a.alert_type.replaceAll("_", " ");
    const row = entry(a.user_id);
    if (!row.alerts.includes(label)) row.alerts.push(label);
  }
  return [...byUser.values()]
    .filter((row) => row.week > 0 || row.month > 0 || row.alerts.length > 0 || row.declinedWeek > 0)
    .sort((a, b) => b.yesterday - a.yesterday || b.week - a.week || a.name.localeCompare(b.name));
}

export function needsALook(row: PersonUsage): boolean {
  return row.alerts.length > 0 || row.declinedYesterday >= 2 || row.yesterday >= 100;
}

function esc(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function reportEmail(opts: { organization: string; day: string; rows: PersonUsage[] }) {
  const { organization, day, rows } = opts;
  const totals = rows.reduce((t, r) => ({
    yesterday: t.yesterday + r.yesterday, week: t.week + r.week, month: t.month + r.month,
    cost: t.cost + r.costMonthUsd, active: t.active + (r.yesterday > 0 ? 1 : 0),
  }), { yesterday: 0, week: 0, month: 0, cost: 0, active: 0 });
  const flagged = rows.filter(needsALook);
  const subject = `HotelCare · Mira usage ${day}: ${totals.yesterday} message${totals.yesterday === 1 ? "" : "s"} from ${totals.active} ${totals.active === 1 ? "person" : "people"}`;
  const th = "text-align:left;padding:6px 8px;border-bottom:1px solid #e5e7eb;font-weight:600";
  const td = "padding:6px 8px;border-bottom:1px solid #f1f5f9";
  const tableRows = rows.map((r) => `<tr>
    <td style="${td}">${esc(r.name)}</td><td style="${td}">${esc(r.role)}</td><td style="${td}">${esc(r.tier)}</td>
    <td style="${td};text-align:right">${r.yesterday}</td><td style="${td};text-align:right">${r.week}</td>
    <td style="${td};text-align:right">${r.month}</td><td style="${td};text-align:right">$${r.costMonthUsd.toFixed(2)}</td>
    <td style="${td};text-align:right">${r.declinedYesterday}/${r.declinedWeek}</td>
    <td style="${td}">${esc(r.alerts.join(", ") || "—")}</td></tr>`).join("");
  const flaggedHtml = flagged.length
    ? `<h3 style="margin:18px 0 6px">Needs a look</h3><ul>${flagged.map((r) =>
      `<li><b>${esc(r.name)}</b> (${esc(r.role)}): ${esc([
        r.alerts.length ? r.alerts.join(", ") : "",
        r.declinedYesterday >= 2 ? `${r.declinedYesterday} questions declined` : "",
        r.yesterday >= 100 ? `${r.yesterday} messages in one day` : "",
      ].filter(Boolean).join("; "))}</li>`).join("")}</ul>`
    : `<p style="margin:14px 0">Nothing unusual yesterday.</p>`;
  const html = `<div style="font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a">
<h2 style="margin:0 0 4px">Mira usage · ${esc(day)}</h2>
<p style="margin:0;color:#475569">${esc(organization)} · yesterday ${totals.yesterday} messages, this week ${totals.week}, this month ${totals.month} · estimated model cost this month $${totals.cost.toFixed(2)}</p>
${flaggedHtml}
<table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr>
<th style="${th}">Person</th><th style="${th}">Role</th><th style="${th}">Plan</th><th style="${th};text-align:right">Yesterday</th>
<th style="${th};text-align:right">7 days</th><th style="${th};text-align:right">Month</th><th style="${th};text-align:right">Cost (month)</th>
<th style="${th};text-align:right">Declined (day/7d)</th><th style="${th}">Alerts</th></tr></thead><tbody>${tableRows}</tbody></table>
<p style="color:#64748b;font-size:12px;margin-top:14px">Plans: Unlimited = no monthly limit, heavy use is reported (daily safety limit 300). Standard = 300 messages a month, 60 a day. Questions are not included in this report; open Mira insights in HotelCare for details.</p>
</div>`;
  const text = [
    `Mira usage ${day} — ${organization}`,
    `Yesterday ${totals.yesterday} messages, 7 days ${totals.week}, month ${totals.month}, cost this month $${totals.cost.toFixed(2)}`,
    flagged.length ? `Needs a look: ${flagged.map((r) => `${r.name} (${r.alerts.join(", ") || `${r.declinedYesterday} declined`})`).join("; ")}` : "Nothing unusual yesterday.",
    "",
    ...rows.map((r) => `${r.name} · ${r.role} · ${r.tier}: yesterday ${r.yesterday}, 7d ${r.week}, month ${r.month}, $${r.costMonthUsd.toFixed(2)}, declined ${r.declinedYesterday}/${r.declinedWeek}${r.alerts.length ? `, alerts: ${r.alerts.join(", ")}` : ""}`),
  ].join("\n");
  return { subject, html, text, totals, flagged: flagged.length };
}
