import {useEffect,useState,useRef} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {useAuth} from '@/hooks/useAuth';
import {useTranslation} from '@/hooks/useTranslation';
import {useWorkforce,entryKey,fetchAllRows} from '@/hooks/useWorkforce';
import {todayBudapest} from '@/lib/budapestTime';
import {budapestInput,budapestUtc,dayComparison,publishedShift,csvCell,attendanceMapUrl,personDaySummary,attendanceShiftHours} from '@/lib/hr-attendance';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card';
import {useToast} from '@/hooks/use-toast';
import {hotelName,hotelKey} from '@/lib/workforce/model';
import {employeeReport,normMinutes} from '@/lib/workforce/report';
// RPCs introduced by the phase-2 migration; generated API types follow deployment.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db=supabase as any;
type Row={id:string;user_id:string;full_name:string;work_date:string;check_in_time:string;check_out_time:string|null;break_duration:number|null;total_hours?:number|null;planned_end?:string|null;status?:string;notes?:string|null;check_in_location?:unknown};
type Edit={row?:Row;employee:string;date:string;start:string;end:string;breakMinutes:string;reason:string;note:string};
export function HrAttendance(){
 const {profile}=useAuth();const {t}=useTranslation();const {toast}=useToast();
 const [month,setMonth]=useState(todayBudapest().slice(0,7));
 const [employee,setEmployee]=useState('');const [rows,setRows]=useState<Row[]>([]);const [open,setOpen]=useState<Row[]>([]);const [tolerance,setTolerance]=useState(5);
 const [edit,setEdit]=useState<Edit|null>(null);const [busy,setBusy]=useState(false);const [failed,setFailed]=useState(false);const [loading,setLoading]=useState(true);const [refresh,setRefresh]=useState(0);
 const [problems,setProblems]=useState(false);const [hotel,setHotel]=useState('');const [department,setDepartment]=useState('');const [from,setFrom]=useState('');const [to,setTo]=useState('');const request=useRef(0);const [employees,setEmployees]=useState<{id:string;full_name:string}[]>([]);
 const [year,m]=month.split('-').map(Number);const workforce=useWorkforce(year,m);
 useEffect(()=>{
 const token=++request.current;setLoading(true);setFailed(false);setRows([]);setOpen([]);
 const args={target_user_id:null,start_date:month+'-01',end_date:new Date(Date.UTC(year,m,0)).toISOString().slice(0,10)};
 const load=async()=>{try{
 const [records,forgotten,people,settings]=await Promise.all([
 fetchAllRows<Row>((a,b)=>db.rpc('get_attendance_records_hotel_filtered',args).order('work_date').order('id').range(a,b)),
 fetchAllRows<Row>((a,b)=>db.rpc('hr_attendance_open_records').order('work_date').order('id').range(a,b)),
 db.rpc('get_employees_by_hotel'),
 db.from('workforce_settings').select('punctuality_tolerance_minutes').eq('organization_slug',profile?.organization_slug).maybeSingle()
 ]);
 if(people.error||settings.error)throw new Error('Attendance request failed');
 if(token!==request.current)return;
 setRows(records);setOpen(forgotten);setEmployees(people.data??[]);setTolerance(settings.data?.punctuality_tolerance_minutes??5);
 }catch{if(token===request.current){setFailed(true);setRows([]);setOpen([]);}}finally{if(token===request.current)setLoading(false);}};
 if(profile?.organization_slug)void load();else setLoading(false);
 return()=>{request.current++;};
 },[month,year,m,refresh,profile?.id,profile?.organization_slug]);
 const begin=(row?:Row,planned=false)=>setEdit(row?{row,employee:row.user_id,date:row.work_date,start:budapestInput(row.check_in_time),end:budapestInput(planned?row.planned_end??null:row.check_out_time),breakMinutes:String(row.break_duration??0),reason:'',note:row.notes??''}:{employee:employee||'',date:todayBudapest(),start:'',end:'',breakMinutes:'0',reason:'',note:''});
 const save=async()=>{if(!edit||!edit.reason.trim()||busy)return;setBusy(true);try{
 const times={_check_in:budapestUtc(edit.start),_check_out:edit.end?budapestUtc(edit.end):null,_break_minutes:Number(edit.breakMinutes),_reason:edit.reason.trim()};
 const result=edit.row?await db.rpc('attendance_correct',{_id:edit.row.id,...times,_status:edit.end?'checked_out':edit.row.status==='on_break'?'on_break':'checked_in'}):await db.rpc('attendance_manual_add',{_employee:edit.employee,_date:edit.date,...times,_note:edit.note});
 if(result.error)throw result.error;setEdit(null);setRefresh(x=>x+1);toast({title:t('hr.a.saved')});
 }catch{toast({title:t('hr.a.failed'),variant:'destructive'});}finally{setBusy(false);}};
 const remove=async()=>{if(!edit?.row||!edit.reason.trim()||busy||!window.confirm(t('hr.a.confirmDelete')))return;setBusy(true);try{const result=await db.rpc('attendance_delete',{_id:edit.row.id,_reason:edit.reason.trim()});if(result.error)throw result.error;setEdit(null);setRefresh(x=>x+1);toast({title:t('hr.a.saved')});}catch{toast({title:t('hr.a.failed'),variant:'destructive'});}finally{setBusy(false);}};
 const staffByLogin=new Map(workforce.staff.filter(s=>s.profile_id).map(s=>[s.profile_id!,s]));
 const schedule=(r:Row)=>{const s=staffByLogin.get(r.user_id);const e=s&&workforce.entries.get(entryKey(s.id,r.work_date));return e?publishedShift(e):null;};
 const inScope=(r:Row)=>{const s=staffByLogin.get(r.user_id);return (!employee||r.user_id===employee)&&(!hotel||hotelKey(schedule(r)?.hotel_id??s?.hotel_id)===hotel)&&(!department||s?.department_id===department)&&(!from||r.work_date>=from)&&(!to||r.work_date<=to);};
 const filtered=rows.filter(inScope);
 const groups=new Map<string,Row[]>();for(const row of filtered){const k=row.user_id+'|'+row.work_date;const group=groups.get(k)??[];group.push(row);groups.set(k,group);}
 const comparison=(r:Row)=>dayComparison(r.work_date,schedule(r),groups.get(r.user_id+'|'+r.work_date)??[],todayBudapest(),tolerance);
 const comparisons=[...groups.values()].map(g=>comparison(g[0]));
 const summary=personDaySummary(filtered.map(r=>({...r,total_hours:r.total_hours??null})));
 const missing=workforce.staff.flatMap(s=>s.profile_id?[...workforce.entries.values()].filter(e=>e.staff_id===s.id).flatMap(e=>{
 const r:Row={id:'missing-'+s.id+'-'+e.work_date,user_id:s.profile_id!,full_name:s.full_name,work_date:e.work_date,check_in_time:'',check_out_time:null,break_duration:0};
 return inScope(r)&&!groups.has(r.user_id+'|'+r.work_date)&&comparison(r).missing?[r]:[];
 }):[]).filter(r=>r.user_id!==profile?.id);
 const detailHeaders=[t('hr.employee'),t('hr.date'),t('hr.checkIn'),t('hr.checkOut'),t('hr.a.break'),t('hr.hours'),t('hr.a.planned')+' '+t('hr.checkIn'),t('hr.a.planned')+' '+t('hr.checkOut')];
 const detailRows=filtered.map(r=>[r.full_name,r.work_date,budapestInput(r.check_in_time),budapestInput(r.check_out_time),r.break_duration??0,r.total_hours??'',schedule(r)?.start_time??'',schedule(r)?.end_time??'']);
 const totalHeaders=[t('hr.employee'),t('hr.a.completedDays'),t('hr.hours'),t('hr.a.norm'),t('hr.a.overtime'),t('hr.a.nightHours'),t('hr.a.weekendHours'),t('hr.a.holidayHours'),t('hr.a.leaveDays'),t('hr.a.sickDays')];
 const scopedStaff=workforce.staff.filter(s=>s.profile_id&&(!employee||s.profile_id===employee)&&(!department||s.department_id===department));
 const fullPeriod=!hotel&&!from&&!to;
 const publishedEntries=[...workforce.entries.values()].flatMap(e=>{
   const shift=publishedShift(e);return shift&&(!from||e.work_date>=from)&&(!to||e.work_date<=to)&&(!hotel||hotelKey(shift.hotel_id??workforce.staff.find(s=>s.id===e.staff_id)?.hotel_id)===hotel)?[{...e,...shift,status:'published',worked_minutes:shift.worked_minutes??0}]:[];
 });
 const scheduledReports=new Map(employeeReport(publishedEntries,scopedStaff,[month]).map(r=>[r.staffId,r]));
 const relevantIds=new Set([...filtered.map(r=>r.user_id),...scopedStaff.filter(s=>scheduledReports.has(s.id)).map(s=>s.profile_id!)]);
 const totals=[...relevantIds].map(id=>{const mine=filtered.filter(r=>r.user_id===id);const s=staffByLogin.get(id);const report=s?scheduledReports.get(s.id):null;
 const actual=attendanceShiftHours(mine,r=>schedule(r as Row));const norm=s&&fullPeriod?normMinutes(s,[month]):null;
 const leave=report?.leaveDays??0,sick=report?.sickDays??0;
 const overtime=norm!=null&&s?Math.max(0,actual.hours+(leave+sick)*s.daily_hours-norm/60):null;
 return[s?.full_name??mine[0]?.full_name??employees.find(e=>e.id===id)?.full_name??'',actual.days,actual.hours,norm==null?'':norm/60,overtime??'',actual.night,actual.weekend,actual.holiday,leave,sick];});
 const exportExcel=async()=>{const XLSX=await import('xlsx');const wb=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([detailHeaders,...detailRows]),t('hr.nav.attendance').slice(0,31));
 XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([totalHeaders,...totals]),'Totals');XLSX.writeFile(wb,'attendance-'+month+'.xlsx');};
 const exportCsv=()=>{const body=[detailHeaders,...detailRows,[],totalHeaders,...totals].map(row=>row.map(csvCell).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob(['\ufeff'+body],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='attendance-'+month+'.csv';a.click();URL.revokeObjectURL(url);};
 const renderRow=(r:Row,isOpen=false)=>{const shift=schedule(r);const flags=isOpen?dayComparison(r.work_date,shift,[r],todayBudapest(),tolerance):comparison(r);const map=attendanceMapUrl(r.check_in_location);const canEdit=r.user_id!==profile?.id;return <div key={r.id} className="grid gap-2 border-b p-3 md:grid-cols-[1.3fr_1fr_1fr_1fr_auto] md:items-center"><div><div className="font-medium">{r.full_name}</div><div className="text-xs text-muted-foreground">{r.work_date}</div></div><div>{budapestInput(r.check_in_time).slice(11)} – {r.check_out_time?budapestInput(r.check_out_time).slice(11):t('attendance.notSignedOut')}</div><div className="text-sm text-muted-foreground">{shift?.start_time?shift.start_time.slice(0,5)+' – '+shift.end_time?.slice(0,5):t('hr.a.noSchedule')}</div><div>{r.total_hours==null?'—':Number(r.total_hours).toFixed(2)+'h'}<div className="text-xs text-muted-foreground">{map?<a href={map} target="_blank" rel="noopener noreferrer" className="underline">{t('hr.a.unverified')}</a>:t('hr.a.unverified')}</div>{flags.delta!=null&&<div className="text-xs">{flags.delta>0?'+':''}{(flags.delta/60).toFixed(2)}h</div>}<div className="text-xs text-destructive">{[flags.late&&t('hr.a.late'),flags.early&&t('hr.a.early'),flags.dayOff&&t('hr.a.dayOff')].filter(Boolean).join(' · ')}</div></div><div className="flex flex-wrap gap-2">{canEdit&&<Button variant="outline" size="sm" onClick={()=>begin(r)}>{t('hr.a.edit')}</Button>}{canEdit&&isOpen&&r.planned_end&&<Button variant="outline" size="sm" onClick={()=>begin(r,true)}>{t('hr.a.closePlan')}</Button>}</div></div>;};
 return <section className="space-y-4"><div className="flex flex-wrap items-end gap-3"><label className="text-sm">{t('hr.a.month')}<Input type="month" value={month} onChange={e=>{if(e.target.value){setMonth(e.target.value);setFrom('');setTo('');}}}/></label><label className="text-sm">{t('hr.employee')}<select className="block rounded-md border bg-background p-2" value={employee} onChange={e=>setEmployee(e.target.value)}><option value="">{t('periods.allEmployees')}</option>{employees.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select></label><label className="text-sm">{t('hr.a.hotel')}<select className="block rounded border bg-background p-2" value={hotel} onChange={e=>setHotel(e.target.value)}><option value="">{t('hr.a.all')}</option>{[...new Set(workforce.staff.map(s=>hotelKey(s.hotel_id)).filter(Boolean))].map(h=><option key={h} value={h!}>{hotelName(h)}</option>)}</select></label><label className="text-sm">{t('hr.a.department')}<select className="block rounded border bg-background p-2" value={department} onChange={e=>setDepartment(e.target.value)}><option value="">{t('hr.a.all')}</option>{workforce.departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label className="text-sm">{t('hr.a.from')}<Input type="date" min={month+'-01'} max={to||new Date(Date.UTC(year,m,0)).toISOString().slice(0,10)} value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="text-sm">{t('hr.a.to')}<Input type="date" min={from||month+'-01'} max={new Date(Date.UTC(year,m,0)).toISOString().slice(0,10)} value={to} onChange={e=>setTo(e.target.value)}/></label><Button onClick={()=>begin()}>{t('hr.a.manual')}</Button><Button variant="outline" disabled={loading||failed||workforce.loading||!!workforce.error} onClick={()=>void exportExcel()}>{t('hr.a.export')}</Button><Button variant="outline" disabled={loading||failed||workforce.loading||!!workforce.error} onClick={exportCsv}>{t('hr.exportCsv')}</Button><label className="flex gap-2 text-sm"><input type="checkbox" checked={problems} onChange={e=>setProblems(e.target.checked)}/>{t('hr.a.problems')}</label></div><p className="text-xs text-muted-foreground">{t('hr.a.timezone')}</p>
 {(failed||workforce.error)?<p role="alert">{t('hr.a.failed')}</p>:(loading||workforce.loading)?<p>{t('common.loading')}</p>:<>
 {summary&&<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[[t('hr.a.personDays'),summary.days],[t('hr.totalHours'),Number(summary.hours).toFixed(1)+'h'],[t('hr.avgHoursPerDay'),Number(summary.average).toFixed(1)+'h'],[t('hr.a.onTime').replace('{n}',String(comparisons.filter(c=>c.onTime).length)).replace('{m}',String(comparisons.filter(c=>c.scheduled).length)),t('hr.a.noSchedule')+': '+comparisons.filter(c=>!c.scheduled).length]].map(([label,value])=><Card key={label}><CardContent className="p-4"><div className="text-sm text-muted-foreground">{label}</div><div className="text-xl font-semibold">{value}</div></CardContent></Card>)}</div>}
 {open.length>0&&<Card><CardHeader><CardTitle>{t('hr.a.fix')} ({open.length})</CardTitle></CardHeader><CardContent>{open.map(r=>renderRow(r,true))}</CardContent></Card>}
 <Card><CardHeader><CardTitle>{t('hr.attendanceRecords')}</CardTitle></CardHeader><CardContent>{filtered.filter(r=>{const f=comparison(r);return !problems||f.open||f.late||f.early||f.dayOff||!f.scheduled;}).map(r=>renderRow(r))}{missing.map(r=><div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b p-3"><span>{r.full_name} · {r.work_date} · {t('hr.a.missing')}</span><Button size="sm" variant="outline" onClick={()=>setEdit({employee:r.user_id,date:r.work_date,start:'',end:'',breakMinutes:'0',reason:'',note:''})}>{t('hr.a.manual')}</Button></div>)}
 {filtered.length===0&&missing.length===0&&<p>{t('hr.empty')}</p>}</CardContent></Card>
 </>}
 <Dialog open={!!edit} onOpenChange={v=>{if(!v&&!busy)setEdit(null);}}><DialogContent><DialogHeader><DialogTitle>{edit?.row?t('hr.a.edit'):t('hr.a.manual')}</DialogTitle></DialogHeader>{edit&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();void save();}}>
 {!edit.row&&<><label className="block text-sm">{t('hr.employee')}<select required className="block w-full rounded border bg-background p-2" value={edit.employee} onChange={e=>setEdit({...edit,employee:e.target.value})}><option value="">{t('hr.training.employee')}</option>{employees.filter(e=>e.id!==profile?.id).map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select></label><label className="block text-sm">{t('hr.date')}<Input required type="date" max={todayBudapest()} value={edit.date} onChange={e=>setEdit({...edit,date:e.target.value})}/></label></>}
 <label className="block text-sm">{t('hr.checkIn')}<Input required type="datetime-local" value={edit.start} onChange={e=>setEdit({...edit,start:e.target.value})}/></label><label className="block text-sm">{t('hr.checkOut')}<Input required={!edit.row} type="datetime-local" value={edit.end} onChange={e=>setEdit({...edit,end:e.target.value})}/></label><label className="block text-sm">{t('hr.a.break')}<Input required type="number" min={0} max={2160} step={1} value={edit.breakMinutes} onChange={e=>setEdit({...edit,breakMinutes:e.target.value})}/></label>{!edit.row&&<label className="block text-sm">{t('hr.a.note')}<Input value={edit.note} onChange={e=>setEdit({...edit,note:e.target.value})}/></label>}<label className="block text-sm">{t('hr.a.reason')}<Input required maxLength={2000} value={edit.reason} onChange={e=>setEdit({...edit,reason:e.target.value})}/></label><div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy||!edit.reason.trim()}>{t('hr.a.save')}</Button>{edit.row&&<Button type="button" variant="destructive" disabled={busy||!edit.reason.trim()} onClick={()=>void remove()}>{t('hr.a.delete')}</Button>}<Button type="button" variant="outline" disabled={busy} onClick={()=>setEdit(null)}>{t('hr.a.cancel')}</Button></div></form>}</DialogContent></Dialog>
 </section>;
}
