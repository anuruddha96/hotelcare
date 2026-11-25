import { describe,it,expect } from 'vitest';
import { selectActivePmsQueueGroup, type PmsQueueRow } from './pmsQueueMonitor';
const row=(id:string,group:string,status:string,time:string):PmsQueueRow=>({
 id,request_group_id:group,hotel_id:'slnt-group',target_key:'account:'+id,
 status,requested_at:time,finished_at:null,
});
describe('durable PMS queue group visibility',()=>{
 it('includes the second pending SLNT account',()=>{
  const list=[row('a','grp1','success','2026-10-09T07:00:00Z'),
    row('b','grp1','queued','2026-10-09T07:00:00Z')];
  expect(selectActivePmsQueueGroup(list,'slnt-group')).toHaveLength(2);
 });
 it('keeps an earlier running group visible when a newer one already completed',()=>{
  const list=[row('a','older','running','2026-10-09T07:00:00Z'),
    row('b','newer','success','2026-10-09T07:05:00Z')];
  expect(selectActivePmsQueueGroup(list,'slnt-group').map(x=>x.id)).toEqual(['a']);
 });
 it('does not show other hotels',()=>{
  expect(selectActivePmsQueueGroup([row('a','x','queued','2026-10-09T07:00:00Z')],'ottofiori')).toHaveLength(0);
 });
});
