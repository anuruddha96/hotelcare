// Durable "who last moved this price" markers.
//
// The calendar used to derive its dots from a shared, hard-capped window of the
// audit trail (400 recent rows for the activity panel, 1500 confirmed rows).
// On a busy property that window covers a few minutes of work — Ottofiori
// writes ~26,000 audit rows a day — so after a reload most dates and most of
// the lower room-type cells fell outside it and simply lost their markers.
//
// Markers are now read from `rate_cell_markers()`, which returns exactly ONE
// row per (stay_date, room type, occupancy) for the visible range: bounded,
// index-backed and complete for every room type, not just the first ones.

import { cellKey } from "@/lib/rateAudit";
import { budapestDayStartMs, type ChangeOrigin } from "@/lib/rateOrigin";

/** One row of `rate_cell_markers` — the newest relevant change on a cell. */
export interface CellMarkerRow {
  stay_date: string;
  room_type_name: string | null;
  occupancy: number | null;
  source: string | null;
  performed_at: string;
  performed_by: string | null;
  confirmation_status: string | null;
  old_rate_eur: number | null;
  new_rate_eur: number | null;
  requested_price: number | null;
}

export interface CellMarker {
  origin: ChangeOrigin;
  at: string;
  by: string | null;
  source: string | null;
  old: number | null;
  price: number | null;
  requested: number | null;
}

/**
 * Origin of a persisted change, including the rows written the moment someone
 * publishes from Hotel Care. A hand-made change must read blue straight away —
 * waiting for the Previo read-back is what made manual edits look automated.
 */
export function markerOrigin(source: string | null, confirmation?: string | null): ChangeOrigin | null {
  if (confirmation === "different") return "failed";
  switch (source) {
    case "previo_confirmed":
    case "previo_bulk_confirmed":
      return "team";
    case "previo_automation_confirmed":
    case "push_automation":
      return "automation";
    case "previo_external":
      return "previo";
    case "previo_different":
      return "failed";
    case "push":
    case "day-tool":
    case "cell-edit":
    case "bulk-editor":
    case "demand":
    case "pickup-board":
    case "autopilot":
      return "team";
    default:
      return null;
  }
}

/** Index marker rows by exact cell key. Newest row per cell wins. */
export function indexCellMarkers(rows: CellMarkerRow[] | undefined): Map<string, CellMarker> {
  const map = new Map<string, CellMarker>();
  for (const r of rows ?? []) {
    if (!r.stay_date || !r.room_type_name || r.occupancy === null || r.occupancy === undefined) continue;
    const origin = markerOrigin(r.source, r.confirmation_status);
    if (!origin) continue;
    const key = cellKey(r.stay_date, r.room_type_name, r.occupancy);
    const prev = map.get(key);
    if (prev && prev.at >= r.performed_at) continue;
    map.set(key, {
      origin,
      at: r.performed_at,
      by: r.performed_by,
      source: r.source,
      old: r.old_rate_eur,
      price: r.new_rate_eur,
      requested: r.requested_price,
    });
  }
  return map;
}

/**
 * The date-header marker: the newest change across every cell on that stay
 * date that happened during TODAY in Europe/Budapest. Mixed automation/team
 * work on one date resolves to whichever event is newest.
 */
export function dayMarkers(
  cells: Map<string, CellMarker>,
  now: number = Date.now(),
): Map<string, { origin: ChangeOrigin; at: string }> {
  const dayStart = budapestDayStartMs(now);
  const out = new Map<string, { origin: ChangeOrigin; at: string }>();
  for (const [key, m] of cells) {
    const t = Date.parse(m.at);
    if (!Number.isFinite(t) || t < dayStart) continue;
    const date = key.split("|")[0];
    const prev = out.get(date);
    if (!prev || m.at > prev.at) out.set(date, { origin: m.origin, at: m.at });
  }
  return out;
}
