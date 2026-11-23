import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { useNtakBackdating } from '@/hooks/useNtakBackdating';
import { budapestDateTime, budapestWallToIso, formatBudapestMoment } from '@/lib/businessMoment';
import { useTranslation } from '@/hooks/useTranslation';

export function useBusinessMoment(hotelId: string | undefined, open: boolean) {
  const { allowed, minimum } = useNtakBackdating(hotelId);
  const [expanded, setExpanded] = useState(false);
  const [wall, setWall] = useState(() => budapestDateTime());
  useEffect(() => {
    if (open) { setExpanded(false); setWall(budapestDateTime()); }
  }, [open, hotelId]);
  let occurredAt: string | null = null;
  let invalid = false;
  if (allowed && expanded) {
    try {
      occurredAt = budapestWallToIso(wall);
      invalid = !!minimum && wall.slice(0, 10) < minimum
        || Date.parse(occurredAt) > Date.now() + 5 * 60_000;
    } catch { invalid = true; }
  }
  return {
    allowed, minimum, expanded, setExpanded, wall, setWall,
    occurredAt: invalid ? null : occurredAt,
    invalid, display: allowed && expanded && occurredAt
      ? formatBudapestMoment(occurredAt) : formatBudapestMoment(new Date().toISOString()),
  };
}

export type BusinessMomentControl = ReturnType<typeof useBusinessMoment>;

export function BusinessMomentField({ control }: { control: BusinessMomentControl }) {
  const { t } = useTranslation();
  if (!control.allowed) return null;
  return (
    <div className="rounded-md border border-border p-2 text-xs space-y-2">
      <button type="button" className="flex items-center gap-2 w-full text-left font-medium"
        aria-expanded={control.expanded} onClick={() => control.setExpanded(!control.expanded)}>
        <span aria-hidden="true">{control.expanded ? '▾' : '▸'}</span>
        {t('pms.businessMoment.recordAnother')}
      </button>
      {control.expanded && (
        <div className="space-y-1.5">
          <Input type="datetime-local" className="h-9" value={control.wall}
            min={control.minimum ? `${control.minimum}T00:00` : undefined}
            max={budapestDateTime()} onChange={(e) => control.setWall(e.target.value)}
            aria-label={t('pms.businessMoment.dateTime')} />
          <p className="text-muted-foreground">{t('pms.businessMoment.budapest')}</p>
          {control.invalid && <p role="alert" className="text-destructive">{t('pms.businessMoment.invalid')}</p>}
        </div>
      )}
    </div>
  );
}
