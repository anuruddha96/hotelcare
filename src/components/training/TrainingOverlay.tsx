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

  const ui = getTranslatedUI();

  const updateTargetPosition = useCallback(() => {
    if (!currentStep?.target_selector) {
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
  }, [currentStep]);

  useEffect(() => {
    if (isTrainingActive) {
      updateTargetPosition();
      
      // Update position on resize/scroll
      const handleUpdate = () => updateTargetPosition();
      window.addEventListener('resize', handleUpdate);
      window.addEventListener('scroll', handleUpdate, true);
      
      // Poll for element changes (e.g., after animations)
      const interval = setInterval(handleUpdate, 500);
      
      return () => {
        window.removeEventListener('resize', handleUpdate);
        window.removeEventListener('scroll', handleUpdate, true);
        clearInterval(interval);
      };
    }
  }, [isTrainingActive, currentStep, updateTargetPosition]);

  const handleNext = () => {
    if (currentStepIndex === totalSteps - 1) {
      setShowCompletion(true);
    } else {
      nextStep();
    }
  };

  const handleComplete = async () => {
    setShowCompletion(false);
    await completeTraining();
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
        onOpenChange={setShowCompletion}
        onComplete={handleComplete}
        guideName={currentGuide?.name || ''}
      />
    </>
  );
}
