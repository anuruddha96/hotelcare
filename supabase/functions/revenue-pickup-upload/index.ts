import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Map "Pickup for Hotel X" header text → hotel_id
const HOTEL_NAME_TO_ID: Record<string, string> = {
  "hotel mika downtown": "mika-downtown",
  "hotel memories budapest": "memories-budapest",
  "hotel ottofiori": "ottofiori",
  "gozsdu court budapest": "gozsdu-court",
};

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseDateHeader(s: string, baseYear: number): string | null {
  // e.g. "30. Apr"
  const m = s.match(/(\d+)\.\s*([A-Za-z]+)/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const mon = MONTHS[m[2].toLowerCase().slice(0, 3)];
  if (mon === undefined) return null;
  const d = new Date(Date.UTC(baseYear, mon, day));
  return d.toISOString().slice(0, 10);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes?.user) throw new Error("Unauthorized");

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, organization_slug")
      .eq("id", userRes.user.id)
      .single();
    if (!profile || !["admin", "top_management"].includes(profile.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const hotelOverride = formData.get("hotel_id") as string | null;
    if (!file) throw new Error("No file uploaded");

    const buf = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      blankrows: false,
      defval: null,
    });

    // Row 0: title; Row 2: dates; Row 3: year/year/Change; Row 4+: numbers
    const titleCell = String(rows[0]?.[0] ?? "").toLowerCase();
    let hotelId = hotelOverride || "";
    if (!hotelId) {
      for (const [name, id] of Object.entries(HOTEL_NAME_TO_ID)) {
        if (titleCell.includes(name)) { hotelId = id; break; }
      }
    }
    if (!hotelId) throw new Error("Could not detect hotel from file. Provide hotel_id.");

    const dateRow = rows[2] ?? [];
    const yearRow = rows[3] ?? [];
    const valueRow = rows[4] ?? [];
    const baseYear = new Date().getUTCFullYear();

    // Date headers appear every 3 columns starting at 0; year row is 'YYYY','YYYY','Change'
    const inserts: any[] = [];
    for (let i = 0; i < dateRow.length; i += 3) {
      const dh = dateRow[i];
      if (!dh) continue;
      const dateStr = parseDateHeader(String(dh), baseYear);
      if (!dateStr) continue;
      const cur = Number(valueRow[i] ?? 0) || 0;
      const last = Number(valueRow[i + 1] ?? 0) || 0;
      const delta = Number(valueRow[i + 2] ?? cur - last) || 0;
      inserts.push({
        hotel_id: hotelId,
        organization_slug: profile.organization_slug,
        stay_date: dateStr,
        bookings_current: cur,
        bookings_last_year: last,
        delta,
        uploaded_by: userRes.user.id,
        source: "xlsx_upload",
      });
    }

    if (inserts.length === 0) throw new Error("No date columns parsed");

    const { error: insErr } = await supabase
      .from("pickup_snapshots")
      .insert(inserts);
    if (insErr) throw insErr;

    // Trigger engine immediately
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/revenue-engine-tick`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ hotel_id: hotelId, trigger: "upload" }),
    }).catch(() => {});

    return new Response(
      JSON.stringify({ success: true, hotel_id: hotelId, rows: inserts.length }),
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
