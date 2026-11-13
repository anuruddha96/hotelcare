// Reception write-back to Previo: request building and error classification.
//
// Pure and unit-tested. The worker (previo-reservation-writeback) does the I/O.
//
// Scope of this first slice: check-in and check-out done in HotelCare.
//   check-in : REST POST /rest/reservations/rooms/check-in { reservationRoomId: comId }
//              Previo requires arrival today, one complete guest profile and a tidy room.
//   check-out: XML Hotel.reservation, per room: <commission><comId/><cosId>9</cosId></commission>
//              (per room, so the other rooms of a group booking are not touched).
// Cancellations and no-shows release rooms to the OTAs and are deliberately not here.

export type WritebackAction = "check_in" | "check_out";

export const PREVIO_CHECKED_OUT_STATUS_ID = 9;

export interface WritebackJob {
  action: WritebackAction;
  pms_reservation_id: string | null;
  pms_room_reservation_id: string | null;
  room_changed: boolean;
}

export type WritebackRequest =
  | { kind: "rest"; method: "POST"; path: string; body: Record<string, unknown> }
  | { kind: "xml"; method: "reservation"; extraXml: string };

const ID = /^\d{1,18}$/;

/** Why a job cannot be sent at all (shown to reception), or null when it can. */
export function writebackBlocker(job: WritebackJob): string | null {
  if (!job.pms_room_reservation_id || !ID.test(job.pms_room_reservation_id)) {
    return "This booking has no Previo room reference yet; update it in Previo.";
  }
  if (job.action === "check_out" && (!job.pms_reservation_id || !ID.test(job.pms_reservation_id))) {
    return "This booking has no Previo reservation reference yet; update it in Previo.";
  }
  if (job.action === "check_in" && job.room_changed) {
    return "Checked in to a different room than Previo has. Move the guest in Previo, then check in there.";
  }
  return null;
}

/** The exact request the worker sends (also stored for dry runs and audit). */
export function buildWritebackRequest(job: WritebackJob): WritebackRequest {
  const blocker = writebackBlocker(job);
  if (blocker) throw new Error(blocker);
  if (job.action === "check_in") {
    return {
      kind: "rest",
      method: "POST",
      path: "/rest/reservations/rooms/check-in",
      body: { reservationRoomId: Number(job.pms_room_reservation_id) },
    };
  }
  return {
    kind: "xml",
    method: "reservation",
    extraXml:
      `<newReservation><resId>${job.pms_reservation_id}</resId><commissions><commission>` +
      `<comId>${job.pms_room_reservation_id}</comId><cosId>${PREVIO_CHECKED_OUT_STATUS_ID}</cosId>` +
      `</commission></commissions></newReservation>`,
  };
}

/**
 * Should a failed send be retried?
 *  - retry: network/timeout, HTTP 5xx or 429, Previo busy (1030), reservation
 *    temporarily locked (6000). Sending the same status change again is harmless.
 *  - fail:  everything else (validation: guest profile incomplete, room not
 *    tidy, arrival not today, unknown room...). Reception must act; resending
 *    would only fail again.
 */
export function classifyWritebackFailure(status: number, message: string | null | undefined): "retry" | "fail" {
  const text = String(message ?? "");
  if (status === 0 || status === 429 || status >= 500) return "retry";
  if (/\b(1030|6000)\b|simultaneous|locked|timed? ?out|temporar/i.test(text)) return "retry";
  return "fail";
}

/** Minutes to wait before attempt n+1 (1, 2, 4, 8, 16). */
export function retryDelayMinutes(attempts: number): number {
  return Math.min(16, 2 ** Math.max(0, attempts - 1));
}

export const MAX_WRITEBACK_ATTEMPTS = 5;

/** Short, readable error for reception: Previo's own message when there is one, no markup. */
export function readableWritebackError(status: number, message: string | null | undefined, body?: string | null): string {
  const fromMessage = String(message ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (fromMessage) return fromMessage.slice(0, 300);
  const fromBody = String(body ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (fromBody && fromBody.length < 300 && !/^[{[]/.test(fromBody)) return fromBody;
  return status ? `Previo answered HTTP ${status}` : "Previo could not be reached";
}
