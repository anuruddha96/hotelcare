import { useEffect, useRef } from 'react';
import { todayBudapest } from '@/lib/budapestTime';

type Options = {
  enabled: boolean;
  visibleIds: string[];
  selectedDate: string;
  clearFilters: () => void;
  setSelectedDate: (date: string) => void;
};

/** Push links only scroll to a room already visible through the signed-in
 * user's normal assignment queries. Never load a room from a URL parameter. */
export function useBreakfastAssignmentDeepLink({ enabled, visibleIds, selectedDate, clearFilters, setSelectedDate }: Options) {
  const target = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('breakfastAssignment');
  const valid = target && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target) ? target : null;
  const requested = useRef<string | null>(null);
  const consumed = useRef<string | null>(null);
  const canScroll = !!valid && visibleIds.includes(valid);
  useEffect(() => {
    if (!enabled || !valid || consumed.current === valid || requested.current === valid) return;
    requested.current = valid;
    clearFilters();
    setSelectedDate(todayBudapest());
  }, [enabled, valid, clearFilters, setSelectedDate]);
  useEffect(() => {
    if (!enabled || !valid || !canScroll || selectedDate !== todayBudapest() || consumed.current === valid) return;
    const frame = window.requestAnimationFrame(() => {
      const room = document.getElementById('housekeeping-assignment-' + valid);
      if (!room) return;
      room.scrollIntoView({ behavior: 'smooth', block: 'start' });
      consumed.current = valid;
      const url = new URL(window.location.href);
      if (url.searchParams.get('breakfastAssignment') === valid) {
        url.searchParams.delete('breakfastAssignment');
        window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [enabled, valid, canScroll, selectedDate]);
}
