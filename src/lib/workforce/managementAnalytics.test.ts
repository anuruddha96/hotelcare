import {describe,it,expect} from 'vitest';
import {managementAnalytics} from './managementAnalytics';
import {employeeReport,type ReportEntry} from './report';
import type {WorkforceStaff} from './model';
const person=(id:string,department_id:string,hotel_id:string):WorkforceStaff=>({id,full_name:id,nickname:null,department_id,job_role_id:null,hotel_id,profile_id:null,employment_type:'full_time',daily_hours:8,annual_leave_days:20,leave_note:null,start_date:null,end_date:null,is_active:true,sort_order:0,notes:null,source_label:null});
const entry=(staff_id:string,work_date:string,kind:ReportEntry['kind'],worked_minutes:number,hotel_id:string,status='published'):ReportEntry=>({staff_id,work_date,kind,worked_minutes,extra_minutes:0,hotel_id,status,start_time:'08:00',end_time:'16:00'});
describe('management analytics',()=>{
 const staff=[person('a','hk','mika-downtown'),person('b','fo','ottofiori')];
 const rows=[entry('a','2026-11-01','work',480,'ottofiori'),entry('a','2026-11-02','half_leave',240,'mika-downtown'),entry('b','2026-11-01','night',480,'ottofiori','draft'),entry('b','2026-11-02','sick',0,'ottofiori'),entry('foreign','2026-11-01','work',9999,'foreign')];
 const report=employeeReport(rows,staff,['2026-11']);
 const analytics=managementAnalytics(rows,staff,report,'2026-11','2026-11',new Map([['hk','Housekeeping'],['fo','Reception']]));
 it('does not count records outside the scoped staff',()=>{
  expect(analytics.properties.some(p=>p.key==='foreign')).toBe(false);
  expect(analytics.daily[0].hours).toBe(16);
  expect(analytics.daily[0].people).toBe(2);
 });
 it('separates recorded work property from staff base and uses distinct people per property',()=>{
  expect(analytics.properties.find(p=>p.key==='ottofiori')).toMatchObject({hours:16,people:2});
  expect(analytics.properties.find(p=>p.key==='mika-downtown')).toMatchObject({hours:4,people:1});
 });
 it('keeps unscheduled dates unknown and counts half-day leave and sickness',()=>{
  expect(analytics.daily[1]).toMatchObject({people:1,leave:0.5,sick:1,hours:4});
  expect(analytics.daily[2].people).toBeNull();
  expect(analytics.absence.map(a=>a.value)).toEqual([0.5,1,0,0]);
 });
 it('counts drafts, night shifts and risk flags without changing the report',()=>{
  expect(analytics.daily[0]).toMatchObject({night:1,day:1,drafts:1});
  expect(analytics.risks.find(r=>r.flag==='drafts')?.value).toBe(1);
 });
 it('applies staff scope even when an unfiltered report is passed',()=>{
  const result=managementAnalytics(rows,[staff[0]],report,'2026-11','2026-11',new Map());
  expect(result.daily[0].people).toBe(1);
  expect(result.absence.find(a=>a.name==='Sick leave')?.value).toBe(0);
  expect(result.contracts).toEqual([{name:'full_time',value:1}]);
 });
});
