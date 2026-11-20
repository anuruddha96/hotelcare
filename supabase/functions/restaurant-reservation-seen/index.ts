// Public, idempotent acknowledgement for /bb's shared staff devices.
// This is intentionally limited to setting a first-seen timestamp; no guest
// fields or reservation statuses can be changed through this function.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const hits = new Map<string, { count: number; until: number }>();
function limited(ip: string): boolean {
  const now = Date.now();
  const item = hits.get(ip);
  if (!item || item.until < now) { hits.set(ip, { count: 1, until: now + 60_000 }); return false; }
  item.count++;
  return item.count > 45;
}
const response = (body: unknown, code = 200) =>
  new Response(JSON.stringify(body), { status: code, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);
  if (limited(req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown"))
    return response({ error: "Too many requests" }, 429);
  try {
    const body = await req.json();
    const id = String(body?.reservation_id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(id) || id.length !== 36)
      return response({ error: "Invalid reservation ID" }, 400);

    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return response({ error: "Server not configured" }, 500);
    const db = createClient(url, key);
    const { data: existing, error: readError } = await db.from("restaurant_reservations")
      .select("id, first_seen_at, status").eq("id", id).maybeSingle();
    if (readError) throw readError;
    if (!existing || existing.status === "cancelled") return response({ error: "Not found" }, 404);
    if (existing.first_seen_at) return response({ ok: true, first_seen_at: existing.first_seen_at });

    const now = new Date().toISOString();
    const { error } = await db.from("restaurant_reservations")
      .update({ first_seen_at: now })
      .eq("id", id).is("first_seen_at", null);
    if (error) throw error;

    const { data: latest } = await db.from("restaurant_reservations")
      .select("first_seen_at").eq("id", id).maybeSingle();
    return response({ ok: true, first_seen_at: latest?.first_seen_at ?? now });
  } catch (error) {
    console.error("restaurant-reservation-seen", error);
    return response({ error: "Could not mark reservation as seen" }, 500);
  }
});
