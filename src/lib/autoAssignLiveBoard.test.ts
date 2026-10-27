import { describe, expect, it } from 'vitest';
import { buildMemoriesHistoricalPreferences, getLiveRoomDisplayStatus, isProtectedLiveAssignment, stableAssignmentSeed } from './autoAssignLiveBoard';
import type { RoomForAssignment } from './roomAssignmentAlgorithm';

const room = (id: string, number: string, section?: string): RoomForAssignment => ({
  id, room_number: number, hotel: 'Hotel Memories Budapest', floor_number: 1,
  room_size_sqm: 25, room_capacity: 2, is_checkout_room: false, status: 'clean',
  housekeeping_section_id: section || null,
});

describe('live Auto Assign board', () => {
  it('keeps distinct approval, cleaning and done states', () => {
    expect(getLiveRoomDisplayStatus({room_id:'a',assigned_to:'x',status:'completed',supervisor_approved:true})).toBe('done');
    expect(getLiveRoomDisplayStatus({room_id:'a',assigned_to:'x',status:'completed',supervisor_approved:false})).toBe('pending_approval');
    expect(getLiveRoomDisplayStatus({room_id:'a',assigned_to:'x',status:'in_progress'})).toBe('cleaning');
    expect(getLiveRoomDisplayStatus({room_id:'a',assigned_to:'x',status:'assigned'})).toBe('assigned');
  });
  it('protects ongoing and completed work from reassignment', () => {
    expect(isProtectedLiveAssignment('completed')).toBe(true);
    expect(isProtectedLiveAssignment('in_progress')).toBe(true);
    expect(isProtectedLiveAssignment('dnd_pending_retry')).toBe(true);
    expect(isProtectedLiveAssignment('assigned')).toBe(false);
  });
  it('learns section proximity from finished historical assignments without other hotel or staff leakage', () => {
    const rooms=[room('r1','101','s1'),room('r2','102','s1'),room('r3','203','s2')];
    const history=Array.from({length:8},(_,i)=>({
      room_id: i%2 ? 'r1':'r2',assigned_to:'hk1', assignment_date:`2026-10-${String(i+1).padStart(2,'0')}`
    }));
    history.push({room_id:'r3',assigned_to:'other',assignment_date:'2026-10-09'});
    const result=buildMemoriesHistoricalPreferences(history,rooms,new Set(['hk1']));
    expect(result.sampleCount).toBe(8);
    expect(result.preferences.hk1[0]).toBe('section-s1');
    expect(result.preferences.other).toBeUndefined();
  });
  it('does not reshuffle with an unchanged date, staff pool and room set', () => {
    const a=stableAssignmentSeed('Memories','2026-10-27','rebalance',['b','a'],['101','102']);
    const b=stableAssignmentSeed('Memories','2026-10-27','rebalance',['a','b'],['102','101']);
    expect(a).toBe(b);
    expect(stableAssignmentSeed('Memories','2026-10-28','rebalance',['a','b'],['101','102'])).not.toBe(a);
  });
});
