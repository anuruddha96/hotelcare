import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { ALL_CURRICULA, trainingRoleFor } from '@/components/training/v2/curricula';
import { useTrainingV2, txt } from '@/components/training/v2/TrainingV2Provider';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
type Employee = {id:string;full_name:string|null;role:string;access_role:string|null;assigned_hotel:string|null};
type ProgressRow = {user_id:string;tour_key:string;status:string;current_step:number;completed_at:string|null};
type State = {user_id:string;dismissed_until:string|null;paused_at:string|null};
type Report = {employees:Employee[];progress:ProgressRow[];states:State[]};
export function HrTrainingAnalytics() {
  const {profile} = useAuth();
  const {language} = useTranslation();
  const {lang} = useTrainingV2();
  const tr=(en:string,hu:string)=>language==='hu'?hu:en;
  const [report,setReport]=useState<Report|null>(null);
  const [error,setError]=useState(false);
  const [refresh,setRefresh]=useState(0);
  const [query,setQuery]=useState('');
  const [hotel,setHotel]=useState('');
  const [role,setRole]=useState('');
  useEffect(()=>{
    let active=true;setReport(null);setError(false);
    if (!profile?.organization_slug) return;
    void supabase.functions.invoke('training-admin-action',{body:{action:'hr_analytics'}}).then(({data,error})=>{
      if(!active)return;
      if(error||!data?.ok||!Array.isArray(data.employees)||!Array.isArray(data.progress)||!Array.isArray(data.states)){setError(true);return;}
      setReport(data as Report);
    }).catch(()=>{if(active)setError(true);});
    return()=>{active=false;};
  },[profile?.id,profile?.organization_slug,refresh]);
  const result=useMemo(()=>{
    const people=(report?.employees??[]).filter(e=>(!hotel||e.assigned_hotel===hotel)&&(!role||trainingRoleFor(e)===role)&&(!query||(e.full_name??'').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
    const progress=new Map((report?.progress??[]).map(p=>[p.user_id+':'+p.tour_key,p]));
    const records=people.flatMap(e=>ALL_CURRICULA.filter(c=>c.category==='core'&&c.roles.some(r=>r===trainingRoleFor(e))).map(c=>{
      const row=progress.get(e.id+':'+c.slug);
      const completed=row?.status==='completed'||(c.replaces??[]).some(s=>progress.get(e.id+':'+s)?.status==='completed');
      return {employee:e,guide:c,status:completed?'completed':row?'in_progress':'not_started',step:row?.current_step??null};
    }));
    const ids=new Set(people.map(p=>p.id));
    const states=(report?.states??[]).filter(s=>ids.has(s.user_id));
    const byGuide=ALL_CURRICULA.map(guide=>({guide,rows:records.filter(r=>r.guide.slug===guide.slug)})).filter(g=>g.rows.length);
    return {people,records,byGuide,dismissed:states.filter(s=>s.dismissed_until&&new Date(s.dismissed_until).getTime()>Date.now()).length,paused:states.filter(s=>s.paused_at).length};
  },[report,query,hotel,role]);
  if(error)return <div role="alert" className="space-y-2"><p>{tr('Training analytics unavailable. No data was displayed.','A képzési elemzés nem elérhető.')}</p><Button onClick={()=>setRefresh(v=>v+1)}>{tr('Retry','Újra')}</Button></div>;
  if(!report)return <p role="status">{tr('Loading training data…','Képzések betöltése…')}</p>;
  const done=result.records.filter(r=>r.status==='completed').length;
  const running=result.records.filter(r=>r.status==='in_progress').length;
  const pct=result.records.length?Math.round(100*done/result.records.length):null;
  const label=(status:string)=>status==='completed'?tr('Completed','Befejezett'):status==='in_progress'?tr('In progress','Folyamatban'):tr('Not started','Nem kezdte el');
  return <section className="space-y-4">
    <p className="text-sm text-muted-foreground">{tr('Core guide coverage by eligible active app account. This is learning progress, not an assignment or deadline report; unlinked staff are excluded.','Alapútmutatók teljesítése jogosult aktív fiókonként. Ez nem feladat- vagy határidőjelentés; a nem kapcsolt munkatársak nem szerepelnek.')}</p>
    <div className="flex flex-wrap gap-2"><Input className="min-w-48 flex-1" value={query} onChange={e=>setQuery(e.target.value)} placeholder={tr('Search employee','Munkatárs keresése')} aria-label={tr('Search employee','Munkatárs keresése')}/>
    <select className="rounded-md border bg-background px-3" value={hotel} onChange={e=>setHotel(e.target.value)} aria-label={tr('Property','Telephely')}><option value="">{tr('All properties','Minden telephely')}</option>{[...new Set(report.employees.map(e=>e.assigned_hotel).filter(Boolean))].map(h=><option key={h} value={h??''}>{h}</option>)}</select>
    <select className="rounded-md border bg-background px-3" value={role} onChange={e=>setRole(e.target.value)} aria-label={tr('Role','Munkakör')}><option value="">{tr('All roles','Minden munkakör')}</option>{[...new Set(report.employees.map(trainingRoleFor).filter(Boolean))].map(r=><option key={r} value={r??''}>{r}</option>)}</select><Button variant="outline" onClick={()=>setRefresh(v=>v+1)}>{tr('Refresh','Frissítés')}</Button></div>
    <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">{[[tr('Completion','Teljesítés'),pct===null?'—':pct+'%'],[tr('Completed guides','Befejezett útmutatók'),done],[tr('In progress','Folyamatban'),running],[tr('Not started','Nem kezdte el'),result.records.length-done-running],[tr('Eligible accounts','Jogosult fiókok'),result.people.length],[tr('Muted prompts','Némított értesítések'),result.dismissed],[tr('Paused','Szünetel'),result.paused]].map(([name,value])=><Card key={name}><CardContent className="pt-4"><p className="text-sm text-muted-foreground">{name}</p><p className="text-2xl font-semibold">{value}</p></CardContent></Card>)}</div>
    <h2 className="text-lg font-semibold">{tr('Completion by guide','Teljesítés útmutatónként')}</h2>
    <div className="space-y-2">{result.byGuide.map(({guide,rows})=>{const complete=rows.filter(r=>r.status==='completed').length;return <Card key={guide.slug}><CardContent className="pt-4 space-y-2"><div className="flex justify-between gap-2 text-sm"><span>{txt(guide.name,lang)}</span><span>{complete}/{rows.length}</span></div><Progress value={100*complete/rows.length}/><details><summary className="cursor-pointer text-sm text-muted-foreground">{tr('Employees and recorded progress','Munkatársak és rögzített előrehaladás')}</summary><ul className="mt-2 divide-y">{rows.map(r=><li key={r.employee.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span>{r.employee.full_name??'—'}</span><span>{label(r.status)}{r.status==='in_progress'&&r.step!==null?' · '+tr('Step','Lépés')+' '+(r.step+1):''}</span></li>)}</ul></details></CardContent></Card>})}</div>
    {!result.byGuide.length&&<p className="text-muted-foreground">{tr('No applicable core guides for this selection.','Nincs alkalmazható útmutató.')}</p>}
  </section>;
}
