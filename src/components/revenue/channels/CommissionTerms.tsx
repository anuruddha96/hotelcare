import { useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { channelLabel, TERMS_CHANNELS } from "@/lib/channelEconomics";
import { useChannelCopy } from "./copy";
import { dayLabel } from "./format";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface TermsRow {
  id: string;
  hotel_id: string;
  channel_key: string;
  listing_ref: string | null;
  applies_by_default: boolean;
  amount_basis: "gross" | "net";
  commission_pct: number;
  extra_commission_pct: number;
  city_tax_pct: number;
  valid_from: string;
  valid_to: string | null;
  source: string;
  verified_at: string | null;
  notes: string | null;
}

type Draft = Omit<TermsRow, "id" | "hotel_id" | "source" | "verified_at" | "commission_pct" | "extra_commission_pct" | "city_tax_pct"> & {
  id: string | null;
  commission_pct: string;
  extra_commission_pct: string;
  city_tax_pct: string;
};

const today = () => new Date().toISOString().slice(0, 10);

function termsStatus(row: Pick<TermsRow, "valid_from" | "valid_to">, on = today()): "active" | "ended" | "upcoming" {
  if (row.valid_from > on) return "upcoming";
  if (row.valid_to && row.valid_to < on) return "ended";
  return "active";
}

function toNumber(value: string): number | null {
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export default function CommissionTerms({ hotelId, canEdit, onChanged }: { hotelId: string | null; canEdit: boolean; onChanged: () => void }) {
  const { t, hu, locale } = useChannelCopy();
  const [rows, setRows] = useState<TermsRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [token, setToken] = useState(0);

  useEffect(() => {
    if (!hotelId) return;
    let active = true;
    setError(null);
    void db.from("ota_commercial_terms").select("*").eq("hotel_id", hotelId)
      .order("channel_key").order("valid_from", { ascending: false })
      .then(({ data, error: fetchError }: { data: TermsRow[] | null; error: { message: string } | null }) => {
        if (!active) return;
        if (fetchError) setError(fetchError.message);
        else setRows((data ?? []).map((r) => ({ ...r, commission_pct: Number(r.commission_pct), extra_commission_pct: Number(r.extra_commission_pct), city_tax_pct: Number(r.city_tax_pct) })));
      });
    return () => { active = false; };
  }, [hotelId, token]);

  const grouped = useMemo(() => {
    const map = new Map<string, TermsRow[]>();
    for (const r of rows ?? []) map.set(r.channel_key, [...(map.get(r.channel_key) ?? []), r]);
    return [...map.entries()];
  }, [rows]);

  const openNew = () => setDraft({
    id: null, channel_key: "booking_com", listing_ref: "", applies_by_default: true, amount_basis: "gross",
    commission_pct: "", extra_commission_pct: "0", city_tax_pct: "3.8095", valid_from: today(), valid_to: null, notes: "",
  });
  const openEdit = (r: TermsRow) => setDraft({
    id: r.id, channel_key: r.channel_key, listing_ref: r.listing_ref ?? "", applies_by_default: r.applies_by_default,
    amount_basis: r.amount_basis, commission_pct: String(r.commission_pct), extra_commission_pct: String(r.extra_commission_pct),
    city_tax_pct: String(r.city_tax_pct), valid_from: r.valid_from, valid_to: r.valid_to, notes: r.notes ?? "",
  });

  const pct = draft ? toNumber(draft.commission_pct) : null;
  const extra = draft ? toNumber(draft.extra_commission_pct || "0") : null;
  const tax = draft ? toNumber(draft.city_tax_pct || "0") : null;
  const valid = !!draft && pct !== null && extra !== null && tax !== null
    && pct >= 0 && pct < 100 && extra >= 0 && extra < 100 && pct + extra < 100 && tax >= 0 && tax < 50
    && /^\d{4}-\d{2}-\d{2}$/.test(draft.valid_from) && (!draft.valid_to || draft.valid_to >= draft.valid_from);

  async function save() {
    if (!draft || !valid || !hotelId) return;
    setSaving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const payload = {
        hotel_id: hotelId,
        channel_key: draft.channel_key,
        listing_ref: draft.listing_ref?.trim() || null,
        applies_by_default: draft.applies_by_default,
        amount_basis: draft.amount_basis,
        commission_pct: pct,
        extra_commission_pct: extra,
        city_tax_pct: tax,
        valid_from: draft.valid_from,
        valid_to: draft.valid_to || null,
        notes: draft.notes?.trim() || null,
        verified_at: new Date().toISOString(),
        verified_by: auth.user?.id ?? null,
        ...(draft.id ? {} : { source: "manual" }),
      };
      const query = draft.id
        ? db.from("ota_commercial_terms").update(payload).eq("id", draft.id)
        : db.from("ota_commercial_terms").insert(payload);
      const { error: saveError } = await query;
      if (saveError) throw saveError;
      toast.success(t.terms.saved);
      setDraft(null);
      setToken((n) => n + 1);
      onChanged();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String((reason as { message?: string })?.message ?? reason);
      toast.error(`${t.terms.failed}: ${message}`);
    } finally {
      setSaving(false);
    }
  }

  const statusChip = (r: TermsRow) => {
    const s = termsStatus(r);
    return (
      <span className={cn("rounded-full border px-1.5 py-px text-[10px]",
        s === "active" ? "border-emerald-600/40 text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
        {s === "active" ? t.terms.active : s === "ended" ? t.terms.ended : t.terms.upcoming}
      </span>
    );
  };

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">{t.terms.title}</h4>
          <p className="text-xs text-muted-foreground">{t.terms.subtitle}</p>
        </div>
        {canEdit ? (
          <Button type="button" size="sm" className="h-8 gap-1.5" onClick={openNew}><Plus className="h-3.5 w-3.5" />{t.terms.add}</Button>
        ) : (
          <p className="text-[11px] text-muted-foreground">{t.terms.readOnly}</p>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{t.error} <span className="text-xs text-muted-foreground">({error})</span></p>}
      {!rows && !error && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t.loading}</p>}
      {rows && rows.length === 0 && <p className="rounded-lg border p-4 text-sm text-muted-foreground">{t.terms.empty}</p>}

      {grouped.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="p-2">{t.terms.channel}</th>
                <th className="p-2">{t.terms.listing}</th>
                <th className="p-2">{t.terms.basis}</th>
                <th className="p-2 text-right">{t.terms.commission}</th>
                <th className="p-2 text-right">{t.terms.extra}</th>
                <th className="p-2 text-right">{t.terms.total}</th>
                <th className="p-2 text-right">{t.terms.cityTax}</th>
                <th className="p-2">{t.terms.validFrom} – {t.terms.validTo}</th>
                <th className="p-2">{t.terms.notes}</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {grouped.map(([channel, list]) => list.map((r, i) => (
                <tr key={r.id} className={cn("border-t align-top", termsStatus(r) === "ended" && "text-muted-foreground")}>
                  <td className="p-2 font-medium">{i === 0 ? channelLabel(channel, hu) : ""}</td>
                  <td className="p-2">{r.listing_ref ?? "—"}{!r.applies_by_default && <span className="block text-[10px] text-muted-foreground">2nd</span>}</td>
                  <td className="p-2">{r.amount_basis === "net" ? t.terms.basisNet : t.terms.basisGross}</td>
                  <td className="p-2 text-right tabular-nums">{r.commission_pct}%</td>
                  <td className="p-2 text-right tabular-nums">{r.extra_commission_pct ? `${r.extra_commission_pct}%` : "—"}</td>
                  <td className="p-2 text-right font-semibold tabular-nums">{Math.round((r.commission_pct + r.extra_commission_pct) * 100) / 100}%</td>
                  <td className="p-2 text-right tabular-nums">{r.city_tax_pct}%</td>
                  <td className="p-2 whitespace-nowrap">{dayLabel(r.valid_from, locale)} – {r.valid_to ? dayLabel(r.valid_to, locale) : t.terms.open} <span className="ml-1">{statusChip(r)}</span></td>
                  <td className="max-w-[14rem] p-2 text-muted-foreground">{r.notes ?? ""}{r.verified_at && <span className="block text-[10px]">{t.terms.verified}: {dayLabel(r.verified_at, locale)}</span>}</td>
                  <td className="p-2 text-right">
                    {canEdit && <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={t.terms.edit} onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>}
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => { if (!o) setDraft(null); }}>
        <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
          <DialogHeader><DialogTitle>{draft?.id ? t.terms.edit : t.terms.add}</DialogTitle></DialogHeader>
          {draft && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="col-span-2 space-y-1 sm:col-span-1">
                <Label>{t.terms.channel}</Label>
                <Select value={draft.channel_key} onValueChange={(v) => setDraft({ ...draft, channel_key: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TERMS_CHANNELS.map((key) => <SelectItem key={key} value={key}>{channelLabel(key, hu)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-1 sm:col-span-1">
                <Label htmlFor="terms-listing">{t.terms.listing}</Label>
                <Input id="terms-listing" value={draft.listing_ref ?? ""} onChange={(e) => setDraft({ ...draft, listing_ref: e.target.value })} />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>{t.terms.basis}</Label>
                <Select value={draft.amount_basis} onValueChange={(v: "gross" | "net") => setDraft({ ...draft, amount_basis: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gross">{t.terms.basisGross}</SelectItem>
                    <SelectItem value="net">{t.terms.basisNet}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="terms-pct">{t.terms.commission}</Label>
                <Input id="terms-pct" inputMode="decimal" value={draft.commission_pct} onChange={(e) => setDraft({ ...draft, commission_pct: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="terms-extra">{t.terms.extra}</Label>
                <Input id="terms-extra" inputMode="decimal" value={draft.extra_commission_pct} onChange={(e) => setDraft({ ...draft, extra_commission_pct: e.target.value })} />
              </div>
              <p className="col-span-2 -mt-2 text-[11px] text-muted-foreground">{t.terms.extraHelp}</p>
              <div className="space-y-1">
                <Label htmlFor="terms-tax">{t.terms.cityTax}</Label>
                <Input id="terms-tax" inputMode="decimal" value={draft.city_tax_pct} onChange={(e) => setDraft({ ...draft, city_tax_pct: e.target.value })} />
              </div>
              <p className="self-end pb-2 text-[11px] text-muted-foreground">{t.terms.cityTaxHelp}</p>
              <div className="space-y-1">
                <Label htmlFor="terms-from">{t.terms.validFrom}</Label>
                <Input id="terms-from" type="date" value={draft.valid_from} onChange={(e) => setDraft({ ...draft, valid_from: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="terms-to">{t.terms.validTo}</Label>
                <Input id="terms-to" type="date" value={draft.valid_to ?? ""} onChange={(e) => setDraft({ ...draft, valid_to: e.target.value || null })} />
              </div>
              <label className="col-span-2 flex items-start gap-2 text-xs">
                <Checkbox checked={draft.applies_by_default} onCheckedChange={(v) => setDraft({ ...draft, applies_by_default: v === true })} className="mt-0.5" />
                <span><span className="font-medium">{t.terms.defaultListing}</span><span className="block text-muted-foreground">{t.terms.defaultListingHelp}</span></span>
              </label>
              <div className="col-span-2 space-y-1">
                <Label htmlFor="terms-notes">{t.terms.notes}</Label>
                <Textarea id="terms-notes" rows={2} value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
              </div>
              {!valid && draft.commission_pct.trim() !== "" && <p className="col-span-2 text-xs text-destructive">{t.terms.invalid}</p>}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setDraft(null)} disabled={saving}>{t.terms.cancel}</Button>
            <Button type="button" onClick={() => void save()} disabled={!valid || saving}>
              {saving ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />{t.terms.saving}</> : t.terms.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
