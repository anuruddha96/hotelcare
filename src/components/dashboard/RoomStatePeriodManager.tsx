import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { hasManagerPowers, isReceptionRole } from '@/lib/roleAccess';
import { todayBudapest } from '@/lib/budapestTime';
import { toast } from 'sonner';

type PeriodState = 'out_of_order' | 'out_of_service';
export interface RoomStatePeriod {
  id: string; state: PeriodState; from_date: string; to_date: string; reason: string; created_at: string;
}
function previousDay(day: string): string {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
/** Last affected day is inclusive; releasing today means last night was yesterday. */
export function suggestedLastDay(period: RoomStatePeriod, today: string): string {
  return period.from_date < today ? previousDay(today) : period.from_date;
}
interface Props {
  hotelId: string | null | undefined;
  roomId: string;
  roomNumber: string;
  active: boolean;
  onChanged?: () => void;
}
export function RoomStatePeriodManager({ hotelId, roomId, roomNumber, active, onChanged }: Props) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const canEdit = hasManagerPowers(profile?.role) || isReceptionRole(profile?.role) || profile?.role === 'supervisor';
  const today = todayBudapest();
  const [periods, setPeriods] = useState<RoomStatePeriod[]>([]);
  const [state, setState] = useState<PeriodState>('out_of_order');
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [reason, setReason] = useState('');
  const [endDates, setEndDates] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!active || !hotelId || !roomId) return;
    setLoading(true);
    try {
      const { data, error: queryError } = await (supabase as any).from('room_state_periods')
        .select('id,state,from_date,to_date,reason,created_at')
        .eq('hotel_id', hotelId).eq('room_id', roomId)
        .order('from_date', { ascending: false }).limit(100);
      if (queryError) throw queryError;
      setPeriods((data ?? []) as RoomStatePeriod[]);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setPeriods([]);
    } finally { setLoading(false); }
  }, [hotelId, roomId, active]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { setFromDate(today); setToDate(today); setReason(''); setEndDates({}); }, [roomId, today]);

  const create = async () => {
    if (!hotelId || !roomId || fromDate > toDate || !reason.trim()) {
      toast.error(t('ntak.phase4.validation')); return;
    }
    setBusy(true);
    try {
      const { error: rpcError } = await (supabase.rpc as CallableFunction)(
        'pms_add_room_state_period',
        { _hotel_id: hotelId, _room_id: roomId, _state: state,
          _from_date: fromDate, _to_date: toDate, _reason: reason.trim() },
      );
      if (rpcError) throw rpcError;
      toast.success(t('ntak.phase4.saved'));
      setReason('');
      await refresh();
      onChanged?.();
    } catch (e) {
      const err = e as { code?: string; message?: string };
      toast.error(err.code === '23P01' || /room_state_period_no_overlap/.test(err.message ?? '')
        ? t('ntak.phase4.overlap') : (err.message ?? t('ntak.phase4.failed')));
    } finally { setBusy(false); }
  };
  const end = async (period: RoomStatePeriod) => {
    const lastDay = endDates[period.id] ?? suggestedLastDay(period, today);
    if (lastDay < period.from_date || lastDay >= period.to_date) {
      toast.error(t('ntak.phase4.endInvalid')); return;
    }
    setBusy(true);
    try {
      const { error: rpcError } = await (supabase.rpc as CallableFunction)(
        'pms_end_room_state_period',
        { _period_id: period.id, _last_day: lastDay },
      );
      if (rpcError) throw rpcError;
      toast.success(t('ntak.phase4.ended'));
      await refresh();
      onChanged?.();
    } catch (e) { toast.error((e as Error).message || t('ntak.phase4.failed')); }
    finally { setBusy(false); }
  };

  if (!hotelId) return <p className="text-xs text-muted-foreground">{t('ntak.phase4.hotelMissing')}</p>;
  return (
    <section className="space-y-3" data-training="ntak-room-state-periods" aria-label={t('ntak.phase4.title')}>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <CalendarClock className="h-4 w-4" /> {t('ntak.phase4.title')} · {roomNumber}
      </h3>
      <p className="text-xs text-muted-foreground">{t('ntak.phase4.hint')}</p>
      {error && <p role="alert" className="text-xs text-destructive">{t('ntak.phase4.loadFailed')}: {error}</p>}
      {canEdit && (
        <div className="space-y-2 rounded-md border p-3">
          <Label htmlFor={'period-state-' + roomId}>{t('ntak.phase4.type')}</Label>
          <Select value={state} onValueChange={(v) => setState(v as PeriodState)}>
            <SelectTrigger id={'period-state-' + roomId}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="out_of_order">{t('ntak.phase4.ooo')}</SelectItem>
              <SelectItem value="out_of_service">{t('ntak.phase4.oos')}</SelectItem>
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor={'period-from-' + roomId}>{t('ntak.phase4.from')}</Label>
              <Input id={'period-from-' + roomId} type="date" value={fromDate}
                onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor={'period-to-' + roomId}>{t('ntak.phase4.to')}</Label>
              <Input id={'period-to-' + roomId} type="date" min={fromDate} value={toDate}
                onChange={(e) => setToDate(e.target.value)} />
            </div>
          </div>
          <Label htmlFor={'period-reason-' + roomId}>{t('ntak.phase4.reason')}</Label>
          <Textarea id={'period-reason-' + roomId} rows={2} maxLength={500}
            value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={t('ntak.phase4.reasonPlaceholder')} />
          <Button size="sm" disabled={busy || !reason.trim() || !fromDate || !toDate || toDate < fromDate}
            onClick={() => void create()}><Plus className="mr-1 h-3.5 w-3.5" />
            {t('ntak.phase4.add')}
          </Button>
        </div>
      )}
      <div className="space-y-2">
        <p className="text-xs font-medium">{t('ntak.phase4.history')}</p>
        {loading ? <p className="text-xs text-muted-foreground">{t('pms.loading')}</p>
          : periods.length === 0 ? <p className="text-xs text-muted-foreground">{t('ntak.phase4.empty')}</p>
            : periods.map((period) => {
              const current = period.from_date <= today && today <= period.to_date;
              const proposed = endDates[period.id] ?? suggestedLastDay(period, today);
              return (
                <div key={period.id} className="rounded-md border p-2 space-y-1 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={current ? 'destructive' : 'outline'}>
                      {t(period.state === 'out_of_order' ? 'ntak.phase4.ooo' : 'ntak.phase4.oos')}
                    </Badge>
                    {current && <Badge variant="secondary">{t('ntak.phase4.active')}</Badge>}
                    <span>{period.from_date} → {period.to_date}</span>
                  </div>
                  <p className="break-words text-muted-foreground">{period.reason}</p>
                  {canEdit && period.to_date >= today && period.to_date > period.from_date && (
                    <div className="flex flex-wrap items-end gap-2 pt-1">
                      <div>
                        <Label htmlFor={'end-period-' + period.id}>{t('ntak.phase4.lastDay')}</Label>
                        <Input id={'end-period-' + period.id} type="date" className="h-8 w-40"
                          min={period.from_date} max={period.to_date}
                          value={proposed} onChange={(e) => setEndDates((v) => ({ ...v, [period.id]: e.target.value }))} />
                      </div>
                      <Button size="sm" variant="outline" disabled={busy || proposed >= period.to_date || proposed < period.from_date}
                        onClick={() => void end(period)}>{t('ntak.phase4.end')}</Button>
                    </div>
                  )}
                </div>
              );
            })}
      </div>
      {canEdit && <p className="text-[11px] text-muted-foreground">{t('ntak.phase4.lastDayHint')}</p>}
    </section>
  );
}
