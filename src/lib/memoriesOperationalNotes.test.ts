import { describe, expect, it } from 'vitest';
import { cleanMemoriesOperationalNotes, getMemoriesRoomBoardNote, isMemoriesFinalOccupiedNight } from './memoriesOperationalNotes';

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

describe('HMB room-board note indicator matches popup', () => {
  const generated = 'Previous guest bed setup: Twin Beds Together — reset to standard room setup.';
  const meta = { previousGuestBedSetup: { note: generated } };

  it('hides generated-only notes, so the room icon does not imply a visible note', () => {
    expect(getMemoriesRoomBoardNote(generated, meta)).toBe('');
  });

  it('preserves precise manager notes beside an automated instruction', () => {
    expect(getMemoriesRoomBoardNote('Single Beds\n' + generated, meta)).toBe('Single Beds');
  });

  it('keeps real bed and guest instructions', () => {
    expect(getMemoriesRoomBoardNote('baby bed', {})).toBe('baby bed');
    expect(getMemoriesRoomBoardNote('Baby Cot', {})).toBe('Baby Cot');
  });

  it('does not mistake an operational service marker for a manually entered note', () => {
    expect(getMemoriesRoomBoardNote('[ROOM_CLEANING]\n' + generated, meta)).toBe('');
    expect(getMemoriesRoomBoardNote('[COLLECT_EXTRA_TOWELS]', {})).toBe('');
  });

  it('does not strip notes when provenance is absent', () => {
    expect(getMemoriesRoomBoardNote(generated, null)).toBe(generated);
  });
});
