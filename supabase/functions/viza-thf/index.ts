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
 *   worker (x-worker-secret, cron):  status poll + drain arrival/departure queues + 1-hour support alerts
 *   desk_send_now (JWT, reception):  send right away after check-in, check-out or a correction (guide 6.2),
 *                                    and return each guest's result for the live note / correction popup
 *   desk_status / desk_retry:        rejected guests to correct, and the outage summary, for reception
 *   status (JWT, hotel staff):       settings + counters + recent events for the UI
 *   save_settings (JWT, managers):   per-hotel VIZA identity and enable switch
 *   retry (JWT, reception staff):    send a failed or rejected guest again (after correcting the data)
 *   unsent_list (JWT, managers):     messages the THF holds as unsent / rejected
 *
 * The THF being unreachable must never block the front desk (spec 4): events
 * stay queued and the worker keeps retrying; counters surface in Reception.
 */
import { authorizeHotelCaller, json, serviceDb, workerAuthorized, type Caller } from "../_shared/channex/http.ts";
import { buildArrivalBody, buildDepartureBody, buildStatusBody, buildUnsentListBody, parseUnsentList, readXmlTag, readXmlTags, vizaTimestamp, type VizaArrivalGuest } from "../_shared/viza/messages.ts";
import { postSoap } from "../_shared/ntak/transport.ts";
import { importSigningKey, signEnvelope } from "../_shared/ntak/wssec.ts";
import { firstCertificatePem, normalizePrivateKeyPem } from "../_shared/ntak/x509.ts";
import { guestToVizaGroups } from "../_shared/viza/mapGuest.ts";
import { vizaArrivalExtras } from "../_shared/viza/fieldRules.ts";
import { isDueFor, NEEDS_CORRECTION, nextSendAt, readSubmissionOutcome, workerRunAtOrAfter } from "../_shared/viza/outcome.ts";
import { b64encode, importRsaKey, pemToDer, signEllenorzoString } from "../_shared/viza/wssec.ts";
import { correctionAlertEmail, correctionCutoff, decideProblem, problemAlertEmail, problemFromStatus, problemResolvedEmail, SUPPORT_INBOX, type ProblemKind, type ProblemState } from "../_shared/viza/alerts.ts";
import { loadEmailSettings, sendEmail } from "../_shared/emailSender.ts";

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

async function callThf(cfg: Pick<Settings, "thf_url" | "thf_ca_pem" | "thf_via_gateway">, bodyXml: string, signer: Signer) {
  const url = cfg.thf_url;
  const envelope = await signEnvelope({ requestXml: bodyXml, certPem: signer.creds.certPem, key: signer.envelopeKey, profile: "rsa-sha384" });
  const ownProxy = env("VIZA_EGRESS_PROXY_URL");
  const result = await postSoap(envelope, {
    url, certPem: signer.creds.certPem, keyPem: signer.creds.keyPem,
    proxyUrl: ownProxy ?? env("NTAK_EGRESS_PROXY_URL"),
    proxyUser: ownProxy ? env("VIZA_EGRESS_PROXY_USER") : env("NTAK_EGRESS_PROXY_USER"),
    proxyPassword: ownProxy ? env("VIZA_EGRESS_PROXY_PASSWORD") : env("NTAK_EGRESS_PROXY_PASSWORD"),
    caCertsPem: cfg.thf_ca_pem,
    // A self-hosted THF whose certificate the runtime cannot verify is reached through the gateway.
    forwardClientCredentials: cfg.thf_via_gateway === true,
  });
  if (result.error && !result.body) throw new Error(result.error);
  return result;
}

/** A send that cannot reach the THF is tried three times in a row before it counts as one failed attempt. */
async function sendToThf(cfg: Pick<Settings, "thf_url" | "thf_ca_pem" | "thf_via_gateway">, bodyXml: string, signer: Signer) {
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
  /** CA certificate(s) of a self-hosted THF, PEM; null for a THF with a publicly trusted certificate. In gateway mode: the gateway's CA. */
  thf_ca_pem?: string | null;
  /** Self-hosted THF reached through the HotelCare THF gateway on the THF server (ops/viza-thf-gateway). */
  thf_via_gateway?: boolean | null;
};



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

/**
 * Queued guests (no failed send yet) go out at once; failed sends wait for their place in the retry
 * schedule. An instant send takes only guests never tried, so it cannot use up the retry steps of
 * older reports during an outage (see isDueFor).
 */
function dueNow(rows: DueRow[] | null | undefined, mode: "worker" | "instant"): DueRow[] {
  const now = new Date();
  return (rows ?? [])
    .filter((row) => isDueFor(mode, row.attempts, row.updated_at, now))
    .slice(0, BATCH);
}

/** Arrivals then departures that are due now, for one hotel. */
async function sendDue(db: Db, cfg: Settings, signer: Signer, line: Record<string, unknown>, mode: "worker" | "instant"): Promise<{ technicalError: string | null; sent: number }> {
  let technicalError: string | null = null;
  let sent = 0;

  // Arrivals.
  const { data: arrivalRows } = await db.from("viza_guest_events")
    .select("id, reservation_id, erkezes_azonosito, erkezes_ideje, tavozas_varhato_datuma, guest_id, attempts, updated_at, arrival_state")
    .eq("hotel_id", cfg.hotel_id).in("arrival_state", ["queued", "failed"])
    .lt("attempts", NEEDS_CORRECTION).order("created_at").limit(BATCH * 5);
  const arrivals = dueNow(arrivalRows, mode);
  if (arrivals.length) {
    const guestIds = arrivals.map((a) => a.guest_id).filter(Boolean);
    const { data: guestRows } = guestIds.length
      ? await db.from("guests").select("id, first_name, last_name, birth_last_name, birth_first_name, date_of_birth, birth_place, mother_name, mother_family_name, mother_given_name, gender, nationality, id_document_type, id_document_number, visa_number, entry_date, entry_place, document_scan, viza_review").in("id", guestIds)
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
        ...vizaArrivalExtras(guest as Parameters<typeof vizaArrivalExtras>[0], String(a.reservation_id)),
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
      sent += arrivals.length;
    } catch (err) {
      technicalError = String(err instanceof Error ? err.message : err);
      line.arrivals = { sent: arrivals.length, error: technicalError };
      await markResult(db, arrivals, "arrival", null, technicalError);
    }
  }

  // Departures (only after the arrival was accepted).
  const { data: departureRows } = await db.from("viza_guest_events")
    .select("id, erkezes_azonosito, tavozas_ideje, attempts, updated_at, departure_state")
    .eq("hotel_id", cfg.hotel_id).eq("arrival_state", "sent").in("departure_state", ["queued", "failed"])
    .lt("attempts", NEEDS_CORRECTION).order("updated_at").limit(BATCH * 5);
  const departures = dueNow(departureRows, mode);
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
      sent += departures.length;
    } catch (err) {
      technicalError = String(err instanceof Error ? err.message : err);
      line.departures = { sent: departures.length, error: technicalError };
      await markResult(db, departures, "departure", null, technicalError);
    }
  }
  return { technicalError, sent };
}

/** Guest reports waiting in HotelCare (queued, or a technical retry pending). */
async function waitingCount(db: Db, hotelId: string): Promise<number> {
  const { count } = await db.from("viza_guest_events")
    .select("id", { count: "exact", head: true })
    .eq("hotel_id", hotelId).lt("attempts", NEEDS_CORRECTION)
    .or("arrival_state.in.(queued,failed),departure_state.in.(queued,failed)");
  return count ?? 0;
}

/** Branded HotelCare sender for support alerts; sent even if the hotel switched off its own transactional e-mails. */
async function mailSupport(db: Db, cfg: Settings, mail: { subject: string; html: string; text: string }): Promise<boolean> {
  try {
    const base = await loadEmailSettings(db, cfg.organization_slug);
    const settings = { ...base, organization_slug: cfg.organization_slug, transactional_enabled: true, from_name: "HotelCare.app", from_email: "notifications@updates.hotelcare.app", reply_to: SUPPORT_INBOX };
    const result = await sendEmail({ admin: db, organizationSlug: cfg.organization_slug, to: [SUPPORT_INBOX], subject: mail.subject, html: mail.html, text: mail.text, kind: "transactional", settings });
    if (!result.ok) console.warn("VIZA support alert not sent", cfg.hotel_id, result.error);
    return result.ok;
  } catch (err) {
    console.warn("VIZA support alert failed", cfg.hotel_id, err instanceof Error ? err.message : err);
    return false;
  }
}

/** Record the current problem (or its end) and tell HotelCare support after an hour; a short note when it is over. */
async function trackProblem(db: Db, cfg: Settings, kind: ProblemKind | null, line: Record<string, unknown>) {
  const { data: prev } = await db.from("viza_settings")
    .select("problem_since, problem_kind, problem_alert_sent_at, last_status_code, last_error")
    .eq("hotel_id", cfg.hotel_id).maybeSingle();
  if (!prev) return;
  const now = new Date();
  const decision = decideProblem(prev as ProblemState, kind, now);
  const changed = decision.next.problem_since !== prev.problem_since || decision.next.problem_kind !== prev.problem_kind || decision.clearAlert;
  if (changed) {
    await db.from("viza_settings").update({ ...decision.next, ...(decision.clearAlert ? { problem_alert_sent_at: null } : {}) }).eq("hotel_id", cfg.hotel_id);
  }
  const hotelName = cfg.szallas_nev ?? cfg.hotel_id;
  if (decision.sendAlert && kind && decision.next.problem_since) {
    const ok = await mailSupport(db, cfg, problemAlertEmail({
      hotelName, hotelId: cfg.hotel_id, kind, since: decision.next.problem_since,
      waiting: await waitingCount(db, cfg.hotel_id), statusCode: prev.last_status_code ?? null, lastError: prev.last_error ?? null,
    }));
    if (ok) await db.from("viza_settings").update({ problem_alert_sent_at: now.toISOString() }).eq("hotel_id", cfg.hotel_id);
    line.alert = ok ? "support notified" : "support alert failed";
  }
  if (decision.sendResolved) {
    await mailSupport(db, cfg, problemResolvedEmail({ hotelName, hotelId: cfg.hotel_id, since: prev.problem_since, now }));
    line.alert = "support told it is resolved";
  }
}

/** Rejected guest reports nobody corrected within the hour: one e-mail per hotel, booking numbers and THF codes only. */
async function alertUncorrected(db: Db, cfg: Settings, line: Record<string, unknown>) {
  const { data: rows } = await db.from("viza_guest_events")
    .select("id, reservation_id, arrival_state, departure_state, last_error, updated_at")
    .eq("hotel_id", cfg.hotel_id).gte("attempts", NEEDS_CORRECTION).is("correction_alert_sent_at", null)
    .lt("updated_at", correctionCutoff(new Date()))
    .or("arrival_state.eq.failed,departure_state.eq.failed").limit(50);
  if (!rows?.length) return;
  const reservationIds = [...new Set(rows.map((r: { reservation_id: string }) => r.reservation_id))];
  const { data: reservations } = await db.from("reservations").select("id, reservation_number").in("id", reservationIds);
  const numberOf = new Map((reservations ?? []).map((r: { id: string; reservation_number: string | null }) => [r.id, r.reservation_number]));
  const ok = await mailSupport(db, cfg, correctionAlertEmail({
    hotelName: cfg.szallas_nev ?? cfg.hotel_id, hotelId: cfg.hotel_id,
    items: rows.map((r: { reservation_id: string; arrival_state: string; last_error: string | null; updated_at: string }) => ({
      reservationNumber: numberOf.get(r.reservation_id) ?? null,
      phase: r.arrival_state === "failed" ? "arrival" : "departure",
      error: (r.last_error ?? "").split(":")[0] || null,
      since: r.updated_at,
    })),
  }));
  if (ok) await db.from("viza_guest_events").update({ correction_alert_sent_at: new Date().toISOString() }).in("id", rows.map((r: { id: string }) => r.id));
  line.correctionAlert = ok ? `${rows.length} reported to support` : "correction alert failed";
}

/**
 * One hotel. "worker" (cron, every 10 minutes): status poll, sends, problem tracking, alerts.
 * "instant" (reception, right after check-in, check-out or a correction): sends only, as
 * guide 6.2 expects the data at the moment of check-in; a status poll here would add load
 * without new information (guide 4: 1–60 minutes).
 */
async function processHotel(db: Db, cfg: Settings, mode: "worker" | "instant"): Promise<Record<string, unknown>> {
  const line: Record<string, unknown> = {};
  try {
    const creds = await hotelCredentials(db, cfg.hotel_id);
    if (!creds) {
      line.skipped = "no NTAK certificate for this hotel";
      await db.from("viza_settings").update({ last_error: "No NTAK certificate installed for this hotel", updated_at: new Date().toISOString() }).eq("hotel_id", cfg.hotel_id);
      await trackProblem(db, cfg, "no_certificate", line);
      return line;
    }
    const signer = await signerFor(creds);

    let statusKind: ProblemKind | null = null;
    if (mode === "worker") {
      // Status poll (spec 4.1) — counters must reach the UI.
      const statusRes = await callThf(cfg, buildStatusBody(), signer);
      const code = readXmlTag(statusRes.body, "allapotKod");
      const statusProblem = code ? null : `Status call failed: HTTP ${statusRes.status} ${readXmlTag(statusRes.body, "faultstring") ?? ""}`.trim().slice(0, 300);
      line.status = code ?? statusProblem;
      line.thf_time = readXmlTag(statusRes.body, "idoPecset");
      statusKind = problemFromStatus(code);
      await db.from("viza_settings").update({
        last_status_code: code ?? `HTTP ${statusRes.status}`,
        last_status_at: new Date().toISOString(),
        unsent_count: Number(readXmlTag(statusRes.body, "bekuldetlenUzenetekSzama") ?? 0),
        failed_count: Number(readXmlTag(statusRes.body, "hibasUzenetekSzama") ?? 0),
        last_error: statusProblem,
        updated_at: new Date().toISOString(),
      }).eq("hotel_id", cfg.hotel_id);
    }

    const result = await sendDue(db, cfg, signer, line, mode);

    if (mode === "worker") {
      if (result.technicalError && !statusKind) {
        // The status answered but the guest data did not get through: show it like an outage.
        await db.from("viza_settings").update({ last_error: result.technicalError.slice(0, 300), updated_at: new Date().toISOString() }).eq("hotel_id", cfg.hotel_id);
      }
      await trackProblem(db, cfg, result.technicalError ? (statusKind ?? "unreachable") : statusKind, line);
      await alertUncorrected(db, cfg, line);
    } else if (result.technicalError) {
      await db.from("viza_settings").update({ last_error: result.technicalError.slice(0, 300), updated_at: new Date().toISOString() }).eq("hotel_id", cfg.hotel_id);
      await trackProblem(db, cfg, "unreachable", line);
    } else if (result.sent > 0) {
      // A send got through: the THF answers, so an "unreachable" problem is over. WARNING/ERROR stay until the next status poll.
      const { data: now } = await db.from("viza_settings").select("problem_kind").eq("hotel_id", cfg.hotel_id).maybeSingle();
      if (now?.problem_kind === "unreachable") {
        await db.from("viza_settings").update({ last_error: null }).eq("hotel_id", cfg.hotel_id);
        await trackProblem(db, cfg, null, line);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    line.error = message;
    await db.from("viza_settings").update({ last_error: message.slice(0, 300), updated_at: new Date().toISOString() }).eq("hotel_id", cfg.hotel_id);
    await trackProblem(db, cfg, "unreachable", line);
  }
  return line;
}

/**
 * Only one sender talks to the THF for a hotel at a time (the cron worker or an
 * instant send), so the same guest is never sent twice. The worker skips a busy
 * hotel; an instant send waits a few seconds for the lease.
 */
async function withSendLock<T>(db: Db, hotelId: string, waitSeconds: number, run: () => Promise<T>): Promise<{ busy: true } | { busy: false; value: T }> {
  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    const { data: got, error } = await db.rpc("viza_try_send_lock", { _hotel_id: hotelId, _seconds: 90 });
    if (error) {
      // The lock itself is unavailable (e.g. database change not applied yet): never let that stop reporting.
      console.warn("VIZA send lock unavailable; sending without it", hotelId, error.message);
      return { busy: false, value: await run() };
    }
    if (got === true) break;
    if (Date.now() >= deadline) return { busy: true };
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  try {
    return { busy: false, value: await run() };
  } finally {
    await db.rpc("viza_release_send_lock", { _hotel_id: hotelId });
  }
}

async function runWorker(db: Db): Promise<Record<string, unknown>> {
  const report: Record<string, unknown> = {};
  const { data: hotels } = await db.from("viza_settings").select("*").eq("enabled", true)
    .not("adatszolgaltatasi_azonosito", "is", null);
  for (const cfg of (hotels ?? []) as Settings[]) {
    const run = await withSendLock(db, cfg.hotel_id, 0, () => processHotel(db, cfg, "worker"));
    report[cfg.hotel_id] = run.busy ? { skipped: "an instant send is running; next run in 10 minutes" } : run.value;
  }
  return report;
}

type Outcome = "accepted" | "rejected" | "pending";

/** What happened to one stay's guests, for the reception's live result. */
async function eventOutcomes(db: Db, hotelId: string, filter: { reservationId: string | null; eventId: string | null }, phase: "arrival" | "departure") {
  let query = db.from("viza_guest_events")
    .select("id, reservation_id, guest_id, arrival_state, departure_state, arrival_fogadas_azonosito, departure_fogadas_azonosito, last_error, attempts")
    .eq("hotel_id", hotelId);
  query = filter.eventId ? query.eq("id", filter.eventId) : query.eq("reservation_id", filter.reservationId);
  const { data: rows } = await query.limit(20);
  const events = (rows ?? []) as Array<Record<string, string | number | null>>;
  const guestIds = [...new Set(events.map((e) => e.guest_id).filter(Boolean))] as string[];
  const reservationIds = [...new Set(events.map((e) => e.reservation_id).filter(Boolean))] as string[];
  const [guests, reservations] = await Promise.all([
    guestIds.length ? db.from("guests").select("id, first_name, last_name").in("id", guestIds) : { data: [] },
    reservationIds.length ? db.from("reservations").select("id, reservation_number").eq("hotel_id", hotelId).in("id", reservationIds) : { data: [] },
  ]);
  const nameOf = new Map((guests.data ?? []).map((g: { id: string; first_name: string | null; last_name: string | null }) => [g.id, `${g.last_name ?? ""} ${g.first_name ?? ""}`.trim()]));
  const numberOf = new Map((reservations.data ?? []).map((r: { id: string; reservation_number: string | null }) => [r.id, r.reservation_number]));
  return events.map((e) => {
    // A rejected arrival also blocks the departure, so the arrival decides first.
    const arrivalRejected = e.arrival_state === "failed" && Number(e.attempts) >= NEEDS_CORRECTION;
    const state = phase === "departure" && !arrivalRejected ? e.departure_state : e.arrival_state;
    const rejected = state === "failed" && Number(e.attempts) >= NEEDS_CORRECTION;
    const outcome: Outcome = state === "sent" ? "accepted" : rejected ? "rejected" : "pending";
    return {
      event_id: e.id,
      phase: phase === "departure" && !arrivalRejected ? "departure" : "arrival",
      outcome,
      receipt: outcome === "accepted" ? (phase === "departure" && !arrivalRejected ? e.departure_fogadas_azonosito : e.arrival_fogadas_azonosito) : null,
      error: outcome === "rejected" ? e.last_error : null,
      guest_name: e.guest_id ? nameOf.get(String(e.guest_id)) ?? null : null,
      reservation_number: numberOf.get(String(e.reservation_id)) ?? null,
    };
  });
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
  const canManage = caller.isSuperAdmin || ["admin", "top_management", "top_management_manager"].includes(caller.role);
  // Operational repair is deliberately separate from leadership-only reports/settings.
  // No raw authority XML, settings, identifiers or certificate information are returned.
  if (action === "desk_status" || action === "desk_retry" || action === "desk_send_now") {
    const { data: allowed } = await db.rpc("can_access_pms_hotel", {
      _uid: caller.userId, _hotel_id: hotelId, _org_slug: caller.organizationSlug,
    });
    if (!canManage && allowed !== true) return json({ ok: false, error: "Forbidden" }, 403);
    const { data: cfg, error: cfgError } = await db.from("viza_settings").select("*").eq("hotel_id", hotelId).maybeSingle();
    if (cfgError) return json({ ok: false, error: "Cannot load VIZA repair tasks" }, 500);
    if (!cfg?.enabled) return json({ ok: true, enabled: false, events: [], total: 0, results: [] });
    if (action === "desk_send_now") {
      // Guide 6.2: the data is expected at the moment of check-in. Reception calls this in the
      // background; it never blocks the desk, and the 10-minute worker remains the safety net.
      if (!cfg.adatszolgaltatasi_azonosito) return json({ ok: true, enabled: false, results: [] });
      const reservationId = payload.reservation_id ? String(payload.reservation_id) : null;
      const eventId = payload.event_id ? String(payload.event_id) : null;
      if (!reservationId && !eventId) return json({ ok: false, error: "reservation_id or event_id is required" }, 400);
      const phase = payload.phase === "departure" ? "departure" : "arrival";
      const run = await withSendLock(db, hotelId, 12, () => processHotel(db, cfg as Settings, "instant"));
      const results = await eventOutcomes(db, hotelId, { reservationId, eventId }, phase);
      const { data: after } = await db.from("viza_settings").select("last_error, updated_at, problem_alert_sent_at").eq("hotel_id", hotelId).maybeSingle();
      const unreachable = !!after?.last_error;
      return json({
        ok: true, enabled: true, busy: run.busy, results, unreachable,
        // The next worker run: it checks the connection and sends what is waiting.
        next_try_at: unreachable ? workerRunAtOrAfter(new Date()).toISOString() : null,
        support_notified_at: after?.problem_alert_sent_at ?? null,
      });
    }
    if (action === "desk_retry") {
      const eventId = String(payload.event_id ?? "");
      const { data: event, error: eventError } = await db.from("viza_guest_events")
        .select("id, reservation_id, guest_id, arrival_state, attempts, erkezes_ideje")
        .eq("hotel_id", hotelId).eq("id", eventId).eq("arrival_state", "failed").gte("attempts", NEEDS_CORRECTION).maybeSingle();
      if (eventError || !event || !event.guest_id) return json({ ok: false, error: "Repair task not found" }, 404);
      const day = new Intl.DateTimeFormat("en-CA", {timeZone:"Europe/Budapest",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(event.erkezes_ideje));
      const { error: incomplete } = await db.rpc("pms_assert_viza_arrival_data", {_reservation_id:event.reservation_id,_guest_ids:[event.guest_id],_day:day});
      if (incomplete) return json({ ok: false, error: incomplete.message }, 400);
      const { data: updated, error } = await db.from("viza_guest_events").update({
        arrival_state: "queued", attempts: 0, last_error: null, correction_alert_sent_at: null, updated_at: new Date().toISOString(),
      }).eq("hotel_id",hotelId).eq("id",event.id).eq("arrival_state","failed").gte("attempts",NEEDS_CORRECTION).select("id").maybeSingle();
      if (error || !updated) return json({ ok:false,error:"Repair task changed; refresh and try again" },409);
      return json({ ok:true });
    }
    // Intentionally no reservation-status or date filter: rejected arrivals
    // remain actionable even if the guest has already checked out.
    const { data: rows, error, count } = await db.from("viza_guest_events")
      .select("id,reservation_id,guest_id,last_error",{count:"exact"}).eq("hotel_id",hotelId)
      .eq("arrival_state","failed").gte("attempts",NEEDS_CORRECTION)
      .order("updated_at",{ascending:true}).limit(50);
    if(error) return json({ok:false,error:"Cannot load VIZA repair tasks"},500);
    const events = rows ?? [];
    const reservationIds = [...new Set(events.map((e:{reservation_id:string})=>e.reservation_id))];
    const guestIds = [...new Set(events.map((e:{guest_id:string|null})=>e.guest_id).filter(Boolean))];
    const [reservations, guests] = await Promise.all([
      reservationIds.length ? db.from("reservations").select("id,reservation_number").eq("hotel_id",hotelId).in("id",reservationIds) : {data:[]},
      guestIds.length ? db.from("guests").select("id,first_name,last_name").in("id",guestIds) : {data:[]},
    ]);
    const numberOf=new Map((reservations.data??[]).map((x:{id:string;reservation_number:string})=>[x.id,x.reservation_number]));
    const nameOf=new Map((guests.data??[]).map((x:{id:string;first_name:string;last_name:string})=>[x.id,`${x.last_name??""} ${x.first_name??""}`.trim()]));
    // Reception also sees, in plain words, when the THF cannot be reached (case 2.6).
    const outage = cfg.last_error ? {
      since: cfg.problem_since ?? null,
      last_attempt_at: cfg.updated_at ?? null,
      // The next worker run, while the worker shows it is running (it marks every failed run).
      next_try_at: cfg.updated_at && Date.now() - Date.parse(cfg.updated_at) < 20 * 60_000 ? workerRunAtOrAfter(new Date()).toISOString() : null,
      waiting: await waitingCount(db, hotelId),
      support_notified_at: cfg.problem_alert_sent_at ?? null,
    } : null;
    return json({ok:true,enabled:true,outage,total:count??events.length,events:events.map((e:{id:string;reservation_id:string;guest_id:string|null})=>({
      ...e,reservation_number:numberOf.get(e.reservation_id)??null,guest_name:e.guest_id?nameOf.get(e.guest_id)??null:null,
    }))});
  }
  if (!canManage) return json({ ok: false, error: "Forbidden" }, 403);

  switch (action) {
    case "status": {
      const { data: settings } = await db.from("viza_settings").select("*").eq("hotel_id", hotelId).maybeSingle();
      const { data: eventRows } = await db.from("viza_guest_events")
        .select("id, reservation_id, guest_id, erkezes_azonosito, arrival_state, departure_state, last_error, erkezes_ideje, tavozas_ideje, arrival_fogadas_azonosito, departure_fogadas_azonosito, attempts, updated_at")
        .eq("hotel_id", hotelId).order("updated_at", { ascending: false }).limit(20);
      const guestIds = [...new Set((eventRows ?? []).map((e: { guest_id: string | null }) => e.guest_id).filter(Boolean))];
      const { data: guestNames } = guestIds.length
        ? await db.from("guests").select("id, first_name, last_name").in("id", guestIds)
        : { data: [] };
      const nameOf = new Map((guestNames ?? []).map((g: { id: string; first_name: string | null; last_name: string | null }) => [g.id, `${g.last_name ?? ""} ${g.first_name ?? ""}`.trim()]));
      const reservationIds = [...new Set((eventRows ?? []).map((e: { reservation_id: string }) => e.reservation_id))];
      const { data: reservations } = reservationIds.length
        ? await db.from("reservations").select("id,reservation_number").eq("hotel_id", hotelId).in("id", reservationIds)
        : { data: [] };
      const numberOf = new Map((reservations ?? []).map((row: { id: string; reservation_number: string | null }) => [row.id, row.reservation_number]));
      const events = (eventRows ?? []).map((e: Record<string, unknown>) => {
        const failed = e.arrival_state === "failed" || e.departure_state === "failed";
        const attempts = Number(e.attempts ?? 0);
        return {
          ...e,
          reservation_number: numberOf.get(e.reservation_id as string) ?? null,
          guest_name: e.guest_id ? nameOf.get(e.guest_id as string) ?? null : null,
          // The guest's data was refused: staff must correct it, no automatic retry.
          needs_correction: failed && attempts >= NEEDS_CORRECTION,
          next_attempt_at: failed && attempts < NEEDS_CORRECTION ? nextSendAt(attempts, String(e.updated_at))?.toISOString() ?? null : null,
        };
      });
      const { count: queued } = await db.from("viza_guest_events")
        .select("id", { count: "exact", head: true })
        .eq("hotel_id", hotelId).or("arrival_state.in.(queued,failed),departure_state.in.(queued,failed)");
      return json({ ok: true, configured: !!(await hotelCredentials(db, hotelId)), settings: settings ?? null, queued: queued ?? 0, events, can_manage: canManage });
    }
    case "save_settings": {
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
      const eventId = String(payload.event_id ?? "");
      const { data: event } = await db.from("viza_guest_events").select("id, arrival_state, departure_state")
        .eq("hotel_id", hotelId).eq("id", eventId).maybeSingle();
      if (!event) return json({ ok: false, error: "Not found" }, 404);
      const { error } = await db.from("viza_guest_events").update({
        arrival_state: event.arrival_state === "failed" ? "queued" : event.arrival_state,
        departure_state: event.departure_state === "failed" ? "queued" : event.departure_state,
        attempts: 0, last_error: null, correction_alert_sent_at: null, updated_at: new Date().toISOString(),
      }).eq("hotel_id", hotelId).eq("id", eventId);
      if (error) return json({ ok: false, error: error.message }, 400);
      return json({ ok: true });
    }
    case "unsent_list": {
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
