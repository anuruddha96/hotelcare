import { useMemo } from "react";
import { Info } from "lucide-react";
import { money } from "@/lib/revenueCurrency";
import { byRateGroup, grossAdr, RATE_GROUP_LABEL, totalsOf, type EconomicsRow } from "@/lib/channelEconomics";
import { useChannelCopy } from "./copy";
import { monthLabel, pct } from "./format";

/**
 * Booking.com rate plans by discount family: how much of the channel sells on
 * mobile, non-refundable and promotional prices rather than the standard rate.
 */
export default function RatePlanMix({ rows, month }: { rows: EconomicsRow[]; month: string }) {
  const { t, hu, locale } = useChannelCopy();
  const groups = useMemo(() => byRateGroup(rows, "booking_com"), [rows]);
  const bdcTotals = useMemo(() => totalsOf(rows.filter((r) => r.channel_key === "booking_com")), [rows]);
  const avgAdr = grossAdr(bdcTotals);

  if (groups.length === 0) {
    return <p className="rounded-lg border p-4 text-sm text-muted-foreground">{t.rates.empty}</p>;
  }
  const onlyUnlabelled = groups.length === 1 && groups[0].group === "unlabelled";

  return (
    <div className="min-w-0 space-y-3">
      <div className="rounded-lg border p-3">
        <h4 className="text-sm font-semibold">{t.rates.title} · {monthLabel(month, locale)}</h4>
        <p className="text-xs text-muted-foreground">{t.rates.subtitle}</p>
        {onlyUnlabelled && <p className="mt-2 text-xs text-muted-foreground">{t.rates.noLabels}</p>}
        <ul className="mt-3 space-y-2" aria-label={t.rates.title}>
          {groups.map((g) => (
            <li key={g.group} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs">
              <span className="truncate font-medium" title={g.labels.join(" · ")}>{hu ? RATE_GROUP_LABEL[g.group].hu : RATE_GROUP_LABEL[g.group].en}</span>
              <span className="h-2 rounded-full bg-muted" aria-hidden>
                <span className="block h-2 rounded-full bg-[var(--econ-net)]" style={{ width: `${Math.max(1, g.share * 100)}%` }} />
              </span>
              <span className="text-right tabular-nums">{pct(g.share, locale, 0)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[620px] text-xs">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="p-2">{t.rates.family}</th>
              <th className="p-2 text-right">{t.rates.roomNights}</th>
              <th className="p-2 text-right">{t.rates.share}</th>
              <th className="p-2 text-right">{t.rates.adr}</th>
              <th className="p-2 text-right">{t.rates.vsAverage}</th>
              <th className="p-2 text-right">{t.rates.bookings}</th>
              <th className="p-2">{t.rates.plans}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const vs = g.adr !== null && avgAdr ? g.adr / avgAdr - 1 : null;
              return (
                <tr key={g.group} className="border-t align-top">
                  <td className="p-2 font-medium">{hu ? RATE_GROUP_LABEL[g.group].hu : RATE_GROUP_LABEL[g.group].en}</td>
                  <td className="p-2 text-right tabular-nums">{g.roomNights.toLocaleString(locale)}</td>
                  <td className="p-2 text-right tabular-nums">{pct(g.share, locale)}</td>
                  <td className="p-2 text-right tabular-nums">{money(g.adr)}</td>
                  <td className="p-2 text-right tabular-nums">{vs === null ? "—" : `${vs > 0 ? "+" : ""}${pct(vs, locale)}`}</td>
                  <td className="p-2 text-right tabular-nums">{g.bookings}</td>
                  <td className="max-w-[16rem] p-2 text-muted-foreground">{g.labels.slice(0, 4).join(" · ")}{g.labels.length > 4 ? ` +${g.labels.length - 4}` : ""}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/30 font-semibold">
              <td className="p-2">Booking.com</td>
              <td className="p-2 text-right tabular-nums">{bdcTotals.roomNights.toLocaleString(locale)}</td>
              <td className="p-2 text-right tabular-nums">{pct(1, locale, 0)}</td>
              <td className="p-2 text-right tabular-nums">{money(avgAdr)}</td>
              <td className="p-2" />
              <td className="p-2 text-right tabular-nums">{bdcTotals.bookings}</td>
              <td className="p-2" />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="space-y-1 rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
        <p className="flex gap-1.5"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{t.rates.tip}</p>
        <p className="pl-5">{t.rates.genius}</p>
      </div>
    </div>
  );
}
