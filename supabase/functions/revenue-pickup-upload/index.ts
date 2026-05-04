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
  "ottofiori": "ottofiori",
  "gozsdu court budapest": "gozsdu-court",
  "gozsdu court": "gozsdu-court",
  "gozsdu": "gozsdu-court",
};

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function tryParseDate(raw: any, baseYear: number): string | null {
  if (raw == null) return null;
  // Excel serial date
  if (typeof raw === "number" && raw > 30000 && raw < 80000) {
    const d = XLSX.SSF.parse_date_code(raw);
    if (d) {
      return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
    }
  }
  const s = String(raw).trim();
  // ISO
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // "30. Apr" or "30. Apr 2026"
  m = s.match(/^(\d{1,2})\.?\s*([A-Za-z]{3,})\.?\s*(\d{4})?$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const mon = MONTHS[m[2].toLowerCase().slice(0, 3)];
    if (mon === undefined) return null;
    const yr = m[3] ? parseInt(m[3], 10) : baseYear;
    const d = new Date(Date.UTC(yr, mon, day));
    if (!isFinite(d.getTime())) return null;
    // If date is more than 6 months in past, assume next year
    const today = new Date();
    if ((today.getTime() - d.getTime()) > 180 * 86400000) {
      d.setUTCFullYear(yr + 1);
    }
    return d.toISOString().slice(0, 10);
  }
  // "Apr 30" or "Apr 30, 2026"
  m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?$/);
  if (m) {
    const mon = MONTHS[m[1].toLowerCase().slice(0, 3)];
    if (mon === undefined) return null;
    const day = parseInt(m[2], 10);
    const yr = m[3] ? parseInt(m[3], 10) : baseYear;
    return new Date(Date.UTC(yr, mon, day)).toISOString().slice(0, 10);
  }
  // dd/mm or dd/mm/yyyy
  m = s.match(/^(\d{1,2})[\/\.\-](\d{1,2})(?:[\/\.\-](\d{2,4}))?$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const mon = parseInt(m[2], 10) - 1;
    const yr = m[3] ? (m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10)) : baseYear;
    if (mon < 0 || mon > 11 || day < 1 || day > 31) return null;
    return new Date(Date.UTC(yr, mon, day)).toISOString().slice(0, 10);
  }
  return null;
}

function safeNum(v: any): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^\d\-\.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

interface ParsedRow {
  stay_date: string;
  bookings_current: number;
  bookings_last_year: number;
  delta: number;
}

function parseSheet(rows: any[][], baseYear: number): { parsed: ParsedRow[]; warnings: string[] } {
  const warnings: string[] = [];
  // Find the row that has the most parseable dates (scan first 25 rows)
  let dateRowIdx = -1;
  let dateCount = 0;
  let dateColumns: { col: number; date: string }[] = [];

  for (let i = 0; i < Math.min(rows.length, 25); i++) {
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

  if (dateRowIdx === -1 || dateColumns.length === 0) {
    warnings.push("No date row detected");
    return { parsed: [], warnings };
  }

  // Detect grouping: find columns spacing
  const spacings = dateColumns.slice(1).map((d, i) => d.col - dateColumns[i].col);
  const spacing = spacings.length ? Math.round(spacings.reduce((a, b) => a + b, 0) / spacings.length) : 1;

  // Find the values row: scan rows AFTER dateRowIdx for the first that has numeric values in date columns
  let valueRowIdx = -1;
  for (let i = dateRowIdx + 1; i < Math.min(rows.length, dateRowIdx + 8); i++) {
    const row = rows[i] || [];
    let hits = 0;
    for (const dc of dateColumns) {
      const v = row[dc.col];
      if (v != null && v !== "" && Number.isFinite(safeNum(v))) hits++;
    }
    if (hits >= Math.max(2, Math.floor(dateColumns.length / 2))) {
      valueRowIdx = i;
      break;
    }
  }
  if (valueRowIdx === -1) {
    warnings.push(`Date row at ${dateRowIdx} but no numeric values row found below it`);
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth");

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Validate user with anon client + explicit token (service-role client doesn't resolve user from header)
    const userClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: userRes, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userRes?.user) throw new Error("Unauthorized");

    // Service-role client for DB writes (bypasses RLS — we authorize via role check below)
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, organization_slug")
      .eq("id", userRes.user.id)
      .single();
    if (!profile || !["admin", "top_management"].includes(profile.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const hotelOverride = (formData.get("hotel_id") as string | null)?.trim() || "";
    if (!file) throw new Error("No file uploaded");

    const buf = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "array", cellDates: false });
    const baseYear = new Date().getUTCFullYear();

    // Try each sheet, accumulate the best result
    let bestParsed: ParsedRow[] = [];
    let detectedHotelId = hotelOverride;
    const warnings: string[] = [];
    const debugSnippets: any[] = [];

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null });
      if (rows.length === 0) continue;

      // Detect hotel from first 5 rows (any cell)
      if (!detectedHotelId) {
        for (let i = 0; i < Math.min(rows.length, 5); i++) {
          const flat = (rows[i] || []).map((c) => String(c ?? "")).join(" ").toLowerCase();
          for (const [name, id] of Object.entries(HOTEL_NAME_TO_ID)) {
            if (flat.includes(name)) { detectedHotelId = id; break; }
          }
          if (detectedHotelId) break;
        }
      }

      const { parsed, warnings: w } = parseSheet(rows, baseYear);
      warnings.push(...w.map((x) => `[${sheetName}] ${x}`));
      if (parsed.length > bestParsed.length) {
        bestParsed = parsed;
        debugSnippets.push({ sheet: sheetName, sample_rows: rows.slice(0, 5) });
      }
    }

    if (!detectedHotelId) {
      console.warn("Could not detect hotel from file. First sheet preview:", debugSnippets[0]);
      return new Response(JSON.stringify({
        error: "Could not detect hotel from file. Please choose the hotel manually in the dropdown and re-upload.",
        warnings, debug: debugSnippets,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (bestParsed.length === 0) {
      console.warn("No date columns parsed. First sheet preview:", debugSnippets[0]);
      return new Response(JSON.stringify({
        error: "Could not find date columns in this file. The format may be unsupported.",
        warnings, debug: debugSnippets,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
    if (insErr) throw insErr;

    // Trigger engine
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/revenue-engine-tick`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ hotel_id: detectedHotelId, trigger: "upload" }),
    }).catch(() => {});

    return new Response(
      JSON.stringify({
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
    return new Response(JSON.stringify({ error: e.message ?? String(e) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
