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

const marketDemandCss = `
  [data-market-demand-band="very_strong"] { background: rgb(239 68 68) !important; color: white !important; }
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
        `${date} · Budapest market demand ${label} (${day.score}/100)`,
        ...day.drivers,
        "Shared signal across participating Budapest properties; raw hotel data is not exposed.",
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

function clearMarketDemand() {
  document.querySelectorAll<HTMLElement>("[data-market-demand-band]").forEach((cell) => {
    delete cell.dataset.marketDemandBand;
    delete cell.dataset.marketDemandScore;
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

  const render = () => {
    frame = null;
    if (available) applyMarketDemand(board);
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
  const routeTimer = window.setInterval(() => { void load(); }, 1200);
  window.addEventListener("popstate", load);
  void load();

  return () => {
    disposed = true;
    observer.disconnect();
    window.clearInterval(routeTimer);
    window.removeEventListener("popstate", load);
    if (frame !== null) window.cancelAnimationFrame(frame);
    clearMarketDemand();
  };
}
