import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

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
  if (bytes.length !== 32) bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
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

function classifyReview(stars: number, comment: string) {
  const text = String(comment || "").toLowerCase();
  const categories: string[] = [];
  const add = (name: string, words: string[]) => {
    if (words.some((word) => text.includes(word))) categories.push(name);
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
    "refund", "fraud", "stolen", "theft", "police", "injury", "injured", "unsafe",
    "discrimination", "racist", "bedbug", "bed bug", "food poisoning", "legal", "lawyer",
  ];
  const mediumRiskWords = ["complaint", "manager", "charged", "overcharged", "mold", "mould", "cockroach"];
  const risk =
    stars <= 1 || highRiskWords.some((word) => text.includes(word))
      ? "high"
      : stars <= 3 || mediumRiskWords.some((word) => text.includes(word))
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

function autoEligible(location: any, stars: number, risk: string, reviewTime: string | null) {
  if (!location?.auto_reply_enabled || !location?.auto_reply_enabled_at) return false;
  if (risk !== "low" || location.reply_mode === "draft_only") return false;
  const minimum = Math.max(1, Math.min(5, Number(location.min_auto_rating || 4)));
  const approvalFloor = Math.max(1, Math.min(5, Number(location.require_approval_below_rating || 4)));
  if (stars < approvalFloor) return false;
  if (location.reply_mode === "auto_positive" && stars < Math.max(4, minimum)) return false;
  if (location.reply_mode === "auto_all" && stars < minimum) return false;
  const reviewMs = new Date(reviewTime || "").getTime();
  const enabledMs = new Date(location.auto_reply_enabled_at).getTime();
  if (!Number.isFinite(reviewMs) || !Number.isFinite(enabledMs) || reviewMs < enabledMs) return false;
  const delayMs = Math.max(0, Math.min(1440, Number(location.auto_reply_delay_minutes || 0))) * 60_000;
  return Date.now() - reviewMs >= delayMs;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRole);

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
  const errors: Array<Record<string, unknown>> = [];

  async function audit(review: any, eventType: string, replyText: string | null = null, metadata: Record<string, unknown> = {}) {
    await admin.from("google_review_reply_events").insert({
      organization_id: review.organization_id,
      hotel_id: review.hotel_id || null,
      google_location_id: review.google_location_id || null,
      review_id: review.id,
      actor_user_id: null,
      event_type: eventType,
      reply_text: replyText,
      metadata: { worker: true, ...metadata },
    });
  }

  async function tokenFor(connection: any) {
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
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", connection.id);
    return String(result.access_token);
  }

  async function googleFetch(connection: any, accessToken: string, target: string, init: RequestInit = {}) {
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
      await admin
        .from("google_business_connections")
        .update({ last_error: message, updated_at: new Date().toISOString() })
        .eq("id", connection.id);
      throw new Error(message);
    }
    return payload;
  }

  async function generateDraft(review: any, location: any) {
    const key = Deno.env.get("OPENAI_API_KEY");
    if (!key) throw new Error("OPENAI_API_KEY missing");
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
    const prompt = `Write a Google Business Profile owner reply for ${location.google_location_title || "the property"}.
Rating: ${review.star_rating}/5.
Guest review: ${review.comment || "(no written comment)"}.
Style: ${tone}.
${languageInstruction}
Keep it roughly 45-100 words. Be specific to what the guest actually said. Never invent facts, compensation, refunds, investigations or promises. Do not mention AI. Do not argue. For negative reviews acknowledge the concern without admitting unverified claims.${signature}${context}
HotelCare risk level: ${review.ai_risk_level || "medium"}.`;
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_REVIEW_MODEL") || "gpt-4.1-mini",
        instructions: "You write accurate, human hospitality review responses for HotelCare. Output only the reply text.",
        input: prompt,
        max_output_tokens: 300,
      }),
    });
    if (!response.ok) throw new Error(`AI ${response.status}: ${(await response.text()).slice(0, 220)}`);
    const result = await response.json();
    const draft = String(
      result.output_text ||
        (result.output || [])
          .flatMap((item: any) => item.content || [])
          .filter((item: any) => item.type === "output_text")
          .map((item: any) => item.text || "")
          .join(""),
    ).trim();
    if (!draft) throw new Error("AI returned an empty draft");
    return draft;
  }

  try {
    const { data: connections, error: connectionsError } = await admin
      .from("google_business_connections")
      .select("*")
      .eq("status", "active")
      .order("updated_at", { ascending: false });
    if (connectionsError) throw connectionsError;

    for (const connection of connections || []) {
      connectionsChecked++;
      if (shouldBackoff(connection)) continue;
      try {
        const accessToken = await tokenFor(connection);
        const { data: locations, error: locationsError } = await admin
          .from("google_business_locations")
          .select("*")
          .eq("connection_id", connection.id)
          .eq("is_active", true)
          .not("hotel_id", "is", null);
        if (locationsError) throw locationsError;

        for (const location of locations || []) {
          locationsChecked++;
          try {
            const query = new URLSearchParams({ pageSize: "50", orderBy: "updateTime desc" });
            const response = await googleFetch(
              connection,
              accessToken,
              `https://mybusiness.googleapis.com/v4/${location.google_account_name}/${location.google_location_name}/reviews?${query.toString()}`,
            );

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
              const changed = Boolean(
                existing &&
                  ((existing.comment || null) !== comment ||
                    String(existing.review_update_time || "") !== String(updateTime || "")),
              );
              const hasGoogleReply = Boolean(googleReview.reviewReply?.comment);
              const retainedDraft = !changed ? existing?.ai_draft || null : null;
              const replyStatus = hasGoogleReply ? "published" : retainedDraft ? "draft" : "unreplied";
              const eligible = autoEligible(location, stars, analysis.risk, googleReview.createTime || updateTime);

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
                auto_reply_eligible: eligible,
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

              if (hasGoogleReply) {
                if (existing && existing.reply_status !== "published") {
                  await audit(saved, "sync_detected_reply", googleReview.reviewReply.comment, { source: "google" });
                }
                continue;
              }

              let draft = retainedDraft;
              if (!draft) {
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

              if (eligible && draft) {
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
                    replied_at: new Date().toISOString(),
                    replied_by: null,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", saved.id);
                await audit(saved, "auto_published", draft, {
                  google_update_time: publishResult.updateTime || null,
                });
                repliesPublished++;
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

        if (!errors.some((item) => item.connection_id === connection.id)) {
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

    const finalStatus = errors.length ? "partial" : "completed";
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
