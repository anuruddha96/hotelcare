import {useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '@/integrations/supabase/types';
import {supabase} from '@/integrations/supabase/client';
import {useAuth} from '@/hooks/useAuth';
import {useTranslation} from '@/hooks/useTranslation';
import {useWorkforce,entryKey,fetchAllRows} from '@/hooks/useWorkforce';
import {todayBudapest} from '@/lib/budapestTime';
import {budapestInput,budapestUtc,dayComparison,publishedShift,csvCell,attendanceMapUrl,personDaySummary,attendanceShiftHours,attendanceRole,newestAttendance,attendanceStatus,attendanceDayRange} from '@/lib/hr-attendance';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card';
import {useToast} from '@/hooks/use-toast';
import {hotelName,hotelKey} from '@/lib/workforce/model';
import {employeeReport,normMinutes} from '@/lib/workforce/report';
type Person={id:string;full_name:string|null;role:string|null;access_role:string|null;assigned_hotel:string|null};
type AttendanceMetadata={id:string;work_hotel_id:string|null;status:string|null};
type Row={work_hotel_id?:string|null;role?:string;id:string;user_id:string;full_name:string;work_date:string;check_in_time:string;check_out_time:string|null;break_duration:number|null;total_hours?:number|null;planned_end?:string|null;status?:string;notes?:string|null;check_in_location?:unknown};
// Extend the generated schema locally until the phase-2 migration is applied.
type PublicSchema=Database['public'];
type Times={_check_in:string;_check_out:string|null;_break_minutes:number;_reason:string};
type HrDatabase=Omit<Database,'public'> & {public:Omit<PublicSchema,'Functions'|'Tables'> & {
 Functions:PublicSchema['Functions'] & {
  hr_attendance_open_records:{Args:never;Returns:Row[]};
  attendance_correct:{Args:Times & {_id:string;_status:string};Returns:undefined};
  attendance_delete:{Args:{_id:string;_reason:string};Returns:undefined};
  attendance_manual_add:{Args:Times & {_employee:string;_date:string;_note:string};Returns:string};
 };
 Tables:PublicSchema['Tables'] & {
  workforce_settings:PublicSchema['Tables']['workforce_settings'] & {
   Row:{punctuality_tolerance_minutes:number};
   Insert:{punctuality_tolerance_minutes?:number};
   Update:{punctuality_tolerance_minutes?:number};
  };
 };
}};
const db=supabase as unknown as SupabaseClient<HrDatabase>;
type Edit={row?:Row;employee:string;date:string;start:string;end:string;breakMinutes:string;reason:string;note:string};
export function HrAttendance(){
 const {profile}=useAuth();const {t}=useTranslation();const {toast}=useToast();
 const today=todayBudapest();
 const [month,setMonth]=useState(today.slice(0,7));
 const [view,setView]=useState<'daily'|'monthly'|'history'|'corrections'>('daily');
 const [role,setRole]=useState('');const [search,setSearch]=useState('');const [visibleDays,setVisibleDays]=useState(7);
 const [peopleById,setPeopleById]=useState<Record<string,Person>>({});
 const label=(key:string)=>t('hr.daily.'+key);
 const [employee,setEmployee]=useState('');const [rows,setRows]=useState<Row[]>([]);const [open,setOpen]=useState<Row[]>([]);const [tolerance,setTolerance]=useState(5);
 const [edit,setEdit]=useState<Edit|null>(null);const [busy,setBusy]=useState(false);const [failed,setFailed]=useState(false);const [loading,setLoading]=useState(true);const [refresh,setRefresh]=useState(0);
 const [problems,setProblems]=useState(false);const [hotel,setHotel]=useState('');const [department,setDepartment]=useState('');const [from,setFrom]=useState('');const [to,setTo]=useState('');const [employees,setEmployees]=useState<{id:string;full_name:string}[]>([]);
 const [year,m]=month.split('-').map(Number);const monthStart=month+'-01';const monthEnd=new Date(Date.UTC(year,m,0)).toISOString().slice(0,10);
 const rangeStart=from||monthStart;const rangeEnd=to||monthEnd;
 const workforce=useWorkforce(year,m,{from:rangeStart,to:rangeEnd});
 useEffect(()=>{
 let cancelled=false;setLoading(true);setFailed(false);setRows([]);setOpen([]);setPeopleById({});
 const args={target_user_id:null,start_date:rangeStart,end_date:rangeEnd};
 const load=async()=>{try{
 const [records,forgotten,people,settings,profiles,metadata]=await Promise.all([
 fetchAllRows<Row>((a,b)=>db.rpc('get_attendance_records_hotel_filtered',args).order('work_date').order('id').range(a,b)),
 fetchAllRows<Row>((a,b)=>db.rpc('hr_attendance_open_records').order('work_date').order('id').range(a,b)),
 db.rpc('get_employees_by_hotel'),
 db.from('workforce_settings').select('punctuality_tolerance_minutes').eq('organization_slug',profile?.organization_slug).maybeSingle(),
 fetchAllRows<Person>((a,b)=>db.from('profiles').select('id,full_name,role,access_role,assigned_hotel').eq('organization_slug',profile?.organization_slug??'').is('deleted_at',null).order('id').range(a,b) as unknown as PromiseLike<{data:Person[]|null;error:unknown}>),
 (async()=>{try{return await fetchAllRows<AttendanceMetadata>((a,b)=>db.from('staff_attendance').select('id,work_hotel_id,status').eq('organization_slug',profile?.organization_slug??'').or('and(work_date.gte.'+args.start_date+',work_date.lte.'+args.end_date+'),and(check_out_time.is.null,work_date.lt.'+todayBudapest()+')').order('id').range(a,b) as unknown as PromiseLike<{data:AttendanceMetadata[]|null;error:unknown}>);}catch(err){const e=err as {code?:string;message?:string};if((e.code==='42703'||e.code==='PGRST204')&&e.message?.includes('work_hotel_id'))return [];throw err;}})()
 ]);
 if(people.error||settings.error)throw new Error('Attendance request failed');
 if(cancelled)return;
 const metadataById=new Map(metadata.map(x=>[x.id,x]));
 const withMetadata=(row:Row):Row=>{const meta=metadataById.get(row.id);return meta?{...row,work_hotel_id:meta.work_hotel_id,status:meta.status??row.status}:row;};
 setRows(records.map(withMetadata));setOpen(forgotten.map(withMetadata));setPeopleById(Object.fromEntries(profiles.map(p=>[p.id,p])));setEmployees(people.data??[]);setTolerance(settings.data?.punctuality_tolerance_minutes??5);
 }catch{if(!cancelled){setFailed(true);setRows([]);setOpen([]);}}finally{if(!cancelled)setLoading(false);}};
 if(profile?.organization_slug)void load();else setLoading(false);
 return()=>{cancelled=true;};
 },[rangeStart,rangeEnd,refresh,profile?.id,profile?.organization_slug]);
 const begin=(row?:Row,planned=false)=>setEdit(row?{row,employee:row.user_id,date:row.work_date,start:budapestInput(row.check_in_time),end:budapestInput(planned?row.planned_end??null:row.check_out_time),breakMinutes:String(row.break_duration??0),reason:'',note:row.notes??''}:{employee:employee||'',date:todayBudapest(),start:'',end:'',breakMinutes:'0',reason:'',note:''});
 const save=async()=>{if(!edit||!edit.reason.trim()||busy)return;setBusy(true);try{
 const times={_check_in:budapestUtc(edit.start),_check_out:edit.end?budapestUtc(edit.end):null,_break_minutes:Number(edit.breakMinutes),_reason:edit.reason.trim()};
 const result=edit.row?await db.rpc('attendance_correct',{_id:edit.row.id,...times,_status:edit.end?'checked_out':edit.row.status==='on_break'?'on_break':'checked_in'}):await db.rpc('attendance_manual_add',{_employee:edit.employee,_date:edit.date,...times,_note:edit.note});
 if(result.error)throw result.error;setEdit(null);setRefresh(x=>x+1);toast({title:t('hr.a.saved')});
 }catch{toast({title:t('hr.a.failed'),variant:'destructive'});}finally{setBusy(false);}};
 const remove=async()=>{if(!edit?.row||!edit.reason.trim()||busy||!window.confirm(t('hr.a.confirmDelete')))return;setBusy(true);try{const result=await db.rpc('attendance_delete',{_id:edit.row.id,_reason:edit.reason.trim()});if(result.error)throw result.error;setEdit(null);setRefresh(x=>x+1);toast({title:t('hr.a.saved')});}catch{toast({title:t('hr.a.failed'),variant:'destructive'});}finally{setBusy(false);}};
 const staffByLogin=new Map(workforce.staff.filter(s=>s.profile_id).map(s=>[s.profile_id!,s]));
 const schedule=(r:Row)=>{const s=staffByLogin.get(r.user_id);const e=s&&workforce.entries.get(entryKey(s.id,r.work_date));return e?publishedShift(e):null;};
 const roleFor=(r:Pick<Row,'user_id'|'role'>)=>{const p=peopleById[r.user_id];const staff=staffByLogin.get(r.user_id);return attendanceRole(p?.role??r.role,p?.access_role,workforce.jobRoles.find(j=>j.id===staff?.job_role_id)?.name);};
 const propertyFor=(r:Row)=>hotelKey(r.work_hotel_id??schedule(r)?.hotel_id??staffByLogin.get(r.user_id)?.hotel_id??peopleById[r.user_id]?.assigned_hotel)??'__unassigned';
 const propertyLabel=(key:string)=>key&&key!=='__unassigned'?hotelName(key):label('unassigned');
 const matchesPerson=(r:Row)=>{const staff=staffByLogin.get(r.user_id);return (!employee||r.user_id===employee)&&(!role||roleFor(r)===role)&&(!department||staff?.department_id===department)&&(!search||r.full_name.toLowerCase().includes(search.trim().toLowerCase()));};
 const inScope=(r:Row)=>matchesPerson(r)&&(!hotel||propertyFor(r)===hotel)&&(!from||r.work_date>=from)&&(!to||r.work_date<=to);
 const scopedRows=newestAttendance(rows.filter(inScope));
 const correctionRows=newestAttendance(open.filter(inScope));
 const roles=['housekeeping','maintenance','reception','front_office_manager','housekeeping_manager','housekeeping_supervisor','breakfast','manager','top_management','hr','controlling','admin','other'];
 const propertyOptions=[...new Set([...workforce.staff.map(s=>hotelKey(s.hotel_id)),...Object.values(peopleById).map(p=>hotelKey(p.assigned_hotel)),...rows.map(propertyFor)].filter((h):h is string=>!!h))].sort((a,b)=>propertyLabel(a).localeCompare(propertyLabel(b)));
 const selectMonth=(value:string)=>{if(value){setMonth(value);setFrom('');setTo('');setVisibleDays(7);}};
 const selectDay=(date:string)=>{setMonth(date.slice(0,7));setFrom(date);setTo(date);setVisibleDays(7);setView('daily');};
 const selectView=(next:typeof view)=>{setView(next);setFrom('');setTo('');setVisibleDays(7);};
 const yesterday=attendanceDayRange(today,2);
 const selectWeek=()=>{setMonth(today.slice(0,7));setFrom(attendanceDayRange(today,7));setTo(today);setView('daily');setVisibleDays(7);};

 const groups=new Map<string,Row[]>();for(const row of scopedRows){const k=row.user_id+'|'+row.work_date;const group=groups.get(k)??[];group.push(row);groups.set(k,group);}
 const comparison=(r:Row)=>dayComparison(r.work_date,schedule(r),groups.get(r.user_id+'|'+r.work_date)??[],todayBudapest(),tolerance);
 const filtered=scopedRows.filter(r=>{const f=comparison(r);return !problems||(f.open&&r.work_date<today)||f.late||f.early||f.dayOff;});
 const comparisons=[...groups.values()].map(g=>comparison(g[0]));
 const summary=personDaySummary(filtered.map(r=>({...r,total_hours:r.total_hours??null})));
 const missing=workforce.staff.flatMap(s=>s.profile_id?[...workforce.entries.values()].filter(e=>e.staff_id===s.id).flatMap(e=>{
 const r:Row={id:'missing-'+s.id+'-'+e.work_date,user_id:s.profile_id!,full_name:s.full_name,work_date:e.work_date,check_in_time:'',check_out_time:null,break_duration:0};
 return inScope(r)&&!groups.has(r.user_id+'|'+r.work_date)&&comparison(r).missing?[r]:[];
 }):[]).filter(r=>r.user_id!==profile?.id);
 const detailHeaders=[t('hr.employee'),label('role'),t('hr.a.hotel'),label('propertySource'),label('status'),t('hr.date'),t('hr.checkIn'),t('hr.checkOut'),t('hr.a.break'),t('hr.hours'),t('hr.a.planned')+' '+t('hr.checkIn'),t('hr.a.planned')+' '+t('hr.checkOut')];
 const detailRows=(view==='corrections'?correctionRows:filtered).map(r=>[r.full_name,label(roleFor(r)),propertyLabel(propertyFor(r)),label(r.work_hotel_id?'captured':'inferred'),label(attendanceStatus(r,today)),r.work_date,budapestInput(r.check_in_time),budapestInput(r.check_out_time),r.break_duration??0,r.total_hours??'',schedule(r)?.start_time??'',schedule(r)?.end_time??'']);
 const totalHeaders=[t('hr.employee'),t('hr.a.completedDays'),t('hr.hours'),t('hr.a.norm'),t('hr.a.overtime'),t('hr.a.nightHours'),t('hr.a.weekendHours'),t('hr.a.holidayHours'),t('hr.a.leaveDays'),t('hr.a.sickDays')];
 const scopedStaff=workforce.staff.filter(s=>s.profile_id&&(!employee||s.profile_id===employee)&&(!department||s.department_id===department)&&(!role||roleFor({user_id:s.profile_id})===role)&&(!search||s.full_name.toLowerCase().includes(search.trim().toLowerCase())));
 const fullPeriod=!hotel&&!from&&!to&&!problems;
 const publishedEntries=[...workforce.entries.values()].flatMap(e=>{
   const shift=publishedShift(e);return shift&&(!from||e.work_date>=from)&&(!to||e.work_date<=to)&&(!hotel||hotelKey(shift.hotel_id??workforce.staff.find(s=>s.id===e.staff_id)?.hotel_id)===hotel)?[{...e,...shift,status:'published',worked_minutes:shift.worked_minutes??0}]:[];
 });
 const scheduledReports=new Map(employeeReport(publishedEntries,scopedStaff,[...new Set([rangeStart.slice(0,7),rangeEnd.slice(0,7)])]).map(r=>[r.staffId,r]));
 const relevantIds=new Set([...filtered.map(r=>r.user_id),...scopedStaff.filter(s=>scheduledReports.has(s.id)).map(s=>s.profile_id!)]);
 const totals=[...relevantIds].map(id=>{const mine=filtered.filter(r=>r.user_id===id);const s=staffByLogin.get(id);const report=s?scheduledReports.get(s.id):null;
 const actual=attendanceShiftHours(mine,r=>schedule(r as Row));const norm=s&&fullPeriod?normMinutes(s,[month]):null;
 const leave=report?.leaveDays??0,sick=report?.sickDays??0;
 const overtime=norm!=null&&s?Math.max(0,actual.hours+(leave+sick)*s.daily_hours-norm/60):null;
 return[s?.full_name??mine[0]?.full_name??employees.find(e=>e.id===id)?.full_name??'',actual.days,actual.hours,norm==null?'':norm/60,overtime??'',actual.night,actual.weekend,actual.holiday,leave,sick];});
  const propertyTotals=[...new Set(filtered.map(propertyFor))].map(h=>{const group=filtered.filter(r=>propertyFor(r)===h);return [propertyLabel(h),new Set(group.map(r=>r.user_id)).size,personDaySummary(group.map(r=>({...r,total_hours:r.total_hours??null}))).hours,group.reduce((sum,r)=>sum+(r.break_duration??0),0),group.filter(r=>r.status==='auto_signout').length];});
 const propertyHeaders=[t('hr.a.hotel'),label('allStaff'),t('hr.hours'),t('hr.a.break'),label('auto')];
 const exportExcel=async()=>{const XLSX=await import('xlsx');const wb=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([detailHeaders,...detailRows]),t('hr.nav.attendance').slice(0,31));
 if(view!=='corrections'){XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([totalHeaders,...totals]),'Totals');XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([propertyHeaders,...propertyTotals]),'Properties');}XLSX.writeFile(wb,'attendance-'+month+'.xlsx');};
 const exportCsv=()=>{const body=[detailHeaders,...detailRows,...(view==='corrections'?[]:[[],totalHeaders,...totals,[],propertyHeaders,...propertyTotals])].map(row=>row.map(csvCell).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob(['\ufeff'+body],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='attendance-'+month+'.csv';a.click();URL.revokeObjectURL(url);};
 const statusClass:Record<string,string>={working:'text-emerald-500',out:'text-sky-500',break:'text-amber-500',auto:'text-violet-500',forgotten:'text-amber-500',missing:'text-red-500'};
 const renderRow=(r:Row,isOpen=false)=>{const shift=schedule(r);const flags=isOpen?dayComparison(r.work_date,shift,[r],today,tolerance):comparison(r);const map=attendanceMapUrl(r.check_in_location);const canEdit=r.user_id!==profile?.id;const status=attendanceStatus(r,today);return <div key={r.id} className="border-b last:border-b-0">
 <div className="grid grid-cols-2 gap-2 p-3 md:grid-cols-[minmax(160px,1.5fr)_repeat(4,minmax(65px,0.65fr))_minmax(120px,1fr)_auto] md:items-center">
 <div><div className="font-medium">{r.full_name}</div><div className="text-xs text-muted-foreground">{label(roleFor(r))}{isOpen?' · '+r.work_date:''}</div></div>
 <div><span className="md:hidden text-xs text-muted-foreground">{t('hr.checkIn')}: </span>{budapestInput(r.check_in_time).slice(11)}</div>
 <div><span className="md:hidden text-xs text-muted-foreground">{t('hr.checkOut')}: </span>{r.check_out_time?budapestInput(r.check_out_time).slice(11):'—'}</div>
 <div><span className="md:hidden text-xs text-muted-foreground">{t('hr.a.break')}: </span>{r.break_duration??0}m</div>
 <div><span className="md:hidden text-xs text-muted-foreground">{t('hr.hours')}: </span>{r.total_hours==null?'—':Number(r.total_hours).toFixed(2)+'h'}</div>
 <div className={'text-sm font-medium '+statusClass[status]}>{label(status)}</div>
 <div className="flex flex-wrap gap-2">{canEdit&&<Button variant="outline" size="sm" onClick={()=>begin(r)}>{t('hr.a.edit')}</Button>}{canEdit&&isOpen&&r.planned_end&&<Button variant="outline" size="sm" onClick={()=>begin(r,true)}>{t('hr.a.closePlan')}</Button>}</div>
 </div><details className="px-3 pb-2 text-xs text-muted-foreground"><summary className="cursor-pointer">{label('details')}</summary><div className="pt-2">{label(r.work_hotel_id?'captured':'inferred')} · {shift?.start_time?shift.start_time.slice(0,5)+' – '+shift.end_time?.slice(0,5):t('hr.a.noSchedule')} · {map?<a href={map} target="_blank" rel="noopener noreferrer" className="underline">{t('hr.a.unverified')}</a>:t('hr.a.unverified')}{flags.delta!=null&&' · '+(flags.delta/60).toFixed(2)+'h'}<span className="text-destructive"> {[flags.late&&t('hr.a.late'),flags.early&&t('hr.a.early'),flags.dayOff&&t('hr.a.dayOff')].filter(Boolean).join(' · ')}</span></div></details></div>;};
 const visible=filtered;
 const dates=[...new Set([...visible.map(r=>r.work_date),...missing.map(r=>r.work_date),...(month===today.slice(0,7)&&(!from||from<=today)&&(!to||to>=today)?[today]:[])])].sort((a,b)=>b.localeCompare(a));
 const focusedDate=dates[0]??(to||from||today);
 const todayRows=filtered.filter(r=>r.work_date===focusedDate);
 const latestByPerson=new Map<string,Row>();for(const r of todayRows)if(!latestByPerson.has(r.user_id))latestByPerson.set(r.user_id,r);
 const latest=[...latestByPerson.values()];
 const kpis=view==='daily'&&focusedDate===today?[[label('checkedIn'),latest.length],[label('working'),latest.filter(r=>!r.check_out_time).length],[label('out'),latest.filter(r=>!!r.check_out_time).length],[label('corrections'),correctionRows.length]]:[[t('hr.a.personDays'),summary.days],[t('hr.totalHours'),Number(summary.hours).toFixed(1)+'h'],[t('hr.avgHoursPerDay'),Number(summary.average).toFixed(1)+'h'],[t('hr.a.onTime').replace('{n}',String(comparisons.filter(c=>c.onTime).length)).replace('{m}',String(comparisons.filter(c=>c.scheduled).length)),t('hr.a.noSchedule')+': '+comparisons.filter(c=>!c.scheduled).length]];
 const header=<div className="hidden gap-2 px-3 py-2 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[minmax(160px,1.5fr)_repeat(4,minmax(65px,0.65fr))_minmax(120px,1fr)_auto]"><span>{t('hr.employee')}</span><span>{t('hr.checkIn')}</span><span>{t('hr.checkOut')}</span><span>{t('hr.a.break')}</span><span>{t('hr.hours')}</span><span>{label('status')}</span><span /></div>;
 return <section className="space-y-4">
 <div className="flex flex-wrap gap-2">{(['daily','monthly','history','corrections'] as const).map(v=><Button key={v} size="sm" variant={view===v?'default':'outline'} onClick={()=>selectView(v)}>{label(v)}{v==='corrections'&&open.length>0?' ('+open.length+')':''}</Button>)}</div>
 <div className="flex flex-wrap items-end gap-2"><Button variant="outline" size="sm" onClick={()=>selectDay(today)}>{label('today')}</Button><Button variant="outline" size="sm" onClick={()=>selectDay(yesterday)}>{label('yesterday')}</Button><Button variant="outline" size="sm" onClick={selectWeek}>{label('seven')}</Button><label className="text-sm">{t('hr.a.month')}<Input type="month" value={month} onChange={e=>selectMonth(e.target.value)}/></label>
 <label className="text-sm">{t('hr.a.from')}<Input type="date" min={rangeStart<monthStart?rangeStart:monthStart} max={to||monthEnd} value={from} onChange={e=>{setFrom(e.target.value);setVisibleDays(7);}}/></label><label className="text-sm">{t('hr.a.to')}<Input type="date" min={from||monthStart} max={monthEnd} value={to} onChange={e=>{setTo(e.target.value);setVisibleDays(7);}}/></label>
 <Button variant="outline" size="sm" onClick={()=>setRefresh(x=>x+1)}>{label('refresh')}</Button><Button onClick={()=>begin()}>{t('hr.a.manual')}</Button><Button variant="outline" disabled={loading||failed||workforce.loading||!!workforce.error} onClick={()=>void exportExcel()}>{t('hr.a.export')}</Button><Button variant="outline" disabled={loading||failed||workforce.loading||!!workforce.error} onClick={exportCsv}>{t('hr.exportCsv')}</Button></div>
 <div className="flex flex-wrap gap-2" aria-label={label('role')}>{['',...roles].map(v=><Button key={v} size="sm" variant={role===v?'default':'outline'} aria-pressed={role===v} onClick={()=>{setRole(v);setVisibleDays(7);}}>{label(v||'allStaff')}</Button>)}</div>
 <div className="flex flex-wrap items-end gap-3"><label className="text-sm">{label('search')}<Input value={search} onChange={e=>setSearch(e.target.value)}/></label><label className="text-sm">{t('hr.employee')}<select className="block rounded-md border bg-background p-2" value={employee} onChange={e=>setEmployee(e.target.value)}><option value="">{t('periods.allEmployees')}</option>{employees.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select></label><label className="text-sm">{t('hr.a.hotel')}<select className="block rounded border bg-background p-2" value={hotel} onChange={e=>setHotel(e.target.value)}><option value="">{t('hr.a.all')}</option>{propertyOptions.map(h=><option key={h} value={h}>{propertyLabel(h)}</option>)}</select></label><label className="text-sm">{t('hr.a.department')}<select className="block rounded border bg-background p-2" value={department} onChange={e=>setDepartment(e.target.value)}><option value="">{t('hr.a.all')}</option>{workforce.departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label className="flex gap-2 text-sm"><input type="checkbox" checked={problems} onChange={e=>setProblems(e.target.checked)}/>{t('hr.a.problems')}</label></div>
 <p className="text-xs text-muted-foreground">{t('hr.a.timezone')} · {label('propertySource')}: {label('captured')} / {label('inferred')}</p>
 {(failed||workforce.error)?<p role="alert">{t('hr.a.failed')}</p>:(loading||workforce.loading)?<p>{t('common.loading')}</p>:<>
 {view!=='corrections'&&<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{kpis.map(([name,value])=><Card key={name}><CardContent className="p-4"><div className="text-sm text-muted-foreground">{name}</div><div className="text-xl font-semibold">{value}</div></CardContent></Card>)}</div>}
 {view==='corrections'?<Card><CardHeader><CardTitle>{t('hr.a.fix')} ({correctionRows.length})</CardTitle></CardHeader><CardContent>{header}{correctionRows.map(r=>renderRow(r,true))}{!correctionRows.length&&<p>{t('hr.empty')}</p>}</CardContent></Card>:<>
 {view==='monthly'&&<Card><CardHeader><CardTitle>{label('monthly')}</CardTitle></CardHeader><CardContent className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{totalHeaders.map(h=><th key={h} className="p-2 text-left">{h}</th>)}</tr></thead><tbody>{totals.map((line,i)=><tr key={i} className="border-t">{line.map((value,j)=><td key={j} className="p-2">{value}</td>)}</tr>)}</tbody></table></CardContent></Card>}
 {view==='history'&&!employee?<p className="text-sm text-muted-foreground">{t('hr.training.employee')}</p>:dates.slice(0,visibleDays).map((date,index)=>{const day=visible.filter(r=>r.work_date===date);const absent=missing.filter(r=>r.work_date===date);const properties=[...new Set([...day,...absent].map(propertyFor))].sort((a,b)=>propertyLabel(a).localeCompare(propertyLabel(b)));return <Card key={date}><CardContent className="p-3"><details open={index===0}><summary className="cursor-pointer font-semibold p-2">{date===today?label('today')+' · ':date===yesterday?label('yesterday')+' · ':''}{date} · {new Set(day.map(r=>r.user_id)).size} {label('checkedIn')}</summary>{properties.map(h=>{const group=day.filter(r=>propertyFor(r)===h);const people=[...new Set(group.map(r=>r.user_id))];return <details key={h} open className="mt-2 rounded border"><summary className="cursor-pointer p-3 font-medium">{propertyLabel(h)} · {people.length} {label('checkedIn')}</summary>{header}{people.map(id=>{const sessions=group.filter(r=>r.user_id===id);return sessions.length===1?renderRow(sessions[0]):<details key={id} className="border-b"><summary className="p-3 cursor-pointer">{sessions[0].full_name} · {sessions.length} · {sessions.reduce((sum,r)=>sum+Number(r.total_hours??0),0).toFixed(2)}h</summary>{sessions.map(r=>renderRow(r))}</details>;})}{absent.filter(r=>propertyFor(r)===h).map(r=><div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b p-3"><span>{r.full_name} · {t('hr.a.missing')}</span><Button size="sm" variant="outline" onClick={()=>setEdit({employee:r.user_id,date:r.work_date,start:'',end:'',breakMinutes:'0',reason:'',note:''})}>{t('hr.a.manual')}</Button></div>)}</details>;})}{!properties.length&&<p className="p-3 text-muted-foreground">{t('hr.empty')}</p>}</details></CardContent></Card>;})}
 {dates.length>visibleDays&&<Button variant="outline" onClick={()=>setVisibleDays(n=>n+7)}>{label('loadEarlier')}</Button>}
 {!dates.length&&<p>{t('hr.empty')}</p>}
 </>}
 </>}
 <Dialog open={!!edit} onOpenChange={v=>{if(!v&&!busy)setEdit(null);}}><DialogContent><DialogHeader><DialogTitle>{edit?.row?t('hr.a.edit'):t('hr.a.manual')}</DialogTitle></DialogHeader>{edit&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();void save();}}>
 {!edit.row&&<><label className="block text-sm">{t('hr.employee')}<select required className="block w-full rounded border bg-background p-2" value={edit.employee} onChange={e=>setEdit({...edit,employee:e.target.value})}><option value="">{t('hr.training.employee')}</option>{employees.filter(e=>e.id!==profile?.id).map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select></label><label className="block text-sm">{t('hr.date')}<Input required type="date" max={todayBudapest()} value={edit.date} onChange={e=>setEdit({...edit,date:e.target.value})}/></label></>}
 <label className="block text-sm">{t('hr.checkIn')}<Input required type="datetime-local" value={edit.start} onChange={e=>setEdit({...edit,start:e.target.value})}/></label><label className="block text-sm">{t('hr.checkOut')}<Input required={!edit.row} type="datetime-local" value={edit.end} onChange={e=>setEdit({...edit,end:e.target.value})}/></label><label className="block text-sm">{t('hr.a.break')}<Input required type="number" min={0} max={2160} step={1} value={edit.breakMinutes} onChange={e=>setEdit({...edit,breakMinutes:e.target.value})}/></label>{!edit.row&&<label className="block text-sm">{t('hr.a.note')}<Input value={edit.note} onChange={e=>setEdit({...edit,note:e.target.value})}/></label>}<label className="block text-sm">{t('hr.a.reason')}<Input required maxLength={2000} value={edit.reason} onChange={e=>setEdit({...edit,reason:e.target.value})}/></label><div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy||!edit.reason.trim()}>{t('hr.a.save')}</Button>{edit.row&&<Button type="button" variant="destructive" disabled={busy||!edit.reason.trim()} onClick={()=>void remove()}>{t('hr.a.delete')}</Button>}<Button type="button" variant="outline" disabled={busy} onClick={()=>setEdit(null)}>{t('hr.a.cancel')}</Button></div></form>}</DialogContent></Dialog>
 </section>;
}
