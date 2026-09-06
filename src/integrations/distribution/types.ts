export const DISTRIBUTION_CHANNELS = [
  "booking",
  "expedia",
  "agoda",
  "trip",
  "airbnb",
  "hoteltonight",
  "szallas",
] as const;

export type DistributionChannel = (typeof DISTRIBUTION_CHANNELS)[number];

/**
 * The system used to reach a channel. A direct connector can use the channel
 * itself as the provider, while an aggregator (for example Channex) can serve
 * several channels behind the same HotelCare interface.
 */
export const CONNECTIVITY_PROVIDERS = [
  "channex",
  "previo",
  ...DISTRIBUTION_CHANNELS,
] as const;

export type ConnectivityProvider = (typeof CONNECTIVITY_PROVIDERS)[number];

export const DISTRIBUTION_CAPABILITIES = [
  "rates",
  "inventory",
  "restrictions",
  "reservations",
  "property_content",
  "room_content",
  "photos",
  "promotions",
  "messaging",
  "reviews",
] as const;

export type DistributionCapability =
  (typeof DISTRIBUTION_CAPABILITIES)[number];

export type DistributionConnectionStatus =
  | "draft"
  | "connecting"
  | "active"
  | "degraded"
  | "disabled"
  | "error";

export type DistributionChangeSource =
  | "manual"
  | "revenue_engine"
  | "ai_agent"
  | "pms_sync"
  | "system";

export type DistributionChangeMode = "preview" | "execute";

export type DistributionChangeStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "executing"
  | "succeeded"
  | "partially_succeeded"
  | "failed"
  | "cancelled";

export type DistributionItemStatus =
  | "pending"
  | "validated"
  | "executing"
  | "succeeded"
  | "failed"
  | "skipped";

export interface DistributionConnection {
  id: string;
  hotelId: string;
  provider: ConnectivityProvider;
  channel: DistributionChannel;
  externalPropertyId: string;
  status: DistributionConnectionStatus;
  capabilities: DistributionCapability[];
  /**
   * Reference to a server-side credential/secret. Never store the actual OTA
   * password, token or API secret in browser-accessible state.
   */
  secretRef?: string;
  metadata?: Record<string, unknown>;
}

export interface DistributionRoomMapping {
  id: string;
  connectionId: string;
  hotelId: string;
  hotelCareRoomTypeId: string;
  externalRoomTypeId: string;
  metadata?: Record<string, unknown>;
}

export interface DistributionRateMapping {
  id: string;
  connectionId: string;
  hotelId: string;
  hotelCareRatePlanId: string;
  externalRatePlanId: string;
  hotelCareRoomTypeId?: string;
  externalRoomTypeId?: string;
  metadata?: Record<string, unknown>;
}

export interface AriRestrictions {
  minStay?: number;
  maxStay?: number;
  closedToArrival?: boolean;
  closedToDeparture?: boolean;
  stopSell?: boolean;
}

/** Canonical HotelCare availability/rate/inventory update. */
export interface AriUpdate {
  hotelId: string;
  roomTypeId: string;
  ratePlanId?: string;
  startDate: string;
  endDate?: string;
  currency?: string;
  price?: number;
  inventory?: number;
  restrictions?: AriRestrictions;
}

export type DistributionActionKind =
  | "ari"
  | "reservation_sync"
  | "property_content"
  | "room_content"
  | "photo"
  | "promotion";

export interface DistributionChangeItem<TPayload = unknown> {
  id: string;
  connectionId: string;
  channel: DistributionChannel;
  kind: DistributionActionKind;
  payload: TPayload;
  status: DistributionItemStatus;
  idempotencyKey: string;
  attempts: number;
  lastError?: string;
}

export interface DistributionChangeSet {
  id: string;
  hotelId: string;
  source: DistributionChangeSource;
  mode: DistributionChangeMode;
  status: DistributionChangeStatus;
  requestedBy?: string;
  approvedBy?: string;
  reason?: string;
  createdAt: string;
  approvedAt?: string;
  items: DistributionChangeItem[];
}

export interface DistributionHealth {
  ok: boolean;
  provider: ConnectivityProvider;
  channel: DistributionChannel;
  checkedAt: string;
  message?: string;
}

export interface DistributionActionResult {
  success: boolean;
  externalReference?: string;
  retryable?: boolean;
  message?: string;
  /** Provider response must be redacted before it reaches client code/logs. */
  providerResponse?: Record<string, unknown>;
}

export interface ReservationSyncCursor {
  cursor?: string;
  since?: string;
}

export interface ExternalReservation {
  externalReservationId: string;
  channel: DistributionChannel;
  hotelId: string;
  status: "booked" | "modified" | "cancelled" | "unknown";
  arrivalDate?: string;
  departureDate?: string;
  raw?: Record<string, unknown>;
}

export interface ReservationSyncResult {
  reservations: ExternalReservation[];
  nextCursor?: string;
}

export interface PropertyContentUpdate {
  hotelId: string;
  fields: Record<string, unknown>;
}

export interface RoomContentUpdate {
  hotelId: string;
  roomTypeId: string;
  fields: Record<string, unknown>;
}

export interface PhotoUpdate {
  hotelId: string;
  roomTypeId?: string;
  operation: "add" | "replace" | "remove" | "reorder";
  photos: Array<{
    id?: string;
    url?: string;
    storagePath?: string;
    sortOrder?: number;
    caption?: string;
  }>;
}

export interface PromotionUpdate {
  hotelId: string;
  externalPromotionId?: string;
  operation: "create" | "update" | "activate" | "deactivate";
  fields: Record<string, unknown>;
}
