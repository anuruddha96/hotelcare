import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { parseRoomCode } from "../_shared/roomCode.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HOTEL_NAME_TO_ID: Record<string, string> = {
  "hotel mika downtown": "mika-downtown",
  "mika downtown": "mika-downtown",
  "mika": "mika-downtown",
  "hotel memories budapest": "memories-budapest",
  "memories budapest": "memories-budapest",
  "memories": "memories-budapest",
  "hotel ottofiori": "ottofiori",
  "ottofiori": "ottofiori",
  "otto fiori": "ottofiori",
  "gozsdu court budapest": "gozsdu-court",
  "gozsdu court": "gozsdu-court",
  "gozsdu": "gozsdu-court",
  "hotelcare.app testing environment": "hotelcare-testing",
  "hotelcare testing": "hotelcare-testing",
};

function safeInt(v: any): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseInt(String(v).replace(/[^\d\-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function paxFrom(s: any): number {
  if (!s) return 0;
  const m = String(s).match(/\((\d+)\)/);
  return m ? parseInt(m[1], 10) : 0;
}

function parseSheetDate(name: string, baseYear: number): string | null {
  // Sheet names like "2026-05-06"
  const m = name.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return null;
}

function parseDateLoose(raw: any, baseYear: number): string | null {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date && !isNaN(raw.getTime())) return raw.toISOString().slice(0, 10);
  const s = String(raw).trim();
  // "5. 5." or "5. 5. 2026"
  let m = s.match(/^(\d{1,2})\.\s*(\d{1,2})\.?\s*(\d{4})?\.?$/);
  if (m) {
    const day = +m[1], mon = +m[2] - 1, yr = m[3] ? +m[3] : baseYear;
    if (mon < 0 || mon > 11) return null;
    return new Date(Date.UTC(yr, mon, day)).toISOString().slice(0, 10);
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  // "6 May 2026"
  const months: Record<string, number> = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?\s*(\d{4})?$/);
  if (m) {
    const mon = months[m[2].toLowerCase().slice(0,3)];
    if (mon === undefined) return null;
    return new Date(Date.UTC(m[3]?+m[3]:baseYear, mon, +m[1])).toISOString().slice(0,10);
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const errResp = (error: string, status = 200) =>
    new Response(JSON.stringify({ ok: false, error }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errResp("Missing auth", 401);
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: userRes } = await userClient.auth.getUser(token);
    if (!userRes?.user) return errResp("Unauthorized", 401);
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: profile } = await supabase
      .from("profiles").select("role, organization_slug")
      .eq("id", userRes.user.id).single();
    if (!profile || !["admin", "top_management"].includes(profile.role)) return errResp("Forbidden", 403);

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const hotelOverride = (formData.get("hotel_id") as string | null)?.trim() || "";
    if (!file) return errResp("No file uploaded");
    if (!hotelOverride) return errResp("Hotel is required");

    const buf = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const baseYear = new Date().getUTCFullYear();

    // Hotel name verification: scan filename + sheet names + first cells.
    let detectedHotelId = "";
    const fileHay = (file.name || "").toLowerCase();
    const haystack = [fileHay, wb.SheetNames.join(" ").toLowerCase()];
    for (const s of wb.SheetNames) {
      const ws = wb.Sheets[s];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null, raw: false });
      for (let i = 0; i < Math.min(rows.length, 6); i++) {
        haystack.push((rows[i] || []).map((c) => String(c ?? "").toLowerCase()).join(" "));
      }
    }
    const hay = haystack.join(" | ");
    for (const [name, id] of Object.entries(HOTEL_NAME_TO_ID)) {
      if (hay.includes(name)) { detectedHotelId = id; break; }
    }
    if (detectedHotelId && detectedHotelId !== hotelOverride) {
      const { data: hotels } = await supabase.from("hotel_configurations")
        .select("hotel_id, hotel_name").in("hotel_id", [hotelOverride, detectedHotelId]);
      const nameOf = (id: string) => hotels?.find((h) => h.hotel_id === id)?.hotel_name ?? id;
      return errResp(`Hotel mismatch: this file is for "${nameOf(detectedHotelId)}", but you selected "${nameOf(hotelOverride)}". No data was saved.`);
    }

    // Find the per-room sheet (the one with "Date (arrival)" header).
    let roomSheetName = "";
    let roomRows: any[][] = [];
    let businessDate: string | null = null;
    for (const s of wb.SheetNames) {
      const ws = wb.Sheets[s];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null, raw: false });
      const hdr = (rows[1] || []).map((c) => String(c ?? "").toLowerCase());
      if (hdr.some((c) => c.includes("date (arrival)") || c.includes("arrival"))
          && hdr.some((c) => c.includes("room"))) {
        roomSheetName = s;
        roomRows = rows;
        businessDate = parseSheetDate(s, baseYear);
        break;
      }
    }
    if (!roomRows.length) return errResp("Could not find the per-room sheet (expected headers like 'Date (arrival)', 'Room', 'Arrival', 'Departure', 'Ongoing').");

    const hdr = (roomRows[1] || []).map((c) => String(c ?? "").trim().toLowerCase());
    const includesAny = (needles: string[]) => (i: number) =>
      needles.some((n) => hdr[i].includes(n));
    const exactAny = (needles: string[]) => (i: number) =>
      needles.some((n) => hdr[i] === n);
    const findCol = (pred: (i: number) => boolean) => {
      for (let i = 0; i < hdr.length; i++) if (pred(i)) return i;
      return -1;
    };

    // Date columns first (exact match against "date (arrival)" / "date (departure)")
    const cArrDate = findCol(includesAny(["date (arrival)"]));
    const cDepDate = findCol(includesAny(["date (departure)"]));
    const cRoom = findCol(includesAny(["room"]));
    // Guest-in columns: must be EXACT (not "date (arrival)")
    const cDeparture = findCol(exactAny(["departure"]));
    const cArrival = findCol(exactAny(["arrival"]));
    const cOngoing = findCol(exactAny(["ongoing"]));
    const cBre = findCol(includesAny(["bre"]));
    const cLun = findCol(includesAny(["lun"]));
    const cDin = findCol(includesAny(["din"]));
    const cAll = findCol(includesAny(["all"]));
    const cSta = findCol(includesAny(["sta"]));
    const cDep2 = (() => {
      for (let i = hdr.length - 1; i >= 0; i--) {
        if (hdr[i] === "dep") return i;
      }
      return -1;
    })();

    const inserts: any[] = [];
    for (let i = 2; i < roomRows.length; i++) {
      const row = roomRows[i] || [];
      const room = row[cRoom];
      if (!room) continue;
      const parsed = parseRoomCode(room, hotelOverride);
      if (!parsed) continue; // skip filler rows like "Departures", "15", "82"
      const departureCell = cDeparture >= 0 ? row[cDeparture] : null;
      const arrivalCell = cArrival >= 0 ? row[cArrival] : null;
      const ongoingCell = cOngoing >= 0 ? row[cOngoing] : null;
      const status = arrivalCell && !departureCell ? "arriving"
        : departureCell && !arrivalCell ? "departing"
        : departureCell && arrivalCell ? "turnover"
        : "ongoing";
      const guestCell = ongoingCell || arrivalCell || departureCell || "";
      inserts.push({
        hotel_id: hotelOverride,
        organization_slug: profile.organization_slug,
        business_date: businessDate,
        room_label: String(room).trim(),
        room_number: parsed.room_number,
        room_type_code: parsed.room_type_code,
        room_suffix: parsed.room_suffix,
        arrival_date: cArrDate >= 0 ? parseDateLoose(row[cArrDate], baseYear) : null,
        departure_date: cDepDate >= 0 ? parseDateLoose(row[cDepDate], baseYear) : null,
        status,
        guest_names: String(guestCell).trim() || null,
        pax: paxFrom(guestCell),
        breakfast: cBre >= 0 ? safeInt(row[cBre]) : 0,
        lunch: cLun >= 0 ? safeInt(row[cLun]) : 0,
        dinner: cDin >= 0 ? safeInt(row[cDin]) : 0,
        all_inclusive: cAll >= 0 ? safeInt(row[cAll]) : 0,
        housekeeping_stay: cSta >= 0 && row[cSta] ? String(row[cSta]) : null,
        housekeeping_dep: cDep2 >= 0 && row[cDep2] ? String(row[cDep2]) : null,
        source_filename: file.name,
        uploaded_by: userRes.user.id,
      });
    }

    // Meals summary sheet
    const mealsInserts: any[] = [];
    for (const s of wb.SheetNames) {
      if (!/meal/i.test(s)) continue;
      const ws = wb.Sheets[s];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null, raw: false });
      // Header row at index 1: [None, Breakfast, Lunch, Dinner, All-Inclusive]; data starts at 2
      let adults = 0, children = 0;
      let totalRow: any[] | null = null;
      let dayRow: any[] | null = null;
      for (const r of rows) {
        const a = String(r?.[0] ?? "").toLowerCase();
        if (a === "total") totalRow = r;
        else if (a === "felnőtt" || a === "adults") adults = safeInt(r[1]);
        else if (a === "gyerek" || a === "children") children = safeInt(r[1]);
        else if (!dayRow && a && parseDateLoose(a, baseYear)) dayRow = r;
      }
      const useRow = totalRow || dayRow;
      if (useRow) {
        const dateForMeals = (dayRow ? parseDateLoose(dayRow[0], baseYear) : null) || businessDate;
        if (dateForMeals) {
          mealsInserts.push({
            hotel_id: hotelOverride,
            organization_slug: profile.organization_slug,
            business_date: dateForMeals,
            breakfast: safeInt(useRow[1]),
            lunch: safeInt(useRow[2]),
            dinner: safeInt(useRow[3]),
            all_inclusive: safeInt(useRow[4]),
            adults, children,
            source_filename: file.name,
            uploaded_by: userRes.user.id,
          });
        }
      }
      break;
    }

    if (!inserts.length) return errResp("No room rows found in the daily overview sheet.");

    const { error: e1 } = await supabase.from("daily_overview_snapshots").insert(inserts);
    if (e1) return errResp(`DB insert failed: ${e1.message}`);
    if (mealsInserts.length) {
      await supabase.from("daily_overview_meal_totals").insert(mealsInserts);
    }

    return new Response(JSON.stringify({
      ok: true, success: true, hotel_id: hotelOverride,
      rows: inserts.length, meals_rows: mealsInserts.length,
      business_date: businessDate,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error(e);
    return errResp(e?.message ?? String(e));
  }
});
