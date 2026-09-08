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
    if (node.classList.contains('select-none') && node.classList.contains('items-center')) {
      const chipBox = Array.from(node.children).find((child) =>
        child instanceof HTMLElement &&
        child.classList.contains('text-center') &&
        child.classList.contains('rounded'),
      ) as HTMLElement | undefined;

      if (chipBox) {
        const roomTextNode = Array.from(chipBox.childNodes).find(
          (child) => child.nodeType === Node.TEXT_NODE && !!child.textContent?.trim(),
        );
        const roomNumber = roomTextNode?.textContent?.trim();
        if (roomNumber && /^[0-9A-Za-z._-]+$/.test(roomNumber)) {
          return { roomNumber, element: node };
        }
      }
    }

    node = node.parentElement;
  }

  return null;
}

/**
 * Desktop hover-intent guard for the live Hotel Room Overview.
 *
 * Room operations are click-driven. Merely travelling across room chips must
 * never open an operational surface. We intercept the native hover event at
 * WINDOW CAPTURE (before React's delegated mouse-enter handlers can see it),
 * then show only a tiny informational hint after a deliberate 2.5 second hover.
 *
 * Any click/pointer-down, scroll, wheel, Escape, window blur, or leaving the
 * chip cancels the pending hint immediately.
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

    const findRoomChip = (event: Event) => {
      const root = rootRef.current;
      if (!root || !(event.target instanceof Node) || !root.contains(event.target)) return null;
      return roomChipFromTarget(event.target, root);
    };

    const blockLegacyHover = (event: Event) => {
      // This must happen before React receives the same native event. Using
      // stopImmediatePropagation at WINDOW CAPTURE removes both the legacy
      // large room popover and the wrapper's old instant hover hint path.
      event.stopImmediatePropagation();
      event.stopPropagation();
    };

    const onMouseOver = (event: MouseEvent) => {
      const chip = findRoomChip(event);
      if (!chip) return;
      blockLegacyHover(event);

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
      const chip = findRoomChip(event);
      if (!chip) return;
      blockLegacyHover(event);

      const related = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (related && chip.element.contains(related)) return;

      if (activeChipRef.current === chip.element) dismiss();
    };

    // Some browsers/device stacks generate pointer events before mouse events.
    // Block those too so no delegated hover path can slip through.
    const onPointerOver = (event: PointerEvent) => {
      const chip = findRoomChip(event);
      if (chip) blockLegacyHover(event);
    };
    const onPointerOut = (event: PointerEvent) => {
      const chip = findRoomChip(event);
      if (chip) blockLegacyHover(event);
    };

    const onPointerDown = () => dismiss();
    const onWheel = () => dismiss();
    const onScroll = () => dismiss();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };

    window.addEventListener('mouseover', onMouseOver, true);
    window.addEventListener('mouseout', onMouseOut, true);
    window.addEventListener('pointerover', onPointerOver, true);
    window.addEventListener('pointerout', onPointerOut, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: true });
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', dismiss);

    return () => {
      dismiss();
      window.removeEventListener('mouseover', onMouseOver, true);
      window.removeEventListener('mouseout', onMouseOut, true);
      window.removeEventListener('pointerover', onPointerOver, true);
      window.removeEventListener('pointerout', onPointerOut, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('keydown', onKeyDown, true);
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
