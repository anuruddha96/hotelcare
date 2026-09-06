import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export type CompetitorDetail = {
  competitor_id?: string;
  name?: string;
  rate_eur?: number | string | null;
  confidence?: number | string | null;
  captured_at?: string | null;
  source_page_url?: string | null;
};

export type MarketRow = {
  stay_date: string;
  active_competitor_count: number | string | null;
  observed_competitor_count: number | string | null;
  validated_competitor_count?: number | string | null;
  excluded_outlier_count?: number | string | null;
  average_rate_eur: number | string | null;
  median_rate_eur: number | string | null;
  min_rate_eur: number | string | null;
  max_rate_eur: number | string | null;
  raw_average_rate_eur?: number | string | null;
  freshest_captured_at: string | null;
  competitors: CompetitorDetail[] | null;
};

export type MarketSignalQuality = "none" | "low" | "medium" | "high";

export type MarketSignal = {
  referenceRate: number | null;
  active: number;
  observed: number;
  validated: number;
  excluded: number;
  confidencePct: number;
  quality: MarketSignalQuality;
  qualityLabel: string;
  coverageLabel: string;
};

const STYLE_ID = "hotelcare-competitor-pricing-grid-style";
const ROW_ATTR = "data-hc-competitor-pricing-row";

function numberOf(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
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

function freshnessScore(capturedAt: string | null | undefined, nowMs: number): number {
  if (!capturedAt) return 0.55;
  const capturedMs = Date.parse(capturedAt);
  if (!Number.isFinite(capturedMs)) return 0.55;
  const ageHours = Math.max(0, (nowMs - capturedMs) / 3_600_000);
  if (ageHours <= 6) return 1;
  if (ageHours <= 18) return 0.85;
  if (ageHours <= 30) return 0.65;
  return 0.25;
}

function agreementScore(row: MarketRow, validated: number): number {
  if (validated <= 1) return 0.35;
  const median = numberOf(row.median_rate_eur);
  const min = numberOf(row.min_rate_eur);
  const max = numberOf(row.max_rate_eur);
  if (median == null || median <= 0 || min == null || max == null || max < min) return 0.55;
  // A 0–20% market spread is strong agreement. By an 80% spread the quotes
  // are too dispersed to call the reference highly reliable.
  const relativeSpread = Math.max(0, (max - min) / median);
  return clamp01(1 - relativeSpread / 0.8);
}

/**
 * Convert the persisted competitor evidence into a manager-facing market signal.
 *
 * The reference rate is the validated median, not the arithmetic average. That
 * keeps a single expensive/cheap quote from pulling the visible market anchor.
 * Confidence deliberately combines four independent checks: comp-set coverage,
 * source confidence, quote freshness and cross-competitor agreement.
 */
export function marketSignalFor(row: MarketRow | undefined, nowMs = Date.now()): MarketSignal {
  if (!row) {
    return {
      referenceRate: null,
      active: 0,
      observed: 0,
      validated: 0,
      excluded: 0,
      confidencePct: 0,
      quality: "none",
      qualityLabel: "No data",
      coverageLabel: "no data",
    };
  }

  const active = Math.max(0, Math.round(numberOf(row.active_competitor_count) ?? 0));
  const observed = Math.max(0, Math.round(numberOf(row.observed_competitor_count) ?? 0));
  const details = Array.isArray(row.competitors) ? row.competitors : [];
  const validatedFromView = numberOf(row.validated_competitor_count);
  const validated = Math.max(0, Math.round(
    validatedFromView ?? (details.length > 0 ? details.length : observed),
  ));
  const excluded = Math.max(0, Math.round(
    numberOf(row.excluded_outlier_count) ?? Math.max(0, observed - validated),
  ));
  const referenceRate = numberOf(row.median_rate_eur) ?? numberOf(row.average_rate_eur);

  if (validated === 0 || referenceRate == null) {
    return {
      referenceRate: null,
      active,
      observed,
      validated,
      excluded,
      confidencePct: 0,
      quality: "none",
      qualityLabel: "No validated market data",
      coverageLabel: active > 0 ? `0/${active}` : "no data",
    };
  }

  const coverage = active > 0 ? clamp01(validated / active) : Math.min(0.75, validated / 4);
  const confidenceValues = details
    .map((detail) => numberOf(detail.confidence))
    .filter((value): value is number => value != null)
    .map(clamp01);
  // Reconciled rows without a model confidence are still usable, but they do
  // not deserve the same certainty as an explicitly high-confidence quote.
  const sourceConfidence = confidenceValues.length
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : 0.65;
  const freshness = freshnessScore(row.freshest_captured_at, nowMs);
  const agreement = agreementScore(row, validated);

  const confidence = clamp01(
    coverage * 0.45
      + sourceConfidence * 0.20
      + freshness * 0.20
      + agreement * 0.15,
  );
  const confidencePct = Math.round(confidence * 100);

  let quality: MarketSignalQuality;
  let qualityLabel: string;
  if (validated < 2 || confidencePct < 45) {
    quality = "low";
    qualityLabel = "Low confidence";
  } else if (confidencePct < 75) {
    quality = "medium";
    qualityLabel = "Medium confidence";
  } else {
    quality = "high";
    qualityLabel = "High confidence";
  }

  return {
    referenceRate,
    active,
    observed,
    validated,
    excluded,
    confidencePct,
    quality,
    qualityLabel,
    coverageLabel: active > 0 ? `${validated}/${active}` : `${validated} comps`,
  };
}

export function tooltipFor(
  date: string,
  row: MarketRow | undefined,
  demandTitle?: string | null,
  nowMs = Date.now(),
): string {
  const signal = marketSignalFor(row, nowMs);
  const lines: string[] = [];

  if (demandTitle) lines.push(demandTitle.trim());
  else lines.push(`${date} · Hotel Care demand grade`);

  lines.push("");
  if (!row || signal.referenceRate == null) {
    lines.push("Market reference: no fresh validated competitor rate yet.");
  } else {
    lines.push(`Market reference ${euro(signal.referenceRate)} · ${signal.qualityLabel} (${signal.confidencePct}%)`);
    lines.push(`${signal.validated}/${signal.active || signal.validated} active competitors validated${signal.excluded > 0 ? ` · ${signal.excluded} statistical outlier${signal.excluded === 1 ? "" : "s"} excluded` : ""}`);
    lines.push(`Validated range ${euro(row.min_rate_eur)}–${euro(row.max_rate_eur)} · arithmetic average ${euro(row.average_rate_eur)}`);

    const details = Array.isArray(row.competitors) ? row.competitors : [];
    if (details.length) {
      lines.push("", "Validated competitor quotes:");
      for (const detail of details) {
        const confidence = numberOf(detail.confidence);
        const confidenceText = confidence == null ? "" : ` · ${Math.round(clamp01(confidence) * 100)}% source confidence`;
        lines.push(`• ${detail.name || "Competitor"}: ${euro(detail.rate_eur)}${confidenceText}`);
      }
    }
  }

  lines.push(
    "",
    "How Hotel Care treats market evidence:",
    "• comparable public standard-double price, 2 adults / 1 night",
    "• EUR only — no silent currency conversion",
    "• fresh reconciled quotes only (up to 30 hours old)",
    "• statistical outliers excluded before the reference is calculated",
    "• the visible reference uses the validated median, not a blind average",
    "",
    "Market price pressure is not the same as city occupancy. The first line is Hotel Care's property demand grade from your own pickup, pace and inventory pressure; the second line adds external market-price context.",
  );
  return lines.join("\n");
}

export function competitorGridStyleText(): string {
  return `
    [${ROW_ATTR}="1"] > div:first-child {
      position: sticky !important;
      left: 0 !important;
      z-index: 40 !important;
      background: hsl(var(--card)) !important;
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
    }
    [${ROW_ATTR}="1"] > button::before {
      content: attr(data-hc-demand-label);
      color: inherit;
      font-size: 9.5px;
      line-height: 10px;
      font-weight: 700;
      white-space: nowrap;
    }
    [${ROW_ATTR}="1"] > button::after {
      content: attr(data-hc-market-summary);
      color: inherit;
      font-size: 8px;
      line-height: 9px;
      font-weight: 600;
      opacity: .82;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    [${ROW_ATTR}="1"] > button[data-hc-market-quality="low"] {
      box-shadow: inset 0 -2px 0 hsl(var(--destructive) / .75);
    }
    [${ROW_ATTR}="1"] > button[data-hc-market-quality="medium"] {
      box-shadow: inset 0 -2px 0 hsl(var(--warning, 38 92% 50%) / .8);
    }
    [${ROW_ATTR}="1"] > button[data-hc-market-quality="high"] {
      box-shadow: inset 0 -2px 0 hsl(var(--primary) / .8);
    }
  `;
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = competitorGridStyleText();
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
    return row;
  }
  return null;
}

/**
 * Compatibility bridge for the large Previo-style pricing calendar.
 *
 * The React grid still owns its real demand row. This bridge no longer replaces
 * that demand information: it keeps the demand band as the first line and adds a
 * robust, confidence-labelled competitor reference as the second line. This is
 * intentionally a presentation bridge so the pricing/editing grid remains low
 * risk while managers get both internal demand and external market context.
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
          .select("stay_date,active_competitor_count,observed_competitor_count,validated_competitor_count,excluded_outlier_count,average_rate_eur,median_rate_eur,min_rate_eur,max_rate_eur,raw_average_rate_eur,freshest_captured_at,competitors")
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
      label.dataset.hcMarketLabel = railed ? "D/M" : "Demand + market";
      label.title = "Demand is Hotel Care's property-level demand grade from your own booking pace, pickup and inventory pressure. Market is a robust median of fresh validated competitor prices. The two are shown together because competitor price is useful context, but it is not the same thing as market occupancy or demand.";

      const grid = row.parentElement;
      if (!grid) return;
      const dateNodes = Array.from(grid.querySelectorAll<HTMLElement>("button[data-date]"));
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

        // Capture React's genuine demand presentation exactly once before we
        // decorate it. textContent remains available even after CSS shrinks the
        // original text node to zero, so re-renders can still be detected.
        const liveDemandLabel = (cell.textContent ?? "").replace(/\s+/g, " ").trim() || "·";
        const originalTitle = cell.title;
        if (!cell.dataset.hcDemandLabel || (liveDemandLabel !== "·" && liveDemandLabel !== cell.dataset.hcDemandLabel)) {
          cell.dataset.hcDemandLabel = liveDemandLabel;
        }
        if (!cell.dataset.hcDemandTitle || (originalTitle && !originalTitle.includes("How Hotel Care treats market evidence:"))) {
          cell.dataset.hcDemandTitle = originalTitle;
        }

        const market = marketRef.current.get(date);
        const signal = marketSignalFor(market);
        cell.dataset.hcMarketCell = "1";
        cell.dataset.hcMarketQuality = signal.quality;
        cell.dataset.hcMarketSummary = signal.referenceRate == null
          ? "Mkt —"
          : `${euro(signal.referenceRate)} · ${signal.coverageLabel}`;
        cell.dataset.hcMarketConfidence = signal.qualityLabel;
        cell.title = tooltipFor(date, market, cell.dataset.hcDemandTitle);
        cell.setAttribute(
          "aria-label",
          signal.referenceRate == null
            ? `${date}: demand ${cell.dataset.hcDemandLabel || "not available"}; no validated market reference`
            : `${date}: demand ${cell.dataset.hcDemandLabel || "not available"}; market reference ${euro(signal.referenceRate)}, ${signal.qualityLabel.toLowerCase()}, ${signal.coverageLabel} competitors validated`,
        );
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
