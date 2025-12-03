import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CheckCircle, PartyPopper, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTrainingGuide } from '@/contexts/TrainingGuideContext';

interface TrainingCompletionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
  guideName: string;
  loading?: boolean;
}

export function TrainingCompletionDialog({
  open,
  onOpenChange,
  onComplete,
  guideName,
  loading = false,
}: TrainingCompletionDialogProps) {
  const { getTranslatedUI, getTranslatedGuide } = useTrainingGuide();
  const ui = getTranslatedUI();
  
  // Get the translated guide name if available
  const guideSlug = guideName.toLowerCase().replace(/\s+/g, '-');
  const translatedGuide = getTranslatedGuide(guideSlug);
  const displayName = translatedGuide.name || guideName;

  const handleComplete = () => {
    if (!loading) {
      onComplete();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 15 }}
            className="mx-auto mb-4"
          >
            <div className="relative">
              <CheckCircle className="h-16 w-16 text-green-500" />
              <motion.div
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 }}
                className="absolute -top-2 -right-2"
              >
                <PartyPopper className="h-8 w-8 text-yellow-500" />
              </motion.div>
            </div>
          </motion.div>
          
          <DialogTitle className="text-2xl">
            {ui.trainingComplete}
          </DialogTitle>
          <DialogDescription className="text-base">
            {ui.congratulations}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary">
            <CheckCircle className="h-4 w-4" />
            <span className="font-medium">{displayName}</span>
          </div>
        </div>

        <DialogFooter>
          <Button 
            onClick={handleComplete} 
            className="w-full"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Finishing...
              </>
            ) : (
              ui.finishButton
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
