import React, { useMemo, useState } from 'react';
import { Clock3, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { housekeepingAutomationText } from '@/lib/housekeepingAutomationTranslations';
import {
  NEXT_DAY_RELEASE_TIMES,
  normalizeNextDayReleaseTime,
  updateNextDayReleaseTime,
  type NextDayReleaseTime,
} from '@/lib/nextDayReleaseTime';

type Plan = {
  id: string;
  status: 'draft' | 'approved' | 'releasing' | 'released' | 'cancelled' | 'failed';
  release_time: string | null;
  scheduled_release_at: string | null;
};

export function TomorrowReleaseTimeControl({
  plan,
  onSaved,
}: {
  plan: Plan | null;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const releaseTime = normalizeNextDayReleaseTime(plan?.release_time);
  const releaseLabel = housekeepingAutomationText('releaseAt').replace('08:00', releaseTime);

  const editable = useMemo(() => {
    if (!plan || !['draft', 'approved'].includes(plan.status)) return false;
    if (!plan.scheduled_release_at) return true;
    const scheduled = Date.parse(plan.scheduled_release_at);
    return !Number.isFinite(scheduled) || scheduled > Date.now();
  }, [plan]);

  if (!plan || !editable) {
    return (
      <Badge variant="outline" className="gap-1 bg-background/70">
        <Clock3 className="h-3 w-3" />
        {releaseLabel}
      </Badge>
    );
  }

  const handleChange = async (value: string) => {
    const next = normalizeNextDayReleaseTime(value);
    if (next === releaseTime || saving) return;
    setSaving(true);
    try {
      await updateNextDayReleaseTime(plan.id, next as NextDayReleaseTime);
      toast.success(`Tomorrow's release time is now ${next}.`);
      window.dispatchEvent(new CustomEvent('hk-next-day-plan-changed'));
      onSaved();
    } catch (error) {
      console.error('[TomorrowReleaseTimeControl] release time update failed:', error);
      toast.error(error instanceof Error ? error.message : 'Could not change the release time.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-8 items-center gap-1 rounded-full border bg-background/80 pl-2 text-xs font-medium shadow-sm">
      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock3 className="h-3.5 w-3.5" />}
      <span className="whitespace-nowrap">{releaseLabel.replace(releaseTime, '').trim()}</span>
      <Select value={releaseTime} onValueChange={handleChange} disabled={saving}>
        <SelectTrigger
          className="h-7 w-[82px] border-0 bg-transparent px-2 py-0 text-xs font-semibold shadow-none focus:ring-0 focus:ring-offset-0"
          aria-label="Tomorrow housekeeping release time"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {NEXT_DAY_RELEASE_TIMES.map(time => (
            <SelectItem key={time} value={time}>{time}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
