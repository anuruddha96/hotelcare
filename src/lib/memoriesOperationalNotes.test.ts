import { describe, expect, it } from 'vitest';
import { cleanMemoriesOperationalNotes, isMemoriesFinalOccupiedNight } from './memoriesOperationalNotes';

describe('HMB operational note provenance', () => {
  const auto = 'Previous guest bed setup: Twin Beds Together — reset to standard room setup.';
  it('hides only the proven generated note and preserves manager instructions', () => {
    expect(cleanMemoriesOperationalNotes(
      auto + '\nManager: Please check the extra towels.',
      { previousGuestBedSetup: { note: auto } },
    )).toBe('Manager: Please check the extra towels.');
  });
  it('never silently strips an unproven manual note', () => {
    expect(cleanMemoriesOperationalNotes(auto, {})).toBe(auto);
  });
  it('preserves precise Previo guest instructions', () => {
    expect(cleanMemoriesOperationalNotes(
      'Please prepare a baby bed for the guest.',
      { noteInternal: 'Please prepare a baby bed for the guest.' },
    )).toBe('Please prepare a baby bed for the guest.');
  });
  it('keeps operational flag markers when removing generated text', () => {
    expect(cleanMemoriesOperationalNotes(
      '[ROOM_CLEANING]\n' + auto + '\nLeave towels at reception',
      { previousGuestBedSetup: { note: auto } },
    )).toBe('[ROOM_CLEANING]\nLeave towels at reception');
  });
});
describe('HMB final occupied night', () => {
  it('recognizes departure tomorrow with 6/6 and refuses 5/8', () => {
    expect(isMemoriesFinalOccupiedNight({ departureDate: '2026-10-21', currentNight: 6, totalNights: 6 }, '2026-10-20')).toBe(true);
    expect(isMemoriesFinalOccupiedNight({ departureDate: '2026-10-23', currentNight: 5, totalNights: 8 }, '2026-10-20')).toBe(false);
  });
  it('does not confuse a 2/2 extension segment with a 2/6 complete stay', () => {
    const stay = {
      pmsSyncDate: '2026-10-20', currentNight: 2, totalNights: 6,
      continuousStay: { currentNight: 2, totalNights: 2 },
    };
    expect(isMemoriesFinalOccupiedNight(stay, '2026-10-20')).toBe(false);
  });
  it('uses verified fresh 6/6 metadata if departure date is absent', () => {
    expect(isMemoriesFinalOccupiedNight({ pmsSyncDate: '2026-10-20', currentNight: 6, totalNights: 6 }, '2026-10-20')).toBe(true);
    expect(isMemoriesFinalOccupiedNight({ pmsSyncDate: '2026-10-19', currentNight: 6, totalNights: 6 }, '2026-10-20')).toBe(false);
  });
});
