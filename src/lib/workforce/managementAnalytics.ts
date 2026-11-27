import { WORKING_KINDS, isNightShift } from './cellParser';
import { hotelShort, monthDays, type WorkforceStaff } from './model';
import { monthsBetween, type EmployeeReportRow, type ReportEntry } from './report';

export const ANALYTICS_COLORS = {hours:'#0284c7', people:'#0d9488', overtime:'#d97706', under:'#6366f1', leave:'#a855f7', sick:'#e11d48', unpaid:'#64748b', absent:'#dc2626', night:'#4338ca', drafts:'#ea580c'};
export const PROPERTY_COLORS:Record<string,string>={'gozsdu-court':'#0d9488','mika-downtown':'#15803d','memories-budapest':'#a21caf',ottofiori:'#7c3aed',company:'#64748b'};
const hours=(m:number)=>Math.round(m/6)/10;
export function managementAnalytics(entries:readonly ReportEntry[],staff:readonly WorkforceStaff[],report:readonly EmployeeReportRow[],fromMonth:string,toMonth:string,departments:ReadonlyMap<string,string>) {
 const staffMap=new Map(staff.map(s=>[s.id,s]));
 const rows=entries.filter(e=>staffMap.has(e.staff_id));
 const dates=monthsBetween(fromMonth,toMonth).flatMap(m=>{const [y,n]=m.split('-').map(Number);return monthDays(y,n);});
 const byDate=new Map(dates.map(date=>[date,{date,hours:0,day:0,night:0,leave:0,sick:0,drafts:0,people:new Set<string>(),hasData:false}]));
 const properties=new Map<string,{key:string;name:string;minutes:number;people:Set<string>}>();
 const teams=new Map<string,{name:string;minutes:number;people:Set<string>;overtime:number;under:number}>();
 const contracts=new Map<string,number>();
 const getTeam=(key:string)=>{if(!teams.has(key))teams.set(key,{name:departments.get(key)??'No department',minutes:0,people:new Set(),overtime:0,under:0});return teams.get(key)!;};
 for(const s of staff)if(s.is_active)contracts.set(s.employment_type,(contracts.get(s.employment_type)??0)+1);
 for(const e of rows){
   const d=byDate.get(e.work_date);if(!d)continue;
   d.hasData=true;d.hours+=e.worked_minutes??0;
   if(e.status==='draft')d.drafts++;
   if(e.kind==='leave'||e.kind==='half_leave')d.leave+=e.kind==='half_leave'?0.5:1;
   if(e.kind==='sick')d.sick++;
   if(WORKING_KINDS.has(e.kind)||e.kind==='half_leave'){
     d.people.add(e.staff_id);
     if(isNightShift({kind:e.kind,start:e.start_time??null,end:e.end_time??null}))d.night++;else d.day++;
     const key=e.hotel_id??'company';
     if(!properties.has(key))properties.set(key,{key,name:hotelShort(e.hotel_id),minutes:0,people:new Set()});
     const property=properties.get(key)!;property.minutes+=e.worked_minutes??0;property.people.add(e.staff_id);
   }
   const team=getTeam(staffMap.get(e.staff_id)?.department_id??'none');
   team.minutes+=e.worked_minutes??0;team.people.add(e.staff_id);
 }
 for(const r of report){const s=staffMap.get(r.staffId);if(!s)continue;const team=getTeam(s.department_id??'none');team.overtime+=Math.max(0,r.balanceMinutes??0);team.under+=Math.max(0,-(r.balanceMinutes??0));}
 const scopedReport=report.filter(r=>staffMap.has(r.staffId));
 const absence=[{name:'Annual leave',value:scopedReport.reduce((n,r)=>n+r.leaveDays,0),color:ANALYTICS_COLORS.leave},{name:'Sick leave',value:scopedReport.reduce((n,r)=>n+r.sickDays,0),color:ANALYTICS_COLORS.sick},{name:'Unpaid leave',value:scopedReport.reduce((n,r)=>n+r.unpaidDays,0),color:ANALYTICS_COLORS.unpaid},{name:'Unexcused',value:scopedReport.reduce((n,r)=>n+r.absentDays,0),color:ANALYTICS_COLORS.absent}];
 const risks=(['overtime','under','long_run','sick','absent','drafts'] as const).map((flag,i)=>({flag,name:['Over norm','Under norm','7+ consecutive days','3+ sick days','Unexcused absence','Unpublished'][i],value:scopedReport.filter(r=>r.flags.includes(flag)).length}));
 return {daily:[...byDate.values()].map(d=>({date:d.date,people:d.hasData?d.people.size:null,hours:d.hasData?hours(d.hours):null,day:d.hasData?d.day:null,night:d.hasData?d.night:null,leave:d.hasData?d.leave:null,sick:d.hasData?d.sick:null,drafts:d.hasData?d.drafts:null})),
 properties:[...properties.values()].map(p=>({key:p.key,name:p.name,hours:hours(p.minutes),people:p.people.size,color:PROPERTY_COLORS[p.key]??'#64748b'})).sort((a,b)=>b.hours-a.hours),
 teams:[...teams.values()].map(t=>({name:t.name,hours:hours(t.minutes),people:t.people.size,overtime:hours(t.overtime),under:hours(t.under)})).sort((a,b)=>b.hours-a.hours),
 contracts:[...contracts].map(([name,value])=>({name,value})),absence,risks};
}
