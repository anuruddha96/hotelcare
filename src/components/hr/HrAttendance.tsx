import {useEffect,useState} from 'react';
import {CalendarDays,Check,ChevronDown,Clock,Download,Hotel,LogIn,LogOut,AlertCircle,Search,RefreshCw,Users,History,FileSpreadsheet,Plus} from 'lucide-react';
import {roleTone,propertyTone,statusTone,attendanceGrid,metricTones} from './attendance-appearance';
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
  rd_hr_active_overnight_ids:{Args:never;Returns:{id:string}[]};
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
 const [overnightIds,setOvernightIds]=useState<Set<string>>(new Set());
 const label=(key:string)=>t('hr.daily.'+key);
 const [employee,setEmployee]=useState('');const [rows,setRows]=useState<Row[]>([]);const [open,setOpen]=useState<Row[]>([]);const [tolerance,setTolerance]=useState(5);
 const [edit,setEdit]=useState<Edit|null>(null);const [busy,setBusy]=useState(false);const [failed,setFailed]=useState(false);const [loading,setLoading]=useState(true);const [refresh,setRefresh]=useState(0);
 const [problems,setProblems]=useState(false);const [hotel,setHotel]=useState('');const [department,setDepartment]=useState('');const [from,setFrom]=useState('');const [to,setTo]=useState('');const [employees,setEmployees]=useState<{id:string;full_name:string}[]>([]);
 const [year,m]=month.split('-').map(Number);const monthStart=month+'-01';const monthEnd=new Date(Date.UTC(year,m,0)).toISOString().slice(0,10);
 const rangeStart=from||monthStart;const rangeEnd=to||monthEnd;
 const workforce=useWorkforce(year,m,{from:rangeStart,to:rangeEnd});
 useEffect(()=>{
 let cancelled=false;setLoading(true);setFailed(false);setRows([]);setOpen([]);setPeopleById({});setOvernightIds(new Set());
 const args={target_user_id:null,start_date:rangeStart,end_date:rangeEnd};
 const load=async()=>{try{
 const [records,forgotten,people,settings,profiles,metadata,overnight]=await Promise.all([
 fetchAllRows<Row>((a,b)=>db.rpc('get_attendance_records_hotel_filtered',args).order('work_date').order('id').range(a,b)),
 fetchAllRows<Row>((a,b)=>db.rpc('hr_attendance_open_records').order('work_date').order('id').range(a,b)),
 db.rpc('get_employees_by_hotel'),
 db.from('workforce_settings').select('punctuality_tolerance_minutes').eq('organization_slug',profile?.organization_slug).maybeSingle(),
 fetchAllRows<Person>((a,b)=>db.from('profiles').select('id,full_name,role,access_role,assigned_hotel').eq('organization_slug',profile?.organization_slug??'').is('deleted_at',null).order('id').range(a,b) as unknown as PromiseLike<{data:Person[]|null;error:unknown}>),
 (async()=>{try{return await fetchAllRows<AttendanceMetadata>((a,b)=>db.from('staff_attendance').select('id,work_hotel_id,status').eq('organization_slug',profile?.organization_slug??'').or('and(work_date.gte.'+args.start_date+',work_date.lte.'+args.end_date+'),and(check_out_time.is.null,work_date.lt.'+todayBudapest()+')').order('id').range(a,b) as unknown as PromiseLike<{data:AttendanceMetadata[]|null;error:unknown}>);}catch(err){const e=err as {code?:string;message?:string};if((e.code==='42703'||e.code==='PGRST204')&&e.message?.includes('work_hotel_id'))return [];throw err;}})(),
 profile?.organization_slug==='rdhotels'?db.rpc('rd_hr_active_overnight_ids') : Promise.resolve({data:[],error:null})
 ]);
 if(people.error||settings.error)throw new Error('Attendance request failed');
 if(overnight.error && !['PGRST202','42883'].includes(overnight.error.code))throw overnight.error;
 if(cancelled)return;
 const metadataById=new Map(metadata.map(x=>[x.id,x]));
 const withMetadata=(row:Row):Row=>{const meta=metadataById.get(row.id);return meta?{...row,work_hotel_id:meta.work_hotel_id,status:meta.status??row.status}:row;};
 setOvernightIds(new Set((overnight.data??[]).map(x=>x.id)));
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
 const correctionRows=newestAttendance(open.filter(r=>!overnightIds.has(r.id)&&inScope(r)));
 const overnightRows=newestAttendance(open.filter(r=>overnightIds.has(r.id)&&matchesPerson(r)&&(!hotel||propertyFor(r)===hotel)));
 const statusFor=(r:Row)=>attendanceStatus(r,overnightIds.has(r.id)?r.work_date:today);
 const roles=['housekeeping','maintenance','reception','front_office_manager','housekeeping_manager','housekeeping_supervisor','breakfast','manager','top_management','hr','controlling','admin','other'];
 const propertyOptions=[...new Set([...workforce.staff.map(s=>hotelKey(s.hotel_id)),...Object.values(peopleById).map(p=>hotelKey(p.assigned_hotel)),...rows.map(propertyFor),...open.map(propertyFor)].filter((h):h is string=>!!h))].sort((a,b)=>propertyLabel(a).localeCompare(propertyLabel(b)));
 const selectMonth=(value:string)=>{if(value){setMonth(value);setFrom('');setTo('');setVisibleDays(7);}};
 const selectDay=(date:string)=>{setMonth(date.slice(0,7));setFrom(date);setTo(date);setVisibleDays(7);setView('daily');};
 const selectView=(next:typeof view)=>{setView(next);setFrom('');setTo('');setVisibleDays(7);};
 const yesterday=attendanceDayRange(today,2);
 const selectWeek=()=>{setMonth(today.slice(0,7));setFrom(attendanceDayRange(today,7));setTo(today);setView('daily');setVisibleDays(7);};

 const groups=new Map<string,Row[]>();for(const row of scopedRows){const k=row.user_id+'|'+row.work_date;const group=groups.get(k)??[];group.push(row);groups.set(k,group);}
 const comparison=(r:Row)=>dayComparison(r.work_date,schedule(r),groups.get(r.user_id+'|'+r.work_date)??[],todayBudapest(),tolerance);
 const filtered=scopedRows.filter(r=>{const f=comparison(r);return !problems||(f.open&&r.work_date<today&&!overnightIds.has(r.id))||f.late||f.early||f.dayOff;});
 const comparisons=[...groups.values()].map(g=>comparison(g[0]));
 const summary=personDaySummary(filtered.map(r=>({...r,total_hours:r.total_hours??null})));
 const missing=workforce.staff.flatMap(s=>s.profile_id?[...workforce.entries.values()].filter(e=>e.staff_id===s.id).flatMap(e=>{
 const r:Row={id:'missing-'+s.id+'-'+e.work_date,user_id:s.profile_id!,full_name:s.full_name,work_date:e.work_date,check_in_time:'',check_out_time:null,break_duration:0};
 return inScope(r)&&!groups.has(r.user_id+'|'+r.work_date)&&comparison(r).missing?[r]:[];
 }):[]).filter(r=>r.user_id!==profile?.id);
 const detailHeaders=[t('hr.employee'),label('role'),t('hr.a.hotel'),label('propertySource'),label('status'),t('hr.date'),t('hr.checkIn'),t('hr.checkOut'),t('hr.a.break'),t('hr.hours'),t('hr.a.planned')+' '+t('hr.checkIn'),t('hr.a.planned')+' '+t('hr.checkOut')];
 const detailRows=(view==='corrections'?correctionRows:filtered).map(r=>[r.full_name,label(roleFor(r)),propertyLabel(propertyFor(r)),label(r.work_hotel_id?'captured':'inferred'),label(statusFor(r)),r.work_date,budapestInput(r.check_in_time),budapestInput(r.check_out_time),r.break_duration??0,r.total_hours??'',schedule(r)?.start_time??'',schedule(r)?.end_time??'']);
 const totalHeaders=[t('hr.employee'),t('hr.a.completedDays'),t('hr.hours'),t('hr.a.norm'),t('hr.a.overtime'),t('hr.a.nightHours'),t('hr.a.weekendHours'),t('hr.a.holidayHours'),t('hr.a.leaveDays'),t('hr.a.sickDays')];
 const scopedStaff=workforce.staff.filter(s=>s.profile_id&&(!employee||s.profile_id===employee)&&(!department||s.department_id===department)&&(!role||roleFor({user_id:s.profile_id})===role)&&(!search||s.full_name.toLowerCase().includes(search.trim().toLowerCase())));
 const fullPeriod=!hotel&&!from&&!to&&!problems;
 const publishedEntries=[...workforce.entries.values()].flatMap(e=>{
   const shift=publishedShift(e);return shift&&(!from||e.work_date>=from)&&(!to||e.work_date<=to)&&(!hotel||hotelKey(shift.hotel_id??workforce.staff.find(s=>s.id===e.staff_id)?.hotel_id)===hotel)?[{...e,...shift,status:'published',worked_minutes:shift.worked_minutes??0}]:[];
 });
 const scheduledReports=new Map(employeeReport(publishedEntries,scopedStaff,[...new Set([rangeStart.slice(0,7),rangeEnd.slice(0,7)])]).map(r=>[r.staffId,r]));
 const scheduleIds=new Set(publishedEntries.map(e=>e.staff_id));
 const relevantIds=new Set([...filtered.map(r=>r.user_id),...scopedStaff.filter(s=>!problems&&scheduleIds.has(s.id)).map(s=>s.profile_id!)]);
 const totals=[...relevantIds].map(id=>{const mine=filtered.filter(r=>r.user_id===id);const s=staffByLogin.get(id);const report=s&&!problems?scheduledReports.get(s.id):null;
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
 const renderRow=(r:Row,isOpen=false)=>{
 const shift=schedule(r);const flags=isOpen?dayComparison(r.work_date,shift,[r],today,tolerance):comparison(r);
 const map=attendanceMapUrl(r.check_in_location);const canEdit=r.user_id!==profile?.id;const status=statusFor(r);
 const tone=roleTone(roleFor(r));const statusColor=statusTone(status);
 return <div key={r.id} className="border-b border-border/70 last:border-b-0 odd:bg-muted/20 hover:bg-muted/40">
 <div className={attendanceGrid+' items-center px-3 py-2.5 text-sm'}>
 <div className="col-span-2 min-w-0 lg:col-span-1">
 <div className="flex items-start gap-2.5">
 <span aria-hidden="true" className={'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold '+tone}>{r.full_name.trim().split(/\s+/).slice(0,2).map(n=>n[0]?.toUpperCase()).join('')}</span>
 <div className="min-w-0 flex-1"><div className="break-words font-semibold leading-tight">{r.full_name}</div><div className="mt-1 flex flex-wrap items-center gap-1.5"><span className={'rounded-md px-1.5 py-0.5 text-[10px] font-medium leading-tight '+tone}>{label(roleFor(r))}</span>{isOpen&&<span className="text-xs text-muted-foreground">{r.work_date}</span>}</div>
 <details className="mt-1 text-[11px] text-muted-foreground"><summary className="w-fit cursor-pointer font-medium hover:text-foreground">{label('details')}</summary><div className="mt-1 space-y-1 break-words leading-relaxed"><div>{propertyLabel(propertyFor(r))} · {label(r.work_hotel_id?'captured':'inferred')}</div><div>{shift?.start_time?shift.start_time.slice(0,5)+' – '+shift.end_time?.slice(0,5):t('hr.a.noSchedule')}</div><div>{map?<a href={map} target="_blank" rel="noopener noreferrer" className="underline">{t('hr.a.unverified')}</a>:t('hr.a.unverified')}{flags.delta!=null&&' · '+(flags.delta/60).toFixed(2)+'h'}</div><div className="text-destructive">{[flags.late&&t('hr.a.late'),flags.early&&t('hr.a.early'),flags.dayOff&&t('hr.a.dayOff')].filter(Boolean).join(' · ')}</div></div></details>
 </div></div></div>
 <div className="tabular-nums"><span className="block text-[11px] text-muted-foreground lg:hidden">{t('hr.checkIn')}</span><span className="font-semibold">{budapestInput(r.check_in_time).slice(11)}</span></div>
 <div className="tabular-nums"><span className="block text-[11px] text-muted-foreground lg:hidden">{t('hr.checkOut')}</span><span className={r.check_out_time?'font-semibold':'text-muted-foreground'}>{r.check_out_time?budapestInput(r.check_out_time).slice(11):'—'}</span></div>
 <div className="tabular-nums"><span className="block text-[11px] text-muted-foreground lg:hidden">{t('hr.a.break')}</span>{r.break_duration??0}m</div>
 <div className="tabular-nums"><span className="block text-[11px] text-muted-foreground lg:hidden">{t('hr.hours')}</span><span className={r.total_hours==null?'text-muted-foreground':'font-semibold'}>{r.total_hours==null?'—':Number(r.total_hours).toFixed(2)+'h'}</span></div>
 <div><span className={'inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold '+statusColor}><span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current"/>{label(status)}</span></div>
 <div className="flex flex-wrap justify-end gap-1">{canEdit&&<Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={()=>begin(r)}>{t('hr.a.edit')}</Button>}{canEdit&&isOpen&&r.planned_end&&<Button variant="outline" size="sm" className="h-auto min-h-7 whitespace-normal px-2 py-1 text-xs" onClick={()=>begin(r,true)}>{t('hr.a.closePlan')}</Button>}</div>
 </div></div>;};
 const visible=filtered;
 const dates=[...new Set([...visible.map(r=>r.work_date),...missing.map(r=>r.work_date),...(month===today.slice(0,7)&&(!from||from<=today)&&(!to||to>=today)?[today]:[])])].sort((a,b)=>b.localeCompare(a));
 const focusedDate=dates[0]??(to||from||today);
 const todayRows=filtered.filter(r=>r.work_date===focusedDate);
 const latestByPerson=new Map<string,Row>();for(const r of todayRows)if(!latestByPerson.has(r.user_id))latestByPerson.set(r.user_id,r);
 const latest=[...latestByPerson.values()];
 const liveWorking=new Set([...latest.filter(r=>!r.check_out_time),...overnightRows].map(r=>r.user_id)).size;
 const kpis=view==='daily'&&focusedDate===today?[[label('checkedIn'),latest.length],[label('working'),liveWorking],[label('out'),latest.filter(r=>!!r.check_out_time).length],[label('corrections'),correctionRows.length]]:[[t('hr.a.personDays'),summary.days],[t('hr.totalHours'),Number(summary.hours).toFixed(1)+'h'],[t('hr.avgHoursPerDay'),Number(summary.average).toFixed(1)+'h'],[t('hr.a.onTime').replace('{n}',String(comparisons.filter(c=>c.onTime).length)).replace('{m}',String(comparisons.filter(c=>c.scheduled).length)),t('hr.a.noSchedule')+': '+comparisons.filter(c=>!c.scheduled).length]];
 const header=<div className={attendanceGrid.replace(/^grid /,'')+' hidden border-b bg-muted/50 px-3 py-2 text-xs font-semibold text-muted-foreground lg:grid'}><span>{t('hr.employee')}</span><span>{t('hr.checkIn')}</span><span>{t('hr.checkOut')}</span><span>{t('hr.a.break')}</span><span>{t('hr.hours')}</span><span>{label('status')}</span><span /></div>;
 const viewIcons={daily:CalendarDays,monthly:FileSpreadsheet,history:History,corrections:AlertCircle};
 const metricIcons=view==='daily'&&focusedDate===today?[LogIn,Users,LogOut,AlertCircle]:[Users,Clock,Clock,AlertCircle];
 return <section className="space-y-4 pb-8">
 <div className="flex flex-wrap items-center gap-1.5 rounded-xl border bg-muted/40 p-1.5">{(['daily','monthly','history','corrections'] as const).map(v=>{const Icon=viewIcons[v];return <Button key={v} size="sm" variant={view===v?'default':'ghost'} aria-pressed={view===v} className={'gap-2 '+(view===v?'shadow-sm':v==='corrections'?'text-amber-800 dark:text-amber-300':'text-muted-foreground')} onClick={()=>selectView(v)}><Icon className="h-4 w-4" aria-hidden="true"/>{label(v)}{v==='corrections'&&correctionRows.length>0?<span className={'rounded-full px-1.5 text-xs tabular-nums '+(view===v?'bg-white/20':'bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200')}>{correctionRows.length}</span>:null}</Button>;})}</div>
 <div className="space-y-3 rounded-xl border bg-card p-3 shadow-sm">
 <div className="flex flex-wrap items-end gap-2"><div className="flex flex-wrap gap-1 rounded-lg bg-muted/60 p-1"><Button variant={from===today&&to===today?'secondary':'ghost'} aria-pressed={from===today&&to===today} size="sm" onClick={()=>selectDay(today)}>{label('today')}</Button><Button variant={from===yesterday&&to===yesterday?'secondary':'ghost'} aria-pressed={from===yesterday&&to===yesterday} size="sm" onClick={()=>selectDay(yesterday)}>{label('yesterday')}</Button><Button variant={from===attendanceDayRange(today,7)&&to===today?'secondary':'ghost'} aria-pressed={from===attendanceDayRange(today,7)&&to===today} size="sm" onClick={selectWeek}>{label('seven')}</Button></div><label className="text-sm">{t('hr.a.month')}<Input type="month" value={month} onChange={e=>selectMonth(e.target.value)}/></label>
 <label className="text-sm">{t('hr.a.from')}<Input type="date" min={rangeStart<monthStart?rangeStart:monthStart} max={to||monthEnd} value={from} onChange={e=>{setFrom(e.target.value);setVisibleDays(7);}}/></label><label className="text-sm">{t('hr.a.to')}<Input type="date" min={from||monthStart} max={monthEnd} value={to} onChange={e=>{setTo(e.target.value);setVisibleDays(7);}}/></label>
 <div className="ml-auto flex flex-wrap gap-2"><Button variant="outline" size="sm" className="gap-1.5" onClick={()=>setRefresh(x=>x+1)}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true"/>{label('refresh')}</Button><Button size="sm" className="gap-1.5" onClick={()=>begin()}><Plus className="h-4 w-4" aria-hidden="true"/>{t('hr.a.manual')}</Button><Button size="sm" variant="outline" className="gap-1.5" disabled={loading||failed||workforce.loading||!!workforce.error} onClick={()=>void exportExcel()}><FileSpreadsheet className="h-4 w-4" aria-hidden="true"/>{t('hr.a.export')}</Button><Button size="sm" variant="outline" className="gap-1.5" disabled={loading||failed||workforce.loading||!!workforce.error} onClick={exportCsv}><Download className="h-4 w-4" aria-hidden="true"/>{t('hr.exportCsv')}</Button></div></div>
 <div className="border-t pt-3"><div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Users className="h-3.5 w-3.5" aria-hidden="true"/>{label('role')}</div><div className="flex flex-wrap gap-2" role="group" aria-label={label('role')}>{['',...roles].map(v=><button type="button" key={v} aria-pressed={role===v} className={'inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 '+roleTone(v)+(role===v?' ring-2 ring-current ring-offset-1 ring-offset-background shadow-sm':' hover:shadow-md')} onClick={()=>{setRole(v);setVisibleDays(7);}}>{role===v?<Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true"/>:<span className="h-2 w-2 shrink-0 rounded-full bg-current opacity-80" aria-hidden="true"/>}{label(v||'allStaff')}</button>)}</div></div>
 <div className="flex flex-wrap items-end gap-3 border-t pt-3"><label className="text-xs font-medium text-muted-foreground">{label('search')}<div className="relative mt-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4" aria-hidden="true"/><Input className="h-9 pl-8 text-foreground" value={search} onChange={e=>setSearch(e.target.value)}/></div></label><label className="text-sm">{t('hr.employee')}<select className="block rounded-md border bg-background p-2" value={employee} onChange={e=>setEmployee(e.target.value)}><option value="">{t('periods.allEmployees')}</option>{employees.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select></label><label className="text-sm">{t('hr.a.department')}<select className="block rounded border bg-background p-2" value={department} onChange={e=>setDepartment(e.target.value)}><option value="">{t('hr.a.all')}</option>{workforce.departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label className="flex gap-2 text-sm"><input type="checkbox" checked={problems} onChange={e=>setProblems(e.target.checked)}/>{t('hr.a.problems')}</label></div>
 <div className="flex flex-wrap items-center gap-2 border-t pt-3" role="group" aria-label={t('hr.a.hotel')}><span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Hotel className="h-4 w-4" aria-hidden="true"/>{t('hr.a.hotel')}</span><button type="button" aria-pressed={!hotel} onClick={()=>setHotel('')} className={'rounded-lg border px-2.5 py-1.5 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-ring '+roleTone('')+(!hotel?' ring-2 ring-current ring-offset-1 ring-offset-background':'')}>{t('hr.a.all')}</button>{propertyOptions.map(h=><button key={h} type="button" aria-pressed={hotel===h} onClick={()=>setHotel(h)} className={'rounded-lg border px-2.5 py-1.5 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-ring '+propertyTone(h).soft+(hotel===h?' ring-2 ring-current ring-offset-1 ring-offset-background':'')}>{propertyLabel(h)}</button>)}</div>
 <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true"/>{t('hr.a.timezone')} · {label('propertySource')}: {label('captured')} / {label('inferred')}</p></div>
 {(failed||workforce.error)?<p role="alert">{t('hr.a.failed')}</p>:(loading||workforce.loading)?<p>{t('common.loading')}</p>:<>
 {view!=='corrections'&&<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{kpis.map(([name,value],index)=>{const Icon=metricIcons[index];return <Card key={name} className={'overflow-hidden border shadow-sm '+metricTones[index]}><CardContent className="flex items-center justify-between gap-2 p-3.5 sm:p-4"><div><div className="text-xs font-medium opacity-85 sm:text-sm">{name}</div><div className="mt-1 text-2xl font-bold tabular-nums">{value}</div></div><span className="rounded-xl bg-white/20 dark:bg-black/10 p-2"><Icon className="h-5 w-5" aria-hidden="true"/></span></CardContent></Card>;})}</div>}
 {view==='daily'&&focusedDate===today&&!problems&&overnightRows.length>0&&<Card><CardHeader><CardTitle>{label('overnight')} ({overnightRows.length})</CardTitle></CardHeader><CardContent>{header}{overnightRows.map(r=>renderRow(r))}</CardContent></Card>}
 {view==='corrections'?<Card><CardHeader><CardTitle>{t('hr.a.fix')} ({correctionRows.length})</CardTitle></CardHeader><CardContent>{header}{correctionRows.map(r=>renderRow(r,true))}{!correctionRows.length&&<p>{t('hr.empty')}</p>}</CardContent></Card>:<>
 {view==='monthly'&&<Card><CardHeader><CardTitle>{label('monthly')}</CardTitle></CardHeader><CardContent className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{totalHeaders.map(h=><th key={h} className="p-2 text-left">{h}</th>)}</tr></thead><tbody>{totals.map((line,i)=><tr key={i} className="border-t">{line.map((value,j)=><td key={j} className="p-2">{value}</td>)}</tr>)}</tbody></table></CardContent></Card>}
 {view==='history'&&!employee?<p className="text-sm text-muted-foreground">{t('hr.training.employee')}</p>:dates.slice(0,visibleDays).map((date,index)=>{
 const day=visible.filter(r=>r.work_date===date);const absent=missing.filter(r=>r.work_date===date);
 const properties=[...new Set([...day,...absent].map(propertyFor))].sort((a,b)=>propertyLabel(a).localeCompare(propertyLabel(b)));
 return <Card key={date} className="overflow-hidden border shadow-sm"><CardContent className="p-0">
 <details open={index===0} className="group/day"><summary className={'flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden '+(date===today?'bg-sky-50 text-sky-950 dark:bg-sky-950/60 dark:text-sky-100':'bg-muted/60')}><ChevronDown className="h-4 w-4 shrink-0 -rotate-90 transition-transform group-open/day:rotate-0" aria-hidden="true"/><CalendarDays className="h-4 w-4" aria-hidden="true"/><span>{date===today?label('today')+' · ':date===yesterday?label('yesterday')+' · ':''}{date}</span><span className="ml-auto rounded-full border border-current/20 px-2.5 py-1 text-xs tabular-nums">{new Set(day.map(r=>r.user_id)).size} {label('checkedIn')}</span></summary>
 <div className="space-y-3 p-2.5 sm:p-3">{properties.map(h=>{
 const group=day.filter(r=>propertyFor(r)===h);const people=[...new Set(group.map(r=>r.user_id))];
 const latest=people.map(id=>group.find(r=>r.user_id===id)!);
 const working=latest.filter(r=>statusFor(r)==='working').length;
 const onBreak=latest.filter(r=>statusFor(r)==='break').length;
 const completed=latest.filter(r=>!!r.check_out_time).length;
 const unresolved=latest.filter(r=>statusFor(r)==='missing').length;
 const absentHere=absent.filter(r=>propertyFor(r)===h);const colors=propertyTone(h);
 return <details key={h} open className={'group/property overflow-hidden rounded-xl border shadow-sm '+colors.border}>
 <summary className={'flex cursor-pointer list-none flex-wrap items-center gap-2.5 px-3 py-3 sm:px-4 [&::-webkit-details-marker]:hidden '+colors.header}>
 <ChevronDown className="h-4 w-4 shrink-0 -rotate-90 transition-transform group-open/property:rotate-0" aria-hidden="true"/><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15"><Hotel className="h-5 w-5" aria-hidden="true"/></span><span className="min-w-0 flex-1"><span className="block break-words text-base font-bold">{propertyLabel(h)}</span><span className="block text-xs opacity-90">{people.length} {label('checkedIn')}</span></span>
 <span className="flex flex-wrap items-center gap-1.5 text-xs font-semibold tabular-nums"><span className="rounded-md bg-white/15 px-2 py-1">{working} {label('working')}</span>{onBreak>0&&<span className="rounded-md bg-white/15 px-2 py-1">{onBreak} {label('break')}</span>}<span className="rounded-md bg-white/15 px-2 py-1">{completed} {label('out')}</span>{unresolved+absentHere.length>0&&<span className="rounded-md bg-white/20 px-2 py-1">{unresolved+absentHere.length} {label('corrections')}</span>}</span>
 </summary>
 <div className="bg-card">{header}{people.map(id=>{const sessions=group.filter(r=>r.user_id===id);return sessions.length===1?renderRow(sessions[0]):<details key={id} className="border-b last:border-b-0"><summary className="cursor-pointer bg-muted/25 px-3 py-2.5 text-sm font-medium">{sessions[0].full_name} · {sessions.length} · {sessions.reduce((sum,r)=>sum+Number(r.total_hours??0),0).toFixed(2)}h</summary>{sessions.map(r=>renderRow(r))}</details>;})}
 {absentHere.map(r=><div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b bg-amber-50/70 px-3 py-2.5 text-sm last:border-b-0 dark:bg-amber-950/20"><span className="flex flex-wrap items-center gap-2"><span className="font-semibold">{r.full_name}</span><span className={'rounded-full px-2 py-1 text-xs font-medium '+statusTone('missing')}>{t('hr.a.missing')}</span></span><Button size="sm" variant="outline" onClick={()=>setEdit({employee:r.user_id,date:r.work_date,start:'',end:'',breakMinutes:'0',reason:'',note:''})}>{t('hr.a.manual')}</Button></div>)}</div>
 </details>;})}{!properties.length&&<p className="p-3 text-muted-foreground">{t('hr.empty')}</p>}</div></details></CardContent></Card>;})}
 {dates.length>visibleDays&&<Button variant="outline" onClick={()=>setVisibleDays(n=>n+7)}>{label('loadEarlier')}</Button>}
 {!dates.length&&<p>{t('hr.empty')}</p>}
 </>}
 </>}
 <Dialog open={!!edit} onOpenChange={v=>{if(!v&&!busy)setEdit(null);}}><DialogContent><DialogHeader><DialogTitle>{edit?.row?t('hr.a.edit'):t('hr.a.manual')}</DialogTitle></DialogHeader>{edit&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();void save();}}>
 {!edit.row&&<><label className="block text-sm">{t('hr.employee')}<select required className="block w-full rounded border bg-background p-2" value={edit.employee} onChange={e=>setEdit({...edit,employee:e.target.value})}><option value="">{t('hr.training.employee')}</option>{employees.filter(e=>e.id!==profile?.id).map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select></label><label className="block text-sm">{t('hr.date')}<Input required type="date" max={todayBudapest()} value={edit.date} onChange={e=>setEdit({...edit,date:e.target.value})}/></label></>}
 <label className="block text-sm">{t('hr.checkIn')}<Input required type="datetime-local" value={edit.start} onChange={e=>setEdit({...edit,start:e.target.value})}/></label><label className="block text-sm">{t('hr.checkOut')}<Input required={!edit.row} type="datetime-local" value={edit.end} onChange={e=>setEdit({...edit,end:e.target.value})}/></label><label className="block text-sm">{t('hr.a.break')}<Input required type="number" min={0} max={2160} step={1} value={edit.breakMinutes} onChange={e=>setEdit({...edit,breakMinutes:e.target.value})}/></label>{!edit.row&&<label className="block text-sm">{t('hr.a.note')}<Input value={edit.note} onChange={e=>setEdit({...edit,note:e.target.value})}/></label>}<label className="block text-sm">{t('hr.a.reason')}<Input required maxLength={2000} value={edit.reason} onChange={e=>setEdit({...edit,reason:e.target.value})}/></label><div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy||!edit.reason.trim()}>{t('hr.a.save')}</Button>{edit.row&&<Button type="button" variant="destructive" disabled={busy||!edit.reason.trim()} onClick={()=>void remove()}>{t('hr.a.delete')}</Button>}<Button type="button" variant="outline" disabled={busy} onClick={()=>setEdit(null)}>{t('hr.a.cancel')}</Button></div></form>}</DialogContent></Dialog>
 </section>;
}
