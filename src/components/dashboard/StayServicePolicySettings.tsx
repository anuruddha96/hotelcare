import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

type Code = 'towel_change' | 'linen_change' | 'full_clean';
type Rule = { code: Code; label: string; enabled: boolean; first: string; repeat: string };
const initialRules: Rule[] = [
  { code: 'towel_change', label: 'Towel change', enabled: false, first: '', repeat: '' },
  { code: 'linen_change', label: 'Linen change / change room', enabled: false, first: '', repeat: '' },
  { code: 'full_clean', label: 'Full clean', enabled: false, first: '', repeat: '' },
];
const captions: Record<Code, string> = {
  towel_change: 'Towels', linen_change: 'Linen / change room', full_clean: 'Full clean',
};

type Props = { hotel: string | null | undefined; organizationSlug: string | null | undefined };

/** Optional hotel-specific schedules; never auto-populate an interval. */
export function StayServicePolicySettings({ hotel, organizationSlug }: Props) {
  const [hotelId, setHotelId] = useState<string | null>(null);
  const [rules, setRules] = useState<Rule[]>(initialRules);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setHotelId(null);
    setRules(initialRules);
    setMessage(null);
    if (!hotel || !organizationSlug) return;
    let cancelled = false;
    void (async () => {
      const { data: config } = await supabase.from('hotel_configurations')
        .select('hotel_id').or(`hotel_id.eq.${hotel},hotel_name.eq.${hotel}`).limit(1).maybeSingle();
      if (!config?.hotel_id || cancelled) return;
      const canonicalHotel = config.hotel_id;
      const { data, error } = await supabase.from('housekeeping_stay_service_policies' as any)
        .select('service_code, display_label, first_due_after_nights, repeat_every_nights, enabled')
        .eq('hotel_id', canonicalHotel).eq('organization_slug', organizationSlug);
      if (cancelled) return;
      if (error && !/does not exist|could not find the table|404|PGRST205/i.test(error.message)) {
        setMessage('Unable to load this hotel’s service rules.');
      }
      setRules(initialRules.map((rule) => {
        const stored = ((data ?? []) as any[]).find((entry) => entry.service_code === rule.code);
        return stored ? {
          code: rule.code, label: stored.display_label, enabled: stored.enabled,
          first: String(stored.first_due_after_nights), repeat: stored.repeat_every_nights == null ? '' : String(stored.repeat_every_nights),
        } : { ...rule };
      }));
      setHotelId(canonicalHotel);
    })();
    return () => { cancelled = true; };
  }, [hotel, organizationSlug]);

  const edit = (code: Code, patch: Partial<Rule>) => {
    setRules((previous) => previous.map((rule) => rule.code === code ? { ...rule, ...patch } : rule));
    setMessage(null);
  };

  const save = async () => {
    if (!hotelId || !organizationSlug) return;
    for (const rule of rules) {
      if (!rule.enabled) continue;
      if (!rule.label.trim() || !Number.isInteger(Number(rule.first)) || Number(rule.first) < 1
        || (rule.repeat !== '' && (!Number.isInteger(Number(rule.repeat)) || Number(rule.repeat) < 1))) {
        setMessage('Enabled rules need a label and positive whole-number night intervals.');
        return;
      }
    }
    setSaving(true);
    setMessage(null);
    const payload = rules.map((rule) => ({
      organization_slug: organizationSlug, hotel_id: hotelId,
      service_code: rule.code, display_label: rule.label.trim(), enabled: rule.enabled,
      first_due_after_nights: rule.enabled ? Number(rule.first) : Math.max(1, Number(rule.first) || 1),
      repeat_every_nights: rule.enabled && rule.repeat !== '' ? Number(rule.repeat) : null,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('housekeeping_stay_service_policies' as any)
      .upsert(payload as any, { onConflict: 'organization_slug,hotel_id,service_code' });
    setSaving(false);
    setMessage(error ? `Could not save service rules: ${error.message}` : 'Saved. New extension reviews will use these rules; existing reviews must be checked manually.');
  };

  if (!hotelId) return null;
  return (
    <details className="mx-4 mt-3 rounded-lg border border-border bg-card px-3 py-2 text-sm sm:mx-6">
      <summary className="cursor-pointer font-medium">Stayover service rules · selected hotel</summary>
      <p className="my-2 text-muted-foreground">Configure the actual schedule for this hotel. Nothing is assumed. A full clean covers towel and linen changes when due on the same date.</p>
      <div className="space-y-3">
        {rules.map((rule) => (
          <fieldset key={rule.code} className="rounded-md border border-border p-2">
            <legend className="px-1 font-medium">{captions[rule.code]}</legend>
            <label className="flex items-center gap-2"><input type="checkbox" checked={rule.enabled} onChange={(event) => edit(rule.code, { enabled: event.target.checked })} />Enable this service</label>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <label className="text-xs">Hotel's name for the service<input className="mt-1 w-full rounded border border-input bg-background p-2 text-sm" value={rule.label} onChange={(event) => edit(rule.code, { label: event.target.value })} /></label>
              <label className="text-xs">First due after completed nights<input type="number" min="1" step="1" className="mt-1 w-full rounded border border-input bg-background p-2 text-sm" value={rule.first} onChange={(event) => edit(rule.code, { first: event.target.value })} placeholder="Set hotel's rule" /></label>
              <label className="text-xs">Repeat every N nights (optional)<input type="number" min="1" step="1" className="mt-1 w-full rounded border border-input bg-background p-2 text-sm" value={rule.repeat} onChange={(event) => edit(rule.code, { repeat: event.target.value })} placeholder="Once if blank" /></label>
            </div>
          </fieldset>
        ))}
      </div>
      {message && <p role="status" className="my-2 text-sm">{message}</p>}
      <button type="button" disabled={saving} onClick={() => void save()} className="mt-2 rounded-md bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50">{saving ? 'Saving…' : 'Save service rules'}</button>
    </details>
  );
}
