import { describe, expect, it } from 'vitest';
import { canAssignSlntRoom, getSlntRoomChipMode } from './slntRoomChipBehavior';

describe('SLNT room chip behavior', () => {
  it('opens management for an assigned SLNT unit', () => {
    expect(getSlntRoomChipMode({
      isSlntTenant: true,
      assignedTo: 'hk-1',
      roomStatus: 'dirty',
    })).toBe('manage');
  });

  it('keeps a normal unassigned SLNT unit in assignment mode', () => {
    expect(getSlntRoomChipMode({
      isSlntTenant: true,
      assignedTo: null,
      roomStatus: 'dirty',
    })).toBe('assign');
  });

  it('makes an Out of Service SLNT unit manageable but never assignable', () => {
    expect(getSlntRoomChipMode({
      isSlntTenant: true,
      assignedTo: null,
      roomStatus: 'out_of_order',
    })).toBe('manage');
    expect(canAssignSlntRoom(true, 'out_of_order')).toBe(false);
  });

  it('does not impose the SLNT lock on another tenant', () => {
    expect(canAssignSlntRoom(false, 'out_of_order')).toBe(true);
    expect(getSlntRoomChipMode({
      isSlntTenant: false,
      assignedTo: 'hk-1',
      roomStatus: 'out_of_order',
    })).toBe('assign');
  });
});
