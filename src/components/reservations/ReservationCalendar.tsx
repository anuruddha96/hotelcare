import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, differenceInCalendarDays, format, isSameDay, parseISO, startOfDay } from 'date-fns';
import { useTranslation } from '@/hooks/useTranslation';

interface ReservationCalendarProps { reservations: any[]; hotelId: string; days?: 14 | 21; }
const STATUS_COLORS: Record<string, string> = { pending: 'bg-slate-200 border-slate-400', confirmed: 'bg-sky-100 border-sky-400', checked_in: 'bg-emerald-100 border-emerald-500', checked_out: 'bg-zinc-100 border-zinc-300', cancelled: 'bg-rose-50 border-rose-300', no_show: 'bg-rose-100 border-rose-400' };
function label(r: any) { const n = `${r.guests?.first_name || ''} ${r.guests?.last_name || ''}`.trim(); return n || (r.source === 'previo' ? `Previo · ${r.source_reservation_id || r.reservation_number}` : r.reservation_number); }

export function ReservationCalendar({ reservations, hotelId, days = 14 }: ReservationCalendarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const [startDate, setStartDate] = useState(() => startOfDay(new Date()));
  const [rooms, setRooms] = useState<any[]>([]);
  useEffect(() => {
    if (!hotelId) return;
    (supabase as any).rpc('pms_hotel_room_keys', { _hotel_id: hotelId }).then(async ({ data }: any) => {
      const keys = Array.isArray(data) && data.length ? data : [hotelId];
      const { data: roomData } = await (supabase as any).from('rooms').select('id, room_number, room_type, status, actual_status').in('hotel', keys).order('room_number');
      setRooms(roomData || []);
    });
  }, [hotelId]);
  const dates = useMemo(() => Array.from({ length: days }, (_, i) => addDays(startDate, i)), [startDate, days]);
  const rangeEnd = addDays(startDate, days);
  const activeReservations = useMemo(() => reservations.filter((r) => r.status !== 'cancelled' && parseISO(r.check_in_date) < rangeEnd && parseISO(r.check_out_date) > startDate), [reservations, rangeEnd, startDate]);
  const byRoom = useMemo(() => { const m = new Map<string, any[]>(); activeReservations.forEach((r) => { if (!r.room_id) return; const arr = m.get(r.room_id) || []; arr.push(r); m.set(r.room_id, arr); }); return m; }, [activeReservations]);
  const unassigned = activeReservations.filter((r) => !r.room_id);
  const columnTemplate = `150px repeat(${days}, 68px)`;
  return <Card data-training="pms-room-planner">
    <CardHeader className="pb-2"><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="text-base">{t('pms.reservations.title')} · {t('common.room')}</CardTitle><div className="flex gap-1"><Button size="icon" variant="outline" onClick={() => setStartDate(addDays(startDate, -7))}><ChevronLeft className="h-4 w-4" /></Button><Button size="sm" variant="outline" onClick={() => setStartDate(startOfDay(new Date()))}>{t('pms.today')}</Button><Button size="icon" variant="outline" onClick={() => setStartDate(addDays(startDate, 7))}><ChevronRight className="h-4 w-4" /></Button></div></div></CardHeader>
    <CardContent className="p-0">
      {unassigned.length > 0 && <div className="px-3 pb-2 flex flex-wrap gap-1">{unassigned.map((r) => <Button key={r.id} size="sm" variant="outline" onClick={() => navigate(`/${organizationSlug}/reservations/${r.id}`)}>{label(r)} · {t('pms.reservationDetail.notSpecified')}</Button>)}</div>}
      <div className="overflow-x-auto border-t"><div style={{ minWidth: 150 + days * 68 }}>
        <div className="grid sticky top-0 z-20 bg-card border-b" style={{ gridTemplateColumns: columnTemplate }}><div className="sticky left-0 z-30 bg-card px-2 py-2 border-r text-xs font-semibold">{t('common.room')}</div>{dates.map((d) => <div key={d.toISOString()} className={`text-center border-r py-1 ${isSameDay(d, new Date()) ? 'bg-primary/10' : ''}`}><div className="text-[10px] text-muted-foreground">{format(d, 'EEE')}</div><div className="text-xs font-semibold">{format(d, 'dd')}</div></div>)}</div>
        {rooms.map((room) => <div key={room.id} className="grid border-b min-h-11" style={{ gridTemplateColumns: columnTemplate }}><div className="sticky left-0 z-10 bg-card border-r px-2 py-1.5"><div className="text-xs font-bold">{room.room_number}</div><div className="text-[10px] text-muted-foreground truncate">{room.room_type || room.status}</div></div>{dates.map((d, i) => {
          const dayReservations = (byRoom.get(room.id) || []).filter((r) => i >= Math.max(0, differenceInCalendarDays(parseISO(r.check_in_date), startDate)) && i < Math.min(days, differenceInCalendarDays(parseISO(r.check_out_date), startDate)));
          const r = dayReservations[0]; if (!r) return <div key={d.toISOString()} className={`${isSameDay(d, new Date()) ? 'bg-primary/[0.03]' : ''} border-r`} />;
          const start = Math.max(0, differenceInCalendarDays(parseISO(r.check_in_date), startDate)); const end = Math.min(days, differenceInCalendarDays(parseISO(r.check_out_date), startDate)); const first = i === start; const last = i === end - 1;
          return <button key={d.toISOString()} onClick={() => navigate(`/${organizationSlug}/reservations/${r.id}`)} className="relative border-r h-11 text-left" title={`${label(r)} · ${r.reservation_number}`}><span className={`absolute inset-y-1 border ${STATUS_COLORS[r.status] || 'bg-muted border-border'} ${first ? 'left-1 rounded-l-md' : 'left-0 border-l-0'} ${last ? 'right-1 rounded-r-md' : 'right-0 border-r-0'} overflow-hidden`}>{first && <span className="block px-1 pt-1 text-[10px] font-semibold whitespace-nowrap max-w-[130px] truncate">{label(r)}</span>}</span></button>;
        })}</div>)}
      </div></div>
      <div className="p-3 border-t flex flex-wrap gap-2">{Object.entries({ confirmed: t('pms.reservations.confirmed'), checked_in: t('pms.reservations.checkedIn'), pending: t('pms.reservations.pending'), no_show: t('pms.reservations.noShow') }).map(([s, l]) => <div key={s} className="flex items-center gap-1"><span className={`w-5 h-3 rounded border ${STATUS_COLORS[s]}`} /><span className="text-xs text-muted-foreground">{l}</span></div>)}</div>
    </CardContent>
  </Card>;
}
