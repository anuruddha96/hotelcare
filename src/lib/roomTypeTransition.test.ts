import { describe, expect, it } from 'vitest';
import {
  buildDirectRoomTypeNotice,
  buildRoomTypeTransition,
  roomServiceLabel,
  stripRoomTypeSystemNotes,
} from './roomTypeTransition';
import { GOZSDU_ROOM_OVERRIDE_KEY, readGozsduRoomOverride } from './gozsduRoomBucketOverride';

const input = {
  date: '2026-10-07',
  roomNumber: '117',
  actorId: 'manager-eva',
  actorName: 'Éva',
  nowIso: '2026-10-07T07:15:00.000Z',
  previousRoomNotes: 'Previous guest bed setup: Baby Bed\n[ROOM TYPE 2026-10-07] Old technical text',
};

describe('authoritative manager room type changes', () => {
  it('turns checkout into a confirmed stayover without asking the housekeeper to verify with reception', () => {
    const result = buildRoomTypeTransition({
      ...input,
      target: 'daily',
      metadata: {
        scheduledDepartureToday: true,
        checkedOutToday: false,
        reservationId: 'previo-A',
        arrivalDate: '2026-10-02',
        departureDate: '2026-10-07',
        currentNight: 5,
        totalNights: 5,
      },
      serviceSnapshot: {
        reservationId: 'previo-A',
        guestFingerprint: 'pms-guest',
        guestIdentityStrength: 'strong',
        arrivalDate: '2026-10-02',
        departureDate: '2026-10-07',
        guestNightsStayed: 5,
        currentNight: 5,
        totalNights: 5,
      },
    });

    expect(result.metadata.manual_daily).toBe(true);
    expect(result.metadata.manual_checkout).toBe(false);
    expect(result.metadata.occupiedToday).toBe(true);
    expect(result.metadata.scheduledDepartureToday).toBe(false);
    expect(result.continuedNight).toBe(6);
    expect(result.metadata.currentNight).toBe(6);
    expect(result.metadata.totalNights).toBe(6);
    expect(result.notice.message).toContain('Guest staying — Daily service');
    expect(result.notice.message).toContain('Éva');
    expect(result.notice.message.toLowerCase()).not.toContain('verify');
    expect(result.notice.message.toLowerCase()).not.toContain('reception');

    const snapshot = result.metadata.extensionServiceSnapshot as Record<string, unknown>;
    expect(snapshot.reservationId).toBe('previo-A');
    expect(snapshot.guestNightsStayed).toBe(5);
    expect(snapshot.departureDate).toBe('2026-10-07');
  });

  it('recovers the completed checkout nights when Previo omits the current-night value', () => {
    const result = buildRoomTypeTransition({
      ...input,
      target: 'daily',
      metadata: {
        reservationId: 'previo-A',
        arrivalDate: '2026-10-02',
        departureDate: '2026-10-07',
        currentNight: null,
        totalNights: 5,
      },
      serviceSnapshot: {
        reservationId: 'previo-A',
        guestNightsStayed: null,
        currentNight: null,
        totalNights: 5,
      },
    });
    expect(result.continuedNight).toBe(6);
    expect(result.metadata.currentNight).toBe(6);
    expect((result.metadata.extensionServiceSnapshot as any).guestNightsStayed).toBe(5);
  });

  it('does not add another stay night when the same manager decision is repeated today', () => {
    const first = buildRoomTypeTransition({
      ...input,
      target: 'daily',
      metadata: {
        reservationId: 'previo-A',
        arrivalDate: '2026-10-02',
        departureDate: '2026-10-07',
        currentNight: 5,
        totalNights: 5,
      },
      serviceSnapshot: {
        reservationId: 'previo-A',
        guestNightsStayed: 5,
        currentNight: 5,
        totalNights: 5,
      },
    });
    const second = buildRoomTypeTransition({
      ...input,
      target: 'daily',
      metadata: first.metadata,
      serviceSnapshot: {
        reservationId: 'previo-A',
        guestNightsStayed: 6,
        currentNight: 6,
        totalNights: 6,
      },
    });
    expect(first.continuedNight).toBe(6);
    expect(second.continuedNight).toBe(6);
    expect((second.metadata.extensionServiceSnapshot as any).guestNightsStayed).toBe(5);
  });

  it('keeps human notes but removes old technical room-type lines', () => {
    const result = buildRoomTypeTransition({
      ...input,
      target: 'daily',
      metadata: { currentNight: 2, totalNights: 2 },
      serviceSnapshot: { guestNightsStayed: 2 },
    });
    expect(result.note).toBe('Previous guest bed setup: Baby Bed');
    expect(result.note).not.toContain('[ROOM TYPE');
  });

  it('keeps checkout instructions direct and does not claim PMS has checked the guest out', () => {
    const result = buildRoomTypeTransition({
      ...input,
      target: 'checkout',
      metadata: { manual_daily: true, manualReadyToCleanAt: 'stale-time' },
    });
    expect(result.metadata.manual_checkout).toBe(true);
    expect(result.metadata.manual_daily).toBe(false);
    expect(result.metadata.manualReadyToCleanAt).toBeNull();
    expect(result.notice.message).toContain('Wait for Guest Checked Out');
    expect(result.metadata.scheduledDepartureToday).toBeUndefined();
  });

  it('preserves Gozsdu historical overrides and records the manager decision without a verification instruction', () => {
    const result = buildRoomTypeTransition({
      ...input,
      target: 'daily',
      metadata: {
        [GOZSDU_ROOM_OVERRIDE_KEY]: {
          '2026-10-06': { date: '2026-10-06', bucket: 'checkout', service: 'none' },
        },
      },
      gozsduPlan: { bucket: 'other', service: 'none' },
    });
    expect(readGozsduRoomOverride(result.metadata, input.date)?.bucket).toBe('other');
    expect(readGozsduRoomOverride(result.metadata, '2026-10-06')?.bucket).toBe('checkout');
    expect(readGozsduRoomOverride(result.metadata, input.date)?.reason).toContain('Manager confirmed guest staying');
  });

  it('builds the final housekeeper action from persisted service requirements', () => {
    const notice = buildDirectRoomTypeNotice({
      date: input.date,
      at: input.nowIso,
      from: 'checkout',
      to: 'daily',
      by: 'Éva',
      serviceLabel: 'Full Room Change',
      nightsStayed: 6,
    });
    expect(notice.message).toBe(
      'Guest staying — Daily service. Changed from Checkout to Daily by Éva. Required today: Full Room Change. Stay so far: 6 nights.',
    );
  });

  it('does not create continuous-stay counters when the hotel is not on Previo', () => {
    const result = buildRoomTypeTransition({
      ...input,
      target: 'daily',
      continuousStayEnabled: false,
      metadata: { currentNight: 5, totalNights: 5 },
      serviceSnapshot: { guestNightsStayed: 5, currentNight: 5, totalNights: 5 },
    });
    expect(result.continuedNight).toBeNull();
    expect(result.metadata.extensionServiceSnapshot).toBeUndefined();
    expect(result.metadata.currentNight).toBe(5);
    expect(result.notice.nightsStayed).toBeNull();
    expect(result.notice.message).toContain('Daily cleaning confirmed');
    expect(result.notice.message).not.toContain('Guest staying');
  });

  it('shows SLNT-style stayover service without inventing routine daily cleaning', () => {
    expect(roomServiceLabel({
      towelChangeRequired: false,
      linenChangeRequired: false,
      routineDailyCleaning: false,
    })).toBe('No scheduled stayover cleaning');
    expect(roomServiceLabel({
      towelChangeRequired: true,
      linenChangeRequired: false,
      routineDailyCleaning: false,
    })).toBe('Towel Change');
  });

  it('removes only system room-type lines', () => {
    expect(stripRoomTypeSystemNotes(
      'Baby Bed — reset after cleaning\n[ROOM TYPE 2026-10-07] technical\nGuest asked for extra pillow',
    )).toBe('Baby Bed — reset after cleaning\nGuest asked for extra pillow');
  });
});
