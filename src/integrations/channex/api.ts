import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

/** Browser side of the Channex integration. All provider calls happen in the channex-admin edge function. */

export type ChannexMode = 'off' | 'dry_run' | 'live';
export type ChannexEnvironment = 'staging' | 'production';
export type NtakPath = 'unconfirmed' | 'hotelcare_registered' | 'previo_receives_bookings' | 'other_registered_software';

export type ChannexConnection = {
  hotel_id: string;
  environment: ChannexEnvironment;
  mode: ChannexMode;
  kill_switch: boolean;
  is_sandbox_hotel: boolean;
  channex_property_id: string | null;
  channex_webhook_id: string | null;
  currency: string;
  primary_occupancy: number;
  ntak_reporting_path: NtakPath;
  viza_document_scan_confirmed: boolean;
  tax_settings_confirmed: boolean;
  dpa_signed: boolean;
  single_publisher_confirmed: boolean;
  certified_at: string | null;
  owner_approved_at: string | null;
  last_feed_ok_at: string | null;
  last_ari_push_at: string | null;
  last_error: string | null;
};

export type ProductionGate = Record<'ntak' | 'viza' | 'tax' | 'dpa' | 'single_publisher' | 'certified' | 'owner_approved' | 'not_sandbox', boolean>;

export type ChannexStatus = {
  hotel_name: string | null;
  connection: ChannexConnection | null;
  gate: ProductionGate | null;
  keys: Record<ChannexEnvironment, boolean>;
  webhook_url: string | null;
  room_types: { id: string; name: string; num_rooms: number; is_sellable: boolean }[];
  mappings: { id: string; kind: 'room_type' | 'rate_plan'; local_id: string; channex_id: string; channex_title: string | null }[];
  outbox: {
    id: string; kind: string; mode: string; status: string; is_full_sync: boolean; value_count: number; attempts: number;
    task_ids: string[] | null; warnings: unknown[] | null; last_error: string | null; created_at: string; sent_at: string | null;
  }[];
  revisions: {
    revision_id: string; revision_status: string | null; ota_name: string | null; ota_reservation_code: string | null;
    arrival_date: string | null; departure_date: string | null; state: string; received_via: string;
    acked_at: string | null; last_error: string | null; ack_error: string | null; created_at: string;
  }[];
  review_cases: { id: string; reason: string; details: Record<string, unknown>; status: string; created_at: string; resolution_note: string | null }[];
  audit: { id: number; action: string; details: Record<string, unknown>; created_at: string }[];
  health: { oldest_unacked_minutes: number | null };
  permissions: { manage: boolean; owner: boolean; review: boolean; super_admin: boolean };
};

export class ChannexApiError extends Error {}

export async function channexAdmin<T = Record<string, unknown>>(action: string, hotelId: string, params: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('channex-admin', { body: { action, hotel_id: hotelId, ...params } });
  if (error) {
    let message = 'The channel manager service could not be reached';
    if (error instanceof FunctionsHttpError) {
      const body = await error.context.json().catch(() => null);
      if (body?.error) message = String(body.error);
    }
    throw new ChannexApiError(message);
  }
  if (!data?.ok) throw new ChannexApiError(String(data?.error ?? 'Request failed'));
  return data as T;
}

export const MODE_LABEL: Record<ChannexMode, string> = { off: 'Off', dry_run: 'Dry run', live: 'Live' };

export const NTAK_OPTIONS: { value: NtakPath; label: string }[] = [
  { value: 'unconfirmed', label: 'Not confirmed yet' },
  { value: 'hotelcare_registered', label: 'HotelCare is the hotel’s NTAK-registered software' },
  { value: 'previo_receives_bookings', label: 'Previo stays the NTAK software and receives every OTA booking' },
  { value: 'other_registered_software', label: 'Another NTAK-registered software receives every booking' },
];

export const GATE_LABEL: Record<keyof ProductionGate, string> = {
  ntak: 'NTAK reporting path confirmed',
  viza: 'VIZA: guest ID scanned with the document reader at check-in',
  tax: 'Invoicing: 5% accommodation VAT, IFA and TFH configured',
  dpa: 'GDPR data processing agreement with Channex signed',
  single_publisher: 'Only one system publishes rates and availability',
  certified: 'Channex PMS certification passed',
  owner_approved: 'Owner approval recorded',
  not_sandbox: 'Not a sandbox/test hotel',
};

/** Plain-language labels for revision / review states shown to front office. */
export const REVIEW_REASON: Record<string, string> = {
  ota_modification: 'Guest changed the booking on the OTA: update the reservation by hand',
  cancellation_for_unknown_booking: 'Cancellation for a booking HotelCare never received',
  unmapped_room_type: 'Booked room type is not mapped: assign a room type',
  currency_mismatch: 'Booking currency differs from the hotel currency',
  property_mismatch: 'Booking belongs to a different Channex property',
  booking_without_dates: 'Booking arrived without usable dates',
  unknown_revision_status: 'Unknown booking status from Channex',
};
export const reviewReasonLabel = (reason: string) =>
  reason.split('+').map((r) => REVIEW_REASON[r] ?? r.replaceAll('_', ' ')).join(' · ');
