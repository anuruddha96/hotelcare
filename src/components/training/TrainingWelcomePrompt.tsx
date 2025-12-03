import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { BookOpen, Play, X } from 'lucide-react';
import { useTrainingGuide } from '@/contexts/TrainingGuideContext';

export function TrainingWelcomePrompt() {
  const { 
    pendingAssignments, 
    startTraining, 
    getTranslatedUI,
    getTranslatedGuide,
  } = useTrainingGuide();
  
  const [open, setOpen] = useState(false);
  const ui = getTranslatedUI();

  useEffect(() => {
    // Check if there are pending assigned trainings
    const assignedTrainings = pendingAssignments.filter(a => a.status === 'assigned');
    
    if (assignedTrainings.length > 0) {
      // Check if we've shown the prompt recently
      const lastPromptTime = localStorage.getItem('training_prompt_shown');
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;
      
      if (!lastPromptTime || now - parseInt(lastPromptTime) > oneHour) {
        setOpen(true);
        localStorage.setItem('training_prompt_shown', String(now));
      }
    }
  }, [pendingAssignments]);

  const firstAssignment = pendingAssignments.find(a => a.status === 'assigned');
  
  if (!firstAssignment) return null;

  const handleStart = () => {
    setOpen(false);
    startTraining(firstAssignment.guide_id);
  };

  const handleSkip = () => {
    setOpen(false);
  };

  const guide = firstAssignment.guide;
  const translatedGuide = guide ? getTranslatedGuide(guide.slug) : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-4 p-3 rounded-full bg-primary/10">
            <BookOpen className="h-8 w-8 text-primary" />
          </div>
          <DialogTitle className="text-center text-xl">
            {ui.startTraining}
          </DialogTitle>
          <DialogDescription className="text-center">
            {translatedGuide?.description || guide?.description}
          </DialogDescription>
        </DialogHeader>

        {translatedGuide && (
          <div className="py-4">
            <div className="text-center">
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted">
                <BookOpen className="h-4 w-4" />
                <span className="font-medium">{translatedGuide.name}</span>
              </span>
            </div>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={handleSkip} className="flex-1">
            <X className="h-4 w-4 mr-2" />
            {ui.skipButton}
          </Button>
          <Button onClick={handleStart} className="flex-1">
            <Play className="h-4 w-4 mr-2" />
            {ui.startTraining}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
