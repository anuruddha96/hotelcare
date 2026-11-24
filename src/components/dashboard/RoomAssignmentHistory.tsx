import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { History, RefreshCw, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { hasManagerPowers } from '@/lib/roleAccess';
import { Button } from '@/components/ui/button';
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

export function historyWindow(day: string, page: number) {
  const shift = (n: number) => {
    const d = new Date(day + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };
  return { from: shift(page * 30 + 29), to: shift(page * 30) };
}
export function missingAssignmentSnapshots(records: Saved[], snapshots: Snapshot[]) {
  const saved = new Set(records.map(a => [a.assignment_date, a.id, a.assigned_to].join('|')));
  return snapshots.filter(s => s.assigned_to && !saved.has([s.business_date, s.assignment_id, s.assigned_to].join('|')));
}
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
        <h3 className="font-semibold text-sm">{c.audit}</h3>
        {!result.events.length && !result.errors.includes('audit') && !result.errors.includes('all') && <p className="text-sm text-muted-foreground">{c.noAudit}</p>}
        {result.events.map(e=><div key={e.id} className="rounded-lg border p-2 space-y-1 text-sm">
          <div className="flex flex-wrap justify-between gap-1"><Badge variant="outline">{c[e.event_type]}</Badge><time dateTime={e.occurred_at} className="text-xs text-muted-foreground">{time.format(new Date(e.occurred_at))}</time></div>
          <div className="flex items-center flex-wrap gap-2">{person(e.previous_assignee_id,e.previous_assignee_name)}<ArrowRight className="h-4 w-4" />{person(e.new_assignee_id,e.new_assignee_name)}</div>
          <p className="text-xs text-muted-foreground">{c.by}: {e.actor_name || (e.actor_id?c.unknown:c.system)} · {e.assignment_date}</p>
        </div>)}
        <h3 className="font-semibold text-sm">{c.saved}</h3>
        <p className="text-xs text-muted-foreground">{c.note}</p>
        {!result.records.length && !result.snapshots.length && !result.errors.includes('saved') && !result.errors.includes('daily') && !result.errors.includes('all') && <p className="text-sm text-muted-foreground">{c.noSaved}</p>}
        {[...result.records.map(a=>({key:'a'+a.id,date:a.assignment_date,owner:a.assigned_to,by:a.assigned_by,created:a.created_at,snapshot:false})),
          ...result.snapshots.map(s=>({key:'s'+s.business_date+':'+s.assignment_id,date:s.business_date,owner:s.assigned_to,by:null,created:null,snapshot:true}))]
          .sort((a,b)=>b.date.localeCompare(a.date)).map(row=><div key={row.key} className="rounded-lg border p-2 text-sm space-y-1">
            <div className="flex justify-between gap-2"><span className="font-medium">{person(row.owner)}</span><span className="text-xs text-muted-foreground">{row.date}</span></div>
            {row.snapshot ? <span className="text-xs text-muted-foreground">{c.snapshot}</span> : <>
              <p className="text-xs text-muted-foreground">{c.recordedBy}: {row.by?person(row.by):c.unknown}</p>
              {row.created && <p className="text-xs text-muted-foreground">{c.created}: {time.format(new Date(row.created))}</p>}
            </>}
          </div>)}
      </>}
      <div className="flex flex-wrap justify-between gap-2">
        <Button type="button" variant="outline" size="sm" disabled={page===0} onClick={()=>{setResult(null);setPage(p=>p-1);}}>{c.newer}</Button>
        <Button type="button" variant="outline" size="sm" onClick={()=>{setResult(null);setPage(p=>p+1);}}>{c.older}</Button>
      </div>
    </>}
  </section>;
}
