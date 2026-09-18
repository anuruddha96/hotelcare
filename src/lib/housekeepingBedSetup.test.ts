import { describe, expect, it } from 'vitest';
import { displayHousekeepingBedSetup, housekeepingBedShortCode } from './housekeepingBedSetup';

describe('displayHousekeepingBedSetup', () => {
  it('uses BT instead of TW for together beds and their old aliases', () => {
    for (const value of ['Twin Beds Together', 'Beds Together', 'Twin Beds']) {
      expect(displayHousekeepingBedSetup(value)).toBe('BT · Beds together');
    }
  });

  it('consolidates old separate beds and single beds as SB', () => {
    for (const value of ['Single Bed', 'Single Beds', 'Twin Beds Separated', 'Beds Separated', 'Separate Beds']) {
      expect(displayHousekeepingBedSetup(value)).toBe('SB · Single beds');
    }
  });

  it('distinguishes adding and removing a baby bed', () => {
    expect(displayHousekeepingBedSetup('Baby Bed')).toBe('Baby bed');
    expect(displayHousekeepingBedSetup('Remove Baby Bed')).toBe('Remove baby bed');
    expect(displayHousekeepingBedSetup('Baby Bed Out')).toBe('Remove baby bed');
  });

  it('preserves unrelated custom setup instructions and empty values', () => {
    expect(displayHousekeepingBedSetup(' Custom bunk setup ')).toBe('Custom bunk setup');
    expect(displayHousekeepingBedSetup(null)).toBeNull();
    expect(displayHousekeepingBedSetup('')).toBeNull();
  });
});

describe('housekeepingBedShortCode across all room chips', () => {
  it('shows BT for old twin values and SB for separated / single beds', () => {
    expect(housekeepingBedShortCode('Twin Beds Together')).toBe('BT');
    expect(housekeepingBedShortCode('Twin Beds')).toBe('BT');
    expect(housekeepingBedShortCode('Twin Beds Separated')).toBe('SB');
    expect(housekeepingBedShortCode('Single Bed')).toBe('SB');
    expect(housekeepingBedShortCode('Sofa Bed')).toBeNull();
  });
});
