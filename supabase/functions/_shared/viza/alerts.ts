/**
 * VIZA problem tracking and the 1-hour alert to HotelCare support.
 *
 * Guide v700 §4: when the THF reports WARNING or ERROR "the operator must be
 * notified". HotelCare also tells its own support when the THF cannot be
 * reached, or a rejected guest report is not corrected, for more than an hour.
 * Pure functions only, so the decisions can be tested without Deno or a database.
 */

export type ProblemKind = "unreachable" | "thf_warning" | "thf_error" | "no_certificate";

/** Minutes a problem may last before HotelCare support is e-mailed. */
export const ALERT_AFTER_MINUTES = 60;

/** HotelCare's support inbox: the end point for VIZA alerts. */
export const SUPPORT_INBOX = "info@hotelcare.app";

/** The THF status code (allapotKod, e.g. "WARNING|VIZA-OFFLINE") as a problem, or null when all is well. */
export function problemFromStatus(code: string | null | undefined): ProblemKind | null {
  const first = String(code ?? "").split("|")[0].trim().toUpperCase();
  if (first === "OK") return null;
  if (first === "WARNING") return "thf_warning";
  if (first === "ERROR") return "thf_error";
  return "unreachable"; // no status code at all: the call did not get through
}

export interface ProblemState {
  problem_since: string | null;
  problem_kind: ProblemKind | null;
  problem_alert_sent_at: string | null;
}

export interface ProblemDecision {
  /** Columns to write now (problem_alert_sent_at is written only after the e-mail went out). */
  next: { problem_since: string | null; problem_kind: ProblemKind | null };
  /** The problem has lasted long enough and support has not been told yet. */
  sendAlert: boolean;
  /** The problem is over and support had been told: send the short "resolved" note. */
  sendResolved: boolean;
  /** Clear problem_alert_sent_at (the problem is over). */
  clearAlert: boolean;
}

export function decideProblem(prev: ProblemState, kind: ProblemKind | null, now: Date): ProblemDecision {
  if (!kind) {
    return {
      next: { problem_since: null, problem_kind: null },
      sendAlert: false,
      sendResolved: !!prev.problem_since && !!prev.problem_alert_sent_at,
      clearAlert: !!prev.problem_alert_sent_at,
    };
  }
  // A problem that changes kind (e.g. unreachable, then WARNING) is still the same incident.
  const since = prev.problem_since ?? now.toISOString();
  const lastedMinutes = (now.getTime() - Date.parse(since)) / 60_000;
  return {
    next: { problem_since: since, problem_kind: kind },
    sendAlert: !prev.problem_alert_sent_at && lastedMinutes >= ALERT_AFTER_MINUTES,
    sendResolved: false,
    clearAlert: false,
  };
}

/** Rejected guest reports older than this have waited an hour for a correction. */
export function correctionCutoff(now: Date): string {
  return new Date(now.getTime() - ALERT_AFTER_MINUTES * 60_000).toISOString();
}

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** "25 Nov 2026, 15:54" in Budapest time. */
export function budapestTime(iso: string | Date): string {
  const date = iso instanceof Date ? iso : new Date(iso);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Budapest", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date);
}

const problemText: Record<ProblemKind, { title: string; meaning: string }> = {
  unreachable: {
    title: "HotelCare cannot reach the VIZA server (THF)",
    meaning: "Guest reports are kept in HotelCare and go out automatically as soon as the THF answers again. Reception works as usual.",
  },
  thf_warning: {
    title: "The VIZA server (THF) reports a WARNING",
    meaning: "The THF still accepts guest reports but has a problem forwarding them (see the status code). The VIZA guide asks the operator to look into it.",
  },
  thf_error: {
    title: "The VIZA server (THF) reports an ERROR",
    meaning: "The THF refuses guest reports until the problem is fixed (see the status code). The VIZA guide asks the operator to act.",
  },
  no_certificate: {
    title: "No NTAK certificate is installed for this hotel",
    meaning: "HotelCare cannot sign VIZA messages until the hotel's NTAK certificate is installed.",
  },
};

function frame(title: string, intro: string, rows: [string, string][], footer: string) {
  const table = rows.map(([k, v]) => `<tr><td style="padding:5px 0;color:#64748b;vertical-align:top;width:42%">${esc(k)}</td><td style="padding:5px 0;font-weight:600">${esc(v)}</td></tr>`).join("");
  return `<div style="margin:0;background:#f3f6fb;padding:24px 12px;font-family:Inter,Arial,sans-serif;color:#172033"><div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #e5eaf2;border-radius:14px;overflow:hidden"><div style="background:#102a43;padding:20px 24px;color:#fff"><div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;opacity:.8">HotelCare.app · VIZA guest reporting</div><div style="font-size:22px;font-weight:700;margin-top:6px">${esc(title)}</div></div><div style="padding:22px 24px"><p style="font-size:15px;line-height:1.6;margin:0 0 14px">${esc(intro)}</p><table style="width:100%;border-collapse:collapse;font-size:14px">${table}</table><p style="font-size:12px;line-height:1.55;color:#64748b;margin:20px 0 0">${esc(footer)}</p></div></div></div>`;
}

export interface ProblemMailInput {
  hotelName: string;
  hotelId: string;
  kind: ProblemKind;
  since: string;
  waiting: number;
  statusCode: string | null;
  lastError: string | null;
}

export function problemAlertEmail(input: ProblemMailInput): { subject: string; html: string; text: string } {
  const t = problemText[input.kind];
  const subject = `VIZA alert · ${input.hotelName} · ${t.title}`;
  const rows: [string, string][] = [
    ["Hotel", `${input.hotelName} (${input.hotelId})`],
    ["Problem since", budapestTime(input.since)],
    ["Guest reports waiting", String(input.waiting)],
    ["THF status code", input.statusCode ?? "—"],
    ["Technical details", input.lastError ?? "—"],
  ];
  const footer = "HotelCare retries every 10 minutes and sends a short note when the problem is over. Reception has not been interrupted.";
  return {
    subject,
    html: frame(t.title, t.meaning, rows, footer),
    text: [t.title, t.meaning, ...rows.map(([k, v]) => `${k}: ${v}`), footer].join("\n"),
  };
}

export function problemResolvedEmail(input: { hotelName: string; hotelId: string; since: string | null; now: Date }): { subject: string; html: string; text: string } {
  const title = "VIZA reporting works again";
  const rows: [string, string][] = [
    ["Hotel", `${input.hotelName} (${input.hotelId})`],
    ["Problem started", input.since ? budapestTime(input.since) : "—"],
    ["Resolved", budapestTime(input.now)],
  ];
  const intro = "The THF answers normally again. Waiting guest reports go out with the next run (within 10 minutes).";
  return {
    subject: `VIZA resolved · ${input.hotelName}`,
    html: frame(title, intro, rows, "No action is needed."),
    text: [title, intro, ...rows.map(([k, v]) => `${k}: ${v}`)].join("\n"),
  };
}

export interface CorrectionItem { reservationNumber: string | null; phase: "arrival" | "departure"; error: string | null; since: string }

/** Rejected guest reports nobody corrected within the hour. Booking numbers and THF codes only: no personal data. */
export function correctionAlertEmail(input: { hotelName: string; hotelId: string; items: CorrectionItem[] }): { subject: string; html: string; text: string } {
  const title = `${input.items.length} rejected guest report${input.items.length === 1 ? "" : "s"} not corrected for over an hour`;
  const intro = "VIZA refused these guest reports because of a data problem. Reception sees them on the \"Javítandó vendégadatok\" card with a one-click fix; please make sure they are corrected and sent again.";
  const rows: [string, string][] = input.items.map((item) => [
    `${item.reservationNumber ?? "—"} · ${item.phase === "arrival" ? "arrival" : "departure"}`,
    `${item.error ?? "rejected"} (since ${budapestTime(item.since)})`,
  ]);
  return {
    subject: `VIZA alert · ${input.hotelName} · ${title}`,
    html: frame(title, intro, [["Hotel", `${input.hotelName} (${input.hotelId})`], ...rows], "Data corrections are done in HotelCare; VIZA does not allow changing data that it already accepted."),
    text: [title, intro, `Hotel: ${input.hotelName} (${input.hotelId})`, ...rows.map(([k, v]) => `${k}: ${v}`)].join("\n"),
  };
}
