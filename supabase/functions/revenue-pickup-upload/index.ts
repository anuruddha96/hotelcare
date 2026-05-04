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

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  // Hungarian
  jan2: 0, ["jan."]: 0, ["febr"]: 1, ["márc"]: 2, ["ápr"]: 3, ["máj"]: 4,
  ["jún"]: 5, ["júl"]: 6, ["aug."]: 7, ["szep"]: 8, ["okt"]: 9, ["nov."]: 10, ["dec."]: 11,
};

function tryParseDate(raw: any, baseYear: number): string | null {
  if (raw == null || raw === "") return null;
  // JS Date instance (when cellDates: true)
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  // Excel serial date
  if (typeof raw === "number" && raw > 30000 && raw < 80000) {
    const d = XLSX.SSF.parse_date_code(raw);
    if (d) {
      return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
    }
  }
  const s = String(raw).trim();
  if (!s) return null;

  // ISO YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;

  // YYYY.MM.DD or YYYY.MM.DD.  (Hungarian / Previo)
  m = s.match(/^(\d{4})[\.\/](\d{1,2})[\.\/](\d{1,2})\.?$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;

  // "30. Apr" / "30. Apr 2026" / "4. 5." / "4. 5. 2026"
  m = s.match(/^(\d{1,2})\.\s*(\d{1,2})\.?\s*(\d{4})?\.?$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const mon = parseInt(m[2], 10) - 1;
    const yr = m[3] ? parseInt(m[3], 10) : baseYear;
    if (mon < 0 || mon > 11 || day < 1 || day > 31) return null;
    const d = new Date(Date.UTC(yr, mon, day));
    if (!m[3]) {
      const today = new Date();
      if ((today.getTime() - d.getTime()) > 180 * 86400000) d.setUTCFullYear(yr + 1);
    }
    return d.toISOString().slice(0, 10);
  }

  // "30. Apr" / "30. Apr 2026" (with month name)
  m = s.match(/^(\d{1,2})\.?\s*([A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű]{3,})\.?\s*(\d{4})?$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const mon = MONTHS[m[2].toLowerCase().slice(0, 3)] ?? MONTHS[m[2].toLowerCase()];
    if (mon === undefined) return null;
    const yr = m[3] ? parseInt(m[3], 10) : baseYear;
    const d = new Date(Date.UTC(yr, mon, day));
    if (!isFinite(d.getTime())) return null;
    if (!m[3]) {
      const today = new Date();
      if ((today.getTime() - d.getTime()) > 180 * 86400000) d.setUTCFullYear(yr + 1);
    }
    return d.toISOString().slice(0, 10);
  }

  // "Apr 30" / "Apr 30, 2026"
  m = s.match(/^([A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű]{3,})\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?$/);
  if (m) {
    const mon = MONTHS[m[1].toLowerCase().slice(0, 3)] ?? MONTHS[m[1].toLowerCase()];
    if (mon === undefined) return null;
    const day = parseInt(m[2], 10);
    const yr = m[3] ? parseInt(m[3], 10) : baseYear;
    return new Date(Date.UTC(yr, mon, day)).toISOString().slice(0, 10);
  }

  // dd/mm/yyyy or dd-mm-yyyy or dd.mm.yyyy
  m = s.match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})\.?$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const mon = parseInt(m[2], 10) - 1;
    const yr = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
    if (mon < 0 || mon > 11 || day < 1 || day > 31) return null;
    return new Date(Date.UTC(yr, mon, day)).toISOString().slice(0, 10);
  }

  return null;
}

function safeNum(v: any): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^\d\-\.,]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

interface ParsedRow {
  stay_date: string;
  bookings_current: number;
  bookings_last_year: number;
  delta: number;
}

// ---- Wide parser (dates are columns) ----
function parseWide(rows: any[][], baseYear: number): { parsed: ParsedRow[]; warnings: string[] } {
  const warnings: string[] = [];
  let dateRowIdx = -1;
  let dateCount = 0;
  let dateColumns: { col: number; date: string }[] = [];

  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const row = rows[i] || [];
    const found: { col: number; date: string }[] = [];
    for (let c = 0; c < row.length; c++) {
      const d = tryParseDate(row[c], baseYear);
      if (d) found.push({ col: c, date: d });
    }
    if (found.length > dateCount) {
      dateCount = found.length;
      dateRowIdx = i;
      dateColumns = found;
    }
  }

  if (dateRowIdx === -1 || dateColumns.length < 2) {
    warnings.push(`wide: best date row had only ${dateCount} dates`);
    return { parsed: [], warnings };
  }

  const spacings = dateColumns.slice(1).map((d, i) => d.col - dateColumns[i].col);
  const spacing = spacings.length ? Math.round(spacings.reduce((a, b) => a + b, 0) / spacings.length) : 1;

  let valueRowIdx = -1;
  for (let i = dateRowIdx + 1; i < Math.min(rows.length, dateRowIdx + 12); i++) {
    const row = rows[i] || [];
    let hits = 0;
    for (const dc of dateColumns) {
      const v = row[dc.col];
      if (v != null && v !== "" && Number.isFinite(safeNum(v)) && safeNum(v) !== 0) hits++;
    }
    if (hits >= Math.max(2, Math.floor(dateColumns.length / 3))) { valueRowIdx = i; break; }
  }
  if (valueRowIdx === -1) {
    warnings.push(`wide: no numeric values row found below date row ${dateRowIdx}`);
    return { parsed: [], warnings };
  }

  const valueRow = rows[valueRowIdx];
  const parsed: ParsedRow[] = [];
  for (const dc of dateColumns) {
    const cur = safeNum(valueRow[dc.col]);
    const ly = spacing >= 2 ? safeNum(valueRow[dc.col + 1]) : 0;
    const deltaCell = spacing >= 3 ? valueRow[dc.col + 2] : null;
    const delta = deltaCell != null && deltaCell !== "" ? safeNum(deltaCell) : (cur - ly);
    parsed.push({
      stay_date: dc.date,
      bookings_current: Math.round(cur),
      bookings_last_year: Math.round(ly),
      delta: Math.round(delta),
    });
  }
  return { parsed, warnings };
}

// ---- Long parser (one row per date) ----
function parseLong(rows: any[][], baseYear: number): { parsed: ParsedRow[]; warnings: string[] } {
  const warnings: string[] = [];
  // Find header row containing "date"/"datum"/"dátum"/"day"/"stay"
  let headerIdx = -1;
  let dateCol = -1;
  let curCol = -1;
  let lyCol = -1;
  let deltaCol = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = (rows[i] || []).map((c: any) => String(c ?? "").toLowerCase().trim());
    const dc = row.findIndex((c) => /^(date|datum|d[áa]tum|day|stay.?date|nap)$/i.test(c));
    if (dc >= 0) {
      headerIdx = i;
      dateCol = dc;
      curCol = row.findIndex((c) => /(current|now|book|foglal|reserv|today|aktu)/i.test(c));
      lyCol = row.findIndex((c) => /(last.?year|ly|tavaly|previous)/i.test(c));
      deltaCol = row.findIndex((c) => /(delta|pickup|diff|change|valt)/i.test(c));
      break;
    }
  }
  if (headerIdx === -1) {
    warnings.push("long: no header row with date column found");
    return { parsed: [], warnings };
  }

  const parsed: ParsedRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const date = tryParseDate(row[dateCol], baseYear);
    if (!date) continue;
    const cur = curCol >= 0 ? safeNum(row[curCol]) : 0;
    const ly = lyCol >= 0 ? safeNum(row[lyCol]) : 0;
    const delta = deltaCol >= 0 ? safeNum(row[deltaCol]) : (cur - ly);
    parsed.push({
      stay_date: date,
      bookings_current: Math.round(cur),
      bookings_last_year: Math.round(ly),
      delta: Math.round(delta),
    });
  }
  return { parsed, warnings };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Always 200 with {ok:false,error} for parse errors so the client can read the message
  const errResp = (error: string, debug?: any, status = 200) =>
    new Response(JSON.stringify({ ok: false, error, debug }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errResp("Missing auth", null, 401);

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: userRes, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userRes?.user) return errResp("Unauthorized", null, 401);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, organization_slug")
      .eq("id", userRes.user.id)
      .single();
    if (!profile || !["admin", "top_management"].includes(profile.role)) {
      return errResp("Forbidden", null, 403);
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const hotelOverride = (formData.get("hotel_id") as string | null)?.trim() || "";
    if (!file) return errResp("No file uploaded");

    const buf = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const baseYear = new Date().getUTCFullYear();

    let bestParsed: ParsedRow[] = [];
    let detectedHotelId = hotelOverride;
    const warnings: string[] = [];
    const debugSnippets: any[] = [];

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, {
        header: 1, blankrows: false, defval: null, raw: false,
      });
      if (rows.length === 0) continue;

      // Detect hotel from any cell in first 8 rows + sheet name
      if (!detectedHotelId) {
        const hayParts: string[] = [sheetName.toLowerCase()];
        for (let i = 0; i < Math.min(rows.length, 8); i++) {
          hayParts.push((rows[i] || []).map((c) => String(c ?? "")).join(" ").toLowerCase());
        }
        const hay = hayParts.join(" | ");
        for (const [name, id] of Object.entries(HOTEL_NAME_TO_ID)) {
          if (hay.includes(name)) { detectedHotelId = id; break; }
        }
      }

      // Try wide first, then long
      const wide = parseWide(rows, baseYear);
      let chosen = wide;
      if (wide.parsed.length === 0) {
        const long = parseLong(rows, baseYear);
        if (long.parsed.length > 0) chosen = long;
        warnings.push(...long.warnings.map((x) => `[${sheetName}] ${x}`));
      }
      warnings.push(...wide.warnings.map((x) => `[${sheetName}] ${x}`));

      if (chosen.parsed.length > bestParsed.length) bestParsed = chosen.parsed;
      debugSnippets.push({ sheet: sheetName, sample: rows.slice(0, 8) });
    }

    if (!detectedHotelId) {
      console.warn("Could not detect hotel. Preview:", JSON.stringify(debugSnippets[0]));
      return errResp(
        "Could not detect hotel from file. Please choose the hotel in the dropdown and re-upload.",
        { warnings, snippets: debugSnippets }
      );
    }
    if (bestParsed.length === 0) {
      console.warn("No dates parsed. Preview:", JSON.stringify(debugSnippets[0]));
      return errResp(
        "Could not find date columns. Make sure the file contains stay dates as a row of columns or a 'Date' column.",
        { warnings, snippets: debugSnippets }
      );
    }

    const inserts = bestParsed.map((p) => ({
      hotel_id: detectedHotelId,
      organization_slug: profile.organization_slug,
      stay_date: p.stay_date,
      bookings_current: p.bookings_current,
      bookings_last_year: p.bookings_last_year,
      delta: p.delta,
      uploaded_by: userRes.user.id,
      source: "xlsx_upload",
      snapshot_label: file.name,
    }));

    const { error: insErr } = await supabase.from("pickup_snapshots").insert(inserts);
    if (insErr) return errResp(`DB insert failed: ${insErr.message}`);

    fetch(`${SUPABASE_URL}/functions/v1/revenue-engine-tick`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ hotel_id: detectedHotelId, trigger: "upload" }),
    }).catch(() => {});

    return new Response(
      JSON.stringify({
        ok: true,
        success: true,
        hotel_id: detectedHotelId,
        rows: inserts.length,
        snapshot_label: file.name,
        warnings,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("revenue-pickup-upload error:", e);
    return errResp(e?.message ?? String(e), null);
  }
});
