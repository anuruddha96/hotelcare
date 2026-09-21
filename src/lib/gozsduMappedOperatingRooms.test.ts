import { describe, expect, it, vi } from 'vitest';
import { reconcileGozsduOperatingRooms } from './gozsduMappedOperatingRooms';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

const rooms = [
  { id: 'a', hotel: 'gozsdu-court', room_number: '16' },
  { id: 'b', hotel: 'gozsdu-court', room_number: '43' },
  { id: 'c', hotel: 'gozsdu-court', room_number: '99' },
];
const registry = [
  { room_id: 'a', pms_room_name: '1BBALC-B16', service_status: 'operating' },
  { room_id: 'b', pms_room_name: '1B-C43', service_status: 'operating' },
  { room_id: 'c', pms_room_name: 'PRIVATE-99', service_status: 'non_guest' },
];
const sections = [
  { id: 'kazb', name: 'Kazinczy B', is_active: true },
  { id: 'kazc', name: 'Kazinczy C', is_active: true },
  { id: 'private', name: 'Private Apartment', is_active: true },
];
const mappings = [
  { room_id: 'a', section_id: 'kazb' },
  { room_id: 'b', section_id: 'kazc' },
  { room_id: 'c', section_id: 'private' },
];

describe('Gozsdu Team View maintenance inventory', () => {
  it('uses mapped physical building labels, preserves PMS room names and excludes private units', () => {
    const result = reconcileGozsduOperatingRooms(rooms, registry, sections, mappings);
    expect(result).toHaveLength(2);
    expect(result.map(room => room.room_number).sort()).toEqual(['16', '43']);
    expect(result.find(room => room.room_number === '16')?.label).toBe('1BBALC-B16 · Kazinczy B');
    expect(result.find(room => room.room_number === '43')?.label).toBe('1B-C43 · Kazinczy C');
  });

  it('fails closed rather than showing rooms when a Team View mapping is missing', () => {
    expect(() => reconcileGozsduOperatingRooms(rooms, registry, sections, mappings.slice(1))).toThrow(/incomplete/);
  });

  it('rejects a discrepancy between active inventory and an unavailable section', () => {
    const conflicting = mappings.map(mapping => mapping.room_id === 'a' ? { ...mapping, section_id: 'private' } : mapping);
    expect(() => reconcileGozsduOperatingRooms(rooms, registry, sections, conflicting)).toThrow(/disagree/);
  });

  it('never deduplicates ambiguous ticket room numbers across PMS apartments', () => {
    const duplicate = rooms.map(room => room.id === 'b' ? { ...room, room_number: '16' } : room);
    expect(() => reconcileGozsduOperatingRooms(duplicate, registry, sections, mappings)).toThrow(/ambiguous/);
  });

  it('rejects inaccessible or inactive mapped sections', () => {
    const inactive = sections.map(section => section.id === 'kazb' ? { ...section, is_active: false } : section);
    expect(() => reconcileGozsduOperatingRooms(rooms, registry, inactive, mappings)).toThrow(/unmapped/);
  });
});
