// Push minimum-stay rules and "rooms to sell" (inventory) to Previo.
//
// The rate calendar edits these the same way it edits a price: the change is
// saved in Hotel Care first (min stay in `min_stay_rules`), then sent to Previo
// over the same EQC channel the prices use. Nothing is silent — every item
// comes back with its own result so the grid can show what landed.

import { createClient } from "npm:@supabase/supabase-js@2";
import { loadPrevioCredentials, hasPrevioCredentials } from "../_shared/previoCredentials.ts";
import { writePrevioInventory, writePrevioRestrictions } from "../_shared/previoRateWrite.ts";
import { syncPrevioRatePlanMappings } from "../_shared/previoRatePlans.ts";
import { callPrevioXml } from "../_shared/previoCredentials.ts";
import { parsePrevioReservations } from "../_shared/previoReservations.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PUSH_ROLES = ["admin", "top_management", "top_management_manager"];
const isDate = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ""));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function restApiKey(creds: any): string {
  if (!creds) return "";
  if (creds.protocol === "xml") return String(creds.apiKey ?? "").trim();
  return String(creds.apiKey ?? creds.password ?? "").trim();
}

/** Read Previo native rooms-for-sale for one room type/date. */
async function readPrevioAvailability(opts: {
  creds: any;
  pmsHotelId: string;
  date: string;
  obkId: string;
}): Promise<{ value: number | null; error: string | null }> {
  const key = restApiKey(opts.creds);
  if (!key) return { value: null, error: "No REST API key available for availability verification." };
  const params = new URLSearchParams({
    filterFrom: opts.date,
    filterTo: addDaysIso(opts.date, 1),
    includeOfflineRooms: "true",
  });
  params.append("roomKindIds[]", opts.obkId);
  try {
    const response = await fetch(`https://api.previo.app/rest/calendar/availability?${params.toString()}`, {
      headers: {
        Authorization: `ApiKey ${key}`,
        "X-Previo-Hotel-Id": opts.pmsHotelId,
        "X-Previo-Language-ID": "2",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    if (!response.ok) return { value: null, error: `Previo availability read failed [${response.status}] ${text.slice(0, 180)}` };
    const parsed = JSON.parse(text);
    const plans = Array.isArray(parsed) ? parsed : [parsed];
    for (const plan of plans) {
      for (const day of (Array.isArray(plan?.availability) ? plan.availability : [])) {
        if (String(day?.date ?? "").slice(0, 10) !== opts.date) continue;
        for (const room of (Array.isArray(day?.roomKinds) ? day.roomKinds : [])) {
          const id = room?.id ?? room?.roomKindId;
          const value = Number(room?.availability);
          if (String(id) === String(opts.obkId) && Number.isFinite(value)) {
            return { value: Math.max(0, Math.trunc(value)), error: null };
          }
        }
      }
    }
    return { value: null, error: "Previo did not return availability for this room type/date." };
  } catch (e) {
    return { value: null, error: e instanceof Error ? e.message : String(e) };
  }
}
interface Item {
  /** Stay date (start of the range when `to` is given). */
  date: string;
  /** Optional last date of an inclusive range — bulk min-stay changes use it. */
  to?: string | null;

  /** Minimum nights for that date (house-wide when no room type is given). */
  minStay?: number | null;
  /** Rooms to sell for one room type on that date. */
  roomsToSell?: number | null;
  /** Previo room type id (`<hotId>:<obkId>` on multi-account properties). */
  obkId?: string | null;
  /** Room type label, for the response and audit text. */
  roomTypeName?: string | null;
  /** Optional, audited, capacity-neutral physical upgrade from another category. */
  upgradeFromObkId?: string | null;
  upgradeFromRoomTypeName?: string | null;
  upgradeMode?: "exclusive_transfer" | "shared_pool";
}

/**
 * Prevent independent positive room-type edits from inventing sellable rooms.
 * Requires a fresh inventory snapshot for every real product and a booking
 * count. If Previo hasn't synced, fail closed rather than guess.
 */
/**
 * A normal availability edit concerns ONE physical room category. A hotel-wide
 * sum of Previo offers cannot enforce this safely: live cross-category linked
 * offers are duplicated by design, while cached booking-night counts may lag.
 * Verify the actual room kind's booked inventory against fresh Previo bookings.
 * Category-to-category borrowing must use the separate audited upgrade flow.
 */
async function checkUnlinkedInventoryIncrease(
  creds: any, pmsHotelId: string, stayDate: string,
  targetObkId: string, physicalRooms: number, newTarget: number,
): Promise<string | null> {
  const response = await callPrevioXml({
    method: "searchReservations", creds, pmsHotelId,
    extraXml: "<term><from>" + stayDate + "</from><to>" +
      addDaysIso(stayDate, 1) + "</to></term>",
  });
  if (!response.ok) {
    return "Could not verify current reservations in Previo. Refresh PMS and retry before opening rooms.";
  }
  const confirmed = parsePrevioReservations(response.text).filter(r =>
    r.arrivalDate <= stayDate && r.departureDate > stayDate &&
    (r.statusId === 2 || r.statusId === 3)
  );
  const bookedInKind = new Set(confirmed.filter(r => String(r.obkId) === targetObkId)
    .map(r => r.sourceRef)).size;
  const availablePhysical = Math.max(0, physicalRooms - bookedInKind);
  if (newTarget > availablePhysical) {
    return "Only " + availablePhysical + " unbooked physical room(s) remain in this category. " +
      "Choose a higher category under 'Offer a free upgrade' for extra sellable stock.";
  }
  return null;
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
      .from("profiles").select("role, assigned_hotel, organization_slug, full_name, nickname, email").eq("id", user.id).maybeSingle();
    if (!profile || !PUSH_ROLES.includes(String((profile as any).role))) {
      return json({ ok: false, error: "You do not have permission to change availability or stay rules." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const hotelId: string | null = typeof body.hotelId === "string" ? body.hotelId : null;
    const items: Item[] = Array.isArray(body.items) ? body.items.slice(0, 400) : [];
    if (!hotelId) return json({ ok: false, error: "hotelId is required" }, 400);
    if (!items.length) return json({ ok: false, error: "Nothing to send." }, 400);

    // Managers with portfolio access can switch HotelCare properties. Use the
    // same authoritative hotel-access RPC as the rate publisher instead of the
    // profile's default/assigned hotel, which is only a login preference.
    const { data: canAccess, error: accessError } = await admin.rpc("user_can_access_hotel", {
      _uid: user.id,
      _hotel_id: hotelId,
    });
    if (accessError) {
      console.error("minimum-stay access check failed", accessError);
      return json({ ok: false, error: "Hotel access could not be verified." }, 403);
    }
    if (!canAccess) return json({ ok: false, error: "You cannot change stay rules for this property." }, 403);

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

    const needsMinStayMapping = clean.some((item) => item.minStay !== undefined && item.minStay !== null);
    const loadMaps = async () => {
      const { data } = await admin
        .from("previo_rate_plan_mapping")
        .select("previo_rate_plan_id, previo_room_type_id, is_default")
        .eq("hotel_id", hotelId);
      return ((data ?? []) as any[]).filter((m) => m.previo_rate_plan_id && m.previo_room_type_id);
    };
    let maps: any[] = [];
    if (needsMinStayMapping) {
      maps = await loadMaps();
      if (maps.length === 0) {
        await syncPrevioRatePlanMappings(admin, hotelId);
        maps = await loadMaps();
      }
      if (maps.length === 0) {
        return json({ ok: false, code: "no_mapping", error: "No Previo pricelist is mapped for this property yet." });
      }
    }
    const defaultMap = maps.find((m: any) => m.is_default) ?? maps[0] ?? null;

    const { data: orgRow } = await admin
      .from("room_types").select("organization_slug").eq("hotel_id", hotelId).limit(1).maybeSingle();
    const orgSlug = (orgRow as any)?.organization_slug ?? (profile as any).organization_slug ?? null;

    /** Resolve the Previo account + ids for a minimum-stay item. */
    const resolve = (obkRaw: string | null | undefined) => {
      const map: any = maps.find((m: any) => String(m.previo_room_type_id) === String(obkRaw)) ?? defaultMap;
      if (!map) return null;
      const scoped = String(map.previo_room_type_id ?? obkRaw ?? "");
      const parts = scoped.split(":");
      const obkId = parts.pop() as string;
      const account = (parts.length ? accounts.get(parts.join(":")) : null) ?? fallback!;
      return { obkId, prlId: String(map.previo_rate_plan_id), account };
    };

    /**
     * Inventory is room-type level and does not need a rate-plan mapping.
     * Never fall back to another room type: a typo/missing id must fail rather
     * than changing availability on the wrong product.
     */
    const resolveInventory = (obkRaw: string | null | undefined) => {
      const scoped = String(obkRaw ?? "").trim();
      if (!scoped) return null;
      const parts = scoped.split(":");
      const obkId = parts.pop() as string;
      const account = (parts.length ? accounts.get(parts.join(":")) : null) ?? fallback;
      if (!account || !obkId) return null;
      return { scopedObkId: scoped, obkId, account };
    };

    const results: Array<{ date: string; roomTypeName?: string | null; ok: boolean; message: string }> = [];
    let sent = 0;
    let failed = 0;

    for (const item of clean) {
      const wantsMinStay = item.minStay !== undefined && item.minStay !== null;
      const wantsInventory = item.roomsToSell !== undefined && item.roomsToSell !== null;
      if (!wantsMinStay && !wantsInventory) continue;

      const rangeTo = isDate(item.to) && String(item.to) >= item.date ? String(item.to) : item.date;
      let allOk = true;
      let lastMessage = "Success";
      let previousAvailability: number | null = null;
      let actualAvailability: number | null = null;

      if (wantsInventory) {
        const requested = Number(item.roomsToSell);
        const rooms = Math.trunc(requested);
        const resolved = resolveInventory(item.obkId);
        if (!Number.isFinite(requested) || requested < 0 || requested !== rooms) {
          allOk = false;
          lastMessage = "Rooms to sell must be a non-negative whole number.";
        } else if (!resolved) {
          allOk = false;
          lastMessage = "This room type is not mapped to a Previo room kind.";
        } else {
          const { data: roomRow } = await admin
            .from("room_types")
            .select("num_rooms")
            .eq("hotel_id", hotelId)
            .eq("pms_room_id", resolved.scopedObkId)
            .maybeSingle();
          const physicalRooms = Number((roomRow as any)?.num_rooms ?? 0);
          if (!physicalRooms || rooms > physicalRooms) {
            allOk = false;
            lastMessage = physicalRooms
              ? `Rooms to sell cannot exceed the ${physicalRooms} physical room${physicalRooms === 1 ? "" : "s"} in this room type.`
              : "Hotel Care could not verify the physical inventory for this room type.";
          } else {
            // An upgrade moves an existing physical unit; it must not invent a room.
            // Sharing the *same* unit simultaneously between independent OTA room
            // types is not safe until channel-side atomic pooling is certified.
            const upgrade = item.upgradeFromObkId ? resolveInventory(item.upgradeFromObkId) : null;
            if (item.upgradeFromObkId && (
              !upgrade || upgrade.scopedObkId === resolved.scopedObkId ||
              upgrade.account.hotId !== resolved.account.hotId
            )) {
              allOk = false;
              lastMessage = "Choose another valid room type at the same Previo property for the free upgrade.";
            }
            if (item.upgradeFromObkId && item.upgradeMode !== "exclusive_transfer") {
              allOk = false;
              lastMessage = "Keeping both listings open requires verified linked-channel inventory. Choose the safe transfer option for now.";
            }
            let transferred: { before: number; obkId: string; account: Account } | null = null;
            let transferRuleId: string | null = null;
            let leaseOwner: string | null = null;
            if (allOk) {
              // Serialize standard adjustments and room transfers for the same
              // property/date, so concurrent managers cannot both publish a
              // positive change against the same remaining physical capacity.
              leaseOwner = crypto.randomUUID();
              const lock = await admin.rpc("claim_room_sale_upgrade_lock", {
                p_hotel_id: hotelId, p_stay_date: item.date, p_owner: leaseOwner,
              });
              if (lock.error || lock.data !== true) {
                allOk = false;
                lastMessage = "Another inventory change is in progress for this date. Please try again.";
              }
            }
            try {
              if (allOk && upgrade) {
                const sourceType = await admin.from("room_types")
                  .select("name,is_sellable,counts_toward_inventory,num_rooms")
                  .eq("hotel_id", hotelId).eq("pms_room_id", upgrade.scopedObkId).maybeSingle();
                const beforeSource = await readPrevioAvailability({
                  creds: upgrade.account.creds,
                  pmsHotelId: upgrade.account.hotId, date: item.date, obkId: upgrade.obkId,
                });
                const beforeTarget = await readPrevioAvailability({
                  creds: resolved.account.creds,
                  pmsHotelId: resolved.account.hotId, date: item.date, obkId: resolved.obkId,
                });
                previousAvailability = beforeTarget.value;
                const additional = beforeTarget.value === null ? 0 : rooms - beforeTarget.value;
                // A complimentary upgrade must accommodate every guest
                // permitted in the booked category. Never infer capacity from
                // a translated room-type name.
                const [{ data: sourceRate }, { data: targetRate }] = await Promise.all([
                  admin.from("revenue_room_type_rates").select("occupancy")
                    .eq("hotel_id", hotelId).eq("obk_id", upgrade.scopedObkId)
                    .order("occupancy", { ascending: false }).limit(1).maybeSingle(),
                  admin.from("revenue_room_type_rates").select("occupancy")
                    .eq("hotel_id", hotelId).eq("obk_id", resolved.scopedObkId)
                    .order("occupancy", { ascending: false }).limit(1).maybeSingle(),
                ]);
                const sourceMaxGuests = Number(sourceRate?.occupancy ?? 0);
                const targetMaxGuests = Number(targetRate?.occupancy ?? 0);
                if (sourceMaxGuests < 1 || targetMaxGuests < 1 || sourceMaxGuests < targetMaxGuests) {
                  allOk = false;
                  lastMessage = "Upgrade not saved: guest capacity could not be verified or the replacement room is too small.";
                } else if (sourceType.error || !sourceType.data ||
                    sourceType.data.is_sellable === false || sourceType.data.counts_toward_inventory === false ||
                    beforeSource.value === null || beforeTarget.value === null ||
                    additional < 1 || beforeSource.value < additional || additional > 20) {
                  allOk = false;
                  lastMessage = "Upgrade not saved: the source room is no longer available or the counts changed. Refresh and try again.";
                } else {
                  const { data: physicalRows } = await admin.from("room_types")
                    .select("num_rooms").eq("hotel_id", hotelId)
                    .eq("is_sellable", true).eq("counts_toward_inventory", true);
                  const physicalCapacity = (physicalRows ?? []).reduce((sum: number, r: any) => sum + (Number(r.num_rooms) || 0), 0);
                  if (physicalCapacity < 1 || physicalCapacity > 10000) {
                    allOk = false;
                    lastMessage = "Could not verify the property's physical-room capacity.";
                  } else {
                    const { count: booked, error: bookedError } = await admin.from("revenue_booking_nights")
                      .select("id", { count: "exact", head: true })
                      .eq("hotel_id", hotelId).eq("stay_date", item.date).in("status_id", [2, 3]);
                    if (bookedError || (booked ?? 0) > physicalCapacity) {
                      allOk = false;
                      lastMessage = "The booked-room count could not be safely reconciled. Nothing was changed.";
                    } else {
                      const { data: rule, error: ruleError } = await admin.from("room_sale_upgrade_rules")
                        .upsert({
                          hotel_id: hotelId, organization_slug: orgSlug,
                          stay_date: item.date,
                          source_obk_id: upgrade.scopedObkId,
                          target_obk_id: resolved.scopedObkId,
                          source_room_type_name: sourceType.data.name,
                          target_room_type_name: item.roomTypeName ?? resolved.scopedObkId,
                          unit_count: additional,
                          sell_mode: "exclusive_transfer",
                          close_trigger: "linked_booking",
                          status: "pending",
                          actual_source_before: beforeSource.value,
                          actual_target_before: beforeTarget.value,
                          physical_capacity: physicalCapacity,
                          booked_at_creation: booked ?? 0,
                          notify_mode: "admin_test",
                          created_by: user.id,
                          updated_at: new Date().toISOString(),
                        }, { onConflict: "hotel_id,stay_date,source_obk_id,target_obk_id" })
                        .select("id").single();
                      if (ruleError || !rule?.id) {
                        allOk = false;
                        lastMessage = "Could not record a safe upgrade allocation. No inventory was changed.";
                      } else {
                        transferRuleId = rule.id;
                        // The original room category is reduced FIRST, protecting
                        // against total property inventory increasing mid-transfer.
                        const sourceNew = beforeSource.value - additional;
                        const sourceWrite = await writePrevioInventory({
                          creds: upgrade.account.creds, pmsHotelId: upgrade.account.hotId,
                          target: { obkId: upgrade.obkId, from: item.date, to: item.date, roomsToSell: sourceNew },
                        });
                        const sourceRead = sourceWrite.ok ? await readPrevioAvailability({
                          creds: upgrade.account.creds, pmsHotelId: upgrade.account.hotId,
                          date: item.date, obkId: upgrade.obkId,
                        }) : { value: null };
                        if (!sourceWrite.ok || sourceRead.value !== sourceNew) {
                          allOk = false;
                          lastMessage = "Previo did not confirm the source category's closure. Target inventory remains unchanged.";
                          await admin.from("room_sale_upgrade_rules").update({
                            status: "needs_review", last_error: lastMessage,
                          }).eq("id", transferRuleId);
                        } else {
                          transferred = { before: beforeSource.value, obkId: upgrade.obkId, account: upgrade.account };
                        }
                      }
                    }
                  }
                }
              }
              if (allOk) {
                const before = await readPrevioAvailability({
                  creds: resolved.account.creds,
                  pmsHotelId: resolved.account.hotId,
              date: item.date,
              obkId: resolved.obkId,
            });
            previousAvailability = before.value;
            // The independent inventory editor must not overwrite one side of
            // an active linked-room watch. Those two category counts represent
            // the same physical inventory until the watch is resolved.
            const { data: linkedWatches, error: watchError } = !upgrade
              ? await admin.from("room_sale_overnight_watches")
                  .select("first_obk_id,second_obk_id")
                  .eq("hotel_id", hotelId).eq("stay_date", item.date)
                  .in("status", ["active", "triggered", "needs_review"])
              : { data: [], error: null };
            const linkedEdit = (linkedWatches ?? []).some((watch: any) =>
              watch.first_obk_id === resolved.scopedObkId ||
              watch.second_obk_id === resolved.scopedObkId
            );
            const { data: transferRules, error: transferError } = !upgrade
              ? await admin.from("room_sale_upgrade_rules")
                  .select("source_obk_id,target_obk_id")
                  .eq("hotel_id", hotelId).eq("stay_date", item.date)
                  .in("status", ["active", "needs_review"])
              : { data: [], error: null };
            const hasExistingTransfer = (transferRules ?? []).some((rule: any) =>
              rule.source_obk_id === resolved.scopedObkId ||
              rule.target_obk_id === resolved.scopedObkId
            );
            const unlinkedIncreaseError = !upgrade && before.value !== null &&
              rooms > before.value && !watchError && !linkedEdit &&
              !transferError && !hasExistingTransfer
              ? await checkUnlinkedInventoryIncrease(
                  resolved.account.creds, resolved.account.hotId, item.date,
                  resolved.obkId, physicalRooms, rooms,
                )
              : null;
            if (watchError) {
              allOk = false;
              lastMessage = "Could not verify linked-room protection. No availability was changed.";
            } else if (linkedEdit) {
              allOk = false;
              lastMessage = "This room category belongs to an active linked offer. Use the linked-room option, or close that rule first.";
            } else if (transferError || hasExistingTransfer) {
              allOk = false;
              lastMessage = "An existing complimentary room transfer affects this category. Resolve that transfer before editing its ordinary availability.";
            } else if (unlinkedIncreaseError) {
              allOk = false;
              lastMessage = unlinkedIncreaseError;
            } else if (before.value === null) {
              allOk = false;
              lastMessage = before.error ?? "Could not verify the current Previo availability.";
            } else if (before.value === rooms) {
              actualAvailability = rooms;
              lastMessage = "Already set to this value in Previo.";
            } else {
              const write = await writePrevioInventory({
                creds: resolved.account.creds,
                pmsHotelId: resolved.account.hotId,
                target: {
                  obkId: resolved.obkId,
                  from: item.date,
                  // Inventory editing is intentionally atomic for now. The UI
                  // edits one room type/date cell and verification below reads
                  // that exact date back from Previo before we report success.
                  to: item.date,
                  roomsToSell: rooms,
                },
              });
              if (!write.ok) {
                allOk = false;
                lastMessage = write.attempts.map((a) => a.message).filter(Boolean).join(" | ") || "Previo rejected the availability change.";
              } else {
                // Previo is the source of truth: do not claim success until its
                // read API reports the same rooms-for-sale value.
                const delays = [0, 350, 900];
                let after: { value: number | null; error: string | null } = { value: null, error: null };
                for (const delay of delays) {
                  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
                  after = await readPrevioAvailability({
                    creds: resolved.account.creds,
                    pmsHotelId: resolved.account.hotId,
                    date: item.date,
                    obkId: resolved.obkId,
                  });
                  if (after.value === rooms) break;
                }
                actualAvailability = after.value;
                if (after.value !== rooms) {
                  allOk = false;
                  lastMessage = after.value === null
                    ? (after.error ?? "Previo accepted the update but read-back verification failed.")
                    : `Previo accepted the update but currently reports ${after.value} rooms for sale, not ${rooms}.`;
                }
              }
            }

              }
              // Do not raise source availability automatically after a partial write.
              // External bookings might have arrived in the meantime.
              if (!allOk && transferred) {
                lastMessage += " Original room type remains reduced for safety. Manager review required.";
              }
              if (allOk && transferred && orgSlug) {
                const newSource = transferred.before - (rooms - (previousAvailability ?? 0));
                await admin.from("revenue_room_type_availability").upsert({
                  hotel_id: hotelId, organization_slug: orgSlug,
                  pms_hotel_id: transferred.account.hotId,
                  stay_date: item.date,
                  obk_id: upgrade!.scopedObkId,
                  availability: Math.max(0, newSource),
                  source: "hotelcare_upgrade_transfer",
                  captured_at: new Date().toISOString(),
                }, { onConflict: "hotel_id,pms_hotel_id,stay_date,obk_id" });
              }
              if (transferRuleId) {
                await admin.from("room_sale_upgrade_rules").update({
                  status: allOk ? "active" : "needs_review",
                  activated_at: allOk ? new Date().toISOString() : null,
                  last_error: allOk ? null : lastMessage,
                  last_checked_at: new Date().toISOString(),
                }).eq("id", transferRuleId);
              }
            } finally {
              if (leaseOwner) await admin.rpc("release_room_sale_upgrade_lock", {
                p_hotel_id: hotelId, p_stay_date: item.date, p_owner: leaseOwner,
              });
            }
            if (allOk && orgSlug && actualAvailability !== null) {
              await admin.from("revenue_room_type_availability").upsert({
                hotel_id: hotelId,
                organization_slug: orgSlug,
                pms_hotel_id: resolved.account.hotId,
                stay_date: item.date,
                obk_id: resolved.scopedObkId,
                availability: actualAvailability,
                source: "hotelcare_eqc_inventory_write",
                captured_at: new Date().toISOString(),
              }, { onConflict: "hotel_id,pms_hotel_id,stay_date,obk_id" });
            }
          }
        }
      }

      if (allOk && wantsMinStay) {
        const nights = Math.max(1, Math.min(30, Math.round(Number(item.minStay))));
        const obkList = Array.from(new Set(maps.map((m: any) => String(m.previo_room_type_id))));
        for (const obk of obkList) {
          const target = resolve(obk);
          if (!target) {
            allOk = false;
            lastMessage = "No Previo pricelist mapping exists for this stay rule.";
            break;
          }
          const res = await writePrevioRestrictions({
            creds: target.account.creds,
            pmsHotelId: target.account.hotId,
            target: {
              obkId: target.obkId,
              prlId: target.prlId,
              from: item.date,
              to: rangeTo,
              minStay: nights,
              roomsToSell: null,
            },
          });
          if (!res.ok) {
            allOk = false;
            lastMessage = res.attempts[0]?.message ?? "Previo rejected the change.";
            break;
          }
        }

        if (allOk && orgSlug) {
          const rows: any[] = [];
          const dayMs = 86_400_000;
          const start = Date.parse(`${item.date}T00:00:00Z`);
          const end = Date.parse(`${rangeTo}T00:00:00Z`);
          for (let t = start; t <= end && rows.length < 800; t += dayMs) {
            rows.push({
              hotel_id: hotelId,
              organization_slug: orgSlug,
              stay_date: new Date(t).toISOString().slice(0, 10),
              min_nights: nights,
              updated_by: user.id,
              updated_at: new Date().toISOString(),
            });
          }
          for (let i = 0; i < rows.length; i += 200) {
            await admin.from("min_stay_rules").upsert(rows.slice(i, i + 200), { onConflict: "hotel_id,stay_date" });
          }
        }
      }

      if (allOk) sent += 1; else failed += 1;
      results.push({
        date: item.date,
        roomTypeName: item.roomTypeName ?? null,
        ok: allOk,
        message: lastMessage,
        ...(wantsInventory ? { previousAvailability, actualAvailability, requestedAvailability: Number(item.roomsToSell) } : {}),
      } as any);
    }

    const actorName = (profile as any).full_name || (profile as any).nickname || (profile as any).email || null;
    await admin.from("pms_sync_history").insert({
      sync_type: clean.some((item) => item.roomsToSell !== undefined && item.roomsToSell !== null)
        ? "availability_push"
        : "restriction_push",
      direction: "to_previo",
      hotel_id: hotelId,
      sync_status: failed === 0 ? "success" : sent === 0 ? "failed" : "partial",
      data: { sent, failed, results: results.slice(0, 50) },
      error_message: failed ? results.find((result) => !result.ok)?.message ?? null : null,
      synced_by_user_id: user.id,
      synced_by_name: actorName,
    });

    return json({ ok: failed === 0, sent, failed, results });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
