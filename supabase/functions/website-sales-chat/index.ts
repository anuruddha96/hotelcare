/**
 * website-sales-chat — the HotelCare sales assistant in the "Try saying" area of hotelcare.app.
 *
 * Public (verify_jwt = false), called from the marketing site. Actions (POST JSON):
 *   message      visitor text -> assistant reply, tap-to-answer options, profile, next-step hints
 *   consent      e-mail + explicit Terms/Privacy consent -> stored with evidence, lead e-mail to sales
 *   complete     the visitor booked a demo -> no more reminders
 *   resume       signed link from a reminder e-mail -> conversation history, new browser secret
 *   preferences  signed link page on the website -> stop e-mails or delete the chat
 *   worker       cron (x-worker-secret): lead updates to sales, at most two reminders per visitor
 * One-click unsubscribe (RFC 8058): POST ?a=unsubscribe&s=<id>&t=<token>.
 *
 * Privacy: the browser holds a random session secret (only its SHA-256 is stored); contact data
 * typed into the chat is redacted before storage and before any AI call; nothing is e-mailed to
 * or about a visitor who has not ticked the consent box; IPs are stored only as a daily-rotating
 * salted hash for rate limiting. The AI provider is never named to the visitor.
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiBudget.ts";
import { salesChatJson } from "../_shared/salesChatAi.ts";
import {
  CONSENT_VERSION, MAX_REMINDERS, MAX_VISITOR_MESSAGES, SITE,
  type AgentTurn, type ChatMessage, type Profile, type SalesLang, type Stage,
  fallbackTurn, isSalesLang, leadEmail, leadSummaryPrompt, linkToken, mergeProfile, nextReminderAt,
  normalizeVisitorText, parseAgentTurn, randomSecret, recapPrompt, redactContacts, reminderEmail, sha256Hex,
  systemPrompt, timingSafeEqual, toDaytime, turnPrompt, validEmail, validLeadSummary, validRecap, verifyLinkToken,
} from "../_shared/salesChat.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

type Json = Record<string, any>;
// No generated types for these tables in this repo; rows are typed by the Session interface.
// deno-lint-ignore no-explicit-any
type Db = SupabaseClient<any, "public", any>;

const FUNCTION = "website-sales-chat";
const SENDER = "HotelCare.app <notifications@updates.hotelcare.app>";
const SALES_INBOX = Deno.env.get("WEBSITE_CHAT_SALES_INBOX") || "info@hotelcare.app";
const SITE_URL = (Deno.env.get("WEBSITE_CHAT_SITE_URL") || SITE).replace(/\/+$/, "");
const FUNCTION_URL = `${(Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "")}/functions/v1/${FUNCTION}`;
const DAILY_BUDGET_USD = Number(Deno.env.get("WEBSITE_CHAT_DAILY_BUDGET_USD") || "20");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_ORIGINS = [
  /^https:\/\/(www\.)?hotelcare\.app$/,
  /^https:\/\/[a-z0-9-]+\.lovable\.app$/,
  /^https:\/\/[a-z0-9-]+\.lovableproject\.com$/,
  /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/,
];

function corsFor(origin: string | null): Record<string, string> | null {
  if (!origin || !ALLOWED_ORIGINS.some((re) => re.test(origin))) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const json = (body: unknown, status = 200, cors: Record<string, string> | null = null) =>
  new Response(JSON.stringify(body), { status, headers: { ...(cors ?? {}), "Content-Type": "application/json", "Cache-Control": "no-store" } });

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

let dbClient: Db | null = null;
function db(): Db {
  dbClient ??= createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  return dbClient;
}

function background(task: Promise<unknown>) {
  const guarded = task.catch((e) => console.error(FUNCTION + " background task failed", e instanceof Error ? e.message : String(e)));
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(guarded);
}

// ------------------------------------------------------------------ request hygiene

function clientIp(req: Request): string {
  return (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || req.headers.get("x-real-ip") || "unknown").trim();
}

/** Rotates daily and is salted with a server secret, so it cannot be turned back into an IP. */
async function ipHash(req: Request): Promise<string> {
  const pepper = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").slice(-24);
  return (await sha256Hex(`${clientIp(req)}|${new Date().toISOString().slice(0, 10)}|${pepper}`)).slice(0, 32);
}

/** True when over the limit. A failing counter never blocks visitors. */
async function overLimit(bucket: string, windowSeconds: number, limit: number): Promise<boolean> {
  const { data, error } = await db().rpc("website_chat_hit", { p_bucket: bucket, p_window_seconds: windowSeconds, p_limit: limit });
  if (error) { console.error("website chat rate limit check failed:", error.message); return false; }
  return data === false;
}

let budgetCache: { at: number; over: boolean } | null = null;
async function overBudget(): Promise<boolean> {
  if (budgetCache && Date.now() - budgetCache.at < 60_000) return budgetCache.over;
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const { data, error } = await db().from("ai_usage_log").select("estimated_cost_usd").eq("function_name", FUNCTION).gte("created_at", since.toISOString()).limit(10000);
  const spent = error ? 0 : (data ?? []).reduce((sum: number, r: Json) => sum + Number(r.estimated_cost_usd ?? 0), 0);
  budgetCache = { at: Date.now(), over: spent >= DAILY_BUDGET_USD };
  if (budgetCache.over) console.warn("website chat daily AI budget reached; answering with the fallback");
  return budgetCache.over;
}

function cleanTimeZone(v: unknown): string | null {
  const tz = str(v, 64);
  if (!tz || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) return null;
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return tz; } catch { return null; }
}

function cleanPath(v: unknown): string | null {
  const p = str(v, 200).split(/[?#]/)[0];
  return /^\/[A-Za-z0-9/_\-.]*$/.test(p) ? p : null;
}

const ATTRIBUTION_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "msclkid", "referrer"];
function cleanAttribution(value: unknown): Json {
  const out: Json = {};
  if (!value || typeof value !== "object") return out;
  for (const key of ATTRIBUTION_KEYS) {
    const v = str((value as Json)[key], 200);
    if (!v) continue;
    if (key === "referrer") { try { out.referrer = new URL(v).host.slice(0, 120); } catch { /* keep nothing */ } }
    else out[key] = v;
  }
  return out;
}

// ------------------------------------------------------------------ sessions

interface Session {
  id: string; secret_hash: string; language: string; time_zone: string | null; page_path: string | null;
  attribution: Json; messages: ChatMessage[]; visitor_messages: number; profile: Profile; stage: Stage;
  contact_name: string | null; email: string | null; consent_at: string | null; consent_version: string | null;
  consent_text: string | null; consent_withdrawn_at: string | null; email_offers: number;
  lead_notified_at: string | null; lead_notified_messages: number; reminders_sent: number;
  next_reminder_at: string | null; completed_at: string | null; last_visitor_at: string;
}

async function loadSession(body: Json): Promise<Session | null> {
  const id = str(body.sessionId, 40);
  const secret = str(body.sessionSecret, 80);
  if (!UUID.test(id) || secret.length < 20) return null;
  const { data, error } = await db().from("website_chat_sessions").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return timingSafeEqual(await sha256Hex(secret), String(data.secret_hash)) ? data as Session : null;
}

const canEmail = (s: Pick<Session, "email" | "consent_at" | "consent_withdrawn_at">) => !!(s.email && s.consent_at && !s.consent_withdrawn_at);

function reminderPlan(s: Session, now: Date): string | null {
  if (!canEmail(s) || s.completed_at || s.stage === "closed") return null;
  const at = nextReminderAt(now, s.reminders_sent, s.time_zone, Math.random() * 30);
  return at ? at.toISOString() : null;
}

function prefill(s: Session, typedEmail: string | null) {
  return { name: s.contact_name || s.profile?.name || null, email: s.email || typedEmail || null, hotel: s.profile?.hotelName || null, rooms: s.profile?.rooms || null };
}

async function agentTurn(s: Session, messages: ChatMessage[], profile: Profile, event: "message" | "consent"): Promise<{ turn: AgentTurn; usage?: Json }> {
  if (await overBudget()) return { turn: fallbackTurn(s.language, event === "consent" ? "thanks" : "busy", canEmail(s)) };
  try {
    const result = await salesChatJson({
      system: systemPrompt(),
      prompt: turnPrompt({
        messages, profile, siteLanguage: s.language, page: s.page_path, emailCaptured: canEmail(s) || event === "consent",
        demoBooked: !!s.completed_at, askedEmailTimes: s.email_offers ?? 0, event,
      }),
      validate: (v) => parseAgentTurn(v) !== null,
    });
    await logAiUsage(db() as any, { functionName: FUNCTION, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
    return { turn: parseAgentTurn(result.value)!, usage: { model: result.model } };
  } catch (e) {
    console.warn(FUNCTION + " AI turn failed", e instanceof Error ? e.message : String(e));
    await logAiUsage(db() as any, { functionName: FUNCTION, model: null, ok: false, error: "both providers failed", costUsd: 0 });
    return { turn: fallbackTurn(s.language, event === "consent" ? "thanks" : "busy", canEmail(s)) };
  }
}

// ------------------------------------------------------------------ actions

async function actionMessage(req: Request, body: Json, cors: Record<string, string>) {
  const text = normalizeVisitorText(body.text);
  if (!text) return json({ error: "EMPTY" }, 400, cors);
  const hash = await ipHash(req);
  if (await overLimit(`msg:${hash}`, 600, 40) || await overLimit("msg:global", 86400, 5000)) return json({ error: "RATE_LIMIT" }, 429, cors);

  let session = await loadSession(body);
  let newSecret: string | null = null;
  if (!session) {
    if (await overLimit(`new:${hash}`, 3600, 10)) return json({ error: "RATE_LIMIT" }, 429, cors);
    newSecret = randomSecret();
    const { data, error } = await db().from("website_chat_sessions").insert({
      secret_hash: await sha256Hex(newSecret),
      language: isSalesLang(body.lang) ? body.lang : "en",
      time_zone: cleanTimeZone(body.tz),
      page_path: cleanPath(body.page),
      attribution: cleanAttribution(body.attribution),
      ip_hash: hash,
    }).select("*").single();
    if (error || !data) throw new Error("could not start a chat session: " + (error?.message ?? "no row"));
    session = data as Session;
  }

  const now = new Date();
  const { text: safeText, email: typedEmail } = redactContacts(text);
  const history: ChatMessage[] = Array.isArray(session.messages) ? session.messages : [];
  const messages: ChatMessage[] = [...history, { role: "visitor", text: safeText, at: now.toISOString() }];
  const { turn } = session.visitor_messages >= MAX_VISITOR_MESSAGES
    ? { turn: fallbackTurn(session.language, "limit", canEmail(session)) }
    : await agentTurn(session, messages, session.profile ?? {}, "message");

  const profile = mergeProfile(session.profile ?? {}, turn.profile);
  const emailCaptured = canEmail(session);
  const askEmail = !emailCaptured && (turn.askEmail || !!typedEmail) && (session.email_offers ?? 0) < 3;
  const stage: Stage = session.stage === "completed" ? "completed" : turn.stage;
  messages.push({ role: "agent", text: turn.reply, at: new Date().toISOString() });
  const language = turn.language && isSalesLang(turn.language) ? turn.language : session.language;
  const updated: Session = { ...session, profile, stage, language, messages, visitor_messages: session.visitor_messages + 1 };

  const { error } = await db().from("website_chat_sessions").update({
    messages: messages.slice(-80),
    visitor_messages: updated.visitor_messages,
    profile, stage, language,
    email_offers: (session.email_offers ?? 0) + (askEmail ? 1 : 0),
    last_visitor_at: now.toISOString(),
    updated_at: now.toISOString(),
    next_reminder_at: reminderPlan(updated, now),
    ...(emailCaptured ? {} : { erase_after: new Date(now.getTime() + 30 * 86400_000).toISOString() }),
  }).eq("id", session.id);
  if (error) throw new Error("could not save the chat: " + error.message);

  return json({
    sessionId: session.id,
    ...(newSecret ? { sessionSecret: newSecret } : {}),
    reply: turn.reply,
    quickReplies: turn.quickReplies,
    askEmail,
    offerDemo: turn.offerDemo || stage === "demo_offered",
    closed: stage === "closed",
    emailCaptured,
    prefill: prefill(updated, typedEmail),
  }, 200, cors);
}

async function actionConsent(req: Request, body: Json, cors: Record<string, string>) {
  const session = await loadSession(body);
  if (!session) return json({ error: "SESSION" }, 404, cors);
  // Bots fill the hidden field; answer like a success and store nothing.
  if (str(body.website, 200)) return json({ ok: true }, 200, cors);
  const email = validEmail(body.email);
  if (!email) return json({ error: "EMAIL" }, 400, cors);
  const consentText = str(body.consentText, 600);
  const consentVersion = /^[a-z0-9-]{3,60}$/.test(String(body.consentVersion)) ? String(body.consentVersion) : CONSENT_VERSION;
  if (body.consent !== true || consentText.length < 20) return json({ error: "CONSENT" }, 400, cors);
  if (await overLimit(`consent:${await ipHash(req)}`, 3600, 6)) return json({ error: "RATE_LIMIT" }, 429, cors);

  const now = new Date();
  const name = redactContacts(str(body.name, 80)).text.replace(/\[(e-mail|phone)\]/g, "").trim() || null;
  const consented: Session = {
    ...session, email, contact_name: name ?? session.contact_name, consent_at: now.toISOString(), consent_version: consentVersion,
    consent_text: consentText, consent_withdrawn_at: null, stage: session.stage === "chatting" ? "qualified" : session.stage,
  };
  const { turn } = await agentTurn(consented, session.messages ?? [], session.profile ?? {}, "consent");
  const messages: ChatMessage[] = [...(session.messages ?? []), { role: "agent", text: turn.reply, at: new Date().toISOString() }];
  const profile = mergeProfile(session.profile ?? {}, { ...turn.profile, ...(name ? { name } : {}) });
  const { error } = await db().from("website_chat_sessions").update({
    email, contact_name: consented.contact_name, consent_at: consented.consent_at, consent_version: consentVersion,
    consent_text: consentText, consent_withdrawn_at: null, stage: consented.stage, profile, messages: messages.slice(-80),
    ip_hash: await ipHash(req),
    next_reminder_at: reminderPlan({ ...consented, profile }, now),
    erase_after: new Date(now.getTime() + 365 * 86400_000).toISOString(),
    updated_at: now.toISOString(),
  }).eq("id", session.id);
  if (error) throw new Error("could not store consent: " + error.message);

  background(notifySales(session.id));
  return json({ ok: true, reply: turn.reply, quickReplies: turn.quickReplies, offerDemo: true }, 200, cors);
}

async function actionComplete(body: Json, cors: Record<string, string>) {
  const session = await loadSession(body);
  if (!session) return json({ ok: false }, 200, cors);
  const now = new Date().toISOString();
  const profile = { ...(session.profile ?? {}), demoBooked: true };
  const { error } = await db().from("website_chat_sessions").update({
    completed_at: now, stage: "completed", next_reminder_at: null, profile, updated_at: now,
    // Sales gets the chat context once more, with the booking flag, if the visitor consented.
    ...(canEmail(session) ? { lead_notified_messages: -1 } : {}),
  }).eq("id", session.id);
  if (error) throw new Error("could not complete the chat: " + error.message);
  if (canEmail(session)) background(notifySales(session.id));
  return json({ ok: true }, 200, cors);
}

async function actionResume(req: Request, body: Json, cors: Record<string, string>) {
  const id = str(body.id, 40);
  if (!UUID.test(id) || await overLimit(`resume:${await ipHash(req)}`, 3600, 20)) return json({ error: "LINK" }, 400, cors);
  if (!(await verifyLinkToken(await workerSecret(), "resume", id, body.token))) return json({ error: "LINK" }, 400, cors);
  const { data } = await db().from("website_chat_sessions").select("*").eq("id", id).maybeSingle();
  if (!data) return json({ error: "GONE" }, 404, cors);
  const session = data as Session;
  const secret = randomSecret();
  const { error } = await db().from("website_chat_sessions").update({ secret_hash: await sha256Hex(secret), updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error("could not resume: " + error.message);
  return json({
    sessionId: id, sessionSecret: secret, language: session.language,
    messages: (session.messages ?? []).slice(-30).map((m) => ({ role: m.role, text: m.text })),
    emailCaptured: canEmail(session), completed: !!session.completed_at, prefill: prefill(session, null),
  }, 200, cors);
}

async function withdraw(id: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db().from("website_chat_sessions").update({ consent_withdrawn_at: now, next_reminder_at: null, updated_at: now }).eq("id", id).is("consent_withdrawn_at", null);
  if (error) throw new Error("could not unsubscribe: " + error.message);
}

async function actionPreferences(body: Json, cors: Record<string, string>) {
  const id = str(body.id, 40);
  const op = body.op === "erase" ? "erase" : body.op === "unsubscribe" ? "unsubscribe" : null;
  if (!op || !UUID.test(id) || !(await verifyLinkToken(await workerSecret(), op, id, body.token))) return json({ error: "LINK" }, 400, cors);
  if (op === "unsubscribe") await withdraw(id);
  else {
    const { error } = await db().from("website_chat_sessions").delete().eq("id", id);
    if (error) throw new Error("could not delete the chat: " + error.message);
  }
  return json({ ok: true, op }, 200, cors);
}

/** RFC 8058 one-click unsubscribe. GET never changes anything, so link scanners cannot unsubscribe people. */
async function oneClickUnsubscribe(req: Request, url: URL): Promise<Response> {
  const text = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  const id = url.searchParams.get("s") || "";
  if (req.method !== "POST") return text("Manage HotelCare chat e-mails with the link at the bottom of the e-mail.");
  if (!UUID.test(id) || !(await verifyLinkToken(await workerSecret(), "unsubscribe", id, url.searchParams.get("t")))) return text("This link is not valid.", 400);
  await withdraw(id);
  return text("You will not receive further HotelCare chat e-mails.");
}

// ------------------------------------------------------------------ e-mail

let secretCache: string | null = null;
async function workerSecret(): Promise<string> {
  if (secretCache) return secretCache;
  const { data, error } = await db().rpc("website_chat_worker_secret");
  if (error || typeof data !== "string" || data.length < 32) throw new Error("website chat secret unavailable");
  secretCache = data;
  return data;
}

async function sendMail(opts: { to: string; subject: string; html: string; text: string; replyTo: string; idempotencyKey: string; headers?: Record<string, string> }) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not configured" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "Idempotency-Key": opts.idempotencyKey.slice(0, 256) },
    body: JSON.stringify({ from: SENDER, to: [opts.to], subject: opts.subject, html: opts.html, text: opts.text, reply_to: opts.replyTo, ...(opts.headers ? { headers: opts.headers } : {}) }),
  });
  const raw = await res.text();
  if (!res.ok) { console.error(`${FUNCTION} mail failed [${res.status}]: ${raw.slice(0, 300)}`); return { ok: false, error: `Resend ${res.status}` }; }
  let id: string | undefined; try { id = JSON.parse(raw)?.id; } catch { /* ignore */ }
  return { ok: true, id };
}

async function aiJson<T>(spec: { system: string; prompt: string }, validate: (v: unknown) => T | null): Promise<T | null> {
  if (await overBudget()) return null;
  try {
    const r = await salesChatJson({ ...spec, validate: (v) => validate(v) !== null, maxOutputTokens: 2048, temperature: 0.4 });
    await logAiUsage(db() as any, { functionName: FUNCTION, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens });
    return validate(r.value);
  } catch {
    return null;
  }
}

/** Sends (or re-sends) the lead e-mail to sales. Only for visitors who consented. */
async function notifySales(id: string): Promise<boolean> {
  const { data } = await db().from("website_chat_sessions").select("*").eq("id", id).maybeSingle();
  const s = data as Session | null;
  if (!s || !canEmail(s)) return false;
  if (s.lead_notified_at && s.lead_notified_messages >= s.visitor_messages) return false; // nothing new since the last e-mail
  const messages = s.messages ?? [];
  const summary = await aiJson(leadSummaryPrompt(messages, s.profile ?? {}), validLeadSummary);
  const mail = leadEmail({
    kind: s.lead_notified_at ? "update" : "new", id: s.id, email: s.email!, name: s.contact_name, language: s.language,
    profile: s.profile ?? {}, summary, messages, consentAt: s.consent_at!, consentVersion: s.consent_version ?? CONSENT_VERSION,
    consentText: s.consent_text ?? "", page: s.page_path, attribution: s.attribution ?? {},
  });
  const sent = await sendMail({ to: SALES_INBOX, subject: mail.subject, html: mail.html, text: mail.text, replyTo: s.email!, idempotencyKey: `wsc-lead-${s.id}-${s.visitor_messages}-${s.completed_at ? "done" : "open"}` });
  if (!sent.ok) return false;
  await db().from("website_chat_sessions").update({ lead_notified_at: new Date().toISOString(), lead_notified_messages: s.visitor_messages }).eq("id", s.id);
  return true;
}

async function sendReminder(s: Session): Promise<"sent" | "deferred" | "skipped" | "failed"> {
  const now = new Date();
  if (!canEmail(s) || s.completed_at || s.stage === "closed" || s.reminders_sent >= MAX_REMINDERS) {
    await db().from("website_chat_sessions").update({ next_reminder_at: null }).eq("id", s.id);
    return "skipped";
  }
  const daytime = toDaytime(now, s.time_zone, Math.random() * 30);
  if (daytime.getTime() > now.getTime()) {
    await db().from("website_chat_sessions").update({ next_reminder_at: daytime.toISOString() }).eq("id", s.id);
    return "deferred";
  }
  // Claim the row so two overlapping workers never send the same reminder.
  const { data: claimed } = await db().from("website_chat_sessions").update({ next_reminder_at: null })
    .eq("id", s.id).eq("reminders_sent", s.reminders_sent).not("next_reminder_at", "is", null).select("id");
  if (!claimed?.length) return "skipped";

  const lang: SalesLang = isSalesLang(s.language) ? s.language : "en";
  const number = (s.reminders_sent + 1) as 1 | 2;
  const secret = await workerSecret();
  const [resume, unsubscribe, erase] = await Promise.all([linkToken(secret, "resume", s.id), linkToken(secret, "unsubscribe", s.id), linkToken(secret, "erase", s.id)]);
  const recap = await aiJson(recapPrompt(s.messages ?? [], s.profile ?? {}, lang), validRecap);
  const q = (params: Record<string, string>) => new URLSearchParams(params).toString();
  const mail = reminderEmail({
    language: lang, name: s.contact_name || s.profile?.name || null, recap: recap?.recap ?? null, number,
    resumeUrl: `${SITE_URL}/?${q({ lng: lang, chat: `${s.id}.${resume}`, utm_source: "chat-reminder", utm_medium: "email" })}`,
    demoUrl: `${SITE_URL}/?${q({ lng: lang, demo: "1", utm_source: "chat-reminder", utm_medium: "email" })}`,
    prefsUrl: `${SITE_URL}/chat-preferences?${q({ s: s.id, u: unsubscribe, e: erase, lng: lang })}`,
    eraseUrl: `${SITE_URL}/chat-preferences?${q({ s: s.id, u: unsubscribe, e: erase, op: "erase", lng: lang })}`,
    consentDate: (s.consent_at ?? now.toISOString()).slice(0, 10),
  });
  const oneClick = `${FUNCTION_URL}?${q({ a: "unsubscribe", s: s.id, t: unsubscribe })}`;
  const sent = await sendMail({
    to: s.email!, subject: mail.subject, html: mail.html, text: mail.text, replyTo: SALES_INBOX,
    idempotencyKey: `wsc-reminder-${s.id}-${number}`,
    headers: { "List-Unsubscribe": `<${oneClick}>, <mailto:${SALES_INBOX}?subject=unsubscribe>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  });
  if (!sent.ok) {
    await db().from("website_chat_sessions").update({ next_reminder_at: new Date(now.getTime() + 3600_000).toISOString() }).eq("id", s.id);
    return "failed";
  }
  const after = { ...s, reminders_sent: number };
  await db().from("website_chat_sessions").update({
    reminders_sent: number, last_reminder_at: now.toISOString(), next_reminder_at: reminderPlan(after, now), updated_at: now.toISOString(),
  }).eq("id", s.id);
  return "sent";
}

async function worker(req: Request): Promise<Response> {
  const provided = req.headers.get("x-worker-secret") || "";
  if (!provided || !timingSafeEqual(provided, await workerSecret())) return json({ error: "FORBIDDEN" }, 403);
  const nowIso = new Date().toISOString();
  const idleBefore = new Date(Date.now() - 20 * 60_000).toISOString();
  const result = { leads: 0, reminders: { sent: 0, deferred: 0, skipped: 0, failed: 0 } };

  // lead_due is a generated column: consented, not withdrawn, and something new since the last lead e-mail.
  const { data: leads } = await db().from("website_chat_sessions").select("id")
    .eq("lead_due", true).lte("last_visitor_at", idleBefore).order("last_visitor_at").limit(30);
  for (const row of (leads ?? []) as Json[]) if (await notifySales(row.id)) result.leads++;

  const { data: due } = await db().from("website_chat_sessions").select("*")
    .not("email", "is", null).is("consent_withdrawn_at", null).is("completed_at", null)
    .not("next_reminder_at", "is", null).lte("next_reminder_at", nowIso).order("next_reminder_at").limit(20);
  for (const s of (due ?? []) as Session[]) result.reminders[await sendReminder(s)]++;
  return json({ ok: true, ...result });
}

// Optional, explicitly requested read-aloud. A separate fail-closed quota bounds
// the cost even for local FAQ responses that do not have a server chat session.
async function actionSpeech(req: Request, body: Json, cors: Record<string, string>) {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key || Deno.env.get("GEMINI_DISABLED") === "true" || Deno.env.get("WEBSITE_CHAT_VOICE_DISABLED") === "true") return json({ error: "VOICE_UNAVAILABLE" }, 503, cors);
  if (typeof body.text !== "string" || body.text.length > 1800) return json({ error: "VOICE_TEXT" }, 400, cors);
  const text = redactContacts(body.text).text.replace(/https?:\/\/\S+/gi, "").trim();
  if (!text || text.length > 1800) return json({ error: "VOICE_TEXT" }, 400, cors);
  const hash = await ipHash(req);
  // Do not use the message rate limiter's fail-open behavior for paid audio.
  for (const [bucket, seconds, limit] of [[`voice:${hash}`, 600, 8], ["voice:global", 86400, 100]] as const) {
    const { data, error } = await db().rpc("website_chat_hit", { p_bucket: bucket, p_window_seconds: seconds, p_limit: limit });
    if (error || data !== true) return json({ error: "VOICE_LIMIT" }, 429, cors);
  }
  if (await overBudget()) return json({ error: "VOICE_LIMIT" }, 429, cors);
  const model = "gemini-3.8-flash-tts";
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify({ model, store: false, input: [{type: "user_input", content: [{type: "text", text, annotations: [{type: "speech_metadata", style: "Warm, relaxed and professional hospitality consultant. Speak naturally with gentle emphasis, clear pronunciation, a comfortable conversational pace and brief pauses between ideas. Read the transcript exactly, in its original language."}]}]}], response_format: {type: "audio"}, generation_config: {speech_config: [{voice: "Sulafat"}]} }),
    });
    if (!res.ok) throw new Error("voice provider status " + res.status);
    const result = await res.json();
    const parts = (Array.isArray(result.steps) ? result.steps : []).filter((step: Json) => step.type === "model_output").flatMap((step: Json) => Array.isArray(step.content) ? step.content : []);
    const audio = parts.filter((part: Json) => part.type === "audio").at(-1);
    if (typeof audio?.data !== "string" || audio.data.length > 12_000_000) throw new Error("invalid audio response");
    const bytes = Uint8Array.from(atob(audio.data), c => c.charCodeAt(0));
    if (bytes.length < 44 || new TextDecoder().decode(bytes.slice(0,4)) !== "RIFF" || new TextDecoder().decode(bytes.slice(8,12)) !== "WAVE") throw new Error("invalid wave response");
    // Reserve conservatively in the existing budget log; independent request cap above.
    await logAiUsage(db(), { functionName: FUNCTION, model, costUsd: 0.20 });
    return new Response(bytes, { headers: {...cors, "Content-Type": "audio/wav", "Cache-Control": "no-store"} });
  } catch (e) {
    console.warn(FUNCTION + " voice unavailable", e instanceof Error ? e.message : "unknown");
    return json({ error: "VOICE_UNAVAILABLE" }, 503, cors);
  }
}

// ------------------------------------------------------------------ entry

Deno.serve(async (req) => {
  const cors = corsFor(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
  const url = new URL(req.url);
  try {
    if (url.searchParams.get("a") === "unsubscribe") return await oneClickUnsubscribe(req, url);
    if (req.method !== "POST") return json({ error: "METHOD" }, 405, cors);
    const raw = await req.text();
    if (raw.length > 16_000) return json({ error: "TOO_LARGE" }, 413, cors);
    let body: Json;
    try { body = JSON.parse(raw); } catch { return json({ error: "BAD_JSON" }, 400, cors); }
    if (!body || typeof body !== "object") return json({ error: "BAD_JSON" }, 400, cors);
    if (body.action === "worker") return await worker(req);
    if (!cors) return json({ error: "ORIGIN" }, 403);
    switch (body.action) {
      case "speech": return await actionSpeech(req, body, cors);
      case "message": return await actionMessage(req, body, cors);
      case "consent": return await actionConsent(req, body, cors);
      case "complete": return await actionComplete(body, cors);
      case "resume": return await actionResume(req, body, cors);
      case "preferences": return await actionPreferences(body, cors);
      default: return json({ error: "UNKNOWN_ACTION" }, 400, cors);
    }
  } catch (e) {
    console.error(FUNCTION + " failed:", e instanceof Error ? e.message : String(e));
    return json({ error: "UNAVAILABLE" }, 500, cors);
  }
});
