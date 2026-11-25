import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslation } from '@/hooks/useTranslation';
import { useNtakBackdating } from '@/hooks/useNtakBackdating';
import { budapestToday } from '@/lib/businessMoment';

export function BusinessDayField({ hotelId, value, onChange }: {
  hotelId?: string | null; value: string; onChange: (day: string) => void;
}) {
  const policy = useNtakBackdating(hotelId);
  const { t } = useTranslation();
  if (!policy.allowed) return null;
  return (
    <div className="space-y-1">
      <Label className="text-xs">{t('pms.businessMoment.businessDay')}</Label>
      <Input type="date" className="h-9" value={value} min={policy.minimum} max={budapestToday()}
        onChange={(e) => onChange(e.target.value)} />
      <p className="text-[11px] text-muted-foreground">{t('pms.businessMoment.noon')}</p>
    </div>
  );
}
