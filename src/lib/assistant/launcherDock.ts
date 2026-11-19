/**
 * Mira's floating button docks like iOS AssistiveTouch: it can be dragged
 * anywhere, but when let go it always settles on the left or right edge of
 * the screen, never in the middle.
 *
 * The resting place is stored as a side plus a 0–1 height ratio instead of
 * pixels, so the button keeps its edge and relative height when the phone
 * rotates or the window changes size.
 */

export type DockSide = "left" | "right";

export interface LauncherDock {
  side: DockSide;
  /** 0 = highest allowed position, 1 = lowest. */
  ratio: number;
}

export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
export interface Insets { top: number; right: number; bottom: number; left: number }

/** Limits for the button's top-left corner, in CSS pixels. */
export interface DockBounds { minX: number; maxX: number; minY: number; maxY: number }

/** A pointer position with the time it was seen (ms). */
export interface PointerSample { x: number; y: number; t: number }

/** Matches the button's h-14 / w-14. */
export const LAUNCHER_SIZE = 56;
/** Gap between the button and the left or right screen edge. */
export const SIDE_GAP = 8;
export const TOP_GAP = 12;
/** Larger at the bottom so the button clears the home indicator and browser toolbars. */
export const BOTTOM_GAP = 24;
/** Movement (px) before a press counts as a drag instead of a tap. */
export const DRAG_THRESHOLD = 6;
/** How far ahead (ms) a fling is projected when choosing the edge. */
export const FLING_PROJECTION_MS = 160;
/** Only pointer samples this recent (ms) count towards the release speed. */
export const VELOCITY_WINDOW_MS = 100;

export const DEFAULT_DOCK: LauncherDock = { side: "right", ratio: 0.6 };

/**
 * A bar pinned to the top of the screen hides or crowds the button when it is
 * stacked at least as high (the app header is z-50, the button z-40), spans
 * most of the width and is not a full-screen overlay or drawer.
 */
const TOP_BAR_MIN_Z_INDEX = 40;
const TOP_BAR_MIN_WIDTH = 0.6;
const TOP_BAR_MAX_HEIGHT = 0.4;
/** Enough passes for a header with a sticky navigation strip or two under it. */
const TOP_BAR_MAX_LAYERS = 4;

/** The previous launcher was a pill about this wide; saved positions are its top-left corner. */
const LEGACY_PILL_WIDTH = 100;
const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * @param topBars Bottom edge of the bars pinned to the top of the screen, such
 *   as the sticky app header. The button always stays below them.
 */
export function dockBounds(viewport: Size, insets: Insets = NO_INSETS, topBars = 0, size = LAUNCHER_SIZE): DockBounds {
  const minX = insets.left + SIDE_GAP;
  const minY = Math.max(insets.top, topBars) + TOP_GAP;
  return {
    minX,
    maxX: Math.max(minX, viewport.width - insets.right - SIDE_GAP - size),
    minY,
    maxY: Math.max(minY, viewport.height - insets.bottom - BOTTOM_GAP - size),
  };
}

/** Keeps a dragged button fully on screen. */
export function clampPoint(point: Point, bounds: DockBounds): Point {
  return { x: clamp(point.x, bounds.minX, bounds.maxX), y: clamp(point.y, bounds.minY, bounds.maxY) };
}

/** Where a docked button rests: always flush with the left or right edge. */
export function dockToPoint(dock: LauncherDock, bounds: DockBounds): Point {
  return {
    x: dock.side === "left" ? bounds.minX : bounds.maxX,
    y: bounds.minY + clamp(dock.ratio, 0, 1) * (bounds.maxY - bounds.minY),
  };
}

/**
 * Picks the edge a released button settles on. A fling is projected forward,
 * so flicking the button towards the far side lands it there.
 */
export function snapToEdge(release: Point, bounds: DockBounds, velocity: Point = { x: 0, y: 0 }): LauncherDock {
  const projected = clampPoint({
    x: release.x + velocity.x * FLING_PROJECTION_MS,
    y: release.y + velocity.y * FLING_PROJECTION_MS,
  }, bounds);
  const midline = (bounds.minX + bounds.maxX) / 2;
  const travel = bounds.maxY - bounds.minY;
  return {
    side: projected.x < midline ? "left" : "right",
    ratio: travel > 0 ? (projected.y - bounds.minY) / travel : 0,
  };
}

/** Release speed in px/ms over the last moments of the drag; zero if the finger paused before letting go. */
export function releaseVelocity(samples: PointerSample[]): Point {
  const last = samples[samples.length - 1];
  const first = last ? samples.find((sample) => last.t - sample.t <= VELOCITY_WINDOW_MS) : undefined;
  const elapsed = last && first ? last.t - first.t : 0;
  if (!last || !first || elapsed <= 0) return { x: 0, y: 0 };
  return { x: (last.x - first.x) / elapsed, y: (last.y - first.y) / elapsed };
}

/**
 * Reads a saved dock. Positions saved by the earlier free-floating pill
 * ({ x, y }) move to the nearest edge.
 */
export function readDock(raw: string | null, bounds: DockBounds): LauncherDock | null {
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const saved = parsed as Record<string, unknown>;
  if ((saved.side === "left" || saved.side === "right") && isFiniteNumber(saved.ratio)) {
    return { side: saved.side, ratio: clamp(saved.ratio, 0, 1) };
  }
  if (isFiniteNumber(saved.x) && isFiniteNumber(saved.y)) {
    // Compare the old pill's centre, not its left edge.
    return snapToEdge({ x: saved.x + (LEGACY_PILL_WIDTH - LAUNCHER_SIZE) / 2, y: saved.y }, bounds);
  }
  return null;
}

export function serializeDock(dock: LauncherDock): string {
  return JSON.stringify({ side: dock.side, ratio: Math.round(clamp(dock.ratio, 0, 1) * 1000) / 1000 });
}

/**
 * Measures the area the button may use: below the sticky app header (and any
 * sticky bar stacked under it), clear of notches and the home indicator.
 * documentElement.clientHeight ignores collapsing mobile browser toolbars, so
 * the button doesn't jump while the page scrolls.
 */
export function measureDockBounds(win: Window = window): DockBounds {
  const root = win.document.documentElement;
  const viewport = {
    width: root.clientWidth || win.innerWidth,
    height: root.clientHeight || win.innerHeight,
  };
  const insets = readSafeAreaInsets(win.document);
  // The two columns the button docks in.
  const columns = [
    insets.left + SIDE_GAP + LAUNCHER_SIZE / 2,
    viewport.width - insets.right - SIDE_GAP - LAUNCHER_SIZE / 2,
  ];
  return dockBounds(viewport, insets, measureTopBars(win, viewport, columns));
}

/**
 * Bottom edge of the bars pinned to the top of the screen that would cover the
 * button, such as the sticky app header and sticky navigation stacked under
 * it. Probes straight down the given columns, one bar at a time. 0 if none.
 */
export function measureTopBars(win: Window, viewport: Size, columns: number[]): number {
  const doc = win.document;
  if (typeof doc.elementsFromPoint !== "function") return 0;
  let bottom = 0;
  for (let layer = 0; layer < TOP_BAR_MAX_LAYERS; layer += 1) {
    let next = bottom;
    for (const x of columns) {
      for (const element of doc.elementsFromPoint(x, bottom + 1)) {
        const style = win.getComputedStyle(element);
        if (style.position !== "fixed" && style.position !== "sticky") continue;
        if ((Number.parseInt(style.zIndex, 10) || 0) < TOP_BAR_MIN_Z_INDEX) continue;
        const box = element.getBoundingClientRect();
        if (box.width < viewport.width * TOP_BAR_MIN_WIDTH || box.height > viewport.height * TOP_BAR_MAX_HEIGHT) continue;
        next = Math.max(next, box.bottom);
      }
    }
    if (next <= bottom) break;
    bottom = next;
  }
  return bottom;
}

function readSafeAreaInsets(doc: Document): Insets {
  if (!doc.body) return NO_INSETS;
  const probe = doc.createElement("div");
  probe.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;"
    + "padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
  doc.body.appendChild(probe);
  const style = doc.defaultView?.getComputedStyle(probe);
  const px = (value: string | undefined) => Number.parseFloat(value ?? "") || 0;
  const insets = {
    top: px(style?.paddingTop),
    right: px(style?.paddingRight),
    bottom: px(style?.paddingBottom),
    left: px(style?.paddingLeft),
  };
  probe.remove();
  return insets;
}
