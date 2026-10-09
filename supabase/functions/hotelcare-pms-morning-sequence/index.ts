// One real PMS refresh per property/account per Budapest working day. The cron
// invokes this endpoint once per ten minutes; no browser session is needed.
// Existing independent checkout polling, revenue and release preflights stay intact.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const RD_ORDER = ["memories-budapest", "mika-downtown", "ottofiori", "gozsdu-court"];
const ADMIN_ALERT_EMAIL = "anuruddha.dharmasena@gmail.com";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" },
});
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
function equal(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
function localClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (name: string) => parts.find(p => p.type === name)?.value || "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")), minute: Number(part("minute")),
  };
}
function orderedHotels(configs: Array<{ hotel_id: string }>) {
  return [...configs].sort((a, b) => {
    const ai = RD_ORDER.indexOf(a.hotel_id), bi = RD_ORDER.indexOf(b.hotel_id);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.hotel_id.localeCompare(b.hotel_id);
  });
}
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] || ch));
}
async function sendPmsFailureAlert(target: string, businessDate: string, failure: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.error(`[PMS alert] RESEND_API_KEY missing; could not alert ${ADMIN_ALERT_EMAIL}`);
    return;
  }
  let from = "HotelCare PMS Monitor <onboarding@resend.dev>";
  try {
    const domainsResponse = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10000),
    });
    if (domainsResponse.ok) {
      const parsed = await domainsResponse.json().catch(() => ({}));
      const verified = Array.isArray(parsed?.data)
        ? parsed.data.find((domain: any) => String(domain?.status || "").toLowerCase() === "verified" && domain?.name)
        : null;
      if (verified?.name) from = `HotelCare PMS Monitor <noreply@${verified.name}>`;
    }
  } catch (error) {
    console.error("[PMS alert] verified-domain lookup failed", error);
  }
  const subject = `[HotelCare] PMS sync failed: ${target}`;
  const safeTarget = escapeHtml(target);
  const safeFailure = escapeHtml(failure);
  const html = `<h2>HotelCare PMS synchronization failed</h2><p><strong>Target:</strong> ${safeTarget}</p><p><strong>Business date:</strong> ${businessDate}</p><p><strong>Error:</strong></p><pre>${safeFailure}</pre><p>Please check HotelCare PMS Sync Status and Previo connectivity.</p>`;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to: [ADMIN_ALERT_EMAIL], subject, html }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) console.error(`[PMS alert] Resend ${response.status}: ${await response.text()}`);
  } catch (error) {
    console.error("[PMS alert] send failed", error);
  }
}
async function callEdge(url: string, serviceKey: string, name: string, payload: Record<string, unknown>, secret?: string) {
  const response = await fetch(`${url}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`, ...(secret ? { "x-worker-secret": secret } : {}) },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(90000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false || body.error || body.result?.ok === false) {
    throw new Error(`${name}: ${body.error || body.result?.error || `HTTP ${response.status}`}`);
  }
  return body;
}

// The existing server room preflight refreshes Previo's physical room statuses.
// The manual PMS button also refreshes checkout/daily classification; do this
// only after a fresh authoritative date-specific reservation snapshot passes.
async function syncStandardHotel(admin: any, url: string, service: string, secret: string, hotelId: string, date: string) {
  const ottofiori = hotelId === "ottofiori";
  const nextDate = new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  await callEdge(url, service, "housekeeping-pms-preflight-worker", { mode: "sync_hotel", hotel_id: hotelId }, secret);
  const overview = await callEdge(url, service, "previo-sync-daily-overview", {
    hotelId, fromDate: date, days: 2,
  });
  if (overview.supported !== true || overview.rowsInserted <= 0) {
    throw new Error(`${hotelId}: authoritative Previo reservations were not refreshed`);
  }
  const { data: configurations, error: configError } = await admin.from("pms_configurations")
    .select("id").eq("hotel_id", hotelId).eq("is_active", true).eq("sync_enabled", true).eq("pms_type", "previo");
  if (configError || configurations?.length !== 1) throw new Error(`${hotelId}: PMS configuration is missing or ambiguous`);
  const [mappingResponse, snapshotsResponse, tomorrowResponse] = await Promise.all([
    admin.from("pms_room_mappings").select("hotelcare_room_id,pms_room_name")
      .eq("pms_config_id", configurations[0].id).eq("is_active", true),
    admin.from("daily_overview_snapshots")
      .select("id,room_label,status,arrival_date,departure_date,pax,captured_at")
      .eq("hotel_id", hotelId).eq("business_date", date).eq("source", "previo"),
    ottofiori
      ? admin.from("daily_overview_snapshots")
          .select("room_label,status,arrival_date,departure_date,pax,captured_at")
          .eq("hotel_id", hotelId).eq("business_date", nextDate).eq("source", "previo")
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  if (mappingResponse.error || snapshotsResponse.error || tomorrowResponse.error) {
    throw new Error(`${hotelId}: mapped reservation lookup failed`);
  }
  const mappings = mappingResponse.data || [], snapshots = snapshotsResponse.data || [];
  if (!mappings.length || !snapshots.length) throw new Error(`${hotelId}: room mappings or reservations are empty`);
  const gozsdu = hotelId === "gozsdu-court";
  // Gozsdu can legitimately have a same-day arrival or a confirmed no-show
  // absent from the occupied-night manifest. Only fresh room metadata from the
  // Previo preflight is allowed to bridge that gap; unknown rooms still fail closed.
  const mappedRoomIds = mappings.map((m: any) => String(m.hotelcare_room_id || "")).filter(Boolean);
  const gozsduRoomsResponse = gozsdu
    ? await admin.from("rooms")
        .select("id,pms_metadata,is_checkout_room,guest_count,guest_nights_stayed")
        .in("id", mappedRoomIds)
    : { data: [] as any[], error: null };
  if (gozsduRoomsResponse.error) throw new Error("gozsdu-court: current PMS room state lookup failed");
  const gozsduRoomById = new Map((gozsduRoomsResponse.data || []).map((r: any) => [String(r.id), r]));
  if (ottofiori && snapshots.length < 15) throw new Error("ottofiori: incomplete reservation snapshot; classifications unchanged");
  const byName = new Map<string, any>();
  for (const row of snapshots) {
    const key = String(row.room_label || "").trim().toLowerCase();
    if (!key || byName.has(key)) throw new Error(`${hotelId}: duplicate or blank PMS reservation room label`);
    byName.set(key, row);
  }
  const nextArrivals = new Map<string, any>();
  if (ottofiori) for (const row of (tomorrowResponse.data || [])) {
    const key = String(row.room_label || "").trim().toLowerCase();
    if (row.arrival_date === date && row.departure_date > date && key) {
      if (nextArrivals.has(key)) throw new Error("ottofiori: ambiguous next-arrival reservation; no classifications changed");
      nextArrivals.set(key, row);
    }
  }
  const pairs: Array<{ id: string; snapshot: any | null; incoming: any | null; rehydratedArrival?: boolean; rehydratedNoShow?: boolean }> = [];
  const usedRoomIds = new Set<string>();
  const usedSnapshots = new Set<string>();
  const rehydratedGozsduRooms: string[] = [];
  const rehydratedNoShowRooms: string[] = [];
  for (const mapping of mappings) {
    const roomId = String(mapping.hotelcare_room_id || "");
    const key = String(mapping.pms_room_name || "").trim().toLowerCase();
    const snapshot = byName.get(key);
    if (!roomId || usedRoomIds.has(roomId) || (snapshot && usedSnapshots.has(String(snapshot.id)))) {
      throw new Error(`${hotelId}: incomplete or ambiguous mapping; no checkout/daily classifications changed`);
    }
    let rehydratedArrival = false;
    let rehydratedNoShow = false;
    if (!snapshot && gozsdu) {
      const current: any = gozsduRoomById.get(roomId);
      const meta = current?.pms_metadata && typeof current.pms_metadata === "object" ? current.pms_metadata : {};
      const availability = meta.gozsduAvailability && typeof meta.gozsduAvailability === "object" ? meta.gozsduAvailability : {};
      const currentDate = String(meta.pmsSyncDate || meta.lastPmsRefreshDate || "").slice(0, 10);
      const mappedName = String(mapping.pms_room_name || "").trim().toLowerCase();
      const liveName = String(availability.pmsRoomName || "").trim().toLowerCase();
      const statusId = Number(meta.reservationStatusId);
      const sameMappedOperatingRoom = currentDate === date
        && availability.status === "operating"
        && !!mappedName && liveName === mappedName;
      rehydratedNoShow = sameMappedOperatingRoom
        && (meta.isNoShow === true || statusId === 8)
        && meta.isCancelled !== true
        && meta.occupiedToday !== true
        && meta.checkedOutToday !== true;
      rehydratedArrival = !rehydratedNoShow
        && sameMappedOperatingRoom
        && meta.arrivalToday === true
        && Number.isFinite(statusId)
        && ![7, 8, 9].includes(statusId)
        && meta.isCancelled !== true
        && meta.isNoShow !== true
        && meta.checkedOutToday !== true
        && meta.scheduledDepartureToday !== true;
      if (rehydratedArrival) rehydratedGozsduRooms.push(String(mapping.pms_room_name || roomId));
      if (rehydratedNoShow) rehydratedNoShowRooms.push(String(mapping.pms_room_name || roomId));
    }
    if (!snapshot && !ottofiori && !rehydratedArrival && !rehydratedNoShow) {
      throw new Error(`${hotelId}: incomplete or ambiguous mapping; no checkout/daily classifications changed`);
    }
    if (snapshot && snapshot.status !== "departing" && snapshot.status !== "ongoing") {
      throw new Error(`${hotelId}: reservation state is not authoritative; classifications unchanged`);
    }
    usedRoomIds.add(roomId);
    if (snapshot) usedSnapshots.add(String(snapshot.id));
    pairs.push({ id: roomId, snapshot: snapshot || null, incoming: ottofiori ? (nextArrivals.get(key) || null) : null, rehydratedArrival, rehydratedNoShow });
  }
  const { data: rooms, error: roomsError } = await admin.from("rooms")
    .select("id,pms_metadata,is_checkout_room,guest_count,guest_nights_stayed")
    .in("id", [...usedRoomIds]);
  if (roomsError || rooms?.length !== pairs.length) throw new Error(`${hotelId}: mapped HotelCare inventory does not match Previo`);
  const roomById = new Map(rooms.map((r: any) => [String(r.id), r]));
  const syncedAt = new Date().toISOString();
  let checkout = 0, daily = 0, overridden = 0, reconciledArrivals = 0, skippedUnknown = 0, noShows = 0;
  for (const pair of pairs) {
    const room: any = roomById.get(pair.id);
    const s = pair.snapshot;
    const old = room.pms_metadata && typeof room.pms_metadata === "object" ? room.pms_metadata : {};
    const metadata: Record<string, any> = { ...old };
    const previousDate = String(old.lastPmsRefreshDate || old.pmsSyncDate || "").slice(0, 10);
    if (previousDate && previousDate < date) {
      for (const field of ["manual_checkout", "manual_daily", "manual_no_show", "manual_checkout_at", "manual_daily_at", "manual_moved_at", "manual_checkout_by", "manual_daily_by", "manual_moved_by"]) delete metadata[field];
    }
    const overrideDate = String(old.manual_moved_at || old.manual_checkout_changed_at || old.manual_daily_changed_at || old.manual_checkout_at || old.manual_daily_at || "").slice(0, 10);
    const manual = overrideDate === date;
    metadata.pmsSyncDate = date;
    metadata.lastPmsRefreshDate = date;
    metadata.lastServerMorningSyncAt = syncedAt;
    metadata.lastServerMorningSyncSource = "portfolio_morning_10min";

    if (gozsdu && pair.rehydratedNoShow && !s) {
      metadata.scheduledDepartureToday = false;
      metadata.checkedOutToday = false;
      metadata.isNoShow = true;
      metadata.notArrived = true;
      metadata.occupiedToday = false;
      metadata.stayThroughToday = false;
      const { error: noShowError } = await admin.from("rooms").update({
        is_checkout_room: false, pms_metadata: metadata, updated_at: syncedAt,
      }).eq("id", pair.id);
      if (noShowError) throw new Error(`gozsdu-court: no-show rehydration failed: ${noShowError.message}`);
      noShows++;
      continue;
    }

    if (gozsdu && pair.rehydratedArrival && !s) {
      // A new arrival may not yet exist in the occupied-night manifest. Preserve
      // whether it is still waiting or has already checked in; either way it is
      // an arrival, never yesterday's checkout/daily cleaning task.
      metadata.scheduledDepartureToday = false;
      metadata.checkedOutToday = false;
      metadata.arrivalToday = true;
      metadata.notArrived = old.notArrived === true;
      metadata.occupiedToday = old.occupiedToday === true;
      metadata.stayThroughToday = old.occupiedToday === true;
      const { error: arrivalError } = await admin.from("rooms").update({
        is_checkout_room: false, pms_metadata: metadata, updated_at: syncedAt,
      }).eq("id", pair.id);
      if (arrivalError) throw new Error(`gozsdu-court: arrival rehydration failed: ${arrivalError.message}`);
      daily++;
      continue;
    }

    if (ottofiori && !s) {
      const confirmedCheckout = previousDate === date && old.checkedOutToday === true;
      if ((manual && old.manual_checkout === true) || confirmedCheckout) {
        checkout++; if (manual) overridden++; skippedUnknown++; continue;
      }
      if (manual && (old.manual_daily === true || old.manual_checkout === false)) overridden++;
      const incoming = pair.incoming;
      const noShowOrNotArrived = old.isNoShow === true || old.manual_no_show === true
        || (old.notArrived === true && old.occupiedToday !== true);
      if (!incoming && !noShowOrNotArrived && !manual) {
        skippedUnknown++;
        if (room.is_checkout_room) checkout++; else daily++;
        continue;
      }
      metadata.scheduledDepartureToday = false;
      metadata.scheduledDepartureTomorrow = incoming?.departure_date === nextDate;
      metadata.stayThroughToday = !!incoming;
      metadata.checkedOutToday = false;
      if (incoming) {
        metadata.arrivalDate = incoming.arrival_date;
        metadata.departureDate = incoming.departure_date;
        metadata.arrivalToday = true;
        metadata.notArrived = old.occupiedToday !== true;
        metadata.occupiedToday = old.occupiedToday === true;
        if (old.manual_no_show !== true) metadata.isNoShow = false;
        reconciledArrivals++;
      } else {
        metadata.arrivalToday = false;
      }
      const { error: missingError } = await admin.from("rooms").update({
        is_checkout_room: false,
        guest_count: incoming?.pax ?? room.guest_count,
        guest_nights_stayed: incoming ? 1 : room.guest_nights_stayed,
        pms_metadata: metadata, updated_at: syncedAt,
      }).eq("id", pair.id);
      if (missingError) throw new Error(`ottofiori: no-show/arrival reconciliation failed: ${missingError.message}`);
      daily++;
      continue;
    }

    const departing = s.status === "departing" && s.departure_date === date;
    const unarrivedPriorStay = ottofiori && old.notArrived === true
      && old.occupiedToday !== true && old.checkedOutToday !== true;
    const noShowPriorStay = ottofiori && old.isNoShow === true && old.checkedOutToday !== true;
    const effectiveCheckout = manual && (old.manual_daily === true || old.manual_checkout === false)
      ? false : manual && old.manual_checkout === true ? true
      : departing && !unarrivedPriorStay && !noShowPriorStay;
    if (manual) overridden++;
    if (effectiveCheckout) checkout++; else daily++;
    metadata.scheduledDepartureToday = ottofiori ? effectiveCheckout : departing;
    metadata.scheduledDepartureTomorrow = s.departure_date > date && s.departure_date <= nextDate;
    metadata.arrivalDate = s.arrival_date;
    metadata.departureDate = s.departure_date;
    metadata.occupiedToday = ottofiori ? old.occupiedToday === true : true;
    metadata.stayThroughToday = ottofiori ? !effectiveCheckout : !departing;
    if (ottofiori && s.arrival_date !== old.arrivalDate && old.manual_no_show !== true) {
      metadata.isNoShow = false;
      metadata.notArrived = s.arrival_date === date && old.occupiedToday !== true;
    }
    const start = s.arrival_date ? Date.parse(`${s.arrival_date}T12:00:00Z`) : NaN;
    const night = Number.isFinite(start) ? Math.max(1, Math.floor((Date.parse(`${date}T12:00:00Z`) - start) / 86400000) + 1) : room.guest_nights_stayed;
    const { error: updateError } = await admin.from("rooms").update({
      is_checkout_room: effectiveCheckout, guest_count: s.pax ?? room.guest_count,
      guest_nights_stayed: night, pms_metadata: metadata, updated_at: syncedAt,
    }).eq("id", pair.id);
    if (updateError) throw new Error(`${hotelId}: mapped room update failed: ${updateError.message}`);
  }
  const unmatchedSnapshots = snapshots.length - usedSnapshots.size;
  const status = unmatchedSnapshots || skippedUnknown ? "partial" : "success";
  const { error: historyError } = await admin.from("pms_sync_history").insert({
    hotel_id: hotelId, sync_type: "rooms_refresh", direction: "from_previo", sync_status: status,
    error_message: unmatchedSnapshots ? `${unmatchedSnapshots} Previo reservation room(s) lack an active mapped physical room`
      : skippedUnknown ? `${skippedUnknown} room(s) have no authoritative stay; classification preserved` : null,
    data: { trigger: "portfolio_morning_10min", business_date: date,
      rooms_updated: pairs.length - skippedUnknown, checkout_rooms: checkout, daily_rooms: daily,
      manager_overrides_preserved: overridden, unmapped_reservation_rooms: unmatchedSnapshots,
      expected_mapped_rooms: mappings.length, snapshot_rooms: snapshots.length,
      rehydrated_rooms: rehydratedGozsduRooms, rehydrated_no_show_rooms: rehydratedNoShowRooms,
      no_show_rooms: noShows, unresolved_rooms: 0,
      ...(ottofiori ? { ottofiori_no_show_arrivals_reconciled: reconciledArrivals, unknown_rooms_preserved: skippedUnknown } : {}) },
  });
  if (historyError) throw new Error(`${hotelId}: PMS history write failed: ${historyError.message}`);
  return { rooms_updated: pairs.length - skippedUnknown, checkout_rooms: checkout, daily_rooms: daily,
    unmapped_reservation_rooms: unmatchedSnapshots,
    expected_mapped_rooms: mappings.length, snapshot_rooms: snapshots.length,
    rehydrated_rooms: rehydratedGozsduRooms, rehydrated_no_show_rooms: rehydratedNoShowRooms,
    no_show_rooms: noShows, unresolved_rooms: 0, status,
    ...(ottofiori ? { ottofiori_no_show_arrivals_reconciled: reconciledArrivals, unknown_rooms_preserved: skippedUnknown } : {}) };
}

Deno.serve(async req => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const expected = await admin.rpc("get_housekeeping_release_worker_secret");
  if (expected.error || !equal(req.headers.get("x-worker-secret") || "", String(expected.data || ""))) {
    return json({ error: "Unauthorized" }, 401);
  }
  const clock = localClock();
  const payload = await req.json().catch(() => ({}));
  // Both scheduled and manually requested queued runs reach the SAME
  // authoritative server refresh implementation. The queue exclusively
  // selects a running job; no user may choose an arbitrary account here.
  const { data: queueSettings, error: queueSettingsError } = await admin
    .from("pms_refresh_queue_settings").select("enabled").eq("id",true).maybeSingle();
  const queueEnabled = !queueSettingsError && queueSettings?.enabled === true;
  if (payload.mode === "queue_execute") {
    if (!queueEnabled) return json({ error:"PMS queue is not enabled" },409);
    if (!/^[0-9a-f-]{36}$/i.test(String(payload.job_id || ""))) {
      return json({ error:"Invalid queue job identifier" },400);
    }
    const { data:job, error: jobError } = await admin.from("pms_refresh_jobs")
      .select("id,target_key,account_id,hotel_id,organization_slug,status,attempts,business_date,lease_expires_at")
      .eq("id",payload.job_id).maybeSingle();
    if (jobError || !job || job.status !== "running"
        || job.target_key !== payload.target_key
        || job.business_date !== clock.date
        || job.business_date !== payload.business_date
        || Number(job.attempts) !== Number(payload.attempt)
        || new Date(job.lease_expires_at).getTime() <= Date.now()) {
      return json({ error:"PMS queue job is not active for this business date" },409);
    }
    try {
      let result: any;
      if (job.account_id) {
        const { data:acc, error:accError } = await admin.from("pms_accounts")
          .select("id,hotel_id,organization_slug,pms_type,is_active,sync_paused")
          .eq("id",job.account_id).maybeSingle();
        if (accError || !acc || acc.organization_slug !== "slnt" || acc.id !== job.target_key.slice(8)
            || acc.hotel_id !== job.hotel_id
            || acc.organization_slug !== job.organization_slug
            || acc.pms_type !== "previo" || !acc.is_active || acc.sync_paused) {
          throw new Error("Queued PMS account no longer matches active configuration");
        }
        result = await callEdge(url,service,"slnt-pms-morning-sync",
          { mode:"sync_account",account_id:acc.id },String(expected.data));
      } else {
        if (job.target_key !== "hotel:" + job.hotel_id) {
          throw new Error("Queued PMS hotel key does not match target");
        }
        const { data:config, error:configError } = await admin.from("pms_configurations")
          .select("hotel_id").eq("hotel_id",job.hotel_id).eq("pms_type","previo")
          .eq("is_active",true).eq("sync_enabled",true);
        if (configError || config?.length !== 1) {
          throw new Error("Queued PMS hotel is no longer active");
        }
        result = await syncStandardHotel(admin,url,service,String(expected.data),
          job.hotel_id,clock.date);
      }
      return json({ ok:true, status:result?.status === "partial" ? "partial":"success",result });
    } catch (error) {
      return json({ok:false,error:message(error)},500);
    }
  }
  // A single explicit cutover disables this legacy tick, preventing two
  // independent daily schedulers after queue activation.
  if (queueEnabled) return json({ ok:true,skipped:true,reason:"queue_controls_morning_sequence" });
  if (clock.hour < 6 || clock.hour > 8 || clock.minute % 10 !== 0) {
    return json({ ok: true, skipped: true, reason: "outside_Budapest_10min_window" });
  }
  const [configsRes, accountsRes] = await Promise.all([
    admin.from("pms_configurations").select("hotel_id").eq("pms_type", "previo")
      .eq("is_active", true).eq("sync_enabled", true),
    admin.from("pms_accounts").select("id,label,hotel_id,organization_slug")
      .eq("organization_slug", "slnt").eq("pms_type", "previo")
      .eq("is_active", true).eq("sync_paused", false).order("label", { ascending: true }),
  ]);
  if (configsRes.error || accountsRes.error) {
    const failure = `Unable to load PMS synchronization schedule: ${configsRes.error?.message || accountsRes.error?.message || "unknown database error"}`;
    await sendPmsFailureAlert("PMS schedule", clock.date, failure);
    return json({ ok: false, error: failure }, 500);
  }
  const accounts = accountsRes.data || [];
  const accountHotels = new Set(accounts.map((a: any) => a.hotel_id));
  const hotels = orderedHotels((configsRes.data || []).filter((c: any) => !accountHotels.has(c.hotel_id)));
  const targets = [
    ...hotels.map(h => ({ type: "hotel", key: `hotel:${h.hotel_id}`, label: h.hotel_id, hotel_id: h.hotel_id, account_id: null as string | null })),
    ...accounts.map((a: any) => ({ type: "account", key: `account:${a.id}`, label: a.label, hotel_id: a.hotel_id, account_id: String(a.id) })),
  ];
  const slot = (clock.hour - 6) * 6 + Math.floor(clock.minute / 10);
  const target = targets[slot];
  if (!target) return json({ ok: true, skipped: true, reason: "no_active_target_for_slot", slot });
  // Fail closed if another automatic full refresh is already in progress.
  // This is an interim guard; the durable manual-priority queue is tracked in #568.
  const { data: activeRuns, error: activeError } = await admin
    .from("pms_morning_sync_runs")
    .select("target_key,started_at")
    .eq("status", "running")
    .gte("started_at", new Date(Date.now() - 15 * 60_000).toISOString())
    .limit(1);
  if (activeError) return json({ ok: false, error: "Unable to verify active PMS refreshes" }, 503);
  if ((activeRuns || []).length > 0) {
    return json({ ok: true, skipped: true, reason: "another_auto_refresh_running",
      blocked_by: activeRuns![0].target_key, target: target.label });
  }
  const startedAt = new Date().toISOString();
  const claimed = await admin.from("pms_morning_sync_runs").insert({
    business_date: clock.date, target_key: target.key, slot, status: "running", started_at: startedAt,
  });
  if (claimed.error?.code === "23505") return json({ ok: true, skipped: true, reason: "already_attempted_today", target: target.label });
  if (claimed.error) {
    const failure = `PMS run claim failed: ${claimed.error.message}`;
    await sendPmsFailureAlert(target.label, clock.date, failure);
    return json({ ok: false, error: failure }, 500);
  }
  try {
    const result = target.type === "hotel"
      ? await syncStandardHotel(admin, url, service, String(expected.data), target.hotel_id, clock.date)
      : await callEdge(url, service, "slnt-pms-morning-sync", { mode: "sync_account", account_id: target.account_id }, String(expected.data));
    const status = (result as any).status === "partial" ? "partial" : "success";
    const updated = await admin.from("pms_morning_sync_runs").update({
      status, completed_at: new Date().toISOString(), result,
    }).eq("business_date", clock.date).eq("target_key", target.key);
    if (updated.error) throw new Error(`PMS run audit failed: ${updated.error.message}`);
    return json({ ok: true, business_date: clock.date, slot, target: target.label, status, result });
  } catch (error) {
    const failure = message(error);
    console.error(`[PMS morning sequence] ${target.key}: ${failure}`);
    await admin.from("pms_morning_sync_runs").update({
      status: "failed", completed_at: new Date().toISOString(), error_message: failure,
    }).eq("business_date", clock.date).eq("target_key", target.key);
    await admin.from("pms_sync_history").insert({
      hotel_id: target.hotel_id, sync_type: "rooms_refresh", direction: "from_previo",
      sync_status: "failed", error_message: failure,
      data: { trigger: "portfolio_morning_10min", business_date: clock.date,
        account_id: target.account_id, scheduled_slot: slot },
    });
    await sendPmsFailureAlert(target.label, clock.date, failure);
    return json({ ok: false, target: target.label, error: failure }, 500);
  }
});