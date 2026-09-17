import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle, X } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface MaintenanceResolutionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issueId: string;
  roomNumber: string;
  issueDescription: string;
  onResolved: () => void;
}

export function MaintenanceResolutionDialog({
  open,
  onOpenChange,
  issueId,
  roomNumber,
  issueDescription,
  onResolved
}: MaintenanceResolutionDialogProps) {
  const { t, language } = useTranslation();
  const { user } = useAuth();
  const [resolutionText, setResolutionText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isHungarian = language === 'hu';

  const handleSubmit = async () => {
    if (isSubmitting) return;
    if (!user || !resolutionText.trim()) {
      toast.error(isHungarian ? 'Adja meg a javítás részleteit.' : 'Please enter resolution details');
      return;
    }

    setIsSubmitting(true);

    try {
      // Resolve only issues that are still in an active lifecycle state. This
      // prevents a stale dialog from reopening/overwriting a ticket that another
      // technician has already closed, cancelled, or otherwise moved out of the
      // actionable workflow. Supabase zero-row updates are not errors, so select
      // the updated id and treat an empty result as a lifecycle conflict.
      const { data, error } = await supabase
        .from('maintenance_issues')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          resolved_by: user.id,
          resolution_text: resolutionText.trim()
        })
        .eq('id', issueId)
        .in('status', ['open', 'pending', 'in_progress'])
        .is('resolved_at', null)
        .select('id');

      if (error) throw error;

      if (!data?.length) {
        toast.error(isHungarian
          ? 'A hiba állapota közben megváltozott. A lista frissült.'
          : 'This issue changed status while you were working. The list has been refreshed.');
        setResolutionText('');
        onResolved();
        onOpenChange(false);
        return;
      }

      toast.success(isHungarian ? 'A karbantartási hiba megoldva.' : 'Maintenance issue marked as resolved');
      setResolutionText('');
      onResolved();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error marking issue as resolved:', error);
      toast.error((isHungarian ? 'Nem sikerült megoldottnak jelölni: ' : 'Failed to mark issue as resolved: ') + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (isSubmitting) return;
    setResolutionText('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[94vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            {t('maintenance.markResolved')} - {t('common.room')} {roomNumber}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="p-4 bg-muted rounded-lg">
            <Label className="font-semibold">{t('maintenance.issueDescription')}</Label>
            <p className="mt-2 text-sm">{issueDescription}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="resolution">{t('maintenance.resolution')} *</Label>
            <Textarea
              id="resolution"
              placeholder={t('maintenance.resolutionPlaceholder')}
              value={resolutionText}
              onChange={(e) => setResolutionText(e.target.value)}
              rows={6}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            onClick={handleClose}
            variant="outline"
            disabled={isSubmitting}
          >
            <X className="h-4 w-4 mr-2" />
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !resolutionText.trim()}
            className="bg-green-600 hover:bg-green-700"
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            {isSubmitting ? t('common.saving') : t('maintenance.markResolved')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
