// "Other mailbox" for the HotelCare AI: any provider that speaks IMAP + SMTP
// (the hotel's own domain mail, cPanel, Rackhost, GMX, Gmail with an app
// password, …). Each person connects their own mailbox with their address and
// password; no company-wide app registration is needed.
//
// Network rules: only the secure ports are used (IMAP 993, SMTP 465). Plain or
// STARTTLS ports are not offered, and Supabase blocks outbound 25 and 587
// anyway. A host that resolves to a private or loopback address is refused,
// so a mailbox form cannot be used to probe HotelCare's own network.

import { ImapFlow } from "npm:imapflow@1.0.171";
import { simpleParser } from "npm:mailparser@3.7.2";
import nodemailer from "npm:nodemailer@6.9.16";
import { htmlToText, isPrivateAddress } from "./mailFormat.ts";

export { isPrivateAddress };
import type { MailMessage, MailSummary } from "./assistantMail.ts";

export type ImapSettings = {
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  username: string;
};

export const IMAP_PORT = 993;
export const SMTP_PORT = 465;
const TIMEOUT_MS = 12_000;

/** Providers whose settings are known. A Gmail or Workspace box needs an app password. */
const PRESETS: { match: RegExp; imap: string; smtp: string; note?: string }[] = [
  { match: /^(gmail\.com|googlemail\.com)$/, imap: "imap.gmail.com", smtp: "smtp.gmail.com", note: "gmail" },
  { match: /^(yahoo\.[a-z.]+|ymail\.com)$/, imap: "imap.mail.yahoo.com", smtp: "smtp.mail.yahoo.com" },
  { match: /^(gmx\.[a-z.]+)$/, imap: "imap.gmx.net", smtp: "mail.gmx.net" },
  { match: /^(web\.de)$/, imap: "imap.web.de", smtp: "smtp.web.de" },
  { match: /^(zoho\.(com|eu))$/, imap: "imap.zoho.eu", smtp: "smtp.zoho.eu" },
];

const MICROSOFT_DOMAINS = /^(outlook\.[a-z.]+|hotmail\.[a-z.]+|live\.[a-z.]+|msn\.com)$/;

export type Discovery =
  | { kind: "settings"; candidates: { imap: string; smtp: string }[]; note?: string }
  | { kind: "use_microsoft" };

/** A server name, address or port the mailbox form may not use. Shown to the person as is. */
export class MailHostError extends Error {}

function allowPrivate(): boolean {
  return Deno.env.get("ASSISTANT_MAIL_ALLOW_PRIVATE_HOSTS") === "true";
}

function allowedPort(kind: "imap" | "smtp", port: number): boolean {
  if (allowPrivate()) return Number.isInteger(port) && port > 0 && port < 65536;
  return kind === "imap" ? port === IMAP_PORT : port === SMTP_PORT;
}

const HOST = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;

async function assertPublicHost(host: string): Promise<void> {
  if (allowPrivate()) return;
  if (!HOST.test(host)) throw new MailHostError(`"${host}" is not a valid server name.`);
  const records: string[] = [];
  for (const type of ["A", "AAAA"] as const) {
    try {
      records.push(...(await Deno.resolveDns(host, type)));
    } catch {
      // No record of this type.
    }
  }
  if (!records.length) throw new MailHostError(`The server ${host} could not be found.`);
  if (records.some(isPrivateAddress)) throw new MailHostError(`The server ${host} is not a public mail server.`);
}

/** Server names worth trying for an address, best guess first. */
export async function discoverSettings(email: string): Promise<Discovery> {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (MICROSOFT_DOMAINS.test(domain)) return { kind: "use_microsoft" };
  const preset = PRESETS.find((p) => p.match.test(domain));
  if (preset) return { kind: "settings", candidates: [{ imap: preset.imap, smtp: preset.smtp }], note: preset.note };
  let mx: string[] = [];
  try {
    mx = (await Deno.resolveDns(domain, "MX")).sort((a, b) => a.preference - b.preference).map((r) => r.exchange.toLowerCase().replace(/\.$/, ""));
  } catch {
    // Some domains publish no MX; fall back to the usual names.
  }
  if (mx.some((h) => h.endsWith("google.com") || h.endsWith("googlemail.com"))) {
    return { kind: "settings", candidates: [{ imap: "imap.gmail.com", smtp: "smtp.gmail.com" }], note: "gmail" };
  }
  if (mx.some((h) => h.endsWith("outlook.com") || h.endsWith("protection.outlook.com"))) return { kind: "use_microsoft" };
  const candidates = [
    { imap: `mail.${domain}`, smtp: `mail.${domain}` },
    { imap: `imap.${domain}`, smtp: `smtp.${domain}` },
  ];
  // Hosting providers often run mail on the MX host itself.
  if (mx[0] && !candidates.some((c) => c.imap === mx[0])) candidates.push({ imap: mx[0], smtp: mx[0] });
  return { kind: "settings", candidates };
}

function imapClient(settings: ImapSettings, password: string) {
  return new ImapFlow({
    host: settings.imap_host,
    port: settings.imap_port,
    secure: true,
    auth: { user: settings.username, pass: password },
    logger: false,
    emitLogs: false,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS * 2,
    tls: allowPrivate() ? { rejectUnauthorized: false } : {},
  });
}

function smtpTransport(settings: ImapSettings, password: string) {
  return nodemailer.createTransport({
    host: settings.smtp_host,
    port: settings.smtp_port,
    secure: true,
    auth: { user: settings.username, pass: password },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS * 2,
    tls: allowPrivate() ? { rejectUnauthorized: false } : {},
  });
}

async function withImap<T>(settings: ImapSettings, password: string, run: (client: ImapFlow) => Promise<T>): Promise<T> {
  if (!allowedPort("imap", settings.imap_port)) throw new MailHostError(`Only the secure IMAP port ${IMAP_PORT} is supported.`);
  await assertPublicHost(settings.imap_host);
  const client = imapClient(settings, password);
  client.on("error", () => {
    // Surfaced through the awaited call below.
  });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

export class ImapLoginError extends Error {}

/** Checks both directions before a mailbox is saved: can read (IMAP) and can send (SMTP). */
export async function verifyImapAccount(settings: ImapSettings, password: string): Promise<void> {
  if (!allowedPort("smtp", settings.smtp_port)) throw new MailHostError(`Only the secure SMTP port ${SMTP_PORT} is supported.`);
  try {
    await withImap(settings, password, async (client) => {
      await client.mailboxOpen("INBOX", { readOnly: true });
    });
  } catch (error) {
    if (error instanceof MailHostError) throw error;
    const text = String((error as any)?.responseText ?? (error as Error)?.message ?? "");
    if ((error as any)?.authenticationFailed || /auth|login|credential|password/i.test(text)) {
      throw new ImapLoginError("The email address or password was not accepted by the mail server.");
    }
    throw new Error(`The incoming mail server ${settings.imap_host} could not be reached.`);
  }
  await assertPublicHost(settings.smtp_host);
  const transport = smtpTransport(settings, password);
  try {
    await transport.verify();
  } catch (error) {
    const code = String((error as any)?.code ?? "");
    if (code === "EAUTH") throw new ImapLoginError("The outgoing mail server did not accept the password.");
    throw new Error(`The outgoing mail server ${settings.smtp_host} could not be reached on port ${settings.smtp_port}.`);
  } finally {
    transport.close();
  }
}

/** IMAP ids are "i.<uidvalidity>.<uid>" so a stale id after a mailbox reset is detected. */
function messageId(uidValidity: bigint | number | undefined, uid: number): string {
  return `i.${String(uidValidity ?? 0)}.${uid}`;
}

function parseMessageId(id: string): { validity: string; uid: number } {
  const match = /^i\.(\d+)\.(\d+)$/.exec(id);
  if (!match) throw new Error("That message id is not valid.");
  return { validity: match[1], uid: Number(match[2]) };
}

function addressText(value: any): string {
  if (!value) return "";
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((a: any) => (a?.name && a?.address && a.name !== a.address ? `${a.name} <${a.address}>` : String(a?.address ?? "")))
    .filter(Boolean)
    .join(", ");
}

export async function searchImap(
  settings: ImapSettings,
  password: string,
  params: { query: string | null; unreadOnly: boolean; days: number; limit: number },
): Promise<MailSummary[]> {
  const limit = Math.min(Math.max(params.limit, 1), 20);
  const since = new Date(Date.now() - Math.min(Math.max(params.days, 1), 90) * 86_400_000);
  return await withImap(settings, password, async (client) => {
    const box = await client.mailboxOpen("INBOX", { readOnly: true });
    const criteria: Record<string, unknown> = { since };
    if (params.unreadOnly) criteria.seen = false;
    const phrase = params.query?.replace(/[\r\n"]/g, " ").trim().slice(0, 120);
    if (phrase) criteria.or = [{ subject: phrase }, { from: phrase }, { body: phrase }];
    const uids = ((await client.search(criteria, { uid: true })) || []) as number[];
    const newest = uids.sort((a, b) => b - a).slice(0, limit);
    if (!newest.length) return [];
    const out: MailSummary[] = [];
    for await (const message of client.fetch(newest.join(","), { uid: true, envelope: true, flags: true, internalDate: true, bodyParts: ["TEXT"] }, { uid: true })) {
      const envelope: any = message.envelope ?? {};
      const raw = message.bodyParts?.get("text")?.toString("utf8") ?? "";
      const preview = htmlToText(raw.replace(/=\r?\n/g, "")).replace(/\s+/g, " ").slice(0, 240);
      out.push({
        id: messageId(box.uidValidity, message.uid),
        thread_id: envelope.messageId ?? null,
        from: addressText(envelope.from),
        to: addressText(envelope.to),
        subject: String(envelope.subject ?? ""),
        date: message.internalDate ? new Date(message.internalDate as any).toISOString() : envelope.date ? new Date(envelope.date).toISOString() : null,
        snippet: preview,
        unread: !(message.flags as Set<string> | undefined)?.has("\\Seen"),
      });
    }
    return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  });
}

export async function readImap(settings: ImapSettings, password: string, id: string): Promise<MailMessage> {
  const { validity, uid } = parseMessageId(id);
  return await withImap(settings, password, async (client) => {
    const box = await client.mailboxOpen("INBOX", { readOnly: true });
    if (String(box.uidValidity) !== validity) throw new Error("That email is no longer in the inbox. Search again.");
    const message = await client.fetchOne(String(uid), { uid: true, source: true, flags: true, internalDate: true }, { uid: true });
    if (!message || !message.source) throw new Error("That email was not found.");
    const parsed: any = await simpleParser(message.source as any);
    const body = parsed.text || (parsed.html ? htmlToText(String(parsed.html)) : "");
    return {
      id,
      thread_id: parsed.messageId ?? null,
      from: addressText(parsed.from?.value),
      to: addressText(parsed.to?.value ?? parsed.to),
      cc: addressText(parsed.cc?.value ?? parsed.cc),
      subject: String(parsed.subject ?? ""),
      date: parsed.date ? new Date(parsed.date).toISOString() : null,
      snippet: String(body).replace(/\s+/g, " ").slice(0, 240),
      unread: !(message.flags as Set<string> | undefined)?.has("\\Seen"),
      body: String(body),
      header_message_id: parsed.messageId ?? null,
    };
  });
}

/** Sends through SMTP and files a copy in Sent where the provider does not do that itself. */
export async function sendImap(
  settings: ImapSettings,
  password: string,
  from: { email: string; name: string | null },
  draft: { to: string[]; cc: string[]; subject: string; body: string; reply_header_message_id: string | null },
): Promise<string | null> {
  if (!allowedPort("smtp", settings.smtp_port)) throw new MailHostError(`Only the secure SMTP port ${SMTP_PORT} is supported.`);
  await assertPublicHost(settings.smtp_host);
  const headerId = draft.reply_header_message_id && /^<[^<>\s]+>$/.test(draft.reply_header_message_id) ? draft.reply_header_message_id : undefined;
  const mail = {
    from: from.name ? { name: from.name, address: from.email } : from.email,
    to: draft.to,
    cc: draft.cc.length ? draft.cc : undefined,
    subject: draft.subject,
    text: draft.body,
    inReplyTo: headerId,
    references: headerId,
  };
  const transport = smtpTransport(settings, password);
  let info: any;
  try {
    info = await transport.sendMail(mail);
  } finally {
    transport.close();
  }
  // Gmail files SMTP mail in Sent by itself; most other servers do not.
  if (!/(^|\.)gmail\.com$/i.test(settings.smtp_host)) {
    try {
      const raw = await new Promise<Buffer>((resolve, reject) => {
        const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "windows" });
        composer.sendMail({ ...mail, messageId: info?.messageId }, (error: Error | null, result: any) => (error ? reject(error) : resolve(result.message)));
      });
      await withImap(settings, password, async (client) => {
        const boxes = await client.list();
        const sent = boxes.find((b: any) => b.specialUse === "\\Sent") ?? boxes.find((b: any) => /^(inbox[./])?(sent|sent items|sent messages|elküldött)/i.test(b.path));
        if (sent) await client.append(sent.path, raw, ["\\Seen"]);
      });
    } catch (error) {
      // The email was sent; a missing copy in Sent is not a failed send.
      console.error("assistant mail: could not file the sent copy", (error as Error)?.message);
    }
  }
  return info?.messageId ? String(info.messageId) : null;
}
