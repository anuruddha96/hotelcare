import { buildBreakfastPush, dispatchBreakfastPushes, groupBreakfastPushRows, type BreakfastPushRow } from "./notifications.ts";
import { verifiedBreakfastStaff } from "./staffAccess.ts";

const assert = (condition: unknown, message = "Assertion failed") => { if (!condition) throw new Error(message); };
const now = Date.parse("2026-11-26T08:00:00+01:00");
const row = (patch: Partial<BreakfastPushRow> = {}): BreakfastPushRow => ({
  id: "outbox-a", signal_id: "signal-a", organization_slug: "org-a", hotel_id: "hotel-a",
  user_id: "worker-a", assignment_id: "assignment-a", room_number: "105", preferred_language: "en",
  kind: "arrival", claim_token: "claim-a", tag: "room-tag", guests_seen: 1, guests_expected: 2,
  window_ends_at: new Date(now + 30 * 60_000).toISOString(), ...patch,
});

Deno.test("single push is private, partial, scoped and expires with the signal", () => {
  const payload = buildBreakfastPush([row()], now)!;
  assert(payload.userIds.length === 1 && payload.userIds[0] === "worker-a");
  assert(payload.title === "Room 105: guest at breakfast");
  assert(payload.body.includes("1 of 2") && payload.body.includes("knock"));
  assert(payload.url === "/org-a?tab=housekeeping&breakfastAssignment=assignment-a");
  assert(payload.ttlSeconds === 1800 && payload.urgency === "normal");
  assert(!("guest_names" in payload));
  assert(buildBreakfastPush([row({ window_ends_at: new Date(now).toISOString() })], now) === null);
});

Deno.test("batch is localized, cautions about occupancy, never mixes recipients or tenants", () => {
  const rows = [row({ preferred_language: "hu" }), row({ id: "b", room_number: "107", preferred_language: "hu" }), row({ id: "c", room_number: "112", preferred_language: "hu" })];
  const payload = buildBreakfastPush(rows, now)!;
  assert(payload.title.includes("105") && payload.title.includes("107") && payload.title.includes("112"));
  assert(payload.body.includes("kopogjon"));
  assert(groupBreakfastPushRows([...rows, row({ user_id: "worker-b" }), row({ organization_slug: "org-b" }), row({ hotel_id: "hotel-b" })]).length === 4);
  let rejected = false;
  try { buildBreakfastPush([row(), row({ user_id: "worker-b" })], now); } catch { rejected = true; }
  assert(rejected);
});

Deno.test("correction reuses the notification tag and treats room as occupied", () => {
  const payload = buildBreakfastPush([row({ kind: "correction", window_ends_at: null })], now)!;
  assert(payload.tag === "room-tag" && payload.title === "Room 105: update");
  assert(payload.body.includes("occupied") && payload.body.includes("knock"));
});

Deno.test("delivery status depends on accepted subscriptions, not HTTP success", async () => {
  for (const delivered of [0, 1]) {
    const current = row({ window_ends_at: new Date(Date.now() + 60_000).toISOString() });
    let finish: unknown;
    const client = { rpc: async (name: string, args: any) => {
      if (name === "claim_breakfast_pushes" || name === "revalidate_breakfast_pushes") return { data: [current] };
      if (name === "finish_breakfast_pushes") { finish = args._delivered; return { data: 1 }; }
      throw new Error(name);
    } };
    const result = await dispatchBreakfastPushes(client, "https://example.test", "private", async (_input, init) => {
      assert(new Headers(init?.headers).get("x-hotelcare-push-secret") === "private");
      return new Response(JSON.stringify({ ok: true, delivered }), { status: 200 });
    });
    assert(finish === (delivered > 0));
    assert(result.accepted === delivered);
  }
});

Deno.test("revoked/reassigned claim is not sent", async () => {
  const client = { rpc: async (name: string) => {
    if (name === "claim_breakfast_pushes") return { data: [row()] };
    if (name === "revalidate_breakfast_pushes") return { data: [] };
    throw new Error("Unexpected RPC " + name);
  } };
  let sends = 0;
  await dispatchBreakfastPushes(client, "https://example.test", "private", async () => { sends++; return new Response("{}"); });
  assert(sends === 0);
});

Deno.test("staff access requires a verified session, same tenant, allowed role and hotel access", async () => {
  const req = new Request("https://example.test", { headers: { Authorization: "Bearer token" } });
  const staff = { role: "breakfast_staff", organization_slug: "org-a", deleted_at: null };
  const make = (profile: any, allowed: boolean, uid: string | null = "worker-a") => ({
    auth: { getUser: async () => ({ data: { user: uid ? { id: uid } : null } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }) }),
    rpc: async (name: string, args: any) => {
      assert(name === "user_can_access_hotel" && args._uid === uid && args._hotel_id === "hotel-a");
      return { data: allowed };
    },
  });
  assert(await verifiedBreakfastStaff(make(staff,true), req, "hotel-a","org-a") === "worker-a");
  assert(await verifiedBreakfastStaff(make(staff,true), new Request("https://example.test"), "hotel-a","org-a") === null);
  assert(await verifiedBreakfastStaff(make(staff,true,null), req, "hotel-a","org-a") === null);
  assert(await verifiedBreakfastStaff(make({ ...staff, organization_slug: "org-b" },true), req, "hotel-a","org-a") === null);
  assert(await verifiedBreakfastStaff(make({ ...staff, role: "guest" },true), req, "hotel-a","org-a") === null);
  assert(await verifiedBreakfastStaff(make({ ...staff, deleted_at: "2026-11-26" },true), req, "hotel-a","org-a") === null);
  assert(await verifiedBreakfastStaff(make(staff,false), req, "hotel-a","org-a") === null);
});
