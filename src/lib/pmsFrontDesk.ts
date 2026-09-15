import { supabase } from '@/integrations/supabase/client';
import type { ReservationStatus } from '@/domain/pms/reservations';

export type PMSRoom = {
  id: string;
  room_number: string;
  room_name: string | null;
  room_type: string | null;
  room_category: string | null;
  floor_number: number | null;
  status: string | null;
  is_dnd: boolean | null;
  is_checkout_room: boolean | null;
};

export type PMSReservationRoom = {
  id: string;
  room_type_id: string | null;
  room_id: string | null;
  external_room_id: string | null;
  adults: number;
  children: number;
  assigned_at: string | null;
  nightly_rate: number | null;
  nightly_rate_max: number | null;
};

export type PMSReservation = {
  id: string;
  organization_slug: string;
  hotel_id: string;
  source_system: string;
  source_channel: string | null;
  external_reservation_id: string | null;
  confirmation_code: string | null;
  status: ReservationStatus;
  arrival_date: string;
  departure_date: string;
  adults: number;
  children: number;
  primary_guest_name: string | null;
  primary_guest_email: string | null;
  primary_guest_phone: string | null;
  currency: string;
  total_amount: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  rooms: PMSReservationRoom[];
};

export type PMSPrevioSnapshot = {
  id: string;
  business_date: string;
  room_number: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  status: string | null;
  guest_names: string | null;
  source: string | null;
};

export type PMSPropertySettings = {
  organization_slug: string;
  hotel_id: string;
  default_check_in: string;
  default_check_out: string;
  currency: string;
};

export type PMSFrontDeskFeed = {
  reservations: PMSReservation[];
  rooms: PMSRoom[];
  previo_snapshots: PMSPrevioSnapshot[];
  settings: PMSPropertySettings;
  can_manage: boolean;
};

export type PMSReadonlyStay = {
  key: string;
  roomNumber: string;
  guestName: string;
  arrivalDate: string;
  departureDate: string;
  source: string;
  status: string;
};

export type CreateManualReservationInput = {
  organizationSlug: string;
  hotelId: string;
  guestName: string;
  guestEmail?: string;
  guestPhone?: string;
  arrivalDate: string;
  departureDate: string;
  roomId?: string;
  adults: number;
  children: number;
  nightlyRate: number;
  currency: string;
  notes?: string;
};

export type UpdateManualReservationInput = {
  primary_guest_name?: string;
  primary_guest_email?: string;
  primary_guest_phone?: string;
  arrival_date?: string;
  departure_date?: string;
  room_id?: string | null;
  adults?: number;
  children?: number;
  nightly_rate?: number;
  currency?: string;
  notes?: string | null;
};

export type FrontDeskMetrics = {
  arrivals: number;
  inHouse: number;
  departures: number;
  unassigned: number;
};

function rpcClient() {
  // Phase 2 functions are introduced by the same branch as this client. The
  // generated Supabase type file will pick them up after the migration is live;
  // keep this one boundary cast local rather than weakening types app-wide.
  return supabase as any;
}

export async function getPmsFrontDeskFeed(
  organizationSlug: string,
  hotelId: string,
  startDate: string,
  endDate: string,
): Promise<PMSFrontDeskFeed> {
  const { data, error } = await rpcClient().rpc('pms_get_front_desk_feed', {
    p_organization_slug: organizationSlug,
    p_hotel_id: hotelId,
    p_start_date: startDate,
    p_end_date: endDate,
  });
  if (error) throw error;
  return data as PMSFrontDeskFeed;
}

export async function createPmsManualReservation(input: CreateManualReservationInput) {
  const { data, error } = await rpcClient().rpc('pms_create_manual_reservation', {
    p_organization_slug: input.organizationSlug,
    p_hotel_id: input.hotelId,
    p_guest_name: input.guestName,
    p_arrival_date: input.arrivalDate,
    p_departure_date: input.departureDate,
    p_room_id: input.roomId || null,
    p_adults: input.adults,
    p_children: input.children,
    p_nightly_rate: input.nightlyRate,
    p_currency: input.currency.toUpperCase(),
    p_guest_email: input.guestEmail || null,
    p_guest_phone: input.guestPhone || null,
    p_notes: input.notes || null,
  });
  if (error) throw error;
  return data as PMSReservation;
}

export async function updatePmsManualReservation(
  reservationId: string,
  patch: UpdateManualReservationInput,
) {
  const { data, error } = await rpcClient().rpc('pms_update_manual_reservation', {
    p_reservation_id: reservationId,
    p_patch: patch,
  });
  if (error) throw error;
  return data as PMSReservation;
}

export async function transitionPmsManualReservation(
  reservationId: string,
  nextStatus: ReservationStatus,
) {
  const { data, error } = await rpcClient().rpc('pms_transition_manual_reservation', {
    p_reservation_id: reservationId,
    p_next_status: nextStatus,
  });
  if (error) throw error;
  return data as PMSReservation;
}

export function reservationRoomId(reservation: PMSReservation): string | null {
  return reservation.rooms[0]?.room_id || null;
}

export function reservationNightlyRate(reservation: PMSReservation): number | null {
  return reservation.rooms[0]?.nightly_rate ?? null;
}

export function availableStatusActions(status: ReservationStatus): ReservationStatus[] {
  switch (status) {
    case 'tentative':
      return ['confirmed', 'cancelled'];
    case 'confirmed':
      return ['checked_in', 'cancelled', 'no_show'];
    case 'checked_in':
      return ['checked_out'];
    default:
      return [];
  }
}

export function buildReadonlyPrevioStays(snapshots: PMSPrevioSnapshot[]): PMSReadonlyStay[] {
  const stays = new Map<string, PMSReadonlyStay>();
  for (const snapshot of snapshots) {
    if (!snapshot.room_number || !snapshot.arrival_date || !snapshot.departure_date) continue;
    const guestName = snapshot.guest_names?.replace(/\s+/g, ' ').trim() || 'Guest';
    const key = [snapshot.room_number, snapshot.arrival_date, snapshot.departure_date, guestName].join('|');
    const next: PMSReadonlyStay = {
      key,
      roomNumber: snapshot.room_number,
      guestName,
      arrivalDate: snapshot.arrival_date,
      departureDate: snapshot.departure_date,
      source: snapshot.source || 'previo',
      status: snapshot.status || 'imported',
    };
    const existing = stays.get(key);
    if (!existing || snapshot.business_date > (existing as any).businessDate) {
      (next as any).businessDate = snapshot.business_date;
      stays.set(key, next);
    }
  }
  return Array.from(stays.values()).map(({ ...stay }) => {
    delete (stay as any).businessDate;
    return stay;
  });
}

export function computeFrontDeskMetrics(
  reservations: PMSReservation[],
  businessDate: string,
): FrontDeskMetrics {
  const active = reservations.filter((reservation) => !['cancelled', 'no_show'].includes(reservation.status));
  return {
    arrivals: active.filter((reservation) => reservation.arrival_date === businessDate && reservation.status !== 'checked_in').length,
    inHouse: active.filter((reservation) => reservation.status === 'checked_in').length,
    departures: active.filter((reservation) => reservation.departure_date === businessDate && reservation.status !== 'checked_out').length,
    unassigned: active.filter((reservation) => !reservationRoomId(reservation) && reservation.status !== 'checked_out').length,
  };
}

export function reservationOverlapsWindow(
  arrivalDate: string,
  departureDate: string,
  windowStart: string,
  windowEnd: string,
): boolean {
  return arrivalDate < windowEnd && departureDate > windowStart;
}
