import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock3, Users, RefreshCw, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { todayBudapest } from '@/lib/budapestTime';
import { useTranslation } from '@/hooks/useTranslation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SlntSimpleAvailabilityCalendar } from './SlntSimpleAvailabilityCalendar';
import { slntWorkSection } from '@/lib/slntTeamBQueue';

type Room = {
  room_id: string; room_number: string; is_checkout_room: boolean;
  pms_metadata: Record<string,unknown>|null; assignment_id: string|null;
  assigned_to: string|null; assignment_status: string|null;
  supervisor_approved: boolean; is_optional: boolean;
};
type Staff = {id: string;full_name: string};

/** Additive SLNT-only section. Existing property/PMS/room chips and individual
 * housekeeper cards are rendered before and after this component unchanged. */
export function SlntTeamPoolSummary({selectedDate,staff}:{
  selectedDate:string;staff:Staff[];
}) {
  const { language } = useTranslation();
  const hu=language==='hu';
  const [rooms,setRooms]=useState<Room[]>([]);
  const [error,setError]=useState<string|null>(null);
  const [loading,setLoading]=useState(false);
  const today=todayBudapest();
  const refresh=useCallback(async()=>{
    if(selectedDate!==today){setRooms([]);setError(null);return;}
    setLoading(true);
    const {data,error:failure}=await (supabase as any).rpc('slnt_team_b_pool_v4',{p_service_date:today});
    if(failure){setRooms([]);setError(failure.message);}
    else{setRooms((data||[]) as Room[]);setError(null);}
    setLoading(false);
  },[selectedDate,today]);
  useEffect(()=>{
    void refresh();
    const timer=window.setInterval(()=>void refresh(),30_000);
    const notify=()=>void refresh();
    window.addEventListener('hk-assignments-changed',notify);
    window.addEventListener('hotelcare:slnt-team-b-availability-changed',notify);
    return()=>{
      window.clearInterval(timer);
      window.removeEventListener('hk-assignments-changed',notify);
      window.removeEventListener('hotelcare:slnt-team-b-availability-changed',notify);
    };
  },[refresh]);
  const summary=useMemo(()=>{
    const rtc=rooms.filter(r=>slntWorkSection(r,today)==='rtc');
    const waiting=rooms.filter(r=>slntWorkSection(r,today)==='waiting');
    const due=rooms.filter(r=>!r.is_checkout_room&&!r.is_optional);
    const optional=rooms.filter(r=>r.is_optional);
    const unstarted=rooms.filter(r=>!r.assignment_id);
    const inProgress=rooms.filter(r=>r.assignment_status==='in_progress');
    const finished=rooms.filter(r=>r.assignment_status==='completed');
    const people=new Map(staff.map(s=>[s.id,s.full_name]));
    const working=inProgress.map(r=>({room:r.room_number,name:people.get(r.assigned_to||'')||'Cleaner'}));
    return{rtc:rtc.length,waiting:waiting.length,due:due.length,optional:optional.length,
      unstarted:unstarted.length,inProgress:inProgress.length,
      pendingApproval:finished.filter(r=>!r.supervisor_approved).length,
      approved:finished.filter(r=>r.supervisor_approved).length,working};
  },[rooms,staff,today]);

  return (
    <section data-training="slnt-team-pool-manager" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{hu?'Csapatok és napi munkák':'Teams & daily work'}</h3>
        {selectedDate===today&&<Button size="sm" variant="outline" disabled={loading} onClick={()=>void refresh()}>
          <RefreshCw className="h-4 w-4 mr-1"/>{hu?'Frissítés':'Refresh'}
        </Button>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="border-dashed" data-training="slnt-team-a-placeholder">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              <span className="flex items-center gap-2"><Users className="h-4 w-4"/>{hu?'A csapat':'Team A'}</span>
              <Badge variant="outline">{hu?'Beállítás alatt':'Setup pending'}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {hu?'A szobák és dolgozók később, az SLNT vezetőivel együtt lesznek beállítva.':
              'Rooms and cleaners will be mapped with SLNT management later. No Team A rooms have been allocated.'}
          </CardContent>
        </Card>
        <Card data-training="slnt-team-b-summary">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-base gap-2">
              <span className="flex items-center gap-2"><Users className="h-4 w-4"/>{hu?'B csapat':'Team B'}</span>
              <Badge>{hu?'Közös munkalista':'Shared pool'}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {selectedDate!==today
              ? <p className="text-sm text-muted-foreground">{hu?'A közös lista a kiválasztott munkanapon aktiválódik.':
                'The live shared pool activates on the selected workday.'}</p>
              : error ? <p role="alert" className="text-sm text-destructive">{error}</p>
              : <div className="grid grid-cols-2 gap-2 text-sm">
                  <span>{hu?'Kezdetlen':'Not started'}: <strong>{summary.unstarted}</strong></span>
                  <span className="text-blue-700 dark:text-blue-300">{hu?'Folyamatban':'Working'}: <strong>{summary.inProgress}</strong></span>
                  <span>{hu?'RTC kijelentkezés':'RTC checkouts'}: <strong>{summary.rtc}</strong></span>
                  <span>{hu?'Napi feladat':'Due stayovers'}: <strong>{summary.due}</strong></span>
                  <span>{hu?'RTC-re vár':'Waiting RTC'}: <strong>{summary.waiting}</strong></span>
                  <span>{hu?'Opcionális':'Optional'}: <strong>{summary.optional}</strong></span>
                  <span>{hu?'Jóváhagyásra vár':'Awaiting approval'}: <strong>{summary.pendingApproval}</strong></span>
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5"/>{hu?'Jóváhagyva':'Approved'}: <strong>{summary.approved}</strong></span>
                </div>}
            {summary.working.length>0&&<div className="border-t pt-2 space-y-1">
              <p className="font-medium text-sm flex items-center gap-1"><Clock3 className="h-3.5 w-3.5"/>{hu?'Jelenleg takarít':'Cleaning now'}</p>
              {summary.working.map(x=><p key={x.room} className="text-xs text-muted-foreground">
                {x.name} · {x.room}
              </p>)}
            </div>}
          </CardContent>
        </Card>
      </div>
      <SlntSimpleAvailabilityCalendar compact onSaved={()=>void refresh()}/>
      <p className="text-xs text-muted-foreground">
        {hu?'A szobák a B csapat közös listájában maradnak addig, amíg egy takarító el nem kezdi őket. Ezután a dolgozó saját kártyáján is megjelennek.':
          'Rooms stay in the shared Team B pool until a cleaner starts. Then they appear on that cleaner’s individual card as well.'}
      </p>
    </section>
  );
}
