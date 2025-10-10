import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/useTranslation";

interface HousekeeperRatingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  housekeeperId: string;
  housekeeperName: string;
  assignmentId?: string;
  onRatingSubmitted?: () => void;
}

export const HousekeeperRatingDialog = ({
  open,
  onOpenChange,
  housekeeperId,
  housekeeperName,
  assignmentId,
  onRatingSubmitted,
}: HousekeeperRatingDialogProps) => {
  const { t } = useTranslation();
  const [rating, setRating] = useState<number>(0);
  const [hoveredRating, setHoveredRating] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (rating === 0) {
      toast.error(t('ratings.selectRating'));
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase.from("housekeeper_ratings").insert({
        housekeeper_id: housekeeperId,
        rating: rating as any,
        assignment_id: assignmentId,
        notes: notes.trim() || null,
      } as any);

      if (error) throw error;

      toast.success(t('ratings.ratingSubmitted'));
      onOpenChange(false);
      setRating(0);
      setNotes("");
      if (onRatingSubmitted) onRatingSubmitted();
    } catch (error) {
      console.error("Error submitting rating:", error);
      toast.error(t('ratings.errorSubmitting'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('ratings.rateHousekeeper')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-2">
              {t('ratings.rating')} <span className="font-semibold">{housekeeperName}</span>
            </p>
          </div>

          {/* Star Rating */}
          <div className="flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setRating(star)}
                onMouseEnter={() => setHoveredRating(star)}
                onMouseLeave={() => setHoveredRating(0)}
                className="transition-transform hover:scale-110 focus:outline-none"
              >
                <Star
                  className={`h-10 w-10 transition-colors ${
                    star <= (hoveredRating || rating)
                      ? "fill-yellow-400 text-yellow-400"
                      : "text-gray-300"
                  }`}
                />
              </button>
            ))}
          </div>

          {rating > 0 && (
            <div className="text-center">
              <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                {rating}.0
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {rating === 5
                  ? t('ratings.excellent')
                  : rating === 4
                  ? t('ratings.good')
                  : rating === 3
                  ? t('ratings.average')
                  : rating === 2
                  ? t('ratings.belowAverage')
                  : t('ratings.needsImprovement')}
              </p>
            </div>
          )}

          {/* Notes (Optional) */}
          <div>
            <label className="text-sm font-medium mb-2 block">
              {t('ratings.notesOptional')}
            </label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('ratings.notesPlaceholder')}
              rows={3}
              maxLength={500}
            />
          </div>

          {/* Submit Button */}
          <Button
            onClick={handleSubmit}
            disabled={rating === 0 || isSubmitting}
            className="w-full"
          >
            {isSubmitting ? t('ratings.submitting') : t('ratings.submitRating')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
