import { describe, expect, it } from 'vitest';
import { slntTeamBRoomInstructions, type SlntRoomCardDetails } from './slntTeamBRoomPresentation';

const base: SlntRoomCardDetails = {
  room_number: 'K4 – Room 7', notes: null, pms_metadata: {},
  bed_configuration: null, assignment_notes: null,
  manager_instruction_text: null, planned_notes: [],
};

describe('SLNT Team B shared preview must preserve RD-style instructions', () => {
  it('exposes manual bed setup and all separate sources of housekeeping notes', () => {
    const instructions = slntTeamBRoomInstructions({
      ...base, bed_configuration: 'single beds',
      notes: '[ROOM_CLEANING] Housekeeping: Check the window',
      pms_metadata: { slntPrevioHousekeepingNote: 'Replace amenities' },
      assignment_notes: 'Check curtains',
      manager_instruction_text: 'Guest requested extra pillows',
      planned_notes: [{ instruction_type: 'towels', content: 'Provide two extra towels' }],
    });
    expect(instructions.bedInstruction).toBe('SB · Single beds');
    expect(instructions.roomCleaning).toBe(true);
    expect(instructions.notes.map(n => n.text)).toEqual([
      'Guest requested extra pillows',
      'Check the window',
      'Replace amenities',
      'Check curtains',
      'Provide two extra towels',
    ]);
  });

  it('never shows unrelated PMS reception/kitchen sections or synthetic planning breadcrumbs', () => {
    const instructions = slntTeamBRoomInstructions({
      ...base,
      notes: 'Recepce: paid early • Kitchen: vegetarian • Housekeeping: Extra pillow',
      assignment_notes: 'Auto-distributed after full SLNT PMS sync.',
    });
    expect(instructions.notes.map(n => n.text)).toEqual(['Extra pillow']);
  });

  it('deduplicates the same Previo note already visible in manager notes', () => {
    const instructions = slntTeamBRoomInstructions({
      ...base, notes: 'Guest requests fresh towels',
      pms_metadata: { slntPrevioHousekeepingNote: 'Guest requests fresh towels' },
    });
    expect(instructions.notes).toHaveLength(1);
  });

  it('accepts inferred bed setup but never invents a requirement from the room name', () => {
    expect(slntTeamBRoomInstructions({
      ...base, pms_metadata: { inferredBedConfig: { value: 'Beds together' } },
    }).bedInstruction).toBe('BT · Beds together');
    expect(slntTeamBRoomInstructions(base).bedInstruction).toBeNull();
    expect(slntTeamBRoomInstructions(base).notes).toHaveLength(0);
  });
});
