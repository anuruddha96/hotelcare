import * as React from "react"
import { Button, ButtonProps } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface HoldButtonProps extends Omit<ButtonProps, 'onHoldComplete'> {
  holdDuration?: number
  onHoldComplete: () => void
  holdText?: string
  releaseText?: string
}

const HoldButton = React.forwardRef<HTMLButtonElement, HoldButtonProps>(
  ({ 
    children, 
    className, 
    holdDuration = 2000, 
    onHoldComplete, 
    disabled,
    holdText,
    releaseText,
    ...props 
  }, ref) => {
    const [isHolding, setIsHolding] = React.useState(false)
    const [progress, setProgress] = React.useState(0)
    const [isComplete, setIsComplete] = React.useState(false)
    const holdTimerRef = React.useRef<NodeJS.Timeout>()
    const progressIntervalRef = React.useRef<NodeJS.Timeout>()
    const startTimeRef = React.useRef<number>(0)

    const startHolding = () => {
      if (disabled || isComplete) return
      
      setIsHolding(true)
      setProgress(0)
      startTimeRef.current = Date.now()

      // Vibrate on mobile
      if (navigator.vibrate) {
        navigator.vibrate(50)
      }

      // Progress animation
      progressIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current
        const newProgress = Math.min((elapsed / holdDuration) * 100, 100)
        setProgress(newProgress)
      }, 16) // ~60fps

      // Complete action
      holdTimerRef.current = setTimeout(() => {
        setIsComplete(true)
        setIsHolding(false)
        
        // Success vibration pattern
        if (navigator.vibrate) {
          navigator.vibrate([50, 100, 50])
        }

        // Trigger completion
        onHoldComplete()

        // Reset after animation
        setTimeout(() => {
          setIsComplete(false)
          setProgress(0)
        }, 500)
      }, holdDuration)
    }

    const stopHolding = () => {
      if (isComplete) return
      
      setIsHolding(false)
      setProgress(0)
      
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current)
      }
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current)
      }
    }

    React.useEffect(() => {
      return () => {
        if (holdTimerRef.current) clearTimeout(holdTimerRef.current)
        if (progressIntervalRef.current) clearInterval(progressIntervalRef.current)
      }
    }, [])

    return (
      <div className="relative inline-flex">
        <Button
          ref={ref}
          className={cn(
            "relative overflow-hidden transition-all duration-300",
            isHolding && "scale-105 shadow-lg",
            isComplete && "scale-95",
            className
          )}
          disabled={disabled}
          onMouseDown={startHolding}
          onMouseUp={stopHolding}
          onMouseLeave={stopHolding}
          onTouchStart={startHolding}
          onTouchEnd={stopHolding}
          {...props}
        >
          {/* Background progress indicator */}
          <div 
            className={cn(
              "absolute inset-0 bg-primary-foreground/20 transition-all duration-100",
              isComplete && "bg-green-500/30"
            )}
            style={{ 
              width: `${progress}%`,
              transition: progress === 0 ? 'none' : 'width 16ms linear'
            }}
          />
          
          {/* Content */}
          <span className="relative z-10 flex items-center gap-2">
            {isComplete ? (
              <svg className="h-5 w-5 animate-scale-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : children}
          </span>
        </Button>

        {/* Circular progress ring */}
        {isHolding && !isComplete && (
          <svg 
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ transform: 'rotate(-90deg)' }}
          >
            <circle
              cx="50%"
              cy="50%"
              r="calc(50% - 2px)"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeDasharray={`${2 * Math.PI * 50}`}
              strokeDashoffset={`${2 * Math.PI * 50 * (1 - progress / 100)}`}
              className="text-primary transition-all duration-100"
              style={{
                transition: 'stroke-dashoffset 16ms linear'
              }}
            />
          </svg>
        )}

      </div>
    )
  }
)

HoldButton.displayName = "HoldButton"

export { HoldButton }
