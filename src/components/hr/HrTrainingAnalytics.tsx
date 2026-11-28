import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { curriculaForOrganization, trainingRoleFor } from '@/components/training/v2/curricula';
import { useTrainingV2, txt } from '@/components/training/v2/TrainingV2Provider';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { GraduationCap, CheckCircle2, Clock, CircleDashed, Users, BellOff, PauseCircle, Download, RefreshCw, Hotel, BookOpen } from 'lucide-react';
import { groupLearning, summarizeLearning, learningCsvCell, type LearningStatus } from '@/lib/hr-learning-analytics';
import { roleTone, propertyTone } from './attendance-appearance';
import { hotelKey, hotelName } from '@/lib/workforce/model';
type Employee = {id:string;full_name:string|null;role:string;access_role:string|null;assigned_hotel:string|null};
type ProgressRow = {user_id:string;tour_key:string;status:string;current_step:number;completed_at:string|null};
type State = {user_id:string;dismissed_until:string|null;paused_at:string|null};
type Report = {organization_slug:string;employees:Employee[];progress:ProgressRow[];states:State[]};
export function HrTrainingAnalytics() {
  const {profile} = useAuth();
  const {language} = useTranslation();
  const {lang} = useTrainingV2();
  const tr=(en:string,hu:string)=>language==='hu'?hu:en;
  const [loaded,setReport]=useState<{owner:string;report:Report}|null>(null);
  const organization=profile?.organization_slug;
  const owner=profile?.id+'|'+organization;
  const report=loaded?.owner===owner&&loaded.report.organization_slug===organization?loaded.report:null;
  const [error,setError]=useState(false);
  const [refresh,setRefresh]=useState(0);
  const [query,setQuery]=useState('');
  const [hotel,setHotel]=useState('');
  const [role,setRole]=useState('');
  const [statusFilter,setStatusFilter]=useState<LearningStatus|''>('');
  const [employeeFilter,setEmployeeFilter]=useState('');
  useEffect(()=>{
    let active=true;setReport(null);setError(false);
    if (!profile?.organization_slug) return;
    void supabase.functions.invoke('training-admin-action',{body:{action:'hr_analytics'}}).then(({data,error})=>{
      if(!active)return;
      if(error||!data?.ok||data.organization_slug!==organization||!Array.isArray(data.employees)||!Array.isArray(data.progress)||!Array.isArray(data.states)){setError(true);return;}
      setReport({owner,report:data as Report});
    }).catch(()=>{if(active)setError(true);});
    return()=>{active=false;};
  },[profile?.id,organization,owner,refresh]);
  const result=useMemo(()=>{
    const people=(report?.employees??[]).filter(e=>(!hotel||(e.assigned_hotel??'__unassigned')===hotel)&&(!role||trainingRoleFor(e)===role)&&(!query||(e.full_name??'').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
    const progress=new Map((report?.progress??[]).map(p=>[p.user_id+':'+p.tour_key,p]));
    const catalogue=curriculaForOrganization(organization);
    const records=people.flatMap(e=>catalogue.filter(c=>c.category==='core'&&c.roles.some(r=>r===trainingRoleFor(e))).map(c=>{
      const row=progress.get(e.id+':'+c.slug);
      const completed=row?.status==='completed'||(c.replaces??[]).some(s=>progress.get(e.id+':'+s)?.status==='completed');
      return {employee:e,guide:c,status:(completed?'completed':row?'in_progress':'not_started') as LearningStatus,step:row?.current_step??null};
    }));
    const ids=new Set(people.map(p=>p.id));
    const states=(report?.states??[]).filter(s=>ids.has(s.user_id));
    const byGuide=catalogue.map(guide=>({guide,rows:records.filter(r=>r.guide.slug===guide.slug)})).filter(g=>g.rows.length);
    return {people,records,byGuide,dismissed:states.filter(s=>s.dismissed_until&&new Date(s.dismissed_until).getTime()>Date.now()).length,paused:states.filter(s=>s.paused_at).length};
  },[report,query,hotel,role,organization]);
  if(error)return <div role="alert" className="space-y-2"><p>{tr('Training analytics unavailable. No data was displayed.','A képzési elemzés nem elérhető.')}</p><Button onClick={()=>setRefresh(v=>v+1)}>{tr('Retry','Újra')}</Button></div>;
  if(!report)return <p role="status">{tr('Loading training data…','Képzések betöltése…')}</p>;
  const evidence=result.records.map(r=>({employeeId:r.employee.id,guideKey:r.guide.slug,status:r.status,role:trainingRoleFor(r.employee)??'other',property:r.employee.assigned_hotel??'__unassigned'}));
  const totals=summarizeLearning(evidence);
  const label=(status:string)=>status==='completed'?tr('Completed','Befejezett'):status==='in_progress'?tr('In progress','Folyamatban'):tr('Not started','Nem kezdte el');
  const roleNames:Record<string,[string,string]>={housekeeping:['Housekeeping','Housekeeping'],reception:['Reception','Recepció'],front_office:['Front office','Front office'],reception_manager:['Front Office Managers','Recepcióvezetők'],maintenance:['Maintenance','Karbantartás'],maintenance_manager:['Maintenance Managers','Karbantartási vezetők'],housekeeping_manager:['Housekeeping Managers','Housekeeping vezetők'],supervisor:['Supervisors','Felügyelők'],manager:['Managers','Vezetők'],breakfast_staff:['Breakfast','Reggeliztetés'],other:['Other','Egyéb']};
  const roleName=(r:string)=>roleNames[r]?tr(...roleNames[r]):r;
  const roleColor=(r:string)=>roleTone(({reception_manager:'front_office_manager',front_office:'reception',supervisor:'housekeeping_supervisor',breakfast_staff:'breakfast',maintenance_manager:'maintenance'} as Record<string,string>)[r]??r);
  const propertyName=(h:string|null)=>h&&h!=='__unassigned'?hotelName(hotelKey(h)):tr('Unassigned / company','Nincs hozzárendelve / cég');
  const propertyFilter=(h:string)=>setHotel(h==='__unassigned'?'__unassigned':h);
  const byRole=groupLearning(evidence,'role'), byProperty=groupLearning(evidence,'property'), byEmployee=groupLearning(evidence,'employeeId');
  const statusTone:Record<LearningStatus,string>={completed:'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',in_progress:'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',not_started:'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200'};
  const detailRecords=result.records.filter(r=>(!statusFilter||r.status===statusFilter)&&(!employeeFilter||r.employee.id===employeeFilter));
  const exportCsv=()=>{
    const rows=[[tr('Employee','Munkatárs'),tr('Property','Telephely'),tr('Role','Munkakör'),tr('Guide','Útmutató'),tr('Status','Állapot')],...detailRecords.map(r=>[r.employee.full_name??'',propertyName(r.employee.assigned_hotel),roleName(trainingRoleFor(r.employee)??'other'),txt(r.guide.name,lang),label(r.status)])];
    const url=URL.createObjectURL(new Blob(['\uFEFF',rows.map(line=>line.map(learningCsvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='hotelcare-guide-coverage.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const roles=[...new Set(report.employees.map(trainingRoleFor).filter((v):v is string=>!!v))].sort();
  const hotels=[...new Set(report.employees.map(e=>e.assigned_hotel??'__unassigned'))].sort((a,b)=>propertyName(a).localeCompare(propertyName(b)));
  const metricCards=[
    {name:tr('Completion','Teljesítés'),value:totals.rate===null?'—':totals.rate+'%',Icon:GraduationCap,tone:'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-100'},
    {name:tr('Completed guides','Befejezett útmutatók'),value:totals.completed,Icon:CheckCircle2,tone:'border-teal-200 bg-teal-50 text-teal-950 dark:border-teal-800 dark:bg-teal-950/60 dark:text-teal-100'},
    {name:tr('In progress','Folyamatban'),value:totals.inProgress,Icon:Clock,tone:'border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-100'},
    {name:tr('Not started','Nem kezdte el'),value:totals.notStarted,Icon:CircleDashed,tone:'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100'},
    {name:tr('Eligible accounts','Jogosult fiókok'),value:byEmployee.length,Icon:Users,tone:'border-indigo-200 bg-indigo-50 text-indigo-950 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-100'},
    {name:tr('Muted prompts','Némított értesítések'),value:result.dismissed,Icon:BellOff,tone:'border-violet-200 bg-violet-50 text-violet-950 dark:border-violet-800 dark:bg-violet-950/60 dark:text-violet-100'},
    {name:tr('Paused','Szünetel'),value:result.paused,Icon:PauseCircle,tone:'border-slate-200 bg-slate-50 text-slate-950 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'},
  ];
  const coverageBar=(value:{total:number;completed:number;inProgress:number;notStarted:number})=><div className="flex h-3 overflow-hidden rounded-full bg-muted" aria-label={value.completed+'/'+value.total+' '+tr('completed','befejezett')} role="img">{value.total>0&&<><span className="bg-emerald-600" style={{width:100*value.completed/value.total+'%'}}/><span className="bg-sky-500" style={{width:100*value.inProgress/value.total+'%'}}/><span className="bg-slate-400" style={{width:100*value.notStarted/value.total+'%'}}/></>}</div>;
  const resetDetail=()=>{setStatusFilter('');setEmployeeFilter('');};
  return <section className="space-y-4 w-full pb-8">
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="rounded-xl bg-sky-100 p-3 text-sky-800 dark:bg-sky-950 dark:text-sky-200"><GraduationCap className="h-6 w-6"/></span><div><h2 className="text-xl font-bold">{tr('Training & development','Képzés és fejlesztés')}</h2><p className="mt-1 text-sm text-muted-foreground">{tr('Core guide coverage by eligible active app account. This is learning progress, not an assignment or deadline report; unlinked staff are excluded.','Alapútmutatók teljesítése jogosult aktív fiókonként. Ez nem feladat- vagy határidőjelentés; a nem kapcsolt munkatársak nem szerepelnek.')}</p></div></div><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={()=>setRefresh(v=>v+1)}><RefreshCw className="mr-2 h-4 w-4"/>{tr('Refresh','Frissítés')}</Button><Button size="sm" variant="outline" disabled={!detailRecords.length} onClick={exportCsv}><Download className="mr-2 h-4 w-4"/>{tr('Export CSV','CSV export')}</Button></div></div>
      <div className="mt-4 flex flex-wrap gap-2"><Input className="min-w-48 flex-1" value={query} onChange={e=>{setQuery(e.target.value);resetDetail();}} placeholder={tr('Search employee','Munkatárs keresése')} aria-label={tr('Search employee','Munkatárs keresése')}/>
        <select className="rounded-md border bg-background px-3" value={hotel} onChange={e=>{setHotel(e.target.value);resetDetail();}} aria-label={tr('Property','Telephely')}><option value="">{tr('All properties','Minden telephely')}</option>{hotels.map(h=><option key={h} value={h}>{propertyName(h)}</option>)}</select>
        <select className="rounded-md border bg-background px-3" value={role} onChange={e=>{setRole(e.target.value);resetDetail();}} aria-label={tr('Role','Munkakör')}><option value="">{tr('All roles','Minden munkakör')}</option>{roles.map(r=><option key={r} value={r}>{roleName(r)}</option>)}</select></div>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={tr('Quick role filters','Gyors munkakörszűrők')}>{['',...roles].map(r=><button type="button" key={r} aria-pressed={role===r} className={'rounded-lg border px-2.5 py-1.5 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-ring '+roleColor(r)+(role===r?' ring-2 ring-current ring-offset-1 ring-offset-background':'')} onClick={()=>{setRole(r);resetDetail();}}>{r?roleName(r):tr('All roles','Minden munkakör')}</button>)}</div>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={tr('Quick property filters','Gyors telephelyszűrők')}>{['',...hotels].map(h=><button key={h} type="button" aria-pressed={hotel===h} onClick={()=>{propertyFilter(h);resetDetail();}} className={'rounded-lg border px-2.5 py-1.5 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-ring '+(h?propertyTone(hotelKey(h)??'').soft:roleTone(''))+(hotel===h?' ring-2 ring-current ring-offset-1 ring-offset-background':'')}>{h?propertyName(h):tr('All properties','Minden telephely')}</button>)}</div>
    </div>
    <div className="grid gap-3 grid-cols-2 md:grid-cols-3 2xl:grid-cols-7">{metricCards.map(({name,value,Icon,tone})=><Card key={name} className={'shadow-sm '+tone}><CardContent className="flex items-start justify-between gap-2 p-3"><div><p className="text-xs font-medium opacity-85">{name}</p><p className="mt-1 text-2xl font-bold tabular-nums">{value}</p></div><Icon className="h-5 w-5 shrink-0" aria-hidden="true"/></CardContent></Card>)}</div>
    <Card><CardContent className="space-y-3 p-4"><h2 className="font-semibold">{tr('Learning coverage','Képzési lefedettség')}</h2>{coverageBar(totals)}<div className="flex flex-wrap gap-2">{(['completed','in_progress','not_started'] as const).map(key=><button key={key} type="button" aria-pressed={statusFilter===key} className={'rounded-full px-3 py-1.5 text-xs font-semibold '+statusTone[key]+(statusFilter===key?' ring-2 ring-current':'')} onClick={()=>setStatusFilter(v=>v===key?'':key)}>{label(key)} · {key==='completed'?totals.completed:key==='in_progress'?totals.inProgress:totals.notStarted}</button>)}</div><p className="text-xs text-muted-foreground">{tr('Counts are eligible account–core guide pairs, not formal assignments.','Az értékek jogosult fiók–alapútmutató párokat jelentenek, nem kiosztott képzéseket.')}</p></CardContent></Card>
    <div className="grid gap-3 lg:grid-cols-2">
      <Card><CardContent className="space-y-3 p-4"><h2 className="flex items-center gap-2 font-semibold"><Users className="h-4 w-4 text-primary"/>{tr('Coverage by role','Lefedettség munkakör szerint')}</h2>{byRole.map(g=><button type="button" key={g.id} onClick={()=>{setRole(g.id);resetDetail();}} className="block w-full rounded-lg p-2 text-left hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"><div className="mb-1 flex items-center justify-between gap-2 text-sm"><span className={'rounded-md px-2 py-1 text-xs font-medium '+roleColor(g.id)}>{roleName(g.id)}</span><span className="font-semibold tabular-nums">{g.completed}/{g.total} · {g.rate}%</span></div>{coverageBar(g)}</button>)}</CardContent></Card>
      <Card><CardContent className="space-y-3 p-4"><h2 className="flex items-center gap-2 font-semibold"><Hotel className="h-4 w-4 text-primary"/>{tr('Coverage by property','Lefedettség telephely szerint')}</h2>{byProperty.map(g=><button type="button" key={g.id} onClick={()=>{propertyFilter(g.id);resetDetail();}} className="block w-full rounded-lg p-2 text-left hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"><div className="mb-1 flex items-center justify-between gap-2 text-sm"><span className={'rounded-md px-2 py-1 text-xs font-medium '+propertyTone(hotelKey(g.id)??'').soft}>{propertyName(g.id)}</span><span className="font-semibold tabular-nums">{g.completed}/{g.total} · {g.rate}%</span></div>{coverageBar(g)}</button>)}</CardContent></Card>
    </div>
    <Card><CardContent className="space-y-3 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{tr('Employee learning overview','Munkatársak képzési áttekintése')}</h2><Button size="sm" variant="outline" onClick={resetDetail}>{tr('Clear detail filters','Részletszűrők törlése')}</Button></div><div className="max-h-80 overflow-auto"><table className="w-full text-sm"><thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground"><tr><th className="p-2">{tr('Employee','Munkatárs')}</th><th className="p-2">{tr('Property','Telephely')}</th><th className="p-2">{tr('Completion','Teljesítés')}</th></tr></thead><tbody>{byEmployee.map(g=>{const p=result.people.find(e=>e.id===g.id);return <tr key={g.id} className="border-t odd:bg-muted/20"><td className="p-2"><button type="button" className={'text-left font-semibold hover:underline '+(employeeFilter===g.id?'text-primary':'')} onClick={()=>setEmployeeFilter(v=>v===g.id?'':g.id)}>{p?.full_name??'—'}</button><div className="text-xs text-muted-foreground">{roleName(p?trainingRoleFor(p)??'other':'other')}</div></td><td className="p-2">{propertyName(p?.assigned_hotel??null)}</td><td className="p-2"><div className="font-medium tabular-nums">{g.completed}/{g.total} · {g.rate}%</div>{coverageBar(g)}</td></tr>;})}</tbody></table></div><p className="text-xs text-muted-foreground">{tr('Select an employee to filter the guide evidence below.','Válasszon munkatársat az alábbi útmutatók szűréséhez.')}</p></CardContent></Card>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-lg font-semibold"><BookOpen className="h-5 w-5 text-primary"/>{tr('Completion by guide','Teljesítés útmutatónként')}</h2>{(statusFilter||employeeFilter)&&<Button size="sm" variant="secondary" onClick={resetDetail}>{tr('Clear detail filters','Részletszűrők törlése')}</Button>}</div>
    <div className="grid gap-3 xl:grid-cols-2">{result.byGuide.map(({guide,rows})=>{const visible=rows.filter(r=>(!statusFilter||r.status===statusFilter)&&(!employeeFilter||r.employee.id===employeeFilter));if(!visible.length)return null;const complete=rows.filter(r=>r.status==='completed').length;return <Card key={guide.slug} className="shadow-sm"><CardContent className="space-y-3 p-4"><div className="flex justify-between gap-2 text-sm font-medium"><span>{txt(guide.name,lang)}</span><span className="shrink-0 tabular-nums">{complete}/{rows.length}</span></div><Progress value={100*complete/rows.length}/><details open={!!employeeFilter}><summary className="cursor-pointer text-sm text-muted-foreground">{tr('Employees and recorded progress','Munkatársak és rögzített előrehaladás')} ({visible.length})</summary><ul className="mt-2 divide-y">{visible.map(r=><li key={r.employee.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span>{r.employee.full_name??'—'}</span><span className={'rounded-full px-2 py-1 text-xs font-medium '+statusTone[r.status]}>{label(r.status)}{r.status==='in_progress'&&r.step!==null?' · '+tr('Step','Lépés')+' '+(r.step+1):''}</span></li>)}</ul></details></CardContent></Card>;})}</div>
    {!detailRecords.length&&<p className="text-muted-foreground">{tr('No applicable core guides for this selection.','Nincs alkalmazható útmutató.')}</p>}
  </section>;
}
