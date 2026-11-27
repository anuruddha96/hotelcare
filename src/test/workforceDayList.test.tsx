import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkforceDayList } from '@/components/workforce/WorkforceDayList';
import { DEFAULT_CELL_LABELS, type WorkforceEntry, type WorkforceStaff } from '@/lib/workforce/model';
vi.mock('@/hooks/useTranslation',()=>({useTranslation:()=>({t:(key:string)=>key,language:'en'})}));
vi.mock('@/hooks/useWorkforce',()=>({entryKey:(id:string,date:string)=>id+'|'+date}));
afterEach(cleanup);
const date='2026-11-27';
const staff:WorkforceStaff[]=['Scheduled person','Half leave person','Sick person','Unplanned person'].map((full_name,i)=>({id:String(i),full_name,nickname:null,department_id:'hk',job_role_id:null,hotel_id:'ottofiori',profile_id:null,employment_type:'full_time',daily_hours:8,annual_leave_days:null,leave_note:null,start_date:null,end_date:null,is_active:true,sort_order:i,notes:null,source_label:null}));
const entry=(i:number,kind:WorkforceEntry['kind']):WorkforceEntry=>({staff_id:String(i),work_date:date,kind,code:null,start_time:null,end_time:null,day_fraction:kind==='half_leave'?0.5:1,extra_minutes:0,hotel_id:'ottofiori',raw_text:null,note:null,status:i===0?'draft':'published'});
const entries=new Map([0,1,2].map((i)=>[String(i)+'|'+date,entry(i,(['work','half_leave','sick'] as const)[i])]));
const renderList=()=>{const setDay=vi.fn(),onOpen=vi.fn();render(<WorkforceDayList day={date} days={['2026-11-26',date,'2026-11-28']} today={date} setDay={setDay} staff={staff} entries={entries} deptName={new Map([['hk','Housekeeping']])} departmentColors={new Map([['hk','#123456']])} roleName={new Map()} cellLabels={DEFAULT_CELL_LABELS} onOpen={onOpen}/>);return {setDay,onOpen};};
describe('workforce day list',()=>{
 it('distinguishes scheduled half days, other recorded shifts and unplanned entries',()=>{
  renderList();
  const group=screen.getByRole('group',{name:'wf.mobile.dailyFilter'});
  expect(within(group).getByRole('button',{name:'2 wf.mobile.working'})).toBeInTheDocument();
  expect(within(group).getByRole('button',{name:'1 wf.mobile.other'})).toBeInTheDocument();
  expect(within(group).getByRole('button',{name:'1 wf.f.empty'})).toBeInTheDocument();
  fireEvent.click(within(group).getByRole('button',{name:'2 wf.mobile.working'}));
  expect(screen.getByText('Half leave person')).toBeInTheDocument();
  expect(screen.queryByText('Sick person')).toBeNull();
  expect(screen.queryByText('Unplanned person')).toBeNull();
  expect(screen.getByText('wf.mobile.draft')).toBeInTheDocument();
  fireEvent.click(within(group).getByRole('button',{name:'1 wf.f.empty'}));
  expect(screen.getByText('Unplanned person')).toBeInTheDocument();
  expect(screen.queryByText('Scheduled person')).toBeNull();
 });
 it('keeps date navigation and entry details actionable',()=>{
  const {setDay,onOpen}=renderList();
  fireEvent.click(screen.getByRole('button',{name:'wf.d.prev'}));
  expect(setDay).toHaveBeenCalledWith('2026-11-26');
  fireEvent.click(screen.getByRole('button',{name:'wf.d.next'}));
  expect(setDay).toHaveBeenCalledWith('2026-11-28');
  fireEvent.click(screen.getByRole('button',{name:/Scheduled person/}));
  expect(onOpen).toHaveBeenCalledWith(staff[0]);
 });
});
