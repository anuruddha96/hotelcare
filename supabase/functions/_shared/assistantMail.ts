// Mailbox access for the HotelCare AI: Gmail and Microsoft 365 (Graph).
//
// Each person connects their own mailbox with OAuth. Tokens are encrypted with
// AES-GCM before they reach the database and are only ever decrypted inside
// edge functions. Nothing in this module sends on its own initiative: `sendDraft`
// is only called by `assistant-mail` after the person tapped Send.

import { buildMimeMessage, htmlToText } from "./mailFormat.ts";

export type MailProvider = "google" | "microsoft";

export type MailAccount = {
  id: string;
  user_id: string;
  organization_slug: string | null;
  provider: MailProvider;
  email: string;
  display_name: string | null;
  refresh_token_ciphertext: string;
  access_token_ciphertext: string | null;
  access_token_expires_at: string | null;
  status: string;
};

export type MailSummary = {
  id: string;
  thread_id: string | null;
  from: string;
  to: string;
  subject: string;
  date: string | null;
  snippet: string;
  unread: boolean;
};

export type MailMessage = MailSummary & {
  cc: string;
  body: string;
  header_message_id: string | null;
};

export class MailAuthError extends Error {}

// ------------------------------------------------------------------ config

export const GOOGLE_MAIL_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];
export const MICROSOFT_MAIL_SCOPES = ["offline_access", "openid", "email", "User.Read", "Mail.Read", "Mail.Send"];

export function providerConfig(provider: MailProvider) {
  if (provider === "google") {
    // A dedicated Gmail client is preferred. Reusing the Google Business client
    // is allowed, but only when GOOGLE_MAIL_ENABLED=true, because the Gmail API
    // and its scopes must first be added to that client in Google Cloud.
    const dedicated = Boolean(Deno.env.get("GOOGLE_MAIL_CLIENT_ID") && Deno.env.get("GOOGLE_MAIL_CLIENT_SECRET"));
    const shared = Deno.env.get("GOOGLE_MAIL_ENABLED") === "true";
    const clientId = dedicated ? Deno.env.get("GOOGLE_MAIL_CLIENT_ID") : Deno.env.get("GOOGLE_BUSINESS_CLIENT_ID");
    const clientSecret = dedicated ? Deno.env.get("GOOGLE_MAIL_CLIENT_SECRET") : Deno.env.get("GOOGLE_BUSINESS_CLIENT_SECRET");
    return {
      clientId,
      clientSecret,
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: GOOGLE_MAIL_SCOPES,
      enabled: Boolean(clientId && clientSecret && (dedicated || shared)),
    };
  }
  const tenant = Deno.env.get("MICROSOFT_MAIL_TENANT") || "common";
  const clientId = Deno.env.get("MICROSOFT_MAIL_CLIENT_ID");
  const clientSecret = Deno.env.get("MICROSOFT_MAIL_CLIENT_SECRET");
  return {
    clientId,
    clientSecret,
    authorizeUrl: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    scopes: MICROSOFT_MAIL_SCOPES,
    enabled: Boolean(clientId && clientSecret),
  };
}

export function mailRedirectUri(): string {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/assistant-mail-oauth-callback`;
}

/** Self-service IMAP needs only the encryption key; an admin can switch it off. */
export function imapEnabled(): boolean {
  return Boolean(tokenKeyRaw()) && Deno.env.get("ASSISTANT_MAIL_IMAP_ENABLED") !== "false";
}

export function mailConfigured(): boolean {
  return Boolean(tokenKeyRaw()) && (providerConfig("google").enabled || providerConfig("microsoft").enabled || imapEnabled());
}

// -------------------------------------------------------------- encryption

function tokenKeyRaw(): string | undefined {
  return Deno.env.get("ASSISTANT_MAIL_TOKEN_KEY") || Deno.env.get("GOOGLE_BUSINESS_TOKEN_KEY");
}

const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

async function aesKey(): Promise<CryptoKey> {
  const raw = tokenKeyRaw();
  if (!raw) throw new Error("ASSISTANT_MAIL_TOKEN_KEY is not configured");
  let bytes: Uint8Array;
  try {
    bytes = unb64(raw);
  } catch {
    bytes = new TextEncoder().encode(raw);
  }
  if (bytes.length !== 32) bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return crypto.subtle.importKey("raw", bytes as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptToken(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const out = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), new TextEncoder().encode(value)));
  return `${b64(iv)}.${b64(out)}`;
}

export async function decryptToken(value: string): Promise<string> {
  const [iv, data] = value.split(".");
  if (!iv || !data) throw new Error("Invalid encrypted token");
  const out = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(), unb64(data));
  return new TextDecoder().decode(out);
}

// ------------------------------------------------------------------ tokens

/** A valid access token, refreshed and re-encrypted when it is about to expire. */
export async function accessTokenFor(service: any, account: MailAccount): Promise<string> {
  if (account.status !== "active") throw new MailAuthError("This mailbox needs to be reconnected.");
  if (
    account.access_token_ciphertext &&
    account.access_token_expires_at &&
    Date.parse(account.access_token_expires_at) > Date.now() + 90_000
  ) {
    return await decryptToken(account.access_token_ciphertext);
  }
  const config = providerConfig(account.provider);
  if (!config.clientId || !config.clientSecret) throw new Error("Mailbox sign-in is not configured.");
  const refresh = await decryptToken(account.refresh_token_ciphertext);
  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refresh,
    grant_type: "refresh_token",
  });
  if (account.provider === "microsoft") params.set("scope", config.scopes.join(" "));
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const token = await response.json().catch(() => ({}));
  if (!response.ok || !token.access_token) {
    // invalid_grant: revoked, password changed, or consent withdrawn.
    if (token?.error === "invalid_grant" || response.status === 400 || response.status === 401) {
      await service.from("assistant_mail_accounts").update({ status: "reconnect_required" }).eq("id", account.id);
      throw new MailAuthError("This mailbox needs to be reconnected.");
    }
    throw new Error(`Mailbox sign-in refresh failed (${response.status}).`);
  }
  const patch: Record<string, unknown> = {
    access_token_ciphertext: await encryptToken(String(token.access_token)),
    access_token_expires_at: new Date(Date.now() + Number(token.expires_in ?? 3000) * 1000).toISOString(),
    last_used_at: new Date().toISOString(),
  };
  // Microsoft rotates refresh tokens; keep the newest one.
  if (token.refresh_token) patch.refresh_token_ciphertext = await encryptToken(String(token.refresh_token));
  await service.from("assistant_mail_accounts").update(patch).eq("id", account.id);
  return String(token.access_token);
}

async function api(token: string, url: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (response.status === 401) throw new MailAuthError("This mailbox needs to be reconnected.");
  if (response.status === 202 || response.status === 204) return {};
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.error_description || `HTTP ${response.status}`;
    throw new Error(`Mailbox request failed: ${String(message).slice(0, 200)}`);
  }
  return data;
}

// ------------------------------------------------------------------- Gmail

function gmailHeader(headers: any[] | undefined, name: string): string {
  return String(headers?.find((h: any) => String(h?.name).toLowerCase() === name.toLowerCase())?.value ?? "");
}

function decodeGmailBody(data: string | undefined): string {
  if (!data) return "";
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

function gmailText(payload: any): string {
  let plain = "";
  let html = "";
  const walk = (part: any) => {
    if (!part) return;
    const type = String(part.mimeType ?? "");
    if (type === "text/plain" && !plain && part.body?.data) plain = decodeGmailBody(part.body.data);
    else if (type === "text/html" && !html && part.body?.data) html = decodeGmailBody(part.body.data);
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  return plain || htmlToText(html);
}

function gmailSummary(message: any): MailSummary {
  const headers = message.payload?.headers;
  return {
    id: String(message.id),
    thread_id: message.threadId ? String(message.threadId) : null,
    from: gmailHeader(headers, "From"),
    to: gmailHeader(headers, "To"),
    subject: gmailHeader(headers, "Subject"),
    date: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : gmailHeader(headers, "Date") || null,
    snippet: String(message.snippet ?? "").slice(0, 240),
    unread: Array.isArray(message.labelIds) && message.labelIds.includes("UNREAD"),
  };
}

// ------------------------------------------------------------------- Graph

function graphAddress(value: any): string {
  const address = value?.emailAddress;
  if (!address) return "";
  return address.name && address.name !== address.address ? `${address.name} <${address.address}>` : String(address.address ?? "");
}

function graphSummary(message: any): MailSummary {
  return {
    id: String(message.id),
    thread_id: message.conversationId ? String(message.conversationId) : null,
    from: graphAddress(message.from),
    to: (message.toRecipients ?? []).map(graphAddress).join(", "),
    subject: String(message.subject ?? ""),
    date: message.receivedDateTime ?? null,
    snippet: String(message.bodyPreview ?? "").slice(0, 240),
    unread: message.isRead === false,
  };
}

const GRAPH = "https://graph.microsoft.com/v1.0/me";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

// ------------------------------------------------------------------ public

/** Newest messages in the inbox, optionally filtered by a search phrase. */
export async function searchMail(
  token: string,
  provider: MailProvider,
  params: { query: string | null; unreadOnly: boolean; days: number; limit: number },
): Promise<MailSummary[]> {
  const limit = Math.min(Math.max(params.limit, 1), 20);
  const days = Math.min(Math.max(params.days, 1), 90);
  if (provider === "google") {
    const parts = ["in:inbox", `newer_than:${days}d`];
    if (params.unreadOnly) parts.push("is:unread");
    if (params.query) parts.push(params.query.replace(/[\r\n]/g, " ").slice(0, 200));
    const list = await api(token, `${GMAIL}/messages?${new URLSearchParams({ q: parts.join(" "), maxResults: String(limit) })}`);
    const ids: string[] = (list.messages ?? []).map((m: any) => String(m.id));
    const metadata = new URLSearchParams({ format: "metadata" });
    for (const header of ["From", "To", "Subject", "Date"]) metadata.append("metadataHeaders", header);
    const messages = await Promise.all(ids.map((id) => api(token, `${GMAIL}/messages/${encodeURIComponent(id)}?${metadata}`)));
    return messages.map(gmailSummary);
  }
  const select = "id,conversationId,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead";
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  let url: string;
  if (params.query) {
    // Graph cannot combine $search with $filter/$orderby; filter dates after.
    const phrase = params.query.replace(/["\r\n]/g, " ").slice(0, 200);
    url = `${GRAPH}/mailFolders/inbox/messages?${new URLSearchParams({ $search: `"${phrase}"`, $top: String(limit * 2), $select: select })}`;
  } else {
    const filter = [`receivedDateTime ge ${since}`, ...(params.unreadOnly ? ["isRead eq false"] : [])].join(" and ");
    url = `${GRAPH}/mailFolders/inbox/messages?${new URLSearchParams({ $filter: filter, $orderby: "receivedDateTime desc", $top: String(limit), $select: select })}`;
  }
  const data = await api(token, url, { headers: { ConsistencyLevel: "eventual" } });
  return (data.value ?? [])
    .map(graphSummary)
    .filter((m: MailSummary) => !params.query || !m.date || m.date >= since)
    .filter((m: MailSummary) => !params.unreadOnly || m.unread)
    .sort((a: MailSummary, b: MailSummary) => String(b.date).localeCompare(String(a.date)))
    .slice(0, limit);
}

export async function readMail(token: string, provider: MailProvider, id: string): Promise<MailMessage> {
  if (!/^[A-Za-z0-9_\-=+/.]{1,400}$/.test(id)) throw new Error("That message id is not valid.");
  if (provider === "google") {
    const message = await api(token, `${GMAIL}/messages/${encodeURIComponent(id)}?format=full`);
    const headers = message.payload?.headers;
    return {
      ...gmailSummary(message),
      cc: gmailHeader(headers, "Cc"),
      body: gmailText(message.payload),
      header_message_id: gmailHeader(headers, "Message-ID") || gmailHeader(headers, "Message-Id") || null,
    };
  }
  const message = await api(
    token,
    `${GRAPH}/messages/${encodeURIComponent(id)}?$select=id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,isRead,body,internetMessageId`,
    { headers: { Prefer: 'outlook.body-content-type="text"' } },
  );
  const body = message.body?.contentType === "html" ? htmlToText(message.body?.content ?? "") : String(message.body?.content ?? "");
  return {
    ...graphSummary(message),
    cc: (message.ccRecipients ?? []).map(graphAddress).join(", "),
    body,
    header_message_id: message.internetMessageId ?? null,
  };
}

/** Sends a confirmed draft. Returns the provider's id for the sent message when it gives one. */
export async function sendDraft(
  token: string,
  account: MailAccount,
  draft: {
    to: string[];
    cc: string[];
    subject: string;
    body: string;
    reply_to_message_id: string | null;
    reply_thread_id: string | null;
    reply_header_message_id: string | null;
  },
): Promise<string | null> {
  if (account.provider === "google") {
    const raw = buildMimeMessage({
      from: account.email,
      to: draft.to,
      cc: draft.cc,
      subject: draft.subject,
      body: draft.body,
      inReplyTo: draft.reply_header_message_id,
    });
    const sent = await api(token, `${GMAIL}/messages/send`, {
      method: "POST",
      body: JSON.stringify({ raw, ...(draft.reply_thread_id ? { threadId: draft.reply_thread_id } : {}) }),
    });
    return sent.id ? String(sent.id) : null;
  }
  const recipients = (list: string[]) => list.map((address) => ({ emailAddress: { address } }));
  if (draft.reply_to_message_id) {
    // createReply keeps Outlook's threading and quoting; then set exactly what
    // the person approved and send that draft.
    const reply = await api(token, `${GRAPH}/messages/${encodeURIComponent(draft.reply_to_message_id)}/createReply`, {
      method: "POST",
      body: "{}",
    });
    const replyId = String(reply.id);
    const quoted = reply.body?.contentType === "html" ? htmlToText(reply.body?.content ?? "") : String(reply.body?.content ?? "");
    await api(token, `${GRAPH}/messages/${encodeURIComponent(replyId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        subject: draft.subject,
        toRecipients: recipients(draft.to),
        ccRecipients: recipients(draft.cc),
        body: { contentType: "Text", content: quoted ? `${draft.body}\n\n${quoted}` : draft.body },
      }),
    });
    await api(token, `${GRAPH}/messages/${encodeURIComponent(replyId)}/send`, { method: "POST", body: "{}" });
    return replyId;
  }
  await api(token, `${GRAPH}/sendMail`, {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject: draft.subject,
        body: { contentType: "Text", content: draft.body },
        toRecipients: recipients(draft.to),
        ccRecipients: recipients(draft.cc),
      },
      saveToSentItems: true,
    }),
  });
  return null;
}

/** The signed-in mailbox address, read right after OAuth. */
export async function mailboxIdentity(token: string, provider: MailProvider): Promise<{ email: string; name: string | null }> {
  if (provider === "google") {
    const profile = await api(token, `${GMAIL}/profile`);
    return { email: String(profile.emailAddress ?? "").toLowerCase(), name: null };
  }
  const me = await api(token, `${GRAPH}?$select=mail,userPrincipalName,displayName`);
  return { email: String(me.mail || me.userPrincipalName || "").toLowerCase(), name: me.displayName ?? null };
}
