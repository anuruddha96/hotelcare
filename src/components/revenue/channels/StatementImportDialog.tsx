import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { money } from "@/lib/revenueCurrency";
import { channelLabel } from "@/lib/channelEconomics";
import { parseStatementRows, statementTotals, type ParsedStatement } from "@/lib/otaStatementImport";
import { useChannelCopy } from "./copy";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const CHUNK = 500;

export default function StatementImportDialog({
  hotelId, open, onOpenChange, onImported,
}: {
  hotelId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const { t, hu } = useChannelCopy();
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedStatement | null>(null);
  const [period, setPeriod] = useState("");
  const [matched, setMatched] = useState<Set<string> | null>(null);
  const [matchFailed, setMatchFailed] = useState(false);
  const [knownListings, setKnownListings] = useState<string[]>([]);
  const [includeUnmatched, setIncludeUnmatched] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (open) return;
    setFileName(""); setBusy(false); setError(null); setParsed(null); setPeriod("");
    setMatched(null); setMatchFailed(false); setIncludeUnmatched(false); setImporting(false);
  }, [open]);

  useEffect(() => {
    if (!open || !hotelId) return;
    let active = true;
    void db.from("ota_commercial_terms").select("listing_ref").eq("hotel_id", hotelId)
      .then(({ data }: { data: { listing_ref: string | null }[] | null }) => {
        if (active) setKnownListings([...new Set((data ?? []).map((r) => r.listing_ref).filter((x): x is string => !!x))]);
      });
    return () => { active = false; };
  }, [open, hotelId]);

  const unknownListings = useMemo(
    () => (parsed?.channel === "booking_com" && knownListings.length ? parsed.listingRefs.filter((id) => !knownListings.includes(id)) : []),
    [parsed, knownListings],
  );

  async function readFile(file: File) {
    setFileName(file.name);
    setBusy(true);
    setError(null);
    setParsed(null);
    setMatched(null);
    setMatchFailed(false);
    try {
      const XLSX = await import("xlsx");
      const book = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const sheet = book.Sheets[book.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
      const result = parseStatementRows(rows, file.name);
      if ("error" in result) {
        setError(result.error === "no_lines" ? t.importer.noLines : t.importer.unrecognised);
        return;
      }
      setParsed(result.statement);
      setPeriod(result.statement.period ?? "");
      const codes = [...new Set(result.statement.lines.map((l) => l.ota_reservation_code))];
      const { data, error: matchError } = await db.rpc("revenue_match_ota_codes", { p_hotel_id: hotelId, p_codes: codes });
      if (matchError) {
        setMatchFailed(true);
        setIncludeUnmatched(false);
      } else {
        const found = new Set<string>(((data ?? []) as { ota_code: string | null }[]).map((r) => r.ota_code ?? "").filter(Boolean));
        setMatched(found);
        // A Booking.com statement for this hotel's own listing: keep cancelled bookings Previo no longer holds.
        const listingOk = result.statement.channel === "booking_com"
          && (knownListings.length === 0 || result.statement.listingRefs.every((id) => knownListings.includes(id)));
        setIncludeUnmatched(listingOk);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t.importer.unrecognised);
    } finally {
      setBusy(false);
    }
  }

  const lines = parsed?.lines ?? [];
  const matchedLines = matched ? lines.filter((l) => matched.has(l.ota_reservation_code)) : [];
  const unmatchedCount = matched ? lines.length - matchedLines.length : 0;
  const toImport = matched ? (includeUnmatched ? lines : matchedLines) : (includeUnmatched ? lines : []);
  const totals = statementTotals(lines);
  const periodOk = /^\d{4}-\d{2}-\d{2}$/.test(period);

  async function runImport() {
    if (!parsed || !periodOk || toImport.length === 0) return;
    setImporting(true);
    const batch = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : null;
    try {
      const rows = toImport.map((l) => ({
        ...l,
        hotel_id: hotelId,
        statement_period: period,
        source_file: fileName.slice(0, 200),
        import_batch: batch,
        imported_at: new Date().toISOString(),
      }));
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error: upsertError } = await db.from("ota_statement_lines")
          .upsert(rows.slice(i, i + CHUNK), { onConflict: "channel_key,listing_ref,statement_period,ota_reservation_code" });
        if (upsertError) throw upsertError;
      }
      toast.success(t.importer.done(rows.length));
      onImported();
      onOpenChange(false);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String((reason as { message?: string })?.message ?? reason);
      toast.error(`${t.importer.failed}: ${message}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.importer.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">{t.importer.help}</p>
          <div className="space-y-1">
            <Label htmlFor="ota-statement-file">{t.importer.pick}</Label>
            <Input id="ota-statement-file" type="file" accept=".xlsx,.xls" disabled={busy || importing}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); }} />
          </div>
          {busy && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t.importer.reading}</p>}
          {error && <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</p>}
          {parsed && (
            <div className="space-y-3 rounded-lg border p-3">
              <p className="flex items-center gap-2 font-medium"><FileSpreadsheet className="h-4 w-4" />{channelLabel(parsed.channel, hu)} · {t.importer.linesFound(lines.length)}</p>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                <li>{t.importer.totals(money(totals.gross), money(totals.commission))}</li>
                {totals.cancelled > 0 && <li>{t.importer.cancelled(totals.cancelled)}</li>}
                {parsed.listingRefs.length > 0 && <li>{t.importer.listing}: {parsed.listingRefs.join(", ")}</li>}
                {matched && <li className="font-medium text-foreground">{t.importer.matched(matchedLines.length, lines.length)}</li>}
              </ul>
              {unknownListings.length > 0 && (
                <p className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t.importer.listingWarn(unknownListings.join(", "))}</p>
              )}
              {matchFailed && (
                <p className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t.importer.matchFailed}</p>
              )}
              <div className="space-y-1">
                <Label htmlFor="ota-statement-period">{t.importer.periodLabel}</Label>
                <Input id="ota-statement-period" type="date" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-44" />
                <p className="text-[11px] text-muted-foreground">{t.importer.periodHelp}</p>
              </div>
              {(unmatchedCount > 0 || matchFailed) && (
                <label className="flex items-start gap-2 text-xs">
                  <Checkbox checked={includeUnmatched} onCheckedChange={(v) => setIncludeUnmatched(v === true)} className="mt-0.5" />
                  <span>{t.importer.includeUnmatched(matchFailed ? lines.length : unmatchedCount)}</span>
                </label>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>{t.importer.cancel}</Button>
          <Button type="button" onClick={() => void runImport()} disabled={!parsed || !periodOk || toImport.length === 0 || importing || busy}>
            {importing ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />{t.importer.importing}</> : t.importer.importBtn(toImport.length)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
