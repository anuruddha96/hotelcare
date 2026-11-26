import { useState } from 'react';
import { Coffee } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from '@/hooks/useTranslation';
import type { BreakfastSignal } from '@/lib/housekeepingTaskOrder';

function fill(text: string, vars: Record<string, string | number>) {
  return text.replace(/\{(\w+)\}/g, (match, key) => String(vars[key] ?? match));
}

export function HousekeepingBreakfastBanner({ count, onShow }: { count: number; onShow: () => void }) {
  const { t, language } = useTranslation();
  if (!count) return null;
  const category = new Intl.PluralRules(language === 'tl' ? 'fil' : language).select(count);
  const suffix = category === 'one' ? 'One' : category === 'few' ? 'Few' : category === 'many' ? 'Many' : 'Other';
  return <Button type="button" variant="outline" onClick={onShow} className="w-full h-auto min-h-10 gap-2 whitespace-normal justify-start text-emerald-700 dark:text-emerald-300">
    <Coffee className="h-4 w-4 shrink-0" aria-hidden="true" />
    {fill(t('hkBreakfast.banner' + suffix), { count })}
  </Button>;
}

export function HousekeepingBreakfastNotice({ signal, now, onClosed }: { signal: BreakfastSignal; now: Date; onClosed: () => void }) {
  const { t, language } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);
  if (dismissedAt === signal.last_seen_at || signal.closed_at) return null;
  const time = new Intl.DateTimeFormat(language, { timeZone: 'Europe/Budapest', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(signal.last_seen_at));
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(signal.last_seen_at)) / 60_000));
  const active = Date.parse(signal.window_ends_at) > now.getTime();
  if (!active) return <p className="px-2 py-1 text-xs text-muted-foreground">{fill(t('hkBreakfast.expired'), { time })}</p>;

  const close = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const { data, error } = await (supabase as any).rpc('close_breakfast_signal', { _signal_id: signal.id, _reason: 'guest_in_room' });
      if (error || data !== true) throw new Error('close failed');
      setDismissedAt(signal.last_seen_at);
      onClosed();
      toast.success(t('hkBreakfast.thanks'));
    } catch {
      toast.error(t('hkBreakfast.failed'));
      onClosed();
    } finally {
      setSaving(false);
    }
  };

  return <div className="rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/20 px-3 py-2 space-y-1 mb-1" data-training="guest-at-breakfast">
    <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-800 dark:text-emerald-200"><Coffee className="h-4 w-4 shrink-0" aria-hidden="true" />{t('hkBreakfast.chip')}</p>
    <p className="text-xs text-muted-foreground">{fill(t('hkBreakfast.since'), { time, minutes })}</p>
    <p className="text-sm">{signal.guests_expected != null && signal.guests_seen < signal.guests_expected
      ? fill(t('hkBreakfast.partial'), { seen: signal.guests_seen, expected: signal.guests_expected })
      : t('hkBreakfast.hint')}</p>
    <p className="text-xs text-muted-foreground">{t('hkBreakfast.followInstructions')}</p>
    <Button type="button" variant="ghost" size="sm" className="min-h-10 px-1 whitespace-normal text-left" disabled={saving} onClick={() => void close()} data-training="breakfast-guest-in-room">{t('hkBreakfast.guestInRoom')}</Button>
  </div>;
}
