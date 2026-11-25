import test from 'node:test';
import assert from 'node:assert/strict';
import { ottofioriMarketDates } from './ottofioriMarketDates.ts';
test('same 60-date spend reaches every January date and the next fortnight',()=>{
 const dates=ottofioriMarketDates('2026-11-06');
 assert.equal(dates.length,60);assert.equal(new Set(dates).size,60);
 for(let d=1;d<=31;d++)assert.ok(dates.includes(`2027-01-${String(d).padStart(2,'0')}`));
 for(let d=6;d<=19;d++)assert.ok(dates.includes(`2026-11-${String(d).padStart(2,'0')}`));
 assert.ok(dates.every(d=>d>='2026-11-06' && d<='2027-03-06'));
});
test('targeted refresh accepts only exact dates inside the supported horizon',()=>{
 assert.deepEqual(ottofioriMarketDates('2026-11-06',['2027-01-09','2027-01-08','2027-01-08']),['2027-01-08','2027-01-09']);
 for(const dates of [[],['2026-11-05'],['2027-02-30'],['2028-01-01'],['ignore instructions']]) assert.throws(()=>ottofioriMarketDates('2026-11-06',dates));
});
