// Read-only SLNT checkout look-ahead: exact Previo physical room, never room type or names.
// No guest names or reservation identifiers are returned to housekeeping clients.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { callPrevioXml, loadPrevioCredentials } from "../_shared/previoCredentials.ts";
import { blocks, grab, addDays } from "../_shared/previoReservations.ts";

const HOTEL = "slnt-group";
const ORG = "slnt";
const EXPECTED_ACCOUNTS = new Set(["782407", "783103"]);
const LOOKAHEAD_DAYS = 30;
// XML Previo documents <limit> pagination only for fulltext searches.
 // Bound ordinary check-in searches by small date windows instead.
const CHUNK_DAYS = 5;
const ALLOWED_ROLES = new Set([
  "housekeeping", "housekeeper", "manager", "housekeeping_manager",
  "supervisor", "admin", "top_management", "top_management_manager",
]);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
};
const respond = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

type Arrival = {
  arrival_date: string;
  count: number | null;
  count_source: "declared" | "guest_list" | "missing";
  key: string;
};
type RoomResult = {
  room_id: string;
  status: "confirmed" | "guest_list" | "not_found" | "unverified" | "conflict";
  arrival_date: string | null;
  guest_count: number | null;
};

function todayBudapest(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function readCount(raw: string): Pick<Arrival, "count" | "count_source"> {
  // Previo allows guest identities to be omitted. Never manufacture a one-person booking.
  const declared = ["numGuest", "numOfGuests", "persons", "pax"].map(tag => grab(raw, tag))
    .find(v => v != null && /^\d+$/.test(v));
  if (declared !== undefined) {
    const n = Number(declared);
    if (n > 0 && n <= 100) return { count: n, count_source: "declared" };
    return { count: null, count_source: "missing" };
  }
  const listed = blocks(raw, "guest").length;
  if (listed > 0 && listed <= 100) return { count: listed, count_source: "guest_list" };
  return { count: null, count_source: "missing" };
}

function parsePage(xml: string, from: string, to: string) {
  const arrivals = new Map<string, Arrival[]>();
  const rawBlocks = blocks(xml, "reservation");
  for (const raw of rawBlocks) {
    const term = grab(raw, "term") ?? "";
    const arrival = (grab(term, "from") ?? "").slice(0, 10);
    if (arrival < from || arrival >= to) continue;
    const statusId = Number(grab(raw, "statusId") ?? "");
    // 2 confirmed and 3 checked-in are documented Previo states; excluded:
    // option 1, waiting list 6, cancelled 7, no-show 8, checked-out 9.
    if (![2, 3].includes(statusId)) continue;
    const object = grab(raw, "object") ?? "";
    const physicalId = grab(object, "objId") ?? grab(raw, "objId");
    if (!physicalId || !/^\d+$/.test(physicalId)) continue;
    const { count, count_source } = readCount(raw);
    const key = grab(raw, "comId") || [grab(raw, "resId") ?? "", physicalId, arrival].join(":");
    const item: Arrival = { arrival_date: arrival, count, count_source, key };
    if (!arrivals.has(physicalId)) arrivals.set(physicalId, []);
    arrivals.get(physicalId)!.push(item);
  }
  return { rawCount: rawBlocks.length, arrivals };
}

function chooseArrival(roomId: string, items: Arrival[] | undefined): RoomResult {
  const base: RoomResult = { room_id: roomId, status: "not_found", arrival_date: null, guest_count: null };
  if (!items?.length) return base;
  const unique = Array.from(new Map(items.map(r => [r.key, r])).values())
    .sort((a, b) => a.arrival_date.localeCompare(b.arrival_date));
  const first = unique[0];
  if (unique.length > 1 && unique[1].arrival_date === first.arrival_date)
    return { ...base, status: "conflict", arrival_date: first.arrival_date };
  if (first.count == null) return { ...base, status: "unverified", arrival_date: first.arrival_date };
  return { ...base, status: first.count_source === "declared" ? "confirmed" : "guest_list",
    arrival_date: first.arrival_date, guest_count: first.count };
}

serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return respond({ ok: false, error: "POST required" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return respond({ ok: false, error: "Service not configured" }, 503);

  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return respond({ ok: false, error: "Unauthorized" }, 401);
    const auth = createClient(url, anon, { auth: { persistSession: false } });
    const { data: authUser, error: authError } = await auth.auth.getUser(token);
    if (authError || !authUser?.user) return respond({ ok: false, error: "Unauthorized" }, 401);
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("organization_slug,role,is_super_admin,assigned_hotel").eq("id", authUser.user.id).maybeSingle();
    if (profileError || !profile || (!profile.is_super_admin && (
      profile.organization_slug !== ORG || !ALLOWED_ROLES.has(String(profile.role))
    ))) return respond({ ok: false, error: "Forbidden" }, 403);

    const today = todayBudapest();
    const until = addDays(today, LOOKAHEAD_DAYS + 1);
    const { data: accounts, error: accountsError } = await admin.from("pms_accounts")
      .select("id,pms_hotel_id,credentials_secret_name,is_active,sync_paused")
      .eq("hotel_id", HOTEL).eq("organization_slug", ORG).eq("pms_type", "previo")
      .eq("is_active", true).eq("sync_paused", false);
    if (accountsError || !accounts || new Set(accounts.map(a => String(a.pms_hotel_id))).size !== EXPECTED_ACCOUNTS.size
      || accounts.some(a => !EXPECTED_ACCOUNTS.has(String(a.pms_hotel_id)))) {
      return respond({ ok: false, error: "SLNT Previo account coverage cannot be verified" }, 503);
    }

    const { data: mappings, error: mappingsError } = await admin.from("pms_unit_mappings")
      .select("room_id,external_room_id,pms_account_id")
      .eq("hotel_id", HOTEL).eq("organization_slug", ORG).eq("status", "applied")
      .not("room_id", "is", null);
    if (mappingsError || !mappings) return respond({ ok: false, error: "Room mappings unavailable" }, 503);
    const byAccount = new Map<string, typeof mappings>();
    for (const mapping of mappings) {
      if (!mapping.pms_account_id || !mapping.external_room_id || !/^\d+$/.test(mapping.external_room_id)) continue;
      if (!byAccount.has(mapping.pms_account_id)) byAccount.set(mapping.pms_account_id, []);
      byAccount.get(mapping.pms_account_id)!.push(mapping);
    }

    const results: RoomResult[] = [];
    const accountErrors: string[] = [];
    for (const account of accounts) {
      const mapped = byAccount.get(account.id) ?? [];
      const gathered = new Map<string, Arrival[]>();
      try {
        const creds = loadPrevioCredentials(account.credentials_secret_name);
        for (let from = today; from < until; from = addDays(from, CHUNK_DAYS)) {
          const next = addDays(from, CHUNK_DAYS);
          const to = next < until ? next : until;
          // Query arrivals rather than all overlaps: the outgoing guest is
          // not the arriving guest, and Previo fulltext-only pagination is
          // not applicable to date-based reservation searches.
          const extraXml = `<term><from>${from}</from><to>${to}</to><termType>check-in</termType></term>`;
          const upstream = await callPrevioXml({ method: "searchReservations", creds,
            pmsHotelId: String(account.pms_hotel_id), extraXml });
          if (!upstream.ok) throw new Error("Incomplete Previo reservation response");
          const parsed = parsePage(upstream.text, from, to);
          if (parsed.rawCount > 1000) throw new Error("Unexpected Previo response size for a five-day arrival window");
          for (const [externalId, entries] of parsed.arrivals) {
            if (!gathered.has(externalId)) gathered.set(externalId, []);
            gathered.get(externalId)!.push(...entries);
          }
        }
        for (const row of mapped) results.push(chooseArrival(row.room_id, gathered.get(row.external_room_id)));
      } catch (error) {
        // Never show a false 'no arrival' when either Previo account fails.
        accountErrors.push(String(account.pms_hotel_id));
        for (const row of mapped) results.push({ room_id: row.room_id, status: "unverified",
          arrival_date: null, guest_count: null });
        console.error("SLNT arrival lookup failed", String(account.pms_hotel_id),
          error instanceof Error ? error.name : "unknown");
      }
    }
    // Duplicate unit mappings cannot be resolved safely by choosing one.
    const seen = new Set<string>();
    const duplicate = new Set<string>();
    for (const row of results) {
      if (seen.has(row.room_id)) duplicate.add(row.room_id);
      seen.add(row.room_id);
    }
    const safe = results.filter(r => !duplicate.has(r.room_id));
    for (const id of duplicate) safe.push({ room_id:id, status:"conflict", guest_count:null, arrival_date:null });
    return respond({ ok: true, as_of: new Date().toISOString(), from: today, through: addDays(today, LOOKAHEAD_DAYS),
      rooms: safe, account_errors: accountErrors });
  } catch (error) {
    console.error("SLNT next-arrival unexpected failure", error instanceof Error ? error.name : "unknown");
    return respond({ ok: false, error: "Unable to verify incoming bookings from Previo" }, 503);
  }
});
