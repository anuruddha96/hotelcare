import test from 'node:test';
import assert from 'node:assert/strict';
import { decideRevenueDirector, committedMovement } from './engineV2RevenueDirector.ts';
import { DEFAULT_DECISION_SETTINGS } from './engineV2Core.ts';
const settings = {
 ...DEFAULT_DECISION_SETTINGS, now:new Date('2026-11-05T12:00:00Z'),minMovementEur:1,
 maxMarkdownsPerDay:4, maxMarkdownDepthPct:25, rebookWindowHours:12, bookedDateBrakeHours:12,
 fill:{enabled:true,windowDays:120,maxTotalDropPct:25},
 windowRules:[
 {id:'w0_2',min_days_out:0,max_days_out:2,max_daily_decrease:12,max_daily_increase:12,no_pickup_wait_hours:2,min_hours_between_decreases:2,require_above_anchor:false},
 {id:'w3_7',min_days_out:3,max_days_out:7,max_daily_decrease:10,max_daily_increase:15,no_pickup_wait_hours:4,min_hours_between_decreases:4,require_above_anchor:false},
 {id:'w8_30',min_days_out:8,max_days_out:30,max_daily_decrease:6,max_daily_increase:18,no_pickup_wait_hours:8,min_hours_between_decreases:12,require_above_anchor:false},
 {id:'w31_90',min_days_out:31,max_days_out:120,max_daily_decrease:4,max_daily_increase:22,no_pickup_wait_hours:24,min_hours_between_decreases:24,require_above_anchor:false}],
 paceBands:[{min_days_out:0,max_days_out:7,target_occupancy_pct:100},{min_days_out:8,max_days_out:14,target_occupancy_pct:90},{min_days_out:15,max_days_out:30,target_occupancy_pct:80},{min_days_out:31,max_days_out:60,target_occupancy_pct:65},{min_days_out:61,max_days_out:120,target_occupancy_pct:45}]
};
const context={targetAdr:140,minimumAdr:130,projectedAdr:155,requiredRemainingAdr:150,netRateFactor:.8,confirmedHighEvent:false};
const input=(patch={})=>({stayDate:'2026-11-15',daysOut:10,currentPrice:185,occupancyPct:30,roomsSold:6,roomsRemaining:15,pickup1h:0,pickup6h:0,pickup24h:0,pickup48h:0,pickup7d:0,cancellations24h:0,hoursSinceLastPickup:80,lastCancellationAt:null,lastDirection:null,lastDecisionAt:null,lastDecreaseAt:null,movedUpTodayEur:0,movedDownTodayEur:0,manualHoldUntil:null,holdKind:null,minPrice:80,maxPrice:600,adrFloor:220,hardAdrFloor:220,monthFloor:220,monthMarkdownsFrozen:true,anchorPrice:160,crossed60Occupancy:false,pendingEventUplift:0,market:{median:null,sampleSize:0,ageHours:null},campaignStartPrice:185,recentPeakPrice:185,markdownsToday:0,...patch});
const decide=(patch={},ctx={})=>decideRevenueDirector(input(patch),settings,{...context,...ctx});
test('only committed movements consume budgets and cooldowns',()=>{
 for(const status of ['held','shadow','superseded','failed'])assert.equal(committedMovement({status,direction:'decrease',movement:-6}),false);
 for(const status of ['queued','accepted','confirmed','published','partial'])assert.equal(committedMovement({status,direction:'decrease',movement:-6}),true);
});
test('same-day and every final-week unsold room can sell down after quiet period',()=>{
 for(const daysOut of [0,1,4,7]) for(const roomsRemaining of [1,2,8]) {
 const d=decide({daysOut,roomsRemaining,occupancyPct:roomsRemaining===1?95.2:71.4});
 assert.equal(d.direction,'decrease',JSON.stringify({daysOut,roomsRemaining,d}));
 }
});
test('same-day genuine pickup can increase even at high occupancy',()=>{
 assert.equal(decide({daysOut:0,occupancyPct:95.2,roomsRemaining:1,pickup24h:1,pickup6h:1}).direction,'increase');
});
test('one soft-date conversion earns a small uplift, fast pickup earns more',()=>{
 assert.equal(decide({pickup24h:1,pickup6h:1}).movement,2);
 assert.ok(decide({pickup24h:3,pickup6h:3}).movement>2);
 assert.equal(decide({daysOut:2,pickup24h:1,pickup6h:1}).movement,1);
});
test('consumed pickup cannot repeat an increase, while booked-price brake prevents immediate cut',()=>{
 const d=decide({pickup24h:0,pickup6h:0,hoursSinceLastPickup:1,lastDirection:'increase',lastDecisionAt:'2026-11-05T11:00:00Z',movedUpTodayEur:2});
 assert.equal(d.direction,'hold');
});
test('early occupancy positions toward a finite target and stops compounding',()=>{
 const d=decide({daysOut:70,occupancyPct:60,roomsRemaining:8,currentPrice:160});
 assert.equal(d.direction,'increase');
 assert.equal(decide({daysOut:70,occupancyPct:60,roomsRemaining:8,currentPrice:192}).direction,'hold');
});
test('confirmed event positions early once toward anchor premium; empty expensive event dates can reduce',()=>{
 assert.equal(decide({daysOut:60,currentPrice:150},{confirmedHighEvent:true}).direction,'increase');
 assert.equal(decide({daysOut:60,currentPrice:220},{confirmedHighEvent:true}).direction,'decrease');
 assert.equal(decide({daysOut:60,currentPrice:192},{confirmedHighEvent:true}).direction,'hold');
 assert.equal(decide({daysOut:4,currentPrice:160},{confirmedHighEvent:true}).direction,'decrease');
});
test('January weekends and full February are included in the rolling plan',()=>{
 for(const [stayDate,daysOut] of [['2027-01-01',57],['2027-01-02',58],['2027-02-28',115]])
 assert.equal(decide({stayDate,daysOut,occupancyPct:0,roomsRemaining:21}).direction,'decrease');
});
test('poor portfolio ADR does not freeze unsold dates; seasonal reserve stops dumping',()=>{
 assert.equal(decide({currentPrice:180},{projectedAdr:120,requiredRemainingAdr:200}).direction,'decrease');
 assert.equal(decide({currentPrice:144}).direction,'hold');
});
test('freshness, bounds, sold-out inventory, manual locks and edit holds stay authoritative',()=>{
 for(const patch of [{dataStale:true},{minPrice:null},{maxPrice:50},{roomsRemaining:0,occupancyPct:100},{manualHoldUntil:'2026-11-06T12:00:00Z',holdKind:'hard'},{manualHoldUntil:'2026-11-06T12:00:00Z',holdKind:'soft'}])
 assert.equal(decide(patch).direction,'hold',JSON.stringify(patch));
 assert.equal(decide({pickup24h:2,manualHoldUntil:'2026-11-06T12:00:00Z',holdKind:'soft'}).direction,'increase');
});
test('budgets, cooldowns, campaign depth and cancellation protection remain effective',()=>{
 for(const patch of [{markdownsToday:4},{movedDownTodayEur:6},{lastDecreaseAt:'2026-11-05T11:00:00Z'},{lastCancellationAt:'2026-11-05T11:30:00Z'},{lastDirection:'increase',lastDecisionAt:'2026-11-05T11:00:00Z'},{recentPeakPrice:250,campaignStartPrice:250}])
 assert.equal(decide(patch).direction,'hold',JSON.stringify(patch));
 assert.equal(decide({daysOut:2,lastCancellationAt:'2026-11-05T09:00:00Z'}).direction,'decrease');
});
test('multiple final-week reductions stay inside one date daily euro cap',()=>{
 const d=decide({daysOut:4,markdownsToday:2,movedDownTodayEur:8,lastDecreaseAt:'2026-11-05T05:00:00Z'});
 assert.equal(d.direction,'decrease');assert.equal(d.movement,-2);
});
test('no-pickup waits and far-date reduction frequency prevent hourly churn',()=>{
 assert.equal(decide({daysOut:90,hoursSinceLastPickup:10}).direction,'hold');
 assert.equal(decide({daysOut:90,lastDecreaseAt:'2026-11-04T15:00:00Z'}).direction,'hold');
 assert.equal(decide({daysOut:90,hoursSinceLastPickup:48}).movement,-2);
});
test('thin or stale competitor samples cannot trigger market tests',()=>{
 const base={daysOut:35,occupancyPct:64,roomsRemaining:8,currentPrice:220};
 for(const market of [{median:150,sampleSize:1,ageHours:1},{median:150,sampleSize:4,ageHours:90}])
 assert.equal(decide({...base,market}).direction,'hold');
 assert.equal(decide({...base,market:{median:150,sampleSize:4,ageHours:1}}).direction,'decrease');
});
