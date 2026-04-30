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
  // pattern "(N) NAME, NAME (departure 10:52)" — strip "(...)" details
  const cleaned = text.replace(/\(departure[^)]*\)/gi, "")
    .replace(/\(arrival[^)]*\)/gi, "")
    .replace(/^\s*\(\d+\)\s*/, "");
  return cleaned
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && !/^\(\d+\)$/.test(s));
}

function paxFromText(text: string | null): number {
  if (!text) return 0;
  const m = text.match(/^\s*\((\d+)\)/);
  return m ? parseInt(m[1], 10) : 0;
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
    if (!profile || !["admin", "manager", "housekeeping_manager", "reception", "front_office"].includes(profile.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const hotelId = (formData.get("hotel_id") as string) || profile.assigned_hotel;
    if (!file || !hotelId) throw new Error("Missing file or hotel_id");

    const buf = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "array" });

    let totalRows = 0;
    for (const sheetName of wb.SheetNames) {
      // Sheet name like "2026-04-30"
      const dateMatch = sheetName.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (!dateMatch) continue;
      const stayDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
      const ws = wb.Sheets[sheetName];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

      // Find header row
      let headerIdx = -1;
      for (let i = 0; i < Math.min(rows.length, 5); i++) {
        const r = (rows[i] || []).map((c) => String(c ?? "").toLowerCase());
        if (r.includes("room") && r.some((c) => c.startsWith("bre"))) {
          headerIdx = i;
          break;
        }
      }
      if (headerIdx === -1) continue;

      const header = rows[headerIdx].map((c) => String(c ?? "").toLowerCase().trim());
      const col = (name: string) => header.findIndex((h) => h === name || h.startsWith(name));
      const cRoom = col("room");
      const cArr = col("arrival");
      const cOng = col("ongoing");
      const cBre = col("bre");
      const cLun = col("lun");
      const cDin = col("din");
      const cAll = col("all");
      const cNotes = header.findIndex((h) => h.startsWith("note") || h === "departure" && header.lastIndexOf("departure") === header.indexOf("departure"));

      const upserts: any[] = [];
      for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;
        const room = String(row[cRoom] ?? "").trim();
        if (!room) continue;
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
          breakfast_count: Number(row[cBre] ?? 0) || 0,
          lunch_count: Number(row[cLun] ?? 0) || 0,
          dinner_count: Number(row[cDin] ?? 0) || 0,
          all_inclusive_count: Number(row[cAll] ?? 0) || 0,
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
      }
    }

    return new Response(JSON.stringify({ success: true, rows: totalRows, hotel_id: hotelId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("breakfast-roster-upload error", e);
    return new Response(JSON.stringify({ error: e.message ?? String(e) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
