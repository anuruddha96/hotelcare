import { describe, expect, it } from 'vitest';
import { validateGozsduMaintenanceMap } from './gozsduMaintenanceMapGuard';

const rooms = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const registry = [
  { room_id: 'a', pms_room_name: '1B-110', service_status: 'operating' },
  { room_id: 'b', pms_room_name: '2B-110', service_status: 'operating' },
  { room_id: 'c', pms_room_name: 'ST-603', service_status: 'not_operating' },
];
const sections = [{ id: 's1', name: 'Kazinczy B' }, { id: 's2', name: 'Holló 12' }, { id: 's3', name: 'Not available' }];
const mappings = [{ room_id: 'a', section_id: 's1' }, { room_id: 'b', section_id: 's2' }, { room_id: 'c', section_id: 's3' }];

describe('Gozsdu authorized maintenance map integrity', () => {
  it('accepts repeat local numbers when full PMS names and UUID mappings are unique', () => {
    expect(() => validateGozsduMaintenanceMap(rooms, registry, sections, mappings)).not.toThrow();
  });
  it('fails closed if the registry, physical mapping or active section is missing', () => {
    expect(() => validateGozsduMaintenanceMap(rooms, registry.slice(1), sections, mappings)).toThrow(/incomplete/);
    expect(() => validateGozsduMaintenanceMap(rooms, registry, sections, mappings.slice(1))).toThrow(/incomplete/);
    expect(() => validateGozsduMaintenanceMap(rooms, registry, sections.slice(1), mappings)).toThrow(/section/);
  });
  it('fails closed on inconsistent service status and unavailable physical section', () => {
    expect(() => validateGozsduMaintenanceMap(rooms, registry.map(row => row.room_id === 'a' ? { ...row, service_status: 'not_operating' } : row), sections, mappings)).toThrow(/disagrees/);
    expect(() => validateGozsduMaintenanceMap(rooms, registry, sections, mappings.map(row => row.room_id === 'a' ? { ...row, section_id: 's3' } : row))).toThrow(/disagrees/);
  });
  it('fails closed on duplicate rooms or mapped room IDs', () => {
    expect(() => validateGozsduMaintenanceMap([...rooms, rooms[0]], registry, sections, mappings)).toThrow(/Duplicate/);
    expect(() => validateGozsduMaintenanceMap(rooms, registry, sections, [...mappings, mappings[0]])).toThrow(/incomplete/);
  });
});
