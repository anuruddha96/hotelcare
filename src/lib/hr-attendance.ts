// Convert explicitly entered Budapest wall time. Reject nonexistent and ambiguous DST times.
export function budapestInput(iso: string | null): string {
 if (!iso) return '';
 const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Budapest',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso));
 const p=(k:string)=>parts.find(x=>x.type===k)?.value;
 return p('year')+'-'+p('month')+'-'+p('day')+'T'+p('hour')+':'+p('minute');
}
export function budapestUtc(input:string): string {
 const naive=Date.parse(input+'Z');
 const choices=[1,2].map(h=>new Date(naive-h*3600000)).filter(d=>Number.isFinite(d.getTime())&&budapestInput(d.toISOString())===input);
 if(choices.length!==1) throw new Error('Invalid or ambiguous Budapest time');
 return choices[0].toISOString();
}
export function personDaySummary(rows: {user_id:string;work_date:string;check_out_time:string|null;total_hours:number|null}[]) {
 const days=new Set<string>(),completed=new Set<string>();let hours=0;
 for(const row of rows){const key=row.user_id+'|'+row.work_date;days.add(key);if(row.check_out_time){completed.add(key);hours+=Number(row.total_hours??0);}}
 return {days:days.size,completed:completed.size,hours,average:completed.size?hours/completed.size:0};
}

import {WORKING_KINDS, type WorkforceKind} from './workforce/cellParser';
export type PlannedShift={kind:WorkforceKind;start_time:string|null;end_time:string|null;worked_minutes?:number;hotel_id:string|null};
export type ActualAttendance={user_id:string;work_date:string;check_in_time:string;check_out_time:string|null;total_hours?:number|null};
export function publishedShift<T extends PlannedShift>(entry:{status:string;published_version?:PlannedShift|null}&T):PlannedShift|null {
 return entry.status==='published'?entry:entry.published_version??null;
}
export function shiftBounds(date:string,shift:PlannedShift|null) {
 if(!shift||!WORKING_KINDS.has(shift.kind)||!shift.start_time||!shift.end_time)return null;
 const start=shift.start_time.slice(0,5),end=shift.end_time.slice(0,5);
 const endDate=end<=start?new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10):date;
 try{return {start:Date.parse(budapestUtc(date+'T'+start)),end:Date.parse(budapestUtc(endDate+'T'+end))};}catch{return null;}
}
export function dayComparison(date:string,shift:PlannedShift|null,actual:ActualAttendance[],today:string,tolerance=5) {
 const bounds=shiftBounds(date,shift);
 const first=actual.length?Math.min(...actual.map(r=>Date.parse(r.check_in_time))):null;
 const closed=actual.filter(r=>r.check_out_time);
 const last=closed.length===actual.length&&closed.length?Math.max(...closed.map(r=>Date.parse(r.check_out_time!))):null;
 const minutes=closed.reduce((n,r)=>n+Number(r.total_hours??0)*60,0);
 const expected=shift&&WORKING_KINDS.has(shift.kind)?shift.worked_minutes??(bounds?(bounds.end-bounds.start)/60000:null):null;
 return {minutes,expected,delta:expected==null||last==null?null:minutes-expected,
 late:bounds!==null&&first!==null&&first>bounds.start+tolerance*60000,
 early:bounds!==null&&last!==null&&last<bounds.end,
 missing:date<today&&!!shift&&WORKING_KINDS.has(shift.kind)&&!actual.length,
 dayOff:!!actual.length&&!!shift&&['day_off','fixed_day_off'].includes(shift.kind),
 open:actual.some(r=>!r.check_out_time),scheduled:bounds!==null,onTime:bounds!==null&&first!==null&&first<=bounds.start+tolerance*60000};
}
export function csvCell(value:unknown):string {
 const text=String(value??'');return '"'+(/^[\s]*[=+@-]/.test(text)?"'"+text:text).replace(/"/g,'""')+'"';
}
export function attendanceMapUrl(value:unknown):string|null {
 if(!value||typeof value!=='object')return null;
 const {latitude,longitude}=value as {latitude?:unknown;longitude?:unknown};
 if(typeof latitude!=='number'||typeof longitude!=='number'||!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)return null;
 return 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(latitude+','+longitude);
}

/** Hours classified by the same shift/day rules used in the workforce reports.
 * These are shift-based reporting totals, not statutory pay-premium hours. */
import {isNightShift} from './workforce/cellParser';
import {isPublicHoliday} from './workforce/holidays';
export function attendanceShiftHours(rows:ActualAttendance[],shiftFor:(row:ActualAttendance)=>PlannedShift|null){
 let night=0,weekend=0,holiday=0,hours=0;
 const days=new Set<string>();
 for(const r of rows){
   if(!r.check_out_time)continue;
   const value=Number(r.total_hours??0);
   if(!Number.isFinite(value)||value<0)continue;
   days.add(r.user_id+'|'+r.work_date);hours+=value;
   const shift=shiftFor(r);
   if(shift?isNightShift({kind:shift.kind,start:shift.start_time,end:shift.end_time}):isNightShift({kind:'work',start:budapestInput(r.check_in_time).slice(11),end:budapestInput(r.check_out_time).slice(11)}))night+=value;
   const weekday=new Date(r.work_date+'T12:00:00Z').getUTCDay();
   if(weekday===0||weekday===6)weekend+=value;
   if(isPublicHoliday(r.work_date))holiday+=value;
 }
 return {days:days.size,hours,night,weekend,holiday};
}
