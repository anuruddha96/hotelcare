/** Work-schedule grid display preferences, remembered per workstation. */
export interface GridPrefs {
  /** 1 = normal size; 0.5 shows about twice as many cells each way. */
  zoom: number;
  pinTotals: boolean;
}

export const ZOOM_LEVELS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5] as const;
export const DEFAULT_GRID_PREFS: GridPrefs = { zoom: 0.9, pinTotals: false };
const STORAGE_KEY = 'hotelcare.workforce.gridPrefs.v1';

/** Next zoom level up or down; stays within the list and snaps odd stored values onto it. */
export function stepZoom(current: number, direction: 1 | -1): number {
  const nearest = ZOOM_LEVELS.reduce((best, level, i) => (Math.abs(level - current) < Math.abs(ZOOM_LEVELS[best] - current) ? i : best), 0);
  return ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, nearest + direction))];
}

export function parseGridPrefs(raw: string | null | undefined): GridPrefs {
  try {
    const parsed = JSON.parse(raw ?? '') as Partial<GridPrefs>;
    const zoom = Number(parsed.zoom);
    return {
      zoom: Number.isFinite(zoom) && zoom >= 0.5 && zoom <= 1.5 ? zoom : DEFAULT_GRID_PREFS.zoom,
      pinTotals: typeof parsed.pinTotals === 'boolean' ? parsed.pinTotals : DEFAULT_GRID_PREFS.pinTotals,
    };
  } catch {
    return { ...DEFAULT_GRID_PREFS };
  }
}

export function loadGridPrefs(): GridPrefs {
  try { return parseGridPrefs(globalThis.localStorage?.getItem(STORAGE_KEY)); } catch { return { ...DEFAULT_GRID_PREFS }; }
}

export function saveGridPrefs(prefs: GridPrefs): void {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* storage blocked */ }
}
