import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

type Schedule = {
  towel_first_night: number;
  towel_repeat_nights: number;
  change_first_night: number;
  change_repeat_nights: number;
  final_night_towel_only: boolean;
};

const defaultSchedule: Schedule = {
  towel_first_night: 3,
  towel_repeat_nights: 4,
  change_first_night: 5,
  change_repeat_nights: 5,
  final_night_towel_only: true,
};

type Props = { hotelConfigurationId: string; hotelId: string };

/** Memories-only: saved schedule is read by the database on every new PMS workday. */
export function MemoriesServiceCycleSettings({ hotelConfigurationId, hotelId }: Props) {
  const [schedule, setSchedule] = useState<Schedule>(defaultSchedule);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  useEffect(() => {
    if (hotelId !== 'memories-budapest') return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setSaved('');
    void (async () => {
      const { data, error: loadError } = await supabase.from('hotel_configurations')
        .select('settings').eq('id', hotelConfigurationId).maybeSingle();
      if (cancelled) return;
      const stored = (data?.settings as Record<string, unknown> | null)?.memories_service_cycle as Partial<Schedule> | undefined;
      if (loadError || !stored?.enabled) {
        setError('Hotel service schedule is not configured. Contact an administrator.');
      } else {
        setSchedule({
          towel_first_night: Number(stored.towel_first_night),
          towel_repeat_nights: Number(stored.towel_repeat_nights),
          change_first_night: Number(stored.change_first_night),
          change_repeat_nights: Number(stored.change_repeat_nights),
          final_night_towel_only: stored.final_night_towel_only === true,
        });
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [hotelConfigurationId, hotelId]);

  if (hotelId !== 'memories-budapest') return null;

  function edit(key: keyof Schedule, value: number | boolean) {
    setSchedule(previous => ({ ...previous, [key]: value }));
    setSaved('');
  }

  async function save() {
    const intervals = [schedule.towel_first_night, schedule.towel_repeat_nights,
      schedule.change_first_night, schedule.change_repeat_nights];
    if (intervals.some(n => !Number.isInteger(n) || n < 1 || n > 90)) {
      setError('All four intervals must be whole numbers between 1 and 90.');
      return;
    }
    setSaving(true);
    setError('');
    const { error: saveError } = await (supabase as any).rpc('hc_save_memories_service_cycle', {
      p_towel_first_night: schedule.towel_first_night,
      p_towel_repeat_nights: schedule.towel_repeat_nights,
      p_change_first_night: schedule.change_first_night,
      p_change_repeat_nights: schedule.change_repeat_nights,
      p_final_night_towel_only: schedule.final_night_towel_only,
    });
    setSaving(false);
    if (saveError) {
      setError(`Could not save: ${saveError.message}`);
      toast.error('Memories service schedule could not be saved');
      return;
    }
    setSaved('Saved for Hotel Memories only. The automatic cycle applies when Previo provides the next valid workday; staff-confirmed service dates are never fabricated.');
    toast.success('Memories towel and Change Room schedule saved');
  }

  const fields: Array<{ key: keyof Pick<Schedule, 'towel_first_night' | 'towel_repeat_nights' | 'change_first_night' | 'change_repeat_nights'>; label: string }> = [
    { key: 'towel_first_night', label: 'First towel change · stay night' },
    { key: 'towel_repeat_nights', label: 'Repeat towel change every · nights' },
    { key: 'change_first_night', label: 'First Change Room · stay night' },
    { key: 'change_repeat_nights', label: 'Repeat Change Room every · nights' },
  ];

  return <section className="rounded-lg border p-3 space-y-3" aria-label="Hotel Memories service cycle">
    <h3 className="font-semibold text-sm">Hotel Memories · automatic towel / Change Room cycle</h3>
    <p className="text-xs text-muted-foreground">Set the hotel's real stay-night schedule once. This is separate from room size and does not change other hotels. Checkout cleaning always takes priority; Change Room includes towels.</p>
    {loading ? <p role="status">Loading service rules…</p> : <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {fields.map(field => <label key={field.key} className="text-xs space-y-1">
          <span>{field.label}</span>
          <Input type="number" min={1} max={90} step={1} value={schedule[field.key]}
            onChange={event => edit(field.key, Number(event.target.value))} disabled={saving} />
        </label>)}
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={schedule.final_night_towel_only}
          onChange={event => edit('final_night_towel_only', event.target.checked)} disabled={saving} />
        If Change Room is due on the last occupied night (checkout tomorrow), do towels only.
      </label>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {saved && <p role="status" className="text-xs">{saved}</p>}
      <Button type="button" size="sm" onClick={() => void save()} disabled={saving || !!error && !Number.isInteger(schedule.towel_first_night)}>
        {saving ? 'Saving…' : 'Save Memories service schedule'}
      </Button>
    </>}
  </section>;
}
