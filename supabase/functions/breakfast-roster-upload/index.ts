import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function extractGuests(text: string | null): string[] {
  if (!text) return [];
  const cleaned = text.replace(/\(departure[^)]*\)/gi, "")
    .replace(/\(arrival[^)]*\)/gi, "")
    .replace(/^\s*\(\d+\)\s*/, "");
  return cleaned.split(",").map((s) => s.trim())
    .filter((s) => s.length > 1 && !/^\(\d+\)$/.test(s));
}

function paxFromText(text: string | null): number {
  if (!text) return 0;
  const m = text.match(/^\s*\((\d+)\)/);
  return m ? parseInt(m[1], 10) : 0;
}

function detectStayDate(sheetName: string, rows: any[][], fallback: string): string {
  // 1. ISO in name
  let m = sheetName.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // 2. d. m. (e.g. "30. 4." or "30.4")
  m = sheetName.match(/(\d{1,2})\.\s*(\d{1,2})\.?/);
  if (m) {
    const yr = new Date().getUTCFullYear();
    return new Date(Date.UTC(yr, parseInt(m[2], 10) - 1, parseInt(m[1], 10))).toISOString().slice(0, 10);
  }
  // 3. Scan first 3 rows for any date-looking cell
  for (let i = 0; i < Math.min(rows.length, 3); i++) {
    for (const c of (rows[i] || [])) {
      const s = String(c ?? "");
      const m2 = s.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
    }
  }
  return fallback;
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
      .select("role, organization_slug, assigned_hotel")
      .eq("id", userRes.user.id)
      .single();
    if (!profile || !["admin","manager","housekeeping_manager","reception","front_office","top_management"].includes(profile.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const hotelId = (formData.get("hotel_id") as string) || profile.assigned_hotel;
    const fallbackDate = (formData.get("date") as string) || new Date().toISOString().slice(0, 10);
    if (!file || !hotelId) throw new Error("Missing file or hotel_id");

    const buf = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "array" });

    let totalRows = 0;
    const datesProcessed = new Set<string>();
    const warnings: string[] = [];

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
      if (!rows.length) continue;

      const stayDate = detectStayDate(sheetName, rows, fallbackDate);

      // Find header row in first 8 rows
      let headerIdx = -1;
      for (let i = 0; i < Math.min(rows.length, 8); i++) {
        const r = (rows[i] || []).map((c) => String(c ?? "").toLowerCase().trim());
        const hasRoom = r.some((c) => c === "room" || c === "room number" || c === "room no." || c.includes("szoba"));
        const hasMeal = r.some((c) => c.startsWith("bre") || c.startsWith("rea") || c.startsWith("ren") || c.startsWith("snídan"));
        if (hasRoom && hasMeal) { headerIdx = i; break; }
      }
      if (headerIdx === -1) {
        warnings.push(`[${sheetName}] no header row found`);
        continue;
      }

      const header = rows[headerIdx].map((c) => String(c ?? "").toLowerCase().trim());
      const findCol = (...needles: string[]) => header.findIndex((h) => needles.some((n) => h === n || h.startsWith(n)));
      const cRoom = findCol("room", "szoba");
      const cArr = findCol("arrival", "érkez", "check-in");
      const cOng = findCol("ongoing", "stay", "tartózkod");
      const cBre = findCol("bre", "rea", "ren", "snídan");
      const cLun = findCol("lun", "alm", "ebéd");
      const cDin = findCol("din", "cen", "vacsora");
      const cAll = findCol("all", "incl");
      const cNotes = findCol("note", "megjegy");

      const upserts: any[] = [];
      for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;
        const room = String(row[cRoom] ?? "").trim();
        if (!room || room.toLowerCase().startsWith("total")) continue;
        const arrText = row[cArr] != null ? String(row[cArr]) : null;
        const ongText = row[cOng] != null ? String(row[cOng]) : null;
        const guests = [...extractGuests(arrText), ...extractGuests(ongText)];
        const pax = paxFromText(arrText) || paxFromText(ongText);

        upserts.push({
          hotel_id: hotelId,
          organization_slug: profile.organization_slug,
          stay_date: stayDate,
          room_number: room,
          guest_names: guests,
          pax,
          breakfast_count: Math.round(Number(row[cBre] ?? 0) || 0),
          lunch_count: Math.round(Number(row[cLun] ?? 0) || 0),
          dinner_count: Math.round(Number(row[cDin] ?? 0) || 0),
          all_inclusive_count: Math.round(Number(row[cAll] ?? 0) || 0),
          source_notes: cNotes >= 0 && row[cNotes] ? String(row[cNotes]).slice(0, 500) : null,
          uploaded_by: userRes.user.id,
        });
      }

      if (upserts.length) {
        const { error } = await supabase
          .from("breakfast_roster")
          .upsert(upserts, { onConflict: "hotel_id,stay_date,room_number" });
        if (error) throw error;
        totalRows += upserts.length;
        datesProcessed.add(stayDate);
      }
    }

    return new Response(JSON.stringify({
      success: true, rows: totalRows, hotel_id: hotelId,
      dates: Array.from(datesProcessed), warnings,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("breakfast-roster-upload error", e);
    return new Response(JSON.stringify({ error: e.message ?? String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
