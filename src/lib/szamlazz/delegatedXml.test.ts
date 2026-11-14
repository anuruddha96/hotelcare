import { describe, expect, it } from "vitest";
import { buildInvoiceXml, buildPaymentXml, buildPdfQueryXml, buildStornoXml, computeLine } from "../../../supabase/functions/_shared/szamlazz/xml";

const credentials = { username: "delegate@example.hu", password: "abc<&pass" };
const line = computeLine({ description: "Szállásdíj", quantity: 1, unit: "éj", grossUnitPrice: 10500, vatKey: "5" });

describe("company-specific Számla Agent authentication", () => {
  it("preserves Agent key authentication for company-owned accounts", () => {
    const xml = buildInvoiceXml({
      agentKey: "own-key", issueDate: "2026-11-14", fulfillmentDate: "2026-11-14",
      dueDate: "2026-11-14", paymentMethod: "bankkártya", currency: "HUF",
      buyer: { name: "Test Buyer", zip: "1071", city: "Budapest", address: "Test utca 1" },
      lines: [line],
    });
    expect(xml).toContain("<szamlaagentkulcs>own-key</szamlaagentkulcs>");
    expect(xml).not.toContain("<felhasznalo>");
    expect(xml).not.toContain("<jelszo>");
  });
  it("uses delegated user credentials instead of an account key", () => {
    const xml = buildInvoiceXml({
      delegatedUser: credentials.username, delegatedPassword: credentials.password,
      issueDate: "2026-11-14", fulfillmentDate: "2026-11-14", dueDate: "2026-11-14",
      paymentMethod: "bankkártya", currency: "HUF", invoiceNumberPrefix: "HTL",
      buyer: { name: "Test Buyer", zip: "1071", city: "Budapest", address: "Test utca 1" },
      lines: [line], eInvoice: true,
    });
    expect(xml).toContain("<felhasznalo>delegate@example.hu</felhasznalo>");
    expect(xml).toContain("<jelszo>abc&lt;&amp;pass</jelszo>");
    expect(xml).not.toContain("<szamlaagentkulcs>");
    expect(xml).toContain("<eszamla>true</eszamla>");
    expect(xml).toContain("<szamlaszamElotag>HTL</szamlaszamElotag>");
  });
  it("supports delegated login for storno, payment and PDF", () => {
    const operations = [
      buildStornoXml(credentials, "HTL-2026-1"),
      buildPdfQueryXml(credentials, "HTL-2026-1"),
      buildPaymentXml(credentials, "HTL-2026-1", [{ date: "2026-11-14", title: "bankkártya", amount: 10500 }]),
    ];
    operations.forEach(xml => {
      expect(xml).toContain("<felhasznalo>delegate@example.hu</felhasznalo>");
      expect(xml).toContain("<jelszo>abc&lt;&amp;pass</jelszo>");
      expect(xml).not.toContain("<szamlaagentkulcs>");
    });
  });
  it("rejects blank delegated credentials before invoice XML generation", () => {
    expect(() => buildInvoiceXml({
      delegatedUser: "", delegatedPassword: "secret",
      issueDate: "2026-11-14", fulfillmentDate: "2026-11-14", dueDate: "2026-11-14",
      paymentMethod: "bankkártya", currency: "HUF",
      buyer: { name: "Test", zip: "1", city: "Budapest", address: "Street" }, lines: [line],
    })).toThrow("Provider authentication is required");
  });
});