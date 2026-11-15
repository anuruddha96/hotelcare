/**
 * channex-open-channel — partner-hosted endpoint for Channex's Open Channel API.
 *
 * Channex pushes ARI to us here, which makes HotelCare testable as the OTA
 * side of a second channel on the test property — and is the foundation for a
 * direct-booking ("book on the hotel's own website") channel later.
 *
 * Contract (docs.channex.io → Open Channel API):
 *   GET  /test_connection/?hotel_code=X   → {"success": true}
 *   GET  /mapping_details/?hotel_code=X   → room types + rate plans to map
 *   POST /changes/                        → ARI notifications; respond
 *                                           {"success": true, "unique_id": …}
 * Auth: Channex sends the channel's API key in the `api-key` header; it must
 * match the OPEN_CHANNEL_API_KEY secret. Only the sandbox test hotel answers.
 */
import { json, safeEqual, serviceDb } from "../_shared/channex/http.ts";

// The only hotel served: the Channex sandbox test property. Live hotels are
// never exposed through this endpoint.
const HOTEL_CODE = "channex-test-property";

const ROOM_TYPES = [
  {
    id: "TWIN",
    title: "Twin Room",
    rate_plans: [
      { id: "TWIN-BAR", title: "Best Available Rate", sell_mode: "per_room", max_persons: 2, currency: "USD", read_only: false },
      { id: "TWIN-BB", title: "Bed & Breakfast Rate", sell_mode: "per_room", max_persons: 2, currency: "USD", read_only: false },
    ],
  },
  {
    id: "DBL",
    title: "Double Room",
    rate_plans: [
      { id: "DBL-BAR", title: "Best Available Rate", sell_mode: "per_room", max_persons: 2, currency: "USD", read_only: false },
      { id: "DBL-BB", title: "Bed & Breakfast Rate", sell_mode: "per_room", max_persons: 2, currency: "USD", read_only: false },
    ],
  },
];

function authorized(req: Request): boolean {
  const expected = Deno.env.get("OPEN_CHANNEL_API_KEY") ?? "";
  if (!expected) return false; // never run unauthenticated
  return safeEqual(req.headers.get("api-key") ?? "", expected);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // Path after the function name: /channex-open-channel/<route>/
  const route = url.pathname.replace(/^.*channex-open-channel\/?/, "").replace(/\/+$/, "");

  if (!authorized(req)) return json({ success: false, error: "forbidden" }, 403);

  const hotelCode = url.searchParams.get("hotel_code") ?? "";

  if (req.method === "GET" && route === "test_connection") {
    if (hotelCode !== HOTEL_CODE) return json({ success: false, error: "unknown hotel_code" }, 404);
    return json({ success: true });
  }

  if (req.method === "GET" && route === "mapping_details") {
    if (hotelCode !== HOTEL_CODE) return json({ success: false, error: "unknown hotel_code" }, 404);
    return json({ data: { type: "mapping_details", attributes: { room_types: ROOM_TYPES } } });
  }

  if (req.method === "POST" && route === "changes") {
    let payload: { data?: Array<{ type?: string; attributes?: Record<string, unknown> }> } = {};
    try { payload = await req.json(); } catch { return json({ success: false, error: "invalid JSON" }, 400); }
    const db = serviceDb();
    const uniqueId = crypto.randomUUID();
    const rows = (payload.data ?? []).map((n) => ({
      hotel_code: String(n.attributes?.hotel_code ?? ""),
      request_id: String(n.attributes?.request_id ?? ""),
      unique_id: uniqueId,
      payload: n.attributes ?? {},
    }));
    if (rows.length) {
      const { error } = await db.from("open_channel_events").insert(rows);
      if (error) {
        console.error("open_channel_events insert failed", error.message);
        return json({ success: false, error: "storage failure" }, 503);
      }
    }
    return json({ success: true, unique_id: uniqueId });
  }

  return json({ success: false, error: `unknown route: ${req.method} ${route || "/"}` }, 404);
});
