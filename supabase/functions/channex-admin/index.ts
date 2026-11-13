/**
 * channex-admin — the only browser-facing Channex entry point.
 *
 * POST { action, hotel_id, ...params } with the user's JWT.
 * Every action re-validates the JWT, the caller's access to THIS hotel and the caller's role.
 * The Channex API key never leaves the server; the browser never sees provider property lists.
 *
 * Roles
 *   view   (status)                                  admin, top management, manager, reception (manager)
 *   manage (setup, mapping, dry run, kill switch)    admin, top management, manager
 *   owner  (live mode, compliance, production)       admin, top management
 *   super admin only: link an existing Channex property UUID, record Channex certification,
 *                     force a second full sync inside 24 h.
 */
import {
  addDays, authorizeHotelCaller, budapestToday, json, corsHeaders, hasRole, serviceDb,
  MANAGE_ROLES, OWNER_ROLES, VIEW_ROLES, type Caller,
} from "../_shared/channex/http.ts";
import { ChannexClient, ChannexError, channexKeyConfigured, type ChannexEnvironment } from "../_shared/channex/client.ts";
import { FULL_SYNC_DAYS, planAvailability, planRestrictions, type RateChangeRow } from "../_shared/channex/ariPlan.ts";
import { compareAvailability, planContentSync, type RoomSettings } from "../_shared/channex/setup.ts";
import { audit, ingestRevision } from "../_shared/channex/bookingProcessor.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Conn = Record<string, any>;

const REVIEW_ROLES = [...MANAGE_ROLES, "reception_manager"];
const COMPLIANCE_FIELDS = ["ntak_reporting_path", "viza_document_scan_confirmed", "tax_settings_confirmed", "dpa_signed", "single_publisher_confirmed"] as const;
const NTAK_PATHS = ["unconfirmed", "hotelcare_registered", "previo_receives_bookings", "other_registered_software"];
const getEnv = (k: string) => Deno.env.get(k);

class UserError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const forbidden = () => new UserError("You do not have permission for this Channex action", 403);
const need = (c: Caller, roles: string[]) => { if (!hasRole(c, roles)) throw forbidden(); };

async function loadConn(db: Db, hotelId: string): Promise<Conn | null> {
  const { data, error } = await db.from("channex_connections").select("*").eq("hotel_id", hotelId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
async function requireConn(db: Db, hotelId: string): Promise<Conn> {
  const conn = await loadConn(db, hotelId);
  if (!conn) throw new UserError("Set up the Channex connection for this hotel first");
  return conn;
}
function clientFor(conn: Conn): ChannexClient {
  try { return ChannexClient.fromEnv(conn.environment as ChannexEnvironment, getEnv); }
  catch { throw new UserError(`The Channex ${conn.environment} API key is not configured on the server yet`, 409); }
}
async function updateConn(db: Db, hotelId: string, patch: Record<string, unknown>) {
  const { data, error } = await db.from("channex_connections").update({ ...patch, updated_at: new Date().toISOString() })
    .eq("hotel_id", hotelId).select("*").single();
  if (error) {
    if (error.code === "23514" || /check constraint/i.test(error.message)) throw new UserError(gateMessage(error.message), 409);
    throw new Error(error.message);
  }
  return data as Conn;
}
function gateMessage(raw: string): string {
  if (raw.includes("channex_staging_live_sandbox_only")) return "Staging can only go live on a hotel marked as a sandbox/test hotel.";
  if (raw.includes("channex_production_live_gate")) return "Production live is blocked until the Hungarian compliance checklist, Channex certification and owner approval are all complete.";
  return "The change was rejected by a safety rule.";
}

export function productionGate(conn: Conn) {
  return {
    ntak: conn.ntak_reporting_path && conn.ntak_reporting_path !== "unconfirmed",
    viza: conn.viza_document_scan_confirmed === true,
    tax: conn.tax_settings_confirmed === true,
    dpa: conn.dpa_signed === true,
    single_publisher: conn.single_publisher_confirmed === true,
    certified: Boolean(conn.certified_at),
    owner_approved: Boolean(conn.owner_approved_at),
    not_sandbox: conn.is_sandbox_hotel !== true,
  };
}

/** Organization and display name of the hotel itself (never the caller's org: super admins span orgs). */
async function hotelIdentity(db: Db, hotelId: string): Promise<{ slug: string | null; name: string | null }> {
  const { data: cfg } = await db.from("hotel_configurations").select("hotel_name,organization_id").eq("hotel_id", hotelId).maybeSingle();
  let slug: string | null = null;
  if (cfg?.organization_id) {
    const { data: org } = await db.from("organizations").select("slug").eq("id", cfg.organization_id).maybeSingle();
    slug = org?.slug ?? null;
  }
  if (!slug) {
    const { data: rt } = await db.from("room_types").select("organization_slug").eq("hotel_id", hotelId).limit(1).maybeSingle();
    slug = rt?.organization_slug ?? null;
  }
  return { slug, name: cfg?.hotel_name ?? null };
}

async function mappings(db: Db, hotelId: string) {
  const { data } = await db.from("channex_mappings").select("id,kind,local_id,channex_id,channex_title,updated_at").eq("hotel_id", hotelId);
  return data ?? [];
}

// ---------------------------------------------------------------- full sync
async function enqueueFullSync(db: Db, conn: Conn, actor: string | null, reason: string) {
  const today = budapestToday();
  const to = addDays(today, FULL_SYNC_DAYS - 1);
  const propertyId = String(conn.channex_property_id);

  const { data: avail, error: availErr } = await db.rpc("channex_room_type_availability", { p_hotel_id: conn.hotel_id, p_from: today, p_to: to });
  if (availErr) throw new Error(availErr.message);
  const availability = planAvailability(propertyId, avail ?? [], today);

  const { data: rates, error: rateErr } = await db.rpc("channex_full_sync_rates", { p_hotel_id: conn.hotel_id, p_from: today, p_to: to });
  if (rateErr) throw new Error(rateErr.message);
  const rows: RateChangeRow[] = (rates ?? []).map((r: any, i: number) => {
    const patch: Record<string, unknown> = { rate: Number(r.price).toFixed(2) };
    if (r.min_stay && Number(r.min_stay) > 0) patch.min_stay_arrival = Number(r.min_stay);
    patch.closed_to_arrival = r.closed_to_arrival === true;
    patch.closed_to_departure = r.closed_to_departure === true;
    return { id: i + 1, room_type_id: r.room_type_id, stay_date: r.stay_date, currency: r.currency, patch };
  });
  const maps = await mappings(db, conn.hotel_id);
  const ratePlanByRoomType = new Map<string, string>(maps.filter((m: any) => m.kind === "rate_plan").map((m: any) => [m.local_id, m.channex_id]));
  const restrictions = planRestrictions(rows, { propertyId, currency: conn.currency, today, ratePlanByRoomType });

  const status = conn.kill_switch ? "blocked" : conn.mode === "live" ? "pending" : "dry_run";
  const outbox = [];
  if (availability.length) outbox.push({ kind: "availability", values: availability });
  if (restrictions.values.length) outbox.push({ kind: "restrictions", values: restrictions.values });
  if (outbox.length) {
    const { error } = await db.from("channex_ari_outbox").insert(outbox.map((o) => ({
      hotel_id: conn.hotel_id, kind: o.kind, mode: conn.mode === "live" ? "live" : "dry_run",
      environment: conn.environment, is_full_sync: true, values: o.values, value_count: o.values.length, status,
    })));
    if (error) throw new Error(error.message);
  }
  const summary = {
    reason, availability_ranges: availability.length, restriction_ranges: restrictions.values.length,
    nights_with_price: rows.length, skipped_rates: restrictions.skipped.length, status,
  };
  await audit(db, conn.hotel_id, actor, "full_sync_enqueued", summary);
  return summary;
}

// ---------------------------------------------------------------- actions
type Ctx = { db: Db; caller: Caller; hotelId: string; body: Record<string, any> };

async function status({ db, caller, hotelId }: Ctx) {
  need(caller, VIEW_ROLES);
  const conn = await loadConn(db, hotelId);
  const [{ data: roomTypes }, maps, { data: outbox }, { data: cases }, { data: auditRows }] = await Promise.all([
    db.from("room_types").select("id,name,num_rooms,is_sellable").eq("hotel_id", hotelId).order("sort_order"),
    mappings(db, hotelId),
    db.from("channex_ari_outbox").select("id,kind,mode,environment,status,is_full_sync,value_count,attempts,task_ids,warnings,last_error,created_at,sent_at")
      .eq("hotel_id", hotelId).order("created_at", { ascending: false }).limit(15),
    db.from("channex_review_cases").select("id,reason,details,status,reservation_ids,created_at,resolution_note,resolved_at")
      .eq("hotel_id", hotelId).order("created_at", { ascending: false }).limit(20),
    db.from("channex_audit_log").select("id,action,details,created_at").eq("hotel_id", hotelId).order("created_at", { ascending: false }).limit(20),
  ]);
  const { data: pms } = await db.rpc("has_pms_access", { user_id: caller.userId });
  let revisions: unknown[] = [];
  if (pms === true || caller.isSuperAdmin) {
    const { data } = await db.from("channex_booking_revisions")
      .select("revision_id,revision_status,ota_name,ota_reservation_code,arrival_date,departure_date,state,received_via,acked_at,last_error,ack_error,created_at")
      .eq("hotel_id", hotelId).order("created_at", { ascending: false }).limit(20);
    revisions = data ?? [];
  }
  const { data: unacked } = await db.from("channex_booking_revisions").select("created_at")
    .eq("hotel_id", hotelId).is("acked_at", null).in("state", ["received", "failed", "applied", "review"]).order("created_at").limit(1);
  const oldestUnackedMin = unacked?.[0] ? Math.round((Date.now() - Date.parse(unacked[0].created_at)) / 60000) : null;

  return {
    hotel_name: (await hotelIdentity(db, hotelId)).name,
    connection: conn,
    gate: conn ? productionGate(conn) : null,
    keys: { staging: channexKeyConfigured("staging", getEnv), production: channexKeyConfigured("production", getEnv) },
    webhook_url: conn ? `${getEnv("SUPABASE_URL")}/functions/v1/channex-webhook?env=${conn.environment}` : null,
    room_types: roomTypes ?? [],
    mappings: maps,
    outbox: outbox ?? [],
    revisions,
    review_cases: cases ?? [],
    audit: auditRows ?? [],
    health: { oldest_unacked_minutes: oldestUnackedMin },
    permissions: {
      manage: hasRole(caller, MANAGE_ROLES), owner: hasRole(caller, OWNER_ROLES),
      review: hasRole(caller, REVIEW_ROLES), super_admin: caller.isSuperAdmin,
    },
  };
}

async function health({ db, caller, hotelId, body }: Ctx) {
  need(caller, MANAGE_ROLES);
  const conn = await loadConn(db, hotelId);
  const env = (conn?.environment ?? (body.environment === "production" ? "production" : "staging")) as ChannexEnvironment;
  if (!channexKeyConfigured(env, getEnv)) return { ok: false, environment: env, message: `No ${env} API key configured on the server` };
  const started = Date.now();
  try {
    const client = ChannexClient.fromEnv(env, getEnv);
    await client.probe();
    let property: unknown = null;
    if (conn?.channex_property_id) {
      const p = await client.getProperty(conn.channex_property_id);
      property = { reachable: true, currency: p.data?.attributes?.currency ?? null, title: p.data?.attributes?.title ?? null };
    }
    await audit(db, hotelId, caller.userId, "health_check", { environment: env, ok: true });
    return { ok: true, environment: env, latency_ms: Date.now() - started, property };
  } catch (err) {
    const message = err instanceof ChannexError ? err.message : "Channex could not be reached";
    await audit(db, hotelId, caller.userId, "health_check", { environment: env, ok: false, message });
    return { ok: false, environment: env, message };
  }
}

async function saveConnection({ db, caller, hotelId, body }: Ctx) {
  need(caller, MANAGE_ROLES);
  const existing = await loadConn(db, hotelId);
  const environment: ChannexEnvironment = body.environment === "production" ? "production" : "staging";
  const isSandbox = body.is_sandbox_hotel === true;
  const currency = String(body.currency ?? existing?.currency ?? "EUR").toUpperCase();
  const primaryOccupancy = Math.floor(Number(body.primary_occupancy ?? existing?.primary_occupancy ?? 2));
  if (!/^[A-Z]{3}$/.test(currency)) throw new UserError("Currency must be a 3-letter ISO code");
  if (!(primaryOccupancy >= 1 && primaryOccupancy <= 20)) throw new UserError("Primary occupancy must be between 1 and 20");
  if ((environment === "production" || isSandbox) && !hasRole(caller, OWNER_ROLES)) throw forbidden();

  if (existing) {
    if (existing.mode !== "off") throw new UserError("Switch the connection off before changing its settings");
    if (existing.channex_property_id && (existing.environment !== environment || existing.currency !== currency))
      throw new UserError("Environment and currency are fixed once a Channex property is linked");
    const conn = await updateConn(db, hotelId, { environment, is_sandbox_hotel: isSandbox, currency, primary_occupancy: primaryOccupancy });
    await audit(db, hotelId, caller.userId, "connection_updated", { environment, is_sandbox_hotel: isSandbox, currency, primary_occupancy: primaryOccupancy });
    return { connection: conn };
  }

  const slug = (await hotelIdentity(db, hotelId)).slug ?? (caller.isSuperAdmin ? null : caller.organizationSlug);
  if (!slug) throw new UserError("Could not determine the organization for this hotel");
  const { data, error } = await db.from("channex_connections").insert({
    hotel_id: hotelId, organization_slug: slug, environment, is_sandbox_hotel: isSandbox,
    currency, primary_occupancy: primaryOccupancy, mode: "off", created_by: caller.userId,
  }).select("*").single();
  if (error) throw new Error(error.message);
  await audit(db, hotelId, caller.userId, "connection_created", { environment, is_sandbox_hotel: isSandbox, currency });
  return { connection: data };
}

async function createProperty({ db, caller, hotelId, body }: Ctx) {
  need(caller, MANAGE_ROLES);
  const conn = await requireConn(db, hotelId);
  if (conn.channex_property_id) throw new UserError("This hotel is already linked to a Channex property");
  const title = String(body.title ?? "").trim();
  if (title.length < 2 || title.length > 120) throw new UserError("Enter the property name as guests should see it");
  const client = clientFor(conn);
  const attrs: Record<string, unknown> = { title, currency: conn.currency, country: "HU", timezone: conn.timezone || "Europe/Budapest" };
  for (const k of ["email", "phone", "city", "address", "zip_code", "website"]) {
    const v = typeof body[k] === "string" ? body[k].trim() : "";
    if (v) attrs[k] = v.slice(0, 200);
  }
  const created = await client.createProperty(attrs);
  const id = String(created.data?.id ?? "");
  if (!id) throw new Error("Channex did not return a property id");
  // Persist immediately so a retry never creates a second property.
  await updateConn(db, hotelId, { channex_property_id: id, last_error: null });
  const readback = await client.getProperty(id);
  const remoteCurrency = String(readback.data?.attributes?.currency ?? "").toUpperCase();
  if (remoteCurrency && remoteCurrency !== conn.currency) {
    await updateConn(db, hotelId, { last_error: `Channex property currency ${remoteCurrency} differs from ${conn.currency}` });
  }
  await audit(db, hotelId, caller.userId, "property_created", { channex_property_id: id, environment: conn.environment });
  return { channex_property_id: id, currency: remoteCurrency || conn.currency };
}

async function linkProperty({ db, caller, hotelId, body }: Ctx) {
  // Linking an arbitrary UUID on a shared key could attach another tenant's property: super admin only.
  if (!caller.isSuperAdmin) throw forbidden();
  const conn = await requireConn(db, hotelId);
  if (conn.mode !== "off") throw new UserError("Switch the connection off first");
  const id = String(body.channex_property_id ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new UserError("Enter a valid Channex property UUID");
  const client = clientFor(conn);
  const p = await client.getProperty(id).catch((err) => {
    throw new UserError(err instanceof ChannexError && err.status === 404 ? "This API key cannot see that property" : "Could not verify the property", 409);
  });
  const remoteCurrency = String(p.data?.attributes?.currency ?? "").toUpperCase();
  if (remoteCurrency !== conn.currency) throw new UserError(`Property currency ${remoteCurrency} does not match ${conn.currency}`, 409);
  await updateConn(db, hotelId, { channex_property_id: id, last_error: null });
  await audit(db, hotelId, caller.userId, "property_linked", { channex_property_id: id, environment: conn.environment });
  return { channex_property_id: id };
}

async function syncContent({ db, caller, hotelId, body }: Ctx) {
  need(caller, MANAGE_ROLES);
  const conn = await requireConn(db, hotelId);
  if (!conn.channex_property_id) throw new UserError("Create or link the Channex property first");
  const client = clientFor(conn);
  const propertyId = String(conn.channex_property_id);
  const selected: string[] | null = Array.isArray(body.room_type_ids) ? body.room_type_ids.map(String) : null;

  const { data: locals } = await db.from("room_types").select("id,name,num_rooms,is_sellable").eq("hotel_id", hotelId);
  const chosen = (locals ?? []).filter((l: any) => !selected || selected.includes(l.id));
  const [rooms, rates] = await Promise.all([client.listRoomTypes(propertyId), client.listRatePlans(propertyId)]);
  const onlyThisProperty = (list: any[]) => (list ?? []).filter((e) => !e?.attributes?.property_id || e.attributes.property_id === propertyId);

  const plan = planContentSync({
    propertyId, currency: conn.currency, primaryOccupancy: conn.primary_occupancy,
    locals: chosen, mappings: await mappings(db, hotelId),
    remoteRoomTypes: onlyThisProperty(rooms.data), remoteRatePlans: onlyThisProperty(rates.data),
    settings: (body.room_settings ?? {}) as RoomSettings,
  });

  const saveMap = async (kind: "room_type" | "rate_plan", localId: string, channexId: string, title: string) => {
    const { error } = await db.from("channex_mappings").upsert(
      { hotel_id: hotelId, kind, local_id: localId, channex_id: channexId, channex_title: title, updated_at: new Date().toISOString() },
      { onConflict: "hotel_id,kind,local_id" },
    );
    if (error) throw new Error(`Saving ${kind} mapping failed: ${error.message}`);
  };

  const report: Record<string, unknown>[] = [];
  for (const item of plan.items) {
    const line: Record<string, unknown> = { room_type: item.local.name };
    try {
      let roomTypeId: string | null = null;
      const rt = item.roomType;
      if (rt.kind === "error") throw new Error(rt.message);
      if (rt.kind === "create") {
        const res = await client.createRoomType(rt.attrs);
        roomTypeId = String(res.data?.id ?? "");
        if (!roomTypeId) throw new Error("Channex did not return a room type id");
      } else {
        roomTypeId = rt.channexId;
        if (rt.kind === "update") await client.updateRoomType(rt.channexId, rt.attrs);
      }
      await saveMap("room_type", item.local.id, roomTypeId, item.local.name);
      line.room = rt.kind;

      const rp = item.ratePlan;
      let ratePlanId: string;
      if (rp.kind === "error") throw new Error(rp.message);
      if (rp.kind === "create" || rp.kind === "create_after_room") {
        const attrs = rp.kind === "create" ? rp.attrs : rp.build(roomTypeId);
        const res = await client.createRatePlan(attrs);
        ratePlanId = String(res.data?.id ?? "");
        if (!ratePlanId) throw new Error("Channex did not return a rate plan id");
      } else if (rp.kind === "keep" || rp.kind === "adopt") {
        ratePlanId = rp.channexId;
      } else {
        throw new Error("Unexpected rate plan step");
      }
      await saveMap("rate_plan", item.local.id, ratePlanId, `${item.local.name} – Standard`);
      line.rate_plan = rp.kind === "create_after_room" ? "create" : rp.kind;
      line.ok = true;
    } catch (err) {
      line.ok = false;
      line.error = err instanceof Error ? err.message : String(err);
    }
    report.push(line);
  }

  // Readback: every stored mapping must exist under this property.
  const [rooms2, rates2] = await Promise.all([client.listRoomTypes(propertyId), client.listRatePlans(propertyId)]);
  const remoteIds = new Set([...(rooms2.data ?? []), ...(rates2.data ?? [])].map((e: any) => String(e.id)));
  const missing = (await mappings(db, hotelId)).filter((m: any) => !remoteIds.has(String(m.channex_id)));
  await audit(db, hotelId, caller.userId, "content_synced", { report, skipped: plan.skipped.map((s) => ({ room_type: s.local.name, reason: s.reason })), missing_after_readback: missing.length });
  return { report, skipped: plan.skipped.map((s) => ({ room_type: s.local.name, reason: s.reason })), missing_after_readback: missing };
}

async function registerWebhook({ db, caller, hotelId }: Ctx) {
  need(caller, MANAGE_ROLES);
  const conn = await requireConn(db, hotelId);
  if (!conn.channex_property_id) throw new UserError("Create or link the Channex property first");
  const { data: secret } = await db.rpc("get_channex_webhook_secret");
  if (!secret) throw new Error("Webhook secret missing in Vault");
  const client = clientFor(conn);
  const attrs = {
    property_id: conn.channex_property_id,
    callback_url: `${getEnv("SUPABASE_URL")}/functions/v1/channex-webhook?env=${conn.environment}`,
    event_mask: "*",
    // Channex webhooks are not signed: authenticate with a long random secret in a custom header.
    headers: { "x-hotelcare-webhook-secret": String(secret) },
    is_active: true,
    // Notification only: we always pull the full revision, so no guest data travels in the webhook.
    send_data: false,
  };
  let id = conn.channex_webhook_id as string | null;
  if (id) await client.updateWebhook(id, attrs);
  else {
    const res = await client.createWebhook(attrs);
    id = String(res.data?.id ?? "");
    if (!id) throw new Error("Channex did not return a webhook id");
    await updateConn(db, hotelId, { channex_webhook_id: id });
  }
  await audit(db, hotelId, caller.userId, "webhook_registered", { channex_webhook_id: id });
  return { channex_webhook_id: id };
}

async function setCompliance({ db, caller, hotelId, body }: Ctx) {
  need(caller, OWNER_ROLES);
  await requireConn(db, hotelId);
  const patch: Record<string, unknown> = {};
  for (const k of COMPLIANCE_FIELDS) {
    if (body[k] === undefined) continue;
    if (k === "ntak_reporting_path") {
      if (!NTAK_PATHS.includes(body[k])) throw new UserError("Unknown NTAK reporting option");
      patch[k] = body[k];
    } else patch[k] = body[k] === true;
  }
  if (!Object.keys(patch).length) throw new UserError("Nothing to update");
  const conn = await updateConn(db, hotelId, patch);
  await audit(db, hotelId, caller.userId, "compliance_updated", patch);
  return { connection: conn, gate: productionGate(conn) };
}

async function recordCertification({ db, caller, hotelId, body }: Ctx) {
  if (!caller.isSuperAdmin) throw forbidden();
  const conn = await updateConn(db, hotelId, { certified_at: body.certified === false ? null : new Date().toISOString() });
  await audit(db, hotelId, caller.userId, body.certified === false ? "certification_revoked" : "certification_recorded", { note: String(body.note ?? "").slice(0, 500) });
  return { connection: conn };
}

async function ownerApproval({ db, caller, hotelId, body }: Ctx) {
  need(caller, OWNER_ROLES);
  const approve = body.approve !== false;
  const current = await requireConn(db, hotelId);
  if (approve && current.mode === "live" && current.environment === "production") throw new UserError("Already live");
  const conn = await updateConn(db, hotelId, approve
    ? { owner_approved_by: caller.userId, owner_approved_at: new Date().toISOString() }
    : { owner_approved_by: null, owner_approved_at: null, ...(current.environment === "production" && current.mode === "live" ? { mode: "dry_run" } : {}) });
  await audit(db, hotelId, caller.userId, approve ? "owner_approved" : "owner_approval_revoked", {});
  return { connection: conn };
}

async function setMode({ db, caller, hotelId, body }: Ctx) {
  const mode = String(body.mode);
  if (!["off", "dry_run", "live"].includes(mode)) throw new UserError("Unknown mode");
  need(caller, mode === "live" ? OWNER_ROLES : MANAGE_ROLES);
  const conn = await requireConn(db, hotelId);
  if (mode !== "off") {
    if (!conn.channex_property_id) throw new UserError("Create or link the Channex property first");
    const maps = await mappings(db, hotelId);
    if (!maps.some((m: any) => m.kind === "room_type") || !maps.some((m: any) => m.kind === "rate_plan"))
      throw new UserError("Map at least one room type and rate plan first");
    if (!channexKeyConfigured(conn.environment, getEnv)) throw new UserError(`The ${conn.environment} API key is not configured on the server`, 409);
  }
  if (mode === "live" && body.confirm !== "GO LIVE") throw new UserError('Type "GO LIVE" to confirm');
  const updated = await updateConn(db, hotelId, { mode, last_error: null });
  await audit(db, hotelId, caller.userId, "mode_changed", { from: conn.mode, to: mode, environment: conn.environment });

  let fullSync: unknown = null;
  // Channex: push authoritative inventory when a property is (re)connected; new room types start at 0.
  if (mode !== "off" && conn.mode !== mode) fullSync = await enqueueFullSync(db, updated, caller.userId, `mode ${conn.mode} -> ${mode}`);
  if (mode === "off") {
    await db.from("channex_ari_outbox").update({ status: "blocked", last_error: "Connection switched off", updated_at: new Date().toISOString() })
      .eq("hotel_id", hotelId).eq("status", "pending");
  }
  return { connection: updated, full_sync: fullSync, warning: mode === "live" && !updated.channex_webhook_id ? "No webhook registered: bookings arrive through the 5-minute feed only." : null };
}

async function killSwitch({ db, caller, hotelId, body }: Ctx) {
  need(caller, MANAGE_ROLES);
  const on = body.on === true;
  const conn = await requireConn(db, hotelId);
  const updated = await updateConn(db, hotelId, { kill_switch: on });
  let fullSync: unknown = null;
  if (on) {
    // Queued snapshots would be stale by the time the switch is released: never send them.
    await db.from("channex_ari_outbox").update({ status: "blocked", last_error: "Kill switch", updated_at: new Date().toISOString() })
      .eq("hotel_id", hotelId).in("status", ["pending"]);
  } else if (conn.kill_switch && updated.mode !== "off") {
    fullSync = await enqueueFullSync(db, updated, caller.userId, "kill switch released");
  }
  await audit(db, hotelId, caller.userId, on ? "kill_switch_on" : "kill_switch_off", {});
  return { connection: updated, full_sync: fullSync };
}

async function fullSync({ db, caller, hotelId, body }: Ctx) {
  need(caller, MANAGE_ROLES);
  const conn = await requireConn(db, hotelId);
  if (conn.mode === "off") throw new UserError("Switch to dry run or live first");
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: recent } = await db.from("channex_ari_outbox").select("id").eq("hotel_id", hotelId).eq("is_full_sync", true)
    .neq("status", "blocked").gte("created_at", since).limit(1);
  if (recent?.length && !(body.force === true && caller.isSuperAdmin))
    throw new UserError("A full sync already ran in the last 24 hours. Channex asks for deltas only; full sync at most daily.", 429);
  return await enqueueFullSync(db, conn, caller.userId, body.force ? "manual (forced)" : "manual");
}

async function verifyAri({ db, caller, hotelId, body }: Ctx) {
  need(caller, MANAGE_ROLES);
  const conn = await requireConn(db, hotelId);
  if (!conn.channex_property_id) throw new UserError("No Channex property linked");
  const days = Math.min(Math.max(Math.floor(Number(body.days ?? 30)), 1), 60);
  const from = budapestToday();
  const to = addDays(from, days - 1);
  const client = clientFor(conn);
  const { data: expected, error } = await db.rpc("channex_room_type_availability", { p_hotel_id: hotelId, p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  const remote = await client.readAvailability(conn.channex_property_id, from, to);
  const availability = compareAvailability((expected ?? []).map((r: any) => ({ ...r, channex_room_type_id: String(r.channex_room_type_id) })), remote.data);

  const { data: localRates } = await db.rpc("channex_full_sync_rates", { p_hotel_id: hotelId, p_from: from, p_to: to });
  const remoteR = await client.readRestrictions(conn.channex_property_id, from, to);
  const maps = await mappings(db, hotelId);
  const plan = new Map<string, string>(maps.filter((m: any) => m.kind === "rate_plan").map((m: any) => [String(m.local_id), String(m.channex_id)]));
  const rateMismatches: unknown[] = [];
  for (const r of localRates ?? []) {
    const rp = plan.get(r.room_type_id);
    const got = rp ? (remoteR.data as any)?.[rp]?.[r.stay_date]?.rate : undefined;
    if (got === undefined || Number(got).toFixed(2) !== Number(r.price).toFixed(2))
      rateMismatches.push({ rate_plan_id: rp, date: r.stay_date, hotelcare: Number(r.price).toFixed(2), channex: got ?? null });
  }
  const result = {
    days, availability: { checked: availability.checked, mismatches: availability.mismatches.slice(0, 50), mismatch_count: availability.mismatches.length },
    rates: { checked: (localRates ?? []).length, mismatches: rateMismatches.slice(0, 50), mismatch_count: rateMismatches.length },
  };
  await audit(db, hotelId, caller.userId, "ari_verified", { days, availability_mismatches: availability.mismatches.length, rate_mismatches: rateMismatches.length });
  return result;
}

async function resolveReview({ db, caller, hotelId, body }: Ctx) {
  need(caller, REVIEW_ROLES);
  const status = body.status === "dismissed" ? "dismissed" : "resolved";
  const note = String(body.note ?? "").trim();
  if (note.length < 3) throw new UserError("Add a short note about what was done");
  const { data, error } = await db.from("channex_review_cases")
    .update({ status, resolution_note: note.slice(0, 1000), resolved_by: caller.userId, resolved_at: new Date().toISOString() })
    .eq("id", String(body.case_id)).eq("hotel_id", hotelId).eq("status", "open").select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new UserError("Review case not found or already closed", 404);
  await audit(db, hotelId, caller.userId, "review_" + status, { case_id: data.id });
  return { ok: true };
}

async function recoverBookings({ db, caller, hotelId, body }: Ctx) {
  need(caller, MANAGE_ROLES);
  const conn = await requireConn(db, hotelId);
  if (conn.mode !== "live" || !conn.channex_property_id) throw new UserError("Recovery runs only for a live connection");
  const since = new Date(String(body.since ?? ""));
  if (Number.isNaN(since.getTime())) throw new UserError("Choose when the outage started");
  if (Date.now() - since.getTime() > 14 * 86400000) throw new UserError("Recovery is limited to the last 14 days");
  const client = clientFor(conn);
  const counts: Record<string, number> = {};
  let page = 1;
  for (; page <= 20; page++) {
    const res = await client.listRevisionsSince(conn.channex_property_id, since.toISOString(), page);
    const items = res.data ?? [];
    for (const item of items) {
      const r = await ingestRevision(db, client, item, "recovery");
      counts[r.state] = (counts[r.state] ?? 0) + 1;
    }
    if (items.length < 100) break;
  }
  await audit(db, hotelId, caller.userId, "bookings_recovered", { since: since.toISOString(), counts, pages: page });
  return { since: since.toISOString(), counts };
}

const ACTIONS: Record<string, (ctx: Ctx) => Promise<unknown>> = {
  status, health, save_connection: saveConnection, create_property: createProperty, link_property: linkProperty,
  sync_content: syncContent, register_webhook: registerWebhook, set_compliance: setCompliance,
  record_certification: recordCertification, owner_approval: ownerApproval, set_mode: setMode,
  kill_switch: killSwitch, full_sync: fullSync, verify_ari: verifyAri, resolve_review: resolveReview,
  recover_bookings: recoverBookings,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
  const hotelId = typeof body.hotel_id === "string" ? body.hotel_id.trim() : "";
  const handler = ACTIONS[String(body.action)];
  if (!hotelId || !handler) return json({ ok: false, error: "Unknown action or hotel" }, 400);

  const db = serviceDb();
  const caller = await authorizeHotelCaller(req, db, hotelId);
  if (caller instanceof Response) return caller;
  try {
    const result = await handler({ db, caller, hotelId, body });
    return json({ ok: true, ...(result as Record<string, unknown>) });
  } catch (err) {
    if (err instanceof UserError) return json({ ok: false, error: err.message }, err.status);
    if (err instanceof ChannexError) {
      const message = `Channex rejected the request (${err.status}${err.code ? " " + err.code : ""})`;
      await audit(db, hotelId, caller.userId, "channex_error", { action: body.action, status: err.status, code: err.code, details: err.details }).catch(() => {});
      return json({ ok: false, error: message, details: err.details }, 502);
    }
    console.error("channex-admin", body.action, err instanceof Error ? err.message : err);
    return json({ ok: false, error: "Unexpected server error" }, 500);
  }
});
