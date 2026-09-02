import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

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
  if (bytes.length !== 32) bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
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
      : stars <= 3 || mediumRiskWords.some((w) => text.includes(w))
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

    const { data: profile } = await admin
      .from("profiles")
      .select("role,organization_slug,is_super_admin")
      .eq("id", userData.user.id)
      .single();
    if (
      !profile ||
      (!profile.is_super_admin && !["admin", "top_management", "top_management_manager"].includes(profile.role))
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
      actorUserId: string | null = userData.user.id,
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
          last_error: null,
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
              "id,hotel_id,google_account_name,google_location_name,google_location_title,place_id,store_code,reply_mode,min_auto_rating,is_active,last_sync_at,reply_tone,reply_language_mode,auto_reply_enabled,auto_reply_delay_minutes,require_approval_below_rating,reply_signature,brand_context",
            )
            .eq("organization_id", org.id)
            .order("google_location_title"),
          admin
            .from("google_reviews")
            .select(
              "id,hotel_id,google_location_id,reviewer_display_name,reviewer_profile_photo_url,star_rating,comment,review_create_time,review_update_time,google_reply_comment,google_reply_update_time,ai_language,ai_sentiment,ai_categories,ai_summary,ai_risk_level,ai_confidence,ai_draft,ai_draft_generated_at,draft_edited_at,reply_status,replied_at,auto_reply_eligible",
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

      return json({
        ok: true,
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
      const accounts = await gfetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts");
      const found: any[] = [];

      for (const a of accounts.accounts || []) {
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
        accounts: (accounts.accounts || []).map((a: any) => ({
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

      const updates = {
        hotel_id: hotelId,
        reply_mode: mode,
        min_auto_rating: minAuto,
        require_approval_below_rating: approvalBelow,
        reply_tone: tone,
        reply_language_mode: languageMode,
        auto_reply_enabled: autoEnabled,
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
        .eq("is_active", true)
        .not("hotel_id", "is", null);

      let imported = 0;
      let unreplied = 0;
      for (const l of locs || []) {
        if (!l.google_account_name || !l.google_location_name) continue;
        let pageToken = "";
        do {
          const q = new URLSearchParams({ pageSize: "50" });
          if (pageToken) q.set("pageToken", pageToken);
          const x = await gfetch(
            `https://mybusiness.googleapis.com/v4/${l.google_account_name}/${l.google_location_name}/reviews?${q.toString()}`,
          );

          for (const r of x.reviews || []) {
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
              reply_status: r.reviewReply?.comment ? "published" : "unreplied",
              auto_reply_eligible:
                stars >= Number(l.min_auto_rating || 4) &&
                analysis.risk === "low" &&
                Boolean(l.auto_reply_enabled) &&
                l.reply_mode !== "draft_only",
              raw: r,
              updated_at: new Date().toISOString(),
            };

            const { error } = await admin.from("google_reviews").upsert(row, { onConflict: "google_review_name" });
            if (error) throw error;
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

      const key = Deno.env.get("OPENAI_API_KEY");
      if (!key) return json({ error: "HotelCare AI is not configured" }, 409);

      const location = r.google_business_locations as any;
      const property = location?.google_location_title || "the property";
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
      const prompt = `Write a Google Business Profile owner reply for ${property}.
Rating: ${r.star_rating}/5.
Guest review: ${r.comment || "(no written comment)"}.
Style: ${tone}.
${languageInstruction}
Keep it roughly 45-100 words. Be specific to what the guest actually said. Never invent facts, compensation, refunds, investigations or promises. Do not mention AI. Do not argue. For negative reviews acknowledge the concern without admitting unverified claims, and invite direct contact only when useful.${signature}${brandContext}
Risk level assessed by HotelCare: ${analysis.risk}. If risk is high, use especially careful neutral wording.`;

      const oa = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: Deno.env.get("OPENAI_REVIEW_MODEL") || "gpt-4.1-mini",
          instructions: "You write accurate, human hospitality review responses for HotelCare. Output only the reply text.",
          input: prompt,
          max_output_tokens: 300,
        }),
      });
      if (!oa.ok) throw new Error(`AI ${oa.status}: ${(await oa.text()).slice(0, 250)}`);

      const ox = await oa.json();
      const draft = String(
        ox.output_text ||
          (ox.output || [])
            .flatMap((o: any) => o.content || [])
            .filter((c: any) => c.type === "output_text")
            .map((c: any) => c.text || "")
            .join(""),
      ).trim();
      if (!draft) throw new Error("AI returned an empty draft");

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
        tone: location?.reply_tone || "warm_professional",
        language_mode: location?.reply_language_mode || "match_guest",
      });

      return json({ ok: true, draft, ...analysis });
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
