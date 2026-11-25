import { useTranslation } from '@/hooks/useTranslation';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import hotelCareMark from "@/assets/hotelcare-logo-mark.png";
import {
  DEFAULT_DOCK,
  DRAG_THRESHOLD,
  clampPoint,
  dockToPoint,
  measureDockBounds,
  readDock,
  releaseVelocity,
  serializeDock,
  snapToEdge,
  type DockBounds,
  type LauncherDock,
  type Point,
  type PointerSample,
} from "@/lib/assistant/launcherDock";

interface Gesture {
  pointerId: number;
  /** Pointer position when pressed. */
  start: Point;
  /** Button position when pressed. */
  origin: Point;
  /** Latest dragged button position. */
  last: Point;
  /** Area the button may use, measured when the drag started. */
  bounds: DockBounds;
  moved: boolean;
  samples: PointerSample[];
}

/** A short spring with a slight overshoot, like AssistiveTouch settling against the edge. */
const SETTLE_TRANSITION = "transform 380ms cubic-bezier(0.3, 1.25, 0.55, 1)";
const MAX_SAMPLES = 12;
/** Scrolling can pin another sticky bar under the header; measure again once it stops. */
const SCROLL_SETTLE_MS = 120;

function loadDock(storageKey: string, bounds: DockBounds): LauncherDock {
  try {
    return readDock(localStorage.getItem(storageKey), bounds) ?? DEFAULT_DOCK;
  } catch {
    return DEFAULT_DOCK; // Storage is optional.
  }
}

const sameBounds = (a: DockBounds, b: DockBounds) =>
  a.minX === b.minX && a.maxX === b.maxX && a.minY === b.minY && a.maxY === b.maxY;

interface MiraFloatingButtonProps {
  /** Where this person's chosen edge is remembered. */
  storageKey: string;
  unread: boolean;
  onOpen: () => void;
}

/**
 * Mira's launcher on phones, tablets and narrow windows: a round button that
 * can be dragged anywhere and, like iOS AssistiveTouch, always settles against
 * the nearest side of the screen when let go.
 */
export default function MiraFloatingButton({ storageKey, unread, onOpen }: MiraFloatingButtonProps) {
  const { t } = useTranslation();
  const [bounds, setBounds] = useState<DockBounds>(() => measureDockBounds());
  const [dock, setDock] = useState<LauncherDock>(() => loadDock(storageKey, measureDockBounds()));
  const [dragPoint, setDragPoint] = useState<Point | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const suppressClickRef = useRef(false);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  /** Measures the usable area again, below whatever header the current page has. */
  const remeasure = useCallback(() => {
    const next = measureDockBounds();
    setBounds((previous) => (sameBounds(previous, next) ? previous : next));
    return next;
  }, []);

  useEffect(() => {
    let scrollTimer = 0;
    const onScroll = () => {
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(remeasure, SCROLL_SETTLE_MS);
    };
    remeasure(); // The page header can finish rendering after the button.
    window.addEventListener("resize", remeasure);
    window.addEventListener("orientationchange", remeasure);
    window.addEventListener("scroll", onScroll, { passive: true });
    // Page changes and late-loading content resize the body.
    const layout = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => remeasure());
    layout?.observe(document.body);
    return () => {
      window.clearTimeout(scrollTimer);
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("orientationchange", remeasure);
      window.removeEventListener("scroll", onScroll);
      layout?.disconnect();
    };
  }, [remeasure]);

  const resting = dockToPoint(dock, bounds);
  const point = dragPoint ?? resting;
  const dragging = dragPoint !== null;

  const settle = (release: Point, area: DockBounds, velocity?: Point) => {
    const next = snapToEdge(release, area, velocity);
    setDock(next);
    setDragPoint(null);
    try { localStorage.setItem(storageKey, serializeDock(next)); } catch { /* Storage is optional. */ }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    // A drag whose click never arrived must not swallow this tap.
    suppressClickRef.current = false;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // Measured fresh, so a drag can never slide under the header of this page.
    const area = remeasure();
    const box = event.currentTarget.getBoundingClientRect();
    // Pick the button up where it is on screen, even halfway through settling.
    const origin = box.width > 0 ? { x: box.left, y: box.top } : dockToPoint(dock, area);
    gestureRef.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      origin,
      last: origin,
      bounds: area,
      moved: false,
      samples: [{ x: event.clientX, y: event.clientY, t: performance.now() }],
    };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Capture is best effort. */ }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const dx = event.clientX - gesture.start.x;
    const dy = event.clientY - gesture.start.y;
    if (!gesture.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    gesture.moved = true;
    gesture.samples = [...gesture.samples.slice(-(MAX_SAMPLES - 1)), { x: event.clientX, y: event.clientY, t: performance.now() }];
    gesture.last = clampPoint({ x: gesture.origin.x + dx, y: gesture.origin.y + dy }, gesture.bounds);
    setDragPoint(gesture.last);
  };

  const endGesture = (event: ReactPointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const gesture = gestureRef.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gestureRef.current = null;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    } catch { /* Capture is best effort. */ }
    if (!gesture.moved) return; // A tap: the click that follows opens Mira.
    suppressClickRef.current = true;
    if (cancelled) {
      // The browser took the gesture over; still never leave the button mid-screen.
      settle(gesture.last, gesture.bounds);
      return;
    }
    const release = clampPoint({
      x: gesture.origin.x + event.clientX - gesture.start.x,
      y: gesture.origin.y + event.clientY - gesture.start.y,
    }, gesture.bounds);
    settle(release, gesture.bounds, releaseVelocity([...gesture.samples, { x: event.clientX, y: event.clientY, t: performance.now() }]));
  };

  return (
    <button
      type="button"
      onClick={() => {
        if (suppressClickRef.current) { suppressClickRef.current = false; return; }
        onOpen();
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => endGesture(event, false)}
      onPointerCancel={(event) => endGesture(event, true)}
      onLostPointerCapture={(event) => endGesture(event, true)}
      onContextMenu={(event) => event.preventDefault()}
      data-side={dock.side}
      data-dragging={dragging ? "true" : undefined}
      style={{
        transform: `translate3d(${Math.round(point.x)}px, ${Math.round(point.y)}px, 0)`,
        transition: dragging || reducedMotion ? "none" : SETTLE_TRANSITION,
        WebkitTouchCallout: "none",
        WebkitTapHighlightColor: "transparent",
      }}
      className="fixed left-0 top-0 z-40 h-14 w-14 touch-none select-none rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      aria-label={unread ? t('reception.shell.miraUnread') : t('reception.shell.miraOpen')}
      title={t('reception.shell.miraDrag')}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none flex h-full w-full items-center justify-center rounded-full bg-primary shadow-lg transition-[transform,box-shadow] duration-200 ease-out motion-reduce:transition-none",
          dragging && "scale-110 shadow-xl",
        )}
      >
        <span className="relative flex h-11 w-11 items-center justify-center rounded-full bg-background shadow-sm">
          <img src={hotelCareMark} alt="" draggable={false} className="h-7 w-7" />
          {unread && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-background bg-sky-500" />}
        </span>
      </span>
    </button>
  );
}
