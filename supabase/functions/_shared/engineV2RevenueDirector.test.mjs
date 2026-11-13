import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedHighImpactEvent, decideRevenueDirector, committedMovement, sameDayMarkdownStep } from './engineV2RevenueDirector.ts';
import { DEFAULT_DECISION_SETTINGS } from './engineV2Core.ts';
const settings = {
 ...DEFAULT_DECISION_SETTINGS, now:new Date('2026-11-05T12:00:00Z'),minMovementEur:1,
 directionChangeHours:3, maxMarkdownsPerDay:4, maxMarkdownDepthPct:25, rebookWindowHours:12, bookedDateBrakeHours:12,
 fill:{enabled:true,windowDays:120,maxTotalDropPct:25},
 windowRules:[
 {id:'w0_2',min_days_out:0,max_days_out:2,max_daily_decrease:12,max_daily_increase:12,no_pickup_wait_hours:2,min_hours_between_decreases:2,require_above_anchor:false},
 {id:'w3_7',min_days_out:3,max_days_out:7,max_daily_decrease:10,max_daily_increase:15,no_pickup_wait_hours:3,min_hours_between_decreases:3,require_above_anchor:false},
 {id:'w8_30',min_days_out:8,max_days_out:30,max_daily_decrease:8,max_daily_increase:18,no_pickup_wait_hours:4,min_hours_between_decreases:3,require_above_anchor:false},
 {id:'w31_90',min_days_out:31,max_days_out:120,max_daily_decrease:6,max_daily_increase:22,no_pickup_wait_hours:6,min_hours_between_decreases:3,require_above_anchor:false}],
 paceBands:[{min_days_out:0,max_days_out:7,target_occupancy_pct:100},{min_days_out:8,max_days_out:14,target_occupancy_pct:90},{min_days_out:15,max_days_out:30,target_occupancy_pct:80},{min_days_out:31,max_days_out:60,target_occupancy_pct:65},{min_days_out:61,max_days_out:120,target_occupancy_pct:45}]
};
const context={targetAdr:140,minimumAdr:130,projectedAdr:155,requiredRemainingAdr:150,netRateFactor:.8,confirmedHighEvent:false};
const input=(patch={})=>({stayDate:'2026-11-15',daysOut:10,currentPrice:185,occupancyPct:30,roomsSold:6,roomsRemaining:15,pickup1h:0,pickup6h:0,pickup24h:0,pickup48h:0,pickup7d:0,cancellations24h:0,hoursSinceLastPickup:80,lastCancellationAt:null,lastDirection:null,lastDecisionAt:null,lastDecreaseAt:null,movedUpTodayEur:0,movedDownTodayEur:0,manualHoldUntil:null,holdKind:null,minPrice:80,maxPrice:600,adrFloor:220,hardAdrFloor:220,monthFloor:220,monthMarkdownsFrozen:true,anchorPrice:160,crossed60Occupancy:false,pendingEventUplift:0,market:{median:null,sampleSize:0,ageHours:null},campaignStartPrice:185,recentPeakPrice:185,markdownsToday:0,...patch});
const decide=(patch={},ctx={})=>decideRevenueDirector(input({...(patch.pickup24h>0?{hoursSinceLastPickup:1}:{}),...patch}),settings,{...context,...ctx});
test('only committed movements consume budgets and cooldowns',()=>{
 for(const status of ['held','shadow','superseded','failed'])assert.equal(committedMovement({status,direction:'decrease',movement:-6}),false);
 for(const status of ['queued','accepted','confirmed','published','partial'])assert.equal(committedMovement({status,direction:'decrease',movement:-6}),true);
});
test('unprotected final-week rooms sell down; high occupancy is protected',()=>{
 for(const daysOut of [0,1,4,7]) {
 assert.equal(decide({daysOut,roomsRemaining:5,occupancyPct:71.4}).direction,'decrease');
 assert.equal(decide({daysOut,roomsRemaining:1,occupancyPct:95.2,observedPickup6h:2}).direction,'hold');
 }
});
test('last four days can sell a quiet final room, while fresh demand and real events protect it',()=>{
 for (const daysOut of [0,1,2,3]) {
  assert.equal(decide({daysOut,roomsRemaining:1,occupancyPct:95.2,hoursSinceLastPickup:8}).movement, daysOut===0 ? -2 : -1);
  assert.equal(decide({daysOut,roomsRemaining:1,occupancyPct:95.2,hoursSinceLastPickup:2}).direction,'hold');
  assert.equal(decide({daysOut,roomsRemaining:1,occupancyPct:95.2,hoursSinceLastPickup:8},{confirmedHighEvent:true}).direction,'hold');
 }
 assert.equal(decide({daysOut:4,roomsRemaining:1,occupancyPct:95.2,hoursSinceLastPickup:8}).direction,'hold');
});
test('same-day genuine pickup holds instead of discounting a converting offer',()=>{
 assert.equal(decide({daysOut:0,occupancyPct:95.2,roomsRemaining:1,pickup24h:1,pickup6h:1,hoursSinceLastPickup:0.2}).direction,'hold');
});
test('one soft-date conversion earns a small uplift, fast pickup earns more',()=>{
 assert.equal(decide({pickup24h:1,pickup6h:1}).movement,2);
 assert.ok(decide({pickup24h:3,pickup6h:3}).movement>2);
 assert.equal(decide({daysOut:2,pickup24h:1,pickup6h:1}).movement,1);
});
test('single-booking uplift cap applies even at high occupancy',()=>{
 assert.equal(decide({daysOut:0,occupancyPct:90.5,roomsRemaining:2,pickup24h:1,pickup6h:1}).direction,'hold');
 assert.equal(decide({daysOut:40,occupancyPct:90.5,roomsRemaining:2,pickup24h:1,pickup6h:1}).movement,2);
 assert.equal(decide({daysOut:0,occupancyPct:90.5,roomsRemaining:2,pickup24h:3,pickup6h:3}).direction,'hold');
});
test('consumed pickup cannot repeat an increase, while booked-price brake prevents immediate cut',()=>{
 const d=decide({pickup24h:0,pickup6h:0,hoursSinceLastPickup:1,lastDirection:'increase',lastDecisionAt:'2026-11-05T11:00:00Z',movedUpTodayEur:2});
 assert.equal(d.direction,'hold');
});
test('only organizer, venue, or human-curated high events receive event-only protection',()=>{
 const base={expected_impact:'high',confidence:.9,approved:true,source:'ai'};
 assert.equal(confirmedHighImpactEvent({...base,url:'https://budapestarena.hu/events/manowar-world-tour-2027/'}),true);
 assert.equal(confirmedHighImpactEvent({...base,url:'https://www.livenation.hu/en/tickets/wwe-road-to-royal-rumble'}),true);
 assert.equal(confirmedHighImpactEvent({...base,source:'manual',url:'https://www.iata.org/en/events/slot-conference/'}),true);
 assert.equal(confirmedHighImpactEvent({...base,url:'https://touristoffice.org/budapest-events/'}),false);
 assert.equal(confirmedHighImpactEvent({...base,url:'https://www.eventworld.com/budapest/concerts/november'}),false);
 assert.equal(confirmedHighImpactEvent({...base,url:'https://stayhappening.com/e/salsa-festival'}),false);
 assert.equal(confirmedHighImpactEvent({...base,expected_impact:'medium',url:'https://hungexpo.hu/en/events/'}),false);
 assert.equal(confirmedHighImpactEvent({...base,url:null}),false);
});
test('static occupancy and events cannot ratchet prices upward without fresh pickup',()=>{
 for(const currentPrice of [150,160,192,300]) {
 assert.equal(decide({daysOut:70,occupancyPct:60,roomsRemaining:8,currentPrice}).direction,'hold');
 assert.equal(decide({daysOut:60,currentPrice},{confirmedHighEvent:true}).direction,'hold');
 }
 assert.equal(decide({daysOut:4,currentPrice:160},{confirmedHighEvent:true}).direction,'hold');
});
test('January weekends and full February are included in the rolling plan',()=>{
 for(const [stayDate,daysOut] of [['2027-01-01',57],['2027-01-02',58],['2027-02-28',115]])
 assert.equal(decide({stayDate,daysOut,occupancyPct:0,roomsRemaining:21}).direction,'decrease');
});
test('poor portfolio ADR and seasonal anchor do not freeze quiet soft dates',()=>{
 assert.equal(decide({currentPrice:180},{projectedAdr:120,requiredRemainingAdr:200}).direction,'decrease');
 assert.equal(decide({currentPrice:144}).direction,'decrease');
});
test('freshness, bounds, sold-out inventory, manual locks and edit holds stay authoritative',()=>{
 for(const patch of [{dataStale:true},{minPrice:null},{maxPrice:50},{roomsRemaining:0,occupancyPct:100},{manualHoldUntil:'2026-11-06T12:00:00Z',holdKind:'hard'},{manualHoldUntil:'2026-11-06T12:00:00Z',holdKind:'soft'}])
 assert.equal(decide(patch).direction,'hold',JSON.stringify(patch));
 assert.equal(decide({pickup24h:2,manualHoldUntil:'2026-11-06T12:00:00Z',holdKind:'soft'}).direction,'increase');
});
test('budgets, cooldowns, campaign depth and cancellation protection remain effective',()=>{
 for(const patch of [{markdownsToday:4},{movedDownTodayEur:8},{lastDecreaseAt:'2026-11-05T11:00:00Z'},{lastCancellationAt:'2026-11-05T11:30:00Z'},{lastDirection:'increase',lastDecisionAt:'2026-11-05T11:00:00Z'},{recentPeakPrice:250,campaignStartPrice:250}])
 assert.equal(decide(patch).direction,'hold',JSON.stringify(patch));
 assert.equal(decide({daysOut:2,lastCancellationAt:'2026-11-05T09:00:00Z'}).direction,'decrease');
});
test('multiple final-week reductions stay inside one date daily euro cap',()=>{
 const d=decide({daysOut:4,markdownsToday:2,movedDownTodayEur:8,lastDecreaseAt:'2026-11-05T05:00:00Z'});
 assert.equal(d.direction,'decrease');assert.equal(d.movement,-2);
});
test('audit detail reports the applied reduction after the daily cap clips the request',()=>{
 const d=decide({daysOut:90,movedDownTodayEur:5,hoursSinceLastPickup:48});
 assert.equal(d.movement,-1);
 assert.match(d.reasonDetail,/Test a lower offer by €1/);
 assert.doesNotMatch(d.reasonDetail,/Test a lower offer by €2/);
});
test('no-pickup waits and far-date reduction frequency prevent hourly churn',()=>{
 assert.equal(decide({daysOut:90,hoursSinceLastPickup:5}).direction,'hold');
 assert.equal(decide({daysOut:90,lastDecreaseAt:'2026-11-05T10:00:00Z'}).direction,'hold');
 assert.equal(decide({daysOut:90,hoursSinceLastPickup:48}).movement,-2);
});
test('quiet soft dates reduce without requiring fresh competitor data or a pace deficit',()=>{
 const base={daysOut:35,occupancyPct:64,roomsRemaining:8,currentPrice:220};
 for(const market of [{median:null,sampleSize:0,ageHours:null},{median:150,sampleSize:1,ageHours:1},{median:150,sampleSize:4,ageHours:90}])
 assert.equal(decide({...base,market}).direction,'decrease');
});
test('a booking can raise, then a genuinely quiet interval can lower on the same local day',()=>{
 const rise=decide({pickup24h:1,pickup6h:1,unspentPickupInQuietWindow:1});
 assert.equal(rise.direction,'increase');
 const lower=decide({currentPrice:rise.targetPrice,pickup24h:0,pickup6h:0,observedPickup6h:1,hoursSinceLastPickup:5,lastDirection:'increase',lastDecisionAt:'2026-11-05T07:00:00Z',movedUpTodayEur:rise.movement});
 assert.equal(lower.direction,'decrease',JSON.stringify(lower));
 assert.match(lower.reasonDetail,/No booking for 5h/);
 assert.equal(decide({currentPrice:rise.targetPrice,pickup24h:0,pickup6h:0,hoursSinceLastPickup:1,lastDirection:'increase',lastDecisionAt:'2026-11-05T11:00:00Z',movedUpTodayEur:rise.movement}).direction,'hold');
});
test('quiet reduction can repeat after spacing, then fresh pickup can reverse it upward',()=>{
 const first=decide({daysOut:80,occupancyPct:0}); assert.equal(first.direction,'decrease');
 const second=decide({daysOut:80,occupancyPct:0,currentPrice:first.targetPrice,lastDirection:'decrease',lastDecisionAt:'2026-11-05T08:00:00Z',lastDecreaseAt:'2026-11-05T08:00:00Z',movedDownTodayEur:2,markdownsToday:1});
 assert.equal(second.direction,'decrease');
 const rise=decide({daysOut:80,occupancyPct:0,currentPrice:second.targetPrice,pickup24h:1,pickup6h:1,unspentPickupInQuietWindow:1,lastDirection:'decrease',lastDecisionAt:'2026-11-05T11:30:00Z',lastDecreaseAt:'2026-11-05T11:30:00Z',movedDownTodayEur:4,markdownsToday:2});
 assert.equal(rise.direction,'increase');
});
test('consumed bookings still protect genuinely strong recent pickup',()=>{
 const d=decide({daysOut:40,pickup24h:0,pickup6h:0,observedPickup6h:3,hoursSinceLastPickup:3});
 assert.equal(d.direction,'hold'); assert.equal(d.reason,'recent_pickup_protected');
});
test('old unconsumed pickup cannot cause a late increase when the offer is now quiet',()=>{
 const d=decide({daysOut:40,pickup24h:1,pickup6h:0,unspentPickupInQuietWindow:0,hoursSinceLastPickup:10});
 assert.equal(d.direction,'decrease');
});
test('quiet soft dates still respect the absolute hotel floor',()=>{
 assert.equal(decide({currentPrice:80,minPrice:80}).direction,'hold');
});

test('same-day step becomes more aggressive as the Budapest day advances',()=>{
 assert.equal(sameDayMarkdownStep(9*60,1),2);
 assert.equal(sameDayMarkdownStep(14*60+59,5),3);
 assert.equal(sameDayMarkdownStep(15*60,1),4);
 assert.equal(sameDayMarkdownStep(17*60,5),5);
 assert.equal(sameDayMarkdownStep(18*60,1),5);
 assert.equal(sameDayMarkdownStep(18*60,4),6);
});
test('same-day hourly markdown is €2 before 15h, €5 after 18h and respects a €75 floor',()=>{
 const today={daysOut:0,stayDate:'2026-11-05',roomsRemaining:1,occupancyPct:95.2,currentPrice:199,minPrice:75,hoursSinceLastPickup:25,observedPickup6h:0};
 assert.equal(decide(today).movement,-2);
 const late={...settings,now:new Date('2026-11-05T18:30:00Z')}; // 19:30 Budapest
 assert.equal(decideRevenueDirector(input({...today,currentPrice:81}),late,context).movement,-5);
 assert.equal(decideRevenueDirector(input({...today,currentPrice:76}),late,context).movement,-1);
 assert.equal(decideRevenueDirector(input({...today,currentPrice:75}),late,context).direction,'hold');
});
test('one hour minimum between same-day markdowns, manager hold and stale data still block',()=>{
 const today={daysOut:0,roomsRemaining:4,currentPrice:200,minPrice:75,occupancyPct:80,hoursSinceLastPickup:25,observedPickup6h:0};
 assert.equal(decide({...today,lastDecreaseAt:'2026-11-05T11:30:00Z'}).direction,'hold');
 assert.equal(decide({...today,lastDecreaseAt:'2026-11-05T10:30:00Z'}).movement,-3);
 assert.equal(decide({...today,manualHoldUntil:'2026-11-06T12:00:00Z',holdKind:'soft'}).direction,'hold');
 assert.equal(decide({...today,dataStale:true}).direction,'hold');
});
