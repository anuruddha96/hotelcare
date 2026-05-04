import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function toCSV(rows: Record<string, any>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: any) => {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth");
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: userRes, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userRes?.user) throw new Error("Unauthorized");
    const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: profile } = await supabase.from("profiles")
      .select("role, organization_slug").eq("id", userRes.user.id).single();
    if (!profile || !["admin","top_management"].includes(profile.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { hotel_id, from, to, format = "xlsx", kind = "recommendations" } = await req.json();

    const start = from || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const end = to || new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10);

    let rows: Record<string, any>[] = [];

    if (kind === "recommendations") {
      let q = supabase.from("rate_recommendations")
        .select("hotel_id, stay_date, current_rate_eur, recommended_rate_eur, delta_eur, reason, status, created_at, reviewed_at")
        .eq("organization_slug", profile.organization_slug)
        .gte("stay_date", start).lte("stay_date", end)
        .order("stay_date", { ascending: true });
      if (hotel_id) q = q.eq("hotel_id", hotel_id);
      const { data } = await q;
      rows = (data ?? []).map((r) => ({
        hotel: r.hotel_id,
        date: r.stay_date,
        dow: new Date(r.stay_date).toLocaleDateString("en-US", { weekday: "short" }),
        current_rate_eur: r.current_rate_eur,
        recommended_rate_eur: r.recommended_rate_eur,
        delta_eur: r.delta_eur,
        source: r.reason?.startsWith("AI:") ? "ai" : "engine",
        reason: r.reason,
        status: r.status,
        created_at: r.created_at,
        reviewed_at: r.reviewed_at,
      }));
    } else if (kind === "pickup") {
      let q = supabase.from("pickup_snapshots")
        .select("hotel_id, stay_date, bookings_current, bookings_last_year, delta, captured_at, snapshot_label")
        .eq("organization_slug", profile.organization_slug)
        .gte("stay_date", start).lte("stay_date", end)
        .order("captured_at", { ascending: false }).limit(5000);
      if (hotel_id) q = q.eq("hotel_id", hotel_id);
      const { data } = await q;
      rows = data ?? [];
    } else if (kind === "audit") {
      let q = supabase.from("rate_change_audit")
        .select("*")
        .eq("organization_slug", profile.organization_slug)
        .order("performed_at", { ascending: false }).limit(5000);
      if (hotel_id) q = q.eq("hotel_id", hotel_id);
      const { data } = await q;
      rows = data ?? [];
    } else if (kind === "ai_insights") {
      let q = supabase.from("revenue_ai_insights")
        .select("hotel_id, focus_date, payload, created_at")
        .eq("organization_slug", profile.organization_slug)
        .order("created_at", { ascending: false }).limit(500);
      if (hotel_id) q = q.eq("hotel_id", hotel_id);
      const { data } = await q;
      rows = (data ?? []).flatMap((ins) => {
        const p = ins.payload as any;
        const out: any[] = [];
        for (const x of (p?.top_increase_dates ?? [])) out.push({
          hotel: ins.hotel_id, generated_at: ins.created_at, kind: "increase",
          date: x.date, suggested_delta_eur: x.suggested_delta_eur,
          confidence: x.confidence, reason: x.reason,
        });
        for (const x of (p?.top_decrease_dates ?? [])) out.push({
          hotel: ins.hotel_id, generated_at: ins.created_at, kind: "decrease",
          date: x.date, suggested_delta_eur: x.suggested_delta_eur,
          confidence: x.confidence, reason: x.reason,
        });
        return out;
      });
    }

    if (format === "csv") {
      const csv = toCSV(rows);
      return new Response(csv, {
        headers: {
          ...corsHeaders, "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="revenue-${kind}-${start}-${end}.csv"`,
        },
      });
    }
    // xlsx
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, kind);
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    return new Response(new Uint8Array(buf), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="revenue-${kind}-${start}-${end}.xlsx"`,
      },
    });
  } catch (e: any) {
    console.error("revenue-export error", e);
    return new Response(JSON.stringify({ error: e.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
