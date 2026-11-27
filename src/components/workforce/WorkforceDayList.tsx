import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { entryKey } from '@/hooks/useWorkforce';
import { WORKING_KINDS } from '@/lib/workforce/cellParser';
import { calendarDay, calendarDayName } from '@/lib/workforce/holidays';
import { cellLabel, cellStyle, HOTEL_STYLE, hotelShort, intlLocale, type CellLabels, type WorkforceEntry, type WorkforceStaff } from '@/lib/workforce/model';
import { localName } from '@/lib/workforce/names';

export function WorkforceDayList({ day, days, setDay, staff, entries, deptName, roleName, cellLabels, onOpen, today, departmentColors }: {
  day: string; days: string[]; setDay: (d: string) => void; staff: WorkforceStaff[]; entries: Map<string, WorkforceEntry>;
  deptName: Map<string, string>; roleName: Map<string, string>; cellLabels: CellLabels; onOpen: (s: WorkforceStaff) => void;
  today: string; departmentColors: Map<string,string>;
}) {
  const { t, language } = useTranslation();
  const [filter,setFilter]=useState<'all'|'working'|'other'|'empty'>('all');
  const i = days.indexOf(day);
  const isWorking=(e:WorkforceEntry|undefined)=>!!e&&(WORKING_KINDS.has(e.kind)||e.kind==='half_leave');
  const category=(s:WorkforceStaff)=>{const e=entries.get(entryKey(s.id,day));return !e?'empty':isWorking(e)?'working':'other';};
  const working=staff.filter(s=>category(s)==='working').length;
  const empty=staff.filter(s=>category(s)==='empty').length;
  const other=staff.length-working-empty;
  const groups = new Map<string, WorkforceStaff[]>();
  for (const s of staff) { if(filter!=='all'&&category(s)!==filter)continue;const k=s.department_id??'none';groups.set(k,[...(groups.get(k)??[]),s]); }
  const special=calendarDay(day);
  const label=new Date(day+'T12:00:00Z').toLocaleDateString(intlLocale(language),{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'});
  const choices=[{key:'all' as const,label:t('wf.f.all'),count:staff.length,tone:'bg-muted text-foreground'},{key:'working' as const,label:t('wf.mobile.working'),count:working,tone:'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'},{key:'other' as const,label:t('wf.mobile.other'),count:other,tone:'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'},{key:'empty' as const,label:t('wf.f.empty'),count:empty,tone:'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200'}];
  return <div className="space-y-3">
    <div className="space-y-2 rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" disabled={i<=0} onClick={()=>setDay(days[i-1])} aria-label={t('wf.d.prev')}><ChevronLeft className="h-4 w-4"/></Button>
        <div className="min-w-0 flex-1 text-center"><div className="text-sm font-bold">{label}</div>{day===today&&<div className="text-xs font-medium text-primary">{t('wf.mobile.today')}</div>}{special&&<div className="text-xs text-muted-foreground">{calendarDayName(special,t,language)}</div>}</div>
        <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" disabled={i<0||i>=days.length-1} onClick={()=>setDay(days[i+1])} aria-label={t('wf.d.next')}><ChevronRight className="h-4 w-4"/></Button>
      </div>
      <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={t('wf.mobile.dailyFilter')}>{choices.map(c=><button type="button" key={c.key} aria-pressed={filter===c.key} onClick={()=>setFilter(c.key)} className={cn('min-w-0 rounded-lg px-1 py-2 text-center focus-visible:ring-2 focus-visible:ring-ring',c.tone,filter===c.key&&'ring-2 ring-current ring-offset-1 ring-offset-background')}><span className="block text-lg font-bold tabular-nums">{c.count}</span><span className="block break-words text-[10px] font-medium leading-tight">{c.label}</span></button>)}</div>
      <p className="text-[11px] text-muted-foreground">{t('wf.mobile.dailyOnly')}</p>
    </div>
    {[...groups].map(([k,list])=>{
      const color=departmentColors.get(k)??'#64748b';
      const count=list.filter(s=>isWorking(entries.get(entryKey(s.id,day)))).length;
      return <details key={k} open className="group/day overflow-hidden rounded-xl border bg-card shadow-sm">
        <summary className="flex cursor-pointer list-none items-center gap-2 border-b bg-muted/50 px-3 py-3 [&::-webkit-details-marker]:hidden" style={{borderLeft:'4px solid '+color}}>
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{backgroundColor:color}}/><span className="min-w-0 flex-1 text-sm font-bold">{deptName.has(k)?localName(deptName.get(k),t):t('wf.g.noDept')}</span><span className="shrink-0 rounded-full bg-background px-2 py-1 text-xs tabular-nums">{count}/{list.length}</span><ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open/day:rotate-90"/>
        </summary>
        <ul className="divide-y">{list.map(s=>{
          const e=entries.get(entryKey(s.id,day));const st=e?cellStyle(e,s.hotel_id):null;
          const hotel=e?e.hotel_id:s.hotel_id;const hotelStyle=hotel?HOTEL_STYLE[hotel]:null;
          return <li key={s.id} className="odd:bg-muted/15"><button type="button" onClick={()=>onOpen(s)} className="flex min-h-[58px] w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <span className="min-w-0 flex-1"><span className="block break-words font-semibold leading-snug">{s.nickname||s.full_name}</span><span className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground"><span>{localName(roleName.get(s.job_role_id??''),t)}</span><span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">{hotelStyle&&<span className="h-2 w-2 shrink-0 rounded-full" style={{backgroundColor:hotelStyle.bg}}/>}{hotel?hotelShort(hotel):t('wf.m.company')}</span></span></span>
            <span className="flex max-w-[42%] shrink-0 flex-col items-end gap-1 text-right">{e?<><span className="rounded-md px-2 py-1 text-xs font-semibold tabular-nums" style={{backgroundColor:st!.bg,color:st!.fg}}>{e.kind==='fixed_day_off'?t('wf.k.fixed_day_off'):cellLabel(e,cellLabels)}</span>{e.kind!=='fixed_day_off'&&<span className="text-[10px] leading-tight text-muted-foreground">{t('wf.k.'+e.kind)}</span>}{e.status==='draft'&&<span className="text-[10px] font-medium text-amber-700 dark:text-amber-300">{t('wf.mobile.draft')}</span>}</>:<span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{t('wf.f.empty')}</span>}</span><ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground"/>
          </button></li>;
        })}</ul>
      </details>;
    })}
    {!groups.size&&<p className="rounded-lg border p-4 text-center text-sm text-muted-foreground">{t('wf.m.noMatch')}</p>}
    <p className="text-center text-xs text-muted-foreground">{t('wf.mobile.details')}</p>
  </div>;
}
