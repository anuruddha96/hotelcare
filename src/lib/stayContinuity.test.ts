import { describe, expect, it } from 'vitest';
import { reconcileContinuousStay } from './stayContinuity';

const base = {
  businessDate: '2026-10-07',
  nowIso: '2026-10-07T08:30:00.000Z',
};

describe('continuous stay reconciliation', () => {
  it('uses an authoritative Previo continuous chain when the edge resolved an extension', () => {
    const result = reconcileContinuousStay({
      ...base,
      manualDailyOverride: false,
      row: {
        ReservationId: 'B',
        GuestFingerprint: 'guest-1',
        GuestIdentityStrength: 'strong',
        ArrivalDate: '2026-10-07',
        DepartureDate: '2026-10-10',
        CurrentNight: 1,
        TotalNights: 3,
        ContinuousStayOriginalArrival: '2026-10-02',
        ContinuousStayFinalDeparture: '2026-10-10',
        ContinuousStayCurrentNight: 6,
        ContinuousStayTotalNights: 8,
        ContinuousStayReservationIds: ['A', 'B'],
        ContinuousStaySegmentCount: 2,
        ContinuousStayConfidence: 'strong',
        ExtensionLinked: true,
      },
    });
    expect(result.currentNight).toBe(6);
    expect(result.totalNights).toBe(8);
    expect(result.linkedExtension).toBe(true);
    expect(result.continuousStay?.reservationIds).toEqual(['A', 'B']);
  });

  it('bridges a manager-confirmed checkout into a new same-day reservation without resetting nights', () => {
    const result = reconcileContinuousStay({
      ...base,
      manualDailyOverride: true,
      storedGuestNights: 5,
      existingMetadata: {
        extensionServiceSnapshot: {
          managerConfirmedDate: '2026-10-07',
          reservationId: 'A',
          guestFingerprint: 'guest-1',
          guestIdentityStrength: 'strong',
          arrivalDate: '2026-10-02',
          departureDate: '2026-10-07',
          guestNightsStayed: 5,
          currentNight: 5,
          totalNights: 5,
        },
      },
      row: {
        ReservationId: 'B',
        GuestFingerprint: 'guest-1',
        GuestIdentityStrength: 'strong',
        ArrivalDate: '2026-10-07',
        DepartureDate: '2026-10-10',
        CurrentNight: 1,
        TotalNights: 3,
      },
    });
    expect(result.managerConfirmedContinuation).toBe(true);
    expect(result.currentNight).toBe(6);
    expect(result.totalNights).toBe(8);
    expect(result.continuousStay?.linkedBy).toBe('manager_confirmed');
    expect(result.continuousStay?.reservationIds).toEqual(['A', 'B']);
  });

  it('keeps an accumulated next stay-night while the new Previo reservation has not appeared yet', () => {
    const result = reconcileContinuousStay({
      ...base,
      manualDailyOverride: true,
      storedGuestNights: 5,
      existingMetadata: {
        extensionServiceSnapshot: {
          managerConfirmedDate: '2026-10-07',
          reservationId: 'A',
          arrivalDate: '2026-10-02',
          departureDate: '2026-10-07',
          guestNightsStayed: 5,
          currentNight: 5,
          totalNights: 5,
        },
      },
      row: {
        ReservationId: 'A',
        ArrivalDate: '2026-10-02',
        DepartureDate: '2026-10-07',
        CurrentNight: 5,
        TotalNights: 5,
      },
    });
    expect(result.currentNight).toBe(6);
    expect(result.totalNights).toBe(6);
    expect(result.managerConfirmedContinuation).toBe(true);
  });

  it('never bridges a strongly identified different guest in the same room', () => {
    const result = reconcileContinuousStay({
      ...base,
      manualDailyOverride: true,
      storedGuestNights: 5,
      existingMetadata: {
        extensionServiceSnapshot: {
          managerConfirmedDate: '2026-10-07',
          reservationId: 'A',
          guestFingerprint: 'guest-old',
          guestIdentityStrength: 'strong',
          departureDate: '2026-10-07',
          guestNightsStayed: 5,
        },
      },
      row: {
        ReservationId: 'B',
        GuestFingerprint: 'guest-new',
        GuestIdentityStrength: 'strong',
        ArrivalDate: '2026-10-07',
        DepartureDate: '2026-10-09',
        CurrentNight: 1,
        TotalNights: 2,
      },
    });
    expect(result.resetForDifferentGuest).toBe(true);
    expect(result.linkedExtension).toBe(false);
    expect(result.currentNight).toBe(1);
    expect(result.totalNights).toBe(2);
    expect(result.continuousStay?.reservationIds).toEqual(['B']);
  });

  it('does not bridge a manager snapshot over a date gap', () => {
    const result = reconcileContinuousStay({
      ...base,
      manualDailyOverride: true,
      storedGuestNights: 5,
      existingMetadata: {
        extensionServiceSnapshot: {
          managerConfirmedDate: '2026-10-07',
          reservationId: 'A',
          departureDate: '2026-10-07',
          guestNightsStayed: 5,
        },
      },
      row: {
        ReservationId: 'B',
        ArrivalDate: '2026-10-08',
        DepartureDate: '2026-10-10',
        CurrentNight: 1,
        TotalNights: 2,
      },
    });
    // The manager decision still preserves today's in-house history while
    // waiting; it must not claim that tomorrow's gapped reservation is linked.
    expect(result.linkedExtension).toBe(false);
    expect(result.currentNight).toBe(6);
    expect(result.continuousStay?.reservationIds).not.toContain('B');
  });


  it('lets a manager bridge an ambiguous same-room arrival when the PMS name/id changed', () => {
    const result = reconcileContinuousStay({
      ...base,
      manualDailyOverride: true,
      storedGuestNights: 5,
      existingMetadata: {
        extensionServiceSnapshot: {
          managerConfirmedDate: '2026-10-07',
          reservationId: 'A',
          arrivalDate: '2026-10-02',
          departureDate: '2026-10-07',
          guestNightsStayed: 5,
          currentNight: 5,
          totalNights: 5,
        },
      },
      row: {
        ReservationId: 'A',
        ArrivalDate: '2026-10-02',
        DepartureDate: '2026-10-07',
        CurrentNight: 5,
        TotalNights: 5,
        ContinuousStayCurrentNight: 5,
        ContinuousStayTotalNights: 5,
        ContinuousStayOriginalArrival: '2026-10-02',
        ContinuousStayFinalDeparture: '2026-10-07',
        ContinuousStayReservationIds: ['A'],
        ContinuousStaySegmentCount: 1,
        SameDayTurnover: true,
        SameDayTurnoverConfidence: 'ambiguous',
        NextArrivalReservationId: 'B',
        NextArrivalArrivalDate: '2026-10-07',
        NextArrivalDepartureDate: '2026-10-10',
      },
    });
    expect(result.managerConfirmedContinuation).toBe(true);
    expect(result.linkedExtension).toBe(true);
    expect(result.currentNight).toBe(6);
    expect(result.totalNights).toBe(8);
    expect(result.continuousStay?.reservationIds).toEqual(['A', 'B']);
  });

  it('cancels a manual stayover bridge when Previo proves a different guest turnover', () => {
    const result = reconcileContinuousStay({
      ...base,
      manualDailyOverride: true,
      storedGuestNights: 5,
      existingMetadata: {
        extensionServiceSnapshot: {
          managerConfirmedDate: '2026-10-07',
          reservationId: 'A',
          guestFingerprint: 'guest-old',
          guestIdentityStrength: 'strong',
          departureDate: '2026-10-07',
          guestNightsStayed: 5,
        },
      },
      row: {
        ReservationId: 'A',
        GuestFingerprint: 'guest-old',
        GuestIdentityStrength: 'strong',
        ArrivalDate: '2026-10-02',
        DepartureDate: '2026-10-07',
        CurrentNight: 5,
        TotalNights: 5,
        ContinuousStayCurrentNight: 5,
        ContinuousStayTotalNights: 5,
        ContinuousStayOriginalArrival: '2026-10-02',
        ContinuousStayFinalDeparture: '2026-10-07',
        ContinuousStayReservationIds: ['A'],
        ContinuousStaySegmentCount: 1,
        SameDayTurnover: true,
        SameDayTurnoverConfidence: 'strong',
        NextArrivalReservationId: 'B',
        NextArrivalGuestFingerprint: 'guest-new',
        NextArrivalGuestIdentityStrength: 'strong',
        NextArrivalArrivalDate: '2026-10-07',
        NextArrivalDepartureDate: '2026-10-10',
      },
    });
    expect(result.resetForDifferentGuest).toBe(true);
    expect(result.managerConfirmedContinuation).toBe(false);
    expect(result.currentNight).toBe(5);
    expect(result.continuousStay?.reservationIds).toEqual(['A']);
  });

  it('does not let a single edge checkout snapshot erase a same-day manager continuation', () => {
    const result = reconcileContinuousStay({
      ...base,
      manualDailyOverride: true,
      storedGuestNights: 5,
      existingMetadata: {
        extensionServiceSnapshot: {
          managerConfirmedDate: '2026-10-07',
          reservationId: 'A',
          arrivalDate: '2026-10-02',
          departureDate: '2026-10-07',
          guestNightsStayed: 5,
          currentNight: 5,
          totalNights: 5,
        },
      },
      row: {
        ReservationId: 'A',
        ArrivalDate: '2026-10-02',
        DepartureDate: '2026-10-07',
        CurrentNight: 5,
        TotalNights: 5,
        ContinuousStayCurrentNight: 5,
        ContinuousStayTotalNights: 5,
        ContinuousStayOriginalArrival: '2026-10-02',
        ContinuousStayFinalDeparture: '2026-10-07',
        ContinuousStayReservationIds: ['A'],
        ContinuousStaySegmentCount: 1,
      },
    });
    expect(result.currentNight).toBe(6);
    expect(result.totalNights).toBe(6);
    expect(result.managerConfirmedContinuation).toBe(true);
  });

  it('prunes a previously linked extension when Previo later removes or cancels it', () => {
    const result = reconcileContinuousStay({
      ...base,
      manualDailyOverride: true,
      storedGuestNights: 6,
      existingMetadata: {
        extensionServiceSnapshot: {
          managerConfirmedDate: '2026-10-07',
          reservationId: 'A',
          arrivalDate: '2026-10-02',
          departureDate: '2026-10-07',
          guestNightsStayed: 5,
          currentNight: 5,
          totalNights: 5,
        },
        continuousStay: {
          originalArrivalDate: '2026-10-02',
          finalDepartureDate: '2026-10-10',
          currentNight: 6,
          totalNights: 8,
          guestFingerprint: null,
          guestIdentityStrength: 'none',
          reservationIds: ['A', 'B'],
          segments: [
            { reservationId: 'A', arrivalDate: '2026-10-02', departureDate: '2026-10-07', nights: 5 },
            { reservationId: 'B', arrivalDate: '2026-10-07', departureDate: '2026-10-10', nights: 3 },
          ],
          linkedBy: 'manager_confirmed',
          confidence: 'manager_confirmed',
          updatedAt: '2026-10-07T08:00:00.000Z',
        },
      },
      row: {
        ReservationId: 'A',
        ArrivalDate: '2026-10-02',
        DepartureDate: '2026-10-07',
        CurrentNight: 5,
        TotalNights: 5,
        ContinuousStayOriginalArrival: '2026-10-02',
        ContinuousStayFinalDeparture: '2026-10-07',
        ContinuousStayCurrentNight: 5,
        ContinuousStayTotalNights: 5,
        ContinuousStayReservationIds: ['A'],
        ContinuousStaySegments: [
          { reservationId: 'A', arrivalDate: '2026-10-02', departureDate: '2026-10-07', nights: 5 },
        ],
        ContinuousStaySegmentCount: 1,
      },
    });
    expect(result.managerConfirmedContinuation).toBe(true);
    expect(result.linkedExtension).toBe(false);
    expect(result.continuousStay?.reservationIds).toEqual(['A']);
    expect(result.continuousStay?.segments).toHaveLength(1);
    expect(result.currentNight).toBe(6);
  });

  it('does not double count the same reservation on repeated PMS refreshes', () => {
    const result = reconcileContinuousStay({
      ...base,
      manualDailyOverride: false,
      existingMetadata: {
        continuousStay: {
          originalArrivalDate: '2026-10-02',
          finalDepartureDate: '2026-10-10',
          currentNight: 6,
          totalNights: 8,
          guestFingerprint: 'guest-1',
          guestIdentityStrength: 'strong',
          reservationIds: ['A', 'B'],
          segments: [],
          linkedBy: 'previo_chain',
          confidence: 'strong',
          updatedAt: '2026-10-07T07:00:00.000Z',
        },
      },
      row: {
        ReservationId: 'B',
        GuestFingerprint: 'guest-1',
        GuestIdentityStrength: 'strong',
        ArrivalDate: '2026-10-07',
        DepartureDate: '2026-10-10',
        CurrentNight: 1,
        TotalNights: 3,
      },
    });
    expect(result.currentNight).toBe(6);
    expect(result.totalNights).toBe(8);
    expect(result.continuousStay?.reservationIds).toEqual(['A', 'B']);
  });

  it('accepts a three-segment edge chain without losing accumulated nights', () => {
    const result = reconcileContinuousStay({
      ...base,
      manualDailyOverride: false,
      row: {
        ReservationId: 'C',
        GuestFingerprint: 'guest-1',
        GuestIdentityStrength: 'strong',
        CurrentNight: 1,
        TotalNights: 2,
        ContinuousStayOriginalArrival: '2026-09-30',
        ContinuousStayFinalDeparture: '2026-10-09',
        ContinuousStayCurrentNight: 8,
        ContinuousStayTotalNights: 9,
        ContinuousStayReservationIds: ['A', 'B', 'C'],
        ContinuousStaySegmentCount: 3,
        ExtensionLinked: true,
      },
    });
    expect(result.currentNight).toBe(8);
    expect(result.totalNights).toBe(9);
    expect(result.continuousStay?.reservationIds).toEqual(['A', 'B', 'C']);
  });
});
