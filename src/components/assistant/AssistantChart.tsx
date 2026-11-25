import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, Table2 } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

export type AssistantChartSpec = {
  kind: "chart";
  chartType: "line" | "bar" | "area" | "pie";
  title: string;
  unit: string | null;
  categories: string[];
  series: { name: string; values: (number | null)[] }[];
};

export function isAssistantChart(value: unknown): value is AssistantChartSpec {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as any).kind === "chart" &&
    Array.isArray((value as any).categories) &&
    Array.isArray((value as any).series)
  );
}

// Fixed categorical order, validated for colour-vision separation on the light
// and the dark chart surface. A series keeps its slot; hues are never cycled.
const SERIES_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const SERIES_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];

function formatValue(value: unknown, unit: string | null): string {
  if (value === null || value === undefined || value === "") return "–";
  const n = Number(value);
  if (!Number.isFinite(n)) return "–";
  const text = n.toLocaleString("en-GB", { maximumFractionDigits: Math.abs(n) < 100 ? 1 : 0 });
  if (!unit) return text;
  if (unit === "€" || unit === "$" || unit === "£") return `${unit}${text}`;
  return unit === "%" ? `${text}%` : `${text} ${unit}`;
}

/** A chart the assistant drew from Hotel Care data, with a table view. */
export default function AssistantChart({ spec }: { spec: AssistantChartSpec }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const { resolvedTheme } = useTheme();
  const palette = resolvedTheme === "dark" ? SERIES_DARK : SERIES_LIGHT;
  const series = spec.series.slice(0, 6);
  const isPie = spec.chartType === "pie";

  const rows = useMemo(
    () =>
      spec.categories.map((category, index) => {
        const row: Record<string, string | number | null> = { category };
        series.forEach((s) => {
          row[s.name] = s.values[index] ?? null;
        });
        return row;
      }),
    [spec.categories, series],
  );
  const pieRows = useMemo(
    () =>
      isPie
        ? spec.categories
            .map((category, index) => ({ name: category, value: Number(series[0]?.values[index] ?? 0) }))
            .filter((row) => row.value > 0)
            .slice(0, 8)
        : [],
    [isPie, spec.categories, series],
  );

  const axisTick = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
  const tooltip = (
    <Tooltip
      formatter={(value: unknown, name: unknown) => [formatValue(value, spec.unit), String(name)]}
      cursor={{ stroke: "hsl(var(--border))", fill: "hsl(var(--muted))", fillOpacity: 0.4 }}
      contentStyle={{
        background: "hsl(var(--popover))",
        border: "1px solid hsl(var(--border))",
        borderRadius: 10,
        fontSize: 12,
        color: "hsl(var(--popover-foreground))",
      }}
      labelStyle={{ color: "hsl(var(--popover-foreground))", fontWeight: 600 }}
      itemStyle={{ color: "hsl(var(--popover-foreground))" }}
    />
  );
  const legend =
    series.length > 1 ? (
      <Legend
        iconType="circle"
        iconSize={8}
        wrapperStyle={{ fontSize: 12, paddingTop: 4 }}
        formatter={(value: string) => <span style={{ color: "hsl(var(--foreground))" }}>{value}</span>}
      />
    ) : null;
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="2 4" />
      <XAxis dataKey="category" tick={axisTick} tickLine={false} axisLine={false} minTickGap={16} />
      <YAxis
        tick={axisTick}
        tickLine={false}
        axisLine={false}
        width={48}
        // Bars and areas are read by their length, so they start at zero. A
        // line is read by its slope, so it may zoom in on the range.
        domain={spec.chartType === "line" ? ["auto", "auto"] : [0, "auto"]}
        tickFormatter={(value: number) => formatValue(value, spec.unit === "%" || spec.unit === "€" ? spec.unit : null)}
      />
    </>
  );
  const margin = { top: 8, right: 8, bottom: 0, left: 0 };

  return (
    <figure className="mt-3 w-full rounded-xl border bg-card p-3 text-card-foreground">
      <div className="mb-2 flex items-start justify-between gap-3">
        <figcaption className="text-sm font-semibold leading-snug">{spec.title || "Chart"}</figcaption>
        <div className="flex shrink-0 rounded-lg border p-0.5" role="group" aria-label="Chart or table view">
          {(["chart", "table"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={view === mode}
              aria-label={mode === "chart" ? "Show chart" : "Show data table"}
              onClick={() => setView(mode)}
              className={cn(
                "grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors",
                view === mode && "bg-muted text-foreground",
              )}
            >
              {mode === "chart" ? <BarChart3 className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />}
            </button>
          ))}
        </div>
      </div>

      {view === "table" ? (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-card text-muted-foreground">
              <tr>
                <th className="py-1.5 pr-3 font-medium"> </th>
                {series.map((s) => (
                  <th key={s.name} className="py-1.5 pr-3 text-right font-medium">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={String(row.category)} className="border-t">
                  <td className="py-1.5 pr-3">{row.category}</td>
                  {series.map((s) => (
                    <td key={s.name} className="py-1.5 pr-3 text-right tabular-nums">
                      {formatValue(row[s.name], spec.unit)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-64 w-full" role="img" aria-label={`${spec.title}. Switch to the table view for the values.`}>
          <ResponsiveContainer width="100%" height="100%">
            {isPie ? (
              <PieChart>
                {tooltip}
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 12 }}
                  formatter={(value: string) => <span style={{ color: "hsl(var(--foreground))" }}>{value}</span>}
                />
                <Pie
                  data={pieRows}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="52%"
                  outerRadius="82%"
                  paddingAngle={2}
                  stroke="hsl(var(--card))"
                  strokeWidth={2}
                  isAnimationActive={false}
                >
                  {pieRows.map((row, index) => (
                    <Cell key={row.name} fill={palette[index % palette.length]} />
                  ))}
                </Pie>
              </PieChart>
            ) : spec.chartType === "bar" ? (
              <BarChart data={rows} margin={margin} barGap={2} barCategoryGap="22%">
                {axes}
                {tooltip}
                {legend}
                {series.map((s, index) => (
                  <Bar key={s.name} dataKey={s.name} fill={palette[index]} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                ))}
              </BarChart>
            ) : spec.chartType === "area" ? (
              <AreaChart data={rows} margin={margin}>
                {axes}
                {tooltip}
                {legend}
                {series.map((s, index) => (
                  <Area
                    key={s.name}
                    type="monotone"
                    dataKey={s.name}
                    stroke={palette[index]}
                    strokeWidth={2}
                    fill={palette[index]}
                    fillOpacity={0.12}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
              </AreaChart>
            ) : (
              <LineChart data={rows} margin={margin}>
                {axes}
                {tooltip}
                {legend}
                {series.map((s, index) => (
                  <Line
                    key={s.name}
                    type="monotone"
                    dataKey={s.name}
                    stroke={palette[index]}
                    strokeWidth={2}
                    dot={rows.length <= 14 ? { r: 3, strokeWidth: 0, fill: palette[index] } : false}
                    activeDot={{ r: 5, stroke: "hsl(var(--card))", strokeWidth: 2 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">Drawn from Hotel Care data read for this answer.</p>
    </figure>
  );
}
