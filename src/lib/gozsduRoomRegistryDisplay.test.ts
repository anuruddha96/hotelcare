import { describe, expect, it } from 'vitest';
import { buildGozsduRoomRegistryIndex } from './gozsduRoomRegistryDisplay';

const rooms = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const registry = [
  { room_id: 'a', pms_room_name: '1B-C13', service_status: 'operating' },
  { room_id: 'b', pms_room_name: '1B-C33', service_status: 'operating' },
  { room_id: 'c', pms_room_name: '2B-3/T/6', service_status: 'unavailable' },
];

describe('Gozsdu full-name display uses only stable registry room IDs', () => {
  it('restores the whole authoritative PMS label including suffixes for inactive rooms', () => {
    const index = buildGozsduRoomRegistryIndex(rooms, registry);
    expect(index.get('a')?.pms_room_name).toBe('1B-C13');
    expect(index.get('b')?.pms_room_name).toBe('1B-C33');
    expect(index.get('c')).toEqual(registry[2]);
  });
  it('refuses a missing label rather than displaying a misleading numeric fragment', () => {
    expect(() => buildGozsduRoomRegistryIndex(rooms, registry.slice(0, 2))).toThrow(/cannot be verified/);
  });
  it('rejects duplicate PMS names and extra/unknown room IDs', () => {
    expect(() => buildGozsduRoomRegistryIndex(rooms, [registry[0], { ...registry[1], pms_room_name: '1b-c13' }, registry[2]])).toThrow(/duplicate/);
    expect(() => buildGozsduRoomRegistryIndex(rooms, [registry[0], { ...registry[1], room_id: 'other' }, registry[2]])).toThrow(/unknown/);
  });
  it('rejects blank PMS room names', () => {
    expect(() => buildGozsduRoomRegistryIndex(rooms, [registry[0], { ...registry[1], pms_room_name: ' ' }, registry[2]])).toThrow(/missing/);
  });
});
