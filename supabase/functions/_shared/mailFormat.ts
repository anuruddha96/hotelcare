// Pure helpers for the assistant mailbox: addresses, MIME, text extraction.
// No Deno or network APIs, so vitest can cover them.

/** Roles that may connect a personal mailbox to the assistant. */
export const MAIL_ROLES = [
  "admin",
  "top_management",
  "top_management_manager",
  "manager",
  "reception_manager",
  "back_office_manager",
  "housekeeping_manager",
  "maintenance_manager",
];

export function canUseMail(role: string | null | undefined): boolean {
  return MAIL_ROLES.includes(role ?? "");
}

export const MAX_RECIPIENTS = 10;
export const MAX_SUBJECT = 200;
export const MAX_BODY = 20_000;

// Deliberately strict: one plain address, no display names, no comments, no
// quoted local parts. Anything unusual is rejected rather than interpreted.
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function normalizeAddress(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  // Accept "Name <a@b.c>" from the model or the UI, keep only the address.
  const angle = raw.match(/<([^<>\s]+)>$/);
  const address = (angle ? angle[1] : raw).trim().toLowerCase();
  if (address.length > 254 || !EMAIL.test(address)) return null;
  return address;
}

export function normalizeAddressList(
  value: unknown,
): { ok: true; addresses: string[] } | { ok: false; error: string } {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,;\n]/)
      : [];
  const out: string[] = [];
  for (const item of items) {
    if (String(item ?? "").trim() === "") continue;
    const address = normalizeAddress(item);
    if (!address) return { ok: false, error: `"${String(item).slice(0, 80)}" is not a valid email address.` };
    if (!out.includes(address)) out.push(address);
  }
  return { ok: true, addresses: out };
}

export type CleanDraft = { to: string[]; cc: string[]; subject: string; body: string };

/** Validates a draft exactly as it will be sent. Used when drafting and again on Send. */
export function validateDraft(input: {
  to: unknown;
  cc?: unknown;
  subject: unknown;
  body: unknown;
}): { ok: true; draft: CleanDraft } | { ok: false; error: string } {
  const to = normalizeAddressList(input.to);
  if (to.ok === false) return { ok: false, error: to.error };
  const cc = normalizeAddressList(input.cc ?? []);
  if (cc.ok === false) return { ok: false, error: cc.error };
  if (to.addresses.length === 0) return { ok: false, error: "Add at least one recipient." };
  const ccOnly = cc.addresses.filter((a) => !to.addresses.includes(a));
  if (to.addresses.length + ccOnly.length > MAX_RECIPIENTS) {
    return { ok: false, error: `An assistant email can go to at most ${MAX_RECIPIENTS} people.` };
  }
  // Header injection: a subject is one line.
  const subject = String(input.subject ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!subject) return { ok: false, error: "Add a subject." };
  if (subject.length > MAX_SUBJECT) return { ok: false, error: "The subject is too long." };
  const body = String(input.body ?? "").replace(/\r\n?/g, "\n").trim();
  if (!body) return { ok: false, error: "The email is empty." };
  if (body.length > MAX_BODY) return { ok: false, error: "The email is too long." };
  return { ok: true, draft: { to: to.addresses, cc: ccOnly, subject, body } };
}

/** Recipients outside the sender's own domain, shown as a warning on the card. */
export function externalRecipients(from: string, recipients: string[]): string[] {
  const own = from.split("@")[1]?.toLowerCase() ?? "";
  return recipients.filter((r) => r.split("@")[1]?.toLowerCase() !== own);
}

export function replySubject(original: string): string {
  const clean = String(original ?? "").replace(/[\r\n]+/g, " ").trim();
  if (!clean) return "Re:";
  return /^(re|aw|vá|vs|sv|antw)\s*:/i.test(clean) ? clean : `Re: ${clean}`;
}

function utf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${utf8Base64(value)}?=`;
}

function wrap76(value: string): string {
  return value.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

/** RFC 5322 message for the Gmail API, as base64url. */
export function buildMimeMessage(params: {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  inReplyTo?: string | null;
}): string {
  const headerId = params.inReplyTo && /^<[^<>\s]+>$/.test(params.inReplyTo) ? params.inReplyTo : null;
  const lines = [
    `From: ${params.from}`,
    `To: ${params.to.join(", ")}`,
    ...(params.cc.length ? [`Cc: ${params.cc.join(", ")}`] : []),
    `Subject: ${encodeHeader(params.subject)}`,
    ...(headerId ? [`In-Reply-To: ${headerId}`, `References: ${headerId}`] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(utf8Base64(params.body.replace(/\n/g, "\r\n"))),
  ];
  return utf8Base64(lines.join("\r\n")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Readable text from an HTML email. Good enough for a model to read; not a renderer. */
export function htmlToText(html: string): string {
  return String(html ?? "")
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
      if (code[0] === "#") {
        const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
      }
      return ENTITIES[code.toLowerCase()] ?? match;
    })
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Drops the quoted history below a reply so the model reads the new part. */
export function stripQuotedHistory(text: string): string {
  const markers = [
    /\n-{2,}\s*Original Message\s*-{2,}/i,
    /\nOn .{4,120}(wrote|írta):\s*\n/i,
    /\n\d{4}\. .{2,60} (írta|wrote):/i,
    /\nFrom: .+\n(Sent|Date): /i,
    /\n_{8,}\n/,
  ];
  let cut = text.length;
  for (const marker of markers) {
    const match = marker.exec(text);
    if (match && match.index > 40 && match.index < cut) cut = match.index;
  }
  return text.slice(0, cut).trim();
}

/** Wrapper that marks mailbox content as data, not instructions, for the model. */
export function untrustedMailText(text: string, max = 6000): string {
  const clipped = text.length > max ? `${text.slice(0, max)}\n[… shortened]` : text;
  return `<email_content untrusted="true">\n${clipped.replace(/<\/?email_content[^>]*>/gi, "")}\n</email_content>`;
}
