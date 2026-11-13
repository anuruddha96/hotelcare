// Previo is the reservation authority until verified two-way booking writes exist.
// Import idempotently by (hotel_id, source, source_reservation_id). Fail closed on
// incomplete upstream/local reads and report ONLY rows in successful write batches.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { callPrevioXml, hasPrevioCredentials, loadPrevioCredentials, resolvePrevioSecretName } from "../_shared/previoCredentials.ts";
import { fetchPrevioWithAuth } from "../_shared/previoAuth.ts";
import {
  addDays, buildReservationTermXml, groupGuestNames, IncomingBookingSet, isPrevioBusyResponse, isReservationOwnedByImportChunk,
  bookingsMissingFromPrevio, mapPrevioStatus, mergePrevioFinancials, mergePrevioStatus, parsePrevioReservations,
  paymentFromPrevioAccount, pmsFieldsEqual, type PrevioPaymentStatus,
  PMS_RESERVATION_COLUMNS, resolveImportTarget, type PrevioReservationRow,
} from "../_shared/previoReservations.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const roles = new Set(["admin", "manager", "reception", "front_office", "top_management", "top_management_manager"]);
const CHUNK_DAYS = 93;
const PAGE_SIZE = 500; // Below Supabase's 1,000-row default PostgREST cap.
const MAX_EXISTING = 50000;
const MAX_INCOMING = 50000;
const UPSERT_BATCH = 200;
const LOOKUP_BATCH = 100;
const BUSY_RETRY_MS = 2500;
// Columns that exist on every deployment. The pms_* columns arrive with migration
// 20261111100000; until it is applied the importer keeps working without them.
const LEGACY_SELECT = "id,source_reservation_id,status,actual_check_in,room_id,guest_id,total_amount,balance_due,payment_status,adults,children,check_in_date,check_out_date,pms_guest_name,special_requests,currency";
const EXTENDED_SELECT = `${LEGACY_SELECT},${PMS_RESERVATION_COLUMNS.join(",")}`;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// Paid amounts come from one Previo REST call per booking, so they are only
// checked where reception needs them: in house, and arrivals up to 2 days out.
const PAYMENT_CHECK_LIMIT = 40;
const PAYMENT_ARRIVAL_DAYS = 2;
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
  // Bookings set aside without failing the run (day-use, conflicting duplicates).
  let warnings: string[] = [];
  let payments: { checked: number; ok: number; failed: number; error: string | null } | null = null;
  const accountsSummary: Array<{ label: string; received: number; error?: string }> = [];
  let window: { from: string; to: string } | null = null;
  // "horizon": full stay-overlap import of the booking window (manual Sync button, scheduled refresh).
  // "incremental": only bookings changed in Previo in the last few days (scheduled every 10 minutes).
  let mode: "horizon" | "incremental" = "horizon";
  let extendedSchema = true;
  let historyWritten = false;
  const writeHistory = async (syncStatus: "success" | "partial" | "failed") => {
    if (!hotelId || historyWritten) return;
    // The reception "last import" banner reads this table. A 10-minute job must not
    // flood it or flip it to "failed" on one transient miss: an incremental run is
    // recorded only when it actually changed bookings. Its failures go to the caller.
    if (mode === "incremental" && !(syncStatus === "success" && committedInserted + committedUpdated > 0)) return;
    historyWritten = true;
    const { error } = await db.from("pms_sync_history").insert({
      hotel_id: hotelId, sync_type: "reservations", direction: "from_previo", sync_status: syncStatus,
      changed_by: userId, synced_by_user_id: userId, synced_by_name: userName,
      error_message: errors.length ? errors.join("; ").slice(0, 900) : null,
      data: { received, inserted: committedInserted, updated: committedUpdated,
        skipped, attempted, unmapped_rooms: unmappedRooms, errors, warnings, window, accounts: accountsSummary,
        payments, mode, schema_pending: !extendedSchema, completed_batches_only: true },
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
    if (!Number.isInteger(back) || back < 0 || back > 120 || !Number.isInteger(forward) || forward < 30 || forward > 540) {
      return json({ success: false, error: "Reservation window out of range" }, 400);
    }
    if (body?.mode != null && body.mode !== "horizon" && body.mode !== "incremental") {
      return json({ success: false, error: "Unknown sync mode" }, 400);
    }
    const modifiedDays = Number(body?.modifiedDays ?? 2);
    if (!Number.isInteger(modifiedDays) || modifiedDays < 1 || modifiedDays > 14) {
      return json({ success: false, error: "Modified window out of range" }, 400);
    }
    mode = body?.mode === "incremental" ? "incremental" : "horizon";
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
    window = mode === "incremental"
      ? { from: addDays(today, -modifiedDays), to: addDays(today, 1) }
      : { from: addDays(today, -back), to: addDays(today, forward) };
    // Horizon: stay-overlap search in 93-day chunks. Incremental: one "modified" search.
    const ranges: Array<{ from: string; to: string }> = [];
    if (mode === "incremental") ranges.push({ from: window.from, to: window.to });
    else for (let from = window.from; from < window.to; from = addDays(from, CHUNK_DAYS)) {
      const next = addDays(from, CHUNK_DAYS);
      ranges.push({ from, to: next < window.to ? next : window.to });
    }
    const termType = mode === "incremental" ? "modified" : "overlap";
    const incoming = new IncomingBookingSet();
    const parsed = incoming.rows;
    const accountByRef = new Map<string, Account>();
    for (const account of accounts) {
      const creds = loadPrevioCredentials(account.credentials_secret_name);
      let accountReceived = 0;
      for (const { from, to } of ranges) {
        const request = { method: "searchReservations", creds,
          pmsHotelId: account.pms_hotel_id, extraXml: buildReservationTermXml(from, to, termType) };
        let response = await callPrevioXml(request);
        // Previo refuses a call while another one on the same API key is running.
        // This is a read, so one delayed retry is safe.
        if (!response.ok && isPrevioBusyResponse(response)) {
          await sleep(BUSY_RETRY_MS);
          response = await callPrevioXml(request);
        }
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
          // Overlapping Previo searches return ongoing stays in more than one
          // chunk. Import each source booking from its arrival-owning chunk.
          // Never paper over conflicting duplicates inside a single chunk.
          // A "modified" search is not a stay-overlap search, so chunk ownership does not apply.
          if (mode === "horizon" && !isReservationOwnedByImportChunk(row.arrivalDate, from, to, from === window.from)) continue;
          // One odd booking (day-use, conflicting duplicate) is set aside and reported;
          // it no longer blocks every other booking of the hotel from updating.
          const sourceRef = row.sourceRef
            ? (accounts.length > 1 ? `${account.pms_hotel_id}:${row.sourceRef}` : row.sourceRef)
            : "";
          incoming.add(row, sourceRef);
          if (sourceRef) accountByRef.set(sourceRef, account);
          if (incoming.size > MAX_INCOMING) throw new Error("Too many Previo bookings; narrow the import window");
        }
      }
      accountsSummary.push({ label: account.label, received: accountReceived });
    }
    warnings = incoming.warnings();
    if (incoming.tooManyRejected()) {
      // Many unusable rows means the response format changed: write nothing.
      errors.push("Previo returned too many unusable bookings; nothing was imported", ...warnings);
      await writeHistory("failed");
      return json({ success: false, complete: false, inserted: 0, updated: 0, errors }, 502);
    }

    // Nothing changed in Previo since the last look: no local reads, no writes, no history row.
    if (mode === "incremental" && parsed.size === 0) {
      return json({ success: true, complete: true, status: "success", mode, inserted: 0, updated: 0,
        skipped: 0, attempted: 0, received, unmapped_rooms: 0, errors, warnings, window, accounts: accountsSummary });
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

    // Are the pms_* columns there yet? If the migration has not been applied the
    // importer must keep importing the core booking fields exactly as before.
    {
      // Probe the newest pms_* column: until every column exists, import the core fields only.
      const { error: probeError } = await db.from("reservations").select("pms_missing_since").eq("hotel_id", hotelId).limit(1);
      if (probeError) {
        if (probeError.code === "42703" || /pms_missing_since/.test(probeError.message ?? "")) extendedSchema = false;
        else throw new Error("Unable to read all existing Previo reservations");
      }
    }
    const existingSelect = extendedSchema ? EXTENDED_SELECT : LEGACY_SELECT;

    const existingByRef = new Map<string, Existing>();
    const existingByComId = new Map<string, Existing>();
    const indexComId = (row: Existing) => {
      const comId = String(row.pms_room_reservation_id ?? "").trim();
      // Two stored rows claiming one Previo room item is not safe to match on: fall back to the reference.
      if (comId) existingByComId.set(comId, existingByComId.has(comId) ? ({ ...row, ambiguous: true } as Existing) : row);
    };
    if (mode === "horizon") {
      // Never trust a single unpaginated PostgREST response: Memories already has
      // more than the default 1,000-row limit of imported reservations.
      for (let offset = 0; offset <= MAX_EXISTING; offset += PAGE_SIZE) {
        const { data, error } = await db.from("reservations")
          .select(existingSelect)
          .eq("hotel_id", hotelId).eq("source", "previo").order("id").range(offset, offset + PAGE_SIZE - 1);
        if (error || !data) throw new Error("Unable to read all existing Previo reservations");
        for (const row of data as unknown as Existing[]) {
          const ref = String(row.source_reservation_id ?? "");
          if (!ref || existingByRef.has(ref)) throw new Error("Duplicate or blank local Previo reservation reference");
          existingByRef.set(ref, row);
          indexComId(row);
        }
        if (existingByRef.size > MAX_EXISTING) throw new Error("Local reservation safety limit reached");
        if (data.length < PAGE_SIZE) break;
      }
    } else {
      // Incremental: read only the stored rows this (small) response can touch.
      const seenIds = new Set<string>();
      const remember = (rows: Existing[]) => {
        for (const row of rows) {
          const id = String(row.id ?? "");
          if (!id || seenIds.has(id)) continue;
          seenIds.add(id);
          const ref = String(row.source_reservation_id ?? "");
          if (!ref || existingByRef.has(ref)) throw new Error("Duplicate or blank local Previo reservation reference");
          existingByRef.set(ref, row);
          indexComId(row);
        }
      };
      const lookup = async (column: string, values: string[]) => {
        for (let i = 0; i < values.length; i += LOOKUP_BATCH) {
          const { data, error } = await db.from("reservations").select(existingSelect)
            .eq("hotel_id", hotelId).eq("source", "previo").in(column, values.slice(i, i + LOOKUP_BATCH)).limit(1000);
          if (error || !data || data.length >= 1000) throw new Error("Unable to read all existing Previo reservations");
          remember(data as unknown as Existing[]);
        }
      };
      await lookup("source_reservation_id", [...parsed.keys()]);
      if (extendedSchema) {
        const comIds = [...new Set([...parsed.values()].map(row => row.comId).filter((id): id is string => !!id))];
        await lookup("pms_room_reservation_id", comIds);
      }
    }
    for (const [comId, row] of existingByComId) if (row.ambiguous) existingByComId.delete(comId);

    // Paid amounts (full imports only). Best effort: a failed check changes nothing,
    // and the last payment state Previo reported is kept until a new check replaces it.
    const paymentByResKey = new Map<string, { total: number; paid: number; status: PrevioPaymentStatus; rooms: number }>();
    const paymentStats = { checked: 0, ok: 0, failed: 0, error: null as string | null };
    const resKey = (ref: string, resId: string) => `${accountByRef.get(ref)?.pms_hotel_id ?? ""}:${resId}`;
    if (mode === "horizon" && extendedSchema) {
      const soon = addDays(today, PAYMENT_ARRIVAL_DAYS);
      const groups = new Map<string, { account: Account; resId: string; rooms: number; arrival: string }>();
      for (const [ref, row] of parsed) {
        const live = ["pending", "confirmed", "checked_in"].includes(mapPrevioStatus(row.statusId));
        if (!live || row.arrivalDate > soon || row.departureDate <= today) continue;
        const account = accountByRef.get(ref);
        if (!account) continue;
        const key = resKey(ref, row.resId);
        const group = groups.get(key);
        if (group) group.rooms++;
        else groups.set(key, { account, resId: row.resId, rooms: 1, arrival: row.arrivalDate });
      }
      let consecutiveFailures = 0;
      const ordered = [...groups].sort((a, b) => a[1].arrival.localeCompare(b[1].arrival)).slice(0, PAYMENT_CHECK_LIMIT);
      for (const [key, group] of ordered) {
        if (consecutiveFailures >= 3) break; // endpoint unavailable for this account: stop asking
        paymentStats.checked++;
        try {
          const { response } = await fetchPrevioWithAuth({
            credentialsSecretName: group.account.credentials_secret_name,
            path: `/rest/account?resId=${encodeURIComponent(group.resId)}`,
            pmsHotelId: group.account.pms_hotel_id,
          });
          if (!response.ok) { await response.text().catch(() => ""); throw new Error(`HTTP ${response.status}`); }
          const contentType = response.headers.get("content-type") ?? "";
          const text = await response.text();
          if (!contentType.toLowerCase().includes("json")) throw new Error("non-JSON response");
          const payment = paymentFromPrevioAccount(JSON.parse(text));
          if (!payment) throw new Error("unrecognised account format");
          paymentByResKey.set(key, { ...payment, rooms: group.rooms });
          paymentStats.ok++;
          consecutiveFailures = 0;
        } catch (error) {
          paymentStats.failed++;
          consecutiveFailures++;
          // Category only: never copy a response body (guest data) into the sync history.
          const message = errorMessage(error);
          paymentStats.error ??= /^HTTP \d+$|^non-JSON response$|^unrecognised account format$/.test(message) ? message
            : /authentication/i.test(message) ? "authentication failed" : "request failed";
        }
      }
    }

    const payload: Array<{ record: Record<string, unknown>; kind: "insert" | "update" }> = [];
    const statusEvents: Array<Record<string, unknown>> = [];
    const usedRefs = new Set<string>();
    const guestNameByResId = groupGuestNames(parsed.values());
    for (const row of parsed.values()) {
      const target = resolveImportTarget(row, existingByComId, existingByRef);
      const existing = target.existing;
      if (usedRefs.has(target.sourceRef)) {
        // Two room items resolving to one stored row would overwrite each other. Keep the first; report the rest.
        errors.push("Previo returned room items that map to the same stored booking; one was skipped");
        skipped++;
        continue;
      }
      usedRefs.add(target.sourceRef);
      const mappedStatus = mapPrevioStatus(row.statusId);
      const localStatus = existing ? String(existing.status) : null;
      // Previo is the authority, but a check-in/out done in HotelCare is never changed by an import.
      const status = mergePrevioStatus(localStatus, row.statusId, existing?.actual_check_in != null);
      const mappedRoom = row.objId ? roomByPmsId.get(String(row.objId)) ?? null : null;
      if (!mappedRoom && row.objId && mappedStatus === "confirmed") unmappedRooms++;
      const roomId = localStatus === "checked_in" ? (existing?.room_id as string | null) ?? mappedRoom
        : mappedRoom ?? ((existing?.room_id as string | null) ?? null);
      const nights = Math.max(1, row.nights);
      const total = row.totalPrice ?? (existing ? Number(existing.total_amount ?? 0) : 0);
      // Payment: this run's account check, else the search response, else the last known Previo state.
      const check = paymentByResKey.get(resKey(row.sourceRef, row.resId));
      const storedPayment = (existing?.pms_payment_status as PrevioPaymentStatus | null | undefined) ?? null;
      const paymentStatus: PrevioPaymentStatus | null = check?.status ?? row.paymentStatus ?? storedPayment;
      // A group account covers all its rooms; the per-room split is unknown, so only a
      // single-room booking gets an exact paid amount.
      const paidAmount = check
        ? (check.rooms === 1 ? check.paid : null)
        : ((existing?.pms_paid_amount as number | string | null | undefined) ?? null);
      const money = mergePrevioFinancials({
        total, paymentStatus, previoPaidAmount: paidAmount == null ? null : Number(paidAmount),
        existingTotal: existing ? Number(existing.total_amount ?? 0) : null,
        existingBalance: existing ? Number(existing.balance_due ?? 0) : null,
        existingPmsPaymentStatus: storedPayment,
        existingPmsPaidAmount: (existing?.pms_paid_amount as number | string | null | undefined) ?? null,
      });
      const balance = money.balance;
      const children = existing ? Number(existing.children ?? 0) : 0;
      const adults = Math.max(1, row.guestsCount - children);
      // Guest label, real data only: this room's guest, else the group's guest
      // (Previo lists guests on one room of a group), else what is stored, else the booker.
      const guestLabel = row.guestName ?? guestNameByResId.get(row.resId)
        ?? (existing?.pms_guest_name as string | null) ?? row.contactName ?? null;
      const record: Record<string, unknown> = {
        hotel_id: hotelId, organization_slug: org, source: "previo", source_reservation_id: target.sourceRef,
        check_in_date: row.arrivalDate, check_out_date: row.departureDate, status, adults, children,
        room_id: roomId, guest_id: (existing?.guest_id as string | null) ?? null,
        pms_guest_name: guestLabel,
        rate_per_night: Math.round(total / nights * 100) / 100, total_amount: total, balance_due: balance,
        payment_status: money.paymentStatus,
        special_requests: row.note ?? (existing?.special_requests as string | null) ?? null,
        updated_at: new Date().toISOString(),
      };
      if (extendedSchema) {
        // Every record carries every pms_* key so a batch upsert never nulls a column by omission.
        const keep = (value: unknown, column: string) => value ?? existing?.[column] ?? null;
        Object.assign(record, {
          pms_reservation_id: row.resId,
          pms_room_reservation_id: keep(row.comId, "pms_room_reservation_id"),
          pms_voucher: keep(row.voucher, "pms_voucher"),
          pms_status_id: row.statusId > 0 ? row.statusId : keep(null, "pms_status_id"),
          pms_payment_status: paymentStatus,
          pms_paid_amount: paidAmount == null ? null : Number(paidAmount),
          // Returned by Previo in this run: visible on the plan again if it was hidden.
          pms_missing_since: null,
          pms_channel: keep(row.channel, "pms_channel"),
          pms_channel_id: keep(row.channelId, "pms_channel_id"),
          pms_rate_plan_id: keep(row.ratePlanId, "pms_rate_plan_id"),
          pms_option_expires_at: mappedStatus === "pending" ? row.optionExpiresAtIso : null,
          pms_locked: row.locked,
          pms_group_note: row.groupNote,
          pms_contact_name: keep(row.contactName, "pms_contact_name"),
          pms_contact_email: keep(row.contactEmail, "pms_contact_email"),
          pms_contact_phone: keep(row.contactPhone, "pms_contact_phone"),
        });
      }
      if (row.currency) record.currency = row.currency;
      else if (existing?.currency) record.currency = existing.currency;
      if (status === "cancelled") record.cancelled_at = row.cancelledAtIso ?? new Date().toISOString();
      if (!existing) { payload.push({ record, kind: "insert" }); continue; }
      const unchanged = existing.check_in_date === record.check_in_date && existing.check_out_date === record.check_out_date
        && String(existing.status) === status && (existing.room_id ?? null) === roomId
        && Number(existing.total_amount ?? 0) === total && (existing.pms_guest_name ?? null) === record.pms_guest_name
        && (existing.special_requests ?? null) === record.special_requests && Number(existing.adults ?? 0) === adults
        && Number(existing.balance_due ?? 0) === balance && (existing.payment_status ?? null) === money.paymentStatus
        && (!extendedSchema || pmsFieldsEqual(existing, record));
      if (unchanged) { skipped++; continue; }
      if (localStatus !== status && existing.id) statusEvents.push({
        reservation_id: existing.id, hotel_id: hotelId, organization_slug: org, event_type: "pms_status_sync",
        metadata: { from: localStatus, to: status, previo_status_id: row.statusId, source: "previo-sync-reservations", mode },
      });
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
    // Audit trail for status changes that came from Previo. Best effort: only after every
    // batch was written, and a failed audit insert never fails the import.
    if (status === "success" && statusEvents.length) {
      for (let i = 0; i < statusEvents.length; i += UPSERT_BATCH) {
        const { error } = await db.from("reservation_events").insert(statusEvents.slice(i, i + UPSERT_BATCH));
        if (error) { console.error("Previo status audit insert failed", error.code); break; }
      }
    }
    // Bookings Previo no longer returns (cancelled/deleted, or stored under an older
    // room reference): hidden from the plan, never deleted. Full imports only.
    let hidden = 0;
    if (mode === "horizon" && status === "success" && extendedSchema && window) {
      const missing = bookingsMissingFromPrevio({
        stored: existingByRef.values(), returnedRefs: usedRefs,
        setAsideRefs: new Set(incoming.rejected.map(r => r.ref)), window, incomingCount: parsed.size,
      });
      if (missing === null) {
        warnings.push("Many stored bookings were not returned by Previo; none were hidden. Check the import.");
      } else if (missing.length) {
        const stamp = new Date().toISOString();
        const ids = missing.map(row => String(row.id)).filter(Boolean);
        for (let i = 0; i < ids.length; i += UPSERT_BATCH) {
          const { error } = await db.from("reservations").update({ pms_missing_since: stamp })
            .eq("hotel_id", hotelId).eq("source", "previo").is("pms_missing_since", null).in("id", ids.slice(i, i + UPSERT_BATCH));
          if (error) { warnings.push("Could not hide bookings that are no longer in Previo"); break; }
          hidden += Math.min(UPSERT_BATCH, ids.length - i);
        }
        if (hidden) warnings.push(`${hidden} booking(s) no longer returned by Previo were hidden from the plan`);
      }
    }
    if (paymentStats.checked && paymentStats.failed) {
      warnings.push(`Paid amounts: ${paymentStats.ok} of ${paymentStats.checked} checks succeeded (${paymentStats.error ?? "error"})`);
    }
    payments = paymentStats;
    await writeHistory(status);
    if (mode === "incremental") {
      // last_sync_at keeps meaning "last full import"; an incremental run does not move it.
    } else if (status === "success") {
      const timestamp = new Date().toISOString();
      if (legacy?.id) await db.from("pms_configurations").update({ last_sync_at: timestamp }).eq("id", legacy.id);
      for (const account of accounts) if (!account.isLegacy) await db.from("pms_accounts")
        .update({ last_sync_at: timestamp, last_sync_status: status, last_sync_error: null }).eq("id", account.id);
    } else for (const account of accounts) if (!account.isLegacy) await db.from("pms_accounts")
      .update({ last_sync_status: status, last_sync_error: errors.join("; ").slice(0, 500) }).eq("id", account.id);
    return json({ success: status === "success", complete: status === "success", status,
      inserted: committedInserted, updated: committedUpdated, skipped, attempted,
      received, unmapped_rooms: unmappedRooms, errors, warnings, window, accounts: accountsSummary,
      payments, hidden, mode, schema_pending: !extendedSchema }, status === "failed" ? 502 : 200);
  } catch (error) {
    errors.push(errorMessage(error));
    await writeHistory(committedInserted + committedUpdated > 0 ? "partial" : "failed");
    console.error("Previo reservation import failed", error instanceof Error ? error.name : "unknown");
    return json({ success: false, complete: false, inserted: committedInserted,
      updated: committedUpdated, received, errors: ["Reservation import incomplete; inspect sync history"],
      status: committedInserted + committedUpdated ? "partial" : "failed" }, 500);
  }
});