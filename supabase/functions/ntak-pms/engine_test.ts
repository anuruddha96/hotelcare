// deno-lint-ignore-file no-explicit-any
/**
 * End-to-end test of the ntak-pms engine without network or a real database:
 * an in-memory Supabase client (column names checked against the repo's
 * migrations and generated types) and a local fake NTAK endpoint that checks
 * every request's WS-Security signature and validates it against the v9
 * schema before answering like NTAK does.
 *
 *   deno test --node-modules-dir=auto --allow-read --allow-write --allow-run --allow-env --allow-net supabase/functions/ntak-pms/engine_test.ts
 */
import { strict as assert } from "node:assert";
import { verifyEnvelope } from "../_shared/ntak/wssec.ts";
import { addDays } from "../_shared/ntak/ledger.ts";
import { isInNtakScope, loadNtakScope } from "./scope.ts";
import {
  buildClosure, classificationFor, closureOverride, resendSameContent, refreshHeader, detectDrift, loadUnits, markAllFutureBookings, processBookings, processEvents, queueClosure, queueStartDateQuery, sendDue, today, verifyDue, type Settings,
} from "./engine.ts";

const ROOT = new URL("../../../", import.meta.url).pathname;
const XSD = ROOT + "supabase/functions/_shared/ntak/testdata/ntak-v9.xsd";

// ---------------------------------------------------------------------------
// Schema registry from generated types + migrations

function schemaColumns(): Record<string, Set<string>> {
  const cols: Record<string, Set<string>> = {};
  const add = (t: string, c: string) => (cols[t] ??= new Set()).add(c);
  const types = Deno.readTextFileSync(ROOT + "src/integrations/supabase/types.ts");
  for (const m of types.matchAll(/\n {6}(\w+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/g)) for (const c of m[2].matchAll(/^ {10}(\w+)\??:/gm)) add(m[1], c[1]);
  for (const f of [...Deno.readDirSync(ROOT + "supabase/migrations")].map((e) => e.name).sort()) {
    const sql = Deno.readTextFileSync(ROOT + "supabase/migrations/" + f);
    for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?public\.(\w+) \(([\s\S]*?)\n\);/g)) {
      for (const line of m[2].split("\n")) {
        const w = line.trim().match(/^(\w+)\s+\w/);
        if (w && !/^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT|EXCLUDE)$/i.test(w[1])) add(m[1], w[1]);
      }
    }
    for (const m of sql.matchAll(/ALTER TABLE (?:IF EXISTS )?(?:ONLY )?public\.(\w+)([^;]*);/gi)) {
      for (const c of m[2].matchAll(/ADD COLUMN (?:IF NOT EXISTS )?(\w+)/gi)) add(m[1], c[1]);
    }
  }
  return cols;
}

// ---------------------------------------------------------------------------
// In-memory Supabase client (the subset the engine uses)

type Row = Record<string, any>;
const RELS: Record<string, Record<string, { table: string; local: string; foreign: string }>> = {
  folio_lines: {
    reservation_folios: { table: "reservation_folios", local: "folio_id", foreign: "id" },
    service_catalog_items: { table: "service_catalog_items", local: "service_catalog_item_id", foreign: "id" },
  },
  ntak_unit_profiles: { rooms: { table: "rooms", local: "room_id", foreign: "id" } },
};
const DEFAULTS: Record<string, () => Row> = {
  ntak_messages: () => ({ state: "queued", attempts: 0, warnings: [], errors: [], verify_attempts: 0, next_attempt_at: new Date(Date.now() - 1000).toISOString(), created_at: new Date().toISOString() }),
  ntak_daily_closures: () => ({ accepted_once: false, needs_correction: false }),
  ntak_booking_queue: () => ({ cancelled_sent: false, dirty_at: new Date().toISOString() }),
};

function splitTop(s: string): string[] {
  const out: string[] = []; let depth = 0; let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

class FakeDb {
  tables: Record<string, Row[]> = {};
  secrets = new Map<string, string>();
  constructor(public columns: Record<string, Set<string>>) {}
  check(table: string, col: string) {
    if (!this.columns[table]) throw new Error(`unknown table ${table}`);
    if (!this.columns[table].has(col)) throw new Error(`unknown column ${table}.${col}`);
  }
  rows(t: string) { return (this.tables[t] ??= []); }
  from(t: string) { if (!this.columns[t]) throw new Error(`unknown table ${t}`); return new Query(this, t); }
  rpc(name: string, args: any) {
    const k = `${args._hotel_id}|${args._kind}`;
    if (name === "ntak_get_secret") return Promise.resolve({ data: this.secrets.get(k) || null, error: null });
    if (name === "ntak_put_secret") { this.secrets.set(k, args._value); return Promise.resolve({ data: null, error: null }); }
    return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` } });
  }
}

class Query {
  private filters: ((r: Row) => boolean)[] = [];
  private op: "select" | "insert" | "update" | "upsert" = "select";
  private cols = "*"; private count = false; private head = false;
  private payload: Row[] = []; private patch: Row = {}; private conflict: string[] = []; private ignoreDup = false;
  private orderBy: { col: string; asc: boolean } | null = null; private max: number | null = null;
  private singleMode: "one" | "maybe" | null = null; private returning: string | null = null;
  constructor(private db: FakeDb, private table: string) {}

  select(cols = "*", opts: any = {}) { if (this.op === "select") { this.cols = cols; this.count = opts.count === "exact"; this.head = !!opts.head; } else this.returning = cols; return this; }
  insert(rows: Row | Row[]) { this.op = "insert"; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
  upsert(rows: Row | Row[], opts: any = {}) { this.op = "upsert"; this.payload = Array.isArray(rows) ? rows : [rows]; this.conflict = String(opts.onConflict ?? "id").split(","); this.ignoreDup = !!opts.ignoreDuplicates; return this; }
  update(patch: Row) { this.op = "update"; this.patch = patch; return this; }
  private val(r: Row, col: string) {
    if (col.includes(".")) { const [rel, c] = col.split("."); return this.embed(r, rel)?.[c]; }
    this.db.check(this.table, col);
    return r[col];
  }
  eq(c: string, v: any) { this.filters.push((r) => this.val(r, c) === v); return this; }
  in(c: string, v: any[]) { this.filters.push((r) => v.includes(this.val(r, c))); return this; }
  lte(c: string, v: any) { this.filters.push((r) => this.val(r, c) != null && this.val(r, c) <= v); return this; }
  gte(c: string, v: any) { this.filters.push((r) => this.val(r, c) != null && this.val(r, c) >= v); return this; }
  lt(c: string, v: any) { this.filters.push((r) => this.val(r, c) != null && this.val(r, c) < v); return this; }
  is(c: string, v: null) { this.filters.push((r) => (this.val(r, c) ?? null) === v); return this; }
  not(c: string, op: string, v: any) {
    if (op === "is") this.filters.push((r) => (this.val(r, c) ?? null) !== v);
    else if (op === "in") { const list = String(v).replace(/[()]/g, "").split(","); this.filters.push((r) => !list.includes(String(this.val(r, c)))); }
    else throw new Error(`unsupported not ${op}`);
    return this;
  }
  order(col: string, opts: any = {}) { this.orderBy = { col, asc: opts.ascending !== false }; return this; }
  limit(n: number) { this.max = n; return this; }
  maybeSingle() { this.singleMode = "maybe"; return this; }
  single() { this.singleMode = "one"; return this; }
  private embed(r: Row, relName: string) {
    const rel = RELS[this.table]?.[relName.replace("!inner", "")];
    if (!rel) throw new Error(`unknown relation ${this.table}.${relName}`);
    return this.db.rows(rel.table).find((x) => x[rel.foreign] === r[rel.local]) ?? null;
  }
  private project(r: Row, cols: string, table: string): Row | null {
    if (cols === "*") return { ...r };
    const out: Row = {};
    for (const part of splitTop(cols)) {
      const m = part.match(/^(\w+)(!inner)?\((.*)\)$/);
      if (m) {
        const rel = RELS[table]?.[m[1]];
        if (!rel) throw new Error(`unknown relation ${table}.${m[1]}`);
        const target = this.db.rows(rel.table).find((x) => x[rel.foreign] === r[rel.local]) ?? null;
        if (!target && m[2]) return null;
        out[m[1]] = target ? this.project(target, m[3], rel.table) : null;
      } else {
        this.db.check(table, part);
        out[part] = r[part] ?? null;
      }
    }
    return out;
  }
  private run(): { data: any; error: any; count?: number } {
    const rows = this.db.rows(this.table);
    for (const r of [...this.payload, this.patch]) for (const k of Object.keys(r)) this.db.check(this.table, k);
    if (this.op === "insert" || this.op === "upsert") {
      const out: Row[] = [];
      for (const p of this.payload) {
        const existing = this.op === "upsert" ? rows.find((r) => this.conflict.every((c) => r[c] === p[c])) : undefined;
        if (existing) { if (!this.ignoreDup) Object.assign(existing, p); out.push(existing); continue; }
        const row = { ...(DEFAULTS[this.table]?.() ?? {}), ...(this.db.columns[this.table].has("id") && !p.id ? { id: crypto.randomUUID() } : {}), ...p };
        rows.push(row); out.push(row);
      }
      const data = this.returning ? out.map((r) => this.project(r, this.returning!, this.table)) : null;
      return { data: this.singleMode && data ? data[0] : data, error: null };
    }
    let hit = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "update") { for (const r of hit) Object.assign(r, this.patch); return { data: null, error: null }; }
    if (this.orderBy) { const { col, asc } = this.orderBy; hit = [...hit].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1)); }
    const count = hit.length;
    if (this.max !== null) hit = hit.slice(0, this.max);
    const data = hit.map((r) => this.project(r, this.cols, this.table)).filter(Boolean);
    if (this.head) return { data: null, error: null, count };
    if (this.singleMode === "maybe") return { data: data[0] ?? null, error: null };
    if (this.singleMode === "one") return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { message: "not exactly one row" } };
    return { data, error: null, ...(this.count ? { count } : {}) };
  }
  then(resolve: (v: any) => any, reject?: (e: any) => any) {
    try { return Promise.resolve(this.run()).then(resolve, reject); } catch (e) { return Promise.reject(e).then(resolve, reject); }
  }
}

// ---------------------------------------------------------------------------
// Fake NTAK endpoint

interface FakeNtak { url: string; requests: { root: string; uzenetId: string; xml: string }[]; rejectNext: string | null; closureResult: string; close(): Promise<void> }

async function xmllint(xml: string): Promise<string | null> {
  const file = await Deno.makeTempFile({ suffix: ".xml" });
  await Deno.writeTextFile(file, xml);
  const out = await new Deno.Command("xmllint", { args: ["--noout", "--schema", XSD, file], stderr: "piped", stdout: "null" }).output();
  return out.code === 0 ? null : new TextDecoder().decode(out.stderr);
}

function startFakeNtak(cert: string, key: string): FakeNtak {
  const kinds = new Map<string, string>();
  const state: FakeNtak = { url: "", requests: [], rejectNext: null, closureResult: "VIZSGALANDO", close: async () => {} };
  const env = (inner: string) => `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Header/><SOAP-ENV:Body>${inner}</SOAP-ENV:Body></SOAP-ENV:Envelope>`;
  const fault = (key: string, msg: string) => env(`<SOAP-ENV:Fault><faultcode>SOAP-ENV:Server</faultcode><faultstring xml:lang="en">Validation Error</faultstring><detail><error hibaKulcs="${key}" hibaUzenet="${msg}" mezoNeve="GLOBAL"/></detail></SOAP-ENV:Fault>`);
  const server = Deno.serve({ cert, key, port: 0, hostname: "127.0.0.1", onListen: () => {} }, async (req) => {
    const body = await req.text();
    if (req.headers.get("content-type")?.startsWith("text/xml") !== true) return new Response(fault("Formatum", "content type"), { status: 500 });
    const sig = await verifyEnvelope(body);
    if (!sig.ok) return new Response(fault("FAILED_CHECK", sig.problems.join("; ")), { status: 500 });
    const request = body.match(/<soapenv:Body[^>]*>([\s\S]*)<\/soapenv:Body>/)?.[1] ?? "";
    const schemaError = await xmllint(request);
    if (schemaError) return new Response(env(`<SOAP-ENV:Fault><faultcode>SOAP-ENV:Server</faultcode><faultstring xml:lang="en">Schema Error</faultstring><detail><error hibaUzenet="${schemaError.replace(/[<>&"]/g, " ").slice(0, 300)}" mezoNeve="GLOBAL"/></detail></SOAP-ENV:Fault>`), { status: 500 });
    const root = request.match(/^<v9:(\w+)/)?.[1] ?? "";
    const uzenetId = request.match(/<v9:uzenetId>([^<]+)</)?.[1] ?? "";
    state.requests.push({ root, uzenetId, xml: request });
    if (state.rejectNext && root !== "ellenorzesRequest") { const key = state.rejectNext; state.rejectNext = null; return new Response(fault(key, "rejected by test"), { status: 500 }); }
    if (root === "ellenorzesRequest") {
      const ids = [...request.matchAll(/<v9:feldolgozasAzonosito>([^<]+)</g)].map((m) => m[1]);
      return new Response(env(`<ns2:ellenorzesResponse xmlns:ns2="http://mtu.gov.hu/ntak/v9">${ids.map((id) => {
        const kind = kinds.get(id);
        const warn = kind === "napiZarasRequest" ? `<ns2:figyelmeztetesLista><ns2:hiba><ns2:mezoNeve>napiFeltoltes.szobaAdatok.osszesSzoba</ns2:mezoNeve><ns2:kuldottErtek>2</ns2:kuldottErtek><ns2:hibaKulcs>ElteresRegisztraltAdatokban</ns2:hibaKulcs><ns2:hibaUzenet>Értéke eltér</ns2:hibaUzenet></ns2:hiba></ns2:figyelmeztetesLista>` : "<ns2:figyelmeztetesLista/>";
        const status = kind === "napiZarasRequest" ? state.closureResult : "TELJESEN_SIKERES";
        const start = kind === "adatszolgaltatasKezdoDatumRequest" ? "<ns2:elvartAdatszolgaltatasKezdoDatuma>2026-01-01</ns2:elvartAdatszolgaltatasKezdoDatuma>" : "";
        return `<ns2:uzenetValaszok><ns2:feldolgozasAzonosito>${id}</ns2:feldolgozasAzonosito><ns2:statusz>${status}</ns2:statusz>${warn}<ns2:hibaLista/>${start}</ns2:uzenetValaszok>`;
      }).join("")}</ns2:ellenorzesResponse>`));
    }
    const id = crypto.randomUUID();
    kinds.set(id, root);
    return new Response(env(`<ns2:${root.replace("Request", "Response")} xmlns:ns2="http://mtu.gov.hu/ntak/v9"><ns2:feldolgozasAzonosito>${id}</ns2:feldolgozasAzonosito></ns2:${root.replace("Request", "Response")}>`));
  });
  state.url = `https://127.0.0.1:${(server.addr as Deno.NetAddr).port}/ntak/v9`;
  state.close = () => server.shutdown();
  return state;
}

async function testCert(): Promise<{ certPem: string; keyPem: string }> {
  const dir = await Deno.makeTempDir();
  const out = await new Deno.Command("openssl", { args: ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", `${dir}/k.pem`, "-out", `${dir}/c.pem`, "-days", "30", "-subj", "/CN=SZ25003491", "-addext", "subjectAltName=IP:127.0.0.1", "-addext", "basicConstraints=critical,CA:FALSE"], stderr: "piped" }).output();
  assert.equal(out.code, 0, new TextDecoder().decode(out.stderr));
  return { certPem: await Deno.readTextFile(`${dir}/c.pem`), keyPem: await Deno.readTextFile(`${dir}/k.pem`) };
}

// ---------------------------------------------------------------------------

Deno.test("engine: closure, booking, events and start date go through signing, sending and verification", async () => {
  const { certPem, keyPem } = await testCert();
  const ntak = startFakeNtak(certPem, keyPem);
  const originalClient = Deno.createHttpClient;
  Deno.createHttpClient = (options) => originalClient({ ...options, caCerts: [certPem] });
  try {
    const db = new FakeDb(schemaColumns());
    const T = today();
    const Y = addDays(T, -1);
    db.secrets.set("h1|cert", certPem);
    db.secrets.set("h1|key", keyPem);

    const s: Settings = {
      hotel_id: "h1", organization_slug: "rd", enabled: true, environment: "test", endpoint_url: ntak.url, software_id: "HOTELCARE01",
      software_version: "v1.0.0", registration_number: "SZ25003491", provider_tax_number: "69861195-2-44",
      accommodation_name: "Ceylon Business Services Kft", provider_name: "Interface_csatlakozás_szolgáltató_v9", unit_scope: "all",
      registered_room_count: 2, registered_bed_count: null,
      accommodation_class: "hotel_4", region: "budapest", ifa_type: "SZAZALEKOS", ifa_rate: 4, ifa_vat: 0, accommodation_vat: 18,
      signature_profile: "rsa-sha384", unknown_country_code: "EGYEBKULFOLDI", closure_mode: "manual", auto_close_time: "05:00:00",
      first_closure_date: addDays(T, -10), software_change_date: null, data_start_date: null, ledger_config: {},
      cert_not_after: new Date(Date.now() + 20 * 86400000).toISOString(), sending_blocked_reason: null,
      initial_booking_sync_started_at: null, initial_booking_sync_done_at: null,
    };
    db.rows("ntak_settings").push({ ...s });
    db.rows("rooms").push({ id: "r101", room_number: "101", status: "clean", hotel: "h1" }, { id: "r102", room_number: "102", status: "out_of_order", hotel: "h1" });
    db.rows("ntak_unit_profiles").push(
      { room_id: "r101", hotel_id: "h1", building: "A", room_number: "101", unit_type: "STANDARD", single_beds: 0, double_beds: 1, extra_beds: 1, active: true },
      { room_id: "r102", hotel_id: "h1", building: "A", room_number: "102", unit_type: "SUPERIOR", single_beds: 2, double_beds: 0, extra_beds: 0, active: true },
    );
    db.rows("guests").push(
      { id: "g1", first_name: "Edit", last_name: "Teszt", birth_place: "Budapest", date_of_birth: "1979-07-12", gender: "female", nationality: "HUN", country: "HU", postal_code: "1051", company_name: null, tax_id: null },
      { id: "g2", first_name: "Hans", last_name: "Müller", birth_place: "Berlin", date_of_birth: "1980-01-02", gender: "male", nationality: "DE", country: "DE", postal_code: "10115", company_name: null, tax_id: null },
    );
    const base = { hotel_id: "h1", actual_check_out: null, rate_per_night: 40000, currency: "HUF", children: 0, source: null, pms_channel: null, pms_reservation_id: null, pms_group_note: null, pms_rate_plan_id: null, room_type_id: null, created_at: addDays(T, -30) + "T10:00:00Z" };
    db.rows("reservations").push(
      { ...base, id: "R1", status: "checked_in", check_in_date: Y, check_out_date: addDays(T, 2), room_id: "r101", total_amount: 120000, adults: 2, ota_name: "Booking.com", channex_booking_id: "CHX-1", reservation_number: "HC-1", guest_id: "g1" },
      { ...base, id: "R2", status: "confirmed", check_in_date: addDays(T, 5), check_out_date: addDays(T, 7), room_id: null, room_type_id: "rt1", total_amount: 90000, adults: 2, ota_name: null, channex_booking_id: null, reservation_number: "HC-2", guest_id: "g2" },
    );
    db.rows("reservation_guests").push({ reservation_id: "R1", guest_id: "g1", is_primary: true, ifa_status: null }, { reservation_id: "R1", guest_id: "g2", is_primary: false, ifa_status: null });
    db.rows("room_types").push({ id: "rt1", hotel_id: "h1", name: "Double" });
    db.rows("ntak_room_type_units").push({ room_type_id: "rt1", hotel_id: "h1", unit_type: "STANDARD", capacity: 2, active: true });
    db.rows("reservation_folios").push({ id: "f1", reservation_id: "R1", hotel_id: "h1" });
    db.rows("service_catalog_items").push({ id: "sc1", category: "minibar" });
    db.rows("folio_lines").push({ id: "l1", folio_id: "f1", service_catalog_item_id: "sc1", service_date: Y, room_id: "r101", gross_total: 2500, vat_rate: 27, currency: "HUF", status: "open", source_type: "manual" });
    db.rows("payments").push(
      { id: "p1", reservation_id: "R1", hotel_id: "h1", amount: 20000, currency: "HUF", method: "card", status: "recorded", received_at: addDays(Y, -3) + "T09:00:00Z" },
      { id: "p2", reservation_id: "R1", hotel_id: "h1", amount: 5000, currency: "HUF", method: "cash", status: "recorded", received_at: Y + "T15:00:00Z" },
    );
    db.rows("ntak_booking_queue").push({ hotel_id: "h1", booking_no: "HC-2", dirty_at: new Date().toISOString(), last_sent_at: null, cancelled_sent: false },
      { hotel_id: "h1", booking_no: "CHX-1", dirty_at: new Date().toISOString(), last_sent_at: null, cancelled_sent: false });
    db.rows("ntak_event_queue").push({ id: "e1", hotel_id: "h1", reservation_id: "R1", kind: "erkezett", occurred_at: Y + "T14:00:00Z", room_id: "r101", from_room_id: null, state: "queued", is_correction: false });

    // Historical state must be evidenced by its own dated room period.
    db.rows("room_state_periods").push({
      room_id: "r102", hotel_id: "h1", organization_slug: "rd",
      state: "out_of_order", from_date: Y, to_date: Y,
    });

    // EU_01A/B: force a schema-valid, excessive breakfast amount through the test override.
    db.rows("service_catalog_items")[0].category = "breakfast";
    db.rows("folio_lines")[0].gross_total = 3000000;
    assert.equal((await queueClosure(db,s,Y,{actor:"u1"})).ok,false);
    const invalid = await queueClosure(db,s,Y,{actor:"u1",override:true});
    assert.ok(invalid.ok,JSON.stringify(invalid.build.checklist));
    assert.match(invalid.build.xml,/3000000/);
    assert.equal(db.rows("ntak_daily_closures")[0].override_by,"u1");
    ntak.closureResult = "TELJESEN_HIBAS";
    assert.equal((await sendDue(db,s,{limit:1,deadline:Date.now()+60000})).sent,1);
    assert.equal((await verifyDue(db,s,true)).checked,1);
    assert.equal(db.rows("ntak_daily_closures")[0].state,"errors");
    assert.equal(await classificationFor(db,s,Y),"UJ");
    db.rows("service_catalog_items")[0].category = "minibar";
    db.rows("folio_lines")[0].gross_total = 2500;
    ntak.closureResult = "VIZSGALANDO";
    // 1. Correct the rejected day; first successful version remains UJ.
    const closure = await queueClosure(db, s, Y, { actor: "u1" });
    assert.ok(closure.ok, JSON.stringify(closure.build.checklist));
    assert.equal(closure.build.classification, "UJ");
    assert.deepEqual(closure.build.closure.rooms, { total: 2, ooo: 1, oos: 0, rented: 1, available: 0 });
    const night = closure.build.closure.nights[0];
    assert.equal(night.guests.length, 2);
    assert.equal(night.guests[0].nationality, "HU", "alpha-3 nationality mapped to ISO-2");
    assert.deepEqual(night.sold!.payments, [{ amount: 20000, type: "BANKKARTYA" }, { amount: 5000, type: "KESZPENZ" }]);
    assert.deepEqual(night.sold!.outPackage.map((c) => c.main), ["IFA", "IFA", "EGYEB"]);
    assert.equal(db.rows("ntak_guest_ids").length, 2, "guest ids stored at first report");

    // 2. Advance bookings: HC-2 is sent, CHX-1 (already arrived) is skipped.
    assert.deepEqual(await processBookings(db, s, 10), { queued: 1, clean: 1, problems: 0 });
    assert.match(db.rows("ntak_booking_queue").find((q) => q.booking_no === "CHX-1")!.last_problem, /past/);

    // 3. Stay event and 4. start-date query.
    assert.deepEqual(await processEvents(db, s, 10), { queued: 1, waiting: 0 });
    await queueStartDateQuery(db, s, "u1");

    // 5. Send: every request must pass signature + schema checks at the fake endpoint.
    const sent = await sendDue(db, s, { limit: 10, deadline: Date.now() + 60000 });
    assert.equal(sent.sent, 4, JSON.stringify(db.rows("ntak_messages").map((m) => [m.kind, m.state, m.last_error])));
    assert.deepEqual(db.rows("ntak_messages").map((m) => m.state), ["rejected", "accepted", "accepted", "accepted", "accepted"]);
    assert.deepEqual(ntak.requests.slice(2).map((r) => r.root).sort(), ["adatszolgaltatasKezdoDatumRequest", "esemenyvezereltAdatkuldesRequest", "foglalasEsemenyRequest", "napiZarasRequest"]);
    assert.equal(new Set(ntak.requests.map((r) => r.uzenetId)).size, 6, "fresh uzenetId per send");

    // 6. Verification results land on messages, the closure register and settings.
    assert.equal((await verifyDue(db, s, true)).checked, 4);
    const c = db.rows("ntak_daily_closures").find((x) => x.closed_day === Y)!;
    assert.equal(c.state, "warnings");
    assert.equal(c.accepted_once, true);
    const closureMsg = db.rows("ntak_messages").find((m) => m.id === closure.messageId)!;
    assert.equal(closureMsg.ntak_status, "VIZSGALANDO");
    assert.equal(closureMsg.warnings[0].key, "ElteresRegisztraltAdatokban");
    assert.match(closureMsg.warnings[0].hint, /registration/);
    assert.equal(db.rows("ntak_settings")[0].data_start_date, "2026-01-01");
    assert.equal(await classificationFor(db, s, Y), "MODOSITO");

    // 7. A correction needs a record id and a reason, then goes out as MODOSITO.
    assert.equal((await queueClosure(db, s, Y, {})).ok, false);
    const fix = await queueClosure(db, s, Y, { protocolId: "JK-1", reason: "Minibár tétel javítása" });
    assert.ok(fix.ok);
    assert.match(fix.build.xml, /<v9:besorolas>MODOSITO<\/v9:besorolas><v9:jegyzokonyvAzonosito>JK-1</);

    // EU_03: authority asks for identical content, with a new header. A later correction
    // is not rebuilt from the now changed live source data.
    ntak.closureResult = "UJRA_KULDENDO";
    await sendDue(db,s,{limit:1,deadline:Date.now()+60000});
    await verifyDue(db,s,true);
    const original = db.rows("ntak_messages").find(m=>m.id===fix.messageId)!;
    const linked = db.rows("ntak_messages").find(m=>m.resend_of===original.id)!;
    assert.equal(original.ntak_status,"UJRA_KULDENDO");
    assert.equal(linked.request_xml,original.request_xml);
    ntak.closureResult = "TELJESEN_SIKERES";
    await sendDue(db,s,{limit:1,deadline:Date.now()+60000});
    await verifyDue(db,s,true);
    assert.equal(linked.ntak_status,"TELJESEN_SIKERES");
    assert.notEqual(linked.uzenet_id,original.uzenet_id);
    assert.equal(linked.request_xml.split("</v9:uzenetAdatok>")[1],original.request_xml.split("</v9:uzenetAdatok>")[1]);
    // 8. Server error -> retry in 1 minute; certificate/registration error -> sending stops.
    assert.ok((await queueClosure(db,s,Y,{protocolId:"JK-2",reason:"TECH_HIBA_ADATJAVITAS"})).ok);
    ntak.rejectNext = "SzerverHiba";
    await sendDue(db, s, { limit: 1, deadline: Date.now() + 60000 });
    const retry = db.rows("ntak_messages").find((m) => m.state === "retry")!;
    assert.ok(Date.parse(retry.next_attempt_at) - Date.now() > 50000);
    retry.next_attempt_at = new Date(Date.now() - 1000).toISOString();
    ntak.rejectNext = "ElteresCnAdatok";
    await sendDue(db, s, { limit: 1, deadline: Date.now() + 60000 });
    assert.match(db.rows("ntak_settings")[0].sending_blocked_reason, /ElteresCnAdatok/);
    assert.match((await sendDue(db, s, { limit: 1, deadline: Date.now() + 60000 })).skipped!, /Sending stopped/);

    // 9. Data changed after acceptance -> the day is flagged for a correction.
    s.sending_blocked_reason = null;
    db.rows("ntak_daily_closures")[0].state = "accepted";
    db.rows("ntak_daily_closures")[0].updated_at = new Date(Date.now() - 2 * 3600000).toISOString(); // drift checks run hourly
    db.rows("ntak_daily_closures")[0].snapshot = closure.build && { closure: closure.build.closure, checklist: [], totals: closure.build.totals };
    // A historical room-status correction must now flag MODOSITO by itself,
    // even when no financial/guest data changed.
    db.rows("room_state_periods").find((p) => p.room_id === "r102")!.state = "out_of_service";
    assert.equal(await detectDrift(db, s), 1);
    assert.equal(db.rows("ntak_daily_closures")[0].needs_correction, true);
  } finally {
    Deno.createHttpClient = originalClient;
    await ntak.close();
  }
});

Deno.test('profiled_only excludes 15 unrelated rooms, their bookings, events, charges and payments', async () => {
  const db = new FakeDb(schemaColumns());
  const day = addDays(today(), -1);
  const s: Settings = {
    hotel_id: "h-scope", organization_slug: "channex", enabled: true, environment: "test",
    endpoint_url: null, software_id: "HOTELCARE", software_version: "1.0",
    registration_number: "MA26004524", provider_tax_number: "11223355-1-22",
    accommodation_name: "Ceylon Business Services Kft", provider_name: "Interface_csatlakozás_szolgáltató_v9",
    registered_room_count: 4, registered_bed_count: null, unit_scope: "profiled_only",
    accommodation_class: "hotel_4", region: "budapest", ifa_type: "TETELES", ifa_rate: 400,
    ifa_vat: 0, accommodation_vat: 5, signature_profile: "rsa-sha384",
    unknown_country_code: "EGYEBKULFOLDI", closure_mode: "manual", auto_close_time: "05:00",
    first_closure_date: null, software_change_date: null, data_start_date: null, ledger_config: {},
    cert_not_after: null, sending_blocked_reason: null,
    initial_booking_sync_started_at: null, initial_booking_sync_done_at: null,
  };
  const fixtures = [
    ["101", "STANDARD", 1, 1, 0],
    ["102", "SUPERIOR", 0, 1, 0],
    ["103", "ECONOMY", 1, 1, 0],
    ["104", "APARTMAN", 0, 1, 1],
  ] as const;
  for (const [room, type, singles, doubles, extras] of fixtures) {
    db.rows("rooms").push({ id: room, room_number: room, hotel: s.hotel_id, status: "clean" });
    db.rows("ntak_unit_profiles").push({
      room_id: room, hotel_id: s.hotel_id, room_number: room, building: "1", unit_type: type,
      single_beds: singles, double_beds: doubles, extra_beds: extras, active: true,
    });
  }
  for (let n = 0; n < 15; n++) {
    const id = "unprofiled-" + n;
    db.rows("rooms").push({ id, hotel: s.hotel_id, room_number: "T" + n, status: "clean" });
  }
  db.rows("room_types").push({ id: "mapped-type", hotel_id: s.hotel_id, name: "NTAK Standard" });
  db.rows("ntak_room_type_units").push({ room_type_id: "mapped-type", hotel_id: s.hotel_id, unit_type: "STANDARD", capacity: 3, active: true });
  const scope = await loadNtakScope(db, s);
  assert.equal(db.rows("rooms").length, 19);
  assert.equal(scope.roomIds.size, 4);
  assert.ok(isInNtakScope(scope, { room_id: "101", room_type_id: null }));
  assert.ok(isInNtakScope(scope, { room_id: null, room_type_id: "mapped-type" }));
  assert.equal(isInNtakScope(scope, { room_id: "unprofiled-1", room_type_id: "mapped-type" }), false);

  const base = {
    hotel_id: s.hotel_id, room_type_id: null, rate_per_night: 20000, total_amount: 40000,
    currency: "HUF", adults: 1, children: 0, source: "direct", ota_name: null,
    pms_channel: null, channex_booking_id: null, pms_reservation_id: null,
    pms_group_note: null, pms_rate_plan_id: null, actual_check_out: null,
    guest_id: null, created_at: day + "T08:00:00Z",
  };
  db.rows("reservations").push(
    { ...base, id: "R-excluded", reservation_number: "U-OLD", status: "checked_in",
      check_in_date: day, check_out_date: addDays(day, 2), room_id: "unprofiled-1" },
    { ...base, id: "R-future-excluded", reservation_number: "U-FUTURE", status: "confirmed",
      check_in_date: addDays(day, 5), check_out_date: addDays(day, 7), room_id: "unprofiled-2" },
    { ...base, id: "R-future-included", reservation_number: "NTAK-FUTURE", status: "confirmed",
      check_in_date: addDays(day, 5), check_out_date: addDays(day, 7), room_id: null, room_type_id: "mapped-type" },
  );
  db.rows("reservation_folios").push({ id: "f-excluded", reservation_id: "R-excluded", hotel_id: s.hotel_id });
  db.rows("service_catalog_items").push({ id: "sc-excluded", category: "minibar" });
  db.rows("folio_lines").push({
    id: "l-excluded", folio_id: "f-excluded", service_catalog_item_id: "sc-excluded", service_date: day,
    room_id: "unprofiled-1", gross_total: 1000, vat_rate: 27, currency: "HUF", status: "open", source_type: "manual",
  });
  db.rows("payments").push({
    id: "p-excluded", hotel_id: s.hotel_id, reservation_id: "R-excluded",
    amount: 1000, currency: "HUF", method: "cash", status: "recorded", received_at: day + "T12:00:00Z",
  });

  const built = await buildClosure(db, s, day, {});
  assert.equal(built.closure.rooms.total, 4);
  assert.equal(built.closure.capacity.total, 10);
  assert.equal(built.closure.nights.length, 0);
  assert.equal(built.closure.checkoutSales.length, 0);
  assert.equal(built.closure.postStayPayments.length, 0);
  assert.equal(built.closure.postStayCharges.length, 0);
  assert.equal(built.totals.charges, 0);
  assert.equal(built.totals.payments, 0);
  assert.ok(!built.xml.includes("U-OLD"));

  assert.equal(await markAllFutureBookings(db, s), 1);
  assert.deepEqual(db.rows("ntak_booking_queue").map((q) => q.booking_no), ["NTAK-FUTURE"]);
  db.rows("ntak_booking_queue").push({
    hotel_id: s.hotel_id, booking_no: "U-FUTURE", dirty_at: new Date().toISOString(), last_sent_at: null,
  });
  await processBookings(db, s, 10);
  assert.equal(db.rows("ntak_messages").filter((m) => m.kind === "booking" && m.ref === "U-FUTURE").length, 0);

  db.rows("ntak_event_queue").push({
    id: "e-excluded", hotel_id: s.hotel_id, reservation_id: "R-excluded", kind: "erkezett",
    occurred_at: day + "T14:00:00Z", room_id: "unprofiled-1", from_room_id: null, state: "queued",
  });
  assert.deepEqual(await processEvents(db, s, 10), { queued: 0, waiting: 0 });
  assert.equal(db.rows("ntak_event_queue")[0].state, "skipped");

  const intentionalMismatch = await buildClosure(db, { ...s, registered_room_count: 5, registered_bed_count: 12 }, day, {});
  assert.equal(intentionalMismatch.closure.capacity.total, 12);
  assert.equal(intentionalMismatch.closure.rooms.total, 4);
  assert.ok(intentionalMismatch.checklist.some((x) => x.code === "registration"));
});


Deno.test('Phase 3 processEvents snapshots exactly guest_ids, including voided corrections', async () => {
  const db = new FakeDb(schemaColumns());
  const day = addDays(today(), -1);
  const s: Settings = {
    hotel_id: 'h3',organization_slug:'channex',enabled:true,environment:'test',
    endpoint_url:null,software_id:'HOTELCARE',software_version:'1.0',
    registration_number:'MA26004524',provider_tax_number:'11223355-1-22',
    accommodation_name:'Ceylon Business Services Kft',provider_name:'Interface_csatlakozás_szolgáltató_v9',
    registered_room_count:4,registered_bed_count:10,unit_scope:'profiled_only',
    accommodation_class:'hotel_4',region:'budapest',ifa_type:'TETELES',ifa_rate:400,
    ifa_vat:0,accommodation_vat:5,signature_profile:'rsa-sha384',
    unknown_country_code:'EGYEBKULFOLDI',closure_mode:'manual',auto_close_time:'05:00',
    first_closure_date:addDays(day,-1),software_change_date:null,data_start_date:null,ledger_config:{},
    cert_not_after:null,sending_blocked_reason:null,
    initial_booking_sync_started_at:null,initial_booking_sync_done_at:null,
  };
  db.rows('rooms').push({id:'r101',hotel:'h3',room_number:'101',status:'clean'});
  db.rows('ntak_unit_profiles').push({room_id:'r101',hotel_id:'h3',active:true,building:'1',
    room_number:'101',unit_type:'STANDARD',single_beds:1,double_beds:1,extra_beds:0});
  db.rows('reservations').push({
    id:'R-FOGL01',hotel_id:'h3',ntak_booking_no:'FOGL_01',
    reservation_number:'OTHER',channex_booking_id:'CHX-OTHER',pms_reservation_id:'PREVIO-OTHER',
    status:'checked_in',room_id:'r101',room_type_id:null,
    check_in_date:day,check_out_date:addDays(day,2),
    rate_per_night:20000,total_amount:40000,currency:'HUF',adults:3,children:0,
    guest_id:'luca',source:'direct',ota_name:null,pms_channel:null,pms_group_note:null,pms_rate_plan_id:null,
    created_at:addDays(day,-10)+'T12:00:00Z',
  });
  const fixture = [
    ['luca','Luca','Ferri','IT','1976-05-21','in_house'],
    ['maria','Zsidi','Mária','HU','1983-05-10','in_house'],
    ['tibor','Zsidi','Tibor','HU','1980-11-11','void'],
  ];
  for (const [i,[gid,first,last,country,born,state]] of fixture.entries()) {
    db.rows('guests').push({id:gid,first_name:first,last_name:last,birth_place:'Budapest',
      date_of_birth:born,gender:gid==='maria'?'female':'male',nationality:country,
      country,postal_code:country==='HU'?'2072':'47921'});
    db.rows('reservation_guests').push({reservation_id:'R-FOGL01',guest_id:gid,is_primary:i===0,ifa_status:null,
      stay_state:state,arrived_at:day+'T08:00:00Z',departed_at:state==='void'?day+'T09:00:00Z':null,room_id:'r101'});
    db.rows('ntak_guest_ids').push({hotel_id:'h3',guest_id:gid,vendeg_id:('guest'+i).padEnd(31,'x')});
  }
  db.rows('ntak_event_queue').push(
    {id:'arrive',hotel_id:'h3',reservation_id:'R-FOGL01',kind:'erkezett',
      guest_ids:['luca','maria'],occurred_at:day+'T08:00:00Z',
      room_id:'r101',from_room_id:null,state:'queued',is_correction:false},
    {id:'undo',hotel_id:'h3',reservation_id:'R-FOGL01',kind:'tavozott',
      guest_ids:['tibor'],occurred_at:day+'T09:05:00Z',
      room_id:'r101',from_room_id:null,state:'queued',is_correction:true},
  );
  assert.deepEqual(await processEvents(db,s,10),{queued:2,waiting:0});
  const xml = String(db.rows('ntak_messages')[0].request_xml);
  const arrivals = [...xml.matchAll(/<v9:erkezett>([\s\S]*?)<\/v9:erkezett>/g)];
  const departures = [...xml.matchAll(/<v9:tavozott>([\s\S]*?)<\/v9:tavozott>/g)];
  assert.equal(arrivals.length,1);
  assert.equal(departures.length,1);
  assert.deepEqual([...arrivals[0][1].matchAll(/<v9:vendegId>(.*?)<\/v9:vendegId>/g)].map(m=>m[1]),
    ['guest0'.padEnd(31,'x'),'guest1'.padEnd(31,'x')]);
  assert.deepEqual([...departures[0][1].matchAll(/<v9:vendegId>(.*?)<\/v9:vendegId>/g)].map(m=>m[1]),
    ['guest2'.padEnd(31,'x')]);
  assert.ok(xml.includes('<v9:foglalasiSzam>FOGL_01</v9:foglalasiSzam>'),'explicit override must win over CHX');
  assert.equal(db.rows('ntak_event_queue').filter(e=>e.state==='sent').length,2);
});


Deno.test('Phase 4 loadUnits uses dated periods on historical days; live status is today-only fallback', async () => {
  const db = new FakeDb(schemaColumns());
  db.rows('rooms').push(
    { id: 'r103', hotel: 'Test Property - HotelCare', room_number: '103', status: 'clean' },
    { id: 'r104', hotel: 'Test Property - HotelCare', room_number: '104', status: 'out_of_service' },
  );
  db.rows('ntak_unit_profiles').push(
    { room_id: 'r103', hotel_id: 'channex-test-property', active: true, building: '1',
      room_number: '103', unit_type: 'ECONOMY', single_beds: 1, double_beds: 1, extra_beds: 0 },
    { room_id: 'r104', hotel_id: 'channex-test-property', active: true, building: '1',
      room_number: '104', unit_type: 'APARTMAN', single_beds: 0, double_beds: 1, extra_beds: 1 },
  );
  db.rows('room_state_periods').push(
    { room_id: 'r103', hotel_id: 'channex-test-property', organization_slug: 'channex',
      state: 'out_of_order', from_date: '2026-11-17', to_date: '2026-11-18' },
    { room_id: 'r104', hotel_id: 'channex-test-property', organization_slug: 'channex',
      state: 'out_of_service', from_date: '2026-11-18', to_date: '2026-11-19' },
  );
  const dated = await loadUnits(db, 'channex-test-property', '2026-11-18');
  assert.deepEqual(dated.map((u) => u.state), ['ooo', 'oos']);
  assert.deepEqual((await loadUnits(db, 'channex-test-property', '2026-11-16')).map((u) => u.state),
    ['available', 'available'], 'historical dates must not inherit today status');
  assert.deepEqual((await loadUnits(db, 'channex-test-property', today())).map((u) => u.state),
    ['available', 'oos'], 'today may fall back to the live status only when no dated period exists');
});

Deno.test("Phase 9 override requires a manager actor and reason in production, never bypasses missing ledger", () => {
  const errors = [{ level: "error" as const, code: "extreme", message: "Breakfast 3000000" }];
  assert.equal(closureOverride(errors, "test", "manager", true, undefined).allowed, true);
  assert.equal(closureOverride(errors, "production", "manager", true, " ").allowed, false);
  assert.equal(closureOverride(errors, "production", "manager", true, "Investigated amount").allowed, true);
  assert.equal(closureOverride(errors, "test", null, true, undefined).allowed, false);
  assert.equal(closureOverride([{level:"error",code:"missing_ledger",message:"incomplete"}], "test", "manager", true, undefined).allowed, false);
});
Deno.test("Phase 9 resend preserves entire payload and original UJ, creates exactly one linked attempt", async () => {
  const db = new FakeDb(schemaColumns());
  const xml = '<v9:napiZarasRequest><v9:uzenetAdatok><v9:uzenetId>old</v9:uzenetId><v9:uzenetKuldesIdeje>old-time</v9:uzenetKuldesIdeje></v9:uzenetAdatok><v9:besorolas>UJ</v9:besorolas><v9:foglalasAzonosito>__UJRAKULDENDO_VALIDACIO__</v9:foglalasAzonosito></v9:napiZarasRequest>';
  const s = { hotel_id:"h", organization_slug:"org", environment:"test" } as Settings;
  db.rows("ntak_messages").push({id:"original",hotel_id:"h",environment:"test",request_xml:xml});
  db.rows("ntak_daily_closures").push({hotel_id:"h",closed_day:"2026-11-20",message_id:"original",classification:"UJ",accepted_once:false});
  await resendSameContent(db,s,"original","closure","2026-11-20");
  await resendSameContent(db,s,"original","closure","2026-11-20");
  const attempts = db.rows("ntak_messages");
  assert.equal(attempts.length,2);
  assert.equal(attempts[1].request_xml,xml);
  assert.equal(attempts[1].resend_of,"original");
  assert.equal(db.rows("ntak_daily_closures")[0].classification,"UJ");
  assert.equal(db.rows("ntak_daily_closures")[0].message_id,attempts[1].id);
  assert.equal(await classificationFor(db,s,"2026-11-20"),"UJ");
  const refreshed = refreshHeader(xml,"new-id",new Date("2026-11-23T20:00:00Z"));
  assert.match(refreshed, /<v9:uzenetId>new-id</);
  assert.equal(refreshed.split("</v9:uzenetAdatok>")[1],xml.split("</v9:uzenetAdatok>")[1]);
});
