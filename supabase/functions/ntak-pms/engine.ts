// deno-lint-ignore-file no-explicit-any
/**
 * NTAK PMS v9 engine: loads HotelCare data, builds and queues messages, sends
 * them signed over mTLS, verifies processing results and keeps the daily
 * closure register. Pure message logic lives in ../_shared/ntak.
 */
import bcrypt from "npm:bcryptjs@2.4.3";
import { STOP_SENDING_KEYS } from "../_shared/ntak/codes.ts";
import { assembleClosure, hasBlockingErrors, type AssembledClosure, type ClosureSettings, type StayGuest, type UnitInfo } from "../_shared/ntak/closure.ts";
import { computeVendegId, isValidSalt, missingIdentityFields } from "../_shared/ntak/guestId.ts";
import { autoIfaStatus } from "../_shared/ntak/ifa.ts";
import {
  addDays, buildBooking, buildDaySources, bookingNumber, DEFAULT_LEDGER_CONFIG, localDate, roomOnDay, toIso2,
  type LedgerConfig, type RawFolioLine, type RawPayment, type RawReservation,
} from "../_shared/ntak/ledger.ts";
import {
  buildAdatszolgaltatasKezdoDatumRequest, buildEllenorzesRequest, buildEsemenyvezereltRequest, buildFoglalasEsemenyRequest,
  buildNapiZarasRequest, escText, xsDateTime, type NtakCommon, type NtakGuest, type NtakStayEvent, type NtakUnit,
} from "../_shared/ntak/messages.ts";
import { parseNtakResponse, type NtakIssue } from "../_shared/ntak/response.ts";
import { nextRetryDelayMinutes, postSoap } from "../_shared/ntak/transport.ts";
import { importSigningKey, signEnvelope, type SignatureProfile } from "../_shared/ntak/wssec.ts";
import { effectiveExpiry } from "../_shared/ntak/x509.ts";
import { ISO3_TO_ISO2 } from "../_shared/viza/country.ts";
import { isInNtakScope, loadNtakScope } from "./scope.ts";

export type Db = any;
export const TZ = "Europe/Budapest";
const HOURLY_SOFT_LIMIT = 900; // NTAK warns above 1000 messages/accommodation/hour (7.7)
const VERIFY_BATCH = 50;

export interface Settings {
  hotel_id: string;
  organization_slug: string;
  enabled: boolean;
  environment: "test" | "production";
  endpoint_url: string | null;
  software_id: string | null;
  software_version: string;
  registration_number: string | null;
  provider_tax_number: string | null;
  registered_room_count: number | null;
  registered_bed_count: number | null;
  accommodation_name: string | null;
  provider_name: string | null;
  unit_scope: "all" | "profiled_only";
  accommodation_class: ClosureSettings["accommodationClass"];
  region: ClosureSettings["region"];
  ifa_type: "SZAZALEKOS" | "TETELES" | "NINCS";
  ifa_rate: number;
  ifa_vat: number;
  accommodation_vat: number;
  signature_profile: SignatureProfile;
  unknown_country_code: string;
  closure_mode: "manual" | "auto";
  auto_close_time: string;
  first_closure_date: string | null;
  backdating_min_date?: string | null;
  allow_backdating?: boolean;
  software_change_date: string | null;
  data_start_date: string | null;
  ledger_config: Record<string, unknown>;
  cert_not_after: string | null;
  sending_blocked_reason: string | null;
  initial_booking_sync_started_at: string | null;
  initial_booking_sync_done_at: string | null;
}

export const today = (now = new Date()) => localDate(now.toISOString(), TZ);

export async function loadSettings(db: Db, hotelId: string): Promise<Settings | null> {
  const { data } = await db.from("ntak_settings").select("*").eq("hotel_id", hotelId).maybeSingle();
  return data ?? null;
}

export function ledgerConfig(s: Settings): LedgerConfig {
  const o = (s.ledger_config ?? {}) as Partial<LedgerConfig>;
  return {
    ...DEFAULT_LEDGER_CONFIG,
    ...o,
    categoryMap: { ...DEFAULT_LEDGER_CONFIG.categoryMap, ...(o.categoryMap ?? {}) },
    paymentMap: { ...DEFAULT_LEDGER_CONFIG.paymentMap, ...(o.paymentMap ?? {}) },
    channelMap: { ...DEFAULT_LEDGER_CONFIG.channelMap, ...(o.channelMap ?? {}) },
    accommodationVat: s.accommodation_vat as LedgerConfig["accommodationVat"],
    timeZone: TZ,
  };
}

export function closureSettings(s: Settings): ClosureSettings {
  return {
    accommodationClass: s.accommodation_class,
    region: s.region,
    registeredRooms: s.registered_room_count,
    registeredBeds: s.registered_bed_count,
    ifa: { type: s.ifa_type, rate: Number(s.ifa_rate) },
    accommodationVat: s.accommodation_vat as ClosureSettings["accommodationVat"],
    ifaVat: s.ifa_vat as ClosureSettings["ifaVat"],
  };
}

/** Problems that prevent any message from being built for this hotel. */
export function configurationProblems(s: Settings): string[] {
  const p: string[] = [];
  const softwareId = s.software_id || Deno.env.get("NTAK_SOFTWARE_ID");
  if (!softwareId) p.push("NTAK software ID (szoftverAzonosito) is not set");
  if (!s.registration_number) p.push("NTAK registration number is not set");
  if (!s.provider_tax_number) p.push("Accommodation provider tax number is not set");
  if (!s.accommodation_name?.trim()) p.push("Accommodation name (szallasNev) is not set");
  if (!s.provider_name?.trim()) p.push("Accommodation provider name (szallashelySzolgaltatoNev) is not set");
  return p;
}

export function common(s: Settings, now = new Date()): NtakCommon {
  return {
    uzenetId: crypto.randomUUID(),
    sentAt: now,
    softwareVersion: s.software_version,
    softwareId: s.software_id || Deno.env.get("NTAK_SOFTWARE_ID") || "",
    registrationNumber: s.registration_number ?? "",
    taxNumber: s.provider_tax_number ?? "",
    accommodationName: s.accommodation_name ?? "",
    providerName: s.provider_name ?? "",
  };
}

async function secret(db: Db, hotelId: string, kind: string): Promise<string | null> {
  const { data, error } = await db.rpc("ntak_get_secret", { _hotel_id: hotelId, _kind: kind });
  if (error) throw new Error(`Vault read failed: ${error.message}`);
  return data ?? null;
}

export async function credentials(db: Db, hotelId: string): Promise<{ certPem: string; keyPem: string } | null> {
  const [certPem, keyPem] = await Promise.all([secret(db, hotelId, "cert"), secret(db, hotelId, "key")]);
  return certPem && keyPem ? { certPem, keyPem } : null;
}

/** The accommodation's constant BCrypt salt (created once, kept in Vault). */
export async function guestSalt(db: Db, hotelId: string): Promise<string> {
  const existing = await secret(db, hotelId, "salt");
  if (existing && isValidSalt(existing)) return existing;
  const salt = bcrypt.genSaltSync(10).slice(-22);
  const { error } = await db.rpc("ntak_put_secret", { _hotel_id: hotelId, _kind: "salt", _value: salt });
  if (error) throw new Error(`Vault write failed: ${error.message}`);
  return salt;
}

// ---------------------------------------------------------------------------
// Guests

const SEX: Record<string, NtakGuest["sex"]> = { female: "NO", f: "NO", male: "FERFI", m: "FERFI" };

/** Stay guests with their stored (or newly generated) NTAK guest ids. */
export async function loadStayGuests(db: Db, hotelId: string, reservations: RawReservation[]): Promise<Map<string, StayGuest[]>> {
  const out = new Map<string, StayGuest[]>();
  const ids = reservations.map((r) => r.id);
  if (!ids.length) return out;
  let linksResult = await db.from("reservation_guests")
    .select("reservation_id,guest_id,is_primary,ifa_status,arrived_at,departed_at,room_id,stay_state").in("reservation_id", ids);
  if (linksResult.error) {
    // Before Phase 3 migration, remain compatible with Phase-2 guest links.
    linksResult = await db.from("reservation_guests")
      .select("reservation_id,guest_id,is_primary,ifa_status").in("reservation_id", ids);
  }
  if (linksResult.error) throw new Error("Unable to load reservation guests: " + linksResult.error.message);
  const linkRows: any[] = linksResult.data ?? [];
  for (const r of reservations) {
    if (r.guest_id && !linkRows.some((l) => l.reservation_id === r.id && l.guest_id === r.guest_id)) {
      linkRows.push({ reservation_id: r.id, guest_id: r.guest_id, is_primary: true, ifa_status: null, stay_state: undefined });
    }
  }
  const guestIds = [...new Set(linkRows.map((l) => l.guest_id))];
  if (!guestIds.length) return out;
  const [{ data: guests }, { data: stored }] = await Promise.all([
    db.from("guests").select("id,first_name,last_name,birth_place,date_of_birth,gender,nationality,country,postal_code").in("id", guestIds),
    db.from("ntak_guest_ids").select("guest_id,vendeg_id").eq("hotel_id", hotelId).in("guest_id", guestIds),
  ]);
  const storedIds = new Map<string, string>((stored ?? []).map((s: any) => [s.guest_id, s.vendeg_id]));
  const byId = new Map<string, any>((guests ?? []).map((g: any) => [g.id, g]));
  let salt: string | null = null;
  const fresh: { hotel_id: string; guest_id: string; vendeg_id: string }[] = [];

  for (const link of linkRows) {
    const g = byId.get(link.guest_id);
    if (!g) continue;
    const identity = { lastName: g.last_name, firstName: g.first_name, birthPlace: g.birth_place, birthDate: g.date_of_birth };
    const missing = missingIdentityFields(identity);
    let vendegId = storedIds.get(g.id) ?? null;
    if (!vendegId && !missing.length) {
      salt ??= await guestSalt(db, hotelId);
      vendegId = await computeVendegId(identity, salt, (d, s) => bcrypt.hashSync(d, s));
      storedIds.set(g.id, vendegId);
      fresh.push({ hotel_id: hotelId, guest_id: g.id, vendeg_id: vendegId });
    }
    const nationality = toIso2(g.nationality, ISO3_TO_ISO2);
    const residence = toIso2(g.country, ISO3_TO_ISO2) ?? nationality;
    const list = out.get(link.reservation_id) ?? [];
    list[link.is_primary ? "unshift" : "push"]({
      guestId: g.id,
      name: `${g.last_name ?? ""} ${g.first_name ?? ""}`.trim(),
      vendegId,
      missingIdentity: missing,
      birthDate: g.date_of_birth ?? null,
      sex: SEX[String(g.gender ?? "").toLowerCase()] ?? "EGYEB_VAGY_NEM_ISMERT",
      nationality,
      residenceCountry: residence,
      postalCode: g.postal_code ?? "",
      ifaStatus: link.ifa_status ?? null,
      arrivedAt: link.arrived_at ?? null,
      departedAt: link.departed_at ?? null,
      roomId: link.room_id ?? null,
      stayState: link.stay_state ?? undefined,
    });
    out.set(link.reservation_id, list);
  }
  if (fresh.length) await db.from("ntak_guest_ids").upsert(fresh, { onConflict: "hotel_id,guest_id", ignoreDuplicates: true });
  return out;
}

const toNtakGuest = (g: StayGuest, day: string, autoStatus: (b: string | null, d: string) => string): NtakGuest | null =>
  g.vendegId && g.birthDate && g.nationality && g.residenceCountry
    ? { vendegId: g.vendegId, birthYear: Number(g.birthDate.slice(0, 4)), sex: g.sex ?? "EGYEB_VAGY_NEM_ISMERT", nationality: g.nationality, residenceCountry: g.residenceCountry, postalCode: g.postalCode ?? "", ifaStatus: g.ifaStatus || autoStatus(g.birthDate, day) }
    : null;

// ---------------------------------------------------------------------------
// Units

const ROOM_STATE: Record<string, UnitInfo["state"]> = { out_of_order: "ooo", out_of_service: "oos", maintenance: "oos", blocked: "oos" };

export async function loadUnits(db: Db, hotelId: string, day: string): Promise<UnitInfo[]> {
  // Historical closures MUST use the dated, audited source. A live rooms.status
  // is only a fallback for TODAY when no dated state has been recorded.
  const [{ data, error: unitError }, { data: periods, error: periodError }] = await Promise.all([
    db.from("ntak_unit_profiles")
      .select("room_id,building,room_number,unit_type,single_beds,double_beds,extra_beds,rooms(status)")
      .eq("hotel_id", hotelId).eq("active", true).order("room_number"),
    db.from("room_state_periods")
      .select("room_id,state").eq("hotel_id", hotelId)
      .lte("from_date", day).gte("to_date", day),
  ]);
  // Incomplete room histories must never silently produce an accepted closure.
  if (unitError || periodError) {
    throw new Error("NTAK_ROOM_STATE_HISTORY_UNAVAILABLE: " + (unitError?.message ?? periodError?.message ?? "unknown"));
  }
  const states = new Map((periods ?? []).map((p: any) =>
    [String(p.room_id), ROOM_STATE[String(p.state)] ?? "available"] as const));
  return (data ?? []).map((u: any) => ({
    roomId: u.room_id, building: u.building, roomNumber: u.room_number, unitType: u.unit_type,
    singleBeds: u.single_beds, doubleBeds: u.double_beds, extraBeds: u.extra_beds,
    state: states.get(String(u.room_id))
      ?? (day === today() ? ROOM_STATE[String(u.rooms?.status ?? "").toLowerCase()] : undefined)
      ?? "available",
    label: `Room ${u.room_number}`,
  }));
}

const unitOf = (u: UnitInfo): NtakUnit => ({ building: u.building, roomNumber: u.roomNumber, unitType: u.unitType, singleBeds: u.singleBeds, doubleBeds: u.doubleBeds, extraBeds: u.extraBeds ?? 0 });

// ---------------------------------------------------------------------------
// Daily closure

const RES_COLS = "id,status,check_in_date,check_out_date,actual_check_in,actual_check_out,ntak_booking_no,room_id,room_type_id,rate_per_night,total_amount,currency,adults,children,source,ota_name,pms_channel,channex_booking_id,pms_reservation_id,reservation_number,pms_group_note,pms_rate_plan_id,created_at,guest_id,hotel_id";
const LEGACY_RES_COLS = RES_COLS.replace("ntak_booking_no,", "");
// GitHub merge may auto-deploy the worker before the owner applies the SQL.
// Never query a Phase-3-only column until it exists in this hotel's DB.
async function phase3SchemaReady(db: Db): Promise<boolean> {
  try {
    const { error } = await db.from("reservations").select("ntak_booking_no").limit(1);
    return !error;
  } catch { return false; }
}

/** Actual Budapest calendar boundaries (23/25 hours across DST changes). */
function budapestMidnight(day: string): string {
  const utc = Date.parse(day + "T00:00:00Z");
  const label = new Intl.DateTimeFormat("en", { timeZone: TZ, timeZoneName: "longOffset" })
    .formatToParts(new Date(utc)).find((p) => p.type === "timeZoneName")?.value ?? "";
  const parsed = /^GMT([+-])(\d{2}):(\d{2})$/.exec(label);
  if (!parsed) throw new Error("Cannot resolve Budapest timezone offset for " + day);
  const minutes = (Number(parsed[2]) * 60 + Number(parsed[3])) * (parsed[1] === "-" ? -1 : 1);
  return new Date(utc - minutes * 60_000).toISOString();
}

export function dayWindow(day: string): { from: string; to: string } {
  return { from: budapestMidnight(day), to: budapestMidnight(addDays(day, 1)) };
}

export interface ClosureBuild extends AssembledClosure { xml: string; snapshotHash: string; classification: "UJ" | "MODOSITO" }

export async function buildClosure(db: Db, s: Settings, day: string, opts: {
  classification?: "UJ" | "MODOSITO"; protocolId?: string | null; reason?: string | null; closed?: boolean; closedAt?: Date;
}): Promise<ClosureBuild> {
  const cfg = ledgerConfig(s);
  const scope = await loadNtakScope(db, s);
  const resCols = await phase3SchemaReady(db) ? RES_COLS : LEGACY_RES_COLS;
  const win = dayWindow(day);

  const [
    { data: staying, error: stayError }, { data: historical, error: historicalError },
    { data: lineRows, error: linesError }, { data: dayPayments, error: paymentsError },
  ] = await Promise.all([
    db.from("reservations").select(resCols).eq("hotel_id", s.hotel_id)
      .lte("check_in_date", day).gte("check_out_date", day).in("status", ["checked_in", "checked_out"]),
    // Actual timestamps can fall outside scheduled stay dates (one-day-early
    // arrival / late departure). Do not lose those historical records.
    db.from("reservations").select(resCols).eq("hotel_id", s.hotel_id)
      .lte("actual_check_in", win.to).gte("actual_check_out", win.from).eq("status", "checked_out"),
    db.from("folio_lines").select("service_date,room_id,gross_total,vat_rate,currency,status,source_type,reservation_folios!inner(reservation_id,hotel_id),service_catalog_items(category)")
      .eq("reservation_folios.hotel_id", s.hotel_id).eq("service_date", day),
    db.from("payments").select("reservation_id,amount,currency,method,status,received_at").eq("hotel_id", s.hotel_id).gte("received_at", win.from).lt("received_at", win.to),
  ]);
  const rows = new Map<string, RawReservation>(
    [...(staying ?? []), ...(historical ?? [])].map((r: RawReservation) => [r.id, r]),
  );
  const reservations: RawReservation[] = [...rows.values()].filter((r: RawReservation) => isInNtakScope(scope, r));
  let lines: RawFolioLine[] = (lineRows ?? []).map((l: any) => ({
    reservation_id: l.reservation_folios.reservation_id, service_date: l.service_date, room_id: l.room_id, gross_total: Number(l.gross_total),
    vat_rate: l.vat_rate === null ? null : Number(l.vat_rate), currency: l.currency, status: l.status,
    category: l.service_catalog_items?.category ?? null, source_type: l.source_type,
  }));
  let payments: RawPayment[] = dayPayments ?? [];

  // Post-departure items reference reservations that are no longer in house.
  const known = new Set(reservations.map((r) => r.id));
  const extraIds = [...new Set([...lines.map((l) => l.reservation_id), ...payments.map((p) => p.reservation_id)])].filter((id) => !known.has(id));
  if (extraIds.length) {
    const { data } = await db.from("reservations").select(resCols).in("id", extraIds).in("status", ["checked_in", "checked_out"]);
    reservations.push(...(data ?? []).filter((r: RawReservation) => isInNtakScope(scope, r)));
  }
  // Only eligible reservations can contribute folio lines or payments, including post-stay entries.
  const eligibleIds = new Set(reservations.map((r) => r.id));
  lines = lines.filter((l) => eligibleIds.has(l.reservation_id));
  payments = payments.filter((p) => eligibleIds.has(p.reservation_id));
  // Advance payments of today's arrivals are reported on the arrival day.
  const arrivals = reservations.filter((r) => (r.actual_check_in ? localDate(r.actual_check_in, TZ) : r.check_in_date) === day).map((r) => r.id);
  if (arrivals.length) {
    const { data } = await db.from("payments").select("reservation_id,amount,currency,method,status,received_at").in("reservation_id", arrivals).lt("received_at", win.from);
    payments = [...payments, ...(data ?? [])];
  }
  const [{ data: assignments }, guestsByRes, units] = await Promise.all([
    reservations.length ? db.from("reservation_room_assignments").select("reservation_id,room_id,check_in_date,check_out_date,status").in("reservation_id", reservations.map((r) => r.id)) : { data: [] },
    loadStayGuests(db, s.hotel_id, reservations.filter((r) => {
      const arrival = r.actual_check_in ? localDate(r.actual_check_in, TZ) : r.check_in_date;
      const departure = r.actual_check_out ? localDate(r.actual_check_out, TZ) : r.check_out_date;
      return arrival <= day && day <= departure;
    })),
    loadUnits(db, s.hotel_id, day),
  ]);
  const { data: companies } = await db.from("guests").select("id,company_name,tax_id").in("id", reservations.map((r) => r.guest_id).filter(Boolean));
  const companyGuests = new Set((companies ?? []).filter((g: any) => g.company_name || g.tax_id).map((g: any) => g.id));
  const roomNumbers = new Map(units.map((u) => [u.roomId, u.roomNumber]));
  const perBooking = new Map<string, number>();
  for (const r of reservations) perBooking.set(bookingNumber(r), (perBooking.get(bookingNumber(r)) ?? 0) + 1);

  const sources = buildDaySources({
    day, reservations, lines, payments, assignments: assignments ?? [],
    guestsFor: (r) => guestsByRes.get(r.id) ?? [],
    isCompany: (r) => !!r.guest_id && companyGuests.has(r.guest_id),
    roomsInBooking: (r) => perBooking.get(bookingNumber(r)) ?? 1,
    label: (r) => `Room ${roomNumbers.get(roomOnDay(r, assignments ?? [], day) ?? "") ?? "?"} · ${r.reservation_number ?? r.id.slice(0, 8)}`,
  }, cfg);

  const classification = opts.classification ?? "UJ";
  const assembled = assembleClosure({
    day, closedAt: opts.closedAt ?? new Date(), classification, protocolId: opts.protocolId, reason: opts.reason,
    closed: opts.closed ?? false, units, ...sources, otherCharges: [], otherPayments: [],
  }, closureSettings(s));
  if (stayError || historicalError || linesError || paymentsError) {
    // Never send a closure missing financial rows or historical reservations.
    const source = [stayError && "stays", historicalError && "actual stays", linesError && "folio lines", paymentsError && "payments"].filter(Boolean).join(", ");
    assembled.checklist.push({ level: "error", code: "missing_ledger", message: `Unable to load complete historical data (${source}). Deploy PMS financial core before NTAK closure.` });
  }
  if (s.first_closure_date && day < s.first_closure_date) assembled.checklist.push({ level: "error", code: "period", message: `HotelCare reports from ${s.first_closure_date}; earlier days belong to the previous PMS.` });
  if (s.data_start_date && day < s.data_start_date) assembled.checklist.push({ level: "warning", code: "period", message: `NTAK expects data from ${s.data_start_date}.` });
  for (const p of configurationProblems(s)) assembled.checklist.push({ level: "error", code: "settings", message: p });

  const xml = buildNapiZarasRequest(common(s), assembled.closure);
  const snapshotHash = await hashJson({ closure: { ...assembled.closure, closedAt: null } });
  return { ...assembled, xml, snapshotHash, classification };
}

export async function hashJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** UJ for the first accepted version of a day, MODOSITO afterwards or for days closed by the previous PMS. */
export async function classificationFor(db: Db, s: Settings, day: string): Promise<"UJ" | "MODOSITO"> {
  if (s.software_change_date && day <= s.software_change_date) return "MODOSITO";
  const { data } = await db.from("ntak_daily_closures").select("accepted_once").eq("hotel_id", s.hotel_id).eq("closed_day", day).maybeSingle();
  return data?.accepted_once ? "MODOSITO" : "UJ";
}

export async function queueClosure(db: Db, s: Settings, day: string, opts: {
  protocolId?: string | null; reason?: string | null; closed?: boolean; actor?: string | null; allowWarnings?: boolean;
}): Promise<{ ok: boolean; build: ClosureBuild; messageId?: string }> {
  const classification = await classificationFor(db, s, day);
  const build = await buildClosure(db, s, day, { classification, protocolId: opts.protocolId, reason: opts.reason, closed: opts.closed });
  if (hasBlockingErrors(build.checklist)) return { ok: false, build };

  await supersedeOpen(db, s.hotel_id, "closure", day);
  const { data: msg, error } = await db.from("ntak_messages").insert({
    hotel_id: s.hotel_id, organization_slug: s.organization_slug, environment: s.environment, kind: "closure", ref: day,
    request_xml: build.xml, created_by: opts.actor ?? null,
  }).select("id").single();
  if (error) throw new Error(error.message);
  await db.from("ntak_daily_closures").upsert({
    hotel_id: s.hotel_id, closed_day: day, organization_slug: s.organization_slug, state: "queued", classification,
    protocol_id: opts.protocolId ?? null, reason: opts.reason ?? null, closed_by: opts.actor ?? null, closed_at: new Date().toISOString(),
    snapshot: { closure: build.closure, checklist: build.checklist, totals: build.totals }, snapshot_hash: build.snapshotHash,
    message_id: msg.id, needs_correction: false, correction_detected_at: null, updated_at: new Date().toISOString(),
  }, { onConflict: "hotel_id,closed_day" });
  return { ok: true, build, messageId: msg.id };
}

async function supersedeOpen(db: Db, hotelId: string, kind: string, ref: string) {
  await db.from("ntak_messages").update({ state: "superseded", updated_at: new Date().toISOString() })
    .eq("hotel_id", hotelId).eq("kind", kind).eq("ref", ref).in("state", ["queued", "retry", "blocked"]);
}

// ---------------------------------------------------------------------------
// Advance bookings

const BOOKING_COLS = RES_COLS + ",created_at";

export async function processBookings(db: Db, s: Settings, limit: number): Promise<{ queued: number; clean: number; problems: number }> {
  const cfg = ledgerConfig(s);
  const scope = await loadNtakScope(db, s);
  const phase3Ready = await phase3SchemaReady(db);
  const bookingCols = phase3Ready ? BOOKING_COLS : LEGACY_RES_COLS;
  const stats = { queued: 0, clean: 0, problems: 0 };
  const { data: dirty } = await db.from("ntak_booking_queue").select("*").eq("hotel_id", s.hotel_id).order("dirty_at").limit(limit * 3);
  const due = (dirty ?? []).filter((q: any) => !q.last_sent_at || q.dirty_at > q.last_sent_at).slice(0, limit);
  if (!due.length) return stats;
  const day = today();

  for (const q of due) {
    // Booking numbers come from three columns (ledger.ts bookingNumber); query each with eq, never a built filter string.
    const lookups = await Promise.all([
      phase3Ready ? db.from("reservations").select(bookingCols).eq("hotel_id", s.hotel_id).eq("ntak_booking_no", q.booking_no) : { data: [] },
      db.from("reservations").select(bookingCols).eq("hotel_id", s.hotel_id).eq("channex_booking_id", q.booking_no),
      db.from("reservations").select(bookingCols).eq("hotel_id", s.hotel_id).eq("pms_reservation_id", q.booking_no),
      db.from("reservations").select(bookingCols).eq("hotel_id", s.hotel_id).eq("reservation_number", q.booking_no),
      /^[0-9a-f-]{36}$/.test(q.booking_no) ? db.from("reservations").select(bookingCols).eq("hotel_id", s.hotel_id).eq("id", q.booking_no) : { data: [] },
    ]);
    const seen = new Set<string>();
    const group: RawReservation[] = lookups.flatMap((l: any) => l.data ?? [])
      .filter((r: any) => bookingNumber(r) === q.booking_no && !seen.has(r.id) && seen.add(r.id))
      .filter((r: RawReservation) => isInNtakScope(scope, r));
    const mark = (patch: Record<string, unknown>) => db.from("ntak_booking_queue").update({ last_sent_at: new Date().toISOString(), ...patch })
      .eq("hotel_id", s.hotel_id).eq("booking_no", q.booking_no);
    if (!group.length) { await mark({ last_problem: null }); stats.clean++; continue; }

    const primary = group.find((r) => r.guest_id)?.guest_id;
    const { data: guest } = primary ? await db.from("guests").select("country,nationality,company_name,tax_id").eq("id", primary).maybeSingle() : { data: null };
    const units = await bookingUnitResolver(db, s.hotel_id, group);
    const built = buildBooking(group, {
      eventCreatedAt: new Date(), today: day,
      originCountry: toIso2(guest?.country, ISO3_TO_ISO2) ?? toIso2(guest?.nationality, ISO3_TO_ISO2),
      isCompany: !!(guest?.company_name || guest?.tax_id), unitFor: units, unknownCountryCode: s.unknown_country_code,
    }, cfg);
    if (built.skip) { await mark({ last_problem: built.skip }); stats.clean++; continue; }
    if (!built.booking) { await mark({ last_problem: built.problems.join("; ").slice(0, 500) }); stats.problems++; continue; }

    const hash = await hashJson({ ...built.booking, eventCreatedAt: null });
    if (hash === q.last_payload_hash) { await mark({ last_problem: null }); stats.clean++; continue; }
    if (built.booking.cancelled && q.cancelled_sent) { await mark({ last_problem: null, last_payload_hash: hash }); stats.clean++; continue; }

    await supersedeOpen(db, s.hotel_id, "booking", q.booking_no);
    const { data: msg } = await db.from("ntak_messages").insert({
      hotel_id: s.hotel_id, organization_slug: s.organization_slug, environment: s.environment, kind: "booking", ref: q.booking_no,
      request_xml: buildFoglalasEsemenyRequest(common(s), built.booking),
    }).select("id").single();
    await mark({ last_problem: null, last_payload_hash: hash, last_message_id: msg?.id ?? null, cancelled_sent: built.booking.cancelled });
    stats.queued++;
  }
  return stats;
}

async function bookingUnitResolver(db: Db, hotelId: string, rows: RawReservation[]) {
  const roomIds = rows.map((r) => r.room_id).filter(Boolean);
  const typeIds = rows.map((r) => r.room_type_id).filter(Boolean);
  const [{ data: profiles }, { data: types }] = await Promise.all([
    roomIds.length ? db.from("ntak_unit_profiles").select("room_id,unit_type,single_beds,double_beds").eq("hotel_id", hotelId).eq("active", true).in("room_id", roomIds) : { data: [] },
    typeIds.length ? db.from("ntak_room_type_units").select("room_type_id,unit_type,capacity").eq("hotel_id", hotelId).eq("active", true).in("room_type_id", typeIds) : { data: [] },
  ]);
  const byRoom = new Map((profiles ?? []).map((p: any) => [p.room_id, p]));
  const byType = new Map((types ?? []).map((t: any) => [t.room_type_id, t]));
  return (r: RawReservation) => {
    const p: any = r.room_id ? byRoom.get(r.room_id) : null;
    if (p) return { unitType: p.unit_type, capacity: Math.max(1, Math.min(99, p.single_beds + 2 * p.double_beds)) };
    const t: any = r.room_type_id ? byType.get(r.room_type_id) : null;
    return t ? { unitType: t.unit_type, capacity: t.capacity } : null;
  };
}

/** Initial sync: every booking with an arrival from today (7.5). */
export async function markAllFutureBookings(db: Db, s: Settings): Promise<number> {
  const scope = await loadNtakScope(db, s);
  const phase3Ready = await phase3SchemaReady(db);
  const cols = phase3Ready
    ? "id,room_id,room_type_id,ntak_booking_no,channex_booking_id,pms_reservation_id,reservation_number"
    : "id,room_id,room_type_id,channex_booking_id,pms_reservation_id,reservation_number";
  const { data } = await db.from("reservations").select(cols)
    .eq("hotel_id", s.hotel_id).gte("check_in_date", today()).not("status", "in", "(cancelled,no_show)");
  const keys = [...new Set((data ?? []).filter((r: RawReservation) => isInNtakScope(scope, r)).map((r: any) => bookingNumber(r)))];
  const now = new Date().toISOString();
  for (let i = 0; i < keys.length; i += 500) {
    await db.from("ntak_booking_queue").upsert(keys.slice(i, i + 500).map((k) => ({ hotel_id: s.hotel_id, booking_no: k, dirty_at: now })), { onConflict: "hotel_id,booking_no" });
  }
  await db.from("ntak_settings").update({ initial_booking_sync_started_at: now, initial_booking_sync_done_at: null }).eq("hotel_id", s.hotel_id);
  return keys.length;
}

// ---------------------------------------------------------------------------
// Stay events

export async function processEvents(db: Db, s: Settings, limit: number): Promise<{ queued: number; waiting: number }> {
  const scope = await loadNtakScope(db, s);
  const { data: pending } = await db.from("ntak_event_queue").select("*").eq("hotel_id", s.hotel_id).in("state", ["queued", "waiting_data"]).order("occurred_at").limit(limit);
  if (!pending?.length) return { queued: 0, waiting: 0 };
  const resIds = [...new Set(pending.map((e: any) => e.reservation_id))];
  const resCols = await phase3SchemaReady(db) ? RES_COLS : LEGACY_RES_COLS;
  const { data: resRows } = await db.from("reservations").select(resCols).in("id", resIds);
  const reservations = new Map<string, RawReservation>((resRows ?? []).map((r: any) => [r.id, r]));
  // Never compute/stash NTAK guest IDs for unrelated Channex reservations.
  const eligibleReservations = [...reservations.values()].filter((r) => isInNtakScope(scope, r));
  const guests = await loadStayGuests(db, s.hotel_id, eligibleReservations);
  const units = new Map((await loadUnits(db, s.hotel_id, today())).map((u) => [u.roomId, u]));

  const events: NtakStayEvent[] = [];
  const used: string[] = [];
  let waiting = 0;
  for (const e of pending) {
    const r = reservations.get(e.reservation_id);
    if (r && !isInNtakScope(scope, r)) {
      await db.from("ntak_event_queue").update({ state: "skipped", last_error: null, updated_at: new Date().toISOString() }).eq("id", e.id);
      continue;
    }
    // Room changes must not send events for unprofiled destination rooms.
    if (scope.mode === "profiled_only" && e.room_id && !scope.roomIds.has(e.room_id)) {
      await db.from("ntak_event_queue").update({ state: "skipped", last_error: null, updated_at: new Date().toISOString() }).eq("id", e.id);
      continue;
    }
    const unit = e.room_id ? units.get(e.room_id) : undefined;
    const from = e.from_room_id ? units.get(e.from_room_id) : undefined;
    const day = localDate(e.occurred_at, TZ);
    const allGuests = guests.get(e.reservation_id) ?? [];
    const exactIds = Array.isArray(e.guest_ids) ? e.guest_ids as string[] : null;
    const requested = exactIds ? new Set(exactIds) : null;
    // Explicit guest_ids freeze the recipients when the event was queued.
    // Legacy NULL queues mean all *currently* in-house guests; legacy rows
    // without stay_state retain pre-Phase-3 behavior.
    const selected = allGuests.filter((g) => requested
      ? requested.has(g.guestId)
      : g.stayState === undefined || g.stayState === 'in_house');
    const list = selected.map((g) => toNtakGuest(g, day, autoIfaStatus)).filter(Boolean) as NtakGuest[];
    const exactMatch = !requested || (selected.length === requested.size && list.length === requested.size);
    const ageHours = (Date.now() - Date.parse(e.occurred_at)) / 3600000;
    let problem: string | null = null;
    if (!r) problem = "reservation not found";
    else if (!unit || (e.kind === "lakoegysegetCserelt" && !from)) problem = "room has no NTAK unit profile";
    else if (requested && (!exactMatch || requested.size===0)) problem = "selected guest identity missing or incomplete";
    else if (!list.length) problem = "no guest with complete personal data yet";
    if (problem) {
      // Guest data may follow shortly after check-in; give up after 7 days (events older than 1 year are never sent).
      await db.from("ntak_event_queue").update({ state: ageHours > 168 ? "failed" : "waiting_data", last_error: problem, updated_at: new Date().toISOString() }).eq("id", e.id);
      waiting++;
      continue;
    }
    if (s.first_closure_date && day < s.first_closure_date) {
      await db.from("ntak_event_queue").update({ state: "skipped", last_error: "Before HotelCare first closure date", updated_at: new Date().toISOString() }).eq("id", e.id);
      continue;
    }
    const at = e.occurred_at;
    const bookingNo = bookingNumber(r!);
    events.push(e.kind === "lakoegysegetCserelt"
      ? { kind: e.kind, at, bookingNo, guests: list, from: unitOf(from!), to: unitOf(unit!) }
      : { kind: e.kind, at, bookingNo, guests: list, unit: unitOf(unit!) });
    used.push(e.id);
  }
  if (!events.length) return { queued: 0, waiting };
  const { data: msg } = await db.from("ntak_messages").insert({
    hotel_id: s.hotel_id, organization_slug: s.organization_slug, environment: s.environment, kind: "event", ref: used.join(",").slice(0, 2000),
    request_xml: buildEsemenyvezereltRequest(common(s), events),
  }).select("id").single();
  await db.from("ntak_event_queue").update({ state: "sent", message_id: msg?.id ?? null, last_error: null, updated_at: new Date().toISOString() }).in("id", used);
  return { queued: events.length, waiting };
}

export async function queueStartDateQuery(db: Db, s: Settings, actor?: string | null): Promise<string> {
  const { data, error } = await db.from("ntak_messages").insert({
    hotel_id: s.hotel_id, organization_slug: s.organization_slug, environment: s.environment, kind: "start_date", ref: today(),
    request_xml: buildAdatszolgaltatasKezdoDatumRequest(common(s)), created_by: actor ?? null,
  }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id;
}

// ---------------------------------------------------------------------------
// Sending and verification

/** Fresh message id and send time for every attempt (uzenetId must be unique). */
export function refreshHeader(requestXml: string, uzenetId: string, now: Date): string {
  return requestXml.replace(/<v9:uzenetAdatok>[\s\S]*?<\/v9:uzenetAdatok>/,
    `<v9:uzenetAdatok><v9:uzenetId>${escText(uzenetId)}</v9:uzenetId><v9:uzenetKuldesIdeje>${xsDateTime(now)}</v9:uzenetKuldesIdeje></v9:uzenetAdatok>`);
}

interface SendContext { certPem: string; key: CryptoKey; keyPem: string }

async function sendContext(db: Db, s: Settings): Promise<SendContext | string> {
  if (!s.endpoint_url) return "NTAK endpoint URL is not set";
  if (s.sending_blocked_reason) return `Sending stopped: ${s.sending_blocked_reason}`;
  if (s.cert_not_after && effectiveExpiry(s.cert_not_after).getTime() < Date.now()) return "The NTAK certificate has expired (NTAK treats it as expired 3 days before its end date)";
  const problems = configurationProblems(s);
  if (problems.length) return problems.join("; ");
  const creds = await credentials(db, s.hotel_id);
  if (!creds) return "No NTAK certificate and private key uploaded";
  return { certPem: creds.certPem, keyPem: creds.keyPem, key: await importSigningKey(creds.keyPem, s.signature_profile) };
}

async function sentLastHour(db: Db, hotelId: string): Promise<number> {
  const { count } = await db.from("ntak_messages").select("id", { count: "exact", head: true })
    .eq("hotel_id", hotelId).gte("sent_at", new Date(Date.now() - 3600000).toISOString());
  return count ?? 0;
}

const now = () => new Date().toISOString();
const issuesJson = (list: NtakIssue[]) => list.map((i) => ({ field: i.field, value: i.value, key: i.key, message: i.message, hint: i.hint ?? null }));

async function exchange(s: Settings, ctx: SendContext, requestXml: string, beforeSend: (envelope: string) => Promise<void>) {
  const envelope = await signEnvelope({ requestXml, certPem: ctx.certPem, key: ctx.key, profile: s.signature_profile });
  // Persist exactly the signed envelope before handing it to the transport.
  await beforeSend(envelope);
  const result = await postSoap(envelope, {
    url: s.endpoint_url!, certPem: ctx.certPem, keyPem: ctx.keyPem,
    proxyUrl: Deno.env.get("NTAK_EGRESS_PROXY_URL") || null,
    proxyUser: Deno.env.get("NTAK_EGRESS_PROXY_USER") || null,
    proxyPassword: Deno.env.get("NTAK_EGRESS_PROXY_PASSWORD") || null,
  });
  return { result, parsed: result.body ? parseNtakResponse(result.body) : null };
}

async function evidenceWrite(query: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await query;
  if (error) throw new Error("NTAK evidence persistence failed: " + error.message);
}

function evidenceRef(kind: string, ref: string, xml: string): string {
  if (kind !== "event") return ref;
  const ids = [...new Set([...xml.matchAll(/<v9:foglalasiSzam>([^<]+)<\/v9:foglalasiSzam>/g)].map((m) => m[1]))];
  return ids.length ? ids.join(",") : ref;
}

async function block(db: Db, s: Settings, reason: string) {
  await db.from("ntak_settings").update({ sending_blocked_reason: reason.slice(0, 500), last_error: reason.slice(0, 500), last_error_at: now() }).eq("hotel_id", s.hotel_id);
  s.sending_blocked_reason = reason;
}

export async function sendDue(db: Db, s: Settings, opts: { limit: number; bookingSpacingMs?: number; deadline: number }): Promise<{ sent: number; skipped?: string }> {
  const ctx = await sendContext(db, s);
  if (typeof ctx === "string") return { sent: 0, skipped: ctx };
  const budget = HOURLY_SOFT_LIMIT - await sentLastHour(db, s.hotel_id);
  if (budget <= 0) return { sent: 0, skipped: "hourly message budget reached" };
  const { data: due } = await db.from("ntak_messages").select("*").eq("hotel_id", s.hotel_id).in("state", ["queued", "retry"])
    .lte("next_attempt_at", now()).order("next_attempt_at").limit(Math.min(opts.limit, budget));
  let sent = 0;
  let lastBooking = 0;
  for (const m of due ?? []) {
    if (Date.now() > opts.deadline) break;
    if (m.kind === "booking" && opts.bookingSpacingMs) {
      const wait = lastBooking + opts.bookingSpacingMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastBooking = Date.now();
    }
    const uzenetId = crypto.randomUUID();
    const sentAt = new Date();
    const requestXml = refreshHeader(m.request_xml, uzenetId, sentAt);
    const evidenceId = crypto.randomUUID();
    const { result, parsed } = await exchange(s, ctx, requestXml, async (envelope) => {
      await evidenceWrite(db.from("ntak_message_evidence").insert({
        id: evidenceId, message_id: m.id, hotel_id: s.hotel_id, environment: m.environment, kind: m.kind,
        ref: evidenceRef(m.kind, m.ref, requestXml), phase: "send", uzenet_id: uzenetId,
        sent_at: sentAt.toISOString(), evidence_day: today(sentAt), request_xml: envelope, status: "sending",
      }));
      await evidenceWrite(db.from("ntak_messages").update({ state: "sending", uzenet_id: uzenetId, request_xml: requestXml, attempts: m.attempts + 1, sent_at: sentAt.toISOString(), updated_at: now() }).eq("id", m.id));
    });
    // A blank response is not an XML document. Keep it NULL, never fabricate one.
    await evidenceWrite(db.from("ntak_message_evidence").update({
      response_xml: result.body || null, http_status: result.status,
      processing_id: parsed?.kind === "accepted" ? parsed.processingId : null,
      status: parsed?.kind === "accepted" ? "BEFOGADVA" : parsed?.kind === "rejected" ? "rejected" : result.certificateProblem ? "blocked" : "transport_or_parse_error",
      completed_at: now(),
    }).eq("id", evidenceId));
    sent++;

    if (parsed?.kind === "accepted") {
      await db.from("ntak_messages").update({
        state: "accepted", processing_id: parsed.processingId, ntak_status: "BEFOGADVA", warnings: issuesJson(parsed.warnings), errors: [],
        last_http_status: result.status, last_error: null, next_verify_at: new Date(Date.now() + 10 * 60000).toISOString(), updated_at: now(),
      }).eq("id", m.id);
      await db.from("ntak_settings").update({ last_ok_at: now() }).eq("hotel_id", s.hotel_id);
      if (m.kind === "closure") await db.from("ntak_daily_closures").update({ state: "sent", updated_at: now() }).eq("hotel_id", s.hotel_id).eq("message_id", m.id);
      continue;
    }
    if (parsed?.kind === "rejected") {
      const keys = parsed.errors.map((e) => e.key);
      const retryable = keys.length > 0 && keys.every((k) => k === "SzerverHiba");
      const stop = keys.find((k) => STOP_SENDING_KEYS.has(k));
      const delay = retryable ? nextRetryDelayMinutes(m.attempts + 1) : null;
      await db.from("ntak_messages").update({
        state: delay ? "retry" : "rejected", errors: issuesJson(parsed.errors), warnings: issuesJson(parsed.warnings),
        last_http_status: result.status, last_error: parsed.faultString ?? keys.join(", "),
        next_attempt_at: delay ? new Date(Date.now() + delay * 60000).toISOString() : now(), updated_at: now(),
      }).eq("id", m.id);
      if (m.kind === "closure" && !delay) await db.from("ntak_daily_closures").update({ state: "errors", updated_at: now() }).eq("hotel_id", s.hotel_id).eq("message_id", m.id);
      if (stop) { await block(db, s, `NTAK rejected the request (${stop}): ${parsed.errors.find((e) => e.key === stop)?.message ?? ""}`); break; }
      continue;
    }
    // Transport failure, HTTP error without SOAP, or an unreadable answer.
    if (result.certificateProblem) {
      await db.from("ntak_messages").update({ state: "blocked", last_http_status: result.status, last_error: result.error, updated_at: now() }).eq("id", m.id);
      await block(db, s, `Certificate rejected by NTAK (${result.error ?? "HTTP " + result.status}). Renew or re-upload the certificate.`);
      break;
    }
    const delay = nextRetryDelayMinutes(m.attempts + 1);
    const error = result.error ?? (parsed?.kind === "unparseable" ? `Unreadable answer: ${parsed.snippet}` : `HTTP ${result.status}`);
    await db.from("ntak_messages").update({
      state: delay ? "retry" : "failed", last_http_status: result.status, last_error: error,
      next_attempt_at: delay ? new Date(Date.now() + delay * 60000).toISOString() : now(), updated_at: now(),
    }).eq("id", m.id);
    if (m.kind === "closure" && !delay) await db.from("ntak_daily_closures").update({ state: "failed", updated_at: now() }).eq("hotel_id", s.hotel_id).eq("message_id", m.id);
    await db.from("ntak_settings").update({ last_error: error.slice(0, 500), last_error_at: now() }).eq("hotel_id", s.hotel_id);
  }
  return { sent };
}

const CLOSURE_STATE: Record<string, string> = { TELJESEN_SIKERES: "accepted", VIZSGALANDO: "warnings", TELJESEN_HIBAS: "errors", UJRA_KULDENDO: "resend_required" };

export async function verifyDue(db: Db, s: Settings, force = false): Promise<{ checked: number; skipped?: string }> {
  const ctx = await sendContext(db, s);
  if (typeof ctx === "string") return { checked: 0, skipped: ctx };
  let q = db.from("ntak_messages").select("id,kind,ref,processing_id,verify_attempts,sent_at,uzenet_id,environment").eq("hotel_id", s.hotel_id).eq("state", "accepted").not("processing_id", "is", null);
  if (!force) q = q.lte("next_verify_at", now());
  const { data: due } = await q.order("next_verify_at").limit(VERIFY_BATCH);
  if (!due?.length) return { checked: 0 };
  const query = common(s);
  const verificationAt = query.sentAt;
  const { result, parsed } = await exchange(s, ctx, buildEllenorzesRequest(query, due.map((m: any) => m.processing_id)), async (envelope) => {
    // Keep a separate row for each poll, including batched and pending results.
    // Older sends may have no signed evidence; record metadata, never reconstruct XML.
    for (const m of due) {
      if (!m.uzenet_id || !m.sent_at) throw new Error("Accepted NTAK message has no original message ID or send time");
      const day = today(new Date(m.sent_at));
      await evidenceWrite(db.from("ntak_message_evidence").upsert({
        message_id: m.id, hotel_id: s.hotel_id, environment: m.environment, kind: m.kind, ref: m.ref,
        phase: "send", uzenet_id: m.uzenet_id, sent_at: m.sent_at, evidence_day: day,
        processing_id: m.processing_id, status: "legacy_missing_request",
      }, { onConflict: "uzenet_id,phase", ignoreDuplicates: true }));
    }
    await evidenceWrite(db.from("ntak_message_evidence").insert(due.map((m: any) => ({
      message_id: m.id, hotel_id: s.hotel_id, environment: m.environment, kind: m.kind, ref: m.ref,
      phase: "verify", uzenet_id: m.uzenet_id, query_id: query.uzenetId, sent_at: verificationAt.toISOString(),
      evidence_day: today(new Date(m.sent_at)), request_xml: envelope, processing_id: m.processing_id, status: "sending",
    }))));
  });
  for (const m of due) {
    const item = parsed?.kind === "verification" ? parsed.results.find((v) => v.processingId === m.processing_id) : undefined;
    const status = item?.status ?? (parsed?.kind === "verification" ? "missing_result" : "verification_error");
    await evidenceWrite(db.from("ntak_message_evidence").update({
      response_xml: result.body || null, http_status: result.status, status, completed_at: now(),
    }).eq("uzenet_id", m.uzenet_id).eq("query_id", query.uzenetId));
    if (item) await evidenceWrite(db.from("ntak_message_evidence").update({ status }).eq("uzenet_id", m.uzenet_id).eq("phase", "send"));
  }
  if (parsed?.kind !== "verification") {
    const reason = parsed?.kind === "rejected" ? parsed.errors.map((e) => `${e.key}: ${e.message}`).join("; ") : result.error ?? `HTTP ${result.status}`;
    for (const m of due) {
      await db.from("ntak_messages").update({ verify_attempts: m.verify_attempts + 1, next_verify_at: new Date(Date.now() + 30 * 60000).toISOString(), last_error: `Verification: ${reason}`.slice(0, 500), updated_at: now() }).eq("id", m.id);
    }
    return { checked: 0, skipped: reason };
  }
  for (const r of parsed.results) {
    const m = due.find((x: any) => x.processing_id === r.processingId);
    if (!m) continue;
    if (r.status === "BEFOGADVA") {
      // Not processed yet: start-date answers every 5 minutes, others every 30, for up to a month (7.6).
      const minutes = m.kind === "start_date" ? 5 : 30;
      const age = Date.now() - Date.parse(m.sent_at);
      const giveUp = m.kind === "start_date" ? age > 86400000 : age > 30 * 86400000;
      await db.from("ntak_messages").update({
        state: giveUp ? "failed" : "accepted", verify_attempts: m.verify_attempts + 1,
        next_verify_at: new Date(Date.now() + minutes * 60000).toISOString(), last_error: giveUp ? "No processing result from NTAK in time: send again" : null, updated_at: now(),
      }).eq("id", m.id);
      continue;
    }
    await db.from("ntak_messages").update({
      state: r.status === "TELJESEN_HIBAS" ? "rejected" : "verified", ntak_status: r.status, warnings: issuesJson(r.warnings), errors: issuesJson(r.errors),
      verified_at: now(), verify_attempts: m.verify_attempts + 1, expected_start_date: r.expectedStartDate, updated_at: now(),
    }).eq("id", m.id);
    if (m.kind === "closure") {
      await db.from("ntak_daily_closures").update({
        state: CLOSURE_STATE[r.status] ?? "sent", updated_at: now(),
        ...(["TELJESEN_SIKERES", "VIZSGALANDO", "UJRA_KULDENDO"].includes(r.status) ? { accepted_once: true } : {}),
      }).eq("hotel_id", s.hotel_id).eq("message_id", m.id);
    }
    if (m.kind === "start_date" && r.expectedStartDate) {
      await db.from("ntak_settings").update({ data_start_date: r.expectedStartDate, data_start_checked_at: now() }).eq("hotel_id", s.hotel_id);
    }
    if (r.status === "UJRA_KULDENDO") await resendSameContent(db, s, m.id, m.kind, m.ref);
  }
  return { checked: parsed.results.length };
}

/**
 * UJRA_KULDENDO: NTAK could only partly process the message; the same content
 * must be sent again, closures marked as a modified (MODOSITO) version.
 */
async function resendSameContent(db: Db, s: Settings, messageId: string, kind: string, ref: string) {
  let requestXml: string | null = null;
  if (kind === "closure") {
    const { data: c } = await db.from("ntak_daily_closures").select("snapshot").eq("hotel_id", s.hotel_id).eq("closed_day", ref).maybeSingle();
    if (!c?.snapshot?.closure) return;
    const closure = { ...c.snapshot.closure, classification: "MODOSITO", protocolId: `NTAK-${ref.replace(/-/g, "")}-R`, reason: "Újraküldés az NTAK UJRA_KULDENDO visszajelzése alapján" };
    requestXml = buildNapiZarasRequest(common(s), closure);
    await db.from("ntak_daily_closures").update({ classification: "MODOSITO", protocol_id: closure.protocolId, reason: closure.reason, accepted_once: true, state: "queued", updated_at: now() }).eq("hotel_id", s.hotel_id).eq("closed_day", ref);
  } else {
    const { data: orig } = await db.from("ntak_messages").select("request_xml").eq("id", messageId).single();
    requestXml = orig?.request_xml ?? null;
  }
  if (!requestXml) return;
  const { data: msg } = await db.from("ntak_messages").insert({ hotel_id: s.hotel_id, organization_slug: s.organization_slug, environment: s.environment, kind, ref, request_xml: requestXml }).select("id").single();
  if (kind === "closure" && msg) await db.from("ntak_daily_closures").update({ message_id: msg.id }).eq("hotel_id", s.hotel_id).eq("closed_day", ref);
}

// ---------------------------------------------------------------------------
// Worker

export async function autoClose(db: Db, s: Settings): Promise<string | null> {
  if (s.closure_mode !== "auto") return null;
  const local = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  if (local < s.auto_close_time.slice(0, 5)) return null;
  const day = addDays(today(), -1);
  if (s.first_closure_date && day < s.first_closure_date) return null;
  const { data: existing } = await db.from("ntak_daily_closures").select("closed_day").eq("hotel_id", s.hotel_id).eq("closed_day", day).maybeSingle();
  if (existing) return null;
  const queued = await queueClosure(db, s, day, { actor: null });
  if (!queued.ok) {
    const first = queued.build.checklist.find((c) => c.level === "error");
    const reason = `Automatic closure of ${day} needs attention: ${first?.message ?? "checklist errors"}`;
    await db.from("ntak_settings").update({ last_error: reason.slice(0, 500), last_error_at: now() }).eq("hotel_id", s.hotel_id);
    return reason;
  }
  return `queued closure ${day}`;
}

/** Source data changed after a day was sent: flag it so the user can send a MODOSITO version. */
export async function detectDrift(db: Db, s: Settings, maxDays = 2): Promise<number> {
  const { data } = await db.from("ntak_daily_closures").select("closed_day,snapshot_hash,snapshot")
    .eq("hotel_id", s.hotel_id).eq("needs_correction", false).in("state", ["accepted", "warnings"])
    .gte("closed_day", addDays(today(), -7)).lt("updated_at", new Date(Date.now() - 3600000).toISOString())
    .order("updated_at").limit(maxDays);
  let flagged = 0;
  for (const c of data ?? []) {
    const closed = c.snapshot?.closure?.closed ?? false;
    const fresh = await buildClosure(db, s, c.closed_day, { classification: c.snapshot?.closure?.classification, protocolId: c.snapshot?.closure?.protocolId, reason: c.snapshot?.closure?.reason, closed });
    // Phase 4 dated periods make historical OOO/OOS deterministic. Changes to
    // past room periods MUST now flag a MODOSITO correction, not be masked.
    const hash = await hashJson({ closure: { ...fresh.closure, closedAt: null } });
    const stored = await hashJson({ closure: { ...c.snapshot.closure, closedAt: null } });
    if (hash !== stored) {
      await db.from("ntak_daily_closures").update({ needs_correction: true, correction_detected_at: now(), updated_at: now() }).eq("hotel_id", s.hotel_id).eq("closed_day", c.closed_day);
      flagged++;
    } else {
      await db.from("ntak_daily_closures").update({ updated_at: now() }).eq("hotel_id", s.hotel_id).eq("closed_day", c.closed_day);
    }
  }
  return flagged;
}

export async function runWorker(db: Db, s: Settings, deadline: number): Promise<Record<string, unknown>> {
  const report: Record<string, unknown> = { hotel_id: s.hotel_id };
  try {
    if (s.cert_not_after && effectiveExpiry(s.cert_not_after).getTime() < Date.now() && !s.sending_blocked_reason) {
      await block(db, s, "The NTAK certificate has expired. Generate a new CSR and upload the new certificate.");
    }
    report.autoClose = await autoClose(db, s);
    const initialSync = !!s.initial_booking_sync_started_at && !s.initial_booking_sync_done_at;
    report.bookings = await processBookings(db, s, initialSync ? 15 : 50);
    report.events = await processEvents(db, s, 50);
    report.send = await sendDue(db, s, { limit: initialSync ? 20 : 100, bookingSpacingMs: initialSync ? 5000 : 0, deadline });
    if (initialSync) {
      const { count } = await db.from("ntak_booking_queue").select("booking_no", { count: "exact", head: true }).eq("hotel_id", s.hotel_id).is("last_sent_at", null);
      const { count: open } = await db.from("ntak_messages").select("id", { count: "exact", head: true }).eq("hotel_id", s.hotel_id).eq("kind", "booking").in("state", ["queued", "retry"]);
      if (!count && !open) await db.from("ntak_settings").update({ initial_booking_sync_done_at: now() }).eq("hotel_id", s.hotel_id);
    }
    if (Date.now() < deadline) report.verify = await verifyDue(db, s);
    if (Date.now() < deadline - 30000) report.drift = await detectDrift(db, s);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    report.error = message;
    await db.from("ntak_settings").update({ last_error: message.slice(0, 500), last_error_at: now() }).eq("hotel_id", s.hotel_id);
  }
  return report;
}
