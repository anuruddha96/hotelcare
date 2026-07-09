import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const HOTEL_NAME_TO_ID: Record<string, string> = {
  "hotel mika downtown": "mika-downtown",
  "mika downtown": "mika-downtown",
  "hotel memories budapest": "memories-budapest",
  "memories budapest": "memories-budapest",
  "hotel ottofiori": "ottofiori",
  "otto fiori": "ottofiori",
  "gozsdu court budapest": "gozsdu-court",
  "gozsdu court": "gozsdu-court",
};

type HotelSource = "filename" | "sheet" | "cell";
function detectHotelId(filename: string, sheetNames: string[], cellHay: string): { id: string; source: HotelSource | null } {
  const sources: Array<{ hay: string; source: HotelSource; weight: number }> = [
    { hay: filename.toLowerCase(), source: "filename", weight: 3 },
    { hay: sheetNames.join(" | ").toLowerCase(), source: "sheet", weight: 2 },
    { hay: cellHay.toLowerCase(), source: "cell", weight: 1 },
  ];
  const hits: Array<{ id: string; source: HotelSource; score: number }> = [];
  for (const { hay, source, weight } of sources) {
    if (!hay) continue;
    for (const [name, id] of Object.entries(HOTEL_NAME_TO_ID)) {
      if (hay.includes(name)) hits.push({ id, source, score: name.length * weight });
    }
  }
  if (!hits.length) return { id: "", source: null };
  hits.sort((a, b) => b.score - a.score);
  return { id: hits[0].id, source: hits[0].source };
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function tryParseDate(raw: any, baseYear: number): string | null {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date && !isNaN(raw.getTime())) return raw.toISOString().slice(0, 10);
  if (typeof raw === "number" && raw > 30000 && raw < 80000) {
    const d = XLSX.SSF.parse_date_code(raw);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/^(mon|tue|wed|thu|fri|sat|sun|hét|ked|sze|csü|pén|szo|vas)[a-záéíóöőúüű]*\.?\s*[, ]\s*/i, "");

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{4})[\.\/](\d{1,2})[\.\/](\d{1,2})\.?$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?$/);
  if (m) {
    const mon = MONTHS[m[1].toLowerCase().slice(0, 3)];
    if (mon === undefined) return null;
    const day = parseInt(m[2], 10);
    const yr = m[3] ? parseInt(m[3], 10) : baseYear;
    return new Date(Date.UTC(yr, mon, day)).toISOString().slice(0, 10);
  }
  m = s.match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})\.?$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const mon = parseInt(m[2], 10) - 1;
    const yr = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
    return new Date(Date.UTC(yr, mon, day)).toISOString().slice(0, 10);
  }
  return null;
}

function safeNum(v: any): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^\d\-\.,]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
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

    const buf = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const baseYear = new Date().getUTCFullYear();
    let detectedHotelId = "";
    let detectedSource: "filename" | "sheet" | "cell" | null = null;
    const fileHay = file.name || "";
    const cellHayParts: string[] = [];
    const parsed: { stay_date: string; occupancy_pct: number; rooms_sold: number }[] = [];

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null, raw: false });
      for (let i = 0; i < Math.min(rows.length, 8); i++) {
        cellHayParts.push((rows[i] || []).map((c) => String(c ?? "")).join(" "));
      }
      // Find header row containing "term" or "date"; pick "%" col and "pcs"/"db" col
      let headerIdx = -1, dateCol = -1, pctCol = -1, pcsCol = -1;
      for (let i = 0; i < Math.min(rows.length, 20); i++) {
        const r = (rows[i] || []).map((c: any) => String(c ?? "").toLowerCase());
        const dc = r.findIndex((c) => /^(term|id[őo]szak|date|d[áa]tum|day|nap)$/i.test(c.trim()));
        if (dc >= 0) {
          headerIdx = i; dateCol = dc;
          pctCol = r.findIndex((c) => /\(%\)|percent/.test(c));
          pcsCol = r.findIndex((c) => /\(pcs\)|\(db\)|rooms?.?sold|szoba/i.test(c));
          break;
        }
      }
      if (headerIdx === -1) continue;
      for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i] || [];
        const date = tryParseDate(row[dateCol], baseYear);
        if (!date) continue;
        const pct = pctCol >= 0 ? safeNum(row[pctCol]) : 0;
        const pcs = pcsCol >= 0 ? Math.round(safeNum(row[pcsCol])) : 0;
        if (pct === 0 && pcs === 0) continue;
        parsed.push({ stay_date: date, occupancy_pct: Math.round(pct * 100) / 100, rooms_sold: pcs });
      }
      if (parsed.length) break;
    }

    ({ id: detectedHotelId, source: detectedSource } = detectHotelId(
      fileHay, wb.SheetNames, cellHayParts.join(" | ")
    ));

    if (
      hotelOverride &&
      detectedHotelId &&
      detectedHotelId !== hotelOverride &&
      (detectedSource === "filename" || detectedSource === "sheet")
    ) {
      const { data: hotels } = await supabase.from("hotel_configurations")
        .select("hotel_id, hotel_name").in("hotel_id", [hotelOverride, detectedHotelId]);
      const nameOf = (id: string) => hotels?.find((h) => h.hotel_id === id)?.hotel_name ?? id;
      return errResp(`Hotel mismatch: this file is for "${nameOf(detectedHotelId)}", but you selected "${nameOf(hotelOverride)}". No data was saved.`);
    }
    if (!detectedHotelId) detectedHotelId = hotelOverride;

    if (!detectedHotelId) return errResp("Could not detect hotel. Pick the hotel in the dropdown.");
    if (!parsed.length) return errResp("Could not find occupancy rows. Make sure the file has a 'Term' column with dates and (%) or (pcs) values.");

    const inserts = parsed.map((p) => ({
      hotel_id: detectedHotelId,
      organization_slug: profile.organization_slug,
      stay_date: p.stay_date,
      occupancy_pct: p.occupancy_pct,
      rooms_sold: p.rooms_sold,
      uploaded_by: userRes.user.id,
      source: "xlsx_upload",
      snapshot_label: file.name,
    }));
    const { error } = await supabase.from("occupancy_snapshots").insert(inserts);
    if (error) return errResp(`DB insert failed: ${error.message}`);

    return new Response(JSON.stringify({ ok: true, success: true, hotel_id: detectedHotelId, rows: inserts.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error(e);
    return errResp(e?.message ?? String(e));
  }
});
