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
