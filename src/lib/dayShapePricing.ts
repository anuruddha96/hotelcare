// Keeping the shape of a day when one absolute price is typed.
//
// Typing "158" for a whole day used to write 158 into every room type and
// every guest count, wiping the room differentials and the occupancy ladder in
// one click. Instead the typed number anchors the cheapest cell of the day and
// every other cell keeps its existing distance to that anchor.

export interface ShapeCell {
  /** Stable identifier of the cell (room type + guest count). */
  key: string;
  /** Price currently live for that cell, or null when we know nothing. */
  current: number | null;
}

export interface ShapeOptions {
  /** Absolute price typed by the user. */
  target: number;
  /** Rounding step, in whole currency units. */
  step?: number;
  /** Minimum difference between one guest count and the next. */
  supplement?: number;
}

/**
 * Anchor price of a day: the cheapest known cell. Everything else is scaled
 * relative to it, so the day keeps its shape whatever the anchor moves to.
 */
export function anchorPrice(cells: ShapeCell[]): number | null {
  const known = cells.map((c) => c.current).filter((p): p is number => typeof p === "number" && p > 0);
  if (known.length === 0) return null;
  return Math.min(...known);
}

/**
 * Scale a day (or a range) so the anchor lands on `target` while every other
 * cell keeps its proportional distance. Cells with no current price fall back
 * to the target itself.
 */
export function applyKeepingShape(cells: ShapeCell[], opts: ShapeOptions): Map<string, number> {
  const step = Math.max(1, Math.round(opts.step ?? 1));
  const anchor = anchorPrice(cells);
  const out = new Map<string, number>();
  const round = (value: number) => Math.max(step, Math.round(value / step) * step);
  for (const cell of cells) {
    if (anchor === null || cell.current === null || cell.current <= 0) {
      out.set(cell.key, round(opts.target));
      continue;
    }
    out.set(cell.key, round((cell.current / anchor) * opts.target));
  }
  return out;
}

/**
 * Scale one room type's occupancy ladder so the edited level lands on
 * `target`. When the stored ladder is already flat (every level identical) the
 * configured supplement rebuilds a real step instead of repeating one number.
 */
export function ladderFromEditedLevel(
  levels: Array<{ occupancy: number; current: number | null }>,
  editedOccupancy: number,
  opts: ShapeOptions,
): Map<number, number> {
  const step = Math.max(1, Math.round(opts.step ?? 1));
  const supplement = Math.max(0, Math.round(opts.supplement ?? 0));
  const round = (value: number) => Math.max(step, Math.round(value / step) * step);
  const editedCurrent = levels.find((l) => l.occupancy === editedOccupancy)?.current ?? null;
  const known = levels.map((l) => l.current).filter((p): p is number => typeof p === "number" && p > 0);
  const flat = known.length > 1 && new Set(known.map((p) => Math.round(p))).size === 1;

  const out = new Map<number, number>();
  for (const level of levels) {
    if (level.occupancy === editedOccupancy) { out.set(level.occupancy, round(opts.target)); continue; }
    if (flat || editedCurrent === null || editedCurrent <= 0 || level.current === null || level.current <= 0) {
      out.set(level.occupancy, round(opts.target + (level.occupancy - editedOccupancy) * supplement));
      continue;
    }
    out.set(level.occupancy, round((level.current / editedCurrent) * opts.target));
  }
  return out;
}
