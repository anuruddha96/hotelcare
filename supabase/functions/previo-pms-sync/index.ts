// One-click PMS sync for Previo test hotel.
// Pulls /rest/rooms (incl. today's reservation per room) and returns rows
// shaped exactly like the Excel PMS export so the frontend can feed them
// into the same processing pipeline used for manual file uploads.
//
// HARD GUARD: only operates for hotel_id = 'previo-test'. Returns an error
// for any other hotel so OttoFiori and others are never touched.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { fetchPrevioWithAuth } from "../_shared/previoAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_HOTEL_ID = "previo-test";

interface PrevioRoom {
  roomId: number;
  name: string;
  roomKindName: string;
  roomTypeId: number;
  roomCleanStatusId: number;
  capacity: number;
  extraCapacity: number;
  reservation?: {
    reservationId: number;
    arrivalDate: string;   // YYYY-MM-DD
    departureDate: string; // YYYY-MM-DD
    status: string;
    guestsCount?: number;
    note?: string;
  };
}

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function diffDays(from: string, to: string): number {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth: require Bearer token
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const anon = createClient(SUPABASE_URL, ANON);
    const { data: userRes } = await anon.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!userRes?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const service = createClient(SUPABASE_URL, SERVICE);

    const { hotelId } = await req.json().catch(() => ({}));
    const targetHotel = hotelId || ALLOWED_HOTEL_ID;

    // SAFETY: hard-gate to previo-test
    if (targetHotel !== ALLOWED_HOTEL_ID) {
      return new Response(
        JSON.stringify({
          error: `previo-pms-sync is restricted to hotel '${ALLOWED_HOTEL_ID}'. Got '${targetHotel}'.`,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Authorization: must be admin/manager assigned to the hotel (or admin/top_management)
    const { data: profile } = await service
      .from("profiles")
      .select("role, assigned_hotel")
      .eq("id", userRes.user.id)
      .maybeSingle();
    const isAdmin = profile?.role === "admin" || profile?.role === "top_management";
    if (!isAdmin && profile?.assigned_hotel !== targetHotel) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load PMS config
    const { data: cfg } = await service
      .from("pms_configurations")
      .select("id, hotel_id, pms_hotel_id, credentials_secret_name")
      .eq("hotel_id", targetHotel)
      .eq("pms_type", "previo")
      .maybeSingle();
    if (!cfg) {
      return new Response(
        JSON.stringify({ error: `No Previo config for ${targetHotel}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { response: resp } = await fetchPrevioWithAuth({
      credentialsSecretName: cfg.credentials_secret_name,
      path: "/rest/rooms",
      pmsHotelId: String(cfg.pms_hotel_id || ""),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      console.error(`Previo /rest/rooms ${resp.status}:`, txt.slice(0, 500));
      return new Response(
        JSON.stringify({ error: `Previo ${resp.status}: ${txt.slice(0, 300)}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const rooms: PrevioRoom[] = await resp.json();
    const today = todayUtcDate();

    // Build Excel-compatible rows. Header names match those that PMSUpload's
    // fuzzy column matcher recognizes (English variants).
    const rows = rooms.map((r) => {
      const res = r.reservation;
      const isOccupied = !!res && res.arrivalDate <= today && res.departureDate > today;
      const isDeparture = !!res && res.departureDate === today;
      const isArrival = !!res && res.arrivalDate === today;
      const totalNights = res ? diffDays(res.arrivalDate, res.departureDate) : 0;
      const currentNight = res
        ? Math.min(totalNights, Math.max(1, diffDays(res.arrivalDate, today) + (isDeparture ? 0 : 1)))
        : 0;

      // roomCleanStatusId: 1 = clean, 2 = dirty/untidy in Previo (best-effort mapping)
      const statusLabel = r.roomCleanStatusId === 1 ? "Clean" : "Untidy";

      return {
        Room: r.name,
        Occupied: isOccupied || isDeparture ? "Yes" : "No",
        // Excel uses time strings; we don't have actual times from /rest/rooms,
        // so use sentinel "12:00" if the date matches today. The pipeline only
        // cares whether departure is non-empty, not the exact time.
        Departure: isDeparture ? "12:00" : null,
        Arrival: isArrival ? "15:00" : null,
        People: res?.guestsCount ?? (isOccupied || isDeparture ? r.capacity : 0),
        "Night / Total": totalNights > 0 ? `${currentNight}/${totalNights}` : null,
        Note: res?.note ?? null,
        Nationality: null,
        Defect: null,
        Status: statusLabel,
      };
    });

    return new Response(
      JSON.stringify({ ok: true, hotel_id: targetHotel, rowCount: rows.length, rows }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("previo-pms-sync error:", e);
    return new Response(
      JSON.stringify({ ok: false, error: e?.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
