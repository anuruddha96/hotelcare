/**
 * Durable booking ingestion shared by channex-webhook and channex-booking-worker.
 *
 *   1. store the (card-free) revision in channex_booking_revisions   -> durable before anything else
 *   2. resolve the HotelCare hotel by Channex property id (exact environment match)
 *   3. live hotel: map + apply atomically via channex_apply_revision (SQL transaction)
 *   4. ACK to Channex only when the booking OR a review case is saved (mayAckRevision)
 *
 * Unknown properties are never ACKed (they may belong to another integration on the account).
 * Failures stay un-ACKed so the feed re-serves them; the worker alerts before the 30-minute window.
 */
import { mayAckRevision } from "./ariDelta.ts";
import { ChannexClient, ChannexEnvironment, ChannexError } from "./client.ts";
import { planRevision, sanitizeRevisionPayload, summarizeRevision, type RoomTypeMapping } from "./revision.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export type IngestResult = {
  revisionId: string;
  state: string;
  acked: boolean;
  error?: string;
};

export type Connection = {
  hotel_id: string;
  organization_slug: string;
  environment: ChannexEnvironment;
  mode: "off" | "dry_run" | "live";
  kill_switch: boolean;
  channex_property_id: string | null;
  currency: string;
};

export async function loadConnectionByProperty(db: Db, propertyId: string | null, env: ChannexEnvironment): Promise<Connection | null> {
  if (!propertyId) return null;
  const { data } = await db.from("channex_connections")
    .select("hotel_id,organization_slug,environment,mode,kill_switch,channex_property_id,currency")
    .eq("channex_property_id", propertyId).eq("environment", env).maybeSingle();
  return (data as Connection | null) ?? null;
}

async function roomTypeMap(db: Db, hotelId: string): Promise<Map<string, RoomTypeMapping>> {
  const { data: maps } = await db.from("channex_mappings").select("local_id,channex_id").eq("hotel_id", hotelId).eq("kind", "room_type");
  const ids = (maps ?? []).map((m: any) => m.local_id);
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: types } = await db.from("room_types").select("id,name").in("id", ids);
    for (const t of types ?? []) names.set(t.id, t.name);
  }
  const out = new Map<string, RoomTypeMapping>();
  for (const m of maps ?? []) {
    const name = names.get(m.local_id);
    if (name) out.set(String(m.channex_id), { localRoomTypeId: m.local_id, name });
  }
  return out;
}

/** Record a revision we only know by id (webhook arrived, fetch pending). */
export async function recordRevisionStub(db: Db, env: ChannexEnvironment, revisionId: string, propertyId: string | null, bookingId: string | null, hotelId: string | null) {
  await db.from("channex_booking_revisions").upsert({
    revision_id: revisionId, channex_property_id: propertyId, channex_booking_id: bookingId,
    hotel_id: hotelId, environment: env, received_via: "webhook",
  }, { onConflict: "revision_id", ignoreDuplicates: true });
}

export async function ingestRevision(
  db: Db,
  client: ChannexClient,
  rawRevision: unknown,
  via: "webhook" | "feed" | "recovery",
): Promise<IngestResult> {
  const env = client.environment;
  const summary = summarizeRevision(rawRevision);
  if (!summary.revisionId) return { revisionId: "", state: "failed", acked: false, error: "Revision without id" };

  const conn = await loadConnectionByProperty(db, summary.propertyId, env);
  const payload = sanitizeRevisionPayload((rawRevision as any)?.attributes ?? rawRevision);

  // 1. Durable copy first (idempotent on revision_id).
  await db.from("channex_booking_revisions").upsert({
    revision_id: summary.revisionId,
    channex_booking_id: summary.bookingId,
    channex_property_id: summary.propertyId,
    hotel_id: conn?.hotel_id ?? null,
    environment: env,
    revision_status: summary.status,
    ota_name: summary.otaName,
    ota_reservation_code: summary.otaReservationCode,
    arrival_date: summary.arrivalDate,
    departure_date: summary.departureDate,
    received_via: via,
  }, { onConflict: "revision_id", ignoreDuplicates: true });
  // Fill details on a webhook stub without overwriting a processed row.
  await db.from("channex_booking_revisions").update({
    payload, channex_booking_id: summary.bookingId, revision_status: summary.status, hotel_id: conn?.hotel_id ?? null,
    ota_name: summary.otaName, ota_reservation_code: summary.otaReservationCode,
    arrival_date: summary.arrivalDate, departure_date: summary.departureDate, updated_at: new Date().toISOString(),
  }).eq("revision_id", summary.revisionId).in("state", ["received", "failed", "unknown_property", "dry_run"]);

  const { data: row } = await db.from("channex_booking_revisions")
    .select("id,state,acked_at,attempts,hotel_id").eq("revision_id", summary.revisionId).single();
  if (!row) return { revisionId: summary.revisionId, state: "failed", acked: false, error: "Could not persist revision" };
  if (row.acked_at) return { revisionId: summary.revisionId, state: row.state, acked: true };

  let state: string = row.state;

  // 2. Ownership.
  if (!conn) {
    await setState(db, row.id, "unknown_property", "No HotelCare hotel is linked to this Channex property in " + env);
    return { revisionId: summary.revisionId, state: "unknown_property", acked: false };
  }
  if (conn.mode === "off") {
    await setState(db, row.id, "received", "Hotel connection is off: revision kept, not applied or acknowledged");
    return { revisionId: summary.revisionId, state: "received", acked: false };
  }
  if (conn.mode === "dry_run") {
    await setState(db, row.id, "dry_run", null);
    return { revisionId: summary.revisionId, state: "dry_run", acked: false };
  }

  // 3. Apply (live).
  if (state === "received" || state === "failed" || state === "unknown_property" || state === "dry_run") {
    try {
      const plan = planRevision(rawRevision, {
        hotelId: conn.hotel_id, propertyId: String(conn.channex_property_id), currency: conn.currency,
        roomTypes: await roomTypeMap(db, conn.hotel_id),
      });
      const args = plan.action === "new"
        ? { p_action: "new", p_guest: plan.guest, p_rooms: plan.rooms, p_review_reason: plan.reviewReason, p_review_details: plan.reviewDetails }
        : plan.action === "cancelled"
        ? { p_action: "cancelled", p_guest: null, p_rooms: null, p_review_reason: null, p_review_details: plan.reviewDetails }
        : { p_action: "review", p_guest: null, p_rooms: null, p_review_reason: plan.reviewReason, p_review_details: plan.reviewDetails };
      const { data, error } = await db.rpc("channex_apply_revision", { p_revision_row: row.id, ...args });
      if (error) throw new Error(error.message);
      state = String((data as any)?.state ?? "failed");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.from("channex_booking_revisions").update({
        state: "failed", attempts: (row.attempts ?? 0) + 1, last_error: message.slice(0, 500), updated_at: new Date().toISOString(),
      }).eq("id", row.id);
      return { revisionId: summary.revisionId, state: "failed", acked: false, error: message };
    }
  }

  // 4. ACK only after durable save.
  const ackAllowed = mayAckRevision({
    expectedProperty: true,
    permittedTenant: true,
    durableBookingSaved: state === "applied",
    durableReviewSaved: state === "review",
  });
  if (!ackAllowed) return { revisionId: summary.revisionId, state, acked: false };
  return await ackRow(db, client, row.id, summary.revisionId, state);
}

export async function ackRow(db: Db, client: ChannexClient, rowId: string, revisionId: string, state: string): Promise<IngestResult> {
  try {
    await client.ackRevision(revisionId);
    await db.from("channex_booking_revisions").update({ acked_at: new Date().toISOString(), ack_error: null, updated_at: new Date().toISOString() }).eq("id", rowId);
    return { revisionId, state, acked: true };
  } catch (err) {
    const message = err instanceof ChannexError ? err.message : String(err);
    await db.from("channex_booking_revisions").update({ ack_error: message.slice(0, 300), updated_at: new Date().toISOString() }).eq("id", rowId);
    return { revisionId, state, acked: false, error: message };
  }
}

async function setState(db: Db, id: string, state: string, error: string | null) {
  await db.from("channex_booking_revisions").update({ state, last_error: error, updated_at: new Date().toISOString() }).eq("id", id);
}

export async function audit(db: Db, hotelId: string | null, actor: string | null, action: string, details: Record<string, unknown> = {}) {
  await db.from("channex_audit_log").insert({ hotel_id: hotelId, actor, action, details });
}
