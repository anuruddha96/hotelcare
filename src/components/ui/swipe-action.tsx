import React, { useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';

interface SwipeActionProps {
  label: string;
  onComplete: () => Promise<void> | void;
  disabled?: boolean;
}

// Generic swipe-right action button (no emojis)
export function SwipeAction({ label, onComplete, disabled = false }: SwipeActionProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragDistance, setDragDistance] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);
  const startX = useRef(0);
  const maxDistance = 220; // required distance to complete

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

    if (dragDistance >= maxDistance * 0.8) {
      setIsCompleted(true);
      setDragDistance(maxDistance);
      try {
        await onComplete();
      } finally {
        // reset after action so the control can be reused
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
      <div className="relative w-full h-12 rounded-full border border-border/60 bg-background/70 overflow-hidden"
        onMouseDown={(e) => begin(e.clientX)}
        onMouseMove={(e) => isDragging && move(e.clientX)}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={(e) => begin(e.touches[0].clientX)}
        onTouchMove={(e) => isDragging && move(e.touches[0].clientX)}
        onTouchEnd={end}
        aria-disabled={disabled}
      >
        {/* progress fill */}
        <div
          className="absolute inset-y-0 left-0 bg-primary/20 transition-all duration-200"
          style={{ width: `${progress}%` }}
        />
        {/* label */}
        <div className="absolute inset-0 grid place-items-center">
          <span className="text-sm font-medium text-foreground/80">{label}</span>
        </div>
        {/* thumb */}
        <div
          className={`absolute left-1 top-1 bottom-1 w-10 rounded-full bg-primary shadow-md flex items-center justify-center transition-transform ${
            isDragging ? 'scale-105' : ''
          }`}
          style={{ transform: `translateX(${thumbX}px)` }}
        >
          <ChevronRight className="h-5 w-5 text-primary-foreground" />
        </div>
      </div>
      <div className="text-center text-xs text-muted-foreground">
        {disabled ? '...' : progress > 60 ? 'Keep swiping' : 'Swipe right to continue'}
      </div>
    </div>
  );
}

export default SwipeAction;
