import { useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import {
  applyChannelRule, CHANNEL_PRESETS, describeRule,
  type AdjustmentKind, type ChannelRateRule, type Rounding,
} from '@/lib/rates/channelRates';

/**
 * Manage the hotel's OTA price rules: which channels sell the hotel and how
 * each channel's price derives from the base rate. The calendar then shows
 * every channel's effective price per day.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = () => (supabase as any).from('pms_channel_rate_rules');

interface Props {
  hotelId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rules: ChannelRateRule[];
  canManage: boolean;
  onChanged: () => void;
  sampleRate?: number; // e.g. today's Twin BAR, to preview the math
  currency?: string;
}

export function ChannelRatesDialog({ hotelId, open, onOpenChange, rules, canManage, onChanged, sampleRate = 100, currency = 'USD' }: Props) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ title: '', kind: 'percent' as AdjustmentKind, value: 0, rounding: 'none' as Rounding });

  const run = async (fn: () => Promise<{ error: { message: string } | null }>) => {
    setBusy(true);
    try {
      const { error } = await fn();
      if (error) toast.error(error.message);
      else onChanged();
    } finally {
      setBusy(false);
    }
  };

  const addRule = (key: string, title: string, kind: AdjustmentKind = 'percent', value = 0) => run(() =>
    table().insert({ hotel_id: hotelId, channel_key: key, channel_title: title, adjustment_kind: kind, adjustment_value: value, sort_order: rules.length }));

  const addCustom = () => {
    const title = draft.title.trim();
    if (!title) return toast.error('Give the channel a name');
    const key = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'channel';
    if (rules.some((r) => r.channel_key === key)) return toast.error('That channel already has a rule');
    void addRule(key, title, draft.kind, draft.value);
    setDraft({ title: '', kind: 'percent', value: 0, rounding: 'none' });
  };

  const update = (id: string, patch: Partial<ChannelRateRule>) => run(() =>
    table().update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).eq('hotel_id', hotelId));

  const remove = (id: string) => run(() => table().delete().eq('id', id).eq('hotel_id', hotelId));

  const unusedPresets = CHANNEL_PRESETS.filter((p) => !rules.some((r) => r.channel_key === p.key));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>OTA channels &amp; price rules</DialogTitle>
          <DialogDescription>
            Each channel's selling price derives from the base rate in the calendar. Example below uses {sampleRate} {currency}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5">
          {rules.length === 0 && <p className="text-sm text-muted-foreground">No channels yet. Add the OTAs this hotel sells on.</p>}
          {rules.map((rule) => (
            <div key={rule.id} className="rounded-lg border p-3 space-y-2" data-training="ota-rule-row">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{rule.channel_title}</span>
                <Badge variant="outline" className="text-[10px]">{describeRule(rule)}</Badge>
                <span className="text-xs text-muted-foreground">→ {applyChannelRule(sampleRate, rule)} {currency}</span>
                <div className="flex-1" />
                <label className="flex items-center gap-1.5 text-xs">
                  <Switch checked={rule.active} disabled={!canManage || busy} onCheckedChange={(v) => update(rule.id, { active: v })} /> selling
                </label>
                {canManage && (
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" aria-label={`Remove ${rule.channel_title}`}
                    disabled={busy} onClick={() => remove(rule.id)}><Trash2 className="h-4 w-4" /></Button>
                )}
              </div>
              {canManage && (
                <div className="flex items-end gap-2 flex-wrap text-xs">
                  <div>
                    <Label className="text-[11px]">Adjustment</Label>
                    <select className="h-8 rounded-md border bg-background px-2 block" value={rule.adjustment_kind} disabled={busy}
                      onChange={(e) => update(rule.id, { adjustment_kind: e.target.value as AdjustmentKind })}>
                      <option value="percent">% of base</option>
                      <option value="fixed">fixed amount</option>
                    </select>
                  </div>
                  <div>
                    <Label className="text-[11px]">Value ({rule.adjustment_kind === 'percent' ? '%' : currency})</Label>
                    <Input type="number" step="0.5" className="h-8 w-24" value={rule.adjustment_value} disabled={busy}
                      onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) update(rule.id, { adjustment_value: n }); }} />
                  </div>
                  <div>
                    <Label className="text-[11px]">Rounding</Label>
                    <select className="h-8 rounded-md border bg-background px-2 block" value={rule.rounding} disabled={busy}
                      onChange={(e) => update(rule.id, { rounding: e.target.value as Rounding })}>
                      <option value="none">none</option>
                      <option value="whole">whole number</option>
                      <option value="ninety_nine">.99 ending</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          ))}

          {canManage && unusedPresets.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              <span className="text-xs text-muted-foreground">Quick add:</span>
              {unusedPresets.map((p) => (
                <Button key={p.key} type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={busy}
                  onClick={() => addRule(p.key, p.title)}><Plus className="h-3 w-3" />{p.title}</Button>
              ))}
            </div>
          )}

          {canManage && (
            <div className="flex items-end gap-2 flex-wrap border-t pt-3">
              <div className="flex-1 min-w-[140px]">
                <Label className="text-[11px]">Other channel</Label>
                <Input className="h-8" placeholder="e.g. Hostelworld" value={draft.title} maxLength={60}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </div>
              <Button type="button" size="sm" className="h-8 gap-1" disabled={busy} onClick={addCustom}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}Add
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
