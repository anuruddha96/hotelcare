import { useEffect, useRef } from 'react';

/**
 * The existing Laundryner picker portals into [data-gozsdu-laundryner-slot].
 * The wizard normally renders that slot only on Step 1. A saved tomorrow plan
 * opens on Preview, so managers cannot reach it. Add a slot inside the SAME
 * wizard scroll region without introducing another Radix dialog or changing
 * the room assignment state. Step 1 continues to own its normal slot.
 */
export function GozsduLaundryDutyUniversalSlot({ open, workDate }: {
  open: boolean;
  workDate: string;
}) {
  const fallbackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const locate = () => {
      if (fallbackRef.current?.isConnected) return;
      const wizard = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
        .find(dialog => dialog.textContent?.includes('Tomorrow · 08:00 release')
          || dialog.textContent?.includes('● Live'));
      if (!wizard) return;
      if (wizard.querySelector('[data-gozsdu-laundryner-slot]')) return;
      const scroller = wizard.querySelector<HTMLElement>('.flex-1.min-h-0.overflow-y-auto');
      if (!scroller) return;
      const slot = document.createElement('div');
      slot.dataset.gozsduLaundrynerSlot = 'true';
      slot.dataset.laundrynerFallback = 'true';
      slot.className = 'mb-3 min-w-0';
      scroller.prepend(slot);
      fallbackRef.current = slot;
    };

    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      fallbackRef.current?.remove();
      fallbackRef.current = null;
    };
  }, [open, workDate]);

  return null;
}
