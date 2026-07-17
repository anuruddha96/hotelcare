import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { callPrevioXml, loadPrevioCredentials } from "../_shared/previoCredentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Candidate tag names Previo may use for the reception's internal /
// housekeeping note (separate from the OTA <note> blob).
const INTERNAL_NOTE_TAGS = [
  "note", "noteInternal", "internalNote", "noteHousekeeping", "housekeepingNote",
  "hotelNote", "noteHotel", "noteReception", "receptionNote", "notice",
  "comment", "remark", "guestNote", "roomNote",
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);
  const hotelIdParam = url.searchParams.get("hotel_id") || "previo-test";
  // Optional overrides so operators can probe a specific reservation window.
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const service = createClient(SUPABASE_URL, SERVICE);
  const { data: cfg } = await service
    .from("pms_configurations")
    .select("pms_hotel_id, credentials_secret_name")
    .eq("hotel_id", hotelIdParam)
    .eq("pms_type", "previo")
    .maybeSingle();

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const from = fromParam || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = toParam || tomorrow;

  const hotId = String(cfg?.pms_hotel_id || "");
  const results: any[] = [];
  let noteFieldReport: any = null;

  try {
    const creds = loadPrevioCredentials(cfg?.credentials_secret_name);
    const r = await callPrevioXml({
      method: "searchReservations",
      creds,
      pmsHotelId: hotId,
      extraXml: `<term><from>${from}</from><to>${to}</to></term>`,
    });

    // Enumerate every distinct child-tag encountered inside <reservation>
    // blocks so we can see, per tag, how many reservations carry a value
    // and a short sample — this reveals the actual field name Previo uses
    // for the reception's internal note in this tenant.
    const blocks = (r.text || "").match(/<reservation>[\s\S]*?<\/reservation>/g) || [];
    const tagStats = new Map<string, { withValue: number; sample: string }>();
    for (const block of blocks) {
      // Match immediate simple tags with text content (single line).
      const tagMatches = block.match(/<([a-zA-Z][a-zA-Z0-9]*)>([^<]*)<\/\1>/g) || [];
      for (const raw of tagMatches) {
        const m = raw.match(/<([a-zA-Z][a-zA-Z0-9]*)>([^<]*)<\/\1>/);
        if (!m) continue;
        const tag = m[1];
        const val = (m[2] || "").trim();
        const stat = tagStats.get(tag) || { withValue: 0, sample: "" };
        if (val) {
          stat.withValue += 1;
          if (!stat.sample) stat.sample = val.slice(0, 200);
        }
        tagStats.set(tag, stat);
      }
    }
    const noteCandidates = Array.from(tagStats.entries())
      .filter(([tag]) => /note|comment|remark|hotel|internal|hous|recept|notice|guest/i.test(tag))
      .map(([tag, s]) => ({ tag, reservationsWithValue: s.withValue, sample: s.sample }))
      .sort((a, b) => b.reservationsWithValue - a.reservationsWithValue);

    // Extract the first 3 reservations that have ANY of our candidate
    // internal-note tags populated, so the operator can eyeball them.
    const sampleReservations: any[] = [];
    for (const block of blocks) {
      const hasCandidate = INTERNAL_NOTE_TAGS.some((t) =>
        new RegExp(`<${t}>[^<]*[^\\s<][^<]*</${t}>`).test(block)
      );
      if (!hasCandidate) continue;
      const pick = (tag: string) => {
        const m = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
        return m ? m[1].trim() : null;
      };
      const idMatch = block.match(/<resId>(\d+)<\/resId>|<id>(\d+)<\/id>/);
      const objMatch = block.match(/<object>[\s\S]*?<name>([^<]*)<\/name>[\s\S]*?<\/object>/);
      sampleReservations.push({
        resId: idMatch ? (idMatch[1] || idMatch[2]) : null,
        room: objMatch ? objMatch[1].trim() : null,
        from: pick("from"),
        to: pick("to"),
        notes: Object.fromEntries(
          INTERNAL_NOTE_TAGS
            .map((t) => [t, pick(t)])
            .filter(([, v]) => v)
        ),
        rawBlock: block.slice(0, 2000),
      });
      if (sampleReservations.length >= 3) break;
    }

    noteFieldReport = {
      totalReservationBlocks: blocks.length,
      noteCandidates,
      sampleReservations,
    };

    results.push({
      url: "https://api.previo.app/x1/hotel/searchReservations/",
      status: r.status,
      ok: r.ok,
      error: r.errorMessage,
      // Full snippet (large) so the raw XML shape is visible.
      snippet: (r.text || "").slice(0, 40000),
    });
  } catch (e: any) {
    results.push({ url: "https://api.previo.app/x1/hotel/searchReservations/", error: e?.message });
  }
  return new Response(
    JSON.stringify({ hotelId: hotelIdParam, hotId, from, to, today, noteFieldReport, results }, null, 2),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
