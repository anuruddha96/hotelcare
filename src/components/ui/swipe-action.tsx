import React, { useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';

interface SwipeActionProps {
  label: string;
  onComplete: () => Promise<void> | void;
  disabled?: boolean;
}

/**
 * Generic swipe-right action button.
 *
 * Idle-state affordances (industry-standard swipe cues):
 *   • Right-moving gradient "sheen" across the track
 *   • Thumb nudge (gently drifts right and returns)
 *   • Ghost chevron trail fading to the right of the thumb
 * All idle animations pause once the user starts dragging or completes the
 * gesture, and respect `prefers-reduced-motion` via the `motion-safe:` prefix.
 */
export function SwipeAction({ label, onComplete, disabled = false }: SwipeActionProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragDistance, setDragDistance] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);
  const startX = useRef(0);
  const maxDistance = 220;

  const idle = !isDragging && !isCompleted && !disabled;

  const begin = (x: number) => {
    if (disabled || isCompleted) return;
    setIsDragging(true);
    startX.current = x;
    setDragDistance(0);
  };

  const move = (x: number) => {
    if (!isDragging || disabled || isCompleted) return;
    const d = Math.max(0, Math.min(maxDistance, x - startX.current));
    setDragDistance(d);
  };

  const end = async () => {
    if (!isDragging || disabled || isCompleted) return;
    setIsDragging(false);

    if (dragDistance >= maxDistance * 0.7) {
      setIsCompleted(true);
      setDragDistance(maxDistance);
      try {
        await onComplete();
      } catch (error) {
        console.error('Error in onComplete:', error);
      } finally {
        setTimeout(() => {
          setIsCompleted(false);
          setDragDistance(0);
        }, 600);
      }
    } else {
      setDragDistance(0);
    }
  };

  const progress = (dragDistance / maxDistance) * 100;
  const thumbX = Math.min(dragDistance, maxDistance - 52);

  return (
    <div className="w-full space-y-2 select-none">
      <style>{`
        @keyframes swipe-hint-sheen {
          0%   { transform: translateX(-40%); opacity: 0; }
          25%  { opacity: 1; }
          75%  { opacity: 1; }
          100% { transform: translateX(140%); opacity: 0; }
        }
        @keyframes swipe-hint-nudge {
          0%, 100% { transform: translateX(0); }
          50%      { transform: translateX(8px); }
        }
        @keyframes swipe-hint-chev {
          0%   { opacity: 0; transform: translateX(-6px); }
          40%  { opacity: 0.55; }
          100% { opacity: 0; transform: translateX(10px); }
        }
        @keyframes swipe-hint-glow {
          0%, 100% { box-shadow: 0 0 0 0 hsl(var(--primary) / 0.35); }
          50%      { box-shadow: 0 0 0 8px hsl(var(--primary) / 0); }
        }
      `}</style>

      <div
        className="relative w-full h-12 rounded-full border border-border/60 bg-background/70 overflow-hidden"
        onMouseDown={(e) => begin(e.clientX)}
        onMouseMove={(e) => isDragging && move(e.clientX)}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={(e) => begin(e.touches[0].clientX)}
        onTouchMove={(e) => isDragging && move(e.touches[0].clientX)}
        onTouchEnd={end}
        aria-disabled={disabled}
      >
        {/* Idle sheen sweeping right — the primary persuasion cue */}
        {idle && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-1/2 motion-safe:block hidden bg-gradient-to-r from-transparent via-primary/25 to-transparent"
            style={{ animation: 'swipe-hint-sheen 2s ease-in-out infinite' }}
          />
        )}

        {/* Progress fill while dragging */}
        <div
          className="absolute inset-y-0 left-0 bg-primary/20 transition-all duration-200"
          style={{ width: `${progress}%` }}
        />

        {/* Label */}
        <div className="absolute inset-0 grid place-items-center">
          <span className="text-sm font-medium text-foreground/80">{label}</span>
        </div>

        {/* Ghost chevron trail to the right of the thumb */}
        {idle && (
          <div
            aria-hidden
            className="pointer-events-none absolute top-1/2 -translate-y-1/2 motion-safe:flex hidden items-center gap-0.5 text-primary/60"
            style={{ left: `${thumbX + 56}px` }}
          >
            <ChevronRight
              className="h-4 w-4"
              style={{ animation: 'swipe-hint-chev 1.6s ease-in-out infinite' }}
            />
            <ChevronRight
              className="h-4 w-4 -ml-2"
              style={{ animation: 'swipe-hint-chev 1.6s ease-in-out infinite', animationDelay: '0.25s' }}
            />
            <ChevronRight
              className="h-4 w-4 -ml-2"
              style={{ animation: 'swipe-hint-chev 1.6s ease-in-out infinite', animationDelay: '0.5s' }}
            />
          </div>
        )}

        {/* Thumb */}
        <div
          className={`absolute left-1 top-1 bottom-1 w-10 rounded-full bg-primary shadow-md flex items-center justify-center transition-transform ${
            isDragging ? 'scale-105' : ''
          }`}
          style={{ transform: `translateX(${thumbX}px)` }}
        >
          <div
            className="absolute inset-0 rounded-full motion-safe:block hidden"
            style={idle ? { animation: 'swipe-hint-glow 1.8s ease-out infinite' } : undefined}
          />
          <div
            className="relative flex items-center justify-center motion-safe:animate-none"
            style={idle ? { animation: 'swipe-hint-nudge 1.6s ease-in-out infinite' } : undefined}
          >
            <ChevronRight className="h-5 w-5 text-primary-foreground" />
          </div>
        </div>
      </div>
      <div className="text-center text-xs text-muted-foreground">
        {disabled ? '...' : progress > 60 ? 'Keep swiping' : 'Swipe right to continue'}
      </div>
    </div>
  );
}

export default SwipeAction;
