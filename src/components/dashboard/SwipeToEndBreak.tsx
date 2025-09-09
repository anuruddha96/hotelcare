import React, { useState, useRef } from 'react';
import { Clock, ChevronRight } from 'lucide-react';

interface SwipeToEndBreakProps {
  onSwipeComplete: () => void;
  disabled?: boolean;
}

export function SwipeToEndBreak({ onSwipeComplete, disabled = false }: SwipeToEndBreakProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragDistance, setDragDistance] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const maxDistance = 200; // Distance needed to complete swipe

  const handleStart = (clientX: number) => {
    if (disabled || isCompleted) return;
    setIsDragging(true);
    startX.current = clientX;
    setDragDistance(0);
  };

  const handleMove = (clientX: number) => {
    if (!isDragging || disabled || isCompleted) return;
    
    const distance = Math.max(0, Math.min(maxDistance, clientX - startX.current));
    setDragDistance(distance);
  };

  const handleEnd = () => {
    if (!isDragging || disabled || isCompleted) return;
    
    setIsDragging(false);
    
    if (dragDistance >= maxDistance * 0.8) { // 80% of the way
      setIsCompleted(true);
      setDragDistance(maxDistance);
      setTimeout(() => {
        onSwipeComplete();
      }, 300);
    } else {
      // Snap back
      setDragDistance(0);
    }
  };

  // Mouse events
  const handleMouseDown = (e: React.MouseEvent) => {
    handleStart(e.clientX);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    handleMove(e.clientX);
  };

  const handleMouseUp = () => {
    handleEnd();
  };

  // Touch events
  const handleTouchStart = (e: React.TouchEvent) => {
    handleStart(e.touches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    handleMove(e.touches[0].clientX);
  };

  const handleTouchEnd = () => {
    handleEnd();
  };

  const progress = (dragDistance / maxDistance) * 100;
  const thumbPosition = Math.min(dragDistance, maxDistance - 50); // 50px is thumb width

  return (
    <div className="w-full space-y-2">
      <div className="text-center text-sm text-muted-foreground">
        Swipe right to end break →
      </div>
      
      <div 
        ref={containerRef}
        className="relative w-full h-14 bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200 rounded-full overflow-hidden cursor-pointer select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={isDragging ? handleMouseMove : undefined}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={isDragging ? handleTouchMove : undefined}
        onTouchEnd={handleTouchEnd}
      >
        {/* Progress background */}
        <div 
          className="absolute inset-0 bg-gradient-to-r from-green-400 to-emerald-400 transition-all duration-300 ease-out"
          style={{ 
            width: `${progress}%`,
            opacity: 0.3 
          }}
        />
        
        {/* Text */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex items-center gap-2 text-green-700 font-semibold">
            <Clock className="h-5 w-5" />
            <span>Back to Work!</span>
            <span className="text-xl">⚡</span>
          </div>
        </div>
        
        {/* Draggable thumb */}
        <div 
          className={`absolute left-1 top-1 bottom-1 w-12 bg-gradient-to-r from-green-500 to-emerald-500 rounded-full shadow-lg flex items-center justify-center transition-all duration-300 ease-out ${
            isDragging ? 'scale-110' : 'scale-100'
          } ${isCompleted ? 'bg-gradient-to-r from-green-600 to-emerald-600' : ''}`}
          style={{ 
            transform: `translateX(${thumbPosition}px)`,
            transition: isDragging ? 'none' : 'transform 0.3s ease-out, scale 0.2s ease-out'
          }}
        >
          <ChevronRight className="h-6 w-6 text-white" />
        </div>
        
        {/* Pulse animation for the thumb when not dragging */}
        {!isDragging && !isCompleted && (
          <div 
            className="absolute left-1 top-1 bottom-1 w-12 bg-green-400 rounded-full opacity-50 animate-ping"
          />
        )}
      </div>
      
      <div className="text-center text-xs text-green-600">
        {progress > 60 ? 'Almost there!' : 'Slide to confirm'}
      </div>
    </div>
  );
}