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
  towel_first_night: 3,
  towel_repeat_nights: 4,
  change_first_night: 5,
  change_repeat_nights: 5,
  final_night_towel_only: true,
};
type Props = {
  hotelConfigurationId: string;
  hotelId: string;
  hotelName: string;
};

/** Manager-editable, per-property service timing. */
export function HousekeepingServiceCycleSettings({ hotelConfigurationId, hotelId, hotelName }: Props) {
  const [schedule, setSchedule] = useState<Schedule>(defaultSchedule);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setSaved('');
    void (async () => {
      const { data, error: loadError } = await supabase
        .from('hotel_configurations')
        .select('settings')
        .eq('id', hotelConfigurationId)
        .maybeSingle();
      if (cancelled) return;

      if (loadError) {
        setError('Service schedule could not be loaded.');
        setLoading(false);
        return;
      }

      const settings = (data?.settings as Record<string, unknown> | null) || {};
      const key = hotelId === 'memories-budapest' ? 'memories_service_cycle' : 'housekeeping_service_cycle';
      const stored = settings[key] as StoredSchedule | undefined;
      setSchedule({
        towel_first_night: Number(stored?.towel_first_night ?? defaultSchedule.towel_first_night),
        towel_repeat_nights: Number(stored?.towel_repeat_nights ?? defaultSchedule.towel_repeat_nights),
        change_first_night: Number(stored?.change_first_night ?? defaultSchedule.change_first_night),
        change_repeat_nights: Number(stored?.change_repeat_nights ?? defaultSchedule.change_repeat_nights),
        final_night_towel_only: stored?.final_night_towel_only ?? defaultSchedule.final_night_towel_only,
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [hotelConfigurationId, hotelId]);

  const fields: Array<{
    key: keyof Pick<Schedule, 'towel_first_night' | 'towel_repeat_nights' | 'change_first_night' | 'change_repeat_nights'>;
    label: string;
    help: string;
  }> = [
    { key: 'towel_first_night', label: 'First towel change', help: 'Stay night when T first appears. Example: 3 = no towels on night 2; towels on night 3.' },
    { key: 'towel_repeat_nights', label: 'Repeat towel change', help: 'Repeat every N stay nights after the first towel change.' },
    { key: 'change_first_night', label: 'First Change Room / full clean', help: 'Stay night when the first full Change Room service is due.' },
    { key: 'change_repeat_nights', label: 'Repeat Change Room / full clean', help: 'Repeat every N stay nights after the first Change Room.' },
  ];
  const intervals = fields.map(field => schedule[field.key]);
  const valid = intervals.every(n => Number.isInteger(n) && n >= 1 && n <= 90);

  function edit(key: keyof Schedule, value: number | boolean) {
    setSchedule(previous => ({ ...previous, [key]: value }));
    setSaved('');
    setError('');
  }

  async function save() {
    if (!valid) {
      setError('All four service values must be whole numbers from 1 to 90.');
      return;
    }
    setSaving(true);
    setError('');

    const rpc = hotelId === 'memories-budapest' ? 'hc_save_memories_service_cycle' : 'hc_save_housekeeping_service_cycle';
    const args = hotelId === 'memories-budapest'
      ? {
          p_towel_first_night: schedule.towel_first_night,
          p_towel_repeat_nights: schedule.towel_repeat_nights,
          p_change_first_night: schedule.change_first_night,
          p_change_repeat_nights: schedule.change_repeat_nights,
          p_final_night_towel_only: schedule.final_night_towel_only,
        }
      : {
          p_hotel_id: hotelId,
          p_towel_first_night: schedule.towel_first_night,
          p_towel_repeat_nights: schedule.towel_repeat_nights,
          p_change_first_night: schedule.change_first_night,
          p_change_repeat_nights: schedule.change_repeat_nights,
          p_final_night_towel_only: schedule.final_night_towel_only,
        };

    const { error: saveError } = await (supabase as any).rpc(rpc, args);
    setSaving(false);
    if (saveError) {
      setError(`Could not save: ${saveError.message}`);
      toast.error(`${hotelName} service schedule could not be saved`);
      return;
    }

    setSaved(`Saved for ${hotelName}. Fresh PMS updates and live room service badges now use this property rule.`);
    toast.success(`${hotelName} housekeeping service schedule saved`);
  }

  return <section className="rounded-lg border p-3 space-y-3" aria-label={`${hotelName} housekeeping service cycle`}>
    <div>
      <h3 className="font-semibold text-sm">{hotelName} · towel & Change Room rules</h3>
      <p className="text-xs text-muted-foreground mt-1">
        Property-specific rules used for automatic stay-over service. Checkout cleaning still has priority. Change Room / full clean includes the towel change.
      </p>
    </div>

    {loading ? <p role="status" className="text-xs">Loading service rules…</p> : <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {fields.map(field => <label key={field.key} className="text-xs space-y-1">
          <span className="font-medium">{field.label}</span>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={90}
              step={1}
              value={schedule[field.key]}
              onChange={event => edit(field.key, Number(event.target.value))}
              disabled={saving}
              className="w-24"
            />
            <span className="text-muted-foreground">stay night{field.key.includes('repeat') ? 's' : ''}</span>
          </div>
          <span className="block text-[11px] text-muted-foreground">{field.help}</span>
        </label>)}
      </div>

      <label className="flex items-start gap-2 text-xs rounded-md bg-muted/40 p-2.5">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={schedule.final_night_towel_only}
          onChange={event => edit('final_night_towel_only', event.target.checked)}
          disabled={saving}
        />
        <span>
          <strong>Final occupied night: towels only when Change Room would otherwise be due.</strong>
          <span className="block text-muted-foreground">Avoid a full linen/change-room service immediately before checkout.</span>
        </span>
      </label>

      {hotelId === 'ottofiori' && <p className="text-xs rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">
        Ottofiori rule: first towel change is stay night 3. A guest who checked in yesterday is on night 2 today, so no T badge is due today.
      </p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {saved && <p role="status" className="text-xs">{saved}</p>}
      <Button type="button" size="sm" onClick={() => void save()} disabled={saving || !valid}>
        {saving ? 'Saving…' : `Save ${hotelName} service rules`}
      </Button>
    </>}
  </section>;
}

// Backward-compatible export for any older import outside the settings panel.
export const MemoriesServiceCycleSettings = HousekeepingServiceCycleSettings;
