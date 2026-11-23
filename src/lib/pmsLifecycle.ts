// Client wrappers for the atomic reservation lifecycle RPCs.
// Every state transition (check-in, checkout, confirm/cancel/no-show,
// folio changes, create/edit) goes through these — no component may
// write reservation statuses directly.

import { supabase } from "@/integrations/supabase/client";
import { lifecycleErrorKey } from "@/lib/reservations";

export class LifecycleError extends Error {
  translationKey: string | null;
  constructor(message: string, translationKey: string | null) {
    super(message);
    this.translationKey = translationKey;
  }
}

function throwLifecycle(error: { message?: string } | null): never {
  const msg = error?.message || "Unknown error";
  throw new LifecycleError(msg, lifecycleErrorKey(error));
}

// The generated Supabase types may lag right after a migration; keep the
// rpc name typing loose but the wrappers strictly typed for callers.
async function rpc<T = Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase.rpc as CallableFunction)(fn, args);
  if (error) throwLifecycle(error);
  return data as T;
}

export interface AvailableRoom {
  room_id: string;
  room_number: string;
  room_type: string | null;
  room_status: string;
  capacity: number;
  has_conflict: boolean;
}

export async function fetchAvailableRooms(
  hotelId: string,
  from: string,
  to: string,
  excludeReservation?: string | null,
): Promise<AvailableRoom[]> {
  const data = await rpc<AvailableRoom[]>("pms_available_rooms", {
    _hotel_id: hotelId,
    _from: from,
    _to: to,
    _exclude_reservation: excludeReservation ?? null,
  });
  return Array.isArray(data) ? data : [];
}

export async function checkInReservation(
  reservationId: string,
  roomId: string,
  override = false,
  occurredAt: string | null = null,
  guestIds: string[] | null = null,
): Promise<{ ok: boolean; room_number?: string }> {
  return rpc("pms_check_in", {
    _reservation_id: reservationId,
    _room_id: roomId,
    _override: override,
    _moment: occurredAt,
    _guest_ids: guestIds,
  });
}

export async function checkOutReservation(
  reservationId: string,
  acknowledgeBalance = false,
  occurredAt: string | null = null,
  guestIds: string[] | null = null,
): Promise<{ ok: boolean; balance_at_checkout?: number }> {
  return rpc("pms_check_out", {
    _reservation_id: reservationId,
    _acknowledge_balance: acknowledgeBalance,
    _moment: occurredAt,
    _guest_ids: guestIds,
  });
}

export type GuestAction = 'arrive' | 'depart' | 'undo_arrival' | 'undo_departure';

export async function guestTransitionReservation(
  reservationId: string, action: GuestAction, guestIds: string[] | null,
  occurredAt: string | null = null,
) {
  return rpc('pms_guest_transition', {
    _reservation_id:reservationId,_action:action,_guest_ids:guestIds,
    _moment:occurredAt,_room_id:null,_acknowledge_balance:false,_override:false,
  });
}

export async function addStayGuest(reservationId: string, guestId: string) {
  return rpc('pms_add_stay_guest', {_reservation_id:reservationId,_guest_id:guestId});
}

export async function setNtakBookingNumber(reservationId: string, bookingNo: string) {
  return rpc('pms_set_ntak_booking_no', {_reservation_id:reservationId,_booking_no:bookingNo});
}

export async function changeRoomReservation(
  reservationId: string, toRoomId: string, occurredAt: string | null = null,
): Promise<{ ok: boolean; room_number?: string }> {
  return rpc("pms_change_room", { _reservation_id: reservationId, _to_room: toRoomId, _moment: occurredAt });
}

export async function undoReservationCheckIn(reservationId: string, occurredAt: string | null = null) {
  return rpc("pms_undo_check_in", { _reservation_id: reservationId, _moment: occurredAt });
}

export async function undoReservationCheckOut(reservationId: string, occurredAt: string | null = null) {
  return rpc("pms_undo_check_out", { _reservation_id: reservationId, _moment: occurredAt });
}

export async function setReservationStatus(
  reservationId: string,
  status: "confirmed" | "cancelled" | "no_show",
  reason?: string,
): Promise<{ ok: boolean; status: string }> {
  return rpc("pms_set_reservation_status", {
    _reservation_id: reservationId,
    _new_status: status,
    _reason: reason ?? null,
  });
}

export async function addFolioItem(
  reservationId: string,
  description: string,
  amount: number,
  chargeType: string,
  businessDay: string | null = null,
  paymentMethod: string | null = null,
): Promise<{ ok: boolean; balance_due: number }> {
  if (amount < 0 && businessDay === null) return rpc("pms_add_folio_item", {
    _reservation_id: reservationId, _description: description, _amount: amount, _charge_type: chargeType,
  });
  return rpc("pms_record_business_folio_item", {
    _reservation_id: reservationId,
    _description: description,
    _amount: amount,
    _charge_type: chargeType,
    _business_day: businessDay,
    _method: paymentMethod,
  });
}

export interface CreateReservationParams {
  hotelId: string;
  guestId: string | null;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  roomId?: string | null;
  roomTypeRequested?: string | null;
  ratePerNight?: number;
  currency?: string | null;
  source?: string;
  specialRequests?: string | null;
  internalNotes?: string | null;
  status?: "pending" | "confirmed";
}

export async function createReservation(
  p: CreateReservationParams,
): Promise<{ ok: boolean; id: string; reservation_number: string }> {
  return rpc("pms_create_reservation", {
    _hotel_id: p.hotelId,
    _guest_id: p.guestId,
    _check_in: p.checkIn,
    _check_out: p.checkOut,
    _adults: p.adults,
    _children: p.children,
    _room_id: p.roomId ?? null,
    _room_type_requested: p.roomTypeRequested ?? null,
    _rate_per_night: p.ratePerNight ?? 0,
    _currency: p.currency ?? null,
    _source: p.source ?? "direct",
    _special_requests: p.specialRequests ?? null,
    _internal_notes: p.internalNotes ?? null,
    _status: p.status ?? "confirmed",
  });
}

export interface UpdateReservationParams {
  reservationId: string;
  checkIn?: string | null;
  checkOut?: string | null;
  adults?: number | null;
  children?: number | null;
  roomId?: string | null;
  clearRoom?: boolean;
  ratePerNight?: number | null;
  source?: string | null;
  roomTypeRequested?: string | null;
  specialRequests?: string | null;
  internalNotes?: string | null;
}

export async function updateReservation(
  p: UpdateReservationParams,
): Promise<{ ok: boolean; pms_managed: boolean }> {
  return rpc("pms_update_reservation", {
    _reservation_id: p.reservationId,
    _check_in: p.checkIn ?? null,
    _check_out: p.checkOut ?? null,
    _adults: p.adults ?? null,
    _children: p.children ?? null,
    _room_id: p.roomId ?? null,
    _clear_room: p.clearRoom ?? false,
    _rate_per_night: p.ratePerNight ?? null,
    _source: p.source ?? null,
    _room_type_requested: p.roomTypeRequested ?? null,
    _special_requests: p.specialRequests ?? null,
    _internal_notes: p.internalNotes ?? null,
  });
}
