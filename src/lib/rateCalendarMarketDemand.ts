import { supabase } from "@/integrations/supabase/client";
import { buildMarketDemandBoard, type MarketDemandDay, type MarketDemandMetric } from "@/lib/marketDemand";
import { budapestToday } from "@/lib/revenueAnalytics";

const GRID_CARD = '[data-training="revenue-grid"]';
const STYLE_ID = "rate-calendar-market-demand-style";
const HORIZON_DAYS = 210;
const RETRY_MS = 30_000;

const LABEL: Record<MarketDemandDay["band"], string> = {
  very_strong: "V.High",
  strong: "High",
  normal: "Med",
  soft: "Low",
  weak: "Low",
};

import { priceSignalCellLabel, priceSignalTitle, type PriceSignalRow } from "@/lib/revenue/priceSignal";

const SIGNAL_REFRESH_MS = 5 * 60_000;

const marketDemandCss = `
  [data-hc-competitor-pricing-row="1"] { min-height: 30px !important; align-items: stretch !important; }
  [data-price-signal-band="surge"] { background: rgb(185 28 28) !important; color: white !important; }
  [data-price-signal-band="strong"] { background: rgb(249 115 22) !important; color: rgb(67 20 7) !important; }
  [data-price-signal-band="on_pace"] { background: hsl(var(--muted)) !important; color: hsl(var(--foreground)) !important; }
  [data-price-signal-band="soft"] { background: rgb(186 230 253) !important; color: rgb(12 74 110) !important; }
  [data-price-signal-band="weak"] { background: rgb(59 130 246) !important; color: rgb(8 23 47) !important; }
  [data-hc-competitor-pricing-row="1"] > * { min-height: 30px !important; height: auto !important; align-self: stretch !important; }
  [data-market-demand-band="very_strong"] { background: rgb(239 68 68) !important; color: rgb(45 8 8) !important; }
  [data-market-demand-band="strong"] { background: rgb(253 186 116) !important; color: rgb(67 20 7) !important; }
  [data-market-demand-band="normal"] { background: rgb(254 243 199) !important; color: rgb(69 26 3) !important; }
  [data-market-demand-band="soft"] { background: rgb(224 242 254) !important; color: rgb(12 74 110) !important; }
  [data-market-demand-band="weak"] { background: hsl(var(--muted)) !important; color: hsl(var(--muted-foreground)) !important; }
`;

function routeHotelId(): string | null {
  const match = /^\/[^/]+\/revenue\/([^/?#]+)/.exec(window.location.pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = marketDemandCss;
  document.head.appendChild(style);
}

function findDemandRow(card: HTMLElement): HTMLElement | null {
  const pane = card.querySelector<HTMLElement>('[data-rate-grid-scroll="true"]')
    ?? card.querySelector<HTMLElement>(".relative.overflow-auto.overscroll-x-contain");
  const grid = pane?.firstElementChild as HTMLElement | null;
  const sticky = grid
    ? Array.from(grid.children).find((child) => child instanceof HTMLElement && child.classList.contains("sticky") && child.classList.contains("top-0")) as HTMLElement | undefined
    : undefined;
  if (!sticky) return null;

  return Array.from(sticky.children).find((child) => {
    if (!(child instanceof HTMLElement)) return false;
    const left = child.firstElementChild as HTMLElement | null;
    const label = (left?.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    return label === "dem" || label.startsWith("demand");
  }) as HTMLElement | null;
}

function dateOrder(card: HTMLElement): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  card.querySelectorAll<HTMLElement>("button[data-date]").forEach((button) => {
    const date = button.dataset.date;
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !seen.has(date)) {
      seen.add(date);
      out.push(date);
    }
  });
  return out;
}

function applyMarketDemand(board: Map<string, MarketDemandDay>) {
  document.querySelectorAll<HTMLElement>(GRID_CARD).forEach((card) => {
    const row = findDemandRow(card);
    if (!row) return;
    const dates = dateOrder(card);
    const cells = Array.from(row.children).slice(1).filter((child): child is HTMLElement => child instanceof HTMLElement);

    cells.forEach((cell, index) => {
      const date = dates[index];
      const day = date ? board.get(date) : undefined;
      if (!day) return;
      const label = LABEL[day.band];
      const title = [
        `${date} · Rate Scanner · Budapest ${label} (${day.score}/100)`,
        ...day.drivers,
        "Shared Budapest demand signal across participating RD Hotels and SLNT venues; raw hotel data is not exposed.",
      ].join("\n");

      // Avoid a MutationObserver/render loop: only touch the DOM when a value
      // actually changed underneath us during a React calendar refresh.
      if (cell.dataset.marketDemandBand !== day.band) cell.dataset.marketDemandBand = day.band;
      if (cell.dataset.marketDemandScore !== String(day.score)) cell.dataset.marketDemandScore = String(day.score);
      if ((cell.textContent ?? "").trim() !== label) cell.textContent = label;
      if (cell.getAttribute("title") !== title) cell.setAttribute("title", title);
      const aria = title.replace(/\n/g, ". ");
      if (cell.getAttribute("aria-label") !== aria) cell.setAttribute("aria-label", aria);
    });
  });
}

function applyPriceSignals(signals: Map<string, PriceSignalRow>, board: Map<string, MarketDemandDay>, marketAvailable: boolean) {
  document.querySelectorAll<HTMLElement>(GRID_CARD).forEach((card) => {
    const row = findDemandRow(card);
    if (!row) return;
    const dates = dateOrder(card);
    const cells = Array.from(row.children).slice(1).filter((child): child is HTMLElement => child instanceof HTMLElement);
    cells.forEach((cell, index) => {
      const date = dates[index];
      const signal = date ? signals.get(date) : undefined;
      if (!signal) {
        // Past or unscored dates keep the shared market grade when it exists.
        if (cell.dataset.priceSignalBand) { delete cell.dataset.priceSignalBand; delete cell.dataset.priceSignalScore; }
        const day = date && marketAvailable ? board.get(date) : undefined;
        if (!day) return;
        const label = LABEL[day.band];
        if (cell.dataset.marketDemandBand !== day.band) cell.dataset.marketDemandBand = day.band;
        if ((cell.textContent ?? "").trim() !== label) cell.textContent = label;
        return;
      }
      const label = priceSignalCellLabel(signal);
      const title = priceSignalTitle(signal);
      if (cell.dataset.marketDemandBand) { delete cell.dataset.marketDemandBand; delete cell.dataset.marketDemandScore; }
      if (cell.dataset.priceSignalBand !== signal.band) cell.dataset.priceSignalBand = signal.band;
      if (cell.dataset.priceSignalScore !== String(signal.score)) cell.dataset.priceSignalScore = String(signal.score);
      // The competitor bridge mirrors textContent into its visible first line
      // and merges the title with the market evidence, so both are set here.
      if ((cell.textContent ?? "").trim() !== label) cell.textContent = label;
      if (cell.dataset.hcDemandLabel !== label) cell.dataset.hcDemandLabel = label;
      if (cell.dataset.hcDemandTitle !== title) cell.dataset.hcDemandTitle = title;
      if (!(cell.getAttribute("title") ?? "").startsWith(title.split("\n")[0])) cell.setAttribute("title", title);
      const aria = title.replace(/\n/g, ". ");
      if (cell.getAttribute("aria-label") !== aria) cell.setAttribute("aria-label", aria);
    });
  });
}

function clearMarketDemand() {
  document.querySelectorAll<HTMLElement>("[data-market-demand-band],[data-price-signal-band]").forEach((cell) => {
    delete cell.dataset.marketDemandBand;
    delete cell.dataset.marketDemandScore;
    delete cell.dataset.priceSignalBand;
    delete cell.dataset.priceSignalScore;
  });
}

type RpcPayload = {
  available?: boolean;
  marketCity?: string;
  marketCountry?: string;
  propertiesReporting?: number;
  days?: MarketDemandMetric[];
};

/**
 * Applies the privacy-safe shared market signal over the existing Demand row.
 * If the market aggregate is unavailable, the React-owned local signal is left
 * untouched so missing data can never manufacture a false city-level grade.
 */
export function installRateCalendarMarketDemand() {
  ensureStyle();
  let disposed = false;
  let currentHotel: string | null = null;
  let board = new Map<string, MarketDemandDay>();
  let available = false;
  let loadingFor: string | null = null;
  let lastAttemptAt = 0;
  let frame: number | null = null;
  let signals = new Map<string, PriceSignalRow>();
  let signalsHotel: string | null = null;
  let signalsLoadedAt = 0;
  let signalsLoading = false;

  const render = () => {
    frame = null;
    if (signals.size > 0) applyPriceSignals(signals, board, available);
    else if (available) applyMarketDemand(board);
  };

  // The hotel's own Price Signal takes precedence over the shared market grade.
  const loadSignals = async () => {
    const hotelId = routeHotelId();
    if (!hotelId) { signals = new Map(); signalsHotel = null; return; }
    if (signalsLoading) return;
    if (hotelId === signalsHotel && Date.now() - signalsLoadedAt < SIGNAL_REFRESH_MS) return;
    signalsLoading = true;
    try {
      const from = budapestToday();
      const to = new Date(`${from}T00:00:00Z`);
      to.setUTCDate(to.getUTCDate() + HORIZON_DAYS);
      const { data, error } = await (supabase as any).rpc("revenue_price_signals", {
        p_hotel_id: hotelId, p_from: from, p_to: to.toISOString().slice(0, 10),
      });
      if (error) throw error;
      if (disposed || routeHotelId() !== hotelId) return;
      if (hotelId !== signalsHotel) clearMarketDemand();
      signalsHotel = hotelId;
      signalsLoadedAt = Date.now();
      signals = new Map(((data ?? []) as PriceSignalRow[]).map((row) => [row.stay_date, row]));
      scheduleRender();
    } catch (error) {
      console.warn("[price-signal] unavailable, using market demand", error);
      if (hotelId !== signalsHotel) { signals = new Map(); signalsHotel = hotelId; }
      signalsLoadedAt = Date.now();
    } finally {
      signalsLoading = false;
    }
  };
  const scheduleRender = () => {
    if (frame !== null) return;
    frame = window.requestAnimationFrame(render);
  };

  const load = async () => {
    const hotelId = routeHotelId();
    if (!hotelId) {
      currentHotel = null;
      available = false;
      board = new Map();
      clearMarketDemand();
      return;
    }

    if (hotelId === currentHotel && available) {
      scheduleRender();
      return;
    }
    if (loadingFor === hotelId) return;
    if (hotelId === currentHotel && Date.now() - lastAttemptAt < RETRY_MS) return;

    if (hotelId !== currentHotel) {
      clearMarketDemand();
      board = new Map();
      available = false;
    }
    currentHotel = hotelId;
    loadingFor = hotelId;
    lastAttemptAt = Date.now();

    try {
      const { data, error } = await (supabase as any).rpc("get_market_demand_index", {
        _hotel_id: hotelId,
        _horizon_days: HORIZON_DAYS,
      });
      if (error) throw error;
      if (disposed || routeHotelId() !== hotelId) return;

      const payload = (data ?? {}) as RpcPayload;
      available = payload.available === true && (payload.propertiesReporting ?? 0) >= 3;
      board = available
        ? new Map(buildMarketDemandBoard(payload.days ?? [], budapestToday()).map((day) => [day.date, day]))
        : new Map();
      if (!available) clearMarketDemand();
      scheduleRender();
    } catch (error) {
      console.warn("[market-demand] using local demand fallback", error);
      available = false;
      board = new Map();
      clearMarketDemand();
    } finally {
      if (loadingFor === hotelId) loadingFor = null;
    }
  };

  const observer = new MutationObserver(() => scheduleRender());
  observer.observe(document.body, { childList: true, subtree: true });
  const routeTimer = window.setInterval(() => { void load(); void loadSignals(); }, 1200);
  window.addEventListener("popstate", load);
  window.addEventListener("focus", () => { signalsLoadedAt = 0; void loadSignals(); });
  void load();
  void loadSignals();

  return () => {
    disposed = true;
    observer.disconnect();
    window.clearInterval(routeTimer);
    window.removeEventListener("popstate", load);
    if (frame !== null) window.cancelAnimationFrame(frame);
    clearMarketDemand();
  };
}
