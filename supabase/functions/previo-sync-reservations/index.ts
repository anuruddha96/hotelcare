import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { callPrevioXml, loadPrevioCredentials, resolvePrevioSecretName } from "../_shared/previoCredentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const grab = (xml: string, tag: string) => {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
};
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, days: number) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return iso(d); };
const nightsBetween = (a: string, b: string) => Math.max(1, Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400000));
async function syntheticSourceId(seed: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
  return `synthetic-${Array.from(new Uint8Array(hash)).slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  let hotelCareHotelId: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const requestedHotelId = String(body.hotelId || "").trim();
    if (!requestedHotelId) return json({ ok: false, error: "hotelId required" }, 400);
    const pastDays = Math.min(Math.max(Number(body.pastDays) || 7, 0), 60);
    const futureDays = Math.min(Math.max(Number(body.futureDays) || 365, 1), 540);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = createClient(url, serviceKey);
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ ok: false, error: "Unauthorized" }, 401);
    const token = authHeader.slice(7);
    const authClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await authClient.auth.getUser(token);
    if (!userData?.user) return json({ ok: false, error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    let { data: config } = await service.from("pms_configurations")
      .select("hotel_id,pms_hotel_id,credentials_secret_name,is_active,sync_enabled")
      .eq("hotel_id", requestedHotelId).eq("pms_type", "previo").maybeSingle();
    if (!config) {
      const fallback = await service.from("pms_configurations")
        .select("hotel_id,pms_hotel_id,credentials_secret_name,is_active,sync_enabled")
        .eq("pms_hotel_id", requestedHotelId).eq("pms_type", "previo").maybeSingle();
      config = fallback.data;
    }
    if (!config?.hotel_id || !config?.pms_hotel_id || !config.is_active) return json({ ok: false, error: "Active Previo configuration not found" }, 404);
    hotelCareHotelId = config.hotel_id;

    const { data: hotelCfg } = await service.from("hotel_configurations")
      .select("organization_id,organizations!inner(slug)").eq("hotel_id", hotelCareHotelId).maybeSingle();
    const orgSlug = (hotelCfg as any)?.organizations?.slug || null;
    const { data: allowed } = await service.rpc("can_access_pms_hotel", { _uid: userId, _hotel_id: hotelCareHotelId, _org_slug: orgSlug });
    if (!allowed) return json({ ok: false, error: "Forbidden" }, 403);

    const secretName = resolvePrevioSecretName(config.credentials_secret_name);
    const creds = loadPrevioCredentials(secretName);
    const today = iso(new Date());
    const from = addDays(today, -pastDays);
    const to = addDays(today, futureDays);
    const xmlResult = await callPrevioXml({
      method: "searchReservations",
      creds,
      pmsHotelId: String(config.pms_hotel_id),
      extraXml: `<term><from>${from}</from><to>${to}</to></term>`,
    });
    if (!xmlResult.ok) throw new Error(`Previo searchReservations failed (${xmlResult.status})`);
    const blocks = xmlResult.text.match(/<reservation>[\s\S]*?<\/reservation>/gi) || [];

    const { data: roomRows } = await service.from("rooms").select("id,room_number,hotel,pms_metadata");
    const roomByPrevioId = new Map<string, string>();
    const roomByName = new Map<string, string>();
    for (const room of roomRows || []) {
      const sameHotel = room.hotel === hotelCareHotelId || room.hotel === (hotelCfg as any)?.hotel_name;
      if (!sameHotel && room.hotel !== hotelCareHotelId) continue;
      const previousId = String((room.pms_metadata as any)?.roomId || "").trim();
      if (previousId) roomByPrevioId.set(previousId, room.id);
      roomByName.set(String(room.room_number || "").trim().toLowerCase(), room.id);
    }

    let inserted = 0, updated = 0, skipped = 0;
    const errors: string[] = [];
    for (const block of blocks) {
      try {
        const checkIn = grab(block, "from").slice(0, 10);
        const checkOut = grab(block, "to").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut) || checkOut <= checkIn) { skipped++; continue; }
        const object = block.match(/<object>[\s\S]*?<\/object>/i)?.[0] || "";
        const objId = grab(object, "objId") || grab(block, "objId");
        const roomName = grab(object, "name") || grab(block, "roomName");
        const roomId = (objId && roomByPrevioId.get(String(objId))) || roomByName.get(roomName.trim().toLowerCase()) || null;
        const rawId = grab(block, "reservationId") || grab(block, "resId") || grab(block, "reservationNumber") || grab(block, "code");
        const sourceReservationId = rawId || await syntheticSourceId(`${config.pms_hotel_id}|${objId}|${roomName}|${checkIn}|${checkOut}|${grab(block, "created")}`);
        const statusId = Number(grab(block, "statusId") || 0);
        let importedStatus: "pending" | "confirmed" | "checked_in" | "checked_out" | "cancelled" | "no_show" = "pending";
        if (statusId === 7) importedStatus = "cancelled";
        else if (statusId === 8) importedStatus = "no_show";
        else if (statusId === 9) importedStatus = "checked_out";
        else if (statusId === 3 && checkIn <= today && checkOut > today) importedStatus = "checked_in";
        else if (statusId === 3) importedStatus = "confirmed";

        const guestCount = Math.max(1, (block.match(/<guest>/gi) || []).length);
        const totalNights = nightsBetween(checkIn, checkOut);
        const priceMatch = block.match(/<(?:price|priceTotal|totalPrice|amount)>([\d.,]+)<\/(?:price|priceTotal|totalPrice|amount)>/i);
        const currency = (grab(block, "currency") || "EUR").toUpperCase();
        const totalAmount = priceMatch ? Number(priceMatch[1].replace(",", ".")) : 0;
        const trustedAmount = Number.isFinite(totalAmount) && totalAmount > 0 ? totalAmount : 0;
        const rate = trustedAmount > 0 ? Math.round((trustedAmount / totalNights) * 100) / 100 : 0;
        const sourceNote = grab(block, "note") || null;
        const metadata = { previo_status_id: statusId || null, previo_room_id: objId || null, previo_room_name: roomName || null, guest_count_from_previo: guestCount, source_note: sourceNote, imported_at: new Date().toISOString(), import_window: { from, to } };

        const { data: existing } = await service.from("reservations")
          .select("id,status,internal_notes,special_requests")
          .eq("hotel_id", hotelCareHotelId).eq("source", "previo").eq("source_reservation_id", sourceReservationId).maybeSingle();
        let status = importedStatus;
        if (existing && ["checked_in", "checked_out"].includes(existing.status) && ["pending", "confirmed"].includes(importedStatus)) status = existing.status as any;
        const payload: any = {
          hotel_id: hotelCareHotelId, organization_slug: orgSlug, source: "previo", source_reservation_id: sourceReservationId,
          guest_id: null, room_id: roomId, check_in_date: checkIn, check_out_date: checkOut, adults: guestCount, children: 0,
          status, total_nights: totalNights, room_rate: rate, total_room_charge: trustedAmount, total_amount: trustedAmount,
          balance_due: trustedAmount, currency, pms_metadata: metadata, updated_by: userId,
        };
        if (existing) {
          delete payload.balance_due;
          delete payload.total_amount;
          delete payload.total_room_charge;
          await service.from("reservations").update(payload).eq("id", existing.id);
          if (roomId) {
            const { data: assignment } = await service.from("reservation_room_assignments").select("id").eq("reservation_id", existing.id).eq("room_id", roomId).maybeSingle();
            if (assignment) await service.from("reservation_room_assignments").update({ check_in_date: checkIn, check_out_date: checkOut, status: ["cancelled","no_show","checked_out"].includes(status) ? "completed" : "assigned" }).eq("id", assignment.id);
            else await service.from("reservation_room_assignments").insert({ reservation_id: existing.id, room_id: roomId, check_in_date: checkIn, check_out_date: checkOut, status: ["cancelled","no_show","checked_out"].includes(status) ? "completed" : "assigned" });
          }
          updated++;
        } else {
          payload.created_by = userId;
          const { data: created, error } = await service.from("reservations").insert(payload).select("id").single();
          if (error) throw error;
          if (roomId) await service.from("reservation_room_assignments").insert({ reservation_id: created.id, room_id: roomId, check_in_date: checkIn, check_out_date: checkOut, status: ["cancelled","no_show","checked_out"].includes(status) ? "completed" : "assigned" });
          inserted++;
        }
      } catch (e: any) {
        errors.push(String(e?.message || e).slice(0, 300));
      }
    }

    const syncStatus = errors.length ? (inserted || updated ? "partial" : "error") : "success";
    await service.from("pms_sync_history").insert({ hotel_id: hotelCareHotelId, sync_type: "reservations", direction: "from_previo", sync_status: syncStatus, changed_by: userId, records_processed: blocks.length, records_created: inserted, records_updated: updated, records_failed: errors.length, error_message: errors.length ? errors.slice(0, 10).join("; ") : null, data: { received: blocks.length, inserted, updated, skipped, errors: errors.slice(0, 20), previo_hotel_id: config.pms_hotel_id, from, to } });
    await service.from("pms_configurations").update({ last_sync_at: new Date().toISOString(), last_sync_status: syncStatus, last_sync_error: errors.length ? errors[0] : null }).eq("hotel_id", hotelCareHotelId).eq("pms_type", "previo");
    return json({ ok: true, received: blocks.length, inserted, updated, skipped, errors, hotelId: hotelCareHotelId, from, to });
  } catch (e: any) {
    const message = String(e?.message || e);
    try {
      const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      if (hotelCareHotelId) await service.from("pms_configurations").update({ last_sync_at: new Date().toISOString(), last_sync_status: "error", last_sync_error: message }).eq("hotel_id", hotelCareHotelId).eq("pms_type", "previo");
    } catch { /* non-fatal */ }
    return json({ ok: false, error: message }, 500);
  }
});
