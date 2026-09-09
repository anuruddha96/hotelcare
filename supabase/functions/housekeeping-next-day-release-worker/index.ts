import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { fetchPrevioWithAuth, safePrevioJson } from "../_shared/previoAuth.ts";
import { callPrevioXml, loadPrevioCredentials } from "../_shared/previoCredentials.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-worker-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function addDays(base: string, amount: number) {
  const date = new Date(`${base}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function aliases(value: unknown) {
  const raw = String(value ?? "").trim();
  const result = new Set<string>();
  const full = normalize(raw);
  if (full) result.add(full);
  const numbers = raw.match(/\d+/g);
  const lastNumber = numbers?.at(-1);
  if (lastNumber) result.add(normalize(lastNumber));
  return [...result];
}

function statusIdFrom(raw: any): number {
  const status = raw?.status;
  const value = raw?.statusId ?? raw?.reservationStatusId ?? raw?.cosId
    ?? raw?.commissionStatusId ?? raw?.roomReservationStatusId
    ?? (status && typeof status === "object" ? status.id : status);
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

type FreshKind = "checkout" | "daily";
type FreshRoom = {
  kind: FreshKind;
  roomName: string;
  externalRoomId?: string | null;
  accountId?: string | null;
  source: string;
};

type PlanItem = {
  id: string;
  room_id: string;
  assigned_to: string;
  assignment_type: string;
  rooms: {
    id: string;
    room_number: string;
    status: string | null;
    pms_metadata: Record<string, any> | null;
  } | null;
};

function classifyReservation(arrival: string, departure: string, statusId: number, planDate: string): FreshKind | null {
  if (!arrival || !departure || statusId === 7 || statusId === 8) return null;
  if (departure === planDate) return "checkout";
  if (arrival < planDate && departure > planDate) return "daily";
  return null;
}

function parseXmlReservations(xml: string, planDate: string, accountId: string | null): FreshRoom[] {
  const grab = (source: string, tag: string) => {
    const match = source.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i"));
    return match ? match[1].trim() : "";
  };

  const rows: FreshRoom[] = [];
  const blocks = xml.match(/<reservation>[\s\S]*?<\/reservation>/g) || [];
  for (const block of blocks) {
    const arrival = grab(block, "from").slice(0, 10);
    const departure = grab(block, "to").slice(0, 10);
    const statusId = Number(grab(block, "statusId") || grab(block, "cosId") || 0);
    const kind = classifyReservation(arrival, departure, statusId, planDate);
    if (!kind) continue;

    const objectMatch = block.match(
      /<object>[\s\S]*?<objId>(\d+)<\/objId>[\s\S]*?<name>([^<]*)<\/name>[\s\S]*?<\/object>/i,
    );
    const externalRoomId = objectMatch?.[1] || null;
    const roomName = String(objectMatch?.[2] || "").trim();
    if (!externalRoomId && !roomName) continue;

    rows.push({
      kind,
      roomName,
      externalRoomId,
      accountId,
      source: "previo_xml_searchReservations",
    });
  }
  return rows;
}

async function fetchAccountFreshRooms(account: any, planDate: string): Promise<FreshRoom[]> {
  const creds = loadPrevioCredentials(account.credentials_secret_name);
  const fromDate = addDays(planDate, -30);
  const toDate = addDays(planDate, 1);

  try {
    const response = await callPrevioXml({
      method: "searchReservations",
      creds,
      pmsHotelId: String(account.pms_hotel_id || ""),
      extraXml: `<term><from>${fromDate}</from><to>${toDate}</to></term>`,
    });
    if (response.ok) {
      return parseXmlReservations(response.text, planDate, account.id);
    }
  } catch (error) {
    console.warn(`[HK release] XML revalidation failed for account ${account.id}:`, error);
  }

  // REST fallback for mixed/legacy tenants. It is accepted only when at least
  // one embedded reservation is present; an empty room roster is not treated as
  // authoritative reservation data.
  const { response } = await fetchPrevioWithAuth({
    credentialsSecretName: account.credentials_secret_name,
    path: "/rest/rooms",
    pmsHotelId: String(account.pms_hotel_id || ""),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Previo account ${account.label || account.id} returned ${response.status}: ${text.slice(0, 180)}`);
  }

  const rooms = await safePrevioJson<any[]>(response, { path: "/rest/rooms" });
  const result: FreshRoom[] = [];
  let embeddedReservations = 0;
  for (const room of rooms || []) {
    const reservation = room?.reservation;
    if (!reservation || typeof reservation !== "object") continue;
    embeddedReservations++;
    const arrival = String(
      reservation.arrivalDate ?? reservation.arrival ?? reservation.from
      ?? reservation.dateFrom ?? reservation.startDate ?? reservation.checkIn ?? "",
    ).slice(0, 10);
    const departure = String(
      reservation.departureDate ?? reservation.departure ?? reservation.to
      ?? reservation.dateTo ?? reservation.endDate ?? reservation.checkOut ?? "",
    ).slice(0, 10);
    const kind = classifyReservation(arrival, departure, statusIdFrom(reservation), planDate);
    if (!kind) continue;
    result.push({
      kind,
      roomName: String(room.name ?? "").trim(),
      externalRoomId: room.roomId != null ? String(room.roomId) : null,
      accountId: account.id,
      source: "previo_rest_rooms_embedded_reservation",
    });
  }

  if (embeddedReservations === 0) {
    throw new Error(`Previo account ${account.label || account.id} did not return authoritative reservation data.`);
  }
  return result;
}

async function validateStandardHotel(admin: any, supabaseUrl: string, serviceRole: string, hotelId: string, planDate: string) {
  const response = await fetch(`${supabaseUrl}/functions/v1/previo-sync-daily-overview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRole}`,
      apikey: serviceRole,
    },
    body: JSON.stringify({
      hotelId,
      fromDate: planDate,
      toDate: addDays(planDate, 1),
      days: 1,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false || payload?.supported === false || payload?.error) {
    throw new Error(payload?.error || payload?.message || `Previo daily overview refresh failed (${response.status})`);
  }

  const { data, error } = await admin
    .from("daily_overview_snapshots")
    .select("room_label,room_number,status,housekeeping_dep,housekeeping_stay,captured_at")
    .eq("hotel_id", hotelId)
    .eq("business_date", planDate)
    .eq("source", "previo");
  if (error) throw error;

  const freshByAlias = new Map<string, FreshRoom>();
  for (const row of data || []) {
    const kind: FreshKind | null = row.status === "departing" || row.housekeeping_dep === "DEP"
      ? "checkout"
      : row.status === "ongoing"
        ? "daily"
        : null;
    if (!kind) continue;
    const fresh: FreshRoom = {
      kind,
      roomName: row.room_number || row.room_label,
      accountId: null,
      source: "previo_daily_overview",
    };
    for (const key of [...aliases(row.room_number), ...aliases(row.room_label)]) {
      if (!freshByAlias.has(key)) freshByAlias.set(key, fresh);
    }
  }

  return { freshByAlias, source: "previo_daily_overview" };
}

async function validatePortfolioHotel(admin: any, hotelId: string, planDate: string) {
  const { data: accounts, error: accountsError } = await admin
    .from("pms_accounts")
    .select("id,hotel_id,label,pms_hotel_id,credentials_secret_name,pms_type,is_active")
    .eq("hotel_id", hotelId)
    .eq("pms_type", "previo")
    .eq("is_active", true);
  if (accountsError) throw accountsError;
  if (!accounts?.length) throw new Error(`No active Previo source for ${hotelId}`);

  const allFresh: FreshRoom[] = [];
  for (const account of accounts) {
    if (!account.pms_hotel_id) throw new Error(`Previo account ${account.label || account.id} has no hotel id.`);
    const rows = await fetchAccountFreshRooms(account, planDate);
    allFresh.push(...rows);
  }

  const { data: mappings, error: mappingError } = await admin
    .from("pms_unit_mappings")
    .select("pms_account_id,external_room_id,source_name,normalized_name,canonical_room_name,room_id,status")
    .eq("hotel_id", hotelId)
    .not("room_id", "is", null);
  if (mappingError) throw mappingError;

  const roomIdByExternal = new Map<string, string>();
  const roomIdByAlias = new Map<string, string>();
  for (const mapping of mappings || []) {
    const accountPrefix = mapping.pms_account_id ? `${mapping.pms_account_id}|` : "";
    if (mapping.external_room_id) {
      roomIdByExternal.set(`${accountPrefix}${String(mapping.external_room_id)}`, mapping.room_id);
    }
    for (const value of [mapping.source_name, mapping.normalized_name, mapping.canonical_room_name]) {
      for (const key of aliases(value)) {
        roomIdByAlias.set(`${accountPrefix}${key}`, mapping.room_id);
        if (!roomIdByAlias.has(key)) roomIdByAlias.set(key, mapping.room_id);
      }
    }
  }

  const freshByRoomId = new Map<string, FreshRoom>();
  const freshByAlias = new Map<string, FreshRoom>();
  for (const fresh of allFresh) {
    const prefix = fresh.accountId ? `${fresh.accountId}|` : "";
    const mappedRoomId = fresh.externalRoomId
      ? roomIdByExternal.get(`${prefix}${fresh.externalRoomId}`)
      : undefined;
    const fallbackRoomId = aliases(fresh.roomName)
      .map(key => roomIdByAlias.get(`${prefix}${key}`) || roomIdByAlias.get(key))
      .find(Boolean);
    const roomId = mappedRoomId || fallbackRoomId;
    if (roomId) freshByRoomId.set(roomId, fresh);
    for (const key of aliases(fresh.roomName)) {
      if (!freshByAlias.has(key)) freshByAlias.set(key, fresh);
    }
  }

  return { freshByRoomId, freshByAlias, source: "previo_portfolio_accounts" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRole);

  const providedSecret = req.headers.get("x-worker-secret") || "";
  const { data: expectedSecret, error: secretError } = await admin.rpc("get_housekeeping_release_worker_secret");
  if (secretError || !safeEqual(providedSecret, String(expectedSecret || ""))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const { data: plans, error: claimError } = await admin.rpc(
    "claim_due_next_day_housekeeping_release_plans",
    { p_limit: 10 },
  );
  if (claimError) return json({ error: claimError.message }, 500);

  const results: Array<Record<string, unknown>> = [];

  for (const plan of plans || []) {
    const validatedAt = new Date().toISOString();
    try {
      const { data: itemRows, error: itemError } = await admin
        .from("next_day_housekeeping_plan_items")
        .select("id,room_id,assigned_to,assignment_type,rooms!inner(id,room_number,status,pms_metadata)")
        .eq("plan_id", plan.id);
      if (itemError) throw itemError;
      const items = (itemRows || []) as PlanItem[];

      const { data: config, error: configError } = await admin
        .from("pms_configurations")
        .select("hotel_id,pms_type,is_active")
        .eq("hotel_id", plan.hotel_id)
        .eq("pms_type", "previo")
        .eq("is_active", true)
        .maybeSingle();
      if (configError) throw configError;

      let freshByRoomId = new Map<string, FreshRoom>();
      let freshByAlias = new Map<string, FreshRoom>();
      let validationSource = "";
      if (config) {
        const standard = await validateStandardHotel(admin, supabaseUrl, serviceRole, plan.hotel_id, plan.plan_date);
        freshByAlias = standard.freshByAlias;
        validationSource = standard.source;
      } else {
        const portfolio = await validatePortfolioHotel(admin, plan.hotel_id, plan.plan_date);
        freshByRoomId = portfolio.freshByRoomId;
        freshByAlias = portfolio.freshByAlias;
        validationSource = portfolio.source;
      }

      const eligible = new Set<string>();
      const assignmentTypeOverrides: Record<string, string> = {};
      const skippedRooms: Array<Record<string, unknown>> = [];
      const typeChanges: Array<Record<string, unknown>> = [];

      for (const item of items) {
        const room = item.rooms;
        if (!room) {
          skippedRooms.push({ room_id: item.room_id, reason: "room_not_found" });
          continue;
        }

        const metadata = room.pms_metadata || {};
        if (room.status === "out_of_order" || metadata.manualHousekeepingHold === true || metadata.isNoShow === true) {
          skippedRooms.push({
            room_id: item.room_id,
            room_number: room.room_number,
            reason: room.status === "out_of_order" ? "out_of_order" : metadata.isNoShow === true ? "no_show" : "manual_housekeeping_hold",
          });
          continue;
        }

        let fresh = freshByRoomId.get(item.room_id);
        if (!fresh) {
          for (const key of aliases(room.room_number)) {
            const candidate = freshByAlias.get(key);
            if (candidate) {
              fresh = candidate;
              break;
            }
          }
        }

        if (!fresh) {
          skippedRooms.push({
            room_id: item.room_id,
            room_number: room.room_number,
            reason: "no_active_housekeeping_reservation",
          });
          continue;
        }

        const plannedKind: FreshKind = item.assignment_type === "checkout_cleaning" ? "checkout" : "daily";
        const currentAssignmentType = fresh.kind === "checkout" ? "checkout_cleaning" : "daily_cleaning";
        eligible.add(item.room_id);
        if (fresh.kind !== plannedKind) {
          assignmentTypeOverrides[item.room_id] = currentAssignmentType;
          typeChanges.push({
            room_id: item.room_id,
            room_number: room.room_number,
            from: item.assignment_type,
            to: currentAssignmentType,
            reason: plannedKind === "checkout" ? "stay_extended_or_departure_changed" : "new_or_earlier_departure",
          });
        }
      }

      const validationResult = {
        authoritative: true,
        source: validationSource,
        validated_at: validatedAt,
        plan_date: plan.plan_date,
        planned_assignment_count: items.length,
        planned_room_count: new Set(items.map(item => item.room_id)).size,
        eligible_room_ids: [...eligible],
        eligible_room_count: eligible.size,
        skipped_rooms: skippedRooms,
        assignment_type_overrides: assignmentTypeOverrides,
        type_changes: typeChanges,
      };

      const { error: passError } = await admin
        .from("next_day_housekeeping_plans")
        .update({
          release_revalidation_status: "passed",
          release_revalidated_at: validatedAt,
          release_revalidation_result: validationResult,
          last_error: null,
        })
        .eq("id", plan.id)
        .eq("status", "approved");
      if (passError) throw passError;

      const { data: releaseResult, error: releaseError } = await admin.rpc(
        "release_next_day_housekeeping_plan",
        { p_plan_id: plan.id },
      );
      if (releaseError) throw releaseError;

      results.push({
        plan_id: plan.id,
        hotel_id: plan.hotel_id,
        ok: true,
        validation: validationResult,
        release: releaseResult,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[HK release] ${plan.hotel_id}/${plan.id}:`, message);
      await admin
        .from("next_day_housekeeping_plans")
        .update({
          release_revalidation_status: "failed",
          release_revalidation_result: {
            authoritative: false,
            failed_at: validatedAt,
            error: message,
          },
          last_error: `Morning PMS revalidation failed: ${message}`,
        })
        .eq("id", plan.id)
        .eq("status", "approved");
      results.push({ plan_id: plan.id, hotel_id: plan.hotel_id, ok: false, error: message });
    }
  }

  return json({
    ok: true,
    claimed: (plans || []).length,
    released: results.filter(result => result.ok === true).length,
    failed: results.filter(result => result.ok !== true).length,
    results,
  });
});
