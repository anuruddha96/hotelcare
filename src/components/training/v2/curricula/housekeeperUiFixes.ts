import type { TrainingCurriculum } from '../types';

/**
 * Small UI-only corrections applied to the housekeeper curriculum.
 * Keep these separate from the training copy so layout/selector fixes do not
 * require rewriting the translated curriculum.
 */
export function applyHousekeeperUiFixes(curriculum: TrainingCurriculum): TrainingCurriculum {
  return {
    ...curriculum,
    steps: curriculum.steps.map((step) => {
      if (step.key === 'signin') {
        return {
          ...step,
          // The Attendance component wraps its intro card and SwipeAction in
          // `check-in-button`. Spotlight only the actual swipe track so the
          // housekeeper can see exactly what must be used and the target rect is
          // small enough to remain clear of the mobile coaching sheet.
          selector: '[data-training="check-in-button"] [data-training="swipe-action-track"]',
        };
      }

      if (step.key === 'special_instructions') {
        return {
          ...step,
          // AssignedRoomCard only renders this block when there is a real towel,
          // linen, bed, manager-note or other room-specific instruction. The
          // step is optional, so it is deferred when the room has none.
          selector: '[data-training="room-special-instructions"]',
        };
      }

      return step;
    }),
  };
}
