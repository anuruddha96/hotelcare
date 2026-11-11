// OAuth return for the HotelCare AI mailbox connection (Google and Microsoft).
// Validates the one-time state, exchanges the code, encrypts the tokens and
// sends the person back to the assistant.

import { createClient } from "npm:@supabase/supabase-js@2";
import { encryptToken, mailboxIdentity, type MailProvider, mailRedirectUri, providerConfig } from "../_shared/assistantMail.ts";

function page(message: string) {
  const safe = message.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HotelCare</title><body style="font-family:system-ui;padding:2rem;max-width:32rem;margin:auto"><p>${safe}</p></body>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

Deno.serve(async (req) => {
  try {
    const params = new URL(req.url).searchParams;
    const state = params.get("state");
    if (!state) return page("This sign-in link is not valid. Return to HotelCare and try again.");
    const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const { data: saved } = await service
      .from("assistant_mail_oauth_states")
      .select("*")
      .eq("state", state)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!saved) return page("This sign-in link has expired. Return to HotelCare and try again.");
    await service.from("assistant_mail_oauth_states").delete().eq("state", state);

    const back = new URL(saved.return_url);
    const fail = (reason: string) => {
      back.searchParams.set("mail", "error");
      back.searchParams.set("reason", reason);
      return Response.redirect(back.toString(), 302);
    };
    if (params.get("error")) return fail(params.get("error")!.slice(0, 60));
    const code = params.get("code");
    if (!code) return fail("no_code");

    const provider = saved.provider as MailProvider;
    const config = providerConfig(provider);
    if (!config.enabled) return fail("not_configured");
    const exchange = new URLSearchParams({
      code,
      client_id: config.clientId!,
      client_secret: config.clientSecret!,
      redirect_uri: mailRedirectUri(),
      grant_type: "authorization_code",
    });
    if (provider === "microsoft") exchange.set("scope", config.scopes.join(" "));
    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: exchange,
    });
    const token = await response.json().catch(() => ({}));
    if (!response.ok || !token.access_token) {
      console.error("mail token exchange failed", provider, response.status, String(token?.error ?? ""));
      return fail("token_exchange");
    }
    const granted = String(token.scope ?? "");
    const canSend = provider === "google" ? granted.includes("gmail.send") : /mail\.send/i.test(granted);
    const canRead = provider === "google" ? granted.includes("gmail.readonly") : /mail\.read/i.test(granted);
    if (!canSend || !canRead) return fail("missing_permissions");

    const identity = await mailboxIdentity(String(token.access_token), provider);
    if (!identity.email) return fail("no_email");

    const { data: existing } = await service
      .from("assistant_mail_accounts")
      .select("id,refresh_token_ciphertext")
      .eq("user_id", saved.user_id)
      .eq("provider", provider)
      .eq("email", identity.email)
      .maybeSingle();
    const refresh = token.refresh_token ? await encryptToken(String(token.refresh_token)) : existing?.refresh_token_ciphertext;
    if (!refresh) return fail("no_refresh_token");

    const { error } = await service.from("assistant_mail_accounts").upsert(
      {
        user_id: saved.user_id,
        organization_slug: saved.organization_slug,
        provider,
        email: identity.email,
        display_name: identity.name,
        refresh_token_ciphertext: refresh,
        access_token_ciphertext: await encryptToken(String(token.access_token)),
        access_token_expires_at: new Date(Date.now() + Number(token.expires_in ?? 3000) * 1000).toISOString(),
        scopes: granted.slice(0, 1000),
        status: "active",
      },
      { onConflict: "user_id,provider,email" },
    );
    if (error) throw error;
    await service.from("assistant_mail_log").insert({
      user_id: saved.user_id,
      organization_slug: saved.organization_slug,
      provider,
      from_email: identity.email,
      to_addresses: [],
      subject: "Mailbox connected",
      outcome: "connected",
    });
    back.searchParams.set("mail", "connected");
    return Response.redirect(back.toString(), 302);
  } catch (error) {
    console.error("assistant-mail-oauth-callback", error);
    return page("The mailbox could not be connected. Return to HotelCare and try again.");
  }
});
