import { useEffect } from 'react';

/**
 * Mobile-only presentation helper for the manager housekeeping workspace.
 * It does not change assignments, attendance, schedules or approval data.
 * It only marks roster cards that are explicitly scheduled off/not scheduled,
 * allowing CSS to collapse empty cards without hiding active housekeepers.
 */
export function HousekeepingMobilePolish() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.hk-mobile-workspace');
    if (!root) return;

    const markRosterCards = () => {
      const cards = root.querySelectorAll<HTMLElement>(
        '[data-training="team-view"] .grid > .rounded-lg.border.bg-card.transition-all',
      );

      cards.forEach((card) => {
        const text = card.textContent || '';
        const explicitlyOff = text.includes('Scheduled off') || text.includes('Not scheduled');
        const hasAssignedWork = !/\b0\s+(rooms?|units?|apartments?)\b/i.test(text);
        if (explicitlyOff && !hasAssignedWork) {
          card.dataset.hkNotWorkingToday = 'true';
        } else {
          delete card.dataset.hkNotWorkingToday;
        }
      });
    };

    markRosterCards();
    const observer = new MutationObserver(markRosterCards);
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
