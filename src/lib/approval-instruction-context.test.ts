import { describe, expect, it } from 'vitest';
import {
  cleanOperationalInstruction,
  resolveApprovalInstructionContext,
} from './approval-instruction-context';

describe('approval instruction context', () => {
  it('prefers the frozen assignment snapshot over later room changes', () => {
    const context = resolveApprovalInstructionContext({
      assignment_type: 'daily_cleaning',
      priority: 1,
      notes: 'new mutable note',
      rooms: {
        towel_change_required: false,
        linen_change_required: false,
        notes: 'Changed after cleaning',
      },
      instruction_snapshot: {
        frozen: true,
        source: 'assignment_start',
        captured_at: '2026-09-06T08:54:00Z',
        assignment_type: 'daily_cleaning',
        priority: 3,
        assignment_notes: '[GREEN_BOARD] Please clean before noon',
        room: {
          towel_change_required: true,
          linen_change_required: true,
          notes: '[ROOM_CLEANING] [COLLECT_EXTRA_TOWELS] Baby cot requested',
          floor_number: 2,
          status: 'dirty',
        },
      },
    });

    expect(context.snapshotAvailable).toBe(true);
    expect(context.snapshotFrozen).toBe(true);
    expect(context.towelChangeRequired).toBe(true);
    expect(context.linenChangeRequired).toBe(true);
    expect(context.roomCleaningRequested).toBe(true);
    expect(context.collectExtraTowels).toBe(true);
    expect(context.greenBoardRequested).toBe(true);
    expect(context.managerInstruction).toBe('Baby cot requested');
    expect(context.assignmentInstruction).toBe('Please clean before noon');
    expect(context.priority).toBe(3);
  });

  it('preserves towel and linen requirements for checkout approvals', () => {
    const context = resolveApprovalInstructionContext({
      assignment_type: 'checkout_cleaning',
      priority: 2,
      instruction_snapshot: {
        frozen: true,
        assignment_type: 'checkout_cleaning',
        priority: 2,
        assignment_notes: '',
        room: {
          towel_change_required: true,
          linen_change_required: true,
          notes: '',
        },
      },
    });

    expect(context.assignmentType).toBe('checkout_cleaning');
    expect(context.towelChangeRequired).toBe(true);
    expect(context.linenChangeRequired).toBe(true);
  });

  it('falls back to live room context for legacy assignments without a snapshot', () => {
    const context = resolveApprovalInstructionContext({
      assignment_type: 'daily_cleaning',
      priority: 1,
      notes: '[GREEN_BOARD] Legacy instruction',
      rooms: {
        towel_change_required: true,
        linen_change_required: false,
        notes: '[ROOM_CLEANING] Manager note',
        floor_number: 3,
      },
    });

    expect(context.snapshotAvailable).toBe(false);
    expect(context.towelChangeRequired).toBe(true);
    expect(context.roomCleaningRequested).toBe(true);
    expect(context.greenBoardRequested).toBe(true);
    expect(context.managerInstruction).toBe('Manager note');
    expect(context.assignmentInstruction).toBe('Legacy instruction');
    expect(context.floorNumber).toBe(3);
  });

  it('uses manual bed setup before inferred or generic bed configuration', () => {
    const context = resolveApprovalInstructionContext({
      instruction_snapshot: {
        frozen: true,
        assignment_type: 'daily_cleaning',
        priority: 1,
        assignment_notes: '',
        room: {
          notes: '',
          bed_configuration: 'Twin',
          pms_metadata: {
            inferredBedConfig: { value: 'Sofa Bed' },
            manualBedConfig: { value: 'Baby Cot + Double' },
          },
        },
      },
    });

    expect(context.bedInstruction).toBe('Baby Cot + Double');
  });

  it('removes internal transport markers but preserves human instructions', () => {
    expect(
      cleanOperationalInstruction(
        '[GREEN_BOARD] [SUPERVISOR_RECHECK:Please recheck bathroom] [NO_BOARD] Guest asked for extra water',
      ),
    ).toBe('Please recheck bathroom Guest asked for extra water');
  });
});
