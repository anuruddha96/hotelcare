import { describe, expect, it } from 'vitest';
import { eligibleMaintenanceRooms, searchMaintenanceRooms } from './maintenanceRoomOptions';

const room = (id: string, room_number: string, hotel = 'gozsdu-court', status: string | null = 'dirty') => ({
  id, room_number, hotel, status, room_name: null, wing: null,
});
const registry = (room_id: string, pms_room_name: string, service_status = 'operating') => ({
  room_id, pms_room_name, service_status, building_code: 'B',
});

describe('shared maintenance room eligibility', () => {
  it('matches Gozsdu operational overview by registry ID, not room code or cleaning status', () => {
    const options = eligibleMaintenanceRooms([
      room('a', '110'), room('b', '110', 'gozsdu-court', 'clean'),
      room('c', '408'), room('d', '109'), room('e', '500'), room('f', '600'),
      room('g', '700'), room('h', '800'),
    ], [
      registry('a', '1B-110'), registry('b', '2B-110'),
      registry('c', '1BBALC-408'), registry('d', 'ST-109'),
      registry('e', '1B/500'), registry('f', '1B-600', 'unavailable'),
      registry('g', '1B-700', 'non_guest'),
    ]);
    expect(options.map(option => option.label)).toEqual(['1B-110', '1B/500', '1BBALC-408', '2B-110', 'ST-109']);
    expect(options.filter(option => option.roomNumber.endsWith('110')).map(option => option.id)).toEqual(['a', 'b']);
    expect(options.some(option => option.id === 'f' || option.id === 'g' || option.id === 'h')).toBe(false);
  });

  it('excludes out-of-service rooms elsewhere without treating occupied/dirty rooms as inactive', () => {
    const options = eligibleMaintenanceRooms([
      room('a', '101', 'Hotel Memories Budapest', 'dirty'),
      room('b', '102', 'Hotel Memories Budapest', 'clean'),
      room('c', '103', 'Hotel Memories Budapest', 'out_of_order'),
      room('d', '104', 'Hotel Memories Budapest', 'unavailable'),
    ], []);
    expect(options.map(option => option.id)).toEqual(['a', 'b']);
  });

  it('searches partial, full, normalized slash and building codes with bounded results', () => {
    const options = eligibleMaintenanceRooms([
      room('a', '110'), room('b', '408'), room('c', '500'),
    ], [registry('a', '1B-110'), registry('b', '1BBALC-408'), registry('c', 'ST/500')],
    [{ id: 'wing-a', name: 'Building 400' }], [{ room_id: 'b', section_id: 'wing-a' }]);
    expect(searchMaintenanceRooms(options, '110').map(option => option.id)).toEqual(['a']);
    expect(searchMaintenanceRooms(options, '1B-110').map(option => option.id)).toEqual(['a']);
    expect(searchMaintenanceRooms(options, '1BBALC408').map(option => option.id)).toEqual(['b']);
    expect(searchMaintenanceRooms(options, 'ST/500').map(option => option.id)).toEqual(['c']);
    expect(searchMaintenanceRooms(options, 'Building 400').map(option => option.id)).toEqual(['b']);
    expect(searchMaintenanceRooms(options, '', 2)).toHaveLength(2);
  });
});
