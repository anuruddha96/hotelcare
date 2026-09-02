// Real, idempotent Previo reservation importer.
//
// Pulls reservations for a bounded window via the PROVEN XML
// `searchReservations` method (same helper as previo-pull-revenue), parses
// only fields that are truly present (shared parser in
// _shared/previoReservations.ts) and upserts into public.reservations by
// (hotel_id, source='previo', source_reservation_id).
//
// Safety rules:
// - Never invents guest data. Guest identity stays NULL when Previo does not
//   provide it; pms_guest_name carries whatever label Previo gave us.
// - Never overwrites HotelCare-managed direct bookings (different source, so
//   the conflict target can never collide with them).
// - Never downgrades local operational statuses (checked_in / checked_out).
// - Room mapping uses pms_room_mappings and rooms.pms_metadata.roomId only —
//   no brittle trailing-number parsing. Unmapped rooms import unassigned.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import {
  callPrevioXml,
  hasPrevioCredentials,
  loadPrevioCredentials,
  resolvePrevioSecretName,
} from "../_shared/previoCredentials.ts";
import {
  addDays,
  mapPrevioStatus,
  parsePrevioReservations,
  type PrevioReservationRow,
} from "../_shared/previoReservations.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_ROLES = [
  "admin",
  "manager",
  "reception",
  "front_office",
  "top_management",
  "top_management_manager",
];

const CHUNK_DAYS = 93;
const UPSERT_BATCH = 200;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const service = createClient(supabaseUrl, serviceKey);

  let hotelIdForLog: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const requestedHotelId = String(body?.hotelId ?? "").trim();
    if (!requestedHotelId) return json({ success: false, error: "hotelId is required" }, 400);

    // Normalize a legacy/display-name property reference to the canonical
    // hotel_configurations.hotel_id before any PMS lookup or reservation write.
    let hotelId = requestedHotelId;
    const { data: byHotelId } = await service
      .from("hotel_configurations")
      .select("hotel_id")
      .eq("hotel_id", requestedHotelId)
      .maybeSingle();
    if (byHotelId?.hotel_id) {
      hotelId = byHotelId.hotel_id;
    } else {
      const { data: byHotelName } = await service
        .from("hotel_configurations")
        .select("hotel_id")
        .eq("hotel_name", requestedHotelId)
        .maybeSingle();
      if (byHotelName?.hotel_id) hotelId = byHotelName.hotel_id;
    }
    hotelIdForLog = hotelId;

    const daysBack = Math.min(60, Math.max(0, Number(body?.daysBack ?? 7) || 0));
    const daysForward = Math.min(540, Math.max(30, Number(body?.daysForward ?? 365) || 365));

    // ---- Caller authorization -------------------------------------------
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const isServiceCall = token === serviceKey;
    let userId: string | null = null;
    let userName: string | null = null;
    let profileOrg: string | null = null;

    if (!isServiceCall) {
      const { data: userData } = await service.auth.getUser(token);
      const user = userData?.user;
      if (!user) return json({ success: false, error: "Unauthorized" }, 401);
      userId = user.id;
      const { data: profile } = await service
        .from("profiles")
        .select("role, organization_slug, assigned_hotel, is_super_admin, full_name")
        .eq("id", user.id)
        .maybeSingle();
      if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
        return json({ success: false, error: "Forbidden" }, 403);
      }
      userName = profile.full_name ?? null;
      profileOrg = profile.organization_slug ?? null;

      // Use the same alias-aware hotel access helper as RLS instead of a
      // brittle direct assigned_hotel === hotelId comparison.
      const { data: canAccess } = await service.rpc("can_access_pms_hotel", {
        _uid: user.id,
        _hotel_id: hotelId,
        _org_slug: profileOrg,
      });
      if (profile.is_super_admin !== true && canAccess !== true) {
        return json({ success: false, error: "Forbidden for this property" }, 403);
      }
    }

    // ---- Resolve Previo accounts for this hotel --------------------------
    const { data: legacyCfg } = await service
      .from("pms_configurations")
      .select("id, hotel_id, pms_hotel_id, credentials_secret_name, is_active")
      .eq("hotel_id", hotelId)
      .eq("pms_type", "previo")
      .maybeSingle();
    const { data: portfolioAccounts } = await service
      .from("pms_accounts")
      .select("id, hotel_id, organization_slug, label, pms_hotel_id, credentials_secret_name, is_active")
      .eq("hotel_id", hotelId)
      .eq("pms_type", "previo")
      .eq("is_active", true);

    const accounts: Array<{
      id: string;
      label: string;
      pms_hotel_id: string;
      credentials_secret_name: string | null;
      organization_slug?: string | null;
      isLegacy?: boolean;
    }> = (portfolioAccounts ?? []).length > 0
      ? (portfolioAccounts ?? []).map((a: Record<string, unknown>) => ({
          id: String(a.id),
          label: String(a.label || a.pms_hotel_id),
          pms_hotel_id: String(a.pms_hotel_id || ""),
          credentials_secret_name: resolvePrevioSecretName(a.credentials_secret_name as string | null),
          organization_slug: (a.organization_slug as string | null) ?? null,
        }))
      : legacyCfg?.is_active
        ? [{
            id: String(legacyCfg.id),
            label: String(legacyCfg.pms_hotel_id),
            pms_hotel_id: String(legacyCfg.pms_hotel_id || ""),
            credentials_secret_name: legacyCfg.credentials_secret_name,
            isLegacy: true,
          }]
        : [];

    const usable = accounts.filter((a) => a.pms_hotel_id && hasPrevioCredentials(a.credentials_secret_name));
    if (usable.length === 0) {
      return json({
        success: true,
        supported: false,
        message: `No active, credentialed Previo account is configured for ${hotelId}.`,
      });
    }

    // Organization slug for imported rows.
    let orgSlug = usable.find((a) => a.organization_slug)?.organization_slug ?? profileOrg ?? null;
    if (!orgSlug) {
      const { data: anyRoom } = await service
        .from("rooms")
        .select("organization_slug")
        .eq("hotel", hotelId)
        .not("organization_slug", "is", null)
        .limit(1)
        .maybeSingle();
      orgSlug = anyRoom?.organization_slug ?? null;
    }

    // ---- Pull the reservation window from Previo -------------------------
    const today = isoToday();
    const windowFrom = addDays(today, -daysBack);
    const windowTo = addDays(today, daysForward);

    const parsed = new Map<string, PrevioReservationRow>();
    let received = 0;
    const errors: string[] = [];
    const accountResults: Array<{ label: string; received: number; error?: string }> = [];

    for (const account of usable) {
      const creds = loadPrevioCredentials(account.credentials_secret_name);
      let accountReceived = 0;
      let accountError: string | undefined;
      for (let from = windowFrom; from < windowTo; from = addDays(from, CHUNK_DAYS)) {
        const to = addDays(from, CHUNK_DAYS) < windowTo ? addDays(from, CHUNK_DAYS) : windowTo;
        const result = await callPrevioXml({
          method: "searchReservations",
          creds,
          pmsHotelId: account.pms_hotel_id,
          extraXml: `<term><from>${from}</from><to>${to}</to></term>`,
        });
        if (!result.ok) {
          accountError = `searchReservations ${from}→${to} failed (${result.status}${result.errorMessage ? `: ${result.errorMessage}` : ""})`;
          errors.push(`${account.label}: ${accountError}`);
          break; // Do not hammer a failing account with the remaining chunks.
        }
        const rows = parsePrevioReservations(result.text);
        accountReceived += rows.length;
        for (const row of rows) {
          // Multi-account hotels: prefix the account to keep refs unique.
          const ref = usable.length > 1 ? `${account.pms_hotel_id}:${row.sourceRef}` : row.sourceRef;
          parsed.set(ref, { ...row, sourceRef: ref });
        }
      }
      received += accountReceived;
      accountResults.push({ label: account.label, received: accountReceived, error: accountError });
    }

    if (parsed.size === 0 && errors.length > 0) {
      // Total failure — log and bail without touching local rows.
      await service.from("pms_sync_history").insert({
        sync_type: "reservations",
        direction: "from_previo",
        hotel_id: hotelId,
        data: { window: { from: windowFrom, to: windowTo }, accounts: accountResults, errors },
        changed_by: userId,
        synced_by_user_id: userId,
        synced_by_name: userName,
        sync_status: "failed",
        error_message: errors.join("; ").slice(0, 900),
      });
      return json({ success: false, error: errors.join("; ") }, 502);
    }

    // ---- Room resolution maps (no guessing) -------------------------------
    const roomByPmsId = new Map<string, string>();
    if (legacyCfg?.id) {
      const { data: mappings } = await service
        .from("pms_room_mappings")
        .select("pms_room_id, hotelcare_room_id, is_active")
        .eq("pms_config_id", legacyCfg.id)
        .eq("is_active", true)
        .not("hotelcare_room_id", "is", null);
      for (const m of mappings ?? []) {
        if (m.pms_room_id && m.hotelcare_room_id) roomByPmsId.set(String(m.pms_room_id), m.hotelcare_room_id);
      }
    }
    // rooms.pms_metadata.roomId (written by the room import / unit mapping flows)
    const { data: hotelKeysData } = await service.rpc("pms_hotel_room_keys", { _hotel_id: hotelId });
    const hotelKeys: string[] = Array.isArray(hotelKeysData) && hotelKeysData.length
      ? hotelKeysData.map((k: unknown) => String(k))
      : [hotelId];
    const { data: hotelRooms } = await service
      .from("rooms")
      .select("id, room_number, pms_metadata, hotel")
      .in("hotel", hotelKeys);
    for (const room of hotelRooms ?? []) {
      const pmsRoomId = (room.pms_metadata as Record<string, unknown> | null)?.roomId;
      if (pmsRoomId != null && !roomByPmsId.has(String(pmsRoomId))) {
        roomByPmsId.set(String(pmsRoomId), room.id);
      }
    }

    // ---- Existing local rows ---------------------------------------------
    const { data: existingRows } = await service
      .from("reservations")
      .select("id, source_reservation_id, status, room_id, guest_id, total_amount, balance_due, adults, children, check_in_date, check_out_date, pms_guest_name, special_requests, currency")
      .eq("hotel_id", hotelId)
      .eq("source", "previo");
    const existingByRef = new Map(
      (existingRows ?? []).map((r: Record<string, unknown>) => [String(r.source_reservation_id), r]),
    );

    // ---- Merge + upsert -----------------------------------------------------
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let unmappedRooms = 0;
    const payload: Record<string, unknown>[] = [];

    for (const row of parsed.values()) {
      const existing = existingByRef.get(row.sourceRef) as Record<string, unknown> | undefined;
      const mappedStatus = mapPrevioStatus(row.statusId);
      const localStatus = existing ? String(existing.status) : null;
      // Never downgrade local operational states.
      const status = localStatus && ["checked_in", "checked_out"].includes(localStatus)
        ? localStatus
        : mappedStatus;

      const mappedRoom = row.objId ? roomByPmsId.get(String(row.objId)) ?? null : null;
      if (!mappedRoom && row.objId && mappedStatus === "confirmed") unmappedRooms++;
      const roomId = localStatus === "checked_in"
        ? (existing?.room_id as string | null) ?? mappedRoom
        : mappedRoom ?? ((existing?.room_id as string | null) ?? null);

      const nights = Math.max(1, row.nights);
      const total = row.totalPrice ?? (existing ? Number(existing.total_amount ?? 0) : 0);
      const previouslyPaid = existing
        ? Math.max(0, Number(existing.total_amount ?? 0) - Number(existing.balance_due ?? 0))
        : 0;
      const balance = Math.max(0, Math.round((total - previouslyPaid) * 100) / 100);

      const children = existing ? Number(existing.children ?? 0) : 0;
      const adults = Math.max(1, row.guestsCount - children);

      const record: Record<string, unknown> = {
        hotel_id: hotelId,
        organization_slug: orgSlug,
        source: "previo",
        source_reservation_id: row.sourceRef,
        check_in_date: row.arrivalDate,
        check_out_date: row.departureDate,
        status,
        adults,
        children,
        room_id: roomId,
        guest_id: (existing?.guest_id as string | null) ?? null,
        pms_guest_name: row.guestName ?? (existing?.pms_guest_name as string | null) ?? null,
        rate_per_night: Math.round((total / nights) * 100) / 100,
        total_amount: total,
        balance_due: balance,
        payment_status: balance <= 0 && total > 0 ? "paid" : (previouslyPaid > 0 ? "partial" : "unpaid"),
        special_requests: row.note ?? (existing?.special_requests as string | null) ?? null,
        updated_at: new Date().toISOString(),
      };
      if (row.currency) record.currency = row.currency;
      else if (existing?.currency) record.currency = existing.currency;
      if (status === "cancelled") record.cancelled_at = row.cancelledAtIso ?? new Date().toISOString();

      if (!existing) {
        inserted++;
        payload.push(record);
        continue;
      }
      const unchanged =
        existing.check_in_date === record.check_in_date &&
        existing.check_out_date === record.check_out_date &&
        String(existing.status) === status &&
        (existing.room_id ?? null) === roomId &&
        Number(existing.total_amount ?? 0) === total &&
        (existing.pms_guest_name ?? null) === record.pms_guest_name &&
        (existing.special_requests ?? null) === record.special_requests &&
        Number(existing.adults ?? 0) === adults;
      if (unchanged) {
        skipped++;
        continue;
      }
      updated++;
      payload.push(record);
    }

    for (let i = 0; i < payload.length; i += UPSERT_BATCH) {
      const chunk = payload.slice(i, i + UPSERT_BATCH);
      const { error } = await service
        .from("reservations")
        .upsert(chunk, { onConflict: "hotel_id,source,source_reservation_id" });
      if (error) {
        errors.push(`Upsert failed: ${error.message}`);
        break;
      }
    }

    const syncStatus = errors.length === 0 ? "success" : payload.length > 0 ? "partial" : "failed";
    const counts = {
      received,
      inserted,
      updated,
      skipped,
      unmapped_rooms: unmappedRooms,
      errors,
      window: { from: windowFrom, to: windowTo },
      accounts: accountResults,
    };

    await service.from("pms_sync_history").insert({
      sync_type: "reservations",
      direction: "from_previo",
      hotel_id: hotelId,
      data: counts,
      changed_by: userId,
      synced_by_user_id: userId,
      synced_by_name: userName,
      sync_status: syncStatus,
      error_message: errors.length ? errors.join("; ").slice(0, 900) : null,
    });
    if (legacyCfg?.id) {
      await service
        .from("pms_configurations")
        .update({ last_sync_at: new Date().toISOString() })
        .eq("id", legacyCfg.id);
    }
    for (const account of usable) {
      if (account.isLegacy) continue;
      await service
        .from("pms_accounts")
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_status: syncStatus,
          last_sync_error: errors.length ? errors.join("; ").slice(0, 500) : null,
        })
        .eq("id", account.id);
    }

    return json({ success: errors.length === 0, ...counts });
  } catch (error) {
    const message = (error as Error)?.message ?? String(error);
    console.error("previo-sync-reservations error:", message);
    try {
      await service.from("pms_sync_history").insert({
        sync_type: "reservations",
        direction: "from_previo",
        hotel_id: hotelIdForLog,
        data: { error: message },
        sync_status: "failed",
        error_message: message.slice(0, 900),
      });
    } catch (_) { /* best effort */ }
    return json({ success: false, error: message }, 500);
  }
});
