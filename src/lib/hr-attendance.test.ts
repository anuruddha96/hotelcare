import {describe,it,expect} from 'vitest';
import {budapestInput,budapestUtc,personDaySummary} from './hr-attendance';
describe('HR attendance',()=>{
 it('counts 71 person-days across three dates, not three calendar days',()=>{
 const records=Array.from({length:71},(_,i)=>({user_id:String(Math.floor(i/3)),work_date:'2026-11-'+(21+i%3),check_out_time:'done',total_hours:6}));
 expect(personDaySummary(records)).toEqual({days:71,completed:71,hours:426,average:6});
 expect(personDaySummary([...records,{...records[0],total_hours:2},{user_id:'new',work_date:'2026-11-21',check_out_time:null,total_hours:99}])).toEqual({days:72,completed:71,hours:428,average:428/71});
 });
 it('converts Budapest winter and summer and rejects DST gaps',()=>{
 expect(budapestUtc('2026-11-24T08:00')).toBe('2026-11-24T07:00:00.000Z');
 expect(budapestInput('2026-07-24T06:00:00Z')).toBe('2026-07-24T08:00');
 expect(()=>budapestUtc('2026-03-29T02:30')).toThrow();
 expect(()=>budapestUtc('2026-10-25T02:30')).toThrow();
 });
});
