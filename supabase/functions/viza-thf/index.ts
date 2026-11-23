/**
 * viza-thf — Hungarian VIZA guest-data reporting through the THF module.
 *
 * Certificates (never reach a browser): the THF is addressed with the same
 * NTAK certificate and the same WS-Security header as the NTAK endpoint
 * (guide 3.1), so each hotel's certificate and key are read from Vault, where
 * the NTAK module keeps them (ntak_get_secret). Function secrets are only a
 * fallback for a hotel without its own certificate:
 *   VIZA_NTAK_CLIENT_CERT_PEM / VIZA_NTAK_CLIENT_KEY_PEM
 * Fixed-IP egress: VIZA_EGRESS_PROXY_URL/_USER/_PASSWORD, else the NTAK proxy.
 *
 * Actions:
 *   worker (x-worker-secret, cron):  status poll + drain arrival/departure queues
 *   status (JWT, hotel staff):       settings + counters + recent events for the UI
 *   save_settings (JWT, managers):   per-hotel VIZA identity and enable switch
 *   retry (JWT, reception staff):    send a failed or rejected guest again (after correcting the data)
 *   unsent_list (JWT, managers):     messages the THF holds as unsent / rejected
 *
 * The THF being unreachable must never block the front desk (spec 4): events
 * stay queued and the worker keeps retrying; counters surface in Reception.
 */
import { authorizeHotelCaller, hasRole, json, MANAGE_ROLES, serviceDb, VIEW_ROLES, workerAuthorized, type Caller } from "../_shared/channex/http.ts";
import { buildArrivalBody, buildDepartureBody, buildStatusBody, buildUnsentListBody, parseUnsentList, readXmlTag, readXmlTags, vizaTimestamp, type VizaArrivalGuest } from "../_shared/viza/messages.ts";
import { postSoap } from "../_shared/ntak/transport.ts";
import { importSigningKey, signEnvelope } from "../_shared/ntak/wssec.ts";
import { firstCertificatePem, normalizePrivateKeyPem } from "../_shared/ntak/x509.ts";
import { guestToVizaGroups } from "../_shared/viza/mapGuest.ts";
import { isDue, NEEDS_CORRECTION, nextAttemptAt, readSubmissionOutcome } from "../_shared/viza/outcome.ts";
import { b64encode, importRsaKey, pemToDer, signEllenorzoString } from "../_shared/viza/wssec.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

const BATCH = 10; // spec: max 10 guests per message
const QUICK_TRIES = 3; // guide 6.2: the first three tries follow each other at once

interface Credentials { certPem: string; keyPem: string; source: "vault" | "function-secret" }

/** The hotel's NTAK certificate from Vault, else the function-level fallback. */
async function hotelCredentials(db: Db, hotelId: string): Promise<Credentials | null> {
  const [cert, key] = await Promise.all([
    db.rpc("ntak_get_secret", { _hotel_id: hotelId, _kind: "cert" }),
    db.rpc("ntak_get_secret", { _hotel_id: hotelId, _kind: "key" }),
  ]);
  if (cert.data && key.data) return { certPem: String(cert.data), keyPem: String(key.data), source: "vault" };
  const envCert = firstCertificatePem(Deno.env.get("VIZA_NTAK_CLIENT_CERT_PEM") ?? "");
  const envKey = Deno.env.get("VIZA_NTAK_CLIENT_KEY_PEM") ?? "";
  if (envCert && envKey) return { certPem: envCert, keyPem: normalizePrivateKeyPem(envKey), source: "function-secret" };
  return null;
}

interface Signer { creds: Credentials; envelopeKey: CryptoKey; validationKey: CryptoKey; certB64: string }

async function signerFor(creds: Credentials): Promise<Signer> {
  return {
    creds,
    // Same header as NTAK: rsa-sha384 over Body + Timestamp (accepted by the NTAK test endpoint).
    envelopeKey: await importSigningKey(creds.keyPem, "rsa-sha384"),
    // Accommodation validation message: SHA-256 + RSA (guide 3.2).
    validationKey: await importRsaKey(normalizePrivateKeyPem(creds.keyPem), "SHA-256"),
    certB64: b64encode(pemToDer(creds.certPem)),
  };
}

const env = (name: string) => Deno.env.get(name) || null;

async function callThf(cfg: Pick<Settings, "thf_url" | "thf_ca_pem">, bodyXml: string, signer: Signer) {
  const url = cfg.thf_url;
  const envelope = await signEnvelope({ requestXml: bodyXml, certPem: signer.creds.certPem, key: signer.envelopeKey, profile: "rsa-sha384" });
  const ownProxy = env("VIZA_EGRESS_PROXY_URL");
  const result = await postSoap(envelope, {
    url, certPem: signer.creds.certPem, keyPem: signer.creds.keyPem,
    proxyUrl: ownProxy ?? env("NTAK_EGRESS_PROXY_URL"),
    proxyUser: ownProxy ? env("VIZA_EGRESS_PROXY_USER") : env("NTAK_EGRESS_PROXY_USER"),
    proxyPassword: ownProxy ? env("VIZA_EGRESS_PROXY_PASSWORD") : env("NTAK_EGRESS_PROXY_PASSWORD"),
    caCertsPem: cfg.thf_ca_pem,
  });
  if (result.error && !result.body) throw new Error(result.error);
  return result;
}

/** A send that cannot reach the THF is tried three times in a row before it counts as one failed attempt. */
async function sendToThf(cfg: Pick<Settings, "thf_url" | "thf_ca_pem">, bodyXml: string, signer: Signer) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < QUICK_TRIES; attempt++) {
    try {
      const res = await callThf(cfg, bodyXml, signer);
      if (res.status < 500) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

type Settings = {
  hotel_id: string; organization_slug: string; enabled: boolean; thf_url: string;
  adatszolgaltatasi_azonosito: string | null; szallas_nev: string | null;
  szolgaltato_adoszam: string | null; szolgaltato_nev: string | null;
  /** CA certificate(s) of a self-hosted THF, PEM; null for a THF with a publicly trusted certificate. */
  thf_ca_pem?: string | null;
};

type GuestExtras = { visa_number?: string | null; entry_date?: string | null; entry_place?: string | null };
const text = (v: unknown): string | null => { const t = String(v ?? "").trim(); return t || null; };

const hotelBlock = (cfg: Settings) => ({
  adatszolgaltatasiAzonosito: String(cfg.adatszolgaltatasi_azonosito),
  szallasNev: String(cfg.szallas_nev ?? cfg.hotel_id),
  szallashelySzolgaltatoAdoszam: String(cfg.szolgaltato_adoszam ?? ""),
  szallashelySzolgaltatoNev: String(cfg.szolgaltato_nev ?? ""),
});

type QueueRow = { id: string; erkezes_azonosito: string };

async function markResult(db: Db, rows: QueueRow[], kind: "arrival" | "departure", responseXml: string | null, error: string | null) {
  const stateColumn = kind === "arrival" ? "arrival_state" : "departure_state";
  const now = () => new Date().toISOString();
  const outcome = readSubmissionOutcome(responseXml, rows.map((r) => r.erkezes_azonosito));
  if (!outcome) {
    // Technical failure: count the attempt, the retry schedule decides when it goes out again.
    const message = (error ?? readXmlTag(responseXml ?? "", "faultstring") ?? "THF request failed").slice(0, 300);
    await db.rpc("viza_bump_attempts", { _ids: rows.map((r) => r.id), _kind: kind, _error: message });
    return;
  }
  const idOf = new Map(rows.map((r) => [r.erkezes_azonosito, r.id]));
  const accepted = outcome.guests.filter((g) => g.result === "accepted").map((g) => idOf.get(g.erkezesAzonosito)!);
  if (accepted.length) {
    await db.from("viza_guest_events").update(
      kind === "arrival"
        ? { arrival_state: "sent", arrival_fogadas_azonosito: outcome.fogadasAzonosito, attempts: 0, last_error: null, updated_at: now() }
        : { departure_state: "sent", departure_fogadas_azonosito: outcome.fogadasAzonosito, attempts: 0, last_error: null, updated_at: now() },
    ).in("id", accepted);
  }
  for (const guest of outcome.guests) {
    if (guest.result !== "rejected") continue; // "resend" guests stay queued for the next run
    await db.from("viza_guest_events").update({
      [stateColumn]: "failed",
      attempts: NEEDS_CORRECTION,
      last_error: `THF ${guest.code}${guest.text ? `: ${guest.text}` : ""}`.slice(0, 300),
      updated_at: now(),
    }).eq("id", idOf.get(guest.erkezesAzonosito)!);
  }
}

type DueRow = QueueRow & Record<string, unknown> & { attempts: number; updated_at: string };

/** Queued guests (no failed send yet) go out at once; failed sends wait for their place in the retry schedule. */
function dueNow(rows: DueRow[] | null | undefined): DueRow[] {
  const now = new Date();
  return (rows ?? [])
    .filter((row) => isDue(row.attempts, row.updated_at, now))
    .slice(0, BATCH);
}

async function runWorker(db: Db): Promise<Record<string, unknown>> {
  const report: Record<string, unknown> = {};
  const { data: hotels } = await db.from("viza_settings").select("*").eq("enabled", true)
    .not("adatszolgaltatasi_azonosito", "is", null);
  for (const cfg of (hotels ?? []) as Settings[]) {
    const line: Record<string, unknown> = {};
    report[cfg.hotel_id] = line;
    try {
      const creds = await hotelCredentials(db, cfg.hotel_id);
      if (!creds) {
        line.skipped = "no NTAK certificate for this hotel";
        await db.from("viza_settings").update({ last_error: "No NTAK certificate installed for this hotel", updated_at: new Date().toISOString() }).eq("hotel_id", cfg.hotel_id);
        continue;
      }
      const signer = await signerFor(creds);

      // 1. Status poll (spec 4.1) — counters must reach the UI.
      const statusRes = await callThf(cfg, buildStatusBody(), signer);
      const code = readXmlTag(statusRes.body, "allapotKod");
      const statusProblem = code ? null : `Status call failed: HTTP ${statusRes.status} ${readXmlTag(statusRes.body, "faultstring") ?? ""}`.trim().slice(0, 300);
      line.status = code ?? statusProblem;
      line.thf_time = readXmlTag(statusRes.body, "idoPecset");
      await db.from("viza_settings").update({
        last_status_code: code ?? `HTTP ${statusRes.status}`,
        last_status_at: new Date().toISOString(),
        unsent_count: Number(readXmlTag(statusRes.body, "bekuldetlenUzenetekSzama") ?? 0),
        failed_count: Number(readXmlTag(statusRes.body, "hibasUzenetekSzama") ?? 0),
        last_error: statusProblem,
        updated_at: new Date().toISOString(),
      }).eq("hotel_id", cfg.hotel_id);

      // 2. Arrivals.
      const { data: arrivalRows } = await db.from("viza_guest_events")
        .select("id, erkezes_azonosito, erkezes_ideje, tavozas_varhato_datuma, guest_id, attempts, updated_at, arrival_state")
        .eq("hotel_id", cfg.hotel_id).in("arrival_state", ["queued", "failed"])
        .lt("attempts", NEEDS_CORRECTION).order("created_at").limit(BATCH * 5);
      const arrivals = dueNow(arrivalRows);
      if (arrivals.length) {
        const guestIds = arrivals.map((a) => a.guest_id).filter(Boolean);
        const { data: guestRows } = guestIds.length
          ? await db.from("guests").select("id, first_name, last_name, birth_last_name, birth_first_name, date_of_birth, birth_place, mother_name, gender, nationality, id_document_type, id_document_number, visa_number, entry_date, entry_place, document_scan").in("id", guestIds)
          : { data: [] };
        const guestById = new Map((guestRows ?? []).map((g: { id: string }) => [g.id, g]));
        const vizaGuests: VizaArrivalGuest[] = arrivals.map((a) => {
          const guest = a.guest_id ? guestById.get(a.guest_id as string) : null;
          const groups = guest ? guestToVizaGroups(guest as never) : { scanned: null, manual: null };
          return {
            erkezesAzonosito: String(a.erkezes_azonosito),
            erkezesIdeje: vizaTimestamp(new Date(String(a.erkezes_ideje))),
            tavozasVarhatoDatuma: String(a.tavozas_varhato_datuma),
            scanned: groups.scanned,
            manual: groups.manual,
            vizumEngedelySzam: text((guest as GuestExtras | null)?.visa_number),
            beutazasDatuma: text((guest as GuestExtras | null)?.entry_date),
            beutazasHelye: text((guest as GuestExtras | null)?.entry_place),
          };
        });
        const bejelentes = vizaTimestamp(new Date());
        const draft = buildArrivalBody({ uzenetAzonosito: crypto.randomUUID(), hotel: hotelBlock(cfg), bejelentesIdopontja: bejelentes, alairas: "", alairoTanusitvany: signer.certB64 }, vizaGuests);
        const alairas = await signEllenorzoString(draft.ellenorzoString, signer.validationKey);
        const { xml } = buildArrivalBody({ uzenetAzonosito: crypto.randomUUID(), hotel: hotelBlock(cfg), bejelentesIdopontja: bejelentes, alairas, alairoTanusitvany: signer.certB64 }, vizaGuests);
        try {
          const res = await sendToThf(cfg, xml, signer);
          line.arrivals = { sent: arrivals.length, http: res.status };
          await markResult(db, arrivals, "arrival", res.body, null);
        } catch (err) {
          line.arrivals = { sent: arrivals.length, error: String(err instanceof Error ? err.message : err) };
          await markResult(db, arrivals, "arrival", null, String(err instanceof Error ? err.message : err));
        }
      }

      // 3. Departures.
      const { data: departureRows } = await db.from("viza_guest_events")
        .select("id, erkezes_azonosito, tavozas_ideje, attempts, updated_at, departure_state")
        .eq("hotel_id", cfg.hotel_id).eq("arrival_state", "sent").in("departure_state", ["queued", "failed"])
        .lt("attempts", NEEDS_CORRECTION).order("updated_at").limit(BATCH * 5);
      const departures = dueNow(departureRows);
      if (departures.length) {
        const bejelentes = vizaTimestamp(new Date());
        const guests = departures.map((d) => ({
          erkezesAzonosito: String(d.erkezes_azonosito),
          tavozasIdeje: vizaTimestamp(new Date(String(d.tavozas_ideje))),
        }));
        const draft = buildDepartureBody({ uzenetAzonosito: crypto.randomUUID(), hotel: hotelBlock(cfg), bejelentesIdopontja: bejelentes, alairas: "", alairoTanusitvany: signer.certB64 }, guests);
        const alairas = await signEllenorzoString(draft.ellenorzoString, signer.validationKey);
        const { xml } = buildDepartureBody({ uzenetAzonosito: crypto.randomUUID(), hotel: hotelBlock(cfg), bejelentesIdopontja: bejelentes, alairas, alairoTanusitvany: signer.certB64 }, guests);
        try {
          const res = await sendToThf(cfg, xml, signer);
          line.departures = { sent: departures.length, http: res.status };
          await markResult(db, departures, "departure", res.body, null);
        } catch (err) {
          line.departures = { sent: departures.length, error: String(err instanceof Error ? err.message : err) };
          await markResult(db, departures, "departure", null, String(err instanceof Error ? err.message : err));
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      line.error = message;
      await db.from("viza_settings").update({ last_error: message.slice(0, 300), updated_at: new Date().toISOString() }).eq("hotel_id", cfg.hotel_id);
    }
  }
  return report;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  const db = serviceDb();
  let payload: Record<string, unknown> = {};
  try { payload = await req.json(); } catch { /* empty body is fine for worker */ }

  if (await workerAuthorized(req, db)) {
    return json({ ok: true, report: await runWorker(db) });
  }

  const action = String(payload.action ?? "status");
  const hotelId = String(payload.hotel_id ?? "");
  if (!hotelId) return json({ ok: false, error: "hotel_id is required" }, 400);
  const callerOr = await authorizeHotelCaller(req, db, hotelId);
  if (callerOr instanceof Response) return callerOr;
  const caller = callerOr as Caller;
  if (!hasRole(caller, VIEW_ROLES)) return json({ ok: false, error: "Forbidden" }, 403);

  switch (action) {
    case "status": {
      const { data: settings } = await db.from("viza_settings").select("*").eq("hotel_id", hotelId).maybeSingle();
      const { data: eventRows } = await db.from("viza_guest_events")
        .select("id, reservation_id, guest_id, erkezes_azonosito, arrival_state, departure_state, last_error, erkezes_ideje, tavozas_ideje, attempts, updated_at")
        .eq("hotel_id", hotelId).order("updated_at", { ascending: false }).limit(20);
      const guestIds = [...new Set((eventRows ?? []).map((e: { guest_id: string | null }) => e.guest_id).filter(Boolean))];
      const { data: guestNames } = guestIds.length
        ? await db.from("guests").select("id, first_name, last_name").in("id", guestIds)
        : { data: [] };
      const nameOf = new Map((guestNames ?? []).map((g: { id: string; first_name: string | null; last_name: string | null }) => [g.id, `${g.last_name ?? ""} ${g.first_name ?? ""}`.trim()]));
      const events = (eventRows ?? []).map((e: Record<string, unknown>) => {
        const failed = e.arrival_state === "failed" || e.departure_state === "failed";
        const attempts = Number(e.attempts ?? 0);
        return {
          ...e,
          guest_name: e.guest_id ? nameOf.get(e.guest_id as string) ?? null : null,
          // The guest's data was refused: staff must correct it, no automatic retry.
          needs_correction: failed && attempts >= NEEDS_CORRECTION,
          next_attempt_at: failed && attempts < NEEDS_CORRECTION ? nextAttemptAt(attempts, String(e.updated_at))?.toISOString() ?? null : null,
        };
      });
      const { count: queued } = await db.from("viza_guest_events")
        .select("id", { count: "exact", head: true })
        .eq("hotel_id", hotelId).or("arrival_state.in.(queued,failed),departure_state.in.(queued,failed)");
      return json({ ok: true, configured: !!(await hotelCredentials(db, hotelId)), settings: settings ?? null, queued: queued ?? 0, events, can_manage: hasRole(caller, MANAGE_ROLES) });
    }
    case "save_settings": {
      if (!hasRole(caller, MANAGE_ROLES)) return json({ ok: false, error: "Forbidden" }, 403);
      const s = (payload.settings ?? {}) as Record<string, unknown>;
      const row = {
        hotel_id: hotelId,
        organization_slug: caller.organizationSlug ?? "",
        enabled: s.enabled === true,
        thf_url: String(s.thf_url ?? "https://thf-uat.thf.hu/ws"),
        environment: s.environment === "production" ? "production" : "test",
        adatszolgaltatasi_azonosito: String(s.adatszolgaltatasi_azonosito ?? "").trim() || null,
        szallas_nev: String(s.szallas_nev ?? "").trim() || null,
        szolgaltato_adoszam: String(s.szolgaltato_adoszam ?? "").trim() || null,
        szolgaltato_nev: String(s.szolgaltato_nev ?? "").trim() || null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await db.from("viza_settings").upsert(row, { onConflict: "hotel_id" });
      if (error) return json({ ok: false, error: error.message }, 400);
      return json({ ok: true });
    }
    case "retry": {
      // Reception corrects the guest's data and sends again: open to everyone who works the front desk.
      const eventId = String(payload.event_id ?? "");
      const { data: event } = await db.from("viza_guest_events").select("id, arrival_state, departure_state")
        .eq("hotel_id", hotelId).eq("id", eventId).maybeSingle();
      if (!event) return json({ ok: false, error: "Not found" }, 404);
      const { error } = await db.from("viza_guest_events").update({
        arrival_state: event.arrival_state === "failed" ? "queued" : event.arrival_state,
        departure_state: event.departure_state === "failed" ? "queued" : event.departure_state,
        attempts: 0, last_error: null, updated_at: new Date().toISOString(),
      }).eq("hotel_id", hotelId).eq("id", eventId);
      if (error) return json({ ok: false, error: error.message }, 400);
      return json({ ok: true });
    }
    case "unsent_list": {
      if (!hasRole(caller, MANAGE_ROLES)) return json({ ok: false, error: "Forbidden" }, 403);
      const { data: cfg } = await db.from("viza_settings").select("*").eq("hotel_id", hotelId).maybeSingle();
      if (!cfg) return json({ ok: false, error: "VIZA is not set up for this hotel" }, 400);
      const creds = await hotelCredentials(db, hotelId);
      if (!creds) return json({ ok: false, error: "No NTAK certificate installed for this hotel" }, 400);
      try {
        const signer = await signerFor(creds);
        const lists: Record<string, unknown> = {};
        for (const kind of ["NEMBEKULDOTT", "HIBAS"] as const) {
          const res = await callThf(cfg as Settings, buildUnsentListBody(kind), signer);
          lists[kind] = parseUnsentList(res.body);
        }
        return json({ ok: true, lists });
      } catch (err) {
        return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
      }
    }
    default:
      return json({ ok: false, error: `Unknown action: ${action}` }, 400);
  }
});
