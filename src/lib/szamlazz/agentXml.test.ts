// Unit tests for the Számla Agent XML builder shared with the
// szamlazz-invoice edge function (pure module, no Deno APIs).
import { describe, expect, it } from "vitest";
import {
  ACTION_FIELDS, buildInvoiceXml, buildPaymentXml, buildPdfQueryXml, buildStornoXml,
  computeLine, escapeXml, formatNumber, isVatKey, parseAgentHeaders, sumLines, vatRateFor,
  type AgentLine,
} from "../../../supabase/functions/_shared/szamlazz/xml";

const line = (over: Partial<Parameters<typeof computeLine>[0]> = {}): AgentLine =>
  computeLine({ description: "Szállásdíj", quantity: 2, unit: "éj", grossUnitPrice: 33300, vatKey: "5", ...over });

describe("computeLine", () => {
  it("derives net and VAT from a gross price (5% accommodation)", () => {
    const l = line();
    expect(l.grossTotal).toBe(66600);
    expect(l.netTotal).toBe(63428.57);
    expect(l.vatTotal).toBe(3171.43);
    expect(l.netTotal + l.vatTotal).toBeCloseTo(l.grossTotal, 2);
  });

  it("keeps zero-VAT keys gross == net (city tax outside VAT scope)", () => {
    const l = line({ vatKey: "THK", grossUnitPrice: 600, quantity: 3, unit: "db" });
    expect(l.netTotal).toBe(1800);
    expect(l.vatTotal).toBe(0);
    expect(l.grossTotal).toBe(1800);
  });

  it("rejects bad input", () => {
    expect(() => line({ quantity: 0 })).toThrow(/quantity/);
    expect(() => line({ description: "  " })).toThrow(/description/);
    // @ts-expect-error runtime guard for unticked keys
    expect(() => line({ vatKey: "31" })).toThrow(/VAT key/);
  });

  it("vat helpers agree", () => {
    expect(vatRateFor("27")).toBe(27);
    expect(vatRateFor("AAM")).toBe(0);
    expect(isVatKey("5")).toBe(true);
    expect(isVatKey("banana")).toBe(false);
  });
});

describe("buildInvoiceXml", () => {
  const base = {
    agentKey: "test-key",
    issueDate: "2026-11-14",
    fulfillmentDate: "2026-11-14",
    dueDate: "2026-11-14",
    paymentMethod: "bankkártya" as const,
    currency: "HUF",
    buyer: { name: "Kovács Anna", zip: "1072", city: "Budapest", address: "Dob utca 1." },
    lines: [line()],
  };

  it("produces a schema-ordered xmlszamla document", () => {
    const xml = buildInvoiceXml(base);
    expect(xml).toContain('<xmlszamla xmlns="http://www.szamlazz.hu/xmlszamla"');
    expect(xml).toContain("<szamlaagentkulcs>test-key</szamlaagentkulcs>");
    // header fields in XSD order
    const order = ["keltDatum", "teljesitesDatum", "fizetesiHataridoDatum", "fizmod", "penznem", "szamlaNyelve"];
    const idx = order.map((t) => xml.indexOf(`<${t}>`));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(idx.every((i) => i > 0)).toBe(true);
    // proforma flag precedes the number prefix (XSD order)
    const withExtras = buildInvoiceXml({ ...base, proforma: true, invoiceNumberPrefix: "HCARE" });
    expect(withExtras.indexOf("<dijbekero>")).toBeLessThan(withExtras.indexOf("<szamlaszamElotag>"));
    expect(withExtras).toContain("<dijbekero>true</dijbekero>");
    // line totals serialized
    expect(xml).toContain("<nettoErtek>63428.57</nettoErtek>");
    expect(xml).toContain("<bruttoErtek>66600</bruttoErtek>");
    expect(xml).toContain("<afakulcs>5</afakulcs>");
  });

  it("requires an exchange bank for non-HUF and escapes buyer text", () => {
    expect(() => buildInvoiceXml({ ...base, currency: "EUR" })).toThrow(/exchangeBank/);
    const xml = buildInvoiceXml({ ...base, currency: "EUR", exchangeBank: "MNB", buyer: { ...base.buyer, name: 'K&K "Panzió" <Kft>' } });
    expect(xml).toContain("<arfolyamBank>MNB</arfolyamBank>");
    expect(xml).toContain("K&amp;K &quot;Panzió&quot; &lt;Kft&gt;");
  });

  it("refuses an empty invoice", () => {
    expect(() => buildInvoiceXml({ ...base, lines: [] })).toThrow(/line/);
  });
});

describe("other documents", () => {
  it("storno names the invoice", () => {
    const xml = buildStornoXml("k", "HCARE-2026-12");
    expect(xml).toContain('<xmlszamlast xmlns="http://www.szamlazz.hu/xmlszamlast"');
    expect(xml).toContain("<szamlaszam>HCARE-2026-12</szamlaszam>");
    expect(() => buildStornoXml("k", "")).toThrow();
  });

  it("pdf query omits the empty user/password tags", () => {
    const xml = buildPdfQueryXml("k", "HCARE-2026-12");
    expect(xml).not.toContain("<felhasznalo>");
    expect(xml).toContain("<szamlaagentkulcs>k</szamlaagentkulcs>");
  });

  it("payment registration caps at 5 entries", () => {
    const entry = { date: "2026-11-14", title: "bankkártya", amount: 1000 };
    expect(buildPaymentXml("k", "N-1", [entry])).toContain("<osszeg>1000</osszeg>");
    expect(() => buildPaymentXml("k", "N-1", Array(6).fill(entry))).toThrow(/1–5/);
  });
});

describe("parseAgentHeaders", () => {
  it("reads success", () => {
    const h = new Map([["szlahu_szamlaszam", "HCARE-2026-12"], ["szlahu_bruttovegosszeg", "66600"]]);
    const r = parseAgentHeaders((n) => h.get(n) ?? null);
    expect(r.ok).toBe(true);
    expect(r.invoiceNumber).toBe("HCARE-2026-12");
    expect(r.grossTotal).toBe(66600);
  });

  it("decodes an error", () => {
    const h = new Map([["szlahu_error_code", "3"], ["szlahu_error", "Hib%C3%A1s+agent+kulcs"]]);
    const r = parseAgentHeaders((n) => h.get(n) ?? null);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("3");
    expect(r.errorMessage).toBe("Hibás agent kulcs");
  });
});

describe("misc", () => {
  it("sums and formats", () => {
    const totals = sumLines([line(), line({ vatKey: "27", grossUnitPrice: 2500, quantity: 1, unit: "db", description: "Minibár" })]);
    expect(totals.gross).toBe(69100);
    expect(formatNumber(10)).toBe("10");
    expect(formatNumber(10.5)).toBe("10.50");
    expect(escapeXml("a&b")).toBe("a&amp;b");
    expect(ACTION_FIELDS.invoice).toBe("action-xmlagentxmlfile");
  });
});
