import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

type CompetitorDetail = {
  competitor_id?: string;
  name?: string;
  rate_eur?: number | string | null;
  confidence?: number | string | null;
  captured_at?: string | null;
  source_page_url?: string | null;
};

type MarketRow = {
  stay_date: string;
  active_competitor_count: number | string | null;
  observed_competitor_count: number | string | null;
  average_rate_eur: number | string | null;
  median_rate_eur: number | string | null;
  min_rate_eur: number | string | null;
  max_rate_eur: number | string | null;
  freshest_captured_at: string | null;
  competitors: CompetitorDetail[] | null;
};

const STYLE_ID = "hotelcare-competitor-pricing-grid-style";
const ROW_ATTR = "data-hc-competitor-pricing-row";

function numberOf(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function euro(value: unknown): string {
  const n = numberOf(value);
  return n == null ? "—" : `€${Math.round(n)}`;
}

function hotelFromPath(): string | null {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const revenue = parts.findIndex((part) => part === "revenue");
  if (revenue < 0 || !parts[revenue + 1]) return null;
  return decodeURIComponent(parts[revenue + 1]);
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    [${ROW_ATTR}="1"] > div:first-child {
      position: relative;
      font-size: 0 !important;
      color: transparent !important;
    }
    [${ROW_ATTR}="1"] > div:first-child > * { display: none !important; }
    [${ROW_ATTR}="1"] > div:first-child::before {
      content: attr(data-hc-market-label);
      color: hsl(var(--foreground));
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    [${ROW_ATTR}="1"] > button {
      position: relative;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 1px !important;
      font-size: 0 !important;
      color: transparent !important;
      background: hsl(var(--card)) !important;
    }
    [${ROW_ATTR}="1"] > button > * { display: none !important; }
    [${ROW_ATTR}="1"] > button::before {
      content: attr(data-hc-market-rate);
      color: hsl(var(--foreground));
      font-size: 10px;
      line-height: 11px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    [${ROW_ATTR}="1"] > button::after {
      content: attr(data-hc-market-coverage);
      color: hsl(var(--muted-foreground));
      font-size: 8px;
      line-height: 9px;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }
    [${ROW_ATTR}="1"] > button[data-hc-market-quality="none"] {
      background: hsl(var(--muted) / .32) !important;
    }
    [${ROW_ATTR}="1"] > button[data-hc-market-quality="low"] {
      background: hsl(var(--warning, 38 92% 50%) / .12) !important;
    }
    [${ROW_ATTR}="1"] > button[data-hc-market-quality="partial"] {
      background: hsl(var(--primary) / .055) !important;
    }
    [${ROW_ATTR}="1"] > button[data-hc-market-quality="good"] {
      background: hsl(var(--primary) / .10) !important;
    }
  `;
  document.head.appendChild(style);
}

function findDemandRow(): HTMLElement | null {
  const existing = document.querySelector<HTMLElement>(`[${ROW_ATTR}="1"]`);
  if (existing?.isConnected) return existing;

  const labels = Array.from(document.querySelectorAll<HTMLElement>("div.sticky.left-0"));
  for (const label of labels) {
    const text = (label.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!(text === "Demand" || text === "Dem" || text.startsWith("Demand "))) continue;
    const row = label.parentElement as HTMLElement | null;
    if (!row || !row.classList.contains("flex")) continue;
    row.setAttribute(ROW_ATTR, "1");
    // The old demand buttons open an unrelated demand dialog. Market cells are
    // read-only reference data, so stop that delegated React click while this
    // row is acting as the competitor-price row.
    row.addEventListener("click", (event) => {
      if ((event.target as HTMLElement | null)?.closest("button[data-hc-market-cell='1']")) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
    return row;
  }
  return null;
}

function tooltipFor(date: string, row: MarketRow | undefined): string {
  if (!row) return `${date} · no fresh competitor prices yet`;
  const active = numberOf(row.active_competitor_count) ?? 0;
  const observed = numberOf(row.observed_competitor_count) ?? 0;
  const lines = [
    `${date} · competitor market average ${euro(row.average_rate_eur)}`,
    `Median ${euro(row.median_rate_eur)} · range ${euro(row.min_rate_eur)}–${euro(row.max_rate_eur)}`,
    `${observed}/${active} active competitors have a fresh verified EUR rate`,
  ];
  const details = Array.isArray(row.competitors) ? row.competitors : [];
  if (details.length) {
    lines.push("", "Competitors:");
    for (const detail of details) {
      lines.push(`• ${detail.name || "Competitor"}: ${euro(detail.rate_eur)}`);
    }
  }
  lines.push("", "The calendar shows the arithmetic average. Pricing automation keeps using the safer validated market median/outlier guard rather than blindly matching this number.");
  return lines.join("\n");
}

/**
 * Lightweight bridge for the existing large Previo-style calendar.
 *
 * The revenue grid is deliberately left untouched structurally: this component
 * replaces only its legacy Demand presentation at runtime, which avoids a risky
 * rewrite of the pricing/editing grid. The actual market data comes from the
 * RLS-protected revenue_competitor_market_daily view. A future grid refactor can
 * consume the same view directly without changing the data contract.
 */
export default function CompetitorPricingGridBridge() {
  const marketRef = useRef<Map<string, MarketRow>>(new Map());
  const hotelRef = useRef<string | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    ensureStyle();

    const load = async (hotelId: string) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      try {
        const today = new Date().toISOString().slice(0, 10);
        const end = new Date();
        end.setUTCDate(end.getUTCDate() + 366);
        const endIso = end.toISOString().slice(0, 10);
        const { data, error } = await (supabase as any)
          .from("revenue_competitor_market_daily")
          .select("stay_date,active_competitor_count,observed_competitor_count,average_rate_eur,median_rate_eur,min_rate_eur,max_rate_eur,freshest_captured_at,competitors")
          .eq("hotel_id", hotelId)
          .gte("stay_date", today)
          .lte("stay_date", endIso)
          .order("stay_date");
        if (error) throw error;
        if (cancelled) return;
        marketRef.current = new Map(((data ?? []) as MarketRow[]).map((row) => [row.stay_date, row]));
      } catch (error) {
        console.warn("competitor market row unavailable", error);
      } finally {
        loadingRef.current = false;
      }
    };

    const decorate = () => {
      const hotelId = hotelFromPath();
      if (!hotelId) return;
      if (hotelRef.current !== hotelId) {
        hotelRef.current = hotelId;
        marketRef.current = new Map();
        void load(hotelId);
      }

      const row = findDemandRow();
      if (!row) return;
      const label = row.firstElementChild as HTMLElement | null;
      if (!label) return;
      const railed = label.getBoundingClientRect().width < 70;
      label.dataset.hcMarketLabel = railed ? "Mkt" : "Market avg";
      label.title = "Average public competitor price for 2 adults / 1 night from the active Hotel Authority comp set. Hover a date to see every available competitor quote and the validated median.";

      const sticky = row.parentElement;
      if (!sticky) return;
      const dateNodes = Array.from(sticky.querySelectorAll<HTMLElement>("button[data-date]"));
      const dates: string[] = [];
      for (const node of dateNodes) {
        const d = node.dataset.date;
        if (d && !dates.includes(d)) dates.push(d);
      }
      const cells = Array.from(row.children).slice(1) as HTMLElement[];
      for (let i = 0; i < cells.length; i += 1) {
        const cell = cells[i];
        const date = dates[i];
        if (!date) continue;
        const market = marketRef.current.get(date);
        const active = numberOf(market?.active_competitor_count) ?? 0;
        const observed = numberOf(market?.observed_competitor_count) ?? 0;
        const average = numberOf(market?.average_rate_eur);
        cell.dataset.hcMarketCell = "1";
        cell.dataset.hcMarketRate = average == null ? "—" : `€${Math.round(average)}`;
        cell.dataset.hcMarketCoverage = active > 0 ? `${observed}/${active}` : observed > 0 ? `${observed} comps` : "no data";
        cell.dataset.hcMarketQuality = observed === 0
          ? "none"
          : observed < 2
            ? "low"
            : active > 0 && observed < Math.ceil(active / 2)
              ? "partial"
              : "good";
        cell.title = tooltipFor(date, market);
        cell.setAttribute("aria-label", market
          ? `${date}: competitor average ${euro(market.average_rate_eur)}, ${observed} of ${active} competitors`
          : `${date}: no fresh competitor pricing`);
      }
    };

    const tick = window.setInterval(decorate, 850);
    const refresh = window.setInterval(() => {
      const hotelId = hotelFromPath();
      if (hotelId) void load(hotelId);
    }, 5 * 60_000);
    const onFocus = () => {
      const hotelId = hotelFromPath();
      if (hotelId) void load(hotelId);
      decorate();
    };
    window.addEventListener("focus", onFocus);
    decorate();

    return () => {
      cancelled = true;
      window.clearInterval(tick);
      window.clearInterval(refresh);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return null;
}
