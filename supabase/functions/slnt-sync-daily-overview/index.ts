import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { callPrevioXml, loadPrevioCredentials } from "../_shared/previoCredentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function normalizeName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function grab(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return match ? match[1].trim() : "";
}

type AccountRow = {
  id: string;
  label: string | null;
  pms_hotel_id: string;
  credentials_secret_name: string;
};

type UnitMap = {
  pms_account_id: string | null;
  external_room_id: string | null;
  source_name: string | null;
  normalized_name: string | null;
  canonical_room_name: string | null;
  room_id: string | null;
};

type ParsedReservation = {
  accountId: string;
  accountLabel: string;
  objectId: string;
  roomName: string;
  arrivalDate: string;
  departureDate: string;
  statusId: number;
  guestNames: string;
  pax: number;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const service = createClient(SUPABASE_URL, SERVICE);
    const verifier = createClient(SUPABASE_URL, ANON);
    const { data: userResult, error: userError } = await verifier.auth.getUser(token);
    if (userError || !userResult?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userResult.user.id;
    const { data: profile } = await service
      .from("profiles")
      .select("role, assigned_hotel, organization_slug, is_super_admin")
      .eq("id", userId)
      .maybeSingle();

    const body = await req.json().catch(() => ({} as any));
    const hotelId = String(body.hotelId || "").trim();
    const fromDate = String(body.fromDate || isoDate(new Date())).slice(0, 10);
    const days = Math.min(Math.max(Number(body.days) || 14, 1), 31);
    const toDate = String(body.toDate || addDays(fromDate, days)).slice(0, 10);

    if (hotelId !== "slnt-group") {
      return new Response(JSON.stringify({ error: "This endpoint is restricted to the SLNT portfolio." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const role = String(profile?.role || "");
    const privileged = ["admin", "top_management", "top_management_manager", "manager", "housekeeping_manager", "supervisor"].includes(role);
    const assigned = String(profile?.assigned_hotel || "").trim().toLowerCase();
    const assignedSlnt = assigned === "slnt-group" || assigned === "slnt group";
    if (profile?.is_super_admin !== true && (profile?.organization_slug !== "slnt" || (!privileged && !assignedSlnt))) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: accountRows, error: accountError } = await service
      .from("pms_accounts")
      .select("id,label,pms_hotel_id,credentials_secret_name")
      .eq("hotel_id", hotelId)
      .eq("pms_type", "previo")
      .eq("is_active", true);
    if (accountError) throw accountError;

    const accounts = (accountRows || []) as AccountRow[];
    if (accounts.length === 0) {
      return new Response(JSON.stringify({ ok: false, supported: false, error: "No active SLNT Previo accounts are configured." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: mappingRows, error: mappingError } = await service
      .from("pms_unit_mappings")
      .select("pms_account_id,external_room_id,source_name,normalized_name,canonical_room_name,room_id")
      .eq("organization_slug", "slnt")
      .eq("hotel_id", hotelId)
      .eq("status", "applied")
      .not("room_id", "is", null);
    if (mappingError) throw mappingError;

    const mappings = (mappingRows || []) as UnitMap[];
    const byExternal = new Map<string, UnitMap>();
    const byName = new Map<string, UnitMap>();
    for (const mapping of mappings) {
      if (!mapping.pms_account_id) continue;
      if (mapping.external_room_id) byExternal.set(`${mapping.pms_account_id}:${mapping.external_room_id}`, mapping);
      for (const name of [mapping.source_name, mapping.normalized_name, mapping.canonical_room_name]) {
        const normalized = normalizeName(name);
        if (normalized) byName.set(`${mapping.pms_account_id}:${normalized}`, mapping);
      }
    }

    const reservations: ParsedReservation[] = [];
    const accountStats: Array<{ id: string; label: string; reservations: number }> = [];

    for (const account of accounts) {
      const creds = loadPrevioCredentials(account.credentials_secret_name);
      const xmlResult = await callPrevioXml({
        method: "searchReservations",
        creds,
        pmsHotelId: String(account.pms_hotel_id || ""),
        extraXml: `<term><from>${addDays(fromDate, -1)}</from><to>${toDate}</to></term>`,
      });
      if (!xmlResult.ok) {
        return new Response(JSON.stringify({
          ok: false,
          error: `Previo sync failed for ${account.label || account.pms_hotel_id}: ${xmlResult.errorMessage || xmlResult.text.slice(0, 180)}`,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let accountReservationCount = 0;
      const blocks = xmlResult.text.match(/<reservation>[\s\S]*?<\/reservation>/g) || [];
      for (const block of blocks) {
        const arrivalDate = grab(block, "from").slice(0, 10);
        const departureDate = grab(block, "to").slice(0, 10);
        if (!arrivalDate || !departureDate) continue;
        const statusId = Number.parseInt(grab(block, "statusId") || "0", 10);
        if (statusId === 7 || statusId === 8) continue;

        const objectMatch = block.match(/<object>[\s\S]*?<objId>(\d+)<\/objId>[\s\S]*?<name>([^<]*)<\/name>[\s\S]*?<\/object>/);
        const objectId = objectMatch?.[1]?.trim() || "";
        const roomName = objectMatch?.[2]?.trim() || "";
        if (!objectId || !roomName) continue;

        const guestBlocks = block.match(/<guest>[\s\S]*?<\/guest>/g) || [];
        const names = guestBlocks.map((guest) => {
          const first = (guest.match(/<firstName>([^<]*)<\/firstName>/) || [])[1] || "";
          const last = (guest.match(/<surname>([^<]*)<\/surname>/) || [])[1] || "";
          return [first.trim(), last.trim()].filter(Boolean).join(" ");
        }).filter(Boolean);

        reservations.push({
          accountId: account.id,
          accountLabel: account.label || account.pms_hotel_id,
          objectId,
          roomName,
          arrivalDate,
          departureDate,
          statusId,
          guestNames: names.join(", "),
          pax: guestBlocks.length || 1,
        });
        accountReservationCount += 1;
      }
      accountStats.push({ id: account.id, label: account.label || account.pms_hotel_id, reservations: accountReservationCount });
    }

    const capturedAt = new Date().toISOString();
    const rowsByKey = new Map<string, any>();
    const unmappedObjects = new Map<string, string>();
    let mappedReservations = 0;

    for (const reservation of reservations) {
      const mapping = byExternal.get(`${reservation.accountId}:${reservation.objectId}`)
        || byName.get(`${reservation.accountId}:${normalizeName(reservation.roomName)}`);
      if (!mapping?.canonical_room_name) {
        unmappedObjects.set(`${reservation.accountId}:${reservation.objectId}`, reservation.roomName);
        continue;
      }
      mappedReservations += 1;

      let night = reservation.arrivalDate;
      while (night < reservation.departureDate) {
        const businessDate = addDays(night, 1);
        night = addDays(night, 1);
        if (businessDate < fromDate || businessDate >= toDate) continue;

        const row = {
          hotel_id: hotelId,
          organization_slug: "slnt",
          business_date: businessDate,
          room_label: reservation.roomName,
          room_number: mapping.canonical_room_name,
          room_type_code: null,
          room_suffix: null,
          arrival_date: reservation.arrivalDate,
          departure_date: reservation.departureDate,
          status: businessDate === reservation.departureDate ? "departing" : "ongoing",
          guest_names: reservation.guestNames || null,
          pax: reservation.pax,
          breakfast: 0,
          lunch: 0,
          dinner: 0,
          all_inclusive: 0,
          housekeeping_stay: null,
          housekeeping_dep: businessDate === reservation.departureDate ? "DEP" : null,
          source: "previo",
          source_filename: null,
          uploaded_by: null,
          captured_at: capturedAt,
        };
        rowsByKey.set(`${businessDate}|${mapping.room_id || mapping.canonical_room_name}`, row);
      }
    }

    const rows = Array.from(rowsByKey.values());

    const { error: deleteError } = await service
      .from("daily_overview_snapshots")
      .delete()
      .eq("organization_slug", "slnt")
      .eq("hotel_id", hotelId)
      .eq("source", "previo")
      .gte("business_date", fromDate)
      .lt("business_date", toDate);
    if (deleteError) throw deleteError;

    for (let index = 0; index < rows.length; index += 200) {
      const { error: insertError } = await service
        .from("daily_overview_snapshots")
        .insert(rows.slice(index, index + 200));
      if (insertError) throw insertError;
    }

    return new Response(JSON.stringify({
      ok: true,
      supported: true,
      portfolio: true,
      hotelId,
      window: { from: fromDate, to: toDate },
      accounts: accountStats,
      configuredUnitMappings: mappings.length,
      reservations: reservations.length,
      mappedReservations,
      rowsInserted: rows.length,
      unmappedObjects: Array.from(unmappedObjects.values()).slice(0, 20),
      capturedAt,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("slnt-sync-daily-overview fatal:", error);
    return new Response(JSON.stringify({ ok: false, error: error?.message || String(error) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
