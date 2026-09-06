import type {
  AriUpdate,
  DistributionActionResult,
  DistributionCapability,
  DistributionChannel,
  DistributionHealth,
  ExternalReservation,
  PhotoUpdate,
  PropertyContentUpdate,
  PromotionUpdate,
  ReservationSyncCursor,
  ReservationSyncResult,
  RoomContentUpdate,
} from "./types";

export interface DistributionAdapterContext {
  connectionId: string;
  hotelId: string;
  externalPropertyId: string;
  channel: DistributionChannel;
  /**
   * Adapter implementations should resolve credentials server-side from this
   * reference. The actual credential must never be passed from the browser.
   */
  secretRef?: string;
  metadata?: Record<string, unknown>;
}

export interface DistributionAdapter {
  readonly provider: string;
  readonly capabilities: ReadonlySet<DistributionCapability>;

  healthCheck(
    context: DistributionAdapterContext,
  ): Promise<DistributionHealth>;

  pushAri?(
    context: DistributionAdapterContext,
    update: AriUpdate,
    idempotencyKey: string,
  ): Promise<DistributionActionResult>;

  pullReservations?(
    context: DistributionAdapterContext,
    cursor?: ReservationSyncCursor,
  ): Promise<ReservationSyncResult>;

  acknowledgeReservation?(
    context: DistributionAdapterContext,
    reservation: ExternalReservation,
  ): Promise<DistributionActionResult>;

  updatePropertyContent?(
    context: DistributionAdapterContext,
    update: PropertyContentUpdate,
    idempotencyKey: string,
  ): Promise<DistributionActionResult>;

  updateRoomContent?(
    context: DistributionAdapterContext,
    update: RoomContentUpdate,
    idempotencyKey: string,
  ): Promise<DistributionActionResult>;

  updatePhotos?(
    context: DistributionAdapterContext,
    update: PhotoUpdate,
    idempotencyKey: string,
  ): Promise<DistributionActionResult>;

  upsertPromotion?(
    context: DistributionAdapterContext,
    update: PromotionUpdate,
    idempotencyKey: string,
  ): Promise<DistributionActionResult>;
}

export const supportsCapability = (
  adapter: DistributionAdapter,
  capability: DistributionCapability,
): boolean => adapter.capabilities.has(capability);

export const requireCapability = (
  adapter: DistributionAdapter,
  capability: DistributionCapability,
): void => {
  if (!supportsCapability(adapter, capability)) {
    throw new Error(
      `Distribution adapter ${adapter.provider} does not support ${capability}`,
    );
  }
};
