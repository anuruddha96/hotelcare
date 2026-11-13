import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { CalendarRange, ChevronLeft, ChevronRight, Layers, RefreshCw, Save, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useOperationalHotel } from '@/hooks/useOperationalHotel';
import { Header } from '@/components/layout/Header';
import { PMSNavigation } from '@/components/layout/PMSNavigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { BulkAriDialog } from '@/components/rates/BulkAriDialog';
import {
  type AriChanges, type AriGrid, type RateChange, type RateField, addDaysIso, channexAri, collectTaskIds, datesBetween,
  isoDate, loadAriGrid, saveAri,
} from '@/integrations/channex/api';

const WINDOW_DAYS = 14;
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type RowDef = { field: RateField; label: string; kind: 'number' | 'money' | 'bool'; advanced?: boolean };
const RATE_ROWS: RowDef[] = [
  { field: 'rate', label: 'Price', kind: 'money' },
  { field: 'min_stay_arrival', label: 'Min stay', kind: 'number' },
  { field: 'stop_sell', label: 'Stop sell', kind: 'bool' },
  { field: 'closed_to_arrival', label: 'Closed to arrival', kind: 'bool', advanced: true },
  { field: 'closed_to_departure', label: 'Closed to departure', kind: 'bool', advanced: true },
  { field: 'max_stay', label: 'Max stay (0 = none)', kind: 'number', advanced: true },
  { field: 'min_stay_through', label: 'Min stay through', kind: 'number', advanced: true },
];

const cellKey = (kind: 'a' | 'r', target: string, date: string, field = 'availability') => `${kind}|${target}|${date}|${field}`;

export default function RatesAvailability() {
  const { user, loading } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const { hotelId, ready, isPortfolio } = useOperationalHotel();
  const [start, setStart] = useState(() => isoDate(new Date()));
  const [grid, setGrid] = useState<AriGrid | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, number | boolean>>({});
  const [bulk, setBulk] = useState<AriChanges>({ rates: [], availability: [] });
  const [showAll, setShowAll] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const end = addDaysIso(start, WINDOW_DAYS - 1);
  const dates = useMemo(() => datesBetween(start, end), [start, end]);

  const reload = useCallback(async () => {
    if (!hotelId) return;
    setBusy(true);
    setError(null);
    try { setGrid(await loadAriGrid(hotelId, start, end)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, [hotelId, start, end]);

  useEffect(() => { if (user && ready) void reload(); }, [user, ready, reload]);

  const availability = useMemo(() => new Map((grid?.availability ?? []).map((a) => [`${a.room_type_id}|${a.date}`, a])), [grid]);
  const rates = useMemo(() => new Map((grid?.rates ?? []).map((r) => [`${r.rate_plan_id}|${r.date}`, r])), [grid]);
  const changeCount = Object.keys(edits).length + bulk.rates.length + bulk.availability.length;
  const currency = grid?.rate_plans[0]?.currency || 'USD';

  const setEdit = (key: string, value: number | boolean | null, original: number | boolean | null) => {
    setEdits((prev) => {
      const next = { ...prev };
      if (value === null || value === original) delete next[key]; else next[key] = value;
      return next;
    });
  };

  const buildChanges = (): AriChanges => {
    const rateItems = new Map<string, RateChange>();
    const availabilityItems: AriChanges['availability'] = [];
    for (const [key, value] of Object.entries(edits)) {
      const [kind, target, date, field] = key.split('|');
      if (kind === 'a') availabilityItems.push({ room_type_id: target, date_from: date, date_to: date, availability: Number(value) });
      else {
        const k = `${target}|${date}`;
        const item = rateItems.get(k) ?? { rate_plan_id: target, date_from: date, date_to: date };
        (item as Record<string, unknown>)[field] = value;
        rateItems.set(k, item);
      }
    }
    // Bulk ranges first, single-cell edits after, so a cell edit wins over a range.
    return { rates: [...bulk.rates, ...rateItems.values()], availability: [...bulk.availability, ...availabilityItems] };
  };

  const save = async () => {
    if (!hotelId || !changeCount) return;
    setSaving(true);
    try {
      const saved = await saveAri(hotelId, buildChanges());
      setEdits({});
      setBulk({ rates: [], availability: [] });
      if (saved.publishing) {
        const pushed = await channexAri('push_now', hotelId);
        const tasks = collectTaskIds(pushed);
        if (pushed.ok && tasks.length) toast.success(`Saved and sent to Channex · task ${tasks.join(', ')}`);
        else if (pushed.ok) toast.success('Saved. Channex will receive it within a minute.');
        else toast.warning(`Saved in HotelCare. Channex send will retry automatically (${pushed.error}).`);
      } else {
        toast.success('Saved in HotelCare. Channex publishing is off for this hotel.');
      }
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !ready) return <div className="min-h-screen flex items-center justify-center"><RefreshCw className="h-6 w-6 animate-spin" aria-label="Loading" /></div>;
  if (!user) return <Navigate to={`/${organizationSlug || 'rdhotels'}/auth`} replace />;

  const shell = (body: JSX.Element) => <div className="min-h-screen bg-background"><Header /><PMSNavigation /><main className="container mx-auto px-3 sm:px-6 py-5 space-y-4">{body}</main></div>;
  if (!hotelId || isPortfolio) return shell(<Card><CardContent className="py-10 text-center">Select one hotel to manage its rates and availability.</CardContent></Card>);
  if (grid && !grid.native) return shell(<Card><CardContent className="py-10 text-center space-y-2"><p className="font-medium">Rates and availability for this hotel are managed in Previo.</p><p className="text-sm text-muted-foreground">This screen is used by hotels where HotelCare is the main PMS (currently the Channex test property).</p></CardContent></Card>);

  const roomTypes = grid?.room_types ?? [];
  const visibleRows = RATE_ROWS.filter((r) => showAll || !r.advanced);

  return shell(<>
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2"><CalendarRange className="h-5 w-5" />Rates &amp; availability</h1>
        <p className="text-xs text-muted-foreground mt-1">Prices in {currency}. Edit cells or use Bulk update, then press Save. One save is sent to the channel manager as one update.</p>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={grid?.publishing ? 'default' : 'outline'}>{grid?.publishing ? 'Channex: publishing' : 'Channex: off'}</Badge>
        {Boolean(grid?.pending_outbox) && <Badge variant="secondary">{grid?.pending_outbox} waiting to send</Badge>}
      </div>
    </div>

    <div className="flex items-center gap-2 flex-wrap rounded-lg border bg-card p-2">
      <Button size="icon" variant="ghost" aria-label="Previous two weeks" onClick={() => setStart(addDaysIso(start, -WINDOW_DAYS))}><ChevronLeft className="h-4 w-4" /></Button>
      <input type="date" aria-label="First date" className="h-9 rounded-md border bg-background px-2 text-sm" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} />
      <Button size="icon" variant="ghost" aria-label="Next two weeks" onClick={() => setStart(addDaysIso(start, WINDOW_DAYS))}><ChevronRight className="h-4 w-4" /></Button>
      <Button size="sm" variant="ghost" onClick={() => setStart(isoDate(new Date()))}>Today</Button>
      <div className="h-6 w-px bg-border mx-1" />
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setBulkOpen(true)} disabled={!grid}><Layers className="h-4 w-4" />Bulk update</Button>
      <div className="flex items-center gap-2 ml-1"><Switch id="show-all" checked={showAll} onCheckedChange={setShowAll} /><Label htmlFor="show-all" className="text-sm">All restrictions</Label></div>
      <div className="flex-1" />
      <Button size="sm" variant="ghost" className="gap-1.5" disabled={!changeCount || saving} onClick={() => { setEdits({}); setBulk({ rates: [], availability: [] }); }}><Undo2 className="h-4 w-4" />Discard</Button>
      <Button size="sm" className="gap-1.5" disabled={!changeCount || saving} onClick={() => void save()}>
        {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{changeCount ? `Save ${changeCount} change${changeCount > 1 ? 's' : ''}` : 'Save'}
      </Button>
    </div>

    {(bulk.rates.length > 0 || bulk.availability.length > 0) && <div className="flex flex-wrap gap-2" aria-label="Pending bulk updates">
      {bulk.rates.map((r, i) => {
        const plan = grid?.rate_plans.find((p) => p.id === r.rate_plan_id);
        const room = roomTypes.find((t) => t.id === plan?.room_type_id);
        const fields = Object.entries(r).filter(([k]) => !['rate_plan_id', 'date_from', 'date_to', 'weekdays'].includes(k)).map(([k, v]) => `${k.replaceAll('_', ' ')} ${String(v)}`).join(', ');
        return <Badge key={`r${i}`} variant="secondary" className="gap-1 py-1">{room?.name} · {plan?.name} · {r.date_from}→{r.date_to}: {fields}<button aria-label="Remove" onClick={() => setBulk((b) => ({ ...b, rates: b.rates.filter((_, j) => j !== i) }))}><X className="h-3 w-3" /></button></Badge>;
      })}
      {bulk.availability.map((a, i) => <Badge key={`a${i}`} variant="secondary" className="gap-1 py-1">{roomTypes.find((t) => t.id === a.room_type_id)?.name} · {a.date_from}→{a.date_to}: rooms to sell {a.availability}<button aria-label="Remove" onClick={() => setBulk((b) => ({ ...b, availability: b.availability.filter((_, j) => j !== i) }))}><X className="h-3 w-3" /></button></Badge>)}
    </div>}

    {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm">{error}</div>}

    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b">
            <th className="sticky left-0 z-10 bg-card text-left font-medium p-2 min-w-[220px]">{busy ? 'Loading…' : ''}</th>
            {dates.map((d) => {
              const day = new Date(`${d}T12:00:00`);
              const weekend = day.getDay() === 0 || day.getDay() === 6;
              return <th key={d} className={`p-1.5 text-center font-medium min-w-[76px] ${weekend ? 'bg-muted/60' : ''}`}><div className="text-[11px] text-muted-foreground">{WEEKDAY[day.getDay()]}</div><div>{day.getDate()}.{day.getMonth() + 1}.</div></th>;
            })}
          </tr>
        </thead>
        <tbody>
          {roomTypes.map((rt) => {
            const plans = (grid?.rate_plans ?? []).filter((p) => p.room_type_id === rt.id);
            return <Fragment key={rt.id}>
              <tr className="bg-muted/40 border-t"><td colSpan={dates.length + 1} className="sticky left-0 p-2 font-semibold">{rt.name} <span className="font-normal text-muted-foreground">· {rt.num_rooms} rooms</span></td></tr>
              <tr className="border-b">
                <td className="sticky left-0 z-10 bg-card p-2 text-muted-foreground">Rooms to sell</td>
                {dates.map((d) => {
                  const a = availability.get(`${rt.id}|${d}`);
                  const key = cellKey('a', rt.id, d);
                  const original = a?.availability ?? rt.num_rooms;
                  const value = key in edits ? Number(edits[key]) : original;
                  return <td key={d} className={`p-1 text-center ${key in edits ? 'bg-amber-100 dark:bg-amber-900/30' : ''}`}>
                    <input type="number" min={0} max={rt.num_rooms} aria-label={`${rt.name} rooms to sell ${d}`} className="w-16 rounded border bg-background px-1 py-1 text-center" value={value}
                      onChange={(e) => setEdit(key, e.target.value === '' ? null : Math.max(0, Math.min(rt.num_rooms, Number(e.target.value))), original)} />
                    <div className="text-[10px] text-muted-foreground">{a?.booked ? `${a.booked} booked` : ' '}</div>
                  </td>;
                })}
              </tr>
              {plans.map((plan) => visibleRows.map((row, idx) => (
                <tr key={`${plan.id}-${row.field}`} className={idx === visibleRows.length - 1 ? 'border-b' : ''}>
                  <td className="sticky left-0 z-10 bg-card p-2">{idx === 0 ? <span className="font-medium">{plan.name}</span> : null}<div className="text-xs text-muted-foreground">{row.label}{row.kind === 'money' ? ` (${plan.currency || currency})` : ''}</div></td>
                  {dates.map((d) => {
                    const r = rates.get(`${plan.id}|${d}`);
                    const key = cellKey('r', plan.id, d, row.field);
                    const stored = r?.[row.field] ?? null;
                    const fallback = row.field === 'rate' ? Number(plan.base_rate) : row.kind === 'bool' ? false : row.field === 'max_stay' ? 0 : 1;
                    const original = (stored ?? fallback) as number | boolean;
                    const value = key in edits ? edits[key] : original;
                    const edited = key in edits;
                    return <td key={d} className={`p-1 text-center ${edited ? 'bg-amber-100 dark:bg-amber-900/30' : ''} ${row.field === 'stop_sell' && value === true ? 'bg-destructive/10' : ''}`}>
                      {row.kind === 'bool'
                        ? <input type="checkbox" aria-label={`${plan.name} ${row.label} ${d}`} checked={Boolean(value)} onChange={(e) => setEdit(key, e.target.checked, Boolean(original))} />
                        : <input type="number" min={row.kind === 'money' ? 0 : row.field === 'max_stay' ? 0 : 1} step={row.kind === 'money' ? '0.01' : '1'} aria-label={`${plan.name} ${row.label} ${d}`}
                            className={`rounded border bg-background px-1 py-1 text-center ${row.kind === 'money' ? 'w-20' : 'w-14'}`} value={String(value)}
                            onChange={(e) => {
                              if (e.target.value === '') return setEdit(key, null, original);
                              const n = row.kind === 'money' ? Math.round(Number(e.target.value) * 100) / 100 : Math.trunc(Number(e.target.value));
                              setEdit(key, Number.isFinite(n) ? n : null, original);
                            }} />}
                    </td>;
                  })}
                </tr>
              )))}
            </Fragment>;
          })}
        </tbody>
      </table>
    </div>

    {grid && <BulkAriDialog open={bulkOpen} onOpenChange={setBulkOpen} grid={grid} defaultFrom={start} defaultTo={end}
      onAdd={(changes) => setBulk((b) => ({ rates: [...b.rates, ...changes.rates], availability: [...b.availability, ...changes.availability] }))} />}
  </>);
}
