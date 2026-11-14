/**
 * szamlazz-invoice — guest invoicing via Számlázz.hu Számla Agent.
 *
 * POST { action, hotel_id, ...params } with the user's JWT.
 * The Agent key (SZAMLAZZ_AGENT_KEY secret) never leaves the server.
 *
 * Actions
 *   status   { hotel_id, reservation_id? }      VIEW   configured? + invoices of a reservation
 *   prepare  { hotel_id, reservation_id }       VIEW   suggested lines from the folio (nothing issued)
 *   issue    { hotel_id, reservation_id, kind: invoice|proforma, buyer, lines, payment_method,
 *              due_date?, language?, currency?, paid?, email_invoice? }   ISSUE
 *   storno   { hotel_id, invoice_id }           ISSUE  reverse an issued invoice
 *   payment  { hotel_id, invoice_id, amount, date?, method? }             ISSUE  register a payment
 *   pdf      { hotel_id, invoice_id }           VIEW   PDF of an issued invoice (base64)
 *
 * The caller supplies the final lines (description, quantity, unit, gross
 * unit price, VAT key): the server recomputes all totals, validates VAT keys
 * and writes an auditable guest_invoices row before and after the API call.
 */
import {
  authorizeHotelCaller, budapestToday, corsHeaders, hasRole, json, serviceDb,
  MANAGE_ROLES, VIEW_ROLES, type Caller,
} from "../_shared/channex/http.ts";
import {
  ACTION_FIELDS, buildInvoiceXml, buildPaymentXml, buildPdfQueryXml, buildStornoXml,
  computeLine, isVatKey, parseAgentHeaders, PAYMENT_METHODS, round2, sumLines,
  type AgentLine, type Buyer, type PaymentMethod, type VatKey,
} from "../_shared/szamlazz/xml.ts";

import {
  decryptProviderAuth, issuerById, issuerCanIssue, issuerForHotel, publicIssuer,
  type InvoiceIssuer, type ProviderAuth,
} from "../_shared/szamlazz/issuer.ts";

const AGENT_URL = "https://www.szamlazz.hu/szamla/";
const ISSUE_ROLES = [...MANAGE_ROLES, "reception_manager", "reception", "front_office"];

// deno-lint-ignore no-explicit-any
type Db = any;

class UserError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

async function currentIssuer(db: Db, organizationSlug: string, hotelId: string): Promise<InvoiceIssuer> {
  const issuer = await issuerForHotel(db, organizationSlug, hotelId);
  if (!issuerCanIssue(issuer)) throw new UserError("This hotel has no enabled invoice issuer. Ask an administrator to assign a configured legal company.", 409);
  return issuer!;
}
const authArg = (auth: ProviderAuth) => "agentKey" in auth ? auth.agentKey : { username: auth.username, password: auth.password };
async function historicalAuth(db: Db, invoice: { issuer_id?: string | null; organization_slug: string }): Promise<ReturnType<typeof authArg>> {
  if (!invoice.issuer_id) {
    // Read legacy invoices against the legacy provider account only.
    const legacy = Deno.env.get("SZAMLAZZ_AGENT_KEY");
    if (!legacy) throw new UserError("Legacy invoice credentials unavailable; contact administrator.", 409);
    return legacy;
  }
  const issuer = await issuerById(db, invoice.organization_slug, invoice.issuer_id);
  if (!issuer) throw new UserError("The original invoice company no longer exists.", 409);
  return authArg(await decryptProviderAuth(issuer));
}
async function hotelOrgSlug(db: Db, hotelId: string): Promise<string> {
  const { data: hotel } = await db.from("hotel_configurations").select("organization_id")
    .eq("hotel_id", hotelId).eq("is_active", true).maybeSingle();
  if (!hotel) throw new UserError("Hotel configuration missing", 404);
  const { data: org } = await db.from("organizations").select("slug").eq("id", hotel.organization_id).maybeSingle();
  if (!org?.slug) throw new UserError("Hotel organization missing", 404);
  return String(org.slug);
}

async function callAgent(field: string, xml: string): Promise<{ result: ReturnType<typeof parseAgentHeaders>; body: Uint8Array }> {
  const form = new FormData();
  form.append(field, new Blob([xml], { type: "application/xml" }), "invoice.xml");
  const res = await fetch(AGENT_URL, { method: "POST", body: form });
  const body = new Uint8Array(await res.arrayBuffer());
  const result = parseAgentHeaders((name) => res.headers.get(name));
  if (!result.ok && !result.errorMessage) result.errorMessage = `Számlázz.hu HTTP ${res.status}`;
  return { result, body };
}

const b64 = (bytes: Uint8Array): string => {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
};

interface RawLine { description?: string; quantity?: number; unit?: string; gross_unit_price?: number; vat_key?: string; comment?: string }

function parseLines(raw: unknown): AgentLine[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new UserError("At least one invoice line is required");
  if (raw.length > 100) throw new UserError("Too many invoice lines");
  return raw.map((r: RawLine, i: number) => {
    const vat = String(r.vat_key ?? "");
    if (!isVatKey(vat)) throw new UserError(`Line ${i + 1}: unsupported VAT key "${vat}"`);
    try {
      return computeLine({
        description: String(r.description ?? "").trim().slice(0, 300),
        quantity: Number(r.quantity ?? 0),
        unit: String(r.unit ?? "db").slice(0, 30),
        grossUnitPrice: Number(r.gross_unit_price ?? NaN),
        vatKey: vat as VatKey,
        comment: r.comment ? String(r.comment).slice(0, 200) : undefined,
      });
    } catch (e) {
      throw new UserError(`Line ${i + 1}: ${(e as Error).message}`);
    }
  });
}

function parseBuyer(raw: unknown): Buyer {
  const r = (raw ?? {}) as Record<string, unknown>;
  const need = (k: string) => {
    const v = String(r[k] ?? "").trim();
    if (!v) throw new UserError(`Buyer ${k} is required`);
    return v.slice(0, 200);
  };
  const email = String(r.email ?? "").trim();
  return {
    name: need("name"),
    zip: need("zip").slice(0, 20),
    city: need("city"),
    address: need("address"),
    email: email || undefined,
    taxNumber: String(r.tax_number ?? "").trim() || undefined,
    sendEmail: r.send_email === true && !!email,
  };
}

async function loadReservation(db: Db, hotelId: string, reservationId: string) {
  const { data, error } = await db.from("reservations")
    .select("id, hotel_id, organization_slug, status, check_in_date, check_out_date, rate_per_night, currency, total_amount, balance_due, guest_id, guests(first_name, last_name, email)")
    .eq("id", reservationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.hotel_id !== hotelId) throw new UserError("Reservation not found on this hotel", 404);
  return data;
}

async function loadInvoice(db: Db, hotelId: string, invoiceId: string) {
  const { data, error } = await db.from("guest_invoices").select("*").eq("id", invoiceId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.hotel_id !== hotelId) throw new UserError("Invoice not found on this hotel", 404);
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const payload = await req.json().catch(() => ({}));
    const action = String(payload.action ?? "");
    const hotelId = String(payload.hotel_id ?? "");
    if (!action || !hotelId) return json({ ok: false, error: "action and hotel_id are required" }, 400);

    const db = serviceDb();
    const callerOr = await authorizeHotelCaller(req, db, hotelId);
    if (callerOr instanceof Response) return callerOr;
    const caller = callerOr as Caller;
    if (!hasRole(caller, VIEW_ROLES)) return json({ ok: false, error: "Forbidden" }, 403);

    switch (action) {
      case "status": {
        const slug = await hotelOrgSlug(db, hotelId);
        const issuer = await issuerForHotel(db, slug, hotelId);
        const configured = issuerCanIssue(issuer);
        let invoices: unknown[] = [];
        if (payload.reservation_id) {
          const { data } = await db.from("guest_invoices")
            .select("id, kind, status, invoice_number, currency, gross_total, payment_method, issued_at, error_message, origin_invoice_id, created_at")
            .eq("reservation_id", payload.reservation_id).eq("hotel_id", hotelId)
            .eq("organization_slug", slug).order("created_at", { ascending: false }).limit(20);
          invoices = data ?? [];
        }
        return json({ ok: true, configured, issuer: issuer ? publicIssuer(issuer) : null,
          can_issue: configured && hasRole(caller, ISSUE_ROLES), payment_methods: PAYMENT_METHODS, invoices });
      }

      case "prepare": {
        const r = await loadReservation(db, hotelId, String(payload.reservation_id ?? ""));
        const { data: folio } = await db.from("guest_folios")
          .select("description, amount, charge_type").eq("reservation_id", r.id).order("created_at");
        const currency = (r.currency as string) || "HUF";
        const nights = Math.max(1, Math.round((Date.parse(r.check_out_date) - Date.parse(r.check_in_date)) / 86400000));
        const lines: Array<Record<string, unknown>> = [];
        const roomPosted = (folio ?? []).some((f: { charge_type: string }) => f.charge_type === "room");
        if (!roomPosted && Number(r.rate_per_night) > 0) {
          lines.push({ description: "Szállásdíj / Accommodation", quantity: nights, unit: "éj", gross_unit_price: round2(Number(r.rate_per_night)), vat_key: "5" });
        }
        const vatFor = (t: string): VatKey => t === "room" ? "5" : t === "city_tax" ? "THK" : "27";
        for (const f of folio ?? []) {
          if (f.charge_type === "payment" || Number(f.amount) === 0) continue;
          lines.push({ description: f.description, quantity: 1, unit: "db", gross_unit_price: round2(Number(f.amount)), vat_key: vatFor(f.charge_type) });
        }
        const paid = (folio ?? []).filter((f: { charge_type: string }) => f.charge_type === "payment")
          .reduce((a: number, f: { amount: number }) => a + Number(f.amount), 0);
        const g = r.guests as { first_name?: string; last_name?: string; email?: string } | null;
        return json({
          ok: true, currency, nights, balance_due: Number(r.balance_due ?? 0), paid_so_far: round2(paid),
          suggested_lines: lines,
          suggested_buyer: { name: [g?.first_name, g?.last_name].filter(Boolean).join(" "), email: g?.email ?? "" },
          vat_note: "Defaults: accommodation 5%, services 27%, city tax (IFA) outside VAT scope (THK). Confirm per line before issuing.",
        });
      }

      case "issue": {
        if (!hasRole(caller, ISSUE_ROLES)) return json({ ok: false, error: "Forbidden" }, 403);
        const kind = payload.kind === "proforma" ? "proforma" : "invoice";
        const r = await loadReservation(db, hotelId, String(payload.reservation_id ?? ""));
        const issuer = await currentIssuer(db, r.organization_slug, hotelId);
        const auth = await decryptProviderAuth(issuer);
        if (["cancelled", "no_show"].includes(String(r.status))) throw new UserError("This reservation is cancelled; nothing to invoice.");
        const lines = parseLines(payload.lines);
        const buyer = parseBuyer(payload.buyer);
        const method = String(payload.payment_method ?? "");
        if (!(PAYMENT_METHODS as readonly string[]).includes(method)) throw new UserError(`payment_method must be one of: ${PAYMENT_METHODS.join(", ")}`);
        const currency = String(payload.currency ?? r.currency ?? "HUF").toUpperCase();
        const totals = sumLines(lines);
        const today = budapestToday();
        const due = String(payload.due_date ?? today);
        const lang = String(payload.language ?? "hu");

        const { data: pending, error: insErr } = await db.from("guest_invoices").insert({
          organization_slug: r.organization_slug, hotel_id: hotelId, reservation_id: r.id,
          issuer_id: issuer.id, kind, currency, payment_method: method, due_date: due, language: lang,
          buyer, lines, net_total: totals.net, vat_total: totals.vat, gross_total: totals.gross,
          created_by: caller.userId,
        }).select("id").single();
        if (insErr) {
          if (insErr.code === "23505") throw new UserError("An invoice attempt for this reservation is already in flight. Wait a moment and refresh.", 409);
          throw new Error(insErr.message);
        }

        const xml = buildInvoiceXml({
          ...("agentKey" in auth ? { agentKey: auth.agentKey } : { delegatedUser: auth.username, delegatedPassword: auth.password }),
          proforma: kind === "proforma", eInvoice: payload.e_invoice === true,
          invoiceNumberPrefix: issuer.invoice_prefix || undefined,
          seller: issuer.connection_mode === "own_account"
            ? { bank: issuer.bank_name, bankAccount: issuer.bank_account, emailReplyTo: issuer.reply_to_email }
            : undefined,
          issueDate: today, fulfillmentDate: today, dueDate: due,
          paymentMethod: method as PaymentMethod, currency,
          language: lang as "hu", exchangeBank: currency === "HUF" ? undefined : "MNB",
          paid: payload.paid === true,
          comment: `HotelCare reservation ${r.id.slice(0, 8)} · ${r.check_in_date} → ${r.check_out_date}`,
          buyer: { ...buyer, sendEmail: payload.email_invoice === true && !!buyer.email },
          lines,
        });
        const { result } = await callAgent(ACTION_FIELDS.invoice, xml);

        await db.from("guest_invoices").update(result.ok
          ? { status: "issued", invoice_number: result.invoiceNumber, issued_at: new Date().toISOString() }
          : { status: "failed", error_code: result.errorCode, error_message: result.errorMessage?.slice(0, 500) },
        ).eq("id", pending.id);

        if (!result.ok) throw new UserError(`Számlázz.hu rejected the ${kind}: ${result.errorMessage ?? result.errorCode ?? "unknown error"}`, 502);

        if (kind === "invoice") {
          await db.from("reservation_events").insert({
            reservation_id: r.id, hotel_id: hotelId, organization_slug: r.organization_slug,
            event_type: "invoice_issued",
            metadata: { invoice_id: pending.id, invoice_number: result.invoiceNumber, gross_total: totals.gross, currency },
            created_by: caller.userId,
          });
        }
        return json({ ok: true, invoice_id: pending.id, invoice_number: result.invoiceNumber, kind, ...totals, currency });
      }

      case "storno": {
        if (!hasRole(caller, ISSUE_ROLES)) return json({ ok: false, error: "Forbidden" }, 403);
        const inv = await loadInvoice(db, hotelId, String(payload.invoice_id ?? ""));
        const credential = await historicalAuth(db, inv);
        if (inv.kind === "storno") throw new UserError("That record is already a storno.");
        if (inv.status !== "issued" || !inv.invoice_number) throw new UserError("Only an issued invoice can be reversed.");
        if (inv.kind === "proforma") throw new UserError("A proforma has no fiscal effect; issue the final invoice instead of a storno.");

        const { data: pending, error: insErr } = await db.from("guest_invoices").insert({
          organization_slug: inv.organization_slug, hotel_id: hotelId, reservation_id: inv.reservation_id,
          issuer_id: inv.issuer_id, kind: "storno", origin_invoice_id: inv.id, currency: inv.currency, payment_method: inv.payment_method,
          language: inv.language, buyer: inv.buyer, lines: inv.lines,
          net_total: -Number(inv.net_total), vat_total: -Number(inv.vat_total), gross_total: -Number(inv.gross_total),
          created_by: caller.userId,
        }).select("id").single();
        if (insErr) {
          if (insErr.code === "23505") throw new UserError("A storno for this invoice already exists or is in flight.", 409);
          throw new Error(insErr.message);
        }

        const { result } = await callAgent(ACTION_FIELDS.storno, buildStornoXml(credential, String(inv.invoice_number)));
        await db.from("guest_invoices").update(result.ok
          ? { status: "issued", invoice_number: result.invoiceNumber, issued_at: new Date().toISOString() }
          : { status: "failed", error_code: result.errorCode, error_message: result.errorMessage?.slice(0, 500) },
        ).eq("id", pending.id);
        if (!result.ok) throw new UserError(`Számlázz.hu rejected the storno: ${result.errorMessage ?? result.errorCode ?? "unknown error"}`, 502);

        await db.from("reservation_events").insert({
          reservation_id: inv.reservation_id, hotel_id: hotelId, organization_slug: inv.organization_slug,
          event_type: "invoice_stornoed",
          metadata: { invoice_id: inv.id, storno_id: pending.id, storno_number: result.invoiceNumber },
          created_by: caller.userId,
        });
        return json({ ok: true, storno_id: pending.id, storno_number: result.invoiceNumber });
      }

      case "payment": {
        if (!hasRole(caller, ISSUE_ROLES)) return json({ ok: false, error: "Forbidden" }, 403);
        const inv = await loadInvoice(db, hotelId, String(payload.invoice_id ?? ""));
        const credential = await historicalAuth(db, inv);
        if (inv.status !== "issued" || !inv.invoice_number) throw new UserError("Only an issued invoice can record a payment.");
        const amount = Number(payload.amount ?? NaN);
        if (!Number.isFinite(amount) || amount === 0) throw new UserError("A non-zero payment amount is required.");
        const date = String(payload.date ?? budapestToday());
        const method = String(payload.method ?? inv.payment_method);
        const { result } = await callAgent(ACTION_FIELDS.payment,
          buildPaymentXml(credential, String(inv.invoice_number), [{ date, title: method, amount }], payload.additive === true));
        if (!result.ok) throw new UserError(`Számlázz.hu rejected the payment: ${result.errorMessage ?? result.errorCode ?? "unknown error"}`, 502);
        return json({ ok: true, invoice_number: inv.invoice_number, amount, date, method });
      }

      case "pdf": {
        const inv = await loadInvoice(db, hotelId, String(payload.invoice_id ?? ""));
        const credential = await historicalAuth(db, inv);
        if (inv.status !== "issued" || !inv.invoice_number) throw new UserError("Only an issued invoice has a PDF.");
        const { result, body } = await callAgent(ACTION_FIELDS.pdf, buildPdfQueryXml(credential, String(inv.invoice_number)));
        if (!result.ok) throw new UserError(`Számlázz.hu rejected the PDF request: ${result.errorMessage ?? result.errorCode ?? "unknown error"}`, 502);
        return json({ ok: true, invoice_number: inv.invoice_number, pdf_base64: b64(body) });
      }

      default:
        return json({ ok: false, error: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    if (e instanceof UserError) return json({ ok: false, error: e.message }, e.status);
    console.error("szamlazz-invoice error", e);
    return json({ ok: false, error: "Internal error" }, 500);
  }
});
