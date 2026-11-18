// Applies an automation-rule change the Hotel Care Assistant proposed and the
// user confirmed. Everything is re-validated here: session, role, organization,
// hotel, field allowlist and ranges. The chat function never writes rules.
//
// Three kinds of change arrive through the same confirmation card:
//   • plain rule columns (the original behaviour, unchanged);
//   • pace-ratchet policy numbers, merged into the rule's pace_policy JSON after
//     a backup of the whole rule;
//   • stay-date tags (normal / high / peak / dismissed / automatic) and a
//     per-date highest price, stored in revenue_date_tiers.
// The policy's mode (off / shadow / live) can never be changed from here.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  canChangeAutomation,
  describeDateTier,
  mergePolicyChanges,
  validateChanges,
  type ValidatedChange,
} from "../_shared/assistantAutomationFields.ts";
import { resolveAssistantHotels } from "../_shared/assistantHotels.ts";
import { resolvePaceSettings } from "../_shared/engineV2PaceRatchet.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Applied = { field: string; label: string; from: unknown; to: unknown };
type TierRow = { stay_date: string; tier: string; status: string; ceiling_eur: number | null; source: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Configuration incomplete" }, 500);

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await authClient.auth.getUser(authHeader.slice(7));
    if (userError || !userData.user) return json({ error: "Invalid session" }, 401);

    const body = await req.json().catch(() => null);
    const hotelId = typeof body?.hotel_id === "string" ? body.hotel_id : "";
    const ruleId = typeof body?.rule_id === "string" ? body.rule_id : "";
    const reason = typeof body?.reason === "string" ? body.reason.slice(0, 500) : "";
    if (!hotelId || !ruleId) return json({ error: "A hotel and rule are required" }, 400);

    const validated = validateChanges(body?.changes);
    if (!validated.ok) return json({ error: validated.error }, 400);

    const { data: profile, error: profileError } = await service
      .from("profiles")
      .select("id,role,assigned_hotel,organization_slug,full_name")
      .eq("id", userData.user.id)
      .is("deleted_at", null)
      .single();
    if (profileError || !profile) return json({ error: "Profile not found" }, 403);
    if (!canChangeAutomation(profile.role)) return json({ error: "Your role cannot change automation rules" }, 403);

    const hotels = await resolveAssistantHotels(service, profile as any);
    if (!hotels.some((h) => h.hotel_id === hotelId)) {
      return json({ error: "That property is outside your access" }, 403);
    }

    const { data: rule, error: ruleError } = await service
      .from("revenue_pickup_automation_rules")
      .select("*")
      .eq("id", ruleId)
      .eq("hotel_id", hotelId)
      .eq("organization_slug", profile.organization_slug)
      .maybeSingle();
    if (ruleError) return json({ error: `Rule lookup failed: ${ruleError.message}` }, 500);
    if (!rule) return json({ error: "Automation configuration not found" }, 404);

    const ruleChanges = validated.changes.filter((c) => c.target === "rule");
    const policyChanges = validated.changes.filter((c) => c.target === "policy");
    const tierChanges = validated.changes.filter(
      (c): c is Extract<ValidatedChange, { target: "tier" }> => c.target === "tier",
    );
    const ceilingChanges = validated.changes.filter(
      (c): c is Extract<ValidatedChange, { target: "ceiling" }> => c.target === "ceiling",
    );

    if (policyChanges.length + tierChanges.length + ceilingChanges.length > 0
      && resolvePaceSettings(rule.pace_policy).mode === "off") {
      return json({
        error: "This property does not use the pace-based pricing rules, so there is nothing to change there.",
      }, 400);
    }

    const applied: Applied[] = [];
    const nowIso = new Date().toISOString();

    // ---- Plan the stay-date tags before anything is written ----------------
    const tagDates = [...new Set([...tierChanges, ...ceilingChanges].map((c) => c.stayDate))];
    const existing = new Map<string, TierRow>();
    if (tagDates.length > 0) {
      const { data: rows, error: tierError } = await service
        .from("revenue_date_tiers")
        .select("stay_date, tier, status, ceiling_eur, source")
        .eq("hotel_id", hotelId)
        .in("stay_date", tagDates);
      if (tierError) return json({ error: `Date tag lookup failed: ${tierError.message}` }, 500);
      for (const row of (rows ?? []) as TierRow[]) existing.set(row.stay_date, row);
    }
    const tierByDate = new Map(tierChanges.map((c) => [c.stayDate, c]));
    const ceilingByDate = new Map(ceilingChanges.map((c) => [c.stayDate, c]));
    for (const change of ceilingChanges) {
      if (change.value == null) continue;
      const tag = tierByDate.get(change.stayDate)?.value;
      const row = existing.get(change.stayDate);
      const tagged = tag
        ? ["normal", "high", "peak"].includes(tag)
        : Boolean(row) && row!.status === "confirmed";
      if (!tagged) {
        return json({
          error: `Tag ${change.stayDate} as normal, high or peak before giving it its own highest price.`,
        }, 400);
      }
    }

    // ---- Rule columns and policy numbers ------------------------------------
    let version = Number(rule.version ?? 1);
    if (ruleChanges.length + policyChanges.length > 0) {
      const patch: Record<string, unknown> = {
        version: version + 1,
        updated_by: userData.user.id,
        updated_at: nowIso,
      };
      for (const change of ruleChanges) {
        patch[change.field] = change.value;
        applied.push({ field: change.field, label: change.label, from: rule[change.field] ?? null, to: change.value });
      }
      if (policyChanges.length > 0) {
        const merged = mergePolicyChanges(rule.pace_policy, policyChanges);
        if (merged.adjusted.length > 0) return json({ error: `${merged.adjusted.join("; ")}.` }, 400);
        patch.pace_policy = merged.next;
        for (const change of policyChanges) {
          if (change.target !== "policy") continue;
          applied.push({ field: change.field, label: change.label, from: merged.before[change.key], to: change.value });
        }
        // A pricing-policy change is always restorable.
        const { error: backupError } = await service.from("revenue_rule_backups").insert({
          hotel_id: hotelId,
          note: `assistant policy change by ${profile.full_name ?? userData.user.id}: ${policyChanges
            .map((c) => `${c.field}=${String(c.value)}`).join(", ")}`.slice(0, 500),
          rule,
        });
        if (backupError) {
          return json({ error: `Nothing was changed: the safety backup could not be saved (${backupError.message}).` }, 500);
        }
      }

      // Only overwrite the version that was read: the pricing engine's own
      // switch (shadow → live) edits the same JSON and must never be undone by
      // a card that was approved a moment too late.
      let update = service
        .from("revenue_pickup_automation_rules")
        .update(patch)
        .eq("id", ruleId)
        .eq("hotel_id", hotelId)
        .eq("organization_slug", profile.organization_slug);
      update = rule.version == null ? update.is("version", null) : update.eq("version", rule.version);
      const { data: updated, error: updateError } = await update.select("id");
      if (updateError) return json({ error: `Could not save the change: ${updateError.message}` }, 500);
      if (!updated || updated.length === 0) {
        return json({
          error: "The automation rules changed while this card was open. Nothing was saved — ask again to get a fresh proposal.",
        }, 409);
      }
      version += 1;
    }

    // ---- Stay-date tags -------------------------------------------------------
    for (const stayDate of tagDates) {
      const row = existing.get(stayDate) ?? null;
      const tag = tierByDate.get(stayDate);
      const ceiling = ceilingByDate.get(stayDate);
      const reviewer = { reviewed_by: userData.user.id, reviewed_at: nowIso, updated_at: nowIso };

      if (tag?.value === "auto") {
        if (row) {
          const { error } = await service.from("revenue_date_tiers").delete().eq("hotel_id", hotelId).eq("stay_date", stayDate);
          if (error) return json({ error: `Could not clear the tag for ${stayDate}: ${error.message}`, applied }, 500);
        }
        applied.push({ field: tag.field, label: tag.label, from: describeDateTier(row), to: "automatic" });
        continue;
      }

      const fields: Record<string, unknown> = { ...reviewer };
      if (tag?.value === "dismissed") fields.status = "dismissed";
      else if (tag) { fields.tier = tag.value; fields.status = "confirmed"; }
      if (ceiling) fields.ceiling_eur = ceiling.value;

      if (row) {
        const { error } = await service.from("revenue_date_tiers").update(fields).eq("hotel_id", hotelId).eq("stay_date", stayDate);
        if (error) return json({ error: `Could not save the tag for ${stayDate}: ${error.message}`, applied }, 500);
      } else {
        const { error } = await service.from("revenue_date_tiers").insert({
          hotel_id: hotelId,
          organization_slug: profile.organization_slug ?? "",
          stay_date: stayDate,
          tier: "normal",
          source: "manual",
          status: "confirmed",
          reason: reason || null,
          created_by: userData.user.id,
          created_by_name: profile.full_name ?? null,
          ...fields,
        });
        if (error) return json({ error: `Could not save the tag for ${stayDate}: ${error.message}`, applied }, 500);
      }
      if (tag) {
        applied.push({ field: tag.field, label: tag.label, from: describeDateTier(row), to: tag.value });
      }
      if (ceiling) {
        applied.push({ field: ceiling.field, label: ceiling.label, from: row?.ceiling_eur ?? null, to: ceiling.value });
      }
    }

    const { error: auditError } = await service.from("assistant_audit_log").insert({
      user_id: userData.user.id,
      organization_slug: profile.organization_slug,
      hotel_id: hotelId,
      role: profile.role,
      question: `Applied automation change: ${applied
        .map((row) => `${row.field} ${String(row.from)} → ${String(row.to)}`)
        .join("; ")}${reason ? ` (${reason})` : ""}`.slice(0, 4000),
      refused: false,
      scopes_used: ["automation_write"],
      model: "assistant-apply-automation-change",
    });
    if (auditError) console.error("assistant automation audit failed", auditError);

    return json({ ok: true, hotelId, version, applied });
  } catch (error) {
    console.error("assistant-apply-automation-change error", error);
    return json({ error: error instanceof Error ? error.message : "Request failed" }, 500);
  }
});
