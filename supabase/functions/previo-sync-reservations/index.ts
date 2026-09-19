// Previo is the reservation authority until verified two-way booking writes exist.
// Import idempotently by (hotel_id, source, source_reservation_id). Fail closed on
// incomplete upstream/local reads and report ONLY rows in successful write batches.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { callPrevioXml, hasPrevioCredentials, loadPrevioCredentials, resolvePrevioSecretName } from "../_shared/previoCredentials.ts";
import { addDays, mapPrevioStatus, parsePrevioReservations, type PrevioReservationRow } from "../_shared/previoReservations.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const roles = new Set(["admin", "manager", "reception", "front_office", "top_management", "top_management_manager"]);
const CHUNK_DAYS = 93;
const PAGE_SIZE = 500; // Below Supabase's 1,000-row default PostgREST cap.
const MAX_EXISTING = 50000;
const MAX_INCOMING = 50000;
const UPSERT_BATCH = 200;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const errorMessage = (value: unknown) => value instanceof Error ? value.message : String(value);
function hotelToday() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (key: string) => parts.find(p => p.type === key)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

type Account = { id: string; label: string; pms_hotel_id: string; credentials_secret_name: string | null; organization_slug?: string | null; isLegacy?: boolean };
type Existing = Record<string, unknown>;

serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "POST required" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ success: false, error: "Server configuration unavailable" }, 503);
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  let hotelId: string | null = null;
  let userId: string | null = null;
  let userName: string | null = null;
  let received = 0;
  let committedInserted = 0;
  let committedUpdated = 0;
  let skipped = 0;
  let unmappedRooms = 0;
  let attempted = 0;
  const errors: string[] = [];
  const accountsSummary: Array<{ label: string; received: number; error?: string }> = [];
  let window: { from: string; to: string } | null = null;
  let historyWritten = false;
  const writeHistory = async (syncStatus: "success" | "partial" | "failed") => {
    if (!hotelId || historyWritten) return;
    historyWritten = true;
    const { error } = await db.from("pms_sync_history").insert({
      hotel_id: hotelId, sync_type: "reservations", direction: "from_previo", sync_status: syncStatus,
      changed_by: userId, synced_by_user_id: userId, synced_by_name: userName,
      error_message: errors.length ? errors.join("; ").slice(0, 900) : null,
      data: { received, inserted: committedInserted, updated: committedUpdated,
        skipped, attempted, unmapped_rooms: unmappedRooms, errors, window, accounts: accountsSummary,
        completed_batches_only: true },
    });
    if (error) console.error("Previo reservation sync history write failed", error.code);
  };
  try {
    const body = await req.json().catch(() => ({}));
    const requestedId = String(body?.hotelId ?? "").trim();
    if (!requestedId || requestedId.length > 100) return json({ success: false, error: "Canonical hotel ID required" }, 400);
    const { data: canonical, error: canonicalError } = await db.from("hotel_configurations")
      .select("hotel_id").eq("hotel_id", requestedId).maybeSingle();
    if (canonicalError) return json({ success: false, error: "Cannot resolve property" }, 503);
    if (canonical?.hotel_id) hotelId = canonical.hotel_id;
    else {
      const { data: alias, error: aliasError } = await db.from("hotel_configurations")
        .select("hotel_id").eq("hotel_name", requestedId).maybeSingle();
      if (aliasError || !alias?.hotel_id) return json({ success: false, error: "Unrecognized or ambiguous property" }, 400);
      hotelId = alias.hotel_id;
    }

    const back = Number(body?.daysBack ?? 7);
    const forward = Number(body?.daysForward ?? 365);
    if (!Number.isInteger(back) || back < 0 || back > 60 || !Number.isInteger(forward) || forward < 30 || forward > 540) {
      return json({ success: false, error: "Reservation window out of range" }, 400);
    }
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    let org: string | null = null;
    if (token !== serviceKey) {
      const { data: current, error: authError } = await db.auth.getUser(token);
      if (authError || !current.user) return json({ success: false, error: "Unauthorized" }, 401);
      userId = current.user.id;
      const { data: profile, error: profileError } = await db.from("profiles")
        .select("role, organization_slug, is_super_admin, full_name").eq("id", userId).maybeSingle();
      if (profileError || !profile || (!profile.is_super_admin && !roles.has(profile.role))) {
        return json({ success: false, error: "Forbidden" }, 403);
      }
      org = profile.organization_slug ?? null;
      userName = profile.full_name ?? null;
      const { data: allowed, error: accessError } = await db.rpc("can_access_pms_hotel",
        { _uid: userId, _hotel_id: hotelId, _org_slug: org });
      if (accessError || (profile.is_super_admin !== true && allowed !== true)) {
        return json({ success: false, error: "Forbidden for this property" }, 403);
      }
    } else if (!token) return json({ success: false, error: "Unauthorized" }, 401);

    const [{ data: legacy, error: legacyError }, { data: portfolio, error: accountsError }] = await Promise.all([
      db.from("pms_configurations").select("id,hotel_id,pms_hotel_id,credentials_secret_name,is_active")
        .eq("hotel_id", hotelId).eq("pms_type", "previo").maybeSingle(),
      db.from("pms_accounts").select("id,hotel_id,organization_slug,label,pms_hotel_id,credentials_secret_name,is_active")
        .eq("hotel_id", hotelId).eq("pms_type", "previo").eq("is_active", true),
    ]);
    if (legacyError || accountsError) throw new Error("Cannot verify property-specific Previo configuration");
    const accounts: Account[] = (portfolio?.length ? portfolio.map(a => ({
      id: String(a.id), label: String(a.label || a.pms_hotel_id), pms_hotel_id: String(a.pms_hotel_id || ""),
      credentials_secret_name: resolvePrevioSecretName(a.credentials_secret_name), organization_slug: a.organization_slug,
    })) : legacy?.is_active ? [{ id: String(legacy.id), label: String(legacy.pms_hotel_id),
      pms_hotel_id: String(legacy.pms_hotel_id || ""), credentials_secret_name: legacy.credentials_secret_name, isLegacy: true }] : []);
    if (!accounts.length || accounts.length > 8 || accounts.some(a => !a.pms_hotel_id || !hasPrevioCredentials(a.credentials_secret_name))) {
      return json({ success: false, supported: false, error: "Active, fully credentialed Previo account required" }, 409);
    }
    const pmsIds = accounts.map(a => a.pms_hotel_id);
    if (new Set(pmsIds).size !== pmsIds.length) throw new Error("Duplicate Previo hotel IDs: refusing ambiguous import");
    org = accounts.find(a => a.organization_slug)?.organization_slug ?? org;
    if (!org) {
      const { data: sampleRoom, error: orgError } = await db.from("rooms")
        .select("organization_slug").eq("hotel", hotelId).not("organization_slug", "is", null).limit(1).maybeSingle();
      if (orgError) throw new Error("Unable to resolve property organization");
      org = sampleRoom?.organization_slug ?? null;
    }

    const today = hotelToday();
    window = { from: addDays(today, -back), to: addDays(today, forward) };
    const parsed = new Map<string, PrevioReservationRow>();
    for (const account of accounts) {
      const creds = loadPrevioCredentials(account.credentials_secret_name);
      let accountReceived = 0;
      for (let from = window.from; from < window.to; from = addDays(from, CHUNK_DAYS)) {
        const next = addDays(from, CHUNK_DAYS);
        const to = next < window.to ? next : window.to;
        const response = await callPrevioXml({ method: "searchReservations", creds,
          pmsHotelId: account.pms_hotel_id, extraXml: `<term><from>${from}</from><to>${to}</to></term>` });
        if (!response.ok) {
          errors.push(`${account.label}: Previo reservation read failed for ${from}–${to} (HTTP ${response.status})`);
          accountsSummary.push({ label: account.label, received: accountReceived, error: "Incomplete upstream read" });
          await writeHistory("failed");
          return json({ success: false, complete: false, inserted: 0, updated: 0, errors }, 502);
        }
        const rows = parsePrevioReservations(response.text);
        accountReceived += rows.length;
        received += rows.length;
        for (const row of rows) {
          if (row.arrivalDate >= row.departureDate || !row.sourceRef) {
            errors.push("Previo returned an invalid reservation date or reference");
            await writeHistory("failed");
            return json({ success: false, complete: false, inserted: 0, updated: 0, errors }, 502);
          }
          const sourceRef = accounts.length > 1 ? `${account.pms_hotel_id}:${row.sourceRef}` : row.sourceRef;
          const old = parsed.get(sourceRef);
          if (old && JSON.stringify(old) !== JSON.stringify({ ...row, sourceRef })) {
            errors.push("Previo returned inconsistent duplicate booking references");
            await writeHistory("failed");
            return json({ success: false, complete: false, inserted: 0, updated: 0, errors }, 502);
          }
          parsed.set(sourceRef, { ...row, sourceRef });
          if (parsed.size > MAX_INCOMING) throw new Error("Too many Previo bookings; narrow the import window");
        }
      }
      accountsSummary.push({ label: account.label, received: accountReceived });
    }

    const roomByPmsId = new Map<string, string>();
    const ambiguousRooms = new Set<string>();
    const mapRoom = (pmsId: unknown, roomId: unknown) => {
      const external = String(pmsId ?? "").trim();
      const local = String(roomId ?? "").trim();
      if (!external || !local) return;
      const old = roomByPmsId.get(external);
      if (old && old !== local) ambiguousRooms.add(external);
      else roomByPmsId.set(external, local);
    };
    if (legacy?.id) {
      const { data: mappings, error } = await db.from("pms_room_mappings")
        .select("pms_room_id,hotelcare_room_id").eq("pms_config_id", legacy.id).eq("is_active", true)
        .not("hotelcare_room_id", "is", null).limit(2000);
      if (error || !mappings || mappings.length === 2000) throw new Error("Room mappings cannot be read completely");
      for (const mapping of mappings) mapRoom(mapping.pms_room_id, mapping.hotelcare_room_id);
    }
    const { data: aliases, error: aliasError } = await db.rpc("pms_hotel_room_keys", { _hotel_id: hotelId });
    if (aliasError) throw new Error("Hotel room aliases cannot be verified");
    const roomKeys = Array.isArray(aliases) && aliases.length ? aliases.map(String) : [hotelId];
    const { data: rooms, error: roomsError } = await db.from("rooms")
      .select("id,pms_metadata,hotel").in("hotel", roomKeys).limit(2001);
    if (roomsError || !rooms || rooms.length > 2000) throw new Error("Hotel room inventory is incomplete");
    const validRoomIds = new Set(rooms.map(r => String(r.id)));
    for (const room of rooms) mapRoom((room.pms_metadata as Record<string, unknown> | null)?.roomId, room.id);
    for (const external of ambiguousRooms) roomByPmsId.delete(external);
    for (const [external, local] of roomByPmsId) if (!validRoomIds.has(local)) roomByPmsId.delete(external);

    // Never trust a single unpaginated PostgREST response: Memories already has
    // more than the default 1,000-row limit of imported reservations.
    const existingByRef = new Map<string, Existing>();
    for (let offset = 0; offset <= MAX_EXISTING; offset += PAGE_SIZE) {
      const { data, error } = await db.from("reservations")
        .select("id,source_reservation_id,status,room_id,guest_id,total_amount,balance_due,adults,children,check_in_date,check_out_date,pms_guest_name,special_requests,currency")
        .eq("hotel_id", hotelId).eq("source", "previo").order("id").range(offset, offset + PAGE_SIZE - 1);
      if (error || !data) throw new Error("Unable to read all existing Previo reservations");
      for (const row of data) {
        const ref = String(row.source_reservation_id ?? "");
        if (!ref || existingByRef.has(ref)) throw new Error("Duplicate or blank local Previo reservation reference");
        existingByRef.set(ref, row as Existing);
      }
      if (existingByRef.size > MAX_EXISTING) throw new Error("Local reservation safety limit reached");
      if (data.length < PAGE_SIZE) break;
    }

    const payload: Array<{ record: Record<string, unknown>; kind: "insert" | "update" }> = [];
    for (const row of parsed.values()) {
      const existing = existingByRef.get(row.sourceRef);
      const mappedStatus = mapPrevioStatus(row.statusId);
      const localStatus = existing ? String(existing.status) : null;
      const status = localStatus && ["checked_in", "checked_out"].includes(localStatus) ? localStatus : mappedStatus;
      const mappedRoom = row.objId ? roomByPmsId.get(String(row.objId)) ?? null : null;
      if (!mappedRoom && row.objId && mappedStatus === "confirmed") unmappedRooms++;
      const roomId = localStatus === "checked_in" ? (existing?.room_id as string | null) ?? mappedRoom
        : mappedRoom ?? ((existing?.room_id as string | null) ?? null);
      const nights = Math.max(1, row.nights);
      const total = row.totalPrice ?? (existing ? Number(existing.total_amount ?? 0) : 0);
      const previouslyPaid = existing ? Math.max(0, Number(existing.total_amount ?? 0) - Number(existing.balance_due ?? 0)) : 0;
      const balance = Math.max(0, Math.round((total - previouslyPaid) * 100) / 100);
      const children = existing ? Number(existing.children ?? 0) : 0;
      const adults = Math.max(1, row.guestsCount - children);
      const record: Record<string, unknown> = {
        hotel_id: hotelId, organization_slug: org, source: "previo", source_reservation_id: row.sourceRef,
        check_in_date: row.arrivalDate, check_out_date: row.departureDate, status, adults, children,
        room_id: roomId, guest_id: (existing?.guest_id as string | null) ?? null,
        pms_guest_name: row.guestName ?? (existing?.pms_guest_name as string | null) ?? null,
        rate_per_night: Math.round(total / nights * 100) / 100, total_amount: total, balance_due: balance,
        payment_status: balance <= 0 && total > 0 ? "paid" : previouslyPaid > 0 ? "partial" : "unpaid",
        special_requests: row.note ?? (existing?.special_requests as string | null) ?? null,
        updated_at: new Date().toISOString(),
      };
      if (row.currency) record.currency = row.currency;
      else if (existing?.currency) record.currency = existing.currency;
      if (status === "cancelled") record.cancelled_at = row.cancelledAtIso ?? new Date().toISOString();
      if (!existing) { payload.push({ record, kind: "insert" }); continue; }
      const unchanged = existing.check_in_date === record.check_in_date && existing.check_out_date === record.check_out_date
        && String(existing.status) === status && (existing.room_id ?? null) === roomId
        && Number(existing.total_amount ?? 0) === total && (existing.pms_guest_name ?? null) === record.pms_guest_name
        && (existing.special_requests ?? null) === record.special_requests && Number(existing.adults ?? 0) === adults;
      if (unchanged) { skipped++; continue; }
      payload.push({ record, kind: "update" });
    }

    attempted = payload.length;
    for (let i = 0; i < payload.length; i += UPSERT_BATCH) {
      const chunk = payload.slice(i, i + UPSERT_BATCH);
      const { error } = await db.from("reservations")
        .upsert(chunk.map(item => item.record), { onConflict: "hotel_id,source,source_reservation_id" });
      if (error) {
        errors.push(`Import batch ${Math.floor(i / UPSERT_BATCH) + 1} failed (${error.code || "database error"}); remaining batches skipped`);
        break;
      }
      // A single PostgREST upsert is atomic; only advance counters after success.
      for (const item of chunk) if (item.kind === "insert") committedInserted++; else committedUpdated++;
    }
    const committed = committedInserted + committedUpdated;
    const status = errors.length ? committed ? "partial" : "failed" : "success";
    await writeHistory(status);
    if (status === "success") {
      const timestamp = new Date().toISOString();
      if (legacy?.id) await db.from("pms_configurations").update({ last_sync_at: timestamp }).eq("id", legacy.id);
      for (const account of accounts) if (!account.isLegacy) await db.from("pms_accounts")
        .update({ last_sync_at: timestamp, last_sync_status: status, last_sync_error: null }).eq("id", account.id);
    } else for (const account of accounts) if (!account.isLegacy) await db.from("pms_accounts")
      .update({ last_sync_status: status, last_sync_error: errors.join("; ").slice(0, 500) }).eq("id", account.id);
    return json({ success: status === "success", complete: status === "success", status,
      inserted: committedInserted, updated: committedUpdated, skipped, attempted,
      received, unmapped_rooms: unmappedRooms, errors, window, accounts: accountsSummary }, status === "failed" ? 502 : 200);
  } catch (error) {
    errors.push(errorMessage(error));
    await writeHistory(committedInserted + committedUpdated > 0 ? "partial" : "failed");
    console.error("Previo reservation import failed", error instanceof Error ? error.name : "unknown");
    return json({ success: false, complete: false, inserted: committedInserted,
      updated: committedUpdated, received, errors: ["Reservation import incomplete; inspect sync history"],
      status: committedInserted + committedUpdated ? "partial" : "failed" }, 500);
  }
});