import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HrPeopleOverview } from './HrPeopleOverview';
import { HrTrainingAnalytics } from './HrTrainingAnalytics';
import { HrPersonnelDocuments } from './HrPersonnelDocuments';
import { ALL_CURRICULA } from '@/components/training/v2/curricula';

const state=vi.hoisted(()=>({
  profile:{id:'hr-1',organization_slug:'rdhotels'},hrWorkspace:true,language:'en',
  invoke:vi.fn(),reload:vi.fn(),
  staff:[
    {id:'staff-a',full_name:'Fixture Alice',is_active:true,profile_id:'account-a',department_id:'d1',job_role_id:'j1',hotel_id:'ottofiori',employment_type:'full_time',daily_hours:8},
    {id:'staff-b',full_name:'Fixture Bob',is_active:true,profile_id:null,department_id:'d1',job_role_id:'j1',hotel_id:'ottofiori',employment_type:'hourly',daily_hours:8},
    {id:'staff-c',full_name:'Fixture Carol',is_active:false,profile_id:null,department_id:'d1',job_role_id:'j1',hotel_id:'ottofiori',employment_type:'full_time',daily_hours:8}
  ]
}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({profile:state.profile})}));
vi.mock('@/hooks/useAccessPolicy',()=>({useAccessPolicy:()=>({hrWorkspace:state.hrWorkspace})}));
vi.mock('@/hooks/useTranslation',()=>({useTranslation:()=>({language:state.language,t:(key:string)=>key})}));
vi.mock('@/hooks/useWorkforce',()=>({useWorkforce:()=>({staff:state.staff,departments:[{id:'d1',name:'Housekeeping'}],jobRoles:[{id:'j1',name:'Attendant'}],loading:false,error:null,reload:state.reload})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:state.invoke}}}));
vi.mock('@/components/workforce/WorkforceAnalytics',()=>({WorkforceAnalytics:()=> <div>Fixture workforce analytics</div>}));
vi.mock('@/components/workforce/WorkforceStaffDialog',()=>({WorkforceStaffDialog:({staff}:{staff:{full_name?:string}|null})=>staff?<div role="dialog">{staff.full_name||'New employee'}</div>:null}));
vi.mock('@/components/training/v2/TrainingV2Provider',()=>({useTrainingV2:()=>({lang:'en'}),txt:(value:{en:string})=>value.en}));
beforeEach(()=>{state.hrWorkspace=true;state.language='en';state.invoke.mockReset();state.invoke.mockResolvedValue({data:{ok:true,documents:[],uploadsEnabled:false},error:null});});
afterEach(cleanup);

describe('HR People directory',()=>{
 it('excludes former employees by default, filters unlinked accounts, and opens a personal file',async()=>{
  render(<HrPeopleOverview/>);
  expect(screen.getByRole('button',{name:/Fixture Alice/})).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/Fixture Carol/})).toBeNull();
  fireEvent.change(screen.getByLabelText('Account status'),{target:{value:'unlinked'}});
  expect(screen.queryByRole('button',{name:/Fixture Alice/})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:/Fixture Bob/}));
  expect(screen.getByRole('heading',{name:'Fixture Bob'})).toBeInTheDocument();
  await waitFor(()=>expect(state.invoke).toHaveBeenCalledWith('hr-personnel-documents',{body:{action:'list',staffId:'staff-b'}}));
  fireEvent.click(screen.getByRole('button',{name:'Edit / link account'}));
  expect(screen.getByRole('dialog')).toHaveTextContent('Fixture Bob');
 });
 it('searches by employee name and exposes workforce analytics',()=>{
  render(<HrPeopleOverview/>);
  fireEvent.change(screen.getByRole('searchbox'),{target:{value:'Alice'}});
  expect(screen.queryByRole('button',{name:/Fixture Bob/})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Workforce analytics'}));
  expect(screen.getByText('Fixture workforce analytics')).toBeInTheDocument();
 });
 it('does not mount the employee workspace for another role',()=>{
  state.hrWorkspace=false;render(<HrPeopleOverview/>);
  expect(screen.queryByText('Fixture Alice')).toBeNull();expect(state.invoke).not.toHaveBeenCalled();
 });
 it('shows former staff when requested and supports Hungarian',()=>{
  state.language='hu';render(<HrPeopleOverview/>);
  fireEvent.change(screen.getByLabelText('Foglalkoztatási állapot'),{target:{value:'former'}});
  expect(screen.getByRole('button',{name:/Fixture Carol/})).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/Fixture Alice/})).toBeNull();
 });
});
describe('HR document controls',()=>{
 it('fails closed when document service is unavailable',async()=>{
  state.invoke.mockResolvedValue({data:null,error:{message:'Unavailable'}});
  render(<HrPersonnelDocuments staffId="staff-a"/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Private document access is unavailable');
  expect(screen.queryByRole('button',{name:'Upload securely'})).toBeNull();
 });
 it('disables uploads without scanner and hides actions for archived records',async()=>{
  state.invoke.mockResolvedValue({data:{ok:true,uploadsEnabled:false,documents:[{id:'d1',title:'Archived contract',category:'contract',original_name:'a.pdf',archived_at:'2026-01-01'}]},error:null});
  render(<HrPersonnelDocuments staffId="staff-a"/>);
  expect(await screen.findByText('Archived contract')).toBeInTheDocument();
  expect(screen.getByText(/Uploads disabled until/)).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Download'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Archive document'})).toBeNull();
 });
 it('enables upload form only after successful security check',async()=>{
  state.invoke.mockResolvedValue({data:{ok:true,uploadsEnabled:true,documents:[]},error:null});
  render(<HrPersonnelDocuments staffId="staff-a"/>);
  const button=await screen.findByRole('button',{name:'Upload securely'});
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Document title'),{target:{value:'Fixture contract'}});
  fireEvent.change(screen.getByLabelText(/PDF or image/),{target:{files:[new File(['%PDF-1.7'],'fixture.pdf',{type:'application/pdf'})]}});
  expect(button).toBeEnabled();
 });
});
describe('HR training reporting',()=>{
 it('shows applicable guide progress and filters employee drilldowns',async()=>{
  const guide=ALL_CURRICULA.find(c=>c.category==='core'&&c.roles.includes('housekeeping'))!;
  state.invoke.mockResolvedValue({data:{ok:true,employees:[{id:'a',full_name:'Fixture Alice',role:'housekeeping',access_role:null,assigned_hotel:'ottofiori'},{id:'b',full_name:'Fixture Bob',role:'housekeeping',access_role:null,assigned_hotel:'memories-budapest'}],progress:[{user_id:'a',tour_key:guide.slug,status:'completed',current_step:9999,completed_at:'2026-01-01'}],states:[]},error:null});
  render(<HrTrainingAnalytics/>);
  await screen.findByText('Completion by guide');
  expect(state.invoke).toHaveBeenCalledWith('training-admin-action',{body:{action:'hr_analytics'}});
  expect(screen.getAllByText('Fixture Alice').length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText('Property'),{target:{value:'ottofiori'}});
  expect(screen.queryByText('Fixture Bob')).toBeNull();
  expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
 });
 it('shows error instead of misleading zero metrics if analytics fails',async()=>{
  state.invoke.mockResolvedValue({data:null,error:{message:'Unavailable'}});
  render(<HrTrainingAnalytics/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('No data was displayed');
  expect(screen.queryByText('Completion by guide')).toBeNull();
 });
});
