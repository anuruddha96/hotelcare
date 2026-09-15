import type { ReservationStatus } from "./reservations";

export interface ReservationExternalRef {
  hotelId: string;
  sourceSystem: string;
  externalReservationId: string;
}

export interface CanonicalReservation {
  id: string;
  organizationSlug: string;
  hotelId: string;
  sourceSystem: string;
  sourceChannel: string | null;
  externalReservationId: string | null;
  confirmationCode: string | null;
  status: ReservationStatus;
  arrivalDate: string;
  departureDate: string;
  currency: string;
  totalAmount: number | null;
}

export interface ReservationNightInput {
  stayDate: string;
  bookedRateAmount: number;
  taxAmount: number;
  currency: string;
  ratePlanCode?: string | null;
  sourceRateId?: string | null;
}

export interface ReservationRoomInput {
  roomTypeId?: string | null;
  roomId?: string | null;
  externalRoomId?: string | null;
  adults: number;
  children: number;
  nights: ReservationNightInput[];
}

export interface CreateReservationInput {
  organizationSlug: string;
  hotelId: string;
  sourceSystem: string;
  sourceChannel?: string | null;
  externalReservationId?: string | null;
  confirmationCode?: string | null;
  status: ReservationStatus;
  arrivalDate: string;
  departureDate: string;
  adults: number;
  children: number;
  primaryGuestName?: string | null;
  primaryGuestEmail?: string | null;
  primaryGuestPhone?: string | null;
  currency: string;
  totalAmount?: number | null;
  notes?: string | null;
  rooms: ReservationRoomInput[];
}

export interface ReservationMutationContext {
  actorUserId?: string | null;
  sourceSystem: string;
  idempotencyKey?: string | null;
}

/**
 * Server-side persistence boundary for the future canonical PMS.
 * Phase 1 intentionally provides no browser implementation and no wiring to the
 * existing Previo/rate-publishing paths. Implementations must persist the
 * reservation, rooms, nights and audit event transactionally.
 */
export interface ReservationRepository {
  getById(id: string): Promise<CanonicalReservation | null>;
  getByExternalRef(ref: ReservationExternalRef): Promise<CanonicalReservation | null>;
  create(
    input: CreateReservationInput,
    context: ReservationMutationContext,
  ): Promise<CanonicalReservation>;
  transitionStatus(
    id: string,
    nextStatus: ReservationStatus,
    context: ReservationMutationContext,
  ): Promise<CanonicalReservation>;
}

export interface ExternalReservationEvent {
  organizationSlug: string;
  hotelId: string;
  provider: string;
  externalEventId: string;
  entityType: "reservation";
  payloadHash?: string | null;
  payload: unknown;
}

/**
 * Durable inbox boundary. A provider event must be recorded before it can be
 * applied to the canonical reservation ledger.
 */
export interface ExternalEventInbox {
  receive(event: ExternalReservationEvent): Promise<"received" | "duplicate">;
  markApplied(externalEventId: string): Promise<void>;
  markFailed(externalEventId: string, error: string): Promise<void>;
}
