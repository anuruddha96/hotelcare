import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock3, Users, RefreshCw, CheckCircle2, ListChecks } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { todayBudapest } from '@/lib/budapestTime';
import { useTranslation } from '@/hooks/useTranslation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SlntSimpleAvailabilityCalendar } from './SlntSimpleAvailabilityCalendar';
import { SlntTeamBRoomPreview, type SlntTeamBPreviewItem } from './SlntTeamBRoomPreview';
import { groupSlntManagerRooms, type SlntManagerFilter } from '@/lib/slntTeamBManagerSummary';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { slntWorkSection } from '@/lib/slntTeamBQueue';

type Room = SlntTeamBPreviewItem;
type Staff = {id: string;full_name: string};

/** Additive SLNT-only section. Existing property/PMS/room chips and individual
 * housekeeper cards are rendered before and after this component unchanged. */
export function SlntTeamPoolSummary({selectedDate,staff}:{
  selectedDate:string;staff:Staff[];
}) {
  const { language } = useTranslation();
  const hu=language==='hu';
  const [rooms,setRooms]=useState<Room[]>([]);
  const [selected,setSelected]=useState<SlntManagerFilter|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [loading,setLoading]=useState(false);
  const today=todayBudapest();
  const refresh=useCallback(async()=>{
    if(selectedDate!==today){setRooms([]);setSelected(null);setError(null);return;}
    setLoading(true);
    const {data,error:failure}=await (supabase as any).rpc('slnt_team_b_pool_v6',{p_service_date:today});
    if(failure){setRooms([]);setError(failure.message);}
    else{setRooms((data||[]) as Room[]);setError(null);}
    setLoading(false);
  },[selectedDate,today]);
  useEffect(()=>{
    void refresh();
    const timer=window.setInterval(()=>void refresh(),15_000);
    const channel=supabase.channel('slnt-manager-pool-'+selectedDate)
      .on('postgres_changes',{event:'*',schema:'public',table:'room_assignments',filter:'assignment_date=eq.'+selectedDate},()=>void refresh())
      .subscribe();
    const notify=()=>void refresh();
    window.addEventListener('hk-assignments-changed',notify);
    window.addEventListener('hotelcare:slnt-team-b-availability-changed',notify);
    return()=>{
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
      window.removeEventListener('hk-assignments-changed',notify);
      window.removeEventListener('hotelcare:slnt-team-b-availability-changed',notify);
    };
  },[refresh]);
  const grouped=useMemo(()=>groupSlntManagerRooms(rooms,today),[rooms,today]);
  const people=useMemo(()=>new Map(staff.map(s=>[s.id,s.full_name])),[staff]);
  const labels:Record<SlntManagerFilter,string>={
    pending:hu?'Függőben · még nem kezdődött el':'Pending · not started',
    working:hu?'Folyamatban':'In progress',
    done:hu?'Elkészült':'Done',
    awaiting:hu?'Jóváhagyásra vár':'Awaiting approval',
    approved:hu?'Jóváhagyva':'Approved',
    ready:hu?'RTC-re kész kijelentkezők':'RTC checkouts',
    waiting:hu?'RTC-re vár':'Waiting RTC',
    due:hu?'Esedékes napi feladatok':'Due stayovers',
    optional:hu?'Opcionális':'Optional',
  };
  const selectedRooms=selected?grouped[selected]:[];
  const navigateApprovals=()=>{
    setSelected(null);
    window.dispatchEvent(new CustomEvent('tour:navigate',{detail:{tab:'housekeeping',subTab:'supervisor'}}));
  };
  const working=grouped.working.map(r=>({id:r.room_id,room:r.room_name||r.room_number,name:people.get(r.assigned_to||'')||(hu?'Takarító':'Cleaner')}));


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
              ? <p className="text-sm text-muted-foreground">{hu?'A közös lista a kiválasztott munkanapon aktiválódik.':'The shared pool activates on the selected workday.'}</p>
              : error ? <p role="alert" className="text-sm text-destructive">{error}</p>
              : <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(['pending','working','done','awaiting','approved','ready','due','optional','waiting'] as SlntManagerFilter[]).map(key=>
                    <button key={key} type="button" data-training={'slnt-summary-'+key} onClick={()=>setSelected(key)}
                      className="rounded-lg border bg-card p-2 text-left hover:border-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary">
                      <span className="block text-xl font-extrabold tabular-nums">{grouped[key].length}</span>
                      <span className="text-xs font-medium text-muted-foreground">{labels[key]}</span>
                    </button>)}
                </div>}
            {working.length>0&&<div className="border-t pt-2 space-y-1">
              <p className="font-medium text-sm flex items-center gap-1"><Clock3 className="h-3.5 w-3.5"/>{hu?'Jelenleg takarít':'Cleaning now'}</p>
              {working.map(x=><p key={x.id} className="text-xs text-muted-foreground">
                {x.name} · {x.room}
              </p>)}
            </div>}
          </CardContent>
        </Card>
      </div>
      <SlntSimpleAvailabilityCalendar compact onSaved={()=>void refresh()}/>
      <Dialog open={!!selected} onOpenChange={open=>{if(!open)setSelected(null);}}>
        <DialogContent className="max-h-[92dvh] w-[96vw] max-w-4xl overflow-y-auto p-3 sm:p-5" data-training="slnt-pool-room-details">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ListChecks className="h-5 w-5"/>
            {selected?labels[selected]:''} ({selectedRooms.length})
          </DialogTitle></DialogHeader>
          {selected==='awaiting'&&<Button onClick={navigateApprovals} data-training="slnt-go-to-approvals" className="w-full sm:w-fit">
            <CheckCircle2 className="mr-2 h-4 w-4"/>{hu?'Jóváhagyások megnyitása':'Open Pending Approvals'}
          </Button>}
          {selectedRooms.length===0
            ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{hu?'Nincs szoba ebben a kategóriában.':'No rooms in this category.'}</p>
            : <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {selectedRooms.map(room=><div key={room.room_id} className="space-y-1">
                  {room.assigned_to&&<p className="text-xs font-semibold text-muted-foreground">
                    {hu?'Takarító':'Cleaner'}: {people.get(room.assigned_to)||(hu?'Csapattag':'Team member')}
                  </p>}
                  <SlntTeamBRoomPreview item={room} date={today} hu={hu} userId={undefined}
                    busy={false} managerView onStart={()=>{}} onOpen={()=>{}}/>
                </div>)}
              </div>}
          {selected==='awaiting'&&selectedRooms.length>0&&
            <Button onClick={navigateApprovals}>{hu?'Tovább a jóváhagyásokhoz':'Go to Pending Approvals'}</Button>}
        </DialogContent>
      </Dialog>
      <p className="text-xs text-muted-foreground">
        {hu?'A szobák a B csapat közös listájában maradnak addig, amíg egy takarító el nem kezdi őket. Ezután a dolgozó saját kártyáján is megjelennek.':
          'Rooms stay in the shared Team B pool until a cleaner starts. Then they appear on that cleaner’s individual card as well.'}
      </p>
    </section>
  );
}
