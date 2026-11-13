import { createClient } from "npm:@supabase/supabase-js@2.78.0";
import { generateLowCostText, containsLikelySensitiveData } from "../_shared/lowCostAi.ts";
import { buildCuratedReply, CURATED_REPLY_BASE_COUNT, requiresCarefulReview } from "../_shared/reputation-replies.ts";
import { buildReplyCustomizationPrompt, validateReplyChoices } from "../_shared/reputation-customization.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const b64 = (a: Uint8Array) => {
  let s = "";
  for (const b of a) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

class GoogleApiError extends Error {
  httpStatus: number;
  googleCode: string;
  endpoint: string;
  constructor(message: string, httpStatus: number, googleCode: string, endpoint: string) {
    super(message);
    this.name = "GoogleApiError";
    this.httpStatus = httpStatus;
    this.googleCode = googleCode;
    this.endpoint = endpoint;
  }
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

async function enc(v: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const out = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), new TextEncoder().encode(v)),
  );
  return `${b64(iv)}.${b64(out)}`;
}

async function dec(v: string) {
  const [a, b] = v.split(".");
  if (!a || !b) throw new Error("Invalid encrypted token");
  const out = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(a) }, await aesKey(), unb64(b));
  return new TextDecoder().decode(out);
}

const rating = (v: unknown) => {
  if (typeof v === "number") return Math.max(1, Math.min(5, Math.round(v)));
  const s = String(v || "").toUpperCase();
  return ({ ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 } as Record<string, number>)[s] || 5;
};

function friendlyGoogleError(status: number, code: string, rawMessage: string) {
  const message = String(rawMessage || "").trim();
  const lower = message.toLowerCase();
  const apiDisabled =
    lower.includes("has not been used") ||
    lower.includes("it is disabled") ||
    lower.includes("api has not been used") ||
    lower.includes("service_disabled");
  const quotaZero =
    status === 429 &&
    (lower.includes("quota exceeded") || lower.includes("requests per minute") || lower.includes("quota metric"));
  const accessDenied = status === 403 || code === "PERMISSION_DENIED";

  let prefix = `Google Business Profile API ${status}`;
  let hint = "";
  if (apiDisabled) {
    prefix = "Google Business Profile API is not enabled for this Google Cloud project";
    hint =
      " Enable My Business Account Management API, My Business Business Information API and Google My Business API in the same Cloud project as the HotelCare OAuth client.";
  } else if (quotaZero) {
    prefix = "Google Business Profile API access is awaiting Google approval";
    hint =
      " The API is enabled, but the project currently has no usable request quota. Keep the Google Business Profile API access case open and retry after Google approves the project.";
  } else if (accessDenied) {
    prefix = "Google Business Profile API access was denied by Google";
    hint =
      " Confirm this Cloud project has Google Business Profile API access and that the signed-in Google account is an owner or manager of the listings.";
  }
  return `${prefix}: ${message.slice(0, 450)}${hint}`.trim();
}

function classifyReview(stars: number, comment: string) {
  const text = String(comment || "").toLowerCase();
  const categories: string[] = [];
  const add = (name: string, words: string[]) => {
    if (words.some((w) => text.includes(w))) categories.push(name);
  };
  add("cleanliness", ["clean", "dirty", "dust", "smell", "bathroom", "toilet"]);
  add("breakfast", ["breakfast", "brunch", "coffee", "food", "buffet"]);
  add("staff", ["staff", "reception", "service", "waiter", "friendly", "rude"]);
  add("noise", ["noise", "noisy", "loud", "street", "music"]);
  add("room", ["room", "bed", "mattress", "small", "spacious"]);
  add("maintenance", ["air conditioning", "ac ", "heater", "broken", "shower", "water", "wifi", "elevator"]);
  add("price", ["price", "expensive", "value", "cost", "charge"]);
  add("location", ["location", "metro", "tram", "central", "walk"]);
  add("check-in", ["check in", "check-in", "arrival", "key", "late"]);
  add("cafe", ["cafe", "café", "pastry", "barista"]);

  const highRiskWords = [
    "refund",
    "fraud",
    "stolen",
    "theft",
    "police",
    "injury",
    "injured",
    "unsafe",
    "discrimination",
    "racist",
    "bedbug",
    "bed bug",
    "food poisoning",
    "legal",
    "lawyer",
  ];
  const mediumRiskWords = ["complaint", "manager", "charged", "overcharged", "mold", "mould", "cockroach"];
  const risk =
    stars <= 1 || highRiskWords.some((w) => text.includes(w))
      ? "high"
      : stars <= 3 || mediumRiskWords.some((w) => text.includes(w)) || requiresCarefulReview(comment)
        ? "medium"
        : "low";
  const sentiment = stars >= 4 ? "positive" : stars === 3 ? "mixed" : "negative";
  const summary = comment
    ? comment.replace(/\s+/g, " ").trim().slice(0, 180)
    : `${stars}-star rating without written comment`;
  return { categories, risk, sentiment, summary, confidence: comment ? 0.9 : 0.7 };
}

const toneInstruction: Record<string, string> = {
  warm_professional: "warm, professional and human",
  friendly_concise: "friendly, concise and conversational",
  formal: "formal, polished and respectful",
  luxury_hospitality: "refined, gracious and hospitality-focused without sounding exaggerated",
};

const orgSlugForManager = (profile: { organization_slug?: string | null }) => profile.organization_slug || "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  let admin: any = null;
  let org: any = null;
  let action = "status";

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!);
    admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const token = auth.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userError } = await anon.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "Unauthorized" }, 401);
    const authenticatedUserId = userData.user.id;

    const { data: profile } = await admin
      .from("profiles")
      .select("role,organization_slug,is_super_admin")
      .eq("id", userData.user.id)
      .single();
    if (
      !profile ||
      (!profile.is_super_admin && !["admin", "top_management", "top_management_manager"].includes(profile.role) && !(orgSlugForManager(profile) === "rdhotels" && profile.role === "manager"))
    ) {
      return json({ error: "Forbidden" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    action = String(body.action || "status");
    const orgSlug = String(body.organization_slug || profile.organization_slug || "");
    if (!orgSlug) return json({ error: "organization_slug required" }, 400);
    if (!profile.is_super_admin && profile.organization_slug !== orgSlug) return json({ error: "Forbidden" }, 403);

    const { data: orgRow } = await admin
      .from("organizations")
      .select("id,slug,name")
      .eq("slug", orgSlug)
      .maybeSingle();
    org = orgRow;
    if (!org) return json({ error: "Organization not found" }, 404);

    async function audit(
      review: any,
      eventType: string,
      replyText: string | null = null,
      metadata: Record<string, unknown> = {},
      actorUserId: string | null = authenticatedUserId,
    ) {
      await admin.from("google_review_reply_events").insert({
        organization_id: org.id,
        hotel_id: review.hotel_id || null,
        google_location_id: review.google_location_id || null,
        review_id: review.id,
        actor_user_id: actorUserId,
        event_type: eventType,
        reply_text: replyText,
        metadata,
      });
    }

    async function connection() {
      const { data: c } = await admin
        .from("google_business_connections")
        .select("*")
        .eq("organization_id", org.id)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!c) throw new Error("Google Business Profile is not connected");
      return c;
    }

    async function accessToken() {
      const c = await connection();
      if (
        c.access_token_ciphertext &&
        c.access_token_expires_at &&
        new Date(c.access_token_expires_at).getTime() > Date.now() + 90_000
      ) {
        return { token: await dec(c.access_token_ciphertext), connection: c };
      }
      const refresh = await dec(c.refresh_token_ciphertext);
      if (!refresh) throw new Error("Google refresh token is empty. Reconnect Google Business Profile.");

      const clientId = Deno.env.get("GOOGLE_BUSINESS_CLIENT_ID");
      const secret = Deno.env.get("GOOGLE_BUSINESS_CLIENT_SECRET");
      if (!clientId || !secret) throw new Error("Google OAuth credentials are missing");

      const r = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: secret,
          refresh_token: refresh,
          grant_type: "refresh_token",
        }),
      });
      if (!r.ok) {
        const t = (await r.text()).slice(0, 500);
        await admin
          .from("google_business_connections")
          .update({
            status: "error",
            last_error: `Token refresh ${r.status}: ${t}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", c.id);
        throw new Error("Google authorization expired or was revoked. Reconnect Google Business Profile.");
      }

      const x = await r.json();
      const expiry = new Date(Date.now() + Number(x.expires_in || 3600) * 1000).toISOString();
      await admin
        .from("google_business_connections")
        .update({
          access_token_ciphertext: await enc(String(x.access_token)),
          access_token_expires_at: expiry,
          status: "active",
          updated_at: new Date().toISOString(),
        })
        .eq("id", c.id);
      return { token: String(x.access_token), connection: c };
    }

    async function gfetch(target: string, init: RequestInit = {}) {
      const { token: googleToken, connection: c } = await accessToken();
      const r = await fetch(target, {
        ...init,
        headers: {
          Authorization: `Bearer ${googleToken}`,
          "Content-Type": "application/json",
          ...(init.headers || {}),
        },
      });
      const txt = await r.text();
      let data: any = {};
      try {
        data = txt ? JSON.parse(txt) : {};
      } catch {
        data = { raw: txt };
      }
      if (!r.ok) {
        const googleCode = String(data?.error?.status || data?.error?.details?.[0]?.reason || "GOOGLE_API_ERROR");
        const rawMessage = String(data?.error?.message || txt || `Google API ${r.status}`);
        const friendly = friendlyGoogleError(r.status, googleCode, rawMessage);
        await admin
          .from("google_business_connections")
          .update({ last_error: friendly, updated_at: new Date().toISOString() })
          .eq("id", c.id);
        console.error(
          "google-business-api-error",
          JSON.stringify({
            action,
            status: r.status,
            code: googleCode,
            endpoint: new URL(target).hostname,
            message: rawMessage.slice(0, 500),
          }),
        );
        throw new GoogleApiError(friendly, r.status, googleCode, target);
      }
      return data;
    }

    if (action === "status") {
      const [{ data: connections }, { data: locations }, { data: reviews }, { data: hotels }, { data: events }] =
        await Promise.all([
          admin
            .from("google_business_connections")
            .select("id,google_account_display_name,google_account_email,status,last_sync_at,last_error,created_at,updated_at")
            .eq("organization_id", org.id),
          admin
            .from("google_business_locations")
            .select(
              "id,hotel_id,google_account_name,google_location_name,google_location_title,reply_brand_name,business_category,place_id,store_code,reply_mode,min_auto_rating,is_active,last_sync_at,reply_tone,reply_language_mode,auto_reply_enabled,auto_reply_enabled_at,auto_reply_consent_at,auto_reply_delay_minutes,require_approval_below_rating,reply_signature,brand_context,google_total_review_count,google_average_rating,google_review_stats_updated_at,auto_backfill_active,auto_backfill_authorized_at,auto_backfill_cutoff,auto_backfill_upper_bound",
            )
            .eq("organization_id", org.id)
            .order("google_location_title"),
          admin
            .from("google_reviews")
            .select(
              "id,hotel_id,google_location_id,reviewer_display_name,reviewer_profile_photo_url,star_rating,comment,review_create_time,review_update_time,google_reply_comment,google_reply_update_time,reply_origin,auto_reply_kind,ai_language,ai_sentiment,ai_categories,ai_summary,ai_risk_level,ai_confidence,ai_draft,ai_draft_generated_at,draft_edited_at,reply_status,replied_at,auto_reply_eligible",
            )
            .eq("organization_id", org.id)
            .order("review_update_time", { ascending: false })
            .limit(250),
          admin
            .from("hotel_configurations")
            .select("hotel_id,hotel_name,is_active")
            .eq("organization_id", org.id)
            .order("hotel_name"),
          admin
            .from("google_review_reply_events")
            .select("id,review_id,google_location_id,hotel_id,event_type,reply_text,metadata,actor_user_id,created_at")
            .eq("organization_id", org.id)
            .order("created_at", { ascending: false })
            .limit(200),
        ]);

      const [{ data: alerts }, { count: openAlertCount }] = await Promise.all([
        admin.from("google_reputation_alerts")
          .select("id,google_location_id,review_id,star_rating,review_excerpt,status,detected_at,acknowledged_at")
          .eq("organization_id", org.id).eq("status", "open").order("detected_at", { ascending: false }).limit(30),
        admin.from("google_reputation_alerts")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", org.id).eq("status", "open"),
      ]);
      const counts = await Promise.all([
        admin.from("google_reviews").select("id", { count: "exact", head: true }).eq("organization_id", org.id),
        admin.from("google_reviews").select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq("reply_status", "published"),
        admin.from("google_reviews").select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq("reply_status", "published").eq("reply_origin", "automatic"),
        admin.from("google_reviews").select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq("reply_status", "published").eq("reply_origin", "manager"),
        admin.from("google_reviews").select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq("reply_status", "published").eq("reply_origin", "bulk"),
        admin.from("google_reviews").select("id", { count: "exact", head: true }).eq("organization_id", org.id).gte("review_create_time", new Date(Date.now() - 14 * 86_400_000).toISOString()),
        admin.from("google_reviews").select("id", { count: "exact", head: true }).eq("organization_id", org.id).gte("review_create_time", new Date(Date.now() - 14 * 86_400_000).toISOString()).neq("reply_status", "published"),
      ]);
      const summary: Record<string, { total: number; published: number; automatic: number; bulk: number; recent14: number; recentUnreplied: number; ratings: number; stars: number; attention: number }> = {};
      let totalRatings = 0; let totalStars = 0; let totalAwaiting = 0; let totalAttention = 0;
      let offset = 0;
      const recentCutoffMs = Date.now() - 14 * 86_400_000;
      const earlierCutoffMs = Date.now() - 28 * 86_400_000;
      let previous14 = 0;
      while (offset < 30000) {
        const { data: group, error: groupError } = await admin.from("google_reviews")
          .select("google_location_id,star_rating,review_create_time,reply_status,reply_origin,ai_risk_level")
          .eq("organization_id", org.id).order("id").range(offset, offset + 999);
        if (groupError) throw groupError;
        for (const review of group || []) {
          const key = review.google_location_id;
          const entry = (summary[key] ||= { total: 0, published: 0, automatic: 0,
            bulk: 0, recent14: 0, recentUnreplied: 0, ratings: 0, stars: 0, attention: 0 });
          const rating = Number(review.star_rating || 0);
          const published = review.reply_status === "published";
          const createdAt = new Date(review.review_create_time || "").getTime();
          const recent = createdAt >= recentCutoffMs && createdAt <= Date.now();
          entry.total++; entry.ratings++; entry.stars += rating;
          totalRatings++; totalStars += rating;
          if (published) entry.published++;
          else {
            totalAwaiting++;
            if (rating <= 3) { entry.attention++; totalAttention++; }
          }
          if (review.reply_origin === "automatic" && published) entry.automatic++;
          if (review.reply_origin === "bulk" && published) entry.bulk++;
          if (recent) {
            entry.recent14++;
            if (!published) entry.recentUnreplied++;
          } else if (createdAt >= earlierCutoffMs && createdAt < recentCutoffMs) previous14++;
        }
        if (!group || group.length < 1000) break;
        offset += 1000;
      }
      return json({
        ok: true,
        location_summary: summary,
        alerts: alerts || [], open_alert_count: openAlertCount || 0,
        reply_library: { curated_base_variants: CURATED_REPLY_BASE_COUNT, curated_ai_cost: 0 },
        stats: {
          total: counts[0].count || 0, published: counts[1].count || 0,
          automatic: counts[2].count || 0, manager: counts[3].count || 0, bulk: counts[4].count || 0,
          recent14: counts[5].count || 0, recentUnreplied: counts[6].count || 0,
          previous14, awaiting: totalAwaiting, attention: totalAttention,
          average: totalRatings ? totalStars / totalRatings : null,
          imported: Math.max(0, (counts[1].count || 0) - (counts[2].count || 0) - (counts[3].count || 0) - (counts[4].count || 0)),
        },
        google_configured: Boolean(
          Deno.env.get("GOOGLE_BUSINESS_CLIENT_ID") &&
            Deno.env.get("GOOGLE_BUSINESS_CLIENT_SECRET") &&
            Deno.env.get("GOOGLE_BUSINESS_TOKEN_KEY"),
        ),
        organization: org,
        connections: connections || [],
        locations: locations || [],
        reviews: reviews || [],
        hotels: hotels || [],
        events: events || [],
      });
    }


    if (action === "automation_health") {
      // Only authenticated, authorized organization managers reach this action.
      // Worker runs are infrastructure-wide; review counts and examples are
      // strictly scoped to the requested organization.
      const cutoff24 = new Date(Date.now() - 24 * 3_600_000).toISOString();
      const cutoff7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const cutoff14 = new Date(Date.now() - 14 * 86_400_000).toISOString();
      const [
        { data: workerRuns, error: workerError },
        { data: locations, error: locationError },
        { data: recentPending, error: pendingError },
        { data: recentAutomatic, error: recentError },
        { count: auto24, error: auto24Error },
        { count: auto7, error: auto7Error },
        { count: autoAll, error: autoAllError },
      ] = await Promise.all([
        admin.from("google_reputation_worker_runs")
          .select("started_at,finished_at,status,connections_checked,locations_checked,reviews_synced,drafts_generated,replies_published,errors")
          .order("started_at", { ascending: false }).limit(100),
        admin.from("google_business_locations")
          .select("id,reply_brand_name,google_location_title,is_active,reply_mode,auto_reply_enabled,auto_reply_enabled_at,auto_reply_delay_minutes")
          .eq("organization_id", org.id),
        admin.from("google_reviews")
          .select("id,google_location_id,star_rating,review_create_time,ai_risk_level,reply_status,google_reply_comment,draft_edited_at")
          .eq("organization_id", org.id).gte("review_create_time", cutoff14)
          .gte("star_rating", 4).neq("reply_status", "published").limit(1000),
        admin.from("google_reviews")
          .select("id,google_location_id,reviewer_display_name,star_rating,review_create_time,google_reply_comment,google_reply_update_time,auto_reply_kind")
          .eq("organization_id", org.id).eq("reply_status", "published")
          .eq("reply_origin", "automatic")
          .order("google_reply_update_time", { ascending: false }).limit(12),
        admin.from("google_reviews")
          .select("id", { count: "exact", head: true }).eq("organization_id", org.id)
          .eq("reply_status", "published").eq("reply_origin", "automatic")
          .gte("google_reply_update_time", cutoff24),
        admin.from("google_reviews")
          .select("id", { count: "exact", head: true }).eq("organization_id", org.id)
          .eq("reply_status", "published").eq("reply_origin", "automatic")
          .gte("google_reply_update_time", cutoff7),
        admin.from("google_reviews")
          .select("id", { count: "exact", head: true }).eq("organization_id", org.id)
          .eq("reply_status", "published").eq("reply_origin", "automatic"),
      ]);
      const healthError = [workerError, locationError, pendingError, recentError, auto24Error, auto7Error, autoAllError]
        .find(Boolean);
      if (healthError) throw healthError;
      const venueMap = new Map((locations || []).map((venue: any) => [venue.id, venue]));
      const due = (recentPending || []).filter((review: any) => {
        const venue: any = venueMap.get(review.google_location_id);
        if (!venue?.is_active || !venue.auto_reply_enabled || venue.reply_mode === "draft_only") return false;
        if (!venue.auto_reply_enabled_at || review.ai_risk_level !== "low" || review.draft_edited_at) return false;
        if (Number(review.star_rating) < 4 || review.google_reply_comment) return false;
        const reviewMs = new Date(review.review_create_time || "").getTime();
        const startMs = new Date(venue.auto_reply_enabled_at).getTime();
        if (!Number.isFinite(reviewMs) || !Number.isFinite(startMs) || reviewMs < startMs) return false;
        return Date.now() - reviewMs >= Math.max(0, Math.min(1440, Number(venue.auto_reply_delay_minutes || 0))) * 60_000;
      });
      const lastRun = (workerRuns || [])[0] || null;
      const runs24 = (workerRuns || []).filter((run: any) => run.started_at >= cutoff24);
      const incomplete24 = runs24.filter((run: any) => run.status !== "completed").length;
      const lastErrors = Array.isArray(lastRun?.errors) ? lastRun.errors.length : 0;
      return json({
        ok: true,
        worker: {
          last_run_at: lastRun?.started_at || null,
          last_completed_at: (workerRuns || []).find((run: any) => run.status === "completed")?.finished_at || null,
          last_status: lastRun?.status || "unknown",
          last_errors: lastErrors,
          last_reviews_synced: lastRun?.reviews_synced || 0,
          last_drafts_generated: lastRun?.drafts_generated || 0,
          last_replies_published: lastRun?.replies_published || 0,
          runs_24h: runs24.length,
          incomplete_runs_24h: incomplete24,
        },
        counts: {
          automatic_24h: auto24 || 0,
          automatic_7d: auto7 || 0,
          automatic_all: autoAll || 0,
          new_positive_ready: due.length,
          recent_positive_unreplied: (recentPending || []).length,
          enabled_venues: (locations || []).filter((venue: any) => venue.is_active && venue.auto_reply_enabled && venue.reply_mode !== "draft_only").length,
          total_venues: (locations || []).filter((venue: any) => venue.is_active).length,
        },
        recent_automatic: recentAutomatic || [],
      });
    }

    if (action === "list_published") {
      const page = Math.max(0, Math.min(10000, Number(body.page || 0) || 0));
      const limit = 50;
      const source = String(body.source || "all");
      let q = admin.from("google_reviews")
        .select("id,hotel_id,google_location_id,reviewer_display_name,star_rating,comment,review_update_time,google_reply_comment,google_reply_update_time,reply_status,reply_origin,auto_reply_kind,replied_at", { count: "exact" })
        .eq("organization_id", org.id).eq("reply_status", "published");
      if (["automatic", "manager", "bulk", "google"].includes(source)) q = q.eq("reply_origin", source);
      if (source === "automatic" && ["historical_14d", "new_positive"].includes(String(body.kind)))
        q = q.eq("auto_reply_kind", String(body.kind));
      if (body.location_id && body.location_id !== "all") q = q.eq("google_location_id", String(body.location_id));
      const { data: publishedReviews, count, error } = await q
        .order("google_reply_update_time", { ascending: false, nullsFirst: false })
        .range(page * limit, (page + 1) * limit - 1);
      if (error) throw error;
      return json({ ok: true, reviews: publishedReviews || [], total: count || 0, page, limit });
    }

    if (action === "list_recent") {
      const page = Math.max(0, Math.min(500, Number(body.page || 0) || 0));
      const limit = 100;
      const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString();
      let q = admin.from("google_reviews")
        .select("id,google_location_id,hotel_id,reviewer_display_name,star_rating,comment,review_create_time,review_update_time,ai_draft,ai_risk_level,draft_edited_at,reply_status,reply_origin,google_reply_comment", { count: "exact" })
        .eq("organization_id", org.id).gte("review_create_time", cutoff);
      if (body.location_id && body.location_id !== "all") {
        q = q.eq("google_location_id", String(body.location_id));
      }
      const { data: recent, error, count } = await q.order("review_create_time", { ascending: false })
        .range(page * limit, (page + 1) * limit - 1);
      if (error) throw error;
      return json({ ok: true, reviews: recent || [], total: count || 0, page, limit, cutoff });
    }

    if (action === "list_google_accounts") {
      const accounts: any[] = [];
      let pageToken = "";
      do {
        const params = new URLSearchParams({ pageSize: "20" });
        if (pageToken) params.set("pageToken", pageToken);
        const response = await gfetch(`https://mybusinessaccountmanagement.googleapis.com/v1/accounts?${params.toString()}`);
        accounts.push(...(response.accounts || []).map((a: any) => ({
          name: a.name, account_name: a.accountName, type: a.type, role: a.role,
        })));
        pageToken = response.nextPageToken || "";
      } while (pageToken && accounts.length < 500);
      return json({ ok: true, accounts });
    }

    if (action === "start_oauth") {
      if (
        !Deno.env.get("GOOGLE_BUSINESS_CLIENT_ID") ||
        !Deno.env.get("GOOGLE_BUSINESS_CLIENT_SECRET") ||
        !Deno.env.get("GOOGLE_BUSINESS_TOKEN_KEY")
      ) {
        return json({ error: "Google Business credentials are not configured yet" }, 409);
      }
      const state = crypto.randomUUID() + crypto.randomUUID();
      const returnUrl = String(body.return_url || "");
      if (!returnUrl.startsWith("https://") && !returnUrl.startsWith("http://localhost")) {
        return json({ error: "Invalid return_url" }, 400);
      }

      await admin.from("google_business_oauth_states").delete().lt("expires_at", new Date().toISOString());
      const { error } = await admin.from("google_business_oauth_states").insert({
        state,
        user_id: userData.user.id,
        organization_id: org.id,
        organization_slug: orgSlug,
        return_url: returnUrl,
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      });
      if (error) throw error;

      const redirectUri = `${url}/functions/v1/google-business-oauth-callback`;
      const p = new URLSearchParams({
        client_id: Deno.env.get("GOOGLE_BUSINESS_CLIENT_ID")!,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "https://www.googleapis.com/auth/business.manage",
        access_type: "offline",
        prompt: "consent",
        state,
        include_granted_scopes: "true",
      });
      return json({ ok: true, authorization_url: `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}` });
    }

    if (action === "sync_locations") {
      const { connection: c } = await accessToken();
      const accessibleAccounts: any[] = [];
      let accountPageToken = "";
      do {
        const params = new URLSearchParams({ pageSize: "20" });
        if (accountPageToken) params.set("pageToken", accountPageToken);
        const page = await gfetch(`https://mybusinessaccountmanagement.googleapis.com/v1/accounts?${params.toString()}`);
        accessibleAccounts.push(...(page.accounts || []));
        accountPageToken = page.nextPageToken || "";
      } while (accountPageToken);

      const found: any[] = [];
      for (const a of accessibleAccounts) {
        if (!a.name) continue;
        let pageToken = "";
        do {
          const q = new URLSearchParams({ readMask: "name,title,storeCode,metadata", pageSize: "100" });
          if (pageToken) q.set("pageToken", pageToken);
          const x = await gfetch(
            `https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?${q.toString()}`,
          );
          for (const l of x.locations || []) {
            const row = {
              connection_id: c.id,
              organization_id: org.id,
              google_account_name: a.name,
              google_location_name: l.name,
              google_location_title: l.title || l.name,
              place_id: l.metadata?.placeId || null,
              store_code: l.storeCode || null,
              is_active: true,
              last_sync_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            const { data: saved, error } = await admin
              .from("google_business_locations")
              .upsert(row, { onConflict: "connection_id,google_location_name" })
              .select("*")
              .single();
            if (error) throw error;
            found.push(saved);
          }
          pageToken = x.nextPageToken || "";
        } while (pageToken);
      }

      await admin
        .from("google_business_connections")
        .update({
          last_sync_at: new Date().toISOString(),
          last_error: null,
          status: "active",
          updated_at: new Date().toISOString(),
        })
        .eq("id", c.id);
      return json({
        ok: true,
        accounts: accessibleAccounts.map((a: any) => ({
          name: a.name,
          account_name: a.accountName,
          type: a.type,
          role: a.role,
        })),
        locations: found,
      });
    }

    if (action === "map_location" || action === "update_location_settings") {
      const id = String(body.location_id || "");
      if (!id) return json({ error: "location_id required" }, 400);

      const hotelId: string | null = body.hotel_id === null || body.hotel_id === "" ? null : String(body.hotel_id || "");
      if (hotelId) {
        const { data: h } = await admin
          .from("hotel_configurations")
          .select("hotel_id,organization_id")
          .eq("hotel_id", hotelId)
          .eq("organization_id", org.id)
          .maybeSingle();
        if (!h) return json({ error: "Hotel does not belong to this organization" }, 400);
      }

      const mode = ["draft_only", "auto_positive", "auto_all"].includes(String(body.reply_mode))
        ? String(body.reply_mode)
        : "draft_only";
      const minAuto = Math.max(1, Math.min(5, Number(body.min_auto_rating || 4)));
      const approvalBelow = Math.max(1, Math.min(5, Number(body.require_approval_below_rating || 4)));
      const tone = ["warm_professional", "friendly_concise", "formal", "luxury_hospitality"].includes(
        String(body.reply_tone),
      )
        ? String(body.reply_tone)
        : "warm_professional";
      const languageMode = ["match_guest", "english", "hungarian"].includes(String(body.reply_language_mode))
        ? String(body.reply_language_mode)
        : "match_guest";
      const delay = Math.max(0, Math.min(1440, Number(body.auto_reply_delay_minutes ?? 15)));
      const autoEnabled = Boolean(body.auto_reply_enabled) && mode !== "draft_only";
      const { data: previousLocation } = await admin.from("google_business_locations")
        .select("auto_reply_enabled")
        .eq("id", id).eq("organization_id", org.id).maybeSingle();
      if (!previousLocation) return json({ error: "Location not found" }, 404);
      const activation = autoEnabled && !previousLocation.auto_reply_enabled;
      if (activation && body.auto_consent_confirmed !== true) {
        return json({ error: "Explicit authorization is required to enable automated Google review publishing for this business." }, 409);
      }

      const brandName = String(body.reply_brand_name || "").trim().slice(0, 120);
      if (!brandName) return json({ error: "Reply brand name is required" }, 400);
      const businessCategory = ["hotel", "brunch", "restaurant", "conference", "museum", "other"].includes(String(body.business_category))
        ? String(body.business_category) : "other";
      const updates = {
        hotel_id: hotelId,
        reply_brand_name: brandName,
        business_category: businessCategory,
        reply_mode: mode,
        min_auto_rating: autoEnabled ? Math.max(4, minAuto) : minAuto,
        require_approval_below_rating: autoEnabled ? Math.max(4, approvalBelow) : approvalBelow,
        reply_tone: tone,
        reply_language_mode: languageMode,
        auto_reply_enabled: autoEnabled,
        ...(activation ? {
          auto_reply_consent_at: new Date().toISOString(),
          auto_reply_authorized_by: userData.user.id,
        } : {}),
        auto_reply_delay_minutes: delay,
        reply_signature: String(body.reply_signature || "").trim().slice(0, 120) || null,
        brand_context: String(body.brand_context || "").trim().slice(0, 1200) || null,
        updated_at: new Date().toISOString(),
      };

      const { data: l, error } = await admin
        .from("google_business_locations")
        .update(updates)
        .eq("id", id)
        .eq("organization_id", org.id)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!l) return json({ error: "Location not found" }, 404);
      return json({ ok: true, location: l });
    }

    if (action === "sync_reviews") {
      const { data: locs } = await admin
        .from("google_business_locations")
        .select("*")
        .eq("organization_id", org.id)
        .eq("is_active", true);

      let imported = 0;
      let unreplied = 0;
      for (const l of locs || []) {
        if (!l.google_account_name || !l.google_location_name) continue;
        const existingReviews = new Map<string, any>();
        let readOffset = 0;
        while (true) {
          const { data: batch, error: readError } = await admin.from("google_reviews")
            .select("google_review_name,comment,ai_draft,ai_draft_generated_at,draft_edited_at,draft_edited_by,reply_origin")
            .eq("google_location_id", l.id).range(readOffset, readOffset + 999);
          if (readError) throw readError;
          for (const existing of batch || []) existingReviews.set(existing.google_review_name, existing);
          if (!batch || batch.length < 1000) break;
          readOffset += 1000;
        }
        let pageToken = "";
        do {
          const q = new URLSearchParams({ pageSize: "50" });
          if (pageToken) q.set("pageToken", pageToken);
          const x = await gfetch(
            `https://mybusiness.googleapis.com/v4/${l.google_account_name}/${l.google_location_name}/reviews?${q.toString()}`,
          );

          await admin.from("google_business_locations").update({
            google_total_review_count: Number.isFinite(Number(x.totalReviewCount))
              ? Number(x.totalReviewCount) : l.google_total_review_count,
            google_average_rating: Number.isFinite(Number(x.averageRating))
              ? Number(x.averageRating) : l.google_average_rating,
            google_review_stats_updated_at: new Date().toISOString(),
          }).eq("id", l.id);
          for (const r of x.reviews || []) {
            const existing = existingReviews.get(r.name);
            const unchanged = existing && String(existing.comment || "") === String(r.comment || "");
            const savedDraft = unchanged ? existing.ai_draft || null : null;
            const hasReply = Boolean(r.reviewReply?.comment);
            const stars = rating(r.starRating);
            const analysis = classifyReview(stars, r.comment || "");
            const row = {
              organization_id: org.id,
              hotel_id: l.hotel_id,
              google_location_id: l.id,
              google_review_name: r.name,
              google_review_id: r.reviewId || String(r.name || "").split("/").pop(),
              reviewer_display_name: r.reviewer?.displayName || null,
              reviewer_profile_photo_url: r.reviewer?.profilePhotoUrl || null,
              star_rating: stars,
              comment: r.comment || null,
              review_create_time: r.createTime || null,
              review_update_time: r.updateTime || r.createTime || null,
              google_reply_comment: r.reviewReply?.comment || null,
              google_reply_update_time: r.reviewReply?.updateTime || null,
              ai_sentiment: analysis.sentiment,
              ai_categories: analysis.categories,
              ai_summary: analysis.summary,
              ai_risk_level: analysis.risk,
              ai_confidence: analysis.confidence,
              reply_origin: hasReply ? (["automatic", "manager", "bulk"].includes(existing?.reply_origin) ? existing.reply_origin : "google") : "unknown",
              ai_draft: savedDraft,
              ai_draft_generated_at: savedDraft ? existing.ai_draft_generated_at : null,
              draft_edited_at: savedDraft ? existing.draft_edited_at : null,
              draft_edited_by: savedDraft ? existing.draft_edited_by : null,
              reply_status: hasReply ? "published" : savedDraft ? "draft" : "unreplied",
              auto_reply_eligible:
                !hasReply &&
                Boolean(l.is_active && l.auto_reply_enabled && l.auto_reply_enabled_at) &&
                l.reply_mode !== "draft_only" &&
                stars >= Math.max(4, Number(l.min_auto_rating || 4), Number(l.require_approval_below_rating || 4)) &&
                analysis.risk === "low" &&
                !requiresCarefulReview(r.comment || "") &&
                !existing?.draft_edited_at &&
                Number.isFinite(new Date(r.createTime || "").getTime()) &&
                new Date(r.createTime || "").getTime() >= new Date(l.auto_reply_enabled_at || "").getTime() &&
                Date.now() - new Date(r.createTime || "").getTime() >=
                  Math.max(0, Math.min(1440, Number(l.auto_reply_delay_minutes || 0))) * 60_000,
              raw: r,
              updated_at: new Date().toISOString(),
            };

            const { data: savedReview, error } = await admin.from("google_reviews")
              .upsert(row, { onConflict: "google_review_name" }).select("id").single();
            if (error) throw error;
            if (stars <= 3 && !existing && new Date(r.createTime || "").getTime() >= Date.now() - 14 * 86_400_000) {
              await admin.from("google_reputation_alerts").upsert({
                organization_id: org.id, google_location_id: l.id,
                google_review_name: r.name, review_id: savedReview.id,
                star_rating: stars, review_excerpt: String(r.comment || "").slice(0, 600),
              }, { onConflict: "organization_id,google_review_name", ignoreDuplicates: true });
            }
            imported++;
            if (!r.reviewReply?.comment) unreplied++;
          }
          pageToken = x.nextPageToken || "";
        } while (pageToken);

        await admin
          .from("google_business_locations")
          .update({ last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", l.id);
      }
      return json({ ok: true, imported, unreplied });
    }

    if (action === "alert_summary") {
      // Lightweight endpoint for the shared application header; avoid pulling
      // thousands of reviews or running the full Reputation overview query.
      const { data: openAlerts, count, error } = await admin.from("google_reputation_alerts")
        .select("id,star_rating,google_location_id,review_excerpt,detected_at,google_business_locations(reply_brand_name,google_location_title)", { count: "exact" })
        .eq("organization_id", org.id).eq("status", "open")
        .order("detected_at", { ascending: false }).limit(8);
      if (error) throw error;
      return json({ ok: true, total: count || 0, alerts: openAlerts || [] });
    }

    if (action === "activate_auto_venues") {
      // Explicit one-time consent for a named set of Google Business locations.
      // This never grants consent to publish old reviews and never sets the mode
      // below the safe 4-star threshold.
      if (body.confirm !== true) return json({ error: "Explicit business-level authorization is required." }, 409);
      const ids = Array.isArray(body.location_ids) ? body.location_ids.map(String) : [];
      const uniq = Array.from(new Set(ids));
      if (!uniq.length || uniq.length > 25 || uniq.length !== ids.length) return json({ error: "Select 1–25 distinct Google businesses." }, 400);
      const { data: selected, error: selectedError } = await admin.from("google_business_locations")
        .select("id,reply_brand_name,google_location_title,hotel_id,auto_reply_enabled,reply_mode")
        .eq("organization_id", org.id).eq("is_active", true).in("id", uniq);
      if (selectedError) throw selectedError;
      if ((selected || []).length !== uniq.length) return json({ error: "One or more selected listings are unavailable." }, 409);
      const activated: any[] = [];
      const consentTime = new Date().toISOString();
      for (const venue of selected || []) {
        const { data: updated, error } = await admin.from("google_business_locations").update({
          reply_mode: "auto_positive",
          auto_reply_enabled: true,
          min_auto_rating: 4,
          require_approval_below_rating: 4,
          auto_reply_consent_at: consentTime,
          auto_reply_authorized_by: userData.user.id,
          updated_at: consentTime,
        }).eq("id", venue.id).eq("organization_id", org.id).select("id,reply_brand_name,auto_reply_enabled,auto_reply_enabled_at").single();
        if (error) throw error;
        activated.push(updated);
      }
      return json({ ok: true, activated, policy: "future_4_5_low_risk_only", authorized_at: consentTime });
    }

    if (action === "authorize_historical_backfill" || action === "cancel_historical_backfill") {
      const ids = Array.isArray(body.location_ids) ? body.location_ids.map(String) : [];
      const uniqueIds = Array.from(new Set(ids));
      if (!uniqueIds.length || uniqueIds.length > 25 || uniqueIds.length !== ids.length)
        return json({ error: "Choose 1–25 distinct Google Business locations." }, 400);
      if (action === "authorize_historical_backfill" && body.confirm !== true)
        return json({ error: "Explicit consent for the selected 14-day review window is required." }, 409);
      const { data: venues, error: foundError } = await admin.from("google_business_locations")
        .select("id,reply_brand_name,google_location_title,is_active")
        .eq("organization_id", org.id).in("id", uniqueIds);
      if (foundError) throw foundError;
      if (!venues || venues.length !== uniqueIds.length || venues.some((v: any) => !v.is_active))
        return json({ error: "One or more requested Google listings are unavailable." }, 409);
      const timestamp = new Date();
      const authorized = action === "authorize_historical_backfill";
      const cutoff = new Date(timestamp.getTime() - 14 * 86_400_000).toISOString();
      for (const venue of venues) {
        const updates = authorized ? {
          auto_backfill_active: true,
          auto_backfill_authorized_at: timestamp.toISOString(),
          auto_backfill_authorized_by: userData.user.id,
          auto_backfill_cutoff: cutoff,
          auto_backfill_upper_bound: timestamp.toISOString(),
        } : { auto_backfill_active: false };
        const { error } = await admin.from("google_business_locations").update({
          ...updates, updated_at: timestamp.toISOString(),
        }).eq("id", venue.id).eq("organization_id", org.id);
        if (error) throw error;
      }
      return json({ ok: true, venues: venues.map((v: any) => ({ id: v.id, name: v.reply_brand_name || v.google_location_title })),
        historical_window: authorized ? { from: cutoff, to: timestamp.toISOString() } : null,
        active: authorized,
        max_published_per_worker_run: 5 });
    }

    if (action === "acknowledge_low_rating_alert") {
      const id = String(body.alert_id || "");
      if (!id) return json({ error: "alert_id is required" }, 400);
      const { data: result, error } = await admin.from("google_reputation_alerts")
        .update({ status: "acknowledged", acknowledged_at: new Date().toISOString(), acknowledged_by: userData.user.id })
        .eq("id", id).eq("organization_id", org.id).eq("status", "open").select("id").maybeSingle();
      if (error) throw error;
      if (!result) return json({ error: "Alert not found or already acknowledged" }, 404);
      return json({ ok: true });
    }

    if (action === "customize_reply") {
      const reviewId = String(body.review_id || "");
      if (!/^[a-f0-9-]{36}$/i.test(reviewId)) return json({ error: "Valid review ID required" }, 400);
      let choices: ReturnType<typeof validateReplyChoices>;
      try { choices = validateReplyChoices(body.options && typeof body.options === "object" ? body.options : {}); }
      catch (validationError) {
        return json({ error: validationError instanceof Error ? validationError.message : "Invalid reply options" }, 400);
      }
      const { data: review, error: readError } = await admin.from("google_reviews")
        .select("id,organization_id,hotel_id,google_location_id,reviewer_display_name,star_rating,comment,google_reply_comment,reply_status,ai_draft,google_business_locations(reply_brand_name,google_location_title,business_category,brand_context,reply_signature)")
        .eq("id", reviewId).eq("organization_id", org.id).maybeSingle();
      if (readError) throw readError;
      if (!review || !review.google_business_locations) return json({ error: "Review or Google business not found" }, 404);
      if (review.reply_status === "published" || review.google_reply_comment) {
        return json({ error: "This Google review is already replied to; draft alternatives cannot overwrite it." }, 409);
      }
      if (!Deno.env.get("GEMINI_API_KEY") && !Deno.env.get("OPENAI_API_KEY"))
        return json({ error: "HotelCare AI is not configured" }, 409);
      // Use an inexpensive model for manager-requested revisions only. The
      // positive-review curated library continues to incur zero model cost.
      const chosenModel = Deno.env.get("OPENAI_REVIEW_CUSTOM_MODEL") || "gpt-4.1-mini";
      // Do not send the reviewer's display name to an unpaid model. Regular
      // style customizations can use Gemini; genuinely confidential notes,
      // medical/identity information and confirmed-issue instructions use OpenAI.
      const previousDraft = String(body.previous_draft || review.ai_draft || "").slice(0, 1000);
      const sensitiveReviewCustomization =
        choices.stance === "accept_confirmed_issue" ||
        containsLikelySensitiveData(String(review.comment || "")) ||
        containsLikelySensitiveData(choices.notes) ||
        containsLikelySensitiveData(previousDraft) ||
        containsLikelySensitiveData(String((review.google_business_locations as any)?.brand_context || ""));
      const input = buildReplyCustomizationPrompt({
        review: { ...review, reviewer_display_name: "" } as any,
        venue: review.google_business_locations as any,
        choices,
        previousDraft,
      });
      let generated: Awaited<ReturnType<typeof generateLowCostText>>;
      try {
        generated = await generateLowCostText({
          task: "internal",
          sensitive: sensitiveReviewCustomization,
          json: true,
          instructions: 'You write accurate public hospitality review replies. Return one JSON object with a "replies" array containing exactly three distinct replies. Obey response stance and factual constraints. Do not invent details.',
          prompt: input,
          maxOutputTokens: 1500,
          fallbackModel: chosenModel,
          validate: (raw) => {
            try {
              const replies = JSON.parse(raw)?.replies;
              return Array.isArray(replies) && replies.length === 3 &&
                replies.every((v: unknown) => typeof v === "string" && v.trim().length >= 15 && v.length <= 1500) &&
                new Set(replies.map((v: string) => v.trim().toLowerCase())).size === 3;
            } catch { return false; }
          },
        });
      } catch {
        return json({ error: "Could not generate alternatives. Try again or edit the existing draft." }, 502);
      }
      const output = generated.text;
      let parsed: any;
      try { parsed = JSON.parse(output); }
      catch { return json({ error: "AI returned an invalid reply format. Please try again." }, 502); }
      const candidates = Array.isArray(parsed?.replies) ? parsed.replies : [];
      const replies = candidates.map((v: any) => String(v || "").trim())
        .filter((v: string) => v.length >= 15 && v.length <= 1500).slice(0, 3);
      if (replies.length !== 3 || new Set(replies.map((s: string) => s.toLowerCase())).size !== 3)
        return json({ error: "Could not produce three distinct safe replies. Please adjust your options." }, 502);
      await audit(review, "draft_options_generated", null, {
        manager_requested: true, model: generated.model, provider: generated.provider, options: {
          length: choices.length, tone: choices.tone, stance: choices.stance,
          focus: choices.focus, language: choices.language,
          has_manager_notes: Boolean(choices.notes),
        },
        variant_count: replies.length, publish_action: false,
      });
      return json({ ok: true, alternatives: replies, model: generated.model, provider: generated.provider, saved: false, published: false });
    }

    if (action === "draft_reply") {
      const reviewId = String(body.review_id || "");
      if (!reviewId) return json({ error: "review_id required" }, 400);

      const { data: r } = await admin
        .from("google_reviews")
        .select("*,google_business_locations(*)")
        .eq("id", reviewId)
        .eq("organization_id", org.id)
        .maybeSingle();
      if (!r) return json({ error: "Review not found" }, 404);
      if (r.reply_status === "published" || r.google_reply_comment)
        return json({ error: "This Google review has already been answered" }, 409);

      const aiProviderAvailable = Boolean(Deno.env.get("GEMINI_API_KEY") || Deno.env.get("OPENAI_API_KEY"));
      const location = r.google_business_locations as any;
      const property = location?.reply_brand_name || location?.google_location_title || "our business";
      const category = location?.business_category || "other";
      const tone = toneInstruction[location?.reply_tone] || toneInstruction.warm_professional;
      const languageInstruction =
        location?.reply_language_mode === "english"
          ? "Reply in English."
          : location?.reply_language_mode === "hungarian"
            ? "Reply in Hungarian."
            : "Reply in the same language as the guest when identifiable; otherwise English.";
      const signature = location?.reply_signature
        ? ` End naturally with this signature: ${location.reply_signature}.`
        : "";
      const brandContext = location?.brand_context
        ? ` Property context you may use only when directly relevant and never as a reason to invent facts: ${location.brand_context}`
        : "";

      const analysis = classifyReview(Number(r.star_rating || 5), String(r.comment || ""));
      let draft = "";
      let aiProvider: "gemini" | "openai" | null = null;
      const curated = analysis.risk === "low" ? buildCuratedReply({
        reviewId: String(r.google_review_name || r.id),
        rating: Number(r.star_rating || 5),
        comment: r.comment,
        reviewerName: r.reviewer_display_name,
        venueName: property,
        venueCategory: category,
        venueContext: location?.brand_context,
        signature: location?.reply_signature,
        languageMode: location?.reply_language_mode,
      }) : null;
      if (curated) {
        draft = curated.text;
      } else {
        if (!aiProviderAvailable) return json({ error: "HotelCare AI is not configured" }, 409);
        const prompt = `Write a brief public Google review reply for the brand "${property}" (venue type: ${category}).
Public listing title for identification ONLY: ${location?.google_location_title || property}.
Guest review: ${String(r.comment).slice(0, 1800)}.
Rating: ${r.star_rating}/5. Style: ${tone}. ${languageInstruction}
Use the exact brand "${property}" if naming the business; do NOT infer a conference, hotel stay, meal, tour or service from the listing title. Mention a specific service ONLY when the guest review itself describes it. Never use a different venue's name or imply a hotel stay for a restaurant, museum, brunch or conference venue.
Write 1-3 natural sentences, typically 20-55 words; no generic marketing language or exaggerated praise. Never invent facts, compensation, or investigations. For negative feedback, be considerate without admitting unverified accusations. Avoid promising follow-up unless specifically instructed.${signature}${brandContext}
Risk level: ${analysis.risk}.`;
        const generated = await generateLowCostText({
          task: "public",
          instructions: "Write accurate, concise, venue-specific public Google review replies. Output only the reply, never invent facts.",
          prompt,
          fallbackModel: Deno.env.get("OPENAI_FALLBACK_MODEL") || "gpt-4o-mini",
          maxOutputTokens: 512,
          validate: (text) => text.trim().length >= 8 && text.length <= 4096,
        });
        draft = generated.text;
        aiProvider = generated.provider;
        if (!draft) throw new Error("AI returned an empty draft");
      }

      await admin
        .from("google_reviews")
        .update({
          ai_draft: draft,
          ai_sentiment: analysis.sentiment,
          ai_categories: analysis.categories,
          ai_summary: analysis.summary,
          ai_risk_level: analysis.risk,
          ai_confidence: analysis.confidence,
          ai_draft_generated_at: new Date().toISOString(),
          draft_edited_at: null,
          draft_edited_by: null,
          reply_status: "draft",
          updated_at: new Date().toISOString(),
        })
        .eq("id", reviewId);

      await audit(r, "draft_generated", draft, {
        risk: analysis.risk,
        source: curated ? "curated_reply_library" : (aiProvider || "openai"),
        template_id: curated?.templateId || null,
        tone: location?.reply_tone || "warm_professional",
        language_mode: location?.reply_language_mode || "match_guest",
      });

      return json({ ok: true, draft, source: curated ? "curated_reply_library" : (aiProvider || "openai"),
        template_id: curated?.templateId || null, ...analysis });
    }

    if (action === "update_draft") {
      const reviewId = String(body.review_id || "");
      const reply = String(body.reply || "").trim();
      if (!reviewId) return json({ error: "review_id required" }, 400);
      if (!reply) return json({ error: "Reply text is empty" }, 400);
      if (reply.length > 4096) return json({ error: "Reply is too long" }, 400);

      const { data: r } = await admin
        .from("google_reviews")
        .select("id,hotel_id,google_location_id")
        .eq("id", reviewId)
        .eq("organization_id", org.id)
        .maybeSingle();
      if (!r) return json({ error: "Review not found" }, 404);

      await admin
        .from("google_reviews")
        .update({
          ai_draft: reply,
          draft_edited_at: new Date().toISOString(),
          draft_edited_by: userData.user.id,
          reply_status: "draft",
          updated_at: new Date().toISOString(),
        })
        .eq("id", reviewId);
      await audit(r, "draft_edited", reply);
      return json({ ok: true, draft: reply });
    }

    if (action === "prepare_bulk_replies") {
      const ids = Array.isArray(body.review_ids) ? body.review_ids.map(String) : [];
      if (!ids.length || ids.length > 25 || new Set(ids).size !== ids.length)
        return json({ error: "Choose 1–25 distinct reviews for draft preparation." }, 400);
      const { data: selected, error } = await admin.from("google_reviews")
        .select("*,google_business_locations(id,organization_id,is_active,reply_brand_name,google_location_title,business_category,brand_context,reply_signature,reply_language_mode)")
        .eq("organization_id", org.id).in("id", ids);
      if (error) throw error;
      if ((selected || []).length !== ids.length) return json({ error: "One or more reviews no longer exist." }, 409);
      const cutoff = Date.now() - 14 * 86_400_000;
      const prepared = [];
      const rejected = [];
      for (const review of selected || []) {
        const location = review.google_business_locations;
        const ageMs = new Date(review.review_create_time || "").getTime();
        const safe = Number(review.star_rating) >= 4 &&
          classifyReview(Number(review.star_rating), String(review.comment || "")).risk === "low" &&
          ageMs >= cutoff && ageMs <= Date.now() &&
          !review.google_reply_comment && review.reply_status !== "published" &&
          location?.organization_id === org.id && location?.is_active;
        if (!safe) {
          rejected.push({ id: review.id, reason: "Review is not eligible for the safe 14-day approval queue." });
          continue;
        }
        if (review.draft_edited_at && review.ai_draft) {
          prepared.push({ id: review.id, draft: review.ai_draft, source: "manager_edited" });
          continue;
        }
        const draft = buildCuratedReply({
          reviewId: review.google_review_name,
          rating: review.star_rating,
          comment: review.comment,
          reviewerName: review.reviewer_display_name,
          venueName: location.reply_brand_name || location.google_location_title,
          venueCategory: location.business_category,
          venueContext: location.brand_context,
          signature: location.reply_signature,
          languageMode: location.reply_language_mode,
        });
        if (!draft) {
          rejected.push({ id: review.id, reason: "Needs a custom manager-reviewed reply." });
          continue;
        }
        const { error: writeError } = await admin.from("google_reviews")
          .update({ ai_draft: draft.text, ai_draft_generated_at: new Date().toISOString(),
            reply_status: "draft", ai_risk_level: "low", updated_at: new Date().toISOString() })
          .eq("id", review.id).eq("organization_id", org.id);
        if (writeError) {
          rejected.push({ id: review.id, reason: "Draft could not be saved." });
          continue;
        }
        await audit(review, "draft_generated", draft.text, { source: "curated_reply_library",
          template_id: draft.templateId, topic: draft.topic, bulk_preparation: true });
        prepared.push({ id: review.id, draft: draft.text, source: "curated_reply_library" });
      }
      return json({ ok: true, prepared, rejected, library_variants: CURATED_REPLY_BASE_COUNT });
    }

    if (action === "bulk_publish_replies") {
      // Batch approval is a one-time explicit decision, NOT a change to a venue's
      // unattended auto-reply policy. It cannot silently publish older reviews.
      if (body.confirm !== true) return json({ error: "Explicit confirmation is required." }, 409);
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length || items.length > 25) return json({ error: "Choose 1–25 reviews per batch." }, 400);
      const unique = new Set(items.map((x: any) => String(x?.id || "")));
      if (unique.size !== items.length) return json({ error: "Duplicate review selection." }, 400);
      const cutoffMs = Date.now() - 14 * 86_400_000;
      const { data: selected, error: selectionError } = await admin.from("google_reviews")
        .select("*,google_business_locations(id,is_active,organization_id,reply_brand_name,business_category)")
        .eq("organization_id", org.id).in("id", Array.from(unique));
      if (selectionError) throw selectionError;
      if ((selected || []).length !== items.length) return json({ error: "Some selected reviews were not found." }, 404);

      const planned: Array<{ review: any; reply: string }> = [];
      for (const entry of items) {
        const review = (selected || []).find((row: any) => row.id === entry.id);
        if (!review || !review.google_business_locations?.is_active ||
            review.google_business_locations?.organization_id !== org.id)
          return json({ error: "Selected listing is unavailable." }, 409);
        const created = new Date(review.review_create_time || "").getTime();
        if (!Number.isFinite(created) || created < cutoffMs || created > Date.now())
          return json({ error: "Only reviews received during the last 14 days are eligible for batch approval." }, 409);
        const stars = Number(review.star_rating || 0);
        const currentRisk = classifyReview(stars, String(review.comment || "")).risk;
        if (stars < 4 || currentRisk !== "low")
          return json({ error: "Only low-risk 4–5 star reviews can be bulk-approved; other reviews require individual manager attention." }, 409);
        if (review.reply_status === "published" || review.google_reply_comment)
          return json({ error: "A selected review has already been answered." }, 409);
        const reply = String(entry.reply || "").trim();
        if (!reply || reply.length > 1500)
          return json({ error: "Each reply must be reviewed, nonempty, and at most 1,500 characters." }, 400);
        if (!String(review.ai_draft || "").trim())
          return json({ error: "Prepare a draft for every selected review before bulk publishing." }, 409);
        planned.push({ review, reply });
      }

      const outcomes: Array<{ id: string; status: "published" | "skipped" | "error"; message?: string }> = [];
      for (const { review, reply } of planned) {
        try {
          const live = await gfetch(`https://mybusiness.googleapis.com/v4/${review.google_review_name}`);
          if (live?.reviewReply?.comment) {
            // Do not overwrite anything posted outside HotelCare since last sync.
            outcomes.push({ id: review.id, status: "skipped", message: "Already replied on Google" });
            continue;
          }
          const posted = await gfetch(`https://mybusiness.googleapis.com/v4/${review.google_review_name}/reply`, {
            method: "PUT", body: JSON.stringify({ comment: reply }),
          });
          const now = new Date().toISOString();
          const { error: writeError } = await admin.from("google_reviews")
            .update({ ai_draft: reply, google_reply_comment: reply, google_reply_update_time: posted.updateTime || now,
              reply_status: "published", reply_origin: "bulk", replied_at: now,
              replied_by: userData.user.id, updated_at: now })
            .eq("id", review.id).eq("organization_id", org.id);
          if (writeError) throw writeError;
          await audit(review, "bulk_published", reply, { approved_by: userData.user.id,
            explicitly_selected: true, review_date: review.review_create_time, window_days: 14 });
          outcomes.push({ id: review.id, status: "published" });
        } catch (error) {
          outcomes.push({ id: review.id, status: "error",
            message: error instanceof Error ? error.message.slice(0, 240) : "Could not publish" });
        }
      }
      return json({ ok: true, outcomes, published: outcomes.filter((x) => x.status === "published").length });
    }

    if (action === "publish_reply") {
      const reviewId = String(body.review_id || "");
      if (!reviewId) return json({ error: "review_id required" }, 400);

      const { data: r } = await admin
        .from("google_reviews")
        .select("*,google_business_locations(*)")
        .eq("id", reviewId)
        .eq("organization_id", org.id)
        .maybeSingle();
      if (!r) return json({ error: "Review not found" }, 404);

      const reply = String(body.reply || r.ai_draft || "").trim();
      if (!reply) return json({ error: "Reply text is empty" }, 400);
      if (reply.length > 4096) return json({ error: "Reply is too long" }, 400);

      const location = r.google_business_locations as any;
      const isAuto = Boolean(body.auto);
      if (isAuto) {
        if (!location?.auto_reply_enabled || location?.reply_mode === "draft_only") {
          return json({ error: "Automatic replies are disabled for this location" }, 409);
        }
        if (Number(r.star_rating || 0) < Number(location?.min_auto_rating || 4)) {
          return json({ error: "This review is below the automatic-reply rating threshold" }, 409);
        }
        if (String(r.ai_risk_level || "medium") !== "low") {
          return json({ error: "Only low-risk reviews can be automatically published" }, 409);
        }
      }

      await audit(r, "approved", reply, { auto: isAuto });
      try {
        const x = await gfetch(`https://mybusiness.googleapis.com/v4/${r.google_review_name}/reply`, {
          method: "PUT",
          body: JSON.stringify({ comment: reply }),
        });
        await admin
          .from("google_reviews")
          .update({
            ai_draft: reply,
            google_reply_comment: reply,
            google_reply_update_time: x.updateTime || new Date().toISOString(),
            reply_status: "published",
            reply_origin: isAuto ? "automatic" : "manager",
            replied_at: new Date().toISOString(),
            replied_by: userData.user.id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", reviewId);
        await audit(r, isAuto ? "auto_published" : "published", reply, {
          google_update_time: x.updateTime || null,
        });
        return json({ ok: true, reply: x });
      } catch (e) {
        await audit(r, "publish_failed", reply, { error: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    }

    return json({ error: "Unsupported action" }, 400);
  } catch (e) {
    console.error("google-reputation", action, e);
    if (e instanceof GoogleApiError) {
      return json(
        { ok: false, error: e.message, error_code: e.googleCode, google_api_status: e.httpStatus },
        200,
      );
    }
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
