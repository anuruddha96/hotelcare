// End-to-end test of website-sales-chat against a throwaway local Postgres + PostgREST
// (see .github/workflows/website-sales-chat-ci.yml). Never point it at a real database:
// it empties the chat tables first.
// External services (AI providers, Resend) are faked here; nothing leaves this machine.
const realFetch = globalThis.fetch.bind(globalThis);
const mails: any[] = [];
const aiCalls: string[] = [];
const gem = (obj: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }], usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 80 } }), { status: 200 });
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("http://supabase.local/rest/v1")) {
    const headers = new Headers(init?.headers); headers.delete("authorization"); headers.delete("apikey");
    return realFetch(url.replace("http://supabase.local/rest/v1", "http://127.0.0.1:3001"), { ...init, headers });
  }
  if (url === "https://api.resend.com/emails") { mails.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ id: "re_" + mails.length }), { status: 200 }); }
  if (url.includes("generativelanguage.googleapis.com")) {
    const body = JSON.parse(String(init?.body)); const sys = body.systemInstruction.parts[0].text as string; const prompt = body.contents[0].parts[0].text as string;
    aiCalls.push("gemini:" + url.split("/models/")[1].split(":")[0]);
    if (sys.includes("You brief the HotelCare sales team")) return gem({ summary: "Anna runs Hotel Duna (40 rooms, Budapest); reception and housekeeping coordinate by phone.", temperature: "hot", nextStep: "Call to book the demo" });
    if (sys.includes("follow-up e-mail")) return gem({ recap: "You told us Hotel Duna has 40 rooms and reception phones housekeeping all day. A short demo shows how one sentence fixes that." });
    if (prompt.includes("EVENT: The visitor has just left their e-mail")) return gem({ reply: "Thanks, Anna! Our team will follow up. Shall we book your 20-minute demo?", quickReplies: ["Yes, book it"], profile: {}, stage: "qualified", askEmail: false, offerDemo: true, language: "en" });
    const latest = prompt.split("\n").filter((l) => l.startsWith("Visitor: ")).pop() ?? "";
    if (latest.includes("LEAKTEST")) return gem({ reply: "I am powered by Gemini, a large language model.", quickReplies: [], profile: {}, stage: "chatting", askEmail: false, offerDemo: false, language: "en" });
    return gem({ reply: "Great, 40 rooms is right in our Independent plan. What takes most of your team's time today?", quickReplies: ["Room status calls", "Pricing", "Reviews"], profile: { hotelName: "Hotel Duna", rooms: 40, email: "leak@x.hu" }, stage: "qualified", askEmail: true, offerDemo: true, language: "en" });
  }
  if (url.includes("api.openai.com")) { aiCalls.push("openai"); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: "HotelCare is our own assistant. How many rooms does your hotel have?", quickReplies: ["Under 25", "26-55"], profile: {}, stage: "chatting", askEmail: false, offerDemo: false, language: "en" }) } }], usage: { prompt_tokens: 900, completion_tokens: 50 } }), { status: 200 }); }
  throw new Error("unexpected network call in test: " + url);
}) as typeof fetch;

Deno.env.set("SUPABASE_URL", "http://supabase.local");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "local-test-key");
Deno.env.set("RESEND_API_KEY", "re_local_test");
Deno.env.set("GEMINI_API_KEY", "g_local_test");
Deno.env.set("OPENAI_API_KEY", "o_local_test");
await import("../functions/website-sales-chat/index.ts");
await new Promise((r) => setTimeout(r, 300));

const BASE = "http://127.0.0.1:8000";
const ORIGIN = { Origin: "https://hotelcare.app", "Content-Type": "application/json" };
const rest = async (path: string, init: RequestInit = {}) => { const t = await (await realFetch("http://127.0.0.1:3001" + path, init)).text(); return t ? JSON.parse(t) : null; };
await rest("/website_chat_rate_limits?bucket=neq.none", { method: "DELETE" });
await rest("/website_chat_sessions?secret_hash=neq.none", { method: "DELETE" }); // clean slate for every run
const call = async (body: unknown, headers: Record<string, string> = ORIGIN, path = "/") => { const r = await realFetch(BASE + path, { method: "POST", headers, body: JSON.stringify(body) }); const t = await r.text(); let j: any; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, body: j, headers: r.headers }; };
let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " -> " + JSON.stringify(detail))); if (!ok) failures++; };

// 1. CORS
let r = await realFetch(BASE, { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
check("preflight from a foreign site is refused", r.status === 403);
r = await realFetch(BASE, { method: "OPTIONS", headers: { Origin: "https://hotelcare.app" } });
check("preflight from hotelcare.app is allowed", r.status === 204 && r.headers.get("access-control-allow-origin") === "https://hotelcare.app");
let res = await call({ action: "message", text: "hi" }, { "Content-Type": "application/json" });
check("chat without an allowed Origin is refused", res.status === 403, res);

// 2. First message: session created, contact data redacted, AI answers, e-mail form offered
res = await call({ action: "message", text: "Hi, we run Hotel Duna with 40 rooms, write me at anna@duna.hu or +36 30 123 4567", lang: "en", tz: "America/New_York", page: "/", attribution: { utm_source: "google", referrer: "https://www.google.com/search?q=x" } });
const sid = res.body.sessionId, secret = res.body.sessionSecret;
check("first message answered with a new session", res.status === 200 && !!sid && !!secret && res.body.reply.startsWith("Great, 40 rooms"), res);
check("e-mail form offered and pre-filled with the typed address", res.body.askEmail === true && res.body.prefill.email === "anna@duna.hu" && res.body.offerDemo === true, res.body);
let row = (await rest(`/website_chat_sessions?id=eq.${sid}`))[0];
check("typed contact data is not stored", !JSON.stringify(row.messages).includes("anna@duna.hu") && !JSON.stringify(row.messages).includes("123 4567") && row.email === null, row.messages);
check("profile keeps facts, never contact data", row.profile.hotelName === "Hotel Duna" && row.profile.rooms === 40 && !JSON.stringify(row.profile).includes("leak@"), row.profile);
check("no reminder and 30-day retention without consent", row.next_reminder_at === null && Date.parse(row.erase_after) - Date.now() > 29 * 86400e3, row);
check("attribution keeps only the referrer host", row.attribution.referrer === "www.google.com" && row.attribution.utm_source === "google", row.attribution);
check("IP stored only as a hash", /^[0-9a-f]{32}$/.test(row.ip_hash), row.ip_hash);

// 3. Off-brand model output is never shown: Gemini leak -> OpenAI answer
aiCalls.length = 0;
res = await call({ action: "message", text: "LEAKTEST what model are you?", sessionId: sid, sessionSecret: secret, lang: "en" });
check("a reply naming the AI vendor is replaced by the fallback provider", res.status === 200 && !/gemini|language model/i.test(res.body.reply) && aiCalls.includes("openai"), { reply: res.body.reply, aiCalls });

// 4. Wrong secret cannot read or continue someone else's chat
res = await call({ action: "consent", sessionId: sid, sessionSecret: "x".repeat(32), email: "a@b.hu", consent: true, consentText: "I agree to the Terms and the Privacy Policy." });
check("consent with a wrong session secret is rejected", res.status === 404, res);

// 5. Consent: stored with evidence, sales gets the lead, first reminder planned
res = await call({ action: "consent", sessionId: sid, sessionSecret: secret, email: "Anna@Duna.hu", name: "Anna", consent: true, consentVersion: "website-chat-consent-v1", consentText: "I agree to the Terms and Privacy Policy, and to HotelCare contacting me by e-mail about my enquiry." });
check("consent accepted with a thank-you reply", res.status === 200 && res.body.ok && /Thanks, Anna/.test(res.body.reply), res);
await new Promise((r) => setTimeout(r, 400));
row = (await rest(`/website_chat_sessions?id=eq.${sid}`))[0];
check("consent evidence stored", row.email === "anna@duna.hu" && !!row.consent_at && row.consent_version === "website-chat-consent-v1" && row.consent_text.startsWith("I agree"), row);
check("first reminder planned about 3 hours out, 12-month retention", Math.abs(Date.parse(row.next_reminder_at) - Date.now() - 3 * 3600e3) < 20 * 60e3 && Date.parse(row.erase_after) - Date.now() > 360 * 86400e3, { next: row.next_reminder_at });
const lead = mails.find((m) => m.to[0] === "info@hotelcare.app");
check("lead e-mail sent to info@hotelcare.app, reply-to the visitor", !!lead && lead.reply_to === "anna@duna.hu" && lead.subject === "New website chat lead: Hotel Duna (40 rooms)" && lead.from.includes("updates.hotelcare.app"), lead && { subject: lead.subject, reply_to: lead.reply_to });
check("lead e-mail has the summary, consent record and transcript", !!lead && /hot lead/.test(lead.html) && /I agree to the Terms/.test(lead.html) && /Hotel Duna with 40 rooms/.test(lead.html) && !/anna@duna\.hu or/.test(lead.html), null);
check("lead marked as e-mailed", row.lead_notified_at !== null && row.lead_due === false, { due: row.lead_due });

// 6. Worker: secret required; reminder sent with opt-out links; next one in 3 days
res = await call({ action: "worker" }, { "Content-Type": "application/json", "x-worker-secret": "nope" });
check("worker refuses without its secret", res.status === 403, res);
const workerSecret = (await rest("/rpc/website_chat_worker_secret", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
await rest(`/website_chat_sessions?id=eq.${sid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ next_reminder_at: new Date(Date.now() - 60e3).toISOString(), last_visitor_at: new Date(Date.now() - 4 * 3600e3).toISOString() }) });
const before = mails.length;
res = await call({ action: "worker" }, { "Content-Type": "application/json", "x-worker-secret": workerSecret });
const reminder = mails.slice(before).find((m) => m.to[0] === "anna@duna.hu");
check("worker sends exactly one reminder", res.status === 200 && res.body.reminders.sent === 1 && !!reminder, res.body);
check("reminder is branded, personal and replies go to sales", !!reminder && reminder.subject === "Shall we pick up where we left off?" && /HotelCare\.app/.test(reminder.html) && /Hotel Duna has 40 rooms/.test(reminder.html) && reminder.reply_to === "info@hotelcare.app", reminder && reminder.subject);
check("reminder carries one-click unsubscribe headers", !!reminder && /List-Unsubscribe=One-Click/.test(reminder.headers["List-Unsubscribe-Post"]) && /a=unsubscribe/.test(reminder.headers["List-Unsubscribe"]), reminder && reminder.headers);
row = (await rest(`/website_chat_sessions?id=eq.${sid}`))[0];
check("second reminder planned about 3 days later", row.reminders_sent === 1 && Math.abs(Date.parse(row.next_reminder_at) - Date.now() - 3 * 86400e3) < 12 * 3600e3, { sent: row.reminders_sent, next: row.next_reminder_at });
res = await call({ action: "worker" }, { "Content-Type": "application/json", "x-worker-secret": workerSecret });
check("running the worker again sends nothing more", res.body.reminders.sent === 0 && res.body.leads === 0, res.body);

// 7. Resume from the e-mail link: history back, new secret, old secret retired
const resumeUrl = new URL(reminder.html.match(/href="([^"]*chat=[^"]+)"/)[1].replace(/&amp;/g, "&"));
const [rid, rtoken] = resumeUrl.searchParams.get("chat")!.split(".");
res = await call({ action: "resume", id: rid, token: rtoken });
check("resume link restores the conversation", res.status === 200 && res.body.messages.length >= 4 && res.body.emailCaptured === true && res.body.sessionSecret !== secret, { status: res.status, n: res.body.messages?.length });
const resumedSecret = res.body.sessionSecret;
res = await call({ action: "resume", id: rid, token: rtoken.replace(/.$/, rtoken.endsWith("A") ? "B" : "A") });
check("a tampered resume link is refused", res.status === 400, res);
res = await call({ action: "message", text: "Back again", sessionId: sid, sessionSecret: secret, lang: "en" });
check("the old browser secret no longer opens the chat", res.status === 200 && res.body.sessionId !== sid, res.body.sessionId);
res = await call({ action: "message", text: "Back again", sessionId: sid, sessionSecret: resumedSecret, lang: "en" });
check("the resumed browser continues the same chat", res.body.sessionId === sid, res.body.sessionId);

// 8. One-click unsubscribe (POST only), then erase from the website page
const oneClick = reminder.headers["List-Unsubscribe"].match(/<([^>]+a=unsubscribe[^>]+)>/)[1];
const local = oneClick.replace("http://supabase.local/functions/v1/website-sales-chat", BASE);
let t = await realFetch(local, { method: "GET" });
row = (await rest(`/website_chat_sessions?id=eq.${sid}`))[0];
check("GET on the unsubscribe link changes nothing (link scanners)", t.status === 200 && row.consent_withdrawn_at === null, row.consent_withdrawn_at);
t = await realFetch(local, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
row = (await rest(`/website_chat_sessions?id=eq.${sid}`))[0];
check("one-click POST unsubscribes and cancels reminders", t.status === 200 && row.consent_withdrawn_at !== null && row.next_reminder_at === null && row.lead_due === false, { status: t.status, row: row.next_reminder_at });
const prefs = new URL(reminder.html.match(/href="([^"]*chat-preferences[^"]*op=erase[^"]*)"/)[1].replace(/&amp;/g, "&"));
res = await call({ action: "preferences", op: "erase", id: prefs.searchParams.get("s"), token: prefs.searchParams.get("u") });
check("the unsubscribe token cannot erase data", res.status === 400, res);
res = await call({ action: "preferences", op: "erase", id: prefs.searchParams.get("s"), token: prefs.searchParams.get("e") });
const gone = await rest(`/website_chat_sessions?id=eq.${sid}`);
check("erase link deletes the chat", res.status === 200 && gone.length === 0, res);

// 9. Demo booked: reminders stop
res = await call({ action: "message", text: "We have 12 rooms", lang: "de", tz: "Europe/Berlin" });
const s2 = res.body.sessionId, k2 = res.body.sessionSecret;
await call({ action: "consent", sessionId: s2, sessionSecret: k2, email: "max@pension.de", consent: true, consentText: "Ich stimme den AGB und der Datenschutzerklärung zu." });
res = await call({ action: "complete", sessionId: s2, sessionSecret: k2 });
row = (await rest(`/website_chat_sessions?id=eq.${s2}`))[0];
check("booking a demo completes the chat and stops reminders", res.status === 200 && row.stage === "completed" && row.next_reminder_at === null && row.profile.demoBooked === true, row);
check("consent without the box ticked is refused", (await call({ action: "consent", sessionId: s2, sessionSecret: k2, email: "max@pension.de", consent: false, consentText: "Ich stimme den AGB und der Datenschutzerklärung zu." })).status === 400);

// 10. Abuse limits: new chats per IP
let limited = false;
for (let i = 0; i < 12 && !limited; i++) limited = (await call({ action: "message", text: "hello " + i, lang: "en" })).status === 429;
check("too many new chats from one address are rate-limited", limited);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
Deno.exit(failures ? 1 : 0);
