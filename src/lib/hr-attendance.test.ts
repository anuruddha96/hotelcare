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

import {dayComparison,publishedShift,csvCell,attendanceMapUrl} from './hr-attendance';
describe('schedule reconciliation',()=>{
 const shift={kind:'night' as const,start_time:'20:00',end_time:'08:00',hotel_id:'ottofiori',worked_minutes:720};
 const row={user_id:'a',work_date:'2026-11-20',check_in_time:'2026-11-20T19:06:00Z',check_out_time:'2026-11-21T06:00:00Z',total_hours:10};
 it('uses last published snapshot instead of unpublished changes',()=>expect(publishedShift({...shift,status:'draft',start_time:'12:00',published_version:shift})).toEqual(shift));
 it('detects lateness and early overnight departure',()=>expect(dayComparison(row.work_date,shift,[row],'2026-11-24')).toMatchObject({late:true,early:true,delta:-120,missing:false}));
 it('only flags missing on past published work days',()=>{expect(dayComparison(row.work_date,shift,[],'2026-11-24').missing).toBe(true);expect(dayComparison(row.work_date,null,[],'2026-11-24').missing).toBe(false);expect(dayComparison(row.work_date,shift,[],row.work_date).missing).toBe(false);});
 it('does not infer a day off without a published shift',()=>{expect(dayComparison(row.work_date,null,[row],'2026-11-24').dayOff).toBe(false);expect(dayComparison(row.work_date,{...shift,kind:'day_off'},[row],'2026-11-24').dayOff).toBe(true);});
 it('escapes CSV quotes and formulas and validates map coordinates',()=>{expect(csvCell('=1+1')).toBe('"\'=1+1"');expect(csvCell('a"b')).toBe('"a""b"');expect(attendanceMapUrl({latitude:91,longitude:1})).toBeNull();expect(attendanceMapUrl({latitude:47,longitude:19})).toContain('47%2C19');});
});

import {attendanceShiftHours} from './hr-attendance';
it('classifies completed actual hours by shift and business date, ignoring open shifts',()=>{
 const a={user_id:'x',work_date:'2026-12-25',check_in_time:'2026-12-25T19:00:00Z',check_out_time:'2026-12-26T07:00:00Z',total_hours:11};
 const b={...a,work_date:'2026-12-26',check_out_time:null,total_hours:99};
 expect(attendanceShiftHours([a,b],()=>null)).toEqual({days:1,hours:11,night:11,weekend:0,holiday:11});
});

import {attendanceRole,newestAttendance,attendanceStatus,attendanceDayRange} from './hr-attendance';
describe('daily attendance reporting',()=>{
 it('distinguishes reception and housekeeping managers from legacy manager role',()=>{
  expect(attendanceRole('manager','reception')).toBe('reception');
  expect(attendanceRole('manager','housekeeping_manager')).toBe('housekeeping_manager');
  expect(attendanceRole('manager',null,'Front office manager')).toBe('front_office_manager');
  expect(attendanceRole('manager',null)).toBe('manager');
 });
 it('sorts latest work date first without mutating input',()=>{
  const rows=[{id:'a',work_date:'2025-10-04',check_in_time:'2025-10-04T06:00:00Z'},{id:'b',work_date:'2026-11-27',check_in_time:'2026-11-27T07:00:00Z'},{id:'c',work_date:'2026-11-27',check_in_time:'2026-11-27T08:00:00Z'}];
  expect(newestAttendance(rows).map(r=>r.id)).toEqual(['c','b','a']);
  expect(rows[0].id).toBe('a');
 });
 it('does not label active employees as missing checkout',()=>{
  const row={work_date:'2026-11-27',check_out_time:null,status:'checked_in'};
  expect(attendanceStatus(row,'2026-11-27')).toBe('working');
  expect(attendanceStatus({...row,status:'on_break'},'2026-11-27')).toBe('break');
  expect(attendanceStatus(row,'2026-11-28')).toBe('missing');
  expect(attendanceStatus({...row,status:'auto_signout',check_out_time:'2026-11-27T16:00:00Z'},'2026-11-27')).toBe('auto');
 });
 it('computes a seven-day range across months',()=>expect(attendanceDayRange('2026-11-03',7)).toBe('2026-10-28'));
});
