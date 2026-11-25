import { describe, expect, it } from 'vitest';
import { gozsduRoomTranslations } from './gozsdu-room-translations';

const screenshotKeys = [
  'gozsdu.cleaningPlan',
  'gozsdu.roomStatus',
  'gozsdu.currentlyAssigned',
  'gozsdu.cleaningLocked',
  'gozsdu.status',
  'gozsdu.service',
  'gozsdu.housekeeper',
  'gozsdu.room',
  'gozsdu.todayEssentials',
  'gozsdu.low',
  'gozsdu.medium',
  'gozsdu.high',
  'gozsdu.currentCleaningPlan',
  'gozsdu.readyToClean',
  'gozsdu.markCleanSyncPms',
  'gozsdu.towelChange',
  'gozsdu.completeTextileChange',
  'gozsdu.roomCleaning',
  'gozsdu.collectExtraTowels',
  'gozsdu.noteTitle',
  'gozsdu.shared',
  'gozsdu.guestRequests',
  'gozsdu.notEnabled',
  'gozsdu.moreRoomDetails',
] as const;

describe('Gozsdu room dialog translations', () => {
  it('has explicit Hungarian translations for the visible room workflow', () => {
    for (const key of screenshotKeys) {
      expect(gozsduRoomTranslations.en[key]).toBeTruthy();
      expect(gozsduRoomTranslations.hu[key]).toBeTruthy();
      expect(gozsduRoomTranslations.hu[key]).not.toBe(gozsduRoomTranslations.en[key]);
    }
  });

  it('uses operational Hungarian terminology for the checkout flow', () => {
    expect(gozsduRoomTranslations.hu['gozsdu.readyToClean']).toBe('Takarításra kész');
    expect(gozsduRoomTranslations.hu['gozsdu.markCleanSyncPms']).toContain('PMS');
    expect(gozsduRoomTranslations.hu['gozsdu.checkoutFlowHint']).toContain('Takarításra kész');
  });
});
