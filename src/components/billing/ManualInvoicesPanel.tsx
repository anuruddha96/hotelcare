import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type Payment = {
  id: string; contract_id: string; period_start: string; period_end: string;
  payment_source: string; status: string; currency: string;
  net_cents: number; vat_cents: number; gross_cents: number;
  paid_at: string | null; szamlazz_invoice_number: string | null;
  invoiced_at: string | null;
};
const amount = (cents: number, currency: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency }).format(cents / 100);

export default function ManualInvoicesPanel({ organizationSlug }: { organizationSlug?: string }) {
  const { profile } = useAuth();
  const canRecord = profile?.role === "admin" || Boolean(profile?.is_super_admin);
  const [rows, setRows] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!organizationSlug) return;
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("billing-manage", {
      body: { action: "manual_payments", organizationSlug },
    });
    if (error || (data as { error?: string } | null)?.error) {
      toast.error((data as { error?: string } | null)?.error ?? error?.message ?? "Could not load payments");
    } else {
      setRows((data as { payments?: Payment[] })?.payments ?? []);
    }
    setLoading(false);
  }, [organizationSlug]);

  useEffect(() => { void reload(); }, [reload]);

  const record = async (payment: Payment) => {
    const invoiceNumber = (numbers[payment.id] ?? "").trim();
    if (!invoiceNumber) return toast.error("Enter the issued Számlázz.hu invoice number first.");
    setSaving(payment.id);
    const { data, error } = await supabase.functions.invoke("billing-manage", {
      body: { action: "mark_invoiced", organizationSlug, paymentId: payment.id, invoiceNumber },
    });
    setSaving(null);
    if (error || (data as { error?: string } | null)?.error) {
      toast.error((data as { error?: string } | null)?.error ?? error?.message ?? "Could not save invoice reference");
    } else {
      toast.success("Számlázz.hu invoice reference recorded");
      void reload();
    }
  };

  const awaiting = rows.filter((row) => row.status === "paid" && !row.szamlazz_invoice_number);
  const other = rows.filter((row) => row.status !== "paid" || row.szamlazz_invoice_number);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Számlázz.hu — manual invoicing</CardTitle>
        <CardDescription>
          Stripe collects the payment, not the tax invoice. Issue the official invoice in Számlázz.hu,
          then record its number below. Never issue an invoice for an unpaid charge.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Badge variant={awaiting.length ? "destructive" : "secondary"}>{awaiting.length} awaiting invoice</Badge>
          <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>Refresh</Button>
        </div>
        {loading && <p className="text-sm text-muted-foreground">Loading payment ledger…</p>}
        {!loading && rows.length === 0 && <p className="text-sm text-muted-foreground">No payment-only transactions yet.</p>}
        {[...awaiting, ...other].map((payment) => (
          <div key={payment.id} className="space-y-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">{amount(payment.gross_cents, payment.currency)} · {payment.payment_source}</p>
                <p className="text-xs text-muted-foreground">
                  Net {amount(payment.net_cents, payment.currency)} + VAT {amount(payment.vat_cents, payment.currency)}
                  {" · "}Period {payment.period_start.slice(0, 10)}–{payment.period_end.slice(0, 10)}
                </p>
              </div>
              <Badge variant={payment.status === "paid" ? "secondary" : "outline"}>
                {payment.szamlazz_invoice_number ? "Invoiced" : payment.status === "paid" ? "Awaiting invoice" : payment.status}
              </Badge>
            </div>
            {payment.szamlazz_invoice_number ? (
              <p className="text-sm">Számlázz invoice: <strong>{payment.szamlazz_invoice_number}</strong></p>
            ) : payment.status === "paid" && canRecord ? (
              <div className="flex flex-wrap gap-2">
                <Input className="max-w-xs" aria-label="Számlázz invoice number"
                  placeholder="Issued Számlázz.hu invoice number"
                  value={numbers[payment.id] ?? ""}
                  onChange={(event) => setNumbers((old) => ({ ...old, [payment.id]: event.target.value }))} />
                <Button size="sm" disabled={saving === payment.id} onClick={() => void record(payment)}>
                  {saving === payment.id ? "Saving…" : "Mark invoice issued"}
                </Button>
              </div>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
