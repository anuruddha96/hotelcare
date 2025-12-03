import { useEffect, useState, useCallback } from 'react';
import { useTrainingGuide } from '@/contexts/TrainingGuideContext';
import { TrainingTooltip } from './TrainingTooltip';
import { TrainingSpotlight } from './TrainingSpotlight';
import { TrainingCompletionDialog } from './TrainingCompletionDialog';

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

// Map step keys to required tab navigation
const STEP_TAB_MAPPING: { [key: string]: { mainTab: string; subTab?: string } } = {
  // Attendance steps
  'check_in': { mainTab: 'attendance' },
  'request_break': { mainTab: 'attendance' },
  'end_break': { mainTab: 'attendance' },
  'sign_out': { mainTab: 'attendance' },
  
  // Room/Housekeeping steps
  'view_rooms': { mainTab: 'housekeeping' },
  'start_room': { mainTab: 'housekeeping' },
  'capture_photos': { mainTab: 'housekeeping' },
  'dirty_linen': { mainTab: 'housekeeping' },
  'complete_room': { mainTab: 'housekeeping' },
  'mark_dnd': { mainTab: 'housekeeping' },
  'retrieve_dnd': { mainTab: 'housekeeping' },
  
  // DND specific
  'dnd_management': { mainTab: 'housekeeping', subTab: 'dnd-photos' },
};

export function TrainingOverlay() {
  const {
    isTrainingActive,
    currentStep,
    currentStepIndex,
    totalSteps,
    currentGuide,
    nextStep,
    prevStep,
    exitTraining,
    completeTraining,
    getTranslatedStep,
    getTranslatedUI,
  } = useTrainingGuide();

  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [showCompletion, setShowCompletion] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [completionLoading, setCompletionLoading] = useState(false);

  const ui = getTranslatedUI();

  // Navigate to the correct tab for a step
  const navigateToStep = useCallback((stepKey: string) => {
    const mapping = STEP_TAB_MAPPING[stepKey];
    if (!mapping) return;

    setIsNavigating(true);

    // Dispatch custom event for Dashboard to listen to
    const event = new CustomEvent('training-navigate', {
      detail: { mainTab: mapping.mainTab, subTab: mapping.subTab }
    });
    window.dispatchEvent(event);

    // Wait for DOM to update
    setTimeout(() => {
      setIsNavigating(false);
    }, 600);
  }, []);

  const updateTargetPosition = useCallback(() => {
    if (!currentStep?.target_selector || isNavigating) {
      setTargetRect(null);
      return;
    }

    const element = document.querySelector(currentStep.target_selector);
    if (element) {
      const rect = element.getBoundingClientRect();
      const padding = currentStep.highlight_padding || 8;
      
      setTargetRect({
        top: rect.top - padding + window.scrollY,
        left: rect.left - padding,
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
      });

      // Scroll element into view if needed
      const elementTop = rect.top;
      const elementBottom = rect.bottom;
      const viewportHeight = window.innerHeight;
      
      if (elementTop < 100 || elementBottom > viewportHeight - 100) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      setTargetRect(null);
    }
  }, [currentStep, isNavigating]);

  // Navigate when step changes
  useEffect(() => {
    if (isTrainingActive && currentStep?.step_key) {
      navigateToStep(currentStep.step_key);
    }
  }, [isTrainingActive, currentStep?.step_key, navigateToStep]);

  useEffect(() => {
    if (isTrainingActive && !isNavigating) {
      // Delay initial position update to allow for navigation
      const initialDelay = setTimeout(updateTargetPosition, 100);
      
      // Update position on resize/scroll
      const handleUpdate = () => updateTargetPosition();
      window.addEventListener('resize', handleUpdate);
      window.addEventListener('scroll', handleUpdate, true);
      
      // Poll for element changes (e.g., after animations)
      const interval = setInterval(handleUpdate, 500);
      
      return () => {
        clearTimeout(initialDelay);
        window.removeEventListener('resize', handleUpdate);
        window.removeEventListener('scroll', handleUpdate, true);
        clearInterval(interval);
      };
    }
  }, [isTrainingActive, currentStep, updateTargetPosition, isNavigating]);

  const handleNext = () => {
    if (currentStepIndex === totalSteps - 1) {
      setShowCompletion(true);
    } else {
      nextStep();
    }
  };

  const handleComplete = async () => {
    setCompletionLoading(true);
    try {
      await completeTraining();
    } catch (error) {
      console.error('Error completing training:', error);
    } finally {
      setCompletionLoading(false);
      setShowCompletion(false);
    }
  };

  const handleCompletionDialogChange = (open: boolean) => {
    if (!completionLoading) {
      setShowCompletion(open);
    }
  };

  if (!isTrainingActive || !currentStep) {
    return null;
  }

  const translation = getTranslatedStep(currentStep.step_key);
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === totalSteps - 1;

  return (
    <>
      {/* Dark overlay with spotlight cutout */}
      <div className="fixed inset-0 z-[9998] pointer-events-none">
        <TrainingSpotlight targetRect={targetRect} />
      </div>

      {/* Clickable overlay (blocks interactions except on target) */}
      <div 
        className="fixed inset-0 z-[9997]"
        style={{
          clipPath: targetRect 
            ? `polygon(
                0% 0%, 
                0% 100%, 
                ${targetRect.left}px 100%, 
                ${targetRect.left}px ${targetRect.top}px, 
                ${targetRect.left + targetRect.width}px ${targetRect.top}px, 
                ${targetRect.left + targetRect.width}px ${targetRect.top + targetRect.height}px, 
                ${targetRect.left}px ${targetRect.top + targetRect.height}px, 
                ${targetRect.left}px 100%, 
                100% 100%, 
                100% 0%
              )`
            : undefined,
        }}
      />

      {/* Tooltip */}
      <TrainingTooltip
        title={translation.title}
        content={translation.content}
        actionHint={translation.actionHint}
        actionType={currentStep.action_type}
        position={currentStep.position}
        targetRect={targetRect}
        currentStep={currentStepIndex + 1}
        totalSteps={totalSteps}
        onNext={handleNext}
        onPrev={prevStep}
        onExit={exitTraining}
        showPrev={!isFirstStep}
        showNext={true}
        nextLabel={isLastStep ? ui.finishButton : ui.nextButton}
        prevLabel={ui.prevButton}
        exitLabel={ui.exitButton}
        stepOfLabel={ui.stepOf}
      />

      {/* Completion dialog */}
      <TrainingCompletionDialog
        open={showCompletion}
        onOpenChange={handleCompletionDialogChange}
        onComplete={handleComplete}
        guideName={currentGuide?.name || ''}
        loading={completionLoading}
      />
    </>
  );
}
