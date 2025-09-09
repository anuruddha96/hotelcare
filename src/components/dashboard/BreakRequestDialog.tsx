import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from 'sonner';
import { Clock } from 'lucide-react';

interface BreakType {
  id: string;
  name: string;
  display_name: string;
  duration_minutes: number;
  icon_name: string;
}

interface BreakRequestDialogProps {
  onRequestSubmitted: () => void;
}

export function BreakRequestDialog({ onRequestSubmitted }: BreakRequestDialogProps) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [breakTypes, setBreakTypes] = useState<BreakType[]>([]);
  const [selectedBreakType, setSelectedBreakType] = useState<string>('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchBreakTypes();
  }, []);

  const fetchBreakTypes = async () => {
    const { data } = await supabase
      .from('break_types')
      .select('*')
      .eq('is_active', true)
      .neq('name', 'lunch') // Exclude lunch break as it's handled separately
      .order('name');
    
    if (data) {
      setBreakTypes(data);
    }
  };

  const handleSubmit = async () => {
    if (!selectedBreakType || !reason.trim()) {
      toast.error(t('breakRequest.fillAllFields'));
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('break_requests')
        .insert([
          {
            user_id: user?.id,
            requested_by: user?.id,
            break_type_id: selectedBreakType,
            reason: reason.trim(),
            status: 'pending'
          }
        ]);

      if (error) throw error;

      toast.success(t('breakRequest.requestSubmitted'));
      setOpen(false);
      setSelectedBreakType('');
      setReason('');
      onRequestSubmitted();
    } catch (error) {
      console.error('Error submitting break request:', error);
      toast.error(t('breakRequest.submitError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
          {t('breakRequest.requestSpecialBreak')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('breakRequest.requestSpecialBreak')}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="break-type">{t('breakRequest.selectBreakType')}</Label>
            <Select value={selectedBreakType} onValueChange={setSelectedBreakType}>
              <SelectTrigger>
                <SelectValue placeholder={t('breakRequest.chooseBreakType')} />
              </SelectTrigger>
              <SelectContent>
                {breakTypes.map((breakType) => (
                  <SelectItem key={breakType.id} value={breakType.id}>
                    <div className="flex items-center gap-2">
                      <span>{breakType.display_name}</span>
                      <span className="text-muted-foreground text-sm">
                        ({breakType.duration_minutes} {t('common.minutes')})
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">{t('breakRequest.reason')}</Label>
            <Textarea
              id="reason"
              placeholder={t('breakRequest.reasonPlaceholder')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? t('common.loading') : t('breakRequest.submitRequest')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}