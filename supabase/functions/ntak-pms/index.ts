// deno-lint-ignore-file no-explicit-any
/**
 * ntak-pms — NTAK PMS interface v9 (szállás modul) data reporting.
 *
 * Secrets: per-hotel universal certificate, private key and guest-id salt are
 * in Vault (ntak_put_secret / ntak_get_secret). Optional function secrets:
 *   NTAK_SOFTWARE_ID              HotelCare's NTAK software id (if not set per hotel)
 *   NTAK_EGRESS_PROXY_URL/_USER/_PASSWORD   fixed-IP HTTP CONNECT proxy NTAK whitelists
 *
 * Actions
 *   worker (x-worker-secret, cron every 5 min): auto closure, booking + event
 *     queues, sending with retries (1/10/60 min), verification, drift check
 *   status | preview_closure | close_day                      (hotel staff)
 *   save_settings | save_units | seed_units | save_room_types |
 *   generate_csr | upload_certificate | self_test | query_start_date |
 *   initial_booking_sync | resend_message | run_now | clear_block (managers)
 *
 * NTAK must never block the front desk: everything is queued, nothing here is
 * called from a check-in/check-out path.
 */
import { authorizeHotelCaller, json, serviceDb, workerAuthorized, corsHeaders } from "../_shared/channex/http.ts";
import { ACCOMMODATION_CLASSES, UNIT_TYPES } from "../_shared/ntak/codes.ts";
import { addDays } from "../_shared/ntak/ledger.ts";
import { buildAdatszolgaltatasKezdoDatumRequest } from "../_shared/ntak/messages.ts";
import { importSigningKey, signEnvelope, verifyEnvelope } from "../_shared/ntak/wssec.ts";
import { firstCertificatePem, generateCsr, keyMatchesCertificate, normalizePrivateKeyPem, parseCertificate, rsaModulusFromSpki, spkiSha256, effectiveExpiry } from "../_shared/ntak/x509.ts";
import {
  buildClosure, classificationFor, common, configurationProblems, loadSettings, markAllFutureBookings, queueClosure,
  queueStartDateQuery, runWorker, today, verifyDue, type Db, type Settings,
} from "./engine.ts";

const SETTINGS_FIELDS = [
  "enabled", "environment", "endpoint_url", "software_id", "software_version", "registration_number", "provider_tax_number",
  "data_reporting_id", "registered_room_count", "registered_bed_count", "accommodation_name", "provider_name", "unit_scope", "accommodation_class", "region", "ifa_type", "ifa_rate",
  "ifa_vat", "accommodation_vat", "signature_profile", "unknown_country_code", "closure_mode", "auto_close_time",
  "first_closure_date", "software_change_date", "allow_backdating", "backdating_min_date", "ledger_config",
] as const;

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);


async function prepareCsr(db: Db, hotelId: string, settings: Settings | null) {
  if (!settings?.registration_number) return json({ ok: false, error: "Save the NTAK registration number first" }, 400);
  let pem = (settings as Settings & { pending_csr_pem?: string }).pending_csr_pem;
  if (!pem) {
    const candidate = await generateCsr(settings.registration_number);
    const { data, error } = await db.rpc("ntak_save_pending_csr", {
      _hotel_id: hotelId, _registration: settings.registration_number, _csr: candidate.csrPem,
      _key: candidate.privateKeyPem, _fingerprint: candidate.spkiSha256,
    });
    if (error) return json({ ok: false, error: "Unable to save certificate request" }, 500);
    pem = data;
  }
  return json({ ok: true, csr_pem: pem, file_name: `${settings.registration_number}_ntak.csr` });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
  const db = serviceDb();

  // Certification operators can retrieve the CSR only for the isolated test registration.
  // Room data and reporting operations are inaccessible through this action.
  if (body.action === "prepare_validation_csr") {
    if (!await workerAuthorized(req, db)) return json({ ok: false, error: "Unauthorized" }, 401);
    const hotelId = "ntak-v9-validation";
    const settings = await loadSettings(db, hotelId);
    if (settings?.environment !== "test" || settings.enabled || settings.cert_not_after) {
      return json({ ok: false, error: "An inactive test registration awaiting its certificate is required" }, 409);
    }
    return await prepareCsr(db, hotelId, settings);
  }

  if (body.action === "worker") {
    if (!await workerAuthorized(req, db)) return json({ ok: false, error: "Unauthorized" }, 401);
    const started = Date.now();
    const { data: hotels } = await db.from("ntak_settings").select("*").eq("enabled", true);
    const reports = [];
    for (const s of hotels ?? []) {
      if (Date.now() - started > 120000) break;
      reports.push(await runWorker(db, s, started + 130000));
    }
    return json({ ok: true, reports });
  }

  const hotelId = String(body.hotel_id ?? "");
  if (!hotelId) return json({ ok: false, error: "hotel_id is required" }, 400);
  const caller = await authorizeHotelCaller(req, db, hotelId);
  if (caller instanceof Response) return caller;
  const canManage = caller.isSuperAdmin || ["admin", "top_management", "top_management_manager"].includes(caller.role);
  if (!canManage) return json({ ok: false, error: "Forbidden" }, 403);
  const forbidden = () => json({ ok: false, error: "Only managers can change NTAK settings" }, 403);

  try {
    const settings = await loadSettings(db, hotelId);
    switch (body.action) {
      case "status": return json({ ok: true, can_manage: canManage, ...(await status(db, hotelId, settings)) });

      case "save_settings": {
        if (!canManage) return forbidden();
        const patch: Record<string, unknown> = {};
        for (const k of SETTINGS_FIELDS) if (k in (body.settings ?? {})) patch[k] = body.settings[k] === "" ? null : body.settings[k];
        if (typeof patch.provider_tax_number === "string") {
          patch.provider_tax_number = patch.provider_tax_number.trim().replace(/^(\d{8})(\d)(\d{2})$/, "$1-$2-$3");
        }
        if (patch.accommodation_class && !ACCOMMODATION_CLASSES.includes(patch.accommodation_class as any)) return json({ ok: false, error: "Unknown accommodation class" }, 400);
        if (patch.ledger_config !== undefined && (typeof patch.ledger_config !== "object" || Array.isArray(patch.ledger_config))) return json({ ok: false, error: "ledger_config must be an object" }, 400);
        const organization_slug = settings?.organization_slug ?? caller.organizationSlug ?? await orgSlug(db, hotelId);
        if (!organization_slug) return json({ ok: false, error: "Cannot resolve the organization of this hotel" }, 400);
        const { error } = await db.from("ntak_settings").upsert({ hotel_id: hotelId, organization_slug, ...patch, updated_at: new Date().toISOString() }, { onConflict: "hotel_id" });
        if (error) return json({ ok: false, error: error.message }, 400);
        return json({ ok: true, can_manage: canManage, ...(await status(db, hotelId, await loadSettings(db, hotelId))) });
      }

      case "save_units": {
        if (!canManage) return forbidden();
        const units = Array.isArray(body.units) ? body.units : [];
        const rows = units.map((u: any) => ({
          room_id: u.room_id, hotel_id: hotelId, building: String(u.building ?? "").trim(), room_number: String(u.room_number ?? "").trim(),
          unit_type: UNIT_TYPES.includes(u.unit_type) ? u.unit_type : "STANDARD", single_beds: Number(u.single_beds) || 0,
          double_beds: Number(u.double_beds) || 0, extra_beds: Number(u.extra_beds) || 0, active: u.active !== false, updated_at: new Date().toISOString(),
        }));
        const owned = await hotelRoomIds(db, hotelId);
        if (rows.some((r: any) => !owned.has(r.room_id))) return json({ ok: false, error: "A room does not belong to this hotel" }, 400);
        const { error } = await db.from("ntak_unit_profiles").upsert(rows, { onConflict: "room_id" });
        if (error) return json({ ok: false, error: error.message }, 400);
        return json({ ok: true, saved: rows.length });
      }

      case "seed_units": {
        if (!canManage) return forbidden();
        // Do not accidentally profile the 15 unrelated Channex rooms in a scoped certification hotel.
        if (settings?.unit_scope === "profiled_only") return json({ ok: false, error: "Automatic profiling is disabled in profiled-only NTAK mode. Configure approved rooms individually." }, 400);
        const rooms = await hotelRooms(db, hotelId);
        const { data: existing } = await db.from("ntak_unit_profiles").select("room_id").eq("hotel_id", hotelId);
        const have = new Set((existing ?? []).map((e: any) => e.room_id));
        const rows = rooms.filter((r: any) => !have.has(r.id)).map((r: any) => {
          const cap = Math.max(1, Number(r.room_capacity) || 2);
          return {
            room_id: r.id, hotel_id: hotelId, building: String(r.wing || "1").slice(0, 50), room_number: String(r.room_number).slice(0, 50),
            unit_type: "STANDARD", single_beds: cap === 1 ? 1 : cap % 2, double_beds: cap === 1 ? 0 : Math.floor(cap / 2), extra_beds: 0,
          };
        });
        if (rows.length) {
          const { error } = await db.from("ntak_unit_profiles").insert(rows);
          if (error) return json({ ok: false, error: error.message }, 400);
        }
        return json({ ok: true, created: rows.length });
      }

      case "save_room_types": {
        if (!canManage) return forbidden();
        const types = (Array.isArray(body.room_types) ? body.room_types : []).map((t: any) => ({
          room_type_id: t.room_type_id, hotel_id: hotelId, unit_type: UNIT_TYPES.includes(t.unit_type) ? t.unit_type : "STANDARD",
          capacity: Math.max(1, Math.min(99, Number(t.capacity) || 2)), active: t.active !== false, updated_at: new Date().toISOString(),
        }));
        const { data: own } = await db.from("room_types").select("id").eq("hotel_id", hotelId);
        const ownIds = new Set((own ?? []).map((r: any) => r.id));
        if (types.some((t: any) => !ownIds.has(t.room_type_id))) return json({ ok: false, error: "A room type does not belong to this hotel" }, 400);
        const { error } = await db.from("ntak_room_type_units").upsert(types, { onConflict: "room_type_id" });
        if (error) return json({ ok: false, error: error.message }, 400);
        return json({ ok: true, saved: types.length });
      }

      case "preview_closure": {
        if (!settings) return json({ ok: false, error: "NTAK is not set up for this hotel" }, 400);
        const day = isDay(body.day) ? body.day : addDays(today(), -1);
        const classification = await classificationFor(db, settings, day);
        const build = await buildClosure(db, settings, day, { classification, protocolId: body.protocol_id, reason: body.reason, closed: body.closed === true });
        return json({ ok: true, day, classification, closure: build.closure, checklist: build.checklist, totals: build.totals, xml: build.xml });
      }

      case "close_day": {
        if (!settings) return json({ ok: false, error: "NTAK is not set up for this hotel" }, 400);
        if (!isDay(body.day)) return json({ ok: false, error: "day (YYYY-MM-DD) is required" }, 400);
        if (body.day >= today()) return json({ ok: false, error: "Only past days can be closed" }, 400);
        if (body.day < addDays(today(), -456)) return json({ ok: false, error: "NTAK accepts corrections for 15 months only" }, 400);
        const result = await queueClosure(db, settings, body.day, { protocolId: body.protocol_id, reason: body.reason, closed: body.closed === true, actor: caller.userId });
        if (!result.ok) return json({ ok: false, error: "The checklist has errors to fix first", checklist: result.build.checklist, totals: result.build.totals }, 422);
        return json({ ok: true, message_id: result.messageId, classification: result.build.classification, checklist: result.build.checklist });
      }

      case "generate_csr": {
        if (!canManage) return forbidden();
        return await prepareCsr(db, hotelId, settings);
      }

      case "upload_certificate": {
        if (!canManage) return forbidden();
        if (!settings) return json({ ok: false, error: "NTAK is not set up for this hotel" }, 400);
        const certPem = firstCertificatePem(String(body.certificate_pem ?? ""));
        if (!certPem) return json({ ok: false, error: "Paste the certificate in PEM format (-----BEGIN CERTIFICATE-----)" }, 400);
        const info = parseCertificate(certPem);
        let keyPem: string | null = null;
        if (body.private_key_pem) {
          keyPem = normalizePrivateKeyPem(String(body.private_key_pem));
        } else {
          const { data } = await db.rpc("ntak_get_secret", { _hotel_id: hotelId, _kind: "pending_key" });
          keyPem = data ?? null;
          if (keyPem && settings && (settings as any).pending_spki_sha256 && await spkiSha256(info.spki) !== (settings as any).pending_spki_sha256) {
            return json({ ok: false, error: "This certificate was not issued for the CSR generated in HotelCare" }, 400);
          }
        }
        if (!keyPem) return json({ ok: false, error: "No private key: generate the CSR in HotelCare first, or upload the key with the certificate" }, 400);
        if (!await keyMatchesCertificate(keyPem, certPem)) return json({ ok: false, error: "The private key does not belong to this certificate" }, 400);
        if (effectiveExpiry(info.notAfter).getTime() < Date.now()) return json({ ok: false, error: `The certificate expired on ${info.notAfter.slice(0, 10)}` }, 400);
        const { error: installError } = await db.rpc("ntak_install_certificate", {
          _hotel_id: hotelId, _registration: settings.registration_number, _cert: certPem, _key: keyPem,
          _use_pending: !body.private_key_pem, _subject: info.subject, _serial: info.serialHex, _expires: info.notAfter,
        });
        if (installError) return json({ ok: false, error: "Certificate could not be installed. Refresh the settings and retry." }, 409);
        const warnings: string[] = [];
        if (info.subject.CN && settings.registration_number && !info.subject.CN.includes(settings.registration_number)) warnings.push(`Certificate CN "${info.subject.CN}" does not contain the registration number ${settings.registration_number}`);
        return json({ ok: true, subject: info.subject, issuer: info.issuer, not_after: info.notAfter, modulus_bits: rsaModulusFromSpki(info.spki).length * 4, warnings });
      }

      case "self_test": {
        if (!canManage) return forbidden();
        if (!settings) return json({ ok: false, error: "NTAK is not set up for this hotel" }, 400);
        const checks: { check: string; ok: boolean; detail?: string }[] = [];
        const problems = configurationProblems(settings);
        checks.push({ check: "Identifiers", ok: !problems.length, detail: problems.join("; ") || undefined });
        checks.push({ check: "Endpoint URL", ok: !!settings.endpoint_url, detail: settings.endpoint_url ?? "not set" });
        const { data: cert } = await db.rpc("ntak_get_secret", { _hotel_id: hotelId, _kind: "cert" });
        const { data: key } = await db.rpc("ntak_get_secret", { _hotel_id: hotelId, _kind: "key" });
        checks.push({ check: "Certificate and key in Vault", ok: !!(cert && key) });
        if (cert && key) {
          checks.push({ check: "Key matches certificate", ok: await keyMatchesCertificate(key, cert) });
          const envelope = await signEnvelope({ requestXml: buildAdatszolgaltatasKezdoDatumRequest(common(settings)), certPem: cert, key: await importSigningKey(key, settings.signature_profile), profile: settings.signature_profile });
          const verified = await verifyEnvelope(envelope);
          checks.push({ check: `WS-Security signature (${settings.signature_profile})`, ok: verified.ok, detail: verified.problems.join("; ") || undefined });
          checks.push({ check: "mTLS client available", ok: typeof (Deno as any).createHttpClient === "function" });
        }
        checks.push({ check: "Fixed-IP egress proxy", ok: !!Deno.env.get("NTAK_EGRESS_PROXY_URL"), detail: Deno.env.get("NTAK_EGRESS_PROXY_URL") ? "configured" : "NTAK_EGRESS_PROXY_URL not set (needed if NTAK whitelists IPs)" });
        const { count } = await db.from("ntak_unit_profiles").select("room_id", { count: "exact", head: true }).eq("hotel_id", hotelId).eq("active", true);
        checks.push({ check: "Unit profiles", ok: (count ?? 0) > 0, detail: `${count ?? 0} active, NTAK registration: ${settings.registered_room_count ?? "?"}` });
        return json({ ok: true, checks });
      }

      case "query_start_date": {
        if (!canManage) return forbidden();
        if (!settings) return json({ ok: false, error: "NTAK is not set up for this hotel" }, 400);
        return json({ ok: true, message_id: await queueStartDateQuery(db, settings, caller.userId) });
      }

      case "initial_booking_sync": {
        if (!canManage) return forbidden();
        if (!settings?.enabled) return json({ ok: false, error: "Enable NTAK for this hotel first" }, 400);
        return json({ ok: true, bookings: await markAllFutureBookings(db, settings) });
      }

      case "resend_message": {
        if (!canManage) return forbidden();
        const { data: m } = await db.from("ntak_messages").select("*").eq("id", body.message_id).eq("hotel_id", hotelId).maybeSingle();
        if (!m) return json({ ok: false, error: "Message not found" }, 404);
        if (m.kind === "closure") return json({ ok: false, error: "Send a closure again from the closure list (it becomes a MODOSITO version when needed)" }, 400);
        if (["queued", "retry", "sending"].includes(m.state)) return json({ ok: false, error: "The message is still waiting to be sent" }, 400);
        const { data, error } = await db.from("ntak_messages").insert({
          hotel_id: hotelId, organization_slug: m.organization_slug, environment: m.environment, kind: m.kind, ref: m.ref,
          request_xml: m.request_xml, created_by: caller.userId,
        }).select("id").single();
        if (error) return json({ ok: false, error: error.message }, 400);
        return json({ ok: true, message_id: data.id });
      }

      case "run_now": {
        if (!canManage) return forbidden();
        if (!settings?.enabled) return json({ ok: false, error: "Enable NTAK for this hotel first" }, 400);
        return json({ ok: true, report: await runWorker(db, settings, Date.now() + 100000) });
      }

      case "verify_now": {
        if (!canManage) return forbidden();
        if (!settings) return json({ ok: false, error: "NTAK is not set up for this hotel" }, 400);
        return json({ ok: true, ...(await verifyDue(db, settings, true)) });
      }

      case "clear_block": {
        if (!canManage) return forbidden();
        await db.from("ntak_settings").update({ sending_blocked_reason: null }).eq("hotel_id", hotelId);
        await db.from("ntak_messages").update({ state: "retry", next_attempt_at: new Date().toISOString(), attempts: 0 }).eq("hotel_id", hotelId).eq("state", "blocked");
        return json({ ok: true });
      }

      default:
        return json({ ok: false, error: "Unknown action" }, 400);
    }
  } catch (e) {
    console.error("ntak-pms", body.action, e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

async function status(db: Db, hotelId: string, settings: Settings | null) {
  const since = addDays(today(), -45);
  const [messages, closures, units, roomTypes, rooms, bookingQueue, events] = await Promise.all([
    db.from("ntak_messages").select("id,kind,ref,state,ntak_status,processing_id,warnings,errors,attempts,last_http_status,last_error,created_at,sent_at,verified_at,next_attempt_at,expected_start_date")
      .eq("hotel_id", hotelId).order("created_at", { ascending: false }).limit(80),
    db.from("ntak_daily_closures").select("closed_day,state,classification,protocol_id,reason,closed_at,accepted_once,needs_correction,correction_detected_at,message_id,snapshot->totals,snapshot->checklist")
      .eq("hotel_id", hotelId).gte("closed_day", since).order("closed_day", { ascending: false }),
    db.from("ntak_unit_profiles").select("room_id,building,room_number,unit_type,single_beds,double_beds,extra_beds,active").eq("hotel_id", hotelId).order("room_number"),
    db.from("ntak_room_type_units").select("room_type_id,unit_type,capacity,active").eq("hotel_id", hotelId),
    hotelRooms(db, hotelId),
    db.from("ntak_booking_queue").select("booking_no,dirty_at,last_sent_at,last_problem").eq("hotel_id", hotelId).not("last_problem", "is", null).order("dirty_at", { ascending: false }).limit(30),
    db.from("ntak_event_queue").select("id,reservation_id,kind,occurred_at,state,last_error,is_correction").eq("hotel_id", hotelId).in("state", ["queued", "waiting_data", "failed"]).order("occurred_at", { ascending: false }).limit(30),
  ]);
  const { data: types } = await db.from("room_types").select("id,name").eq("hotel_id", hotelId).order("name");

  // Every day from go-live to yesterday needs a closure (closed days too).
  const firstDay = [settings?.first_closure_date, settings?.data_start_date, since].filter(Boolean).sort().slice(-1)[0] as string;
  const closed = new Set((closures.data ?? []).map((c: any) => c.closed_day));
  const missing: string[] = [];
  if (settings?.enabled && settings.first_closure_date) for (let d = firstDay; d < today(); d = addDays(d, 1)) if (!closed.has(d)) missing.push(d);

  const { pending_csr_pem, ...publicSettings } = (settings ?? {}) as any;
  return {
    settings: settings ? { ...publicSettings, has_pending_csr: !!pending_csr_pem, pending_csr_pem } : null,
    configuration_problems: settings ? configurationProblems(settings) : ["NTAK is not set up for this hotel"],
    messages: messages.data ?? [],
    closures: closures.data ?? [],
    missing_closures: missing,
    units: units.data ?? [],
    room_types: (types ?? []).map((t: any) => ({ ...t, ntak: (roomTypes.data ?? []).find((m: any) => m.room_type_id === t.id) ?? null })),
    rooms: rooms.map((r: any) => ({ id: r.id, room_number: r.room_number, wing: r.wing, room_capacity: r.room_capacity })),
    booking_problems: bookingQueue.data ?? [],
    pending_events: events.data ?? [],
    today: today(),
  };
}

async function hotelRooms(db: Db, hotelId: string): Promise<any[]> {
  const { data: cfg } = await db.from("hotel_configurations").select("hotel_id,hotel_name").eq("hotel_id", hotelId).maybeSingle();
  const names = [hotelId, cfg?.hotel_name].filter(Boolean);
  const { data } = await db.from("rooms").select("id,room_number,wing,room_capacity,hotel").in("hotel", names).order("room_number");
  return data ?? [];
}

async function hotelRoomIds(db: Db, hotelId: string): Promise<Set<string>> {
  return new Set((await hotelRooms(db, hotelId)).map((r) => r.id));
}

async function orgSlug(db: Db, hotelId: string): Promise<string | null> {
  const { data: cfg } = await db.from("hotel_configurations").select("organization_id").eq("hotel_id", hotelId).maybeSingle();
  if (!cfg?.organization_id) return null;
  const { data: org } = await db.from("organizations").select("slug").eq("id", cfg.organization_id).maybeSingle();
  return org?.slug ?? null;
}
