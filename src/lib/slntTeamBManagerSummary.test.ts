import { describe, expect, it } from 'vitest';
import { groupSlntManagerRooms } from './slntTeamBManagerSummary';

const today='2026-10-22';
const base={room_id:'r1',assignment_id:null,assignment_status:null,supervisor_approved:false,is_checkout_room:false,is_optional:false,assigned_to:null,pms_metadata:{}};
describe('SLNT Team B manager progress (shared pool)',()=>{
  it('makes not started the pending count, not a misleading number of all rooms',()=>{
    const groups=groupSlntManagerRooms([base,{...base,room_id:'r2',assignment_id:'a2',assignment_status:'in_progress'},
      {...base,room_id:'r3',assignment_id:'a3',assignment_status:'completed'}],today);
    expect(groups.pending.map(x=>x.room_id)).toEqual(['r1']);
    expect(groups.working.map(x=>x.room_id)).toEqual(['r2']);
    expect(groups.done.map(x=>x.room_id)).toEqual(['r3']);
    expect(groups.awaiting.map(x=>x.room_id)).toEqual(['r3']);
  });
  it('does not count supervisor-approved rooms as awaiting approval',()=>{
    const groups=groupSlntManagerRooms([{...base,assignment_id:'a1',assignment_status:'completed',supervisor_approved:true}],today);
    expect(groups.approved).toHaveLength(1);
    expect(groups.awaiting).toHaveLength(0);
  });
  it('distinguishes waiting RTC, ready checkout, due and optional',()=>{
    const groups=groupSlntManagerRooms([
      {...base,is_checkout_room:true,pms_metadata:{pmsSyncDate:today,checkedOutToday:true}},
      {...base,room_id:'r2',is_checkout_room:true,pms_metadata:{pmsSyncDate:today,checkedOutToday:false}},
      {...base,room_id:'r3',is_optional:true},
      {...base,room_id:'r4'},
    ],today);
    expect(groups.ready).toHaveLength(1);
    expect(groups.waiting).toHaveLength(1);
    expect(groups.optional).toHaveLength(1);
    expect(groups.due).toHaveLength(1);
  });
});
