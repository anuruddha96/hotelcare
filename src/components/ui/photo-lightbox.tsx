import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface LightboxPhoto {
  url: string;
  caption?: string;
}

interface PhotoLightboxProps {
  photos: LightboxPhoto[];
  startIndex?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Fullscreen photo viewer with pinch-zoom, drag-to-pan, wheel zoom,
 * double-tap zoom, and next/prev navigation. Renders as a fixed overlay
 * (not an <a href>) so the storage URL is never surfaced in the address bar.
 */
export function PhotoLightbox({ photos, startIndex = 0, open, onOpenChange }: PhotoLightboxProps) {
  const [index, setIndex] = useState(startIndex);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureStart = useRef<{
    distance: number;
    scale: number;
    tx: number;
    ty: number;
    midX: number;
    midY: number;
  } | null>(null);
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const lastTap = useRef<number>(0);

  const reset = useCallback(() => {
    setScale(1);
    setTx(0);
    setTy(0);
  }, []);

  useEffect(() => {
    if (open) {
      setIndex(startIndex);
      reset();
    }
  }, [open, startIndex, reset]);

  useEffect(() => {
    reset();
  }, [index, reset]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
      else if (e.key === 'ArrowRight') setIndex((i) => Math.min(photos.length - 1, i + 1));
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
      else if (e.key === '+' || e.key === '=') setScale((s) => Math.min(6, s * 1.25));
      else if (e.key === '-') setScale((s) => Math.max(1, s / 1.25));
      else if (e.key === '0') reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, photos.length, onOpenChange, reset]);

  // Lock background scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const clampPan = useCallback((nx: number, ny: number, s: number) => {
    const el = containerRef.current;
    if (!el) return { x: nx, y: ny };
    const rect = el.getBoundingClientRect();
    const maxX = (rect.width * (s - 1)) / 2;
    const maxY = (rect.height * (s - 1)) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, nx)),
      y: Math.max(-maxY, Math.min(maxY, ny)),
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      const pts = Array.from(pointers.current.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      gestureStart.current = {
        distance: Math.hypot(dx, dy),
        scale,
        tx,
        ty,
        midX: (pts[0].x + pts[1].x) / 2,
        midY: (pts[0].y + pts[1].y) / 2,
      };
      panStart.current = null;
    } else if (pointers.current.size === 1 && scale > 1) {
      panStart.current = { x: e.clientX, y: e.clientY, tx, ty };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2 && gestureStart.current) {
      const pts = Array.from(pointers.current.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.hypot(dx, dy);
      const nextScale = Math.max(1, Math.min(6, (gestureStart.current.scale * dist) / gestureStart.current.distance));
      const clamped = clampPan(gestureStart.current.tx, gestureStart.current.ty, nextScale);
      setScale(nextScale);
      setTx(clamped.x);
      setTy(clamped.y);
    } else if (pointers.current.size === 1 && panStart.current && scale > 1) {
      const nx = panStart.current.tx + (e.clientX - panStart.current.x);
      const ny = panStart.current.ty + (e.clientY - panStart.current.y);
      const clamped = clampPan(nx, ny, scale);
      setTx(clamped.x);
      setTy(clamped.y);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gestureStart.current = null;
    if (pointers.current.size === 0) panStart.current = null;

    // double-tap to toggle zoom
    const now = Date.now();
    if (now - lastTap.current < 280 && pointers.current.size === 0) {
      if (scale > 1) reset();
      else setScale(2.5);
      lastTap.current = 0;
    } else {
      lastTap.current = now;
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY;
    const nextScale = Math.max(1, Math.min(6, scale * (delta > 0 ? 1.15 : 1 / 1.15)));
    const clamped = clampPan(tx, ty, nextScale);
    setScale(nextScale);
    setTx(clamped.x);
    setTy(clamped.y);
  };

  if (!open || photos.length === 0) return null;

  const current = photos[Math.max(0, Math.min(photos.length - 1, index))];

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/95 flex flex-col animate-in fade-in"
      role="dialog"
      aria-modal="true"
    >
      {/* Top bar */}
      <div className="flex items-center justify-between p-3 text-white gap-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="text-sm font-medium truncate flex-1">
          {current.caption ? current.caption : `Photo ${index + 1} of ${photos.length}`}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="text-white hover:bg-white/10 h-9 w-9"
            onClick={() => setScale((s) => Math.max(1, s / 1.25))}
            aria-label="Zoom out"
          >
            <ZoomOut className="h-5 w-5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="text-white hover:bg-white/10 h-9 w-9"
            onClick={() => setScale((s) => Math.min(6, s * 1.25))}
            aria-label="Zoom in"
          >
            <ZoomIn className="h-5 w-5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="text-white hover:bg-white/10 h-9 w-9"
            onClick={reset}
            aria-label="Reset"
          >
            <RotateCcw className="h-5 w-5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="text-white hover:bg-white/10 h-9 w-9"
            onClick={() => {
              const a = document.createElement('a');
              a.href = current.url;
              a.download = current.caption || `photo-${index + 1}.jpg`;
              a.target = '_blank';
              a.rel = 'noopener noreferrer';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            }}
            aria-label="Download"
          >
            <Download className="h-5 w-5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="text-white hover:bg-white/10 h-9 w-9"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
          >
            <X className="h-6 w-6" />
          </Button>
        </div>
      </div>

      {/* Image stage */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <img
          src={current.url}
          alt={current.caption || `Photo ${index + 1}`}
          draggable={false}
          className={cn(
            'absolute inset-0 m-auto max-w-full max-h-full object-contain will-change-transform',
            scale > 1 ? 'cursor-grab' : 'cursor-zoom-in'
          )}
          style={{
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transition: pointers.current.size === 0 ? 'transform 120ms ease-out' : 'none',
          }}
        />

        {photos.length > 1 && (
          <>
            <Button
              size="icon"
              variant="ghost"
              className="absolute left-2 top-1/2 -translate-y-1/2 text-white hover:bg-white/10 h-11 w-11"
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={index === 0}
              aria-label="Previous"
            >
              <ChevronLeft className="h-7 w-7" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-white hover:bg-white/10 h-11 w-11"
              onClick={() => setIndex((i) => Math.min(photos.length - 1, i + 1))}
              disabled={index === photos.length - 1}
              aria-label="Next"
            >
              <ChevronRight className="h-7 w-7" />
            </Button>
          </>
        )}
      </div>

      {/* Thumbnails */}
      {photos.length > 1 && (
        <div className="flex gap-2 p-2 overflow-x-auto bg-black/80 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {photos.map((p, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIndex(i)}
              className={cn(
                'h-14 w-14 shrink-0 rounded overflow-hidden border-2 transition',
                i === index ? 'border-white' : 'border-transparent opacity-60 hover:opacity-100'
              )}
            >
              <img src={p.url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
