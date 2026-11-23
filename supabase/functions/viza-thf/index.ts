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
 *   retry (JWT, managers):           requeue a failed event
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
import { b64encode, importRsaKey, pemToDer, signEllenorzoString } from "../_shared/viza/wssec.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

const BATCH = 10; // spec: max 10 guests per message
const MAX_ATTEMPTS = 30;

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

async function callThf(url: string, bodyXml: string, signer: Signer) {
  const envelope = await signEnvelope({ requestXml: bodyXml, certPem: signer.creds.certPem, key: signer.envelopeKey, profile: "rsa-sha384" });
  const ownProxy = env("VIZA_EGRESS_PROXY_URL");
  const result = await postSoap(envelope, {
    url, certPem: signer.creds.certPem, keyPem: signer.creds.keyPem,
    proxyUrl: ownProxy ?? env("NTAK_EGRESS_PROXY_URL"),
    proxyUser: ownProxy ? env("VIZA_EGRESS_PROXY_USER") : env("NTAK_EGRESS_PROXY_USER"),
    proxyPassword: ownProxy ? env("VIZA_EGRESS_PROXY_PASSWORD") : env("NTAK_EGRESS_PROXY_PASSWORD"),
  });
  if (result.error && !result.body) throw new Error(result.error);
  return result;
}

type Settings = {
  hotel_id: string; organization_slug: string; enabled: boolean; thf_url: string;
  adatszolgaltatasi_azonosito: string | null; szallas_nev: string | null;
  szolgaltato_adoszam: string | null; szolgaltato_nev: string | null;
};

type GuestExtras = { visa_number?: string | null; entry_date?: string | null; entry_place?: string | null };
const text = (v: unknown): string | null => { const t = String(v ?? "").trim(); return t || null; };

const hotelBlock = (cfg: Settings) => ({
  adatszolgaltatasiAzonosito: String(cfg.adatszolgaltatasi_azonosito),
  szallasNev: String(cfg.szallas_nev ?? cfg.hotel_id),
  szallashelySzolgaltatoAdoszam: String(cfg.szolgaltato_adoszam ?? ""),
  szallashelySzolgaltatoNev: String(cfg.szolgaltato_nev ?? ""),
});

async function markResult(db: Db, ids: string[], kind: "arrival" | "departure", responseXml: string | null, error: string | null) {
  const okIds: string[] = [];
  const failures = new Map<string, string>();
  if (responseXml && readXmlTag(responseXml, "sikeresBefogadas") === "true") {
    const fogadas = readXmlTag(responseXml, "fogadasAzonosito");
    const items = readXmlTags(responseXml, "hibaLista");
    const codes = new Map(items.map((item) => [readXmlTag(item, "erkezesAzonosito") ?? "", readXmlTag(item, "hibaKod") ?? ""]));
    const { data: rows } = await db.from("viza_guest_events").select("id, erkezes_azonosito").in("id", ids);
    for (const row of rows ?? []) {
      const code = codes.get(row.erkezes_azonosito) ?? "OK";
      if (code === "OK") okIds.push(row.id);
      else failures.set(row.id, code);
    }
    if (okIds.length) {
      await db.from("viza_guest_events").update(
        kind === "arrival"
          ? { arrival_state: "sent", arrival_fogadas_azonosito: fogadas, last_error: null, updated_at: new Date().toISOString() }
          : { departure_state: "sent", departure_fogadas_azonosito: fogadas, last_error: null, updated_at: new Date().toISOString() },
      ).in("id", okIds);
    }
    for (const [id, code] of failures) {
      await db.from("viza_guest_events").update({
        [kind === "arrival" ? "arrival_state" : "departure_state"]: "failed",
        last_error: `THF ${code}`.slice(0, 300),
        updated_at: new Date().toISOString(),
      }).eq("id", id);
    }
    return;
  }
  const message = (error ?? readXmlTag(responseXml ?? "", "faultstring") ?? "THF request failed").slice(0, 300);
  await db.rpc("viza_bump_attempts", { _ids: ids, _kind: kind, _error: message });
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
      const statusRes = await callThf(cfg.thf_url, buildStatusBody(), signer);
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
      const { data: arrivals } = await db.from("viza_guest_events")
        .select("id, erkezes_azonosito, erkezes_ideje, tavozas_varhato_datuma, guest_id")
        .eq("hotel_id", cfg.hotel_id).in("arrival_state", ["queued", "failed"])
        .lt("attempts", MAX_ATTEMPTS).order("created_at").limit(BATCH);
      if (arrivals?.length) {
        const guestIds = arrivals.map((a: { guest_id: string | null }) => a.guest_id).filter(Boolean);
        const { data: guestRows } = guestIds.length
          ? await db.from("guests").select("id, first_name, last_name, birth_last_name, birth_first_name, date_of_birth, birth_place, mother_name, gender, nationality, id_document_type, id_document_number, visa_number, entry_date, entry_place, document_scan").in("id", guestIds)
          : { data: [] };
        const guestById = new Map((guestRows ?? []).map((g: { id: string }) => [g.id, g]));
        const vizaGuests: VizaArrivalGuest[] = arrivals.map((a: Record<string, unknown>) => {
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
        const res = await callThf(cfg.thf_url, xml, signer);
        line.arrivals = { sent: arrivals.length, http: res.status };
        await markResult(db, arrivals.map((a: { id: string }) => a.id), "arrival", res.status < 500 ? res.body : null, res.status >= 500 ? `HTTP ${res.status}` : null);
      }

      // 3. Departures.
      const { data: departures } = await db.from("viza_guest_events")
        .select("id, erkezes_azonosito, tavozas_ideje")
        .eq("hotel_id", cfg.hotel_id).eq("arrival_state", "sent").in("departure_state", ["queued", "failed"])
        .lt("attempts", MAX_ATTEMPTS).order("updated_at").limit(BATCH);
      if (departures?.length) {
        const bejelentes = vizaTimestamp(new Date());
        const guests = departures.map((d: Record<string, unknown>) => ({
          erkezesAzonosito: String(d.erkezes_azonosito),
          tavozasIdeje: vizaTimestamp(new Date(String(d.tavozas_ideje))),
        }));
        const draft = buildDepartureBody({ uzenetAzonosito: crypto.randomUUID(), hotel: hotelBlock(cfg), bejelentesIdopontja: bejelentes, alairas: "", alairoTanusitvany: signer.certB64 }, guests);
        const alairas = await signEllenorzoString(draft.ellenorzoString, signer.validationKey);
        const { xml } = buildDepartureBody({ uzenetAzonosito: crypto.randomUUID(), hotel: hotelBlock(cfg), bejelentesIdopontja: bejelentes, alairas, alairoTanusitvany: signer.certB64 }, guests);
        const res = await callThf(cfg.thf_url, xml, signer);
        line.departures = { sent: departures.length, http: res.status };
        await markResult(db, departures.map((d: { id: string }) => d.id), "departure", res.status < 500 ? res.body : null, res.status >= 500 ? `HTTP ${res.status}` : null);
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
      const { data: events } = await db.from("viza_guest_events")
        .select("id, reservation_id, erkezes_azonosito, arrival_state, departure_state, last_error, erkezes_ideje, tavozas_ideje, attempts")
        .eq("hotel_id", hotelId).order("updated_at", { ascending: false }).limit(20);
      const { count: queued } = await db.from("viza_guest_events")
        .select("id", { count: "exact", head: true })
        .eq("hotel_id", hotelId).or("arrival_state.in.(queued,failed),departure_state.in.(queued,failed)");
      return json({ ok: true, configured: !!(await hotelCredentials(db, hotelId)), settings: settings ?? null, queued: queued ?? 0, events: events ?? [], can_manage: hasRole(caller, MANAGE_ROLES) });
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
      if (!hasRole(caller, MANAGE_ROLES)) return json({ ok: false, error: "Forbidden" }, 403);
      const { error } = await db.from("viza_guest_events").update({ attempts: 0, last_error: null, updated_at: new Date().toISOString() })
        .eq("hotel_id", hotelId).eq("id", String(payload.event_id ?? ""));
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
          const res = await callThf((cfg as Settings).thf_url, buildUnsentListBody(kind), signer);
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
