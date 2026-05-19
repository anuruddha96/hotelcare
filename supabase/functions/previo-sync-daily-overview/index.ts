// Live Daily Overview sync from Previo (XML searchReservations).
// HARD-GATED to hotels with pms_configurations.pms_type='previo' and is_active=true.
//
// Expands each reservation into one row per occupied business_date and upserts
// into public.daily_overview_snapshots with source='previo'. The unique index
// (hotel_id, business_date, room_label, source) keeps re-syncs idempotent and
// does not touch source='manual' rows from XLSX uploads.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { parseRoomCode } from "../_shared/roomCode.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(base: string, n: number): string {
  const d = new Date(base + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

interface ParsedReservation {
  roomName: string;
  arrivalDate: string;   // YYYY-MM-DD inclusive
  departureDate: string; // YYYY-MM-DD exclusive
  statusId: number;
  guestNames: string;
  pax: number;
  // meal flags per stay-night (best-effort from Previo block)
  hasBreakfast: boolean;
  hasLunch: boolean;
  hasDinner: boolean;
  isAllInclusive: boolean;
}

function parseCreds(rawSecret: string): { user: string; pass: string } {
  const stripQuotes = (s: string) =>
    (s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))
      ? s.slice(1, -1).trim() : s;
  const cleaned = stripQuotes(rawSecret.trim());
  try {
    const j = JSON.parse(cleaned);
    if (j && typeof j === "object") {
      const u = stripQuotes(String(j.username ?? j.user ?? j.login ?? j.email ?? ""));
      const p = stripQuotes(String(j.password ?? j.pass ?? j.secret ?? ""));
      if (u && p) return { user: u, pass: p };
    }
  } catch { /* noop */ }
  const m = cleaned.match(/^([^:\s]+):(.+)$/);
  if (m) return { user: stripQuotes(m[1]), pass: stripQuotes(m[2]) };
  return { user: "", pass: "" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const anon = createClient(SUPABASE_URL, ANON);
    const { data: userRes } = await anon.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!userRes?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const service = createClient(SUPABASE_URL, SERVICE);

    const body = await req.json().catch(() => ({} as any));
    const hotelId: string = body.hotelId || "";
    const days: number = Math.min(Math.max(Number(body.days) || 90, 1), 540);
    const fromDate: string = body.fromDate || isoDate(new Date());
    const toDate: string = body.toDate || addDays(fromDate, days);
    if (!hotelId) {
      return new Response(JSON.stringify({ error: "hotelId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Profile & access check
    const { data: profile } = await service
      .from("profiles")
      .select("role, assigned_hotel, organization_slug")
      .eq("id", userRes.user.id)
      .maybeSingle();
    const isAdmin = profile?.role === "admin" || profile?.role === "top_management";
    if (!isAdmin && profile?.assigned_hotel !== hotelId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const orgSlug = profile?.organization_slug || "rdhotels";

    // Hard gate: must have an active Previo config
    const { data: cfg } = await service
      .from("pms_configurations")
      .select("id, hotel_id, pms_hotel_id, credentials_secret_name, is_active, pms_type")
      .eq("hotel_id", hotelId)
      .eq("pms_type", "previo")
      .maybeSingle();
    if (!cfg || !cfg.is_active) {
      return new Response(JSON.stringify({
        ok: true, supported: false,
        message: `Daily overview live sync is only available for Previo hotels — use XLSX upload for ${hotelId}.`,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const rawSecret = String(Deno.env.get(cfg.credentials_secret_name || "") || "");
    const { user: xmlUser, pass: xmlPass } = parseCreds(rawSecret);
    if (!xmlUser || !xmlPass) {
      return new Response(JSON.stringify({ ok: false, error: "Could not parse Previo credentials" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pull reservations XML for window
    const xmlBody = `<?xml version="1.0"?>
<request>
<login>${xmlUser}</login>
<password>${xmlPass}</password>
<hotId>${String(cfg.pms_hotel_id || "")}</hotId>
<term><from>${fromDate}</from><to>${toDate}</to></term>
</request>`;
    const xmlResp = await fetch("https://api.previo.cz/x1/hotel/searchReservations/", {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=UTF-8" },
      body: xmlBody,
    });
    const xmlText = await xmlResp.text();
    if (!xmlResp.ok || /<error>/i.test(xmlText)) {
      const errMatch = xmlText.match(/<message>([^<]*)<\/message>/i);
      const errMsg = `Previo XML ${xmlResp.status}: ${errMatch?.[1] || xmlText.slice(0, 200)}`;
      return new Response(JSON.stringify({ ok: false, error: errMsg }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse reservation blocks
    const grab = (s: string, tag: string) => {
      const m = s.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
      return m ? m[1].trim() : "";
    };
    const reservations: ParsedReservation[] = [];
    const blocks = xmlText.match(/<reservation>[\s\S]*?<\/reservation>/g) || [];
    for (const block of blocks) {
      const fromStr = grab(block, "from");
      const toStr = grab(block, "to");
      if (!fromStr || !toStr) continue;
      const statusId = parseInt(grab(block, "statusId") || "0", 10);
      if (statusId === 7 || statusId === 8) continue; // skip cancelled / no-show

      const objMatch = block.match(
        /<object>[\s\S]*?<objId>(\d+)<\/objId>[\s\S]*?<name>([^<]*)<\/name>[\s\S]*?<\/object>/,
      );
      const roomName = objMatch ? objMatch[2].trim() : "";
      if (!roomName) continue;

      // Guest names: concatenate <guest><firstName/><surname/></guest>
      const guestBlocks = block.match(/<guest>[\s\S]*?<\/guest>/g) || [];
      const names: string[] = [];
      for (const g of guestBlocks) {
        const first = (g.match(/<firstName>([^<]*)<\/firstName>/) || [])[1] || "";
        const last = (g.match(/<surname>([^<]*)<\/surname>/) || [])[1] || "";
        const full = [first.trim(), last.trim()].filter(Boolean).join(" ");
        if (full) names.push(full);
      }
      const pax = guestBlocks.length || 1;

      // Meals: look for <meal> / <board> / <package> markers (best-effort)
      const mealText = (block.match(/<meal[^>]*>([^<]*)<\/meal>/i)
        || block.match(/<board[^>]*>([^<]*)<\/board>/i)
        || block.match(/<package[^>]*>([^<]*)<\/package>/i)
        || [, ""])[1] || "";
      const ml = mealText.toLowerCase();
      const hasBreakfast = /\bbb\b|breakfast|bnf|reggeli/.test(ml);
      const hasLunch = /\blunch\b|ebéd/.test(ml);
      const hasDinner = /\bhb\b|dinner|vacsora/.test(ml);
      const isAllInclusive = /\bai\b|all[\s-]?inclusive/.test(ml);

      reservations.push({
        roomName,
        arrivalDate: fromStr.slice(0, 10),
        departureDate: toStr.slice(0, 10),
        statusId,
        guestNames: names.join(", "),
        pax,
        hasBreakfast,
        hasLunch,
        hasDinner,
        isAllInclusive,
      });
    }

    // Expand per business_date
    const capturedAt = new Date().toISOString();
    const rows: any[] = [];
    for (const r of reservations) {
      const parsed = parseRoomCode(r.roomName, hotelId);
      const room_label = r.roomName;
      const room_number = parsed?.room_number ?? null;
      const room_type_code = parsed?.room_type_code ?? null;
      const room_suffix = parsed?.room_suffix ?? null;

      let cursor = r.arrivalDate < fromDate ? fromDate : r.arrivalDate;
      const stopAt = r.departureDate > toDate ? toDate : r.departureDate;
      while (cursor < stopAt) {
        rows.push({
          hotel_id: hotelId,
          organization_slug: orgSlug,
          business_date: cursor,
          room_label,
          room_number,
          room_type_code,
          room_suffix,
          arrival_date: r.arrivalDate,
          departure_date: r.departureDate,
          status: String(r.statusId),
          guest_names: r.guestNames || null,
          pax: r.pax,
          breakfast: r.hasBreakfast ? r.pax : 0,
          lunch: r.hasLunch ? r.pax : 0,
          dinner: r.hasDinner ? r.pax : 0,
          all_inclusive: r.isAllInclusive ? r.pax : 0,
          housekeeping_stay: null,
          housekeeping_dep: cursor === addDays(r.departureDate, -1) ? "DEP" : null,
          source: "previo",
          source_filename: null,
          uploaded_by: null,
          captured_at: capturedAt,
        });
        cursor = addDays(cursor, 1);
      }
    }

    // Clear previo rows in window then re-insert (cancellations vanish)
    await service.from("daily_overview_snapshots")
      .delete()
      .eq("hotel_id", hotelId)
      .eq("source", "previo")
      .gte("business_date", fromDate)
      .lt("business_date", toDate);

    const chunk = <T>(arr: T[], n: number) => {
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
      return out;
    };

    let inserted = 0;
    let lastErr: string | null = null;
    for (const part of chunk(rows, 200)) {
      const { error } = await service.from("daily_overview_snapshots").insert(part);
      if (error) {
        lastErr = error.message;
        console.error("daily_overview_snapshots insert error:", error.message);
      } else {
        inserted += part.length;
      }
    }

    await service.from("revenue_sync_history").insert({
      hotel_id: hotelId,
      organization_slug: orgSlug,
      source: "previo-daily-overview",
      status: lastErr ? "partial" : "ok",
      rows_processed: rows.length,
      error_message: lastErr,
      changed_by: userRes.user.id,
    }).then(() => {}, () => {});

    return new Response(JSON.stringify({
      ok: true,
      supported: true,
      hotelId,
      window: { from: fromDate, to: toDate },
      reservations: reservations.length,
      rowsInserted: inserted,
      error: lastErr,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("previo-sync-daily-overview fatal:", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
