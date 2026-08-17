// Push minimum-stay rules and "rooms to sell" (inventory) to Previo.
//
// The rate calendar edits these the same way it edits a price: the change is
// saved in Hotel Care first (min stay in `min_stay_rules`), then sent to Previo
// over the same EQC channel the prices use. Nothing is silent — every item
// comes back with its own result so the grid can show what landed.

import { createClient } from "npm:@supabase/supabase-js@2";
import { loadPrevioCredentials, hasPrevioCredentials } from "../_shared/previoCredentials.ts";
import { writePrevioRestrictions } from "../_shared/previoRateWrite.ts";
import { syncPrevioRatePlanMappings } from "../_shared/previoRatePlans.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PUSH_ROLES = ["admin", "top_management", "top_management_manager"];
const isDate = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ""));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface Item {
  /** Stay date. */
  date: string;
  /** Minimum nights for that date (house-wide when no room type is given). */
  minStay?: number | null;
  /** Rooms to sell for one room type on that date. */
  roomsToSell?: number | null;
  /** Previo room type id (`<hotId>:<obkId>` on multi-account properties). */
  obkId?: string | null;
  /** Room type label, for the response and audit text. */
  roomTypeName?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!token) return json({ ok: false, error: "Not signed in" }, 401);
    const { data: userRes } = await admin.auth.getUser(token);
    const user = userRes?.user;
    if (!user) return json({ ok: false, error: "Not signed in" }, 401);

    const { data: profile } = await admin
      .from("profiles").select("role, assigned_hotel, organization_slug").eq("id", user.id).maybeSingle();
    if (!profile || !PUSH_ROLES.includes(String((profile as any).role))) {
      return json({ ok: false, error: "You do not have permission to change availability or stay rules." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const hotelId: string | null = typeof body.hotelId === "string" ? body.hotelId : null;
    const items: Item[] = Array.isArray(body.items) ? body.items.slice(0, 400) : [];
    if (!hotelId) return json({ ok: false, error: "hotelId is required" }, 400);
    if (!items.length) return json({ ok: false, error: "Nothing to send." }, 400);
    if ((profile as any).role !== "admin" && (profile as any).assigned_hotel && (profile as any).assigned_hotel !== hotelId) {
      return json({ ok: false, error: "You can only change your own property." }, 403);
    }

    const clean = items.filter((i) => isDate(i.date));
    if (!clean.length) return json({ ok: false, error: "No valid stay dates were sent." }, 400);

    // --- Previo accounts (SLNT merges two profiles under one hotel) -------
    type Account = { hotId: string; creds: any };
    const accounts = new Map<string, Account>();
    let fallback: Account | null = null;

    const { data: accountRows } = await admin
      .from("pms_accounts").select("pms_hotel_id, credentials_secret_name").eq("hotel_id", hotelId).eq("is_active", true);
    for (const a of (accountRows ?? []) as any[]) {
      if (!a.pms_hotel_id || !hasPrevioCredentials(a.credentials_secret_name)) continue;
      try {
        const acc = { hotId: String(a.pms_hotel_id), creds: loadPrevioCredentials(a.credentials_secret_name) };
        accounts.set(acc.hotId, acc);
        fallback ??= acc;
      } catch { /* reported below */ }
    }
    if (!fallback) {
      const { data: cfg } = await admin
        .from("pms_configurations").select("pms_hotel_id, credentials_secret_name, is_active").eq("hotel_id", hotelId).maybeSingle();
      if (!cfg || !hasPrevioCredentials((cfg as any).credentials_secret_name)) {
        return json({ ok: false, code: "no_credentials", error: "No Previo credentials are saved for this property." });
      }
      fallback = { hotId: String((cfg as any).pms_hotel_id ?? ""), creds: loadPrevioCredentials((cfg as any).credentials_secret_name) };
    }

    const loadMaps = async () => {
      const { data } = await admin
        .from("previo_rate_plan_mapping")
        .select("previo_rate_plan_id, previo_room_type_id, is_default")
        .eq("hotel_id", hotelId);
      return ((data ?? []) as any[]).filter((m) => m.previo_rate_plan_id && m.previo_room_type_id);
    };
    let maps = await loadMaps();
    if (maps.length === 0) {
      await syncPrevioRatePlanMappings(admin, hotelId);
      maps = await loadMaps();
    }
    if (maps.length === 0) {
      return json({ ok: false, code: "no_mapping", error: "No Previo pricelist is mapped for this property yet." });
    }
    const defaultMap = maps.find((m: any) => m.is_default) ?? maps[0];

    const { data: orgRow } = await admin
      .from("room_types").select("organization_slug").eq("hotel_id", hotelId).limit(1).maybeSingle();
    const orgSlug = (orgRow as any)?.organization_slug ?? (profile as any).organization_slug ?? null;

    /** Resolve the Previo account + ids for one item. */
    const resolve = (obkRaw: string | null | undefined) => {
      const map: any = maps.find((m: any) => String(m.previo_room_type_id) === String(obkRaw)) ?? defaultMap;
      const scoped = String(map.previo_room_type_id ?? obkRaw ?? "");
      const parts = scoped.split(":");
      const obkId = parts.pop() as string;
      const account = (parts.length ? accounts.get(parts.join(":")) : null) ?? fallback!;
      return { obkId, prlId: String(map.previo_rate_plan_id), account };
    };

    const results: Array<{ date: string; roomTypeName?: string | null; ok: boolean; message: string }> = [];
    let sent = 0;
    let failed = 0;

    for (const item of clean) {
      const wantsMinStay = item.minStay !== undefined && item.minStay !== null;
      const wantsInventory = item.roomsToSell !== undefined && item.roomsToSell !== null;
      if (!wantsMinStay && !wantsInventory) continue;

      if (wantsInventory && !wantsMinStay) {
        // Previo refuses availability over the price channel (error 3010).
        failed += 1;
        results.push({
          date: item.date,
          roomTypeName: item.roomTypeName ?? null,
          ok: false,
          message: "Rooms to sell can only be changed in Previo — it does not accept availability from Hotel Care.",
        });
        continue;
      }

      // Previo keeps the minimum stay on the date (rate plan season), not on a
      // single room type, so a change is written to every mapped room type.
      const obkList = Array.from(new Set(maps.map((m: any) => String(m.previo_room_type_id))));

      let allOk = true;
      let lastMessage = "Success";
      for (const obk of obkList) {
        const { obkId, prlId, account } = resolve(obk);
        const res = await writePrevioRestrictions({
          creds: account.creds,
          pmsHotelId: account.hotId,
          target: {
            obkId,
            prlId,
            from: item.date,
            to: item.date,
            minStay: Number(item.minStay),
            roomsToSell: null,
          },
        });
        if (!res.ok) {
          allOk = false;
          lastMessage = res.attempts[0]?.message ?? "Previo rejected the change.";
        }
      }

      if (allOk && orgSlug) {
        // Keep the calendar honest even before the next PMS sync.
        await admin.from("min_stay_rules").upsert({
          hotel_id: hotelId,
          organization_slug: orgSlug,
          stay_date: item.date,
          min_nights: Math.max(1, Math.round(Number(item.minStay))),
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        }, { onConflict: "hotel_id,stay_date" });
      }

      if (allOk) sent += 1; else failed += 1;
      results.push({ date: item.date, roomTypeName: item.roomTypeName ?? null, ok: allOk, message: lastMessage });
    }


    return json({ ok: failed === 0, sent, failed, results });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
