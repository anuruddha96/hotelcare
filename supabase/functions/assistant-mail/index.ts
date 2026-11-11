// Mailbox connection and confirmed sending for the HotelCare AI.
//
// status        – which providers are set up and which mailboxes this person connected
// start_oauth   – sign-in link for Google or Microsoft (the person's own mailbox)
// disconnect    – removes a connected mailbox and its tokens
// draft         – current state of a draft card (pending / sent / …)
// send          – sends a draft after the person tapped Send on its card
// discard       – drops a draft
//
// The chat function only ever creates drafts. This is the one place an email
// leaves HotelCare, and only for the draft's owner, from their own mailbox.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  accessTokenFor,
  MailAuthError,
  type MailAccount,
  mailConfigured,
  type MailProvider,
  mailRedirectUri,
  providerConfig,
  sendDraft,
} from "../_shared/assistantMail.ts";
import { canUseMail, validateDraft } from "../_shared/mailFormat.ts";

const DAILY_SEND_LIMIT = 40;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/** A return link must point back at the app the request came from. */
function safeReturnUrl(value: unknown, origin: string | null): string | null {
  try {
    const url = new URL(String(value ?? ""));
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !local) return null;
    const allowed = (Deno.env.get("ASSISTANT_APP_ORIGINS") ?? "").split(",").map((o) => o.trim()).filter(Boolean);
    if (origin && url.origin === origin) return url.toString();
    if (allowed.includes(url.origin)) return url.toString();
    if (local && (!origin || new URL(origin).hostname === url.hostname)) return url.toString();
    return null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const authClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await authClient.auth.getUser(authHeader.slice(7));
    if (userError || !userData.user) return json({ error: "Invalid session" }, 401);
    const userId = userData.user.id;

    const { data: profile } = await service
      .from("profiles")
      .select("id,role,organization_slug")
      .eq("id", userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!profile) return json({ error: "Profile not found" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "status");

    if (action === "status") {
      const allowed = canUseMail(profile.role);
      const { data: accounts } = allowed
        ? await service
            .from("assistant_mail_accounts")
            .select("id,provider,email,display_name,status,created_at,last_used_at")
            .eq("user_id", userId)
            .order("created_at")
        : { data: [] };
      return json({
        allowed,
        configured: mailConfigured(),
        providers: {
          google: allowed && providerConfig("google").enabled,
          microsoft: allowed && providerConfig("microsoft").enabled,
        },
        accounts: accounts ?? [],
      });
    }

    if (!canUseMail(profile.role)) return json({ error: "Mailbox access is not part of your role." }, 403);

    if (action === "start_oauth") {
      const provider = body?.provider === "microsoft" ? "microsoft" : body?.provider === "google" ? "google" : null;
      if (!provider) return json({ error: "Choose Google or Microsoft." }, 400);
      const config = providerConfig(provider);
      if (!config.enabled || !mailConfigured()) return json({ error: "This mailbox provider is not set up yet." }, 409);
      const returnUrl = safeReturnUrl(body?.return_url, req.headers.get("Origin"));
      if (!returnUrl) return json({ error: "Invalid return address." }, 400);
      const state = crypto.randomUUID() + crypto.randomUUID();
      await service.from("assistant_mail_oauth_states").delete().lt("expires_at", new Date().toISOString());
      const { error } = await service.from("assistant_mail_oauth_states").insert({
        state,
        user_id: userId,
        organization_slug: profile.organization_slug,
        provider,
        return_url: returnUrl,
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      });
      if (error) throw error;
      const params = new URLSearchParams({
        client_id: config.clientId!,
        redirect_uri: mailRedirectUri(),
        response_type: "code",
        scope: config.scopes.join(" "),
        state,
      });
      if (provider === "google") {
        params.set("access_type", "offline");
        params.set("prompt", "consent");
        params.set("include_granted_scopes", "true");
      } else {
        params.set("response_mode", "query");
        params.set("prompt", "select_account");
      }
      return json({ ok: true, authorization_url: `${config.authorizeUrl}?${params}` });
    }

    if (action === "disconnect") {
      const accountId = String(body?.account_id ?? "");
      const { data: account } = await service
        .from("assistant_mail_accounts")
        .select("id,provider,email,organization_slug")
        .eq("id", accountId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!account) return json({ error: "Mailbox not found." }, 404);
      const { error } = await service.from("assistant_mail_accounts").delete().eq("id", account.id).eq("user_id", userId);
      if (error) throw error;
      await service.from("assistant_mail_log").insert({
        user_id: userId,
        organization_slug: account.organization_slug,
        provider: account.provider,
        from_email: account.email,
        to_addresses: [],
        subject: "Mailbox disconnected",
        outcome: "disconnected",
      });
      return json({ ok: true });
    }

    const draftId = String(body?.draft_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(draftId)) return json({ error: "Draft not found." }, 404);
    const { data: draft } = await service
      .from("assistant_mail_drafts")
      .select("*")
      .eq("id", draftId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!draft) return json({ error: "Draft not found." }, 404);

    if (action === "draft") {
      return json({ ok: true, status: draft.status, sent_at: draft.sent_at, error: draft.error, expired: Date.parse(draft.expires_at) < Date.now() });
    }

    if (action === "discard") {
      if (draft.status === "pending") {
        await service.from("assistant_mail_drafts").update({ status: "discarded" }).eq("id", draftId).eq("user_id", userId);
      }
      return json({ ok: true, status: draft.status === "pending" ? "discarded" : draft.status });
    }

    if (action !== "send") return json({ error: "Unsupported action" }, 400);
    if (draft.status === "sent") return json({ ok: true, status: "sent", already: true });
    if (draft.status !== "pending" && draft.status !== "failed") return json({ error: `This draft is ${draft.status}.` }, 409);
    if (Date.parse(draft.expires_at) < Date.now()) return json({ error: "This draft is older than 48 hours. Ask the assistant for a fresh one." }, 409);

    // The person may have edited the card; validate exactly what goes out.
    const checked = validateDraft({
      to: body?.to ?? draft.to_addresses,
      cc: body?.cc ?? draft.cc_addresses,
      subject: body?.subject ?? draft.subject,
      body: body?.body ?? draft.body,
    });
    if (!checked.ok) return json({ error: checked.error }, 400);

    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { count } = await service
      .from("assistant_mail_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("outcome", "sent")
      .gte("created_at", since);
    if ((count ?? 0) >= DAILY_SEND_LIMIT) return json({ error: `The limit of ${DAILY_SEND_LIMIT} assistant emails per day has been reached.` }, 429);

    // Claim the draft first so a double tap cannot send twice.
    const { data: claimed } = await service
      .from("assistant_mail_drafts")
      .update({ status: "sending", to_addresses: checked.draft.to, cc_addresses: checked.draft.cc, subject: checked.draft.subject, body: checked.draft.body, error: null })
      .eq("id", draftId)
      .eq("user_id", userId)
      .in("status", ["pending", "failed"])
      .select("id")
      .maybeSingle();
    if (!claimed) return json({ error: "This draft is already being sent." }, 409);

    const { data: account } = await service
      .from("assistant_mail_accounts")
      .select("*")
      .eq("id", draft.account_id)
      .eq("user_id", userId)
      .maybeSingle();
    const log = {
      user_id: userId,
      organization_slug: profile.organization_slug,
      provider: (account?.provider ?? "unknown") as MailProvider,
      from_email: account?.email ?? "",
      to_addresses: checked.draft.to,
      cc_addresses: checked.draft.cc,
      subject: checked.draft.subject,
      is_reply: Boolean(draft.reply_to_message_id),
      draft_id: draftId,
    };
    if (!account) {
      await service.from("assistant_mail_drafts").update({ status: "failed", error: "Mailbox disconnected" }).eq("id", draftId);
      return json({ error: "The mailbox for this draft is no longer connected." }, 409);
    }

    try {
      const token = await accessTokenFor(service, account as MailAccount);
      const providerId = await sendDraft(token, account as MailAccount, {
        ...checked.draft,
        reply_to_message_id: draft.reply_to_message_id,
        reply_thread_id: draft.reply_thread_id,
        reply_header_message_id: draft.reply_header_message_id,
      });
      const sentAt = new Date().toISOString();
      await service.from("assistant_mail_drafts").update({ status: "sent", sent_at: sentAt, provider_message_id: providerId }).eq("id", draftId);
      await service.from("assistant_mail_log").insert({ ...log, outcome: "sent" });
      return json({ ok: true, status: "sent", sent_at: sentAt, from: account.email });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : "Send failed";
      await service.from("assistant_mail_drafts").update({ status: "failed", error: message }).eq("id", draftId);
      await service.from("assistant_mail_log").insert({ ...log, outcome: "failed", error: message });
      return json({ error: error instanceof MailAuthError ? "Your mailbox needs to be reconnected before sending." : `The email was not sent: ${message}` }, error instanceof MailAuthError ? 409 : 502);
    }
  } catch (error) {
    console.error("assistant-mail error", error);
    return json({ error: "Mailbox request failed" }, 500);
  }
});
