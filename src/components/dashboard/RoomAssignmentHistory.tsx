import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { History, RefreshCw, ArrowRight, ChevronDown, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { hasManagerPowers } from '@/lib/roleAccess';
import { Button } from '@/components/ui/button';
import { historyWindow, missingAssignmentSnapshots, groupAssignmentHistory } from '@/lib/roomAssignmentHistory';
import { Badge } from '@/components/ui/badge';

type Audit = {
  id: number; assignment_date: string; occurred_at: string;
  event_type: 'assigned' | 'reassigned' | 'unassigned';
  previous_assignee_id: string | null; previous_assignee_name: string | null;
  new_assignee_id: string | null; new_assignee_name: string | null;
  actor_id: string | null; actor_name: string | null;
};
type Saved = { id: string; assignment_date: string; assigned_to: string; assigned_by: string | null; created_at: string };
type Snapshot = { business_date: string; assignment_id: string | null; assigned_to: string | null };
const client = supabase as unknown as SupabaseClient;
const LIMIT = 200;

type Props = { hotel: string; roomId: string; roomNumber: string; selectedDate: string };
export function RoomAssignmentHistory(props: Props) {
  const { profile } = useAuth();
  const { language } = useTranslation();
  if (!profile?.organization_slug || !hasManagerPowers(profile.role)) return null;
  return <RoomHistoryContent key={`${profile.organization_slug}:${props.hotel}:${props.roomId}:${props.selectedDate}`}
    {...props} organizationSlug={profile.organization_slug} hu={language === 'hu'} />;
}
function RoomHistoryContent({ hotel, roomId, roomNumber, selectedDate, organizationSlug, hu }: Props & { organizationSlug: string; hu: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({ [selectedDate]: true });
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ events: Audit[]; records: Saved[]; snapshots: Snapshot[]; names: Record<string,string>; errors: string[]; truncated: boolean } | null>(null);
  const { from, to } = historyWindow(selectedDate, page);
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    setResult(null);
    async function load() {
      try {
        const keys = await resolveHotelKeys(hotel);
        if (cancelled) return;
        if (!keys.length) throw new Error('Missing property scope');
        const [audit, saved, daily] = await Promise.all([
          client.from('room_assignment_history').select('id,assignment_date,occurred_at,event_type,previous_assignee_id,previous_assignee_name,new_assignee_id,new_assignee_name,actor_id,actor_name')
            .eq('organization_slug', organizationSlug).eq('room_id', roomId).in('hotel', keys)
            .gte('assignment_date', from).lte('assignment_date', to).order('assignment_date', { ascending: false }).order('occurred_at', { ascending: false }).order('id', { ascending: false }).limit(LIMIT + 1),
          supabase.from('room_assignments').select('id,assignment_date,assigned_to,assigned_by,created_at')
            .eq('organization_slug', organizationSlug).eq('room_id', roomId)
            .gte('assignment_date', from).lte('assignment_date', to).order('assignment_date', { ascending: false }).order('created_at', { ascending: false }).order('id').limit(LIMIT + 1),
          client.from('housekeeping_room_snapshots').select('business_date,assignment_id,assigned_to')
            .eq('organization_slug', organizationSlug).eq('room_id', roomId).in('hotel', keys)
            .gte('business_date', from).lte('business_date', to).not('assigned_to','is',null).order('business_date', { ascending: false }).limit(LIMIT + 1),
        ]);
        const events = (audit.data ?? []) as Audit[];
        const records = (saved.data ?? []) as Saved[];
        const dailyRows = (daily.data ?? []) as Snapshot[];
        const errors = [audit.error && 'audit', saved.error && 'saved', daily.error && 'daily'].filter(Boolean) as string[];
        const ids = [...new Set([...records.flatMap(a => [a.assigned_to,a.assigned_by]), ...dailyRows.map(s => s.assigned_to)].filter((id): id is string => !!id))];
        const names: Record<string,string> = {};
        for (let i=0;i<ids.length;i+=100) {
          if (cancelled) return;
          const people = await supabase.from('profiles').select('id,full_name').eq('organization_slug', organizationSlug).in('id',ids.slice(i,i+100));
          if (people.error) { errors.push('names'); break; }
          for (const person of people.data ?? []) names[person.id] = person.full_name;
        }
        if (!cancelled) setResult({ events: events.slice(0,LIMIT), records: records.slice(0,LIMIT), snapshots: missingAssignmentSnapshots(records,dailyRows).slice(0,LIMIT), names, errors, truncated: [events,records,dailyRows].some(rows=>rows.length>LIMIT) });
      } catch {
        if (!cancelled) setResult({events:[],records:[],snapshots:[],names:{},errors:['all'],truncated:false});
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [expanded,hotel,roomId,organizationSlug,from,to,revision]);
  const c = hu ? {
    title:'Szobakiosztási előzmények', audit:'Hitelesített változások', saved:'Mentett kiosztások',
    note:'A korábbi mentett adatok nem igazolják az áthelyezés pontos idejét vagy végrehajtóját.',
    noAudit:'Nincs naplózott változás ebben az időszakban.', noSaved:'Nincs mentett kiosztás.',
    failed:'Egyes előzmények nem tölthetők be. Frissítse az adatokat.', loading:'Betöltés…',
    none:'Nincs kiosztva',unknown:'Ismeretlen',system:'Rendszer / ismeretlen',by:'Módosította',recordedBy:'Rögzített kiosztó',created:'Rekord létrehozva',
    assigned:'Kiosztva',reassigned:'Áthelyezve',unassigned:'Visszavonva',snapshot:'Mentett napi állapot',
    older:'Korábbi 30 nap',newer:'Újabb 30 nap',refresh:'Frissítés',truncated:'Az időszak első 200 rekordja látható.'
  } : {
    title:'Room assignment history',audit:'Verified assignment changes',saved:'Saved assignment records',
    note:'Older saved records show the recorded owner, not the exact time or actor of a reassignment.',
    noAudit:'No audited changes in this period.',noSaved:'No saved assignments in this period.',
    failed:'Some history could not be loaded. Please refresh.',loading:'Loading…',
    none:'Unassigned',unknown:'Unknown',system:'System / unknown',by:'Changed by',recordedBy:'Recorded assigned by',created:'Record created',
    assigned:'Assigned',reassigned:'Reassigned',unassigned:'Unassigned',snapshot:'Saved daily snapshot',
    older:'Older 30 days',newer:'Newer 30 days',refresh:'Refresh',truncated:'Showing the latest 200 records per source in this period.'
  };
  const labels = hu ? {
    selected: 'Kiválasztott munkanap', events: 'naplózott esemény', records: 'mentett rekord',
    incomplete: 'A mentett rekord nem bizonyítja, ki és mikor végezte az eredeti kiosztást. A korábbi áthelyezések hiányozhatnak.',
    savedOwner: 'Rögzített szobafelelős', noTime: 'Kiosztás ideje nem ismert', local: 'Budapesti idő',
    emptyDay: 'Nincs elérhető kiosztási adat erre a napra.', snapshot: 'Mentett napi állapot',
  } : {
    selected: 'Selected work date', events: 'audit events', records: 'saved records',
    incomplete: 'A saved record does not prove who made the original assignment or when. Earlier transfers may be missing.',
    savedOwner: 'Recorded housekeeper', noTime: 'Assignment time unknown', local: 'Budapest time',
    emptyDay: 'No assignment records available for this date.', snapshot: 'Saved daily snapshot',
  };
  const days = result ? groupAssignmentHistory(result.events, result.records, result.snapshots, page === 0 ? selectedDate : undefined) : [];
  const dateLabel = new Intl.DateTimeFormat(hu?'hu-HU':'en-GB',{timeZone:'UTC',dateStyle:'full'});
  const time = new Intl.DateTimeFormat(hu?'hu-HU':'en-GB',{timeZone:'Europe/Budapest',dateStyle:'medium',timeStyle:'medium'});
  const person = (id: string | null, name?: string | null) => name || (id ? result?.names[id] || c.unknown : c.none);
  return <section className="rounded-xl border p-3 space-y-3" aria-label={c.title}>
    <Button type="button" variant="ghost" className="w-full justify-start gap-2 px-0" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>
      <History className="h-4 w-4" />{c.title} · {roomNumber}
    </Button>
    {expanded && <>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">{from} – {to}</span>
        <Button type="button" variant="outline" size="sm" onClick={()=>{setResult(null);setRevision(v=>v+1);}} aria-label={c.refresh}><RefreshCw className="h-4 w-4" /></Button>
      </div>
      {!result ? <p role="status" className="text-sm text-muted-foreground">{c.loading}</p> : <>
        {!!result.errors.length && <p role="alert" className="text-sm text-destructive">{c.failed}</p>}
        {result.truncated && <p className="text-xs text-muted-foreground">{c.truncated}</p>}
        <p className="text-xs text-muted-foreground">{labels.local} · {c.note}</p>
        {days.length === 0 && !result.errors.length && <p className="text-sm text-muted-foreground">{c.noSaved}</p>}
        {days.map(day => {
          const isOpen = openDays[day.date] ?? false;
          const totalSaved = day.records.length + day.snapshots.length;
          return <div key={day.date} className="rounded-lg border border-border overflow-hidden">
            <button type="button" className="flex w-full items-center gap-2 bg-muted/40 px-3 py-2.5 text-left hover:bg-muted/70"
              aria-expanded={isOpen} onClick={() => setOpenDays(prev => ({ ...prev, [day.date]: !isOpen }))}>
              {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-sm">{dateLabel.format(new Date(day.date + 'T12:00:00Z'))}</span>
                <span className="block text-xs text-muted-foreground">{day.events.length} {labels.events} · {totalSaved} {labels.records}</span>
              </span>
              {day.date === selectedDate && <Badge variant="secondary" className="shrink-0">{labels.selected}</Badge>}
            </button>
            {isOpen && <div className="p-3 space-y-3">
              {!!day.events.length && <div className="space-y-2">
                <h3 className="font-semibold text-xs text-muted-foreground">{c.audit}</h3>
                <ol className="space-y-2 border-l-2 border-border pl-3 ml-1">
                  {day.events.map(e => <li key={e.id} className="relative rounded-lg border border-border p-2 space-y-1.5 text-sm">
                    <span className="absolute -left-[18px] top-3 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" aria-hidden="true" />
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <Badge variant="outline">{c[e.event_type]}</Badge>
                      <time dateTime={e.occurred_at} className="text-xs font-medium tabular-nums text-muted-foreground">{time.format(new Date(e.occurred_at))}</time>
                    </div>
                    <div className="flex items-center flex-wrap gap-2">
                      <span>{person(e.previous_assignee_id,e.previous_assignee_name)}</span><ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" /><span className="font-semibold">{person(e.new_assignee_id,e.new_assignee_name)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{c.by}: <span className="font-medium text-foreground">{e.actor_name || (e.actor_id ? c.unknown : c.system)}</span></p>
                  </li>)}
                </ol>
              </div>}
              {!day.events.length && !result.errors.includes('audit') && !result.errors.includes('all') && <p className="text-xs text-muted-foreground">{c.noAudit}</p>}
              {totalSaved > 0 && <div className="space-y-2">
                <h3 className="font-semibold text-xs text-muted-foreground">{c.saved}</h3>
                <p className="text-xs text-muted-foreground">{labels.incomplete}</p>
                {day.records.map(a => <div key={a.id} className="rounded-lg border border-border p-2 text-sm space-y-1">
                  <div className="flex items-center flex-wrap justify-between gap-1">
                    <span className="font-semibold">{person(a.assigned_to)}</span><span className="text-xs text-muted-foreground">{labels.savedOwner}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{c.recordedBy}: {a.assigned_by ? person(a.assigned_by) : c.unknown}</p>
                  <p className="text-xs text-muted-foreground">{c.created}: {time.format(new Date(a.created_at))} · {labels.noTime}</p>
                </div>)}
                {day.snapshots.map((s,i) => <div key={`${s.assignment_id ?? 'unknown'}:${i}`} className="rounded-lg border border-border p-2 text-sm space-y-1">
                  <div className="flex flex-wrap justify-between gap-1"><span className="font-semibold">{person(s.assigned_to)}</span><span className="text-xs text-muted-foreground">{labels.snapshot}</span></div>
                  <p className="text-xs text-muted-foreground">{labels.noTime}</p>
                </div>)}
              </div>}
              {!day.events.length && !totalSaved && !result.errors.length && <p className="text-xs text-muted-foreground">{labels.emptyDay}</p>}
            </div>}
          </div>;
        })}
      </>}
      <div className="flex flex-wrap justify-between gap-2">
        <Button type="button" variant="outline" size="sm" disabled={page===0} onClick={()=>{setResult(null);setPage(p=>p-1);}}>{c.newer}</Button>
        <Button type="button" variant="outline" size="sm" onClick={()=>{setResult(null);setPage(p=>p+1);}}>{c.older}</Button>
      </div>
    </>}
  </section>;
}
