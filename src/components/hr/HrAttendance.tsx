import {useEffect,useState,useCallback} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {useAuth} from '@/hooks/useAuth';
import {useTranslation} from '@/hooks/useTranslation';
import {useWorkforce,entryKey} from '@/hooks/useWorkforce';
import {todayBudapest} from '@/lib/budapestTime';
import {budapestInput,budapestUtc} from '@/lib/hr-attendance';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card';
import {useToast} from '@/hooks/use-toast';
import {normMinutes} from '@/lib/workforce/report';
// RPCs introduced by the phase-2 migration; generated API types follow deployment.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db=supabase as any;
type Row={id:string;user_id:string;full_name:string;work_date:string;check_in_time:string;check_out_time:string|null;break_duration:number|null;total_hours?:number|null;planned_end?:string|null;status?:string;notes?:string|null};
type Summary={total_days:number;total_hours:number;avg_hours_per_day:number;scheduled_days:number;punctual_days:number;no_schedule_days:number;completed_days:number};
type Edit={row?:Row;employee:string;date:string;start:string;end:string;breakMinutes:string;reason:string;note:string};
export function HrAttendance(){
 const {profile}=useAuth();const {t}=useTranslation();const {toast}=useToast();
 const [month,setMonth]=useState(todayBudapest().slice(0,7));
 const [employee,setEmployee]=useState('');const [rows,setRows]=useState<Row[]>([]);const [open,setOpen]=useState<Row[]>([]);const [summary,setSummary]=useState<Summary|null>(null);
 const [edit,setEdit]=useState<Edit|null>(null);const [busy,setBusy]=useState(false);const [failed,setFailed]=useState(false);const [loading,setLoading]=useState(true);const [refresh,setRefresh]=useState(0);
 const [problems,setProblems]=useState(false);const [employees,setEmployees]=useState<{id:string;full_name:string}[]>([]);
 const [year,m]=month.split('-').map(Number);const workforce=useWorkforce(year,m);
 const load=useCallback(async()=>{setLoading(true);setFailed(false);try{
 const args={target_user_id:employee||null,start_date:month+'-01',end_date:new Date(Date.UTC(year,m,0)).toISOString().slice(0,10)};
 const [a,b,c,d]=await Promise.all([db.rpc('get_attendance_records_hotel_filtered',args).range(0,9999),db.rpc('get_attendance_summary_secure',args),db.rpc('hr_attendance_open_records').range(0,9999),db.rpc('get_employees_by_hotel')]);
 if(a.error||b.error||c.error||d.error)throw new Error('Attendance request failed');
 setRows(a.data??[]);setSummary(b.data);setOpen(c.data??[]);setEmployees(d.data??[]);
 }catch{setFailed(true);setRows([]);setOpen([]);setSummary(null);}finally{setLoading(false);}},[employee,month,year,m]);
 useEffect(()=>{void load();},[load,refresh]);
 const begin=(row?:Row,planned=false)=>setEdit(row?{row,employee:row.user_id,date:row.work_date,start:budapestInput(row.check_in_time),end:budapestInput(planned?row.planned_end??null:row.check_out_time),breakMinutes:String(row.break_duration??0),reason:'',note:row.notes??''}:{employee:employee||'',date:todayBudapest(),start:'',end:'',breakMinutes:'0',reason:'',note:''});
 const save=async()=>{if(!edit||!edit.reason.trim()||busy)return;setBusy(true);try{
 const times={_check_in:budapestUtc(edit.start),_check_out:edit.end?budapestUtc(edit.end):null,_break_minutes:Number(edit.breakMinutes),_reason:edit.reason.trim()};
 const result=edit.row?await db.rpc('attendance_correct',{_id:edit.row.id,...times,_status:edit.end?'checked_out':'checked_in'}):await db.rpc('attendance_manual_add',{_employee:edit.employee,_date:edit.date,...times,_note:edit.note});
 if(result.error)throw result.error;setEdit(null);setRefresh(x=>x+1);toast({title:t('hr.a.saved')});
 }catch{toast({title:t('hr.a.failed'),variant:'destructive'});}finally{setBusy(false);}};
 const remove=async()=>{if(!edit?.row||!edit.reason.trim()||busy||!window.confirm(t('hr.a.confirmDelete')))return;setBusy(true);try{const result=await db.rpc('attendance_delete',{_id:edit.row.id,_reason:edit.reason.trim()});if(result.error)throw result.error;setEdit(null);setRefresh(x=>x+1);toast({title:t('hr.a.saved')});}catch{toast({title:t('hr.a.failed'),variant:'destructive'});}finally{setBusy(false);}};
 const staffByLogin=new Map(workforce.staff.filter(s=>s.profile_id).map(s=>[s.profile_id!,s]));
 const schedule=(r:Row)=>{const s=staffByLogin.get(r.user_id);const e=s&&workforce.entries.get(entryKey(s.id,r.work_date));return e?.status==='published'?e:e?.published_version??null;};
 const exportExcel=async()=>{const XLSX=await import('xlsx');const wb=XLSX.utils.book_new();const cells=rows.map(r=>[r.full_name,r.work_date,budapestInput(r.check_in_time),budapestInput(r.check_out_time),r.break_duration??0,r.total_hours??'',schedule(r)?.start_time??'',schedule(r)?.end_time??'']);
 XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([[t('hr.employee'),t('hr.date'),t('hr.checkIn'),t('hr.checkOut'),t('hr.a.break'),t('hr.hours'),t('hr.a.planned')+' '+t('hr.checkIn'),t('hr.a.planned')+' '+t('hr.checkOut')],...cells]),t('hr.nav.attendance').slice(0,31));
 const totals=employees.filter(e=>!employee||e.id===employee).map(e=>{const mine=rows.filter(r=>r.user_id===e.id&&r.check_out_time);const s=staffByLogin.get(e.id);return[e.full_name,new Set(mine.map(r=>r.work_date)).size,mine.reduce((a,r)=>a+Number(r.total_hours??0),0),s?(normMinutes(s,[month])??0)/60:''];});
 XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([[t('hr.employee'),t('hr.a.completedDays'),t('hr.hours'),t('hr.a.planned')],...totals]),'Totals');XLSX.writeFile(wb,'attendance-'+month+'.xlsx');};
 const renderRow=(r:Row,isOpen=false)=>{const shift=schedule(r);const canEdit=r.user_id!==profile?.id;return <div key={r.id} className="grid gap-2 border-b p-3 md:grid-cols-[1.3fr_1fr_1fr_1fr_auto] md:items-center"><div><div className="font-medium">{r.full_name}</div><div className="text-xs text-muted-foreground">{r.work_date}</div></div><div>{budapestInput(r.check_in_time).slice(11)} – {r.check_out_time?budapestInput(r.check_out_time).slice(11):t('attendance.notSignedOut')}</div><div className="text-sm text-muted-foreground">{shift?.start_time?shift.start_time.slice(0,5)+' – '+shift.end_time?.slice(0,5):t('hr.a.noSchedule')}</div><div>{r.total_hours==null?'—':Number(r.total_hours).toFixed(2)+'h'}<div className="text-xs text-muted-foreground">{t('hr.a.unverified')}</div></div><div className="flex flex-wrap gap-2">{canEdit&&<Button variant="outline" size="sm" onClick={()=>begin(r)}>{t('hr.a.edit')}</Button>}{canEdit&&isOpen&&r.planned_end&&<Button variant="outline" size="sm" onClick={()=>begin(r,true)}>{t('hr.a.closePlan')}</Button>}</div></div>;};
 return <section className="space-y-4"><div className="flex flex-wrap items-end gap-3"><label className="text-sm">{t('hr.a.month')}<Input type="month" value={month} onChange={e=>e.target.value&&setMonth(e.target.value)}/></label><label className="text-sm">{t('hr.employee')}<select className="block rounded-md border bg-background p-2" value={employee} onChange={e=>setEmployee(e.target.value)}><option value="">{t('periods.allEmployees')}</option>{employees.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select></label><Button onClick={()=>begin()}>{t('hr.a.manual')}</Button><Button variant="outline" disabled={loading||failed} onClick={()=>void exportExcel()}>{t('hr.a.export')}</Button><label className="flex gap-2 text-sm"><input type="checkbox" checked={problems} onChange={e=>setProblems(e.target.checked)}/>{t('hr.a.problems')}</label></div><p className="text-xs text-muted-foreground">{t('hr.a.timezone')}</p>
 {failed?<p role="alert">{t('hr.a.failed')}</p>:loading?<p>{t('common.loading')}</p>:<>
 {summary&&<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[[t('hr.a.personDays'),summary.total_days],[t('hr.totalHours'),Number(summary.total_hours).toFixed(1)+'h'],[t('hr.avgHoursPerDay'),Number(summary.avg_hours_per_day).toFixed(1)+'h'],[t('hr.a.onTime').replace('{n}',String(summary.punctual_days)).replace('{m}',String(summary.scheduled_days)),t('hr.a.noSchedule')+': '+summary.no_schedule_days]].map(([label,value])=><Card key={label}><CardContent className="p-4"><div className="text-sm text-muted-foreground">{label}</div><div className="text-xl font-semibold">{value}</div></CardContent></Card>)}</div>}
 {open.length>0&&<Card><CardHeader><CardTitle>{t('hr.a.fix')} ({open.length})</CardTitle></CardHeader><CardContent>{open.map(r=>renderRow(r,true))}</CardContent></Card>}
 <Card><CardHeader><CardTitle>{t('hr.attendanceRecords')}</CardTitle></CardHeader><CardContent>{rows.filter(r=>!problems||!r.check_out_time||!schedule(r)?.start_time).map(r=>renderRow(r))}
 {rows.length===0&&<p>{t('hr.empty')}</p>}</CardContent></Card>
 </>}
 <Dialog open={!!edit} onOpenChange={v=>{if(!v&&!busy)setEdit(null);}}><DialogContent><DialogHeader><DialogTitle>{edit?.row?t('hr.a.edit'):t('hr.a.manual')}</DialogTitle></DialogHeader>{edit&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();void save();}}>
 {!edit.row&&<><label className="block text-sm">{t('hr.employee')}<select required className="block w-full rounded border bg-background p-2" value={edit.employee} onChange={e=>setEdit({...edit,employee:e.target.value})}><option value="">{t('hr.training.employee')}</option>{employees.filter(e=>e.id!==profile?.id).map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select></label><label className="block text-sm">{t('hr.date')}<Input required type="date" max={todayBudapest()} value={edit.date} onChange={e=>setEdit({...edit,date:e.target.value})}/></label></>}
 <label className="block text-sm">{t('hr.checkIn')}<Input required type="datetime-local" value={edit.start} onChange={e=>setEdit({...edit,start:e.target.value})}/></label><label className="block text-sm">{t('hr.checkOut')}<Input required={!edit.row} type="datetime-local" value={edit.end} onChange={e=>setEdit({...edit,end:e.target.value})}/></label><label className="block text-sm">{t('hr.a.break')}<Input required type="number" min={0} max={2160} step={1} value={edit.breakMinutes} onChange={e=>setEdit({...edit,breakMinutes:e.target.value})}/></label>{!edit.row&&<label className="block text-sm">{t('hr.a.note')}<Input value={edit.note} onChange={e=>setEdit({...edit,note:e.target.value})}/></label>}<label className="block text-sm">{t('hr.a.reason')}<Input required maxLength={2000} value={edit.reason} onChange={e=>setEdit({...edit,reason:e.target.value})}/></label><div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy||!edit.reason.trim()}>{t('hr.a.save')}</Button>{edit.row&&<Button type="button" variant="destructive" disabled={busy||!edit.reason.trim()} onClick={()=>void remove()}>{t('hr.a.delete')}</Button>}<Button type="button" variant="outline" disabled={busy} onClick={()=>setEdit(null)}>{t('hr.a.cancel')}</Button></div></form>}</DialogContent></Dialog>
 </section>;
}
