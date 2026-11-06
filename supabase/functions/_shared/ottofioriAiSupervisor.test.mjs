import test from 'node:test';
import assert from 'node:assert/strict';
import { observeAiPrice, selectAiDates, validateAiMoves, estimateSupervisorCost, availableSupervisorModel, softEventTest, peerPriceSignal } from './ottofioriAiSupervisor.ts';
const now = new Date('2026-11-06T15:00:00Z');
const policy = {created_at:'2026-11-06T14:00:00Z',valid_until:'2026-11-06T18:00:00Z'};
test('AI observation outranks timer changes, expires, and releases for new pickup',()=>{
  assert.equal(observeAiPrice(policy,now,null),true);
  assert.equal(observeAiPrice(policy,now,'2026-11-06T13:00Z'),true);
  assert.equal(observeAiPrice(policy,now,'2026-11-06T14:01Z'),false);
  assert.equal(observeAiPrice(policy,now,null,'2026-11-06T14:01Z'),false);
  assert.equal(observeAiPrice(policy,now,null,'2026-11-06T13:00Z'),true);
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
const peer=(patch={})=>({hotel:'mika-downtown',at:'2026-11-06T10:00:00Z',direction:'increase',delta:18,pct:8,confirmed:true,...patch});
test('confirmed manager signals count properties once and preserve latest reversals',()=>{
 const signal=peerPriceSignal([peer(),peer(),peer({at:'2026-11-06T11:00:00Z',delta:-5,pct:-2,direction:'decrease'}),peer({hotel:'gozsdu-court'})],now);
 assert.equal(signal.hotels,2);
 assert.equal(signal.peers.length,2);
 assert.equal(signal.direction,'mixed');
 assert.equal(signal.peers.find(p=>p.hotel==='mika-downtown').direction,'decrease');
 assert.equal(peerPriceSignal([peer(),peer({hotel:'gozsdu-court'}),peer({hotel:'memories-budapest'})],now).hotels,3);
});
test('stale, unconfirmed, future, tiny and unknown-property edits cannot manufacture fresh demand',()=>{
 const signal=peerPriceSignal([peer({at:'2026-11-03T10:00:00Z'}),peer({hotel:'gozsdu-court',confirmed:false}),peer({hotel:'memories-budapest',at:'2026-11-07T10:00:00Z'}),peer({hotel:'unrelated'})],now);
 assert.equal(signal.direction,'none');assert.equal(signal.hotels,0);assert.equal(signal.peers.length,1);
 assert.equal(peerPriceSignal([peer({pct:.1})],now).hotels,0);
 assert.equal(peerPriceSignal([peer({at:'invalid'}),peer({delta:NaN})],now).peers.length,0);
});
test('December and every horizon month receive coverage; previous reviews rotate quiet dates',()=>{
 const dates=Array.from({length:121},(_,lead)=>date({date:new Date(Date.UTC(2026,10,6+lead)).toISOString().slice(0,10),lead}));
 const first=selectAiDates(dates,now);
 assert.equal(first.length,56);
 assert.ok(first.filter(d=>d.date.startsWith('2026-12')).length>=10);
 assert.deepEqual([...new Set(first.map(d=>d.date.slice(0,7)))].sort(),['2026-11','2026-12','2027-01','2027-02','2027-03']);
 const second=selectAiDates(dates.map(d=>({...d,last_ai_review_at:first.some(f=>f.date===d.date)?now.toISOString():null})),now);
 assert.ok(second.filter(d=>!first.some(f=>f.date===d.date)).length>=45);
});
test('a new manager edit receives priority once; urgent dates and other months retain space',()=>{
 const dates=Array.from({length:121},(_,lead)=>date({date:new Date(Date.UTC(2026,10,6+lead)).toISOString().slice(0,10),lead}));
 const signal=peerPriceSignal([peer(),peer({hotel:'gozsdu-court'})],now);
 const last=dates.at(-1);last.peer_signal=signal;last.occ=70;
 const picked=selectAiDates(dates,now);
 assert.ok(picked.slice(0,28).includes(last));assert.ok(picked.slice(0,4).every(d=>d.lead<=3));
 last.last_ai_review_at=now.toISOString();
 assert.equal(selectAiDates(dates,now).includes(last),false);
 assert.equal(selectAiDates(dates,now,2).length,2);
});
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
