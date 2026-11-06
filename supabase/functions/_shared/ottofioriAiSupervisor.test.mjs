import test from 'node:test';
import assert from 'node:assert/strict';
import { observeAiPrice, selectAiDates, validateAiMoves, estimateSupervisorCost, availableSupervisorModel, softEventTest } from './ottofioriAiSupervisor.ts';
const now = new Date('2026-11-06T15:00:00Z');
const policy = {created_at:'2026-11-06T14:00:00Z',valid_until:'2026-11-06T18:00:00Z'};
test('AI observation outranks timer changes, expires, and releases for new pickup',()=>{
  assert.equal(observeAiPrice(policy,now,null),true);
  assert.equal(observeAiPrice(policy,now,'2026-11-06T13:00Z'),true);
  assert.equal(observeAiPrice(policy,now,'2026-11-06T14:01Z'),false);
  assert.equal(observeAiPrice(policy,new Date('2026-11-06T18:00Z'),null),false);
  assert.equal(observeAiPrice(null,now,null),false);
  assert.equal(observeAiPrice({...policy,valid_until:'invalid'},now,null),false);
});
test('verified events allow only a small AI test after demonstrably weak conversion',()=>{
 const weak=date({occ:42.9,left:12,pickup_6h:0,quiet_hours:48});
 assert.equal(softEventTest(weak,-2),true);
 for (const [patch,delta] of [[{},-3],[{occ:75},-2],[{left:4},-2],[{pickup_6h:1},-2],[{quiet_hours:2},-2]])
  assert.equal(softEventTest({...weak,...patch},delta),false);
});
const date=(patch={})=>({date:'2027-01-10',lead:65,occ:0,left:21,reference:150,captured_at:now.toISOString(),cells:Array.from({length:13},(_,i)=>({obk_id:String(i),occupancy:1,price:140})),...patch});
test('all last-four-day offers beat distant weak nights; stale or incomplete data cannot spend credits',()=>{
 const urgent=date({date:'2026-11-06',lead:0,occ:90.5,left:2});
 assert.deepEqual(selectAiDates([date(),date({date:'2026-11-08',lead:2,occ:52}),urgent],now,2).map(d=>d.date),['2026-11-06','2026-11-08']);
 assert.equal(selectAiDates([date({captured_at:'2026-11-06T10:00Z'}),date({cells:[]}),date({occ:null}),date({left:0})],now).length,0);
});
test('unknown dates, duplicates, fractional steps, oversized steps, malformed confidence fail closed',()=>{
 const valid={date:'2027-01-10',delta:-6,confidence:.9,reason:'No pickup and 21 rooms left; test a lower offer.'};
 assert.equal(validateAiMoves([valid],[date()])[0].delta,-6);
 for(const row of [{...valid,date:'2027-02-01'},{...valid,delta:-7},{...valid,delta:-1.5},{...valid,confidence:2},{...valid,reason:'x'}])
   assert.throws(()=>validateAiMoves([row],[date()]));
 assert.throws(()=>validateAiMoves([valid,valid],[date()]));
 assert.throws(()=>validateAiMoves([],[date()]));
 assert.ok(estimateSupervisorCost('gpt-6.1-sol',12000,6000)<.1);
 assert.equal(availableSupervisorModel(['gpt-4.1','gpt-5.6-sol','gpt-5.5-pro']),'gpt-5.6-sol');
 assert.equal(availableSupervisorModel(['gpt-6.1-sol','gpt-5.6-sol']),'gpt-6.1-sol');
 assert.equal(estimateSupervisorCost('gpt-5.6-sol',1000000,1000000),24);
});
