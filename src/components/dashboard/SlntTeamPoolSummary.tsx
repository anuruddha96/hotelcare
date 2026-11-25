import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, BadgeCheck, CalendarClock, CheckCircle2, ClipboardCheck, Clock3, Hourglass, ListChecks, PlayCircle, RefreshCw, ShieldCheck, Sparkles, Users } from 'lucide-react';
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

const SUMMARY_FILTERS: SlntManagerFilter[] = [
  'pending', 'working', 'done', 'awaiting', 'approved', 'ready', 'due', 'optional', 'waiting',
];

// Keep the nine existing room categories and click behavior; the visual treatment
// makes each category recognizable at a glance, including on small touch screens.
const TILE_STYLE: Record<SlntManagerFilter, {
  Icon: typeof Clock3; surface: string; icon: string; metric: string;
}> = {
  pending: {
    Icon: Clock3,
    surface: 'border-amber-200 bg-gradient-to-br from-amber-50 to-orange-100/60 hover:border-amber-400 dark:border-amber-800/70 dark:from-amber-950/50 dark:to-orange-950/30',
    icon: 'bg-amber-100 text-amber-700 dark:bg-amber-900/70 dark:text-amber-300',
    metric: 'text-amber-950 dark:text-amber-100',
  },
  working: {
    Icon: PlayCircle,
    surface: 'border-blue-200 bg-gradient-to-br from-blue-50 to-sky-100/70 hover:border-blue-400 dark:border-blue-800/70 dark:from-blue-950/50 dark:to-sky-950/30',
    icon: 'bg-blue-100 text-blue-700 dark:bg-blue-900/70 dark:text-blue-300',
    metric: 'text-blue-950 dark:text-blue-100',
  },
  done: {
    Icon: CheckCircle2,
    surface: 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-100/70 hover:border-emerald-400 dark:border-emerald-800/70 dark:from-emerald-950/50 dark:to-green-950/30',
    icon: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/70 dark:text-emerald-300',
    metric: 'text-emerald-950 dark:text-emerald-100',
  },
  awaiting: {
    Icon: ClipboardCheck,
    surface: 'border-orange-200 bg-gradient-to-br from-orange-50 to-rose-100/60 hover:border-orange-400 dark:border-orange-800/70 dark:from-orange-950/50 dark:to-rose-950/30',
    icon: 'bg-orange-100 text-orange-700 dark:bg-orange-900/70 dark:text-orange-300',
    metric: 'text-orange-950 dark:text-orange-100',
  },
  approved: {
    Icon: BadgeCheck,
    surface: 'border-teal-200 bg-gradient-to-br from-teal-50 to-cyan-100/70 hover:border-teal-400 dark:border-teal-800/70 dark:from-teal-950/50 dark:to-cyan-950/30',
    icon: 'bg-teal-100 text-teal-700 dark:bg-teal-900/70 dark:text-teal-300',
    metric: 'text-teal-950 dark:text-teal-100',
  },
  ready: {
    Icon: ShieldCheck,
    surface: 'border-cyan-200 bg-gradient-to-br from-cyan-50 to-sky-100/70 hover:border-cyan-400 dark:border-cyan-800/70 dark:from-cyan-950/50 dark:to-sky-950/30',
    icon: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/70 dark:text-cyan-300',
    metric: 'text-cyan-950 dark:text-cyan-100',
  },
  due: {
    Icon: CalendarClock,
    surface: 'border-violet-200 bg-gradient-to-br from-violet-50 to-purple-100/70 hover:border-violet-400 dark:border-violet-800/70 dark:from-violet-950/50 dark:to-purple-950/30',
    icon: 'bg-violet-100 text-violet-700 dark:bg-violet-900/70 dark:text-violet-300',
    metric: 'text-violet-950 dark:text-violet-100',
  },
  optional: {
    Icon: Sparkles,
    surface: 'border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100/80 hover:border-slate-400 dark:border-slate-700 dark:from-slate-900/70 dark:to-slate-800/50',
    icon: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200',
    metric: 'text-slate-900 dark:text-slate-100',
  },
  waiting: {
    Icon: Hourglass,
    surface: 'border-rose-200 bg-gradient-to-br from-rose-50 to-pink-100/70 hover:border-rose-400 dark:border-rose-800/70 dark:from-rose-950/50 dark:to-pink-950/30',
    icon: 'bg-rose-100 text-rose-700 dark:bg-rose-900/70 dark:text-rose-300',
    metric: 'text-rose-950 dark:text-rose-100',
  },
};

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
        <Card data-training="slnt-team-b-summary" className="min-w-0 border-sky-200/80 shadow-sm dark:border-sky-900/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex min-w-0 flex-wrap items-center justify-between text-base gap-2">
              <span className="flex items-center gap-2"><Users className="h-4 w-4"/>{hu?'B csapat':'Team B'}</span>
              <Badge className="bg-sky-500 text-white hover:bg-sky-600">{hu?'Közös munkalista':'Shared pool'}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {selectedDate!==today
              ? <p className="text-sm text-muted-foreground">{hu?'A közös lista a kiválasztott munkanapon aktiválódik.':'The shared pool activates on the selected workday.'}</p>
              : error ? <p role="alert" className="text-sm text-destructive">{error}</p>
              : <div className="grid min-w-0 grid-cols-2 gap-2.5 sm:grid-cols-3" data-training="slnt-team-b-status-grid">
                  {SUMMARY_FILTERS.map(key => {
                    const style = TILE_STYLE[key];
                    const Icon = style.Icon;
                    return (
                      <button key={key} type="button" data-training={'slnt-summary-'+key}
                        onClick={() => setSelected(key)}
                        aria-label={[labels[key], grouped[key].length, hu ? 'szoba, részletek megnyitása' : 'rooms, view details'].join(' ')}
                        className={'group flex min-h-[112px] min-w-0 flex-col rounded-xl border p-3 text-left shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:focus-visible:ring-offset-background ' + style.surface}>
                        <span className="flex w-full items-start justify-between gap-1">
                          <span className={'inline-flex rounded-lg p-2 ' + style.icon}>
                            <Icon className="h-4 w-4" aria-hidden="true"/>
                          </span>
                          <ArrowUpRight className="h-4 w-4 text-muted-foreground/65 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true"/>
                        </span>
                        <span className={'mt-2 block text-2xl font-extrabold leading-none tabular-nums ' + style.metric}>{grouped[key].length}</span>
                        <span className="mt-1 block break-words text-xs font-semibold leading-snug text-foreground/85">{labels[key]}</span>
                      </button>
                    );
                  })}
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
