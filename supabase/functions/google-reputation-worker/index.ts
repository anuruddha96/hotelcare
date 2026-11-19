import { generateLowCostText } from "../_shared/lowCostAi.ts";
import { createClient } from "npm:@supabase/supabase-js@2.78.0";
import { buildCuratedReply, classifyReview, requiresCarefulReview } from "../_shared/reputation-replies.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-worker-secret",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const b64 = (a: Uint8Array) => {
  let s = "";
  for (const b of a) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function aesKey() {
  const raw = Deno.env.get("GOOGLE_BUSINESS_TOKEN_KEY");
  if (!raw) throw new Error("GOOGLE_BUSINESS_TOKEN_KEY missing");
  let bytes: Uint8Array;
  try {
    bytes = unb64(raw);
  } catch {
    bytes = new TextEncoder().encode(raw);
  }
  if (bytes.length !== 32) bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return crypto.subtle.importKey("raw", bytes as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function enc(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), new TextEncoder().encode(value)),
  );
  return `${b64(iv)}.${b64(encrypted)}`;
}

async function dec(value: string) {
  const [ivText, bodyText] = value.split(".");
  if (!ivText || !bodyText) throw new Error("Invalid encrypted token");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(ivText) },
    await aesKey(),
    unb64(bodyText),
  );
  return new TextDecoder().decode(decrypted);
}

const rating = (value: unknown) => {
  if (typeof value === "number") return Math.max(1, Math.min(5, Math.round(value)));
  const text = String(value || "").toUpperCase();
  return ({ ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 } as Record<string, number>)[text] || 5;
};

const toneInstruction: Record<string, string> = {
  warm_professional: "warm, professional and human",
  friendly_concise: "friendly, concise and conversational",
  formal: "formal, polished and respectful",
  luxury_hospitality: "refined, gracious and hospitality-focused without sounding exaggerated",
};

function isQuotaPending(message?: string | null) {
  return /awaiting google approval|quota exceeded|requests per minute|quota metric|no usable request quota/i.test(
    String(message || ""),
  );
}

function shouldBackoff(connection: any) {
  if (!isQuotaPending(connection?.last_error) || !connection?.updated_at) return false;
  const updated = new Date(connection.updated_at).getTime();
  return Number.isFinite(updated) && Date.now() - updated < 6 * 60 * 60 * 1000;
}

function friendlyGoogleError(status: number, rawMessage: string) {
  const message = String(rawMessage || "").trim();
  const lower = message.toLowerCase();
  if (
    status === 429 &&
    (lower.includes("quota exceeded") || lower.includes("requests per minute") || lower.includes("quota metric"))
  ) {
    return `Google Business Profile API access is awaiting Google approval: ${message.slice(0, 420)}`;
  }
  if (status === 403) return `Google Business Profile API access was denied by Google: ${message.slice(0, 420)}`;
  return `Google Business Profile API ${status}: ${message.slice(0, 420)}`;
}

/**
 * Auto-reply policy: 4–5★ low-risk reviews no older than AUTO_REPLY_WINDOW_DAYS
 * are answered automatically for venues that have auto-reply on. Anything
 * older stays a draft for managers to reply manually (the explicitly
 * authorized historical backfill path is separate and unchanged).
 */
const AUTO_REPLY_WINDOW_DAYS = 7;

function autoEligible(location: any, stars: number, risk: string, reviewTime: string | null) {
  if (!location?.auto_reply_enabled || !location?.auto_reply_enabled_at) return false;
  if (risk !== "low" || location.reply_mode === "draft_only") return false;
  const minimum = Math.max(1, Math.min(5, Number(location.min_auto_rating || 4)));
  const approvalFloor = Math.max(1, Math.min(5, Number(location.require_approval_below_rating || 4)));
  if (stars < approvalFloor) return false;
  if (location.reply_mode === "auto_positive" && stars < Math.max(4, minimum)) return false;
  if (location.reply_mode === "auto_all" && stars < minimum) return false;
  const reviewMs = new Date(reviewTime || "").getTime();
  if (!Number.isFinite(reviewMs)) return false;
  // Fresh reviews only: within the rolling window, never older.
  if (Date.now() - reviewMs > AUTO_REPLY_WINDOW_DAYS * 86_400_000) return false;
  const delayMs = Math.max(0, Math.min(1440, Number(location.auto_reply_delay_minutes || 0))) * 60_000;
  return Date.now() - reviewMs >= delayMs;
}

/**
 * Listings added to (or shared with) the connected Google account after the
 * initial setup used to stay invisible until a manager re-ran discovery by
 * hand, so their reviews were never synced or answered. The scheduled worker
 * now checks each connection for new listings on this interval. New listings
 * are added with auto-reply OFF (column defaults); publishing still requires
 * explicit consent in Reputation settings.
 */
const LOCATION_DISCOVERY_INTERVAL_MS = 6 * 3_600_000;

function locationDiscoveryDue(connection: any) {
  const checked = new Date(connection?.location_discovery_checked_at || "").getTime();
  return !Number.isFinite(checked) || Date.now() - checked >= LOCATION_DISCOVERY_INTERVAL_MS;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRole);

  // Scheduled runs use a single-location round-robin to spread Google API calls.
  // Manual/admin invocations without this flag retain the existing full sync behavior.
  const requestBody = await req.json().catch(() => ({}));
  const roundRobin = requestBody?.mode === "round_robin";
  // On-demand listing discovery only (no review sync), e.g. right after a
  // listing was shared with the connected Google account.
  const discoverOnly = requestBody?.mode === "discover_locations";

  const providedSecret = req.headers.get("x-worker-secret") || "";
  const { data: expectedSecret, error: secretError } = await admin.rpc("get_google_reputation_worker_secret");
  if (secretError || !safeEqual(providedSecret, String(expectedSecret || ""))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const { data: run, error: runError } = await admin
    .from("google_reputation_worker_runs")
    .insert({ status: "running" })
    .select("id")
    .single();
  if (runError) return json({ error: runError.message }, 500);

  let connectionsChecked = 0;
  let locationsChecked = 0;
  let reviewsSynced = 0;
  let draftsGenerated = 0;
  let repliesPublished = 0;
  let historicalPublished = 0;
  const errors: Array<Record<string, unknown>> = [];
  const discovery: Array<Record<string, unknown>> = [];

  async function audit(review: any, eventType: string, replyText: string | null = null, metadata: Record<string, unknown> = {}) {
    const { error: auditError } = await admin.from("google_review_reply_events").insert({
      organization_id: review.organization_id,
      hotel_id: review.hotel_id || null,
      google_location_id: review.google_location_id || null,
      review_id: review.id,
      actor_user_id: null,
      event_type: eventType,
      reply_text: replyText,
      metadata: { worker: true, ...metadata },
    });
    if (auditError) {
      errors.push({ review_id: review.id, event_type: eventType, error: `Audit insert failed: ${auditError.message}` });
    }
  }

  const tokenCache = new Map<string, string>();
  async function tokenFor(connection: any) {
    const cached = tokenCache.get(connection.id);
    if (cached) return cached;
    const token = await freshTokenFor(connection);
    tokenCache.set(connection.id, token);
    return token;
  }

  async function freshTokenFor(connection: any) {
    if (
      connection.access_token_ciphertext &&
      connection.access_token_expires_at &&
      new Date(connection.access_token_expires_at).getTime() > Date.now() + 90_000
    ) {
      return await dec(connection.access_token_ciphertext);
    }
    const refresh = await dec(connection.refresh_token_ciphertext);
    const clientId = Deno.env.get("GOOGLE_BUSINESS_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_BUSINESS_CLIENT_SECRET");
    if (!clientId || !clientSecret) throw new Error("Google OAuth credentials are missing");
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refresh,
        grant_type: "refresh_token",
      }),
    });
    if (!response.ok) throw new Error(`Google token refresh ${response.status}: ${(await response.text()).slice(0, 240)}`);
    const result = await response.json();
    const expiresAt = new Date(Date.now() + Number(result.expires_in || 3600) * 1000).toISOString();
    await admin
      .from("google_business_connections")
      .update({
        access_token_ciphertext: await enc(String(result.access_token)),
        access_token_expires_at: expiresAt,
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", connection.id);
    return String(result.access_token);
  }

  async function googleFetch(
    connection: any,
    accessToken: string,
    target: string,
    init: RequestInit = {},
    // Discovery failures must not put review syncing into quota backoff.
    options: { recordError?: boolean } = {},
  ) {
    const response = await fetch(target, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
    const text = await response.text();
    let payload: any = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    if (!response.ok) {
      const message = friendlyGoogleError(response.status, payload?.error?.message || text || "Google API error");
      if (options.recordError !== false) {
        await admin
          .from("google_business_connections")
          .update({ last_error: message, updated_at: new Date().toISOString() })
          .eq("id", connection.id);
      }
      throw new Error(message);
    }
    return payload;
  }

  /**
   * Imports Google listings the connection can see but HotelCare does not
   * know yet. Existing rows are never modified (a manager may have changed or
   * deactivated them); new rows get the safe column defaults (draft only,
   * auto-reply off) and show up in Reputation for mapping and consent.
   */
  async function discoverLocations(connection: any) {
    const accessToken = await tokenFor(connection);
    const accounts: any[] = [];
    let accountToken = "";
    do {
      const params = new URLSearchParams({ pageSize: "20" });
      if (accountToken) params.set("pageToken", accountToken);
      const page = await googleFetch(connection, accessToken,
        `https://mybusinessaccountmanagement.googleapis.com/v1/accounts?${params.toString()}`, {}, { recordError: false });
      accounts.push(...(page.accounts || []));
      accountToken = page.nextPageToken || "";
    } while (accountToken && accounts.length < 200);

    const { data: known, error: knownError } = await admin
      .from("google_business_locations")
      .select("google_location_name")
      .eq("connection_id", connection.id);
    if (knownError) throw knownError;
    const knownNames = new Set((known || []).map((row: any) => String(row.google_location_name)));

    let listingsSeen = 0;
    const added: Array<{ id: string; title: string }> = [];
    for (const account of accounts) {
      if (!account?.name) continue;
      let locationToken = "";
      do {
        const params = new URLSearchParams({ readMask: "name,title,storeCode,metadata", pageSize: "100" });
        if (locationToken) params.set("pageToken", locationToken);
        const page = await googleFetch(connection, accessToken,
          `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?${params.toString()}`,
          {}, { recordError: false });
        for (const listing of page.locations || []) {
          listingsSeen++;
          const name = String(listing?.name || "");
          if (!name || knownNames.has(name)) continue;
          knownNames.add(name);
          const { data: inserted, error: insertError } = await admin
            .from("google_business_locations")
            .insert({
              connection_id: connection.id,
              organization_id: connection.organization_id,
              google_account_name: account.name,
              google_location_name: name,
              google_location_title: listing.title || name,
              place_id: listing.metadata?.placeId || null,
              store_code: listing.storeCode || null,
              is_active: true,
            })
            .select("id,google_location_title")
            .single();
          if (insertError) {
            // A concurrent manual discovery may have inserted it first.
            if (insertError.code === "23505") continue;
            throw insertError;
          }
          added.push({ id: inserted.id, title: inserted.google_location_title });
          console.log("google-reputation-discovery new listing", JSON.stringify({
            connection_id: connection.id, location_id: inserted.id, title: inserted.google_location_title,
          }));
        }
        locationToken = page.nextPageToken || "";
      } while (locationToken);
    }
    return { accounts: accounts.length, listings_seen: listingsSeen, added };
  }

  async function runLocationDiscovery(connection: any) {
    try {
      const result = await discoverLocations(connection);
      discovery.push({ connection_id: connection.id, ...result });
    } catch (error) {
      // Recorded on the run, but never as a connection error: a discovery
      // problem must not stop or back off review syncing.
      errors.push({
        discovery_connection_id: connection.id,
        error: `Location discovery: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      // Stamp attempts too, so a persistent failure retries on the interval
      // instead of on every two-minute tick.
      const { error: stampError } = await admin
        .from("google_business_connections")
        .update({ location_discovery_checked_at: new Date().toISOString() })
        .eq("id", connection.id);
      if (stampError) console.error("google-reputation-discovery stamp", stampError.message);
    }
  }

  // Shared by draft generation and automatic publishing so both always pick
  // the same deterministic curated wording for a review.
  function curatedReplyFor(review: any, location: any) {
    return buildCuratedReply({
      reviewId: String(review.google_review_name || review.id),
      rating: Number(review.star_rating || 5),
      comment: review.comment || "",
      reviewerName: review.reviewer_display_name,
      venueName: String(location.reply_brand_name || location.google_location_title || "our business"),
      venueCategory: location.business_category,
      venueContext: location.brand_context,
      signature: location.reply_signature,
      languageMode: location.reply_language_mode,
    });
  }

  async function generateDraft(review: any, location: any) {
    const brand = String(location.reply_brand_name || location.google_location_title || "our business");
    const curated = curatedReplyFor(review, location);
    if (curated && String(review.ai_risk_level || "low") === "low") return curated.text;
    if (!Deno.env.get("OPENAI_API_KEY") && !Deno.env.get("GEMINI_API_KEY"))
      throw new Error("AI providers not configured");
    const tone = toneInstruction[location.reply_tone] || toneInstruction.warm_professional;
    const languageInstruction =
      location.reply_language_mode === "english"
        ? "Reply in English."
        : location.reply_language_mode === "hungarian"
          ? "Reply in Hungarian."
          : "Reply in the same language as the guest when identifiable; otherwise English.";
    const signature = location.reply_signature ? ` End naturally with this signature: ${location.reply_signature}.` : "";
    const context = location.brand_context
      ? ` Factual property context you may use only when directly relevant: ${location.brand_context}`
      : "";
    const prompt = `Write a brief public Google review reply for "${brand}" (venue type: ${location.business_category || "other"}).
Google listing title, for locating reviews ONLY: ${location.google_location_title}.
Rating: ${review.star_rating}/5. Guest review: ${String(review.comment || "").slice(0, 1800)}.
Style: ${tone}. ${languageInstruction}
Write 1-3 natural sentences, normally 20-55 words. Use ONLY the exact business name "${brand}" if naming the venue. Do NOT infer a hotel stay, conference event, restaurant meal or museum visit from the Google listing title. Only refer to services actually mentioned by the guest. Never promote adjacent venues or create details about what happened. Do not invent refunds, investigations, guarantees or follow-ups. Acknowledge negative feedback without admitting unverified accusations.${signature}${context}
HotelCare risk level: ${review.ai_risk_level || "medium"}.`;
    const generated = await generateLowCostText({
      task: "public",
      prompt,
      instructions: "Write accurate concise human review replies for the correct venue; only output the reply. Never invent facts, compensation or promises.",
      fallbackModel: Deno.env.get("OPENAI_FALLBACK_MODEL") || "gpt-4o-mini",
      maxOutputTokens: 512,
      validate: (text) => text.trim().length >= 8 && text.length <= 4096,
    });
    const draft = generated.text;
    return draft;
  }

  try {
    const { data: connections, error: connectionsError } = await admin
      .from("google_business_connections")
      .select("*")
      .eq("status", "active")
      .order("updated_at", { ascending: false });
    if (connectionsError) throw connectionsError;

    if (discoverOnly) {
      const targetConnection = requestBody?.connection_id ? String(requestBody.connection_id) : "";
      for (const connection of connections || []) {
        if (targetConnection && connection.id !== targetConnection) continue;
        connectionsChecked++;
        await runLocationDiscovery(connection);
      }
      const status = errors.length ? "partial" : "completed";
      await admin.from("google_reputation_worker_runs").update({
        finished_at: new Date().toISOString(),
        status,
        connections_checked: connectionsChecked,
        errors,
      }).eq("id", run.id);
      return json({ ok: true, status, connections_checked: connectionsChecked, discovery, errors });
    }

    // All organizations share one rotating slot: one active Google listing
    // per two-minute cron tick, regardless of how many OAuth connections exist.
    let selectedLocation: { id: string; connection_id: string } | null = null;
    if (roundRobin) {
      const { data: activeLocations, error: activeLocationsError } = await admin
        .from("google_business_locations")
        .select("id,connection_id")
        .eq("is_active", true)
        .order("id");
      if (activeLocationsError) throw activeLocationsError;
      const activeConnectionIds = new Set((connections || []).map((connection: any) => connection.id));
      const candidates = (activeLocations || []).filter((location: any) => activeConnectionIds.has(location.connection_id));
      if (candidates.length > 0) {
        selectedLocation = candidates[Math.floor(Date.now() / 120_000) % candidates.length];
      }
    }

    for (const connection of connections || []) {
      if (roundRobin && connection.id !== selectedLocation?.connection_id) continue;
      connectionsChecked++;
      if (shouldBackoff(connection)) continue;
      try {
        const accessToken = await tokenFor(connection);
        let locationsQuery = admin
          .from("google_business_locations")
          .select("*")
          .eq("connection_id", connection.id)
          .eq("is_active", true);
        if (roundRobin && selectedLocation) locationsQuery = locationsQuery.eq("id", selectedLocation.id);
        const { data: locations, error: locationsError } = await locationsQuery;
        if (locationsError) throw locationsError;

        for (const location of locations || []) {
          locationsChecked++;
          try {
            if (location.auto_backfill_active &&
                (!location.auto_backfill_authorized_at ||
                 Date.now() - new Date(location.auto_backfill_authorized_at).getTime() > 48 * 3_600_000)) {
              await admin.from("google_business_locations").update({ auto_backfill_active: false })
                .eq("id", location.id);
              location.auto_backfill_active = false;
            }
            const query = new URLSearchParams({ pageSize: "50", orderBy: "updateTime desc" });
            const response = await googleFetch(
              connection,
              accessToken,
              `https://mybusiness.googleapis.com/v4/${location.google_account_name}/${location.google_location_name}/reviews?${query.toString()}`,
            );

            await admin.from("google_business_locations")
              .update({
                google_total_review_count: Number.isFinite(Number(response.totalReviewCount))
                  ? Number(response.totalReviewCount) : location.google_total_review_count,
                google_average_rating: Number.isFinite(Number(response.averageRating))
                  ? Number(response.averageRating) : location.google_average_rating,
                google_review_stats_updated_at: new Date().toISOString(),
              }).eq("id", location.id);
            for (const googleReview of response.reviews || []) {
              const stars = rating(googleReview.starRating);
              const comment = googleReview.comment || null;
              const analysis = classifyReview(stars, comment || "");
              const reviewName = String(googleReview.name || "");
              if (!reviewName) continue;

              const { data: existing } = await admin
                .from("google_reviews")
                .select("*")
                .eq("google_review_name", reviewName)
                .maybeSingle();

              const updateTime = googleReview.updateTime || googleReview.createTime || null;
              // Postgres normalizes timestamptz (+00:00) while Google sends Z.
              // Comparing those strings regenerated the same 20 drafts every run.
              const existingTime = Date.parse(String(existing?.review_update_time || ""));
              const incomingTime = Date.parse(String(updateTime || ""));
              const timeChanged = Number.isFinite(existingTime) && Number.isFinite(incomingTime)
                ? existingTime !== incomingTime
                : String(existing?.review_update_time || "") !== String(updateTime || "");
              const changed = Boolean(
                existing && ((existing.comment || null) !== comment || timeChanged),
              );
              const hasGoogleReply = Boolean(googleReview.reviewReply?.comment);
              const retainedDraft = !changed ? existing?.ai_draft || null : null;
              const replyStatus = hasGoogleReply ? "published" : retainedDraft ? "draft" : "unreplied";
              const origin = hasGoogleReply
                ? (["automatic", "manager", "bulk"].includes(existing?.reply_origin) ? existing.reply_origin : "google")
                : "unknown";
              const eligible = autoEligible(location, stars, analysis.risk, googleReview.createTime || updateTime) &&
                !requiresCarefulReview(comment || "");
              const reviewMs = new Date(googleReview.createTime || "").getTime();
              const historicalEligible = Boolean(location.auto_backfill_active) &&
                historicalPublished < 5 &&
                Number.isFinite(reviewMs) &&
                reviewMs >= new Date(location.auto_backfill_cutoff || "").getTime() &&
                reviewMs <= new Date(location.auto_backfill_upper_bound || "").getTime() &&
                stars >= 4 && analysis.risk === "low" &&
                !requiresCarefulReview(comment || "") && !existing?.draft_edited_at &&
                !eligible;

              const row = {
                organization_id: connection.organization_id,
                hotel_id: location.hotel_id,
                google_location_id: location.id,
                google_review_name: reviewName,
                google_review_id: googleReview.reviewId || reviewName.split("/").pop(),
                reviewer_display_name: googleReview.reviewer?.displayName || null,
                reviewer_profile_photo_url: googleReview.reviewer?.profilePhotoUrl || null,
                star_rating: stars,
                comment,
                review_create_time: googleReview.createTime || null,
                review_update_time: updateTime,
                google_reply_comment: googleReview.reviewReply?.comment || null,
                google_reply_update_time: googleReview.reviewReply?.updateTime || null,
                ai_sentiment: analysis.sentiment,
                ai_categories: analysis.categories,
                ai_summary: analysis.summary,
                ai_risk_level: analysis.risk,
                ai_confidence: analysis.confidence,
                ai_draft: retainedDraft,
                ai_draft_generated_at: retainedDraft ? existing?.ai_draft_generated_at || null : null,
                draft_edited_at: retainedDraft ? existing?.draft_edited_at || null : null,
                draft_edited_by: retainedDraft ? existing?.draft_edited_by || null : null,
                reply_status: replyStatus,
                reply_origin: origin,
                auto_reply_eligible: eligible || historicalEligible,
                raw: googleReview,
                updated_at: new Date().toISOString(),
              };

              const { data: saved, error: saveError } = await admin
                .from("google_reviews")
                .upsert(row, { onConflict: "google_review_name" })
                .select("*")
                .single();
              if (saveError) throw saveError;
              reviewsSynced++;
              if (stars <= 3 && !existing && new Date(googleReview.createTime || "").getTime() >= Date.now() - 14 * 86_400_000) {
                const { error: alertError } = await admin.from("google_reputation_alerts").upsert({
                  organization_id: connection.organization_id,
                  google_location_id: location.id,
                  google_review_name: reviewName,
                  review_id: saved.id,
                  star_rating: stars,
                  review_excerpt: (comment || "").slice(0, 600),
                }, { onConflict: "organization_id,google_review_name", ignoreDuplicates: true });
                if (alertError) console.error("reputation-alert", alertError.message);
              }
              if (hasGoogleReply) {
                if (existing && existing.reply_status !== "published") {
                  await audit(saved, "sync_detected_reply", googleReview.reviewReply.comment, { source: "google" });
                }
                continue;
              }

              let draft = retainedDraft;
              if ((eligible || historicalEligible) && !existing?.draft_edited_at) {
                // Automatic publishing only uses the vetted, business-specific
                // zero-cost reply pool. This also replaces an earlier AI draft
                // written while the review was still held for manual review.
                const curated = curatedReplyFor(saved, location);
                if (curated && curated.text !== draft) {
                  const replacedDraft = Boolean(draft);
                  draft = curated.text;
                  await admin.from("google_reviews")
                    .update({ ai_draft: draft, ai_draft_generated_at: new Date().toISOString(),
                      reply_status: "draft", updated_at: new Date().toISOString() })
                    .eq("id", saved.id);
                  await audit(saved, "draft_generated", draft, {
                    risk: analysis.risk,
                    method: curated.method,
                    template_id: curated.templateId,
                    replaced_previous_draft: replacedDraft,
                  });
                }
              }
              if (!draft && draftsGenerated < 20) {
                draft = await generateDraft(saved, location);
                await admin
                  .from("google_reviews")
                  .update({
                    ai_draft: draft,
                    ai_draft_generated_at: new Date().toISOString(),
                    reply_status: "draft",
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", saved.id);
                await audit(saved, "draft_generated", draft, {
                  risk: analysis.risk,
                  tone: location.reply_tone || "warm_professional",
                  language_mode: location.reply_language_mode || "match_guest",
                });
                draftsGenerated++;
              }

              if ((eligible || historicalEligible) && draft) {
                // Read back Google's latest state before publishing: never
                // overwrite a response added outside HotelCare in the meantime.
                const live = await googleFetch(connection, accessToken,
                  `https://mybusiness.googleapis.com/v4/${reviewName}`);
                if (live?.reviewReply?.comment) continue;
                const isHistorical = historicalEligible && !eligible;
                const publishResult = await googleFetch(
                  connection,
                  accessToken,
                  `https://mybusiness.googleapis.com/v4/${reviewName}/reply`,
                  { method: "PUT", body: JSON.stringify({ comment: draft }) },
                );
                await admin
                  .from("google_reviews")
                  .update({
                    google_reply_comment: draft,
                    google_reply_update_time: publishResult.updateTime || new Date().toISOString(),
                    reply_status: "published",
                    reply_origin: "automatic",
                    auto_reply_kind: isHistorical ? "historical_14d" : "new_positive",
                    replied_at: new Date().toISOString(),
                    replied_by: null,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", saved.id);
                await audit(saved, "auto_published", draft, {
                  auto_reply_kind: isHistorical ? "historical_14d" : "new_positive",
                  google_update_time: publishResult.updateTime || null,
                  published_by: "HotelCare AI", venue_name: location.reply_brand_name || location.google_location_title,
                  reply_policy: isHistorical ? "explicit_14_day_backfill" : "new_positive_low_risk",
                  authorized_at: isHistorical ? location.auto_backfill_authorized_at : location.auto_reply_consent_at,
                });
                repliesPublished++;
                if (isHistorical) historicalPublished++;
              }
            }

            await admin
              .from("google_business_locations")
              .update({ last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
              .eq("id", location.id);
          } catch (error) {
            errors.push({
              connection_id: connection.id,
              location_id: location.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Do not report a healthy Google sync just because the cron ran.
        // A newly approved account has zero mapped locations until the manager
        // discovers and maps listings; preserve setup errors until a real sync succeeds.
        if ((locations || []).length > 0 && !errors.some((item) => item.connection_id === connection.id)) {
          await admin
            .from("google_business_connections")
            .update({
              last_sync_at: new Date().toISOString(),
              last_error: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", connection.id);
        }
      } catch (error) {
        errors.push({ connection_id: connection.id, error: error instanceof Error ? error.message : String(error) });
      }
    }

    // Look for newly accessible Google listings after the review work, at most
    // one connection per tick. This also covers a connection with no imported
    // listings yet, which the location round-robin above never selects.
    if (roundRobin) {
      const dueConnection = (connections || []).find((connection: any) =>
        locationDiscoveryDue(connection) && !shouldBackoff(connection));
      if (dueConnection) await runLocationDiscovery(dueConnection);
    }

    // A cron tick without any discovered listings is not a completed review sync.
    const awaitingMapping = roundRobin ? !selectedLocation : connectionsChecked > 0 && locationsChecked === 0;
    const finalStatus = errors.length || awaitingMapping ? "partial" : "completed";
    await admin
      .from("google_reputation_worker_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: finalStatus,
        connections_checked: connectionsChecked,
        locations_checked: locationsChecked,
        reviews_synced: reviewsSynced,
        drafts_generated: draftsGenerated,
        replies_published: repliesPublished,
        errors,
      })
      .eq("id", run.id);

    return json({
      ok: true,
      status: finalStatus,
      connections_checked: connectionsChecked,
      locations_checked: locationsChecked,
      reviews_synced: reviewsSynced,
      drafts_generated: draftsGenerated,
      replies_published: repliesPublished,
      ...(discovery.length ? { discovery } : {}),
      errors: errors.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await admin
      .from("google_reputation_worker_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: "failed",
        connections_checked: connectionsChecked,
        locations_checked: locationsChecked,
        reviews_synced: reviewsSynced,
        drafts_generated: draftsGenerated,
        replies_published: repliesPublished,
        errors: [{ error: message }],
      })
      .eq("id", run.id);
    return json({ error: message }, 500);
  }
});
