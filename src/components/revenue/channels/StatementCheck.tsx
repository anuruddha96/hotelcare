import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { money } from "@/lib/revenueCurrency";
import { fetchAllRpcRows } from "@/hooks/useChannelEconomics";
import { channelLabel, monthBounds, shiftMonth } from "@/lib/channelEconomics";
import {
  checkStatementRow, summariseStatements, toStatementCheckRow, type StatementCheckRow,
} from "@/lib/otaStatementImport";
import { useChannelCopy } from "./copy";
import { dayLabel, monthLabel } from "./format";
import StatementImportDialog from "./StatementImportDialog";

/** Imported OTA statements against each booking's note and the contract terms. */
export default function StatementCheck({
  hotelId, month, canEdit, onImported,
}: {
  hotelId: string | null;
  month: string;
  canEdit: boolean;
  onImported: () => void;
}) {
  const { t, hu, locale } = useChannelCopy();
  const [rows, setRows] = useState<StatementCheckRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [token, setToken] = useState(0);

  const from = `${shiftMonth(month, -6)}-01`;
  const to = monthBounds(shiftMonth(month, 1)).to;

  useEffect(() => {
    if (!hotelId) return;
    let active = true;
    setLoading(true);
    setError(null);
    void fetchAllRpcRows("revenue_ota_statement_check", { p_hotel_id: hotelId, p_from: from, p_to: to },
      ["statement_period", "channel_key", "listing_ref", "ota_reservation_code"])
      .then((data) => { if (active) setRows(data.map(toStatementCheckRow)); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String((reason as { message?: string })?.message ?? reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [hotelId, from, to, token]);

  const summaries = useMemo(() => summariseStatements(rows ?? []), [rows]);
  const periodText = (s: { channel_key: string; statement_period: string }) =>
    s.channel_key === "booking_com" ? monthLabel(s.statement_period.slice(0, 7), locale) : dayLabel(s.statement_period, locale);

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">{t.statements.title}</h4>
          <p className="text-xs text-muted-foreground">{t.statements.subtitle}</p>
        </div>
        {canEdit && hotelId && (
          <Button type="button" size="sm" className="h-8 gap-1.5" onClick={() => setImportOpen(true)}>
            <Upload className="h-3.5 w-3.5" />{t.statements.import}
          </Button>
        )}
      </div>

      {loading && !rows && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t.loading}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{t.error} <span className="text-xs text-muted-foreground">({error})</span></p>}
      {rows && summaries.length === 0 && <p className="rounded-lg border p-4 text-sm text-muted-foreground">{t.statements.empty}</p>}

      {summaries.length > 0 && (
        <div className={cn("overflow-x-auto rounded-lg border", loading && "opacity-60")}>
          <table className="w-full min-w-[680px] text-xs">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="p-2">{t.statements.statement}</th>
                <th className="p-2">{t.statements.period}</th>
                <th className="p-2 text-right">{t.statements.lines}</th>
                <th className="p-2 text-right">{t.statements.charged}</th>
                <th className="p-2 text-right">{t.statements.expected}</th>
                <th className="p-2 text-right">{t.statements.difference}</th>
                <th className="p-2 text-right">{t.statements.flagged}</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {summaries.map((s) => {
                const lines = (rows ?? []).filter((r) => r.channel_key === s.channel_key && r.statement_period === s.statement_period);
                const flagged = lines.map((r) => ({ r, check: checkStatementRow(r) }))
                  .filter(({ check }) => check.status !== "ok" && check.status !== "no_charge");
                const diff = s.charged - s.expected;
                const isOpen = open === s.key;
                return (
                  <tr key={s.key} className="border-t align-top">
                    <td className="p-2 font-medium">
                      {channelLabel(s.channel_key, hu)}
                      {s.listingRefs.length > 0 && <span className="block text-[10px] font-normal text-muted-foreground">#{s.listingRefs.join(", #")}</span>}
                    </td>
                    <td className="p-2">{periodText(s)}</td>
                    <td className="p-2 text-right tabular-nums">{s.lines}</td>
                    <td className="p-2 text-right tabular-nums">{money(s.charged)}</td>
                    <td className="p-2 text-right tabular-nums">{money(s.expected)}</td>
                    <td className={cn("p-2 text-right tabular-nums", Math.abs(diff) > Math.max(5, s.expected * 0.005) && "font-semibold")}>{Math.abs(diff) < 0.5 ? money(0) : `${diff > 0 ? "+" : "−"}${money(Math.abs(diff))}`}</td>
                    <td className="p-2 text-right">
                      {s.flagged + s.notInPms === 0
                        ? <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />0</span>
                        : <span className="inline-flex items-center gap-1 text-amber-800 dark:text-amber-300"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />{s.flagged + s.notInPms}</span>}
                    </td>
                    <td className="p-2 text-right">
                      {flagged.length > 0 && (
                        <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s.key)}>
                          {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          {isOpen ? t.statements.hideLines : t.statements.showLines}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {summaries.filter((s) => s.key === open).map((s) => {
        const lines = (rows ?? []).filter((r) => r.channel_key === s.channel_key && r.statement_period === s.statement_period)
          .map((r) => ({ r, check: checkStatementRow(r) }))
          .filter(({ check }) => check.status !== "ok" && check.status !== "no_charge");
        return (
          <div key={s.key} className="overflow-x-auto rounded-lg border">
            <p className="border-b p-2 text-xs font-medium">{channelLabel(s.channel_key, hu)} · {periodText(s)}</p>
            <table className="w-full min-w-[720px] text-xs">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="p-2">{t.statements.code}</th>
                  <th className="p-2">{t.statements.stay}</th>
                  <th className="p-2">{t.statements.status}</th>
                  <th className="p-2 text-right">{t.statements.gross}</th>
                  <th className="p-2 text-right">{t.statements.charged}</th>
                  <th className="p-2 text-right">{t.statements.expected}</th>
                  <th className="p-2 text-right">{t.statements.difference}</th>
                  <th className="p-2">{t.statements.reason}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(({ r, check }) => (
                  <tr key={r.ota_reservation_code + r.listing_ref} className="border-t">
                    <td className="p-2 font-mono">{r.ota_reservation_code}</td>
                    <td className="p-2 whitespace-nowrap">{dayLabel(r.check_in, locale)} – {dayLabel(r.check_out, locale)}</td>
                    <td className="p-2">{r.status ?? "—"}</td>
                    <td className="p-2 text-right tabular-nums">{money(r.statement_gross)}</td>
                    <td className="p-2 text-right tabular-nums">{money(r.statement_commission)}{r.statement_pct !== null && <span className="ml-1 text-muted-foreground">({r.statement_pct}%)</span>}</td>
                    <td className="p-2 text-right tabular-nums">
                      {check.reference === null ? "—" : money(check.reference)}
                      {check.referenceKind && <span className="ml-1 text-muted-foreground">({check.referenceKind === "note" ? t.statements.referenceNote : `${t.statements.referenceTerms}${r.terms_pct !== null ? ` ${r.terms_pct}%` : ""}`})</span>}
                    </td>
                    <td className="p-2 text-right tabular-nums">{check.difference === null ? "—" : Math.abs(check.difference) < 0.5 ? money(0) : `${check.difference > 0 ? "+" : "−"}${money(Math.abs(check.difference))}`}</td>
                    <td className="p-2">{t.statements.checkStatus[check.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {rows && summaries.length > 0 && summaries.every((s) => s.flagged + s.notInPms === 0) && (
        <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />{t.statements.allGood}</p>
      )}

      {hotelId && (
        <StatementImportDialog
          hotelId={hotelId}
          open={importOpen}
          onOpenChange={setImportOpen}
          onImported={() => { setToken((n) => n + 1); onImported(); }}
        />
      )}
    </div>
  );
}
