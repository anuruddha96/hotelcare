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
type StoredSchedule = Partial<Schedule> & { enabled?: boolean };
const defaultSchedule: Schedule = {
  towel_first_night: 3, towel_repeat_nights: 4,
  change_first_night: 5, change_repeat_nights: 5,
  final_night_towel_only: true,
};
type Props = { hotelConfigurationId: string; hotelId: string };

/** Memories only: a durable, authorised per-property policy, never a browser-local default. */
export function MemoriesServiceCycleSettings({ hotelConfigurationId, hotelId }: Props) {
  const [schedule, setSchedule] = useState<Schedule>(defaultSchedule);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  useEffect(() => {
    if (hotelId !== 'memories-budapest') return;
    let cancelled = false;
    setLoading(true); setConfigured(false); setError(''); setSaved('');
    void (async () => {
      const { data, error: loadError } = await supabase.from('hotel_configurations')
        .select('settings').eq('id', hotelConfigurationId).maybeSingle();
      if (cancelled) return;
      const stored = (data?.settings as Record<string, unknown> | null)?.memories_service_cycle as StoredSchedule | undefined;
      if (loadError || !stored?.enabled) {
        setError('Service schedule is unavailable. Contact an administrator; no automatic policy is assumed.');
      } else {
        setSchedule({
          towel_first_night: Number(stored.towel_first_night),
          towel_repeat_nights: Number(stored.towel_repeat_nights),
          change_first_night: Number(stored.change_first_night),
          change_repeat_nights: Number(stored.change_repeat_nights),
          final_night_towel_only: stored.final_night_towel_only === true,
        });
        setConfigured(true);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [hotelConfigurationId, hotelId]);

  if (hotelId !== 'memories-budapest') return null;

  const fields: Array<{ key: keyof Pick<Schedule, 'towel_first_night' | 'towel_repeat_nights' | 'change_first_night' | 'change_repeat_nights'>; label: string }> = [
    { key: 'towel_first_night', label: 'First towel change · stay night' },
    { key: 'towel_repeat_nights', label: 'Repeat towel change every · nights' },
    { key: 'change_first_night', label: 'First Change Room · stay night' },
    { key: 'change_repeat_nights', label: 'Repeat Change Room every · nights' },
  ];
  const intervals = fields.map(field => schedule[field.key]);
  const valid = intervals.every(n => Number.isInteger(n) && n >= 1 && n <= 90);

  function edit(key: keyof Schedule, value: number | boolean) {
    setSchedule(previous => ({ ...previous, [key]: value }));
    setSaved(''); setError('');
  }

  async function save() {
    if (!configured || !valid) {
      setError('All four intervals must be whole numbers from 1 to 90.'); return;
    }
    setSaving(true); setError('');
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
      toast.error('Memories service schedule could not be saved'); return;
    }
    setSaved('Saved for Hotel Memories only. The new schedule applies to fresh dated PMS updates, not historic assignments.');
    toast.success('Memories towel and Change Room schedule saved');
  }

  return <section className="rounded-lg border p-3 space-y-3" aria-label="Hotel Memories service cycle">
    <h3 className="font-semibold text-sm">Hotel Memories · automatic towel / Change Room cycle</h3>
    <p className="text-xs text-muted-foreground">Configure each service once; the schedule applies by stay night. Checkout cleaning takes priority, and Change Room includes towels. Only this hotel changes.</p>
    {loading ? <p role="status">Loading service rules…</p> : configured ? <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{fields.map(field => <label key={field.key} className="text-xs space-y-1">
        <span>{field.label}</span>
        <Input type="number" min={1} max={90} step={1} value={schedule[field.key]}
          onChange={event => edit(field.key, Number(event.target.value))} disabled={saving} />
      </label>)}</div>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={schedule.final_night_towel_only}
          onChange={event => edit('final_night_towel_only', event.target.checked)} disabled={saving} />
        When Change Room falls on the final occupied night (checkout tomorrow), do towels only.
      </label>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {saved && <p role="status" className="text-xs">{saved}</p>}
      <Button type="button" size="sm" onClick={() => void save()} disabled={saving || !valid}>
        {saving ? 'Saving…' : 'Save Memories service schedule'}
      </Button>
    </> : <p role="alert" className="text-xs text-destructive">{error}</p>}
  </section>;
}
