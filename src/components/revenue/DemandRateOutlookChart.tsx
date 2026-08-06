import { useMemo, useState } from "react";
import {
  Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine,
  ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle, TrendingUp } from "lucide-react";
import { eur } from "@/lib/revenueAnalytics";

export interface OutlookDay {
  stay_date: string;
  dow?: string;
  lead_time_days?: number;
  rooms_available?: number;
  rooms_sold?: number;
  rooms_remaining?: number;
  occupancy_pct: number;
  adr_eur: number | null;
  revpar_eur?: number | null;
  room_revenue_eur?: number;
  pickup_1d?: number;
  pickup_7d?: number;
  pickup_14d?: number;
  historical_pace_same_weekday?: number | null;
  pace_variance_pct: number | null;
  forecast_occupancy_pct: number;
  forecast_occupancy_low_pct?: number;
  forecast_occupancy_high_pct?: number;
  forecast_rooms_sold?: number;
  forecast_adr_eur?: number | null;
  forecast_revpar_eur?: number | null;
  forecast_room_revenue_eur?: number | null;
  sellout_risk?: string;
  demand_score: number;
  demand_class?: string;
  confidence: number;
  recommended_adr_min: number | null;
  recommended_adr_max: number | null;
  drivers?: string[];
}

const RANGES = [14, 30, 60, 90] as const;

const DEMAND_COLOR: Record<string, string> = {
  very_high: "hsl(var(--primary))",
  high: "hsl(var(--primary) / 0.75)",
  normal: "hsl(var(--muted-foreground) / 0.55)",
  low: "hsl(38 92% 50% / 0.75)",
  very_low: "hsl(var(--destructive) / 0.7)",
};

function classOf(d: OutlookDay) {
  if (d.demand_class) return d.demand_class;
  const s = d.demand_score;
  return s >= 80 ? "very_high" : s >= 62 ? "high" : s >= 38 ? "normal" : s >= 20 ? "low" : "very_low";
}

function shortDay(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC", day: "numeric", month: "short",
  });
}
function longDay(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC", weekday: "long", day: "numeric", month: "long",
  });
}

const RISK_LABEL: Record<string, string> = {
  sold_out: "Sold out", high: "Likely to sell out", medium: "Filling well",
  low: "Space available", very_low: "Wide open",
};

interface Props {
  forecasts: OutlookDay[];
  /** Optional hook so a parent can jump to the rate grid for a date. */
  onOpenDate?: (stayDate: string) => void;
}

export default function DemandRateOutlookChart({ forecasts, onOpenDate }: Props) {
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const [selected, setSelected] = useState<string | null>(null);

  const days = useMemo(() => forecasts.slice(0, range), [forecasts, range]);

  const data = useMemo(() => days.map((d) => {
    const low = d.forecast_occupancy_low_pct ?? d.forecast_occupancy_pct;
    const high = d.forecast_occupancy_high_pct ?? d.forecast_occupancy_pct;
    const recMid = d.recommended_adr_min != null && d.recommended_adr_max != null
      ? (d.recommended_adr_min + d.recommended_adr_max) / 2
      : d.recommended_adr_min ?? null;
    return {
      ...d,
      label: shortDay(d.stay_date),
      bandLow: Math.round(low),
      bandSpan: Math.max(0, Math.round(high - low)),
      recommended_adr_mid: recMid == null ? null : Math.round(recMid),
      fill: DEMAND_COLOR[classOf(d)],
    };
  }), [days]);

  const detail = useMemo(
    () => days.find((d) => d.stay_date === selected) ?? null,
    [days, selected],
  );

  if (forecasts.length === 0) return null;

  const avgDemand = Math.round(days.reduce((s, d) => s + d.demand_score, 0) / (days.length || 1));
  const selloutDays = days.filter((d) => d.sellout_risk === "high" || d.sellout_risk === "sold_out").length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Demand and rate outlook</h3>
          <Tooltip>
            <TooltipTrigger aria-label="How the outlook is built">
              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              Bars are rooms already on the books. The shaded cone is the forecast range for final
              occupancy, widened when confidence is low. Lines show today&apos;s ADR and the recommended
              ADR for each arrival date. Bar colour reflects the demand score. Tap a day for detail.
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <Button
              key={r}
              size="sm"
              variant={range === r ? "default" : "outline"}
              className="h-8 px-2.5 text-xs"
              onClick={() => { setRange(r); setSelected(null); }}
            >
              {r}d
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        <span>Average demand score {avgDemand}/100</span>
        <span>·</span>
        <span>{selloutDays} day{selloutDays === 1 ? "" : "s"} forecast to close out</span>
      </div>

      <div className="h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
            onClick={(e) => {
              const p = (e as unknown as { activePayload?: { payload: { stay_date: string } }[] })?.activePayload?.[0];
              if (p) setSelected((cur) => (cur === p.payload.stay_date ? null : p.payload.stay_date));
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="label" tick={{ fontSize: 10 }} interval={Math.max(0, Math.floor(days.length / 12))}
              stroke="hsl(var(--muted-foreground))"
            />
            <YAxis
              yAxisId="occ" domain={[0, 100]} unit="%" tick={{ fontSize: 10 }}
              stroke="hsl(var(--muted-foreground))"
            />
            <YAxis
              yAxisId="rate" orientation="right" tick={{ fontSize: 10 }}
              stroke="hsl(var(--muted-foreground))" width={40}
            />
            <RTooltip
              contentStyle={{
                background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))",
                borderRadius: 8, fontSize: 12, color: "hsl(var(--popover-foreground))",
              }}
              formatter={(value: number | string, name: string) => {
                if (name === "Forecast range") return [`±${value}%`, name];
                if (name.includes("ADR")) return [eur(Number(value)), name];
                return [`${value}${name.includes("ccupancy") ? "%" : ""}`, name];
              }}
              labelFormatter={(l: string, payload) => {
                const p = payload?.[0]?.payload as { stay_date?: string } | undefined;
                return p?.stay_date ? longDay(p.stay_date) : l;
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine yAxisId="occ" y={100} stroke="hsl(var(--border))" />

            {/* forecast cone: invisible base + translucent span */}
            <Area yAxisId="occ" dataKey="bandLow" stackId="band" stroke="none" fill="transparent" legendType="none" name="Forecast base" />
            <Area
              yAxisId="occ" dataKey="bandSpan" stackId="band" stroke="none"
              fill="hsl(var(--primary) / 0.15)" name="Forecast range"
            />

            <Bar yAxisId="occ" dataKey="occupancy_pct" name="Occupancy on the books" radius={[3, 3, 0, 0]}
              // per-point colour comes from the row's `fill` field
              fill="hsl(var(--primary))" />
            <Line yAxisId="occ" type="monotone" dataKey="forecast_occupancy_pct" name="Forecast occupancy"
              stroke="hsl(var(--primary))" strokeWidth={2} strokeDasharray="4 3" dot={false} />
            <Line yAxisId="rate" type="monotone" dataKey="adr_eur" name="ADR"
              stroke="hsl(199 89% 48%)" strokeWidth={2} dot={false} connectNulls />
            <Line yAxisId="rate" type="monotone" dataKey="recommended_adr_mid" name="Recommended ADR"
              stroke="hsl(142 71% 40%)" strokeWidth={2} strokeDasharray="5 3" dot={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ------------------------------------------------------ drill-down */}
      {detail ? (
        <div className="rounded-md border p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">{longDay(detail.stay_date)}</div>
            <div className="flex items-center gap-1.5">
              <Badge variant="secondary" className="text-[10px] font-normal">
                Demand {detail.demand_score}/100
              </Badge>
              {detail.sellout_risk && (
                <Badge variant="outline" className="text-[10px] font-normal">
                  {RISK_LABEL[detail.sellout_risk] ?? detail.sellout_risk}
                </Badge>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <Cell label="On the books" value={`${Math.round(detail.occupancy_pct)}%`}
              sub={detail.rooms_sold != null ? `${detail.rooms_sold} of ${detail.rooms_available ?? "?"} rooms` : undefined} />
            <Cell label="Forecast" value={`${Math.round(detail.forecast_occupancy_pct)}%`}
              sub={detail.forecast_occupancy_low_pct != null
                ? `range ${Math.round(detail.forecast_occupancy_low_pct)}–${Math.round(detail.forecast_occupancy_high_pct ?? 0)}%`
                : undefined} />
            <Cell label="ADR now" value={detail.adr_eur != null ? eur(Math.round(detail.adr_eur)) : "—"}
              sub={detail.forecast_adr_eur != null ? `forecast ${eur(Math.round(detail.forecast_adr_eur))}` : undefined} />
            <Cell label="Recommended ADR"
              value={detail.recommended_adr_min != null
                ? `${eur(Math.round(detail.recommended_adr_min))}–${eur(Math.round(detail.recommended_adr_max ?? detail.recommended_adr_min))}`
                : "—"}
              sub={`confidence ${detail.confidence}%`} />
            <Cell label="Pickup 24h" value={String(detail.pickup_1d ?? 0)} sub={`7d ${detail.pickup_7d ?? 0}`} />
            <Cell label="Pace vs same weekday"
              value={detail.pace_variance_pct == null ? "—" : `${detail.pace_variance_pct > 0 ? "+" : ""}${Math.round(detail.pace_variance_pct)}%`}
              sub={detail.historical_pace_same_weekday != null ? `baseline ${detail.historical_pace_same_weekday} rooms` : undefined} />
            <Cell label="RevPAR" value={detail.revpar_eur != null ? eur(Math.round(detail.revpar_eur)) : "—"}
              sub={detail.forecast_revpar_eur != null ? `forecast ${eur(Math.round(detail.forecast_revpar_eur))}` : undefined} />
            <Cell label="Lead time" value={detail.lead_time_days != null ? `${detail.lead_time_days} days out` : "—"}
              sub={detail.rooms_remaining != null ? `${detail.rooms_remaining} rooms left` : undefined} />
          </div>

          {(detail.drivers ?? []).length > 0 && (
            <ul className="list-disc pl-4 text-[11px] text-muted-foreground">
              {detail.drivers!.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {onOpenDate && (
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onOpenDate(detail.stay_date)}>
                <TrendingUp className="mr-1.5 h-3.5 w-3.5" />Open in rate calendar
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setSelected(null)}>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">Tap any day in the chart to see its full forecast detail.</p>
      )}
    </div>
  );
}

function Cell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
