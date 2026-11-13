import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AriChanges, AriGrid, RateChange } from '@/integrations/channex/ariApi';

type Tri = 'keep' | 'on' | 'off';
const WEEKDAYS = [
  { iso: 1, label: 'Mon' }, { iso: 2, label: 'Tue' }, { iso: 3, label: 'Wed' }, { iso: 4, label: 'Thu' },
  { iso: 5, label: 'Fri' }, { iso: 6, label: 'Sat' }, { iso: 7, label: 'Sun' },
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grid: AriGrid;
  defaultFrom: string;
  defaultTo: string;
  onAdd: (changes: AriChanges) => void;
};

function TriToggle({ label, value, onChange }: { label: string; value: Tri; onChange: (v: Tri) => void }) {
  return <div className="flex items-center justify-between gap-2">
    <span className="text-sm">{label}</span>
    <div className="inline-flex rounded-md border p-0.5" role="radiogroup" aria-label={label}>
      {(['keep', 'on', 'off'] as Tri[]).map((v) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={`px-2 py-0.5 text-xs rounded ${value === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
          {v === 'keep' ? 'No change' : v === 'on' ? 'Yes' : 'No'}
        </button>
      ))}
    </div>
  </div>;
}

/**
 * Bulk update: pick rate plans / room types, a date range and the values to set.
 * Adds the ranges to the pending changes; nothing is saved until the user presses Save,
 * so several ranges across plans go out as one Channex request.
 */
export function BulkAriDialog({ open, onOpenChange, grid, defaultFrom, defaultTo, onAdd }: Props) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [days, setDays] = useState<number[]>(WEEKDAYS.map((d) => d.iso));
  const [plans, setPlans] = useState<string[]>([]);
  const [rooms, setRooms] = useState<string[]>([]);
  const [rate, setRate] = useState('');
  const [minStay, setMinStay] = useState('');
  const [maxStay, setMaxStay] = useState('');
  const [roomsToSell, setRoomsToSell] = useState('');
  const [stopSell, setStopSell] = useState<Tri>('keep');
  const [cta, setCta] = useState<Tri>('keep');
  const [ctd, setCtd] = useState<Tri>('keep');

  useEffect(() => {
    if (!open) return;
    setFrom(defaultFrom); setTo(defaultTo); setDays(WEEKDAYS.map((d) => d.iso)); setPlans([]); setRooms([]);
    setRate(''); setMinStay(''); setMaxStay(''); setRoomsToSell(''); setStopSell('keep'); setCta('keep'); setCtd('keep');
  }, [open, defaultFrom, defaultTo]);

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const rateFields: Partial<RateChange> = {};
  if (rate !== '') rateFields.rate = Math.round(Number(rate) * 100) / 100;
  if (minStay !== '') rateFields.min_stay_arrival = Math.max(1, Math.trunc(Number(minStay)));
  if (maxStay !== '') rateFields.max_stay = Math.max(0, Math.trunc(Number(maxStay)));
  if (stopSell !== 'keep') rateFields.stop_sell = stopSell === 'on';
  if (cta !== 'keep') rateFields.closed_to_arrival = cta === 'on';
  if (ctd !== 'keep') rateFields.closed_to_departure = ctd === 'on';
  const hasRateValues = Object.keys(rateFields).length > 0;
  const hasRoomValue = roomsToSell !== '';
  const validRange = Boolean(from && to && from <= to && days.length);
  const canAdd = validRange && ((plans.length > 0 && hasRateValues) || (rooms.length > 0 && hasRoomValue));
  const weekdays = days.length === 7 ? undefined : days;

  const add = () => {
    onAdd({
      rates: hasRateValues ? plans.map((id) => ({ rate_plan_id: id, date_from: from, date_to: to, weekdays, ...rateFields })) : [],
      availability: hasRoomValue ? rooms.map((id) => ({ room_type_id: id, date_from: from, date_to: to, weekdays, availability: Math.max(0, Math.trunc(Number(roomsToSell))) })) : [],
    });
    onOpenChange(false);
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Bulk update</DialogTitle>
        <DialogDescription>Choose dates, what to change and where. You can add several updates and save them together.</DialogDescription>
      </DialogHeader>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">1. Dates</h3>
        <div className="flex gap-2 items-end flex-wrap">
          <div><Label htmlFor="bulk-from" className="text-xs">From</Label><Input id="bulk-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label htmlFor="bulk-to" className="text-xs">To (inclusive)</Label><Input id="bulk-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        <div className="flex gap-1 flex-wrap" aria-label="Weekdays">
          {WEEKDAYS.map((d) => (
            <button key={d.iso} type="button" aria-pressed={days.includes(d.iso)} onClick={() => setDays((v) => (v.includes(d.iso) ? v.filter((x) => x !== d.iso) : [...v, d.iso].sort()))}
              className={`px-2.5 py-1 text-xs rounded-md border ${days.includes(d.iso) ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground'}`}>{d.label}</button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">2. Where</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          {grid.room_types.map((rt) => (
            <div key={rt.id} className="rounded-md border p-2 space-y-1.5">
              <div className="text-sm font-medium">{rt.name}</div>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={rooms.includes(rt.id)} onCheckedChange={() => setRooms((v) => toggle(v, rt.id))} />Rooms to sell</label>
              {grid.rate_plans.filter((p) => p.room_type_id === rt.id).map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm"><Checkbox checked={plans.includes(p.id)} onCheckedChange={() => setPlans((v) => toggle(v, p.id))} />{p.name}</label>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">3. New values <span className="font-normal text-muted-foreground">(empty = no change)</span></h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><Label htmlFor="bulk-rate" className="text-xs">Price</Label><Input id="bulk-rate" type="number" min={0} step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
          <div><Label htmlFor="bulk-rooms" className="text-xs">Rooms to sell</Label><Input id="bulk-rooms" type="number" min={0} value={roomsToSell} onChange={(e) => setRoomsToSell(e.target.value)} /></div>
          <div><Label htmlFor="bulk-min" className="text-xs">Min stay (nights)</Label><Input id="bulk-min" type="number" min={1} value={minStay} onChange={(e) => setMinStay(e.target.value)} /></div>
          <div><Label htmlFor="bulk-max" className="text-xs">Max stay (0 = no limit)</Label><Input id="bulk-max" type="number" min={0} value={maxStay} onChange={(e) => setMaxStay(e.target.value)} /></div>
        </div>
        <div className="space-y-2 pt-1">
          <TriToggle label="Stop sell" value={stopSell} onChange={setStopSell} />
          <TriToggle label="Closed to arrival" value={cta} onChange={setCta} />
          <TriToggle label="Closed to departure" value={ctd} onChange={setCtd} />
        </div>
      </section>

      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button onClick={add} disabled={!canAdd}>Add to changes</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
