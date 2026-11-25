import {describe,it,expect} from 'vitest';
import { findPmsRoomBucketDrift } from '../../supabase/functions/_shared/pmsRoomBucketPostcondition';
const base={id:'103',is_checkout_room:false,pms_metadata:{
 scheduledDepartureToday:false,checkedOutToday:false,
}};
describe('PMS full refresh postcondition',()=>{
 it('detects the misleading stayover-to-checkout promotion',()=>{
  expect(findPmsRoomBucketDrift([base],[{...base,is_checkout_room:true}],
    '2026-10-09T04:20:00Z')).toEqual(['103']);
 });
 it('detects stale scheduled departure badges even when row boolean is unchanged',()=>{
  expect(findPmsRoomBucketDrift([base],[{...base,pms_metadata:{scheduledDepartureToday:true}}],
    '2026-10-09T04:20:00Z')).toEqual(['103']);
 });
 it('accepts unchanged authoritative room states',()=>{
  expect(findPmsRoomBucketDrift([base],[base],'2026-10-09T04:20:00Z')).toEqual([]);
 });
 it('preserves a manager change made during the running refresh',()=>{
  const changed={...base,is_checkout_room:true,pms_metadata:{
   manual_moved_at:'2026-10-09T04:20:30Z',scheduledDepartureToday:true,
  }};
  expect(findPmsRoomBucketDrift([base],[changed],'2026-10-09T04:20:00Z')).toEqual([]);
 });
 it('accepts newly verified physical checkout after the snapshot',()=>{
  const checked={...base,is_checkout_room:true,pms_metadata:{
   checkedOutToday:true,checkedOutAt:'2026-10-09T04:20:30Z',scheduledDepartureToday:true,
  }};
  expect(findPmsRoomBucketDrift([base],[checked],'2026-10-09T04:20:00Z')).toEqual([]);
 });
});
