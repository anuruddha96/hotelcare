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
  const { t } = useTranslation();
  const { user } = useAuth();
  const [resolutionText, setResolutionText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!user || !resolutionText.trim()) {
      toast.error('Please enter resolution details');
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase
        .from('maintenance_issues')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          resolved_by: user.id,
          resolution_text: resolutionText.trim()
        })
        .eq('id', issueId);

      if (error) throw error;

      toast.success('Maintenance issue marked as resolved');
      setResolutionText('');
      onResolved();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error marking issue as resolved:', error);
      toast.error('Failed to mark issue as resolved: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setResolutionText('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
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

        <DialogFooter>
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
