/** Hotel-level Price Signal (revenue_price_signals RPC): one date, one score. */
export type PriceSignalRow = {
  stay_date: string;
  days_out: number;
  score: number;
  band: "surge" | "strong" | "on_pace" | "soft" | "weak";
  action: "raise" | "hold" | "lower";
  occupancy_pct: number | string | null;
  pace_target_pct: number | string | null;
  rooms_remaining: number | null;
  pickup_24h: number | null;
  pickup_7d: number | null;
  reference_price: number | string | null;
  market_median: number | string | null;
  event_title: string | null;
  event_impact: string | null;
  engine_direction: string | null;
  engine_reason: string | null;
  engine_at: string | null;
  drivers: string[] | null;
};

const SIGNAL_LABEL: Record<PriceSignalRow["band"], string> = {
  surge: "Surge", strong: "Strong", on_pace: "On pace", soft: "Soft", weak: "Weak",
};
const SIGNAL_ARROW: Record<PriceSignalRow["action"], string> = { raise: "▲", hold: "●", lower: "▼" };

/** What the manager sees in the cell: arrow + score, e.g. "▲ 78". */
export function priceSignalCellLabel(row: Pick<PriceSignalRow, "score" | "action">): string {
  return `${SIGNAL_ARROW[row.action]} ${Math.round(Number(row.score))}`;
}

/** Hover text: band, recommended action, and every scored driver. */
export function priceSignalTitle(row: PriceSignalRow): string {
  const action = row.action === "raise" ? "Price up" : row.action === "lower" ? "Price down (unless protected)" : "Hold";
  return [
    `${row.stay_date} · Price signal ${row.score}/100 · ${SIGNAL_LABEL[row.band]} → ${action}`,
    ...(row.drivers ?? []),
    "Score = pace 35 · pickup 25 · event 20 · market 10 · inventory 10. The rules engine and the AI supervisor price from these same facts.",
  ].join("\n");
}
