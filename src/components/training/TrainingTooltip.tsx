import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { X, ChevronLeft, ChevronRight, MousePointerClick, Hand, Move } from 'lucide-react';

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface TrainingTooltipProps {
  title: string;
  content: string;
  actionHint?: string;
  actionType: string;
  position: string;
  targetRect: TargetRect | null;
  currentStep: number;
  totalSteps: number;
  onNext: () => void;
  onPrev: () => void;
  onExit: () => void;
  showPrev: boolean;
  showNext: boolean;
  nextLabel: string;
  prevLabel: string;
  exitLabel: string;
  stepOfLabel: string;
}

export function TrainingTooltip({
  title,
  content,
  actionHint,
  actionType,
  position,
  targetRect,
  currentStep,
  totalSteps,
  onNext,
  onPrev,
  onExit,
  showPrev,
  showNext,
  nextLabel,
  prevLabel,
  exitLabel,
  stepOfLabel,
}: TrainingTooltipProps) {
  const tooltipPosition = useMemo(() => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const tooltipWidth = Math.min(360, viewportWidth - 32);
    const tooltipHeight = 280; // Approximate height
    const margin = 16;

    if (!targetRect) {
      // Center the tooltip for welcome/intro steps
      return {
        top: viewportHeight / 2 - tooltipHeight / 2,
        left: viewportWidth / 2 - tooltipWidth / 2,
        arrowPosition: 'none',
      };
    }

    let top = 0;
    let left = 0;
    let arrowPosition = position;

    switch (position) {
      case 'bottom':
        top = targetRect.top + targetRect.height + margin;
        left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
        break;
      case 'top':
        top = targetRect.top - tooltipHeight - margin;
        left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
        break;
      case 'left':
        top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
        left = targetRect.left - tooltipWidth - margin;
        break;
      case 'right':
        top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
        left = targetRect.left + targetRect.width + margin;
        break;
      default:
        top = targetRect.top + targetRect.height + margin;
        left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
    }

    // Adjust for viewport boundaries
    if (left < margin) left = margin;
    if (left + tooltipWidth > viewportWidth - margin) {
      left = viewportWidth - tooltipWidth - margin;
    }
    if (top < margin) {
      top = targetRect.top + targetRect.height + margin;
      arrowPosition = 'bottom';
    }
    if (top + tooltipHeight > viewportHeight - margin) {
      top = targetRect.top - tooltipHeight - margin;
      arrowPosition = 'top';
    }

    return { top, left, arrowPosition };
  }, [targetRect, position]);

  const ActionIcon = useMemo(() => {
    switch (actionType) {
      case 'click':
        return MousePointerClick;
      case 'hold':
        return Hand;
      case 'swipe':
        return Move;
      default:
        return null;
    }
  }, [actionType]);

  const progressPercent = (currentStep / totalSteps) * 100;
  const stepText = stepOfLabel.replace('{current}', String(currentStep)).replace('{total}', String(totalSteps));

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="fixed z-[9999] w-full max-w-[360px] px-4"
      style={{
        top: tooltipPosition.top,
        left: tooltipPosition.left,
      }}
    >
      <Card className="shadow-2xl border-primary/20 bg-card/95 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <p className="text-xs text-muted-foreground mb-1">{stepText}</p>
              <h3 className="text-lg font-semibold text-foreground leading-tight">{title}</h3>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={onExit}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <Progress value={progressPercent} className="h-1 mt-2" />
        </CardHeader>

        <CardContent className="pb-3">
          <p className="text-sm text-muted-foreground leading-relaxed">{content}</p>
          
          {actionHint && ActionIcon && (
            <div className="mt-3 flex items-center gap-2 p-2 rounded-md bg-primary/10 text-primary">
              <ActionIcon className="h-4 w-4 shrink-0" />
              <span className="text-xs font-medium">{actionHint}</span>
            </div>
          )}
        </CardContent>

        <CardFooter className="pt-0 gap-2">
          {showPrev && (
            <Button
              variant="outline"
              size="sm"
              onClick={onPrev}
              className="flex-1"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              {prevLabel}
            </Button>
          )}
          {showNext && (
            <Button
              size="sm"
              onClick={onNext}
              className="flex-1"
            >
              {nextLabel}
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </CardFooter>
      </Card>
    </motion.div>
  );
}
