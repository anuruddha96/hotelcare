#!/usr/bin/env python3
"""One-time, strict source patch for issue #349. Fails closed if upstream changed."""
from pathlib import Path


def once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one anchor, found {count}")
    return text.replace(old, new, 1)


def between(text: str, start: str, end: str, replacement: str, label: str) -> str:
    if text.count(start) != 1:
        raise RuntimeError(f"{label}: invalid start anchor ({text.count(start)})")
    a = text.index(start)
    b = text.find(end, a + len(start))
    if b < 0:
        raise RuntimeError(f"{label}: missing end anchor")
    return text[:a] + replacement + text[b:]


def patch_grid(text: str) -> str:
    text = once(text, 'import { rememberedRange, writeNumberPref } from "@/lib/revenuePrefs";\n', '', 'remove legacy preferences')
    text = once(text, 'import RateCellHistory from "@/components/revenue/RateCellHistory";', 'import RateCellHistory from "@/components/revenue/RateCellHistory";\nimport { calendarWindow, nextCalendarMonths, requiredCalendarHorizon } from "@/lib/rateCalendarWindow";', 'calendar window import')
    text = between(text, 'const RANGE_OPTIONS = [', 'const PICKUP_WINDOWS = [', '', 'remove long horizon buttons')
    text = between(text, '  // Desktop opens on the full 6-month horizon;', '  // Cell dots are on by default,', '''  // The date window is a view only. Pricing automation and bulk editor retain
  // their own horizons; no scroll handler expands this calendar.
  useEffect(() => {
    onHorizonDaysChange?.(requiredCalendarHorizon(today, monthFilter));
  }, [today, monthFilter, onHorizonDaysChange]);

''', 'replace horizon state')
    text = once(text, '  const allDates = useMemo(() => dateRange(today, addDays(today, days - 1)), [today, days]);', '  const allDates = useMemo(() => calendarWindow(today, monthFilter), [today, monthFilter]);', 'bound date columns')
    text = between(text, '  /**\n   * Sticky month label + auto-extend the horizon when the user scrolls right.', '  const scrollRaf = useRef<number | null>(null);', '''  /** Update visible month and navigation arrows without changing date range. */
''', 'remove misleading scroll description')
    text = between(text, '      // Approaching the right edge: widen the horizon automatically', '\n    });\n  }\n  useEffect(() => () => { if (scrollRaf.current', '', 'remove scroll expansion')
    text = between(text, '  /** Months covered by the loaded horizon, for the quick month chips. */', '  const selectMonth = useCallback(', '''  // Navigation is independent of fetched dates: display twelve future month
  // choices without eagerly loading their rate data.
  const monthChips = useMemo(() => nextCalendarMonths(today), [today]);

''', 'constant month navigation')
    text = once(text, '''  const selectMonth = useCallback((value: string | null) => {
    setMonthFilter(value);
    requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollLeft = 0; });
  }, []);''', '''  const selectMonth = useCallback((value: string | null) => {
    setMonthFilter(value);
    setPickedDates(new Set());
    setSelDates(new Set());
    requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollLeft = 0; });
  }, []);''', 'clear old selections')
    text = between(text, '            <div className="flex rounded-md border overflow-hidden">\n\n              {RANGE_OPTIONS.map(', '          </div>\n        </div>\n        {/* Legend', '', 'remove 14d to 12m toolbar')
    text = between(text, '          {/* Month chips — jump straight to one month, fitted to the screen. */}', '          <div\n            ref={scrollRef}', '''          {/* Explicit navigation: no infinite load, no hidden extra columns. */}
          <div className="flex items-center gap-1 overflow-x-auto border-b px-2 py-1.5" aria-label="Rate calendar date navigation">
            <Button
              size="sm"
              variant={monthFilter ? "ghost" : "default"}
              className="h-7 shrink-0 px-2 text-[11px]"
              onClick={() => selectMonth(null)}
            >
              Next 30 days
            </Button>
            {monthChips.map((m) => (
              <Button
                key={m.value}
                size="sm"
                variant={monthFilter === m.value ? "default" : "ghost"}
                className="h-7 shrink-0 px-2 text-[11px]"
                title={`Show ${m.label} only`}
                onClick={() => selectMonth(m.value)}
              >
                {m.label}
              </Button>
            ))}
          </div>
          {loading && (
            <div role="status" className="flex items-center gap-1.5 border-b px-3 py-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading selected calendar dates…
            </div>
          )}

''', 'replace month navigation')
    if 'setDays(' in text or 'RANGE_OPTIONS' in text or 'rememberedRange' in text:
        raise RuntimeError('legacy calendar horizon remains')
    return text


def patch_page(text: str) -> str:
    text = between(text, '  // The calendar tells us how far it is scrolled;', '  const live = useRevenueHotelData(', '''  // Only the explicitly selected calendar dates are requested. Changing the
  // month replaces the request instead of monotonically growing it.
  const [horizonDays, setHorizonDays] = useState(30);
  const growHorizon = useCallback((days: number) => {
    setHorizonDays(Math.max(30, Math.min(365, Math.ceil(days))));
  }, []);
''', 'parent bounded horizon')
    text = once(text, 'loading={live.loading}\n            today={live.today}', 'loading={live.loading || live.extending}\n            today={live.today}', 'calendar loading indicator')
    text = once(text, '· loading the rest of the year…', '· loading selected calendar dates…', 'accurate loading label')
    return text


def patch_hook(text: str) -> str:
    text = between(text, 'import {\n  defaultRangeDays,', 'import {\n  readCachedRevenueHotPayload,', '', 'remove horizon preference imports')
    text = between(text, '/** First paint only needs the dates a manager can immediately act on. */', 'function readAnyCache(', '''/** The calendar opens on precisely thirty dates; future months load on selection. */
const FIRST_WINDOW_DAYS = 30;
/** Cache the loaded window, not a future year of unseen prices. */
const HOT_WINDOW_DAYS = 30;

''', 'no eager extra window')
    text = once(text, '  const [gridHorizonDays, setGridHorizonDays] = useState(preferredGridHorizonDays);\n', '', 'remove cached range state')
    text = between(text, '  useEffect(() => {\n    const onPreferenceChanged = (event: Event) => {', '  const today = budapestToday();', '''  const effectiveHorizonDays = Math.max(1, Math.min(365, horizonDays));
''', 'remove obsolete preference cap')
    text = once(text, '  const horizonEnd = addDays(today, effectiveHorizonDays);', '  const horizonEnd = addDays(today, effectiveHorizonDays - 1);', 'inclusive horizon')
    if 'gridHorizonDays' in text or 'preferredGridHorizonDays' in text:
        raise RuntimeError('old grid horizon still referenced')
    return text


def patch_month_header(text: str) -> str:
    return once(text, '    if (loadedMonth && key > loadedMonth) return true;', '''    if (loadedMonth && key > loadedMonth) return true;
    // A 30-day rolling window can end partway through the next month.
    // Never present incomplete monthly totals as a completed month.
    const [year, month] = key.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    if (loadedThrough && loadedThrough < lastDay) return true;''', 'monthly aggregates remain honest')


def main() -> None:
    patches = {
        'src/components/revenue/RateStrategyGrid.tsx': patch_grid,
        'src/pages/RevenueHotelDetail.tsx': patch_page,
        'src/hooks/useRevenueHotelData.ts': patch_hook,
        'src/components/revenue/MonthPerformanceHeader.tsx': patch_month_header,
    }
    for name, transform in patches.items():
        path = Path(name)
        original = path.read_text()
        updated = transform(original)
        if updated == original:
            raise RuntimeError(f'No change to {name}')
        path.write_text(updated)
        print(f'Patched {name}')


if __name__ == '__main__':
    main()
