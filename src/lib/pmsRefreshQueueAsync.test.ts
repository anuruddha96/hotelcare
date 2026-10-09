import { describe,it,expect,vi } from 'vitest';
vi.mock('@/integrations/supabase/client',()=>({
 supabase:{
  auth:{getSession:async()=>({data:{session:{access_token:'token'}}})},
  rpc:vi.fn(async()=>({data:[
   {job_id:'job-one',request_group_id:'group-one',target_key:'hotel:ottofiori'},
  ],error:null})),
 },
}));
import { supabase } from '@/integrations/supabase/client';
import { runQueuedPmsRefresh } from './pmsRefreshQueue';
describe('manual PMS queue feedback',()=>{
 it('returns a queued result without waiting for Previo execution',async()=>{
  const r=await runQueuedPmsRefresh('ottofiori');
  expect(r.status).toBe('queued');
  expect(r.jobIds).toEqual(['job-one']);
  expect(r.managerMessage).toContain('queued');
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
 });
});
