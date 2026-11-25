import { bandOf, type DemandBand } from "@/lib/demandScore";

export interface MarketDemandMetric {
  date: string;
  totalRooms: number;
  roomsSold: number;
  propertiesReporting: number;
  propertiesOver80: number;
  propertiesOver90: number;
  propertiesLowInventory: number;
  propertiesSoldOut: number;
  pickup48h: number;
  pickup7d: number;
  eventImpacts?: string[];
}

export interface MarketDemandDay {
  date: string;
  score: number;
  band: DemandBand;
  drivers: string[];
  occupancyPct: number;
  propertiesReporting: number;
}

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

function eventAdjustment(impacts: string[] = []): number {
  const ranked = [...impacts]
    .map((raw) => raw.toLowerCase().replace(/[_-]+/g, " "))
    .map((impact) => {
      if (impact.includes("very")) return 8;
      if (impact.includes("high")) return 5;
      if (impact.includes("medium")) return 3;
      if (impact.includes("negative")) return -5;
      if (impact.includes("low")) return 0;
      return 1;
    })
    .sort((a, b) => Math.abs(b) - Math.abs(a))
    .slice(0, 4);
  return clamp(ranked.reduce((sum, value) => sum + value, 0), -10, 15);
}

/**
 * Turns privacy-safe, cross-property market aggregates into one demand grade.
 * The same aggregate always produces the same grade, regardless of tenant.
 */
export function scoreMarketDemand(metric: MarketDemandMetric, today: string): MarketDemandDay {
  const rooms = Math.max(0, metric.totalRooms || 0);
  const reporting = Math.max(0, metric.propertiesReporting || 0);
  const sold = clamp(metric.roomsSold || 0, 0, rooms || Number.MAX_SAFE_INTEGER);
  const occupancy = rooms > 0 ? (sold / rooms) * 100 : 0;
  const share80 = reporting > 0 ? metric.propertiesOver80 / reporting : 0;
  const share90 = reporting > 0 ? metric.propertiesOver90 / reporting : 0;
  const shareLow = reporting > 0 ? metric.propertiesLowInventory / reporting : 0;
  const shareSoldOut = reporting > 0 ? metric.propertiesSoldOut / reporting : 0;

  const pressure = rooms > 0 ? clamp((occupancy - 30) * 1.45) : 50;
  const breadth = reporting > 0 ? clamp((share80 * 0.70 + share90 * 0.30) * 100) : 50;
  const pickup48Share = rooms > 0 ? Math.max(0, metric.pickup48h) / rooms : 0;
  const pickup7Share = rooms > 0 ? Math.max(0, metric.pickup7d) / rooms : 0;
  const pickup = rooms > 0 ? clamp(35 + pickup48Share * 900 + pickup7Share * 280) : 50;

  const leadDays = Math.max(0, Math.round((Date.parse(`${metric.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000));
  const advancePressure = rooms > 0
    ? clamp(occupancy + Math.min(90, leadDays) * Math.max(0, occupancy - 55) / 180)
    : 50;
  const scarcity = reporting > 0 ? clamp((shareLow * 0.65 + shareSoldOut * 0.35) * 100) : 50;

  let score = pressure * 0.30
    + breadth * 0.25
    + pickup * 0.20
    + advancePressure * 0.15
    + scarcity * 0.10
    + eventAdjustment(metric.eventImpacts);

  // One compressed property must not label all Budapest as very high demand.
  if (reporting >= 3 && share80 < 0.34) score = Math.min(score, 69);
  if (reporting >= 3 && share90 < 0.34) score = Math.min(score, 84);
  score = Math.round(clamp(score));

  const drivers = [
    `Budapest portfolio occupancy ${Math.round(occupancy)}%`,
    `${metric.propertiesOver80}/${reporting} properties above 80%`,
    `+${Math.max(0, metric.pickup48h)} rooms picked up in 48h`,
    `+${Math.max(0, metric.pickup7d)} rooms picked up in 7d`,
  ];
  if (metric.propertiesSoldOut > 0) drivers.push(`${metric.propertiesSoldOut} propert${metric.propertiesSoldOut === 1 ? "y" : "ies"} sold out`);
  if ((metric.eventImpacts?.length ?? 0) > 0) drivers.push(`${metric.eventImpacts!.length} market event signal(s)`);

  return {
    date: metric.date,
    score,
    band: bandOf(score),
    drivers,
    occupancyPct: Math.round(occupancy * 10) / 10,
    propertiesReporting: reporting,
  };
}

export function buildMarketDemandBoard(metrics: MarketDemandMetric[], today: string): MarketDemandDay[] {
  return metrics.map((metric) => scoreMarketDemand(metric, today));
}
