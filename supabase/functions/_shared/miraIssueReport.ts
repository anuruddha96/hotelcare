// Problem reports from Mira: what the person saw, what Mira did, and the
// technical trail, so the HotelCare team can act without asking around.
// Pure helpers (formatting, redaction); the endpoint does the reads and sends.

export type TranscriptRow = { role: string; content: string; created_at: string; refused?: boolean; model?: string | null };
export type AuditRow = {
  created_at: string; question?: string | null; model?: string | null; scopes_used?: string[] | null;
  refused?: boolean | null; input_tokens?: number | null; output_tokens?: number | null;
  duration_ms?: number | null; workflow?: string | null;
};
export type UsageErrorRow = { created_at: string; function_name?: string | null; model?: string | null; error?: string | null };

/** Keys, tokens and long numbers never leave the server in a report. */
export function redact(value: unknown, max = 600): string {
  return String(value ?? "")
    .replace(/Bearer\s+[\w.-]+/gi, "Bearer [redacted]")
    .replace(/\bsk-[\w-]{10,}/g, "sk-[redacted]")
    .replace(/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, "[token redacted]")
    .replace(/\b\d{13,19}\b/g, "[number redacted]")
    .slice(0, max);
}

/** Budapest wall-clock time for a log line. */
function at(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso ?? "");
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(d);
}

export function formatTranscript(rows: TranscriptRow[], maxPerMessage = 1200): string {
  return rows.map((row) => {
    const who = row.role === "user" ? "Person" : "Mira";
    const flags = [row.refused ? "declined" : "", row.role !== "user" && row.model ? row.model : ""].filter(Boolean).join(", ");
    return `[${at(row.created_at)}] ${who}${flags ? ` (${flags})` : ""}:\n${redact(row.content, maxPerMessage)}`;
  }).join("\n\n");
}

export function formatAuditTrail(rows: AuditRow[]): string {
  return rows.map((row) => {
    const tokens = (Number(row.input_tokens) || 0) + (Number(row.output_tokens) || 0);
    const tools = (row.scopes_used ?? []).map((t) => String(t).replace(/^tool-/, "")).join(", ") || "none";
    return `[${at(row.created_at)}] model=${row.model ?? "?"} depth/workflow=${row.workflow ?? "-"} tools=${tools} ` +
      `tokens=${tokens} time=${row.duration_ms ? `${Math.round(Number(row.duration_ms) / 100) / 10}s` : "?"}${row.refused ? " DECLINED" : ""}\n` +
      `  question: ${redact(row.question, 200)}`;
  }).join("\n");
}

export function formatUsageErrors(rows: UsageErrorRow[]): string {
  return rows.map((row) => `[${at(row.created_at)}] ${row.function_name ?? "?"} ${row.model ?? ""}: ${redact(row.error, 300)}`).join("\n");
}

/** Fallback title when the person did not write one and the summary model is unavailable. */
export function fallbackTitle(transcript: TranscriptRow[], description: string): string {
  const lastQuestion = [...transcript].reverse().find((row) => row.role === "user")?.content ?? description;
  const text = String(lastQuestion || "Mira could not help").replace(/\s+/g, " ").trim();
  return `Mira problem: ${text}`.slice(0, 120);
}

export const SUMMARY_INSTRUCTIONS =
  "You write problem reports for the HotelCare support team about Mira, the in-app hotel operations assistant. " +
  "Use ONLY the transcript, the person's note and the technical log. Write in English, plain text, no markdown headers, at most 170 words, in four labelled lines: " +
  "'What the person needed:', 'What Mira did:', 'What went wrong:', 'Likely cause and next step:' (cause = missing data, wrong data, a tool or permission limit, a model mistake, or a service outage). " +
  "Name hotel, room, date and the exact wrong statement when the transcript shows them. Do not invent facts, do not speculate beyond the log. " +
  "Then a final line 'Title:' with a short title of at most 10 words.";

/** Splits the model's output into summary and title. */
export function parseSummary(text: string): { summary: string; title: string | null } {
  const clean = String(text ?? "").trim();
  const match = clean.match(/^\s*Title:\s*(.+)\s*$/im);
  const title = match ? match[1].replace(/["*]/g, "").trim().slice(0, 120) : null;
  const summary = clean.replace(/^\s*Title:.*$/im, "").trim().slice(0, 2500);
  return { summary, title: title && title.length >= 3 ? title : null };
}
