import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { BedDouble } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

type HoverHint = {
  roomNumber: string;
  left: number;
  top: number;
};

interface RoomHoverIntentGuardProps {
  children: ReactNode;
}

const HOVER_INTENT_DELAY_MS = 2500;
const HINT_WIDTH = 300;

function roomChipFromTarget(target: EventTarget | null, root: HTMLElement | null) {
  let node = target instanceof HTMLElement ? target : null;

  while (node && node !== root) {
    const chipBox = node.firstElementChild instanceof HTMLElement ? node.firstElementChild : null;
    const looksLikeRoomChip =
      node.classList.contains('select-none') &&
      node.classList.contains('items-center') &&
      chipBox?.classList.contains('relative') &&
      chipBox.classList.contains('text-center');

    if (looksLikeRoomChip && chipBox) {
      const roomTextNode = Array.from(chipBox.childNodes).find(
        (child) => child.nodeType === Node.TEXT_NODE && !!child.textContent?.trim(),
      );
      const roomNumber = roomTextNode?.textContent?.trim();
      if (roomNumber) return { roomNumber, element: node };
    }

    node = node.parentElement;
  }

  return null;
}

/**
 * Desktop hover-intent guard for the room overview.
 *
 * The legacy room chips have an immediate interactive hover popover. That is
 * useful when deliberately inspecting a room, but it is disruptive while a
 * manager is simply moving the pointer across the room board. This guard
 * intercepts the native mouseover/mouseout events before React's delegated
 * handlers receive them, so the old popover cannot open accidentally.
 *
 * After a deliberate 2.5 second hover we show only a small, non-interactive
 * hint. The complete room operations interface remains click-driven.
 */
export function RoomHoverIntentGuard({ children }: RoomHoverIntentGuardProps) {
  const isMobile = useIsMobile();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeChipRef = useRef<HTMLElement | null>(null);
  const [hint, setHint] = useState<HoverHint | null>(null);

  useEffect(() => {
    if (isMobile) return;

    const clearHoverTimer = () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
    };

    const dismiss = () => {
      clearHoverTimer();
      activeChipRef.current = null;
      setHint(null);
    };

    const onMouseOver = (event: MouseEvent) => {
      const root = rootRef.current;
      if (!root || !(event.target instanceof Node) || !root.contains(event.target)) return;

      const chip = roomChipFromTarget(event.target, root);
      if (!chip) return;

      // Stop the legacy React onMouseEnter / Popover path before it reaches
      // the app root. This is intentionally native capture, not React capture.
      event.stopPropagation();

      const related = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (related && chip.element.contains(related)) return;
      if (activeChipRef.current === chip.element) return;

      clearHoverTimer();
      setHint(null);
      activeChipRef.current = chip.element;

      hoverTimerRef.current = setTimeout(() => {
        if (activeChipRef.current !== chip.element) return;

        const rect = chip.element.getBoundingClientRect();
        const left = Math.max(
          12,
          Math.min(window.innerWidth - HINT_WIDTH - 12, rect.left + rect.width / 2 - HINT_WIDTH / 2),
        );
        const preferredTop = rect.bottom + 10;
        const top = preferredTop + 74 < window.innerHeight ? preferredTop : Math.max(12, rect.top - 74);

        setHint({ roomNumber: chip.roomNumber, left, top });
        hoverTimerRef.current = null;
      }, HOVER_INTENT_DELAY_MS);
    };

    const onMouseOut = (event: MouseEvent) => {
      const root = rootRef.current;
      if (!root || !(event.target instanceof Node) || !root.contains(event.target)) return;

      const chip = roomChipFromTarget(event.target, root);
      if (!chip) return;

      event.stopPropagation();

      const related = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (related && chip.element.contains(related)) return;

      if (activeChipRef.current === chip.element) dismiss();
    };

    const onPointerDown = () => dismiss();
    const onWheel = () => dismiss();
    const onScroll = () => dismiss();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };

    // Capture at document level so React never receives the legacy hover event.
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('wheel', onWheel, { capture: true, passive: true });
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', dismiss);

    return () => {
      dismiss();
      document.removeEventListener('mouseover', onMouseOver, true);
      document.removeEventListener('mouseout', onMouseOut, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('wheel', onWheel, true);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', dismiss);
    };
  }, [isMobile]);

  return (
    <div ref={rootRef}>
      {children}
      {hint && (
        <div
          className="pointer-events-none fixed z-[90] w-[300px] rounded-xl border bg-popover px-3 py-2 text-popover-foreground shadow-lg"
          style={{ left: hint.left, top: hint.top }}
          aria-hidden="true"
        >
          <div className="flex items-center gap-2 text-sm font-semibold">
            <BedDouble className="h-4 w-4" />
            Room {hint.roomNumber}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Click to open room operations.</p>
        </div>
      )}
    </div>
  );
}
