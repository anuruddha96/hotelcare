import { supabase } from '@/integrations/supabase/client';
import type {
  ParkingAccess,
  ParkingAccessUser,
  ParkingBatch,
  ParkingSettings,
  ParkingStockSummary,
  ParkingTicket,
  ParkingTicketEvent,
  ParkingSearchStatus,
} from '@/lib/parking';

const db = supabase as unknown as {
  rpc: CallableFunction;
  from: CallableFunction;
};

function singleResult<T>(data: T | T[] | null): T | null {
  if (Array.isArray(data)) return data[0] ?? null;
  return data;
}

function throwIfError(error: unknown): void {
  if (error) throw error;
}

export async function getParkingAccess(organizationSlug: string, hotelId: string): Promise<ParkingAccess> {
  const { data, error } = await db.rpc('parking_access_level', {
    _organization_slug: organizationSlug,
    _hotel_id: hotelId,
  });
  throwIfError(error);
  return data === 'manage' || data === 'issue' ? data : 'none';
}

export async function getParkingSettings(
  organizationSlug: string,
  hotelId: string,
): Promise<ParkingSettings | null> {
  const { data, error } = await db
    .from('parking_settings')
    .select('*')
    .eq('organization_slug', organizationSlug)
    .eq('hotel_id', hotelId)
    .maybeSingle();
  throwIfError(error);
  return data as ParkingSettings | null;
}

export async function saveParkingSettings(input: {
  organizationSlug: string;
  hotelId: string;
  providerName: string;
  notificationEmails: string[];
  defaultValidityDays: number;
}): Promise<ParkingSettings> {
  const { data, error } = await db.rpc('parking_save_settings', {
    _organization_slug: input.organizationSlug,
    _hotel_id: input.hotelId,
    _provider_name: input.providerName,
    _notification_emails: input.notificationEmails,
    _default_validity_days: input.defaultValidityDays,
  });
  throwIfError(error);
  const result = singleResult<ParkingSettings>(data);
  if (!result) throw new Error('Parking settings were not returned.');
  return result;
}

export async function getParkingStock(
  organizationSlug: string,
  hotelId: string,
): Promise<ParkingStockSummary> {
  const { data, error } = await db.rpc('parking_stock_summary', {
    _organization_slug: organizationSlug,
    _hotel_id: hotelId,
  });
  throwIfError(error);
  const row = singleResult<Record<string, unknown>>(data) || {};
  return {
    total: Number(row.total || 0),
    available: Number(row.available || 0),
    active: Number(row.active || 0),
    expired: Number(row.expired || 0),
    void: Number(row.void || 0),
    unreported_expired: Number(row.unreported_expired || 0),
  };
}

export async function listParkingBatches(
  organizationSlug: string,
  hotelId: string,
): Promise<ParkingBatch[]> {
  const { data, error } = await db.rpc('parking_list_batches', {
    _organization_slug: organizationSlug,
    _hotel_id: hotelId,
  });
  throwIfError(error);
  return (data || []).map((row: Record<string, unknown>) => ({
    ...row,
    ticket_count: Number(row.ticket_count || 0),
    available: Number(row.available || 0),
    issued: Number(row.issued || 0),
    void: Number(row.void || 0),
  })) as ParkingBatch[];
}

export async function createParkingBatch(input: {
  organizationSlug: string;
  hotelId: string;
  rangeStart: string;
  rangeEnd: string;
  expiresOn: string | null;
  label: string | null;
}): Promise<ParkingBatch> {
  const { data, error } = await db.rpc('parking_create_batch', {
    _organization_slug: input.organizationSlug,
    _hotel_id: input.hotelId,
    _range_start: input.rangeStart,
    _range_end: input.rangeEnd,
    _expires_on: input.expiresOn,
    _label: input.label,
  });
  throwIfError(error);
  const result = singleResult<ParkingBatch>(data);
  if (!result) throw new Error('The new parking batch was not returned.');
  return result;
}

export async function deleteParkingBatch(batchId: string): Promise<void> {
  const { error } = await db.rpc('parking_delete_batch', { _batch_id: batchId });
  throwIfError(error);
}

export async function issueParkingTicket(input: {
  organizationSlug: string;
  hotelId: string;
  reference: string;
  validFrom: string;
  validTo: string;
  reservationRef: string | null;
  guestName: string | null;
  roomNumber: string | null;
  notes: string | null;
}): Promise<ParkingTicket> {
  const { data, error } = await db.rpc('parking_issue_ticket', {
    _organization_slug: input.organizationSlug,
    _hotel_id: input.hotelId,
    _reference: input.reference,
    _valid_from: input.validFrom,
    _valid_to: input.validTo,
    _reservation_ref: input.reservationRef,
    _guest_name: input.guestName,
    _room_number: input.roomNumber,
    _notes: input.notes,
  });
  throwIfError(error);
  const result = singleResult<ParkingTicket>(data);
  if (!result) throw new Error('The issued parking ticket was not returned.');
  return result;
}

export async function updateParkingTicket(input: {
  ticketId: string;
  validFrom: string;
  validTo: string;
  reservationRef: string | null;
  guestName: string | null;
  roomNumber: string | null;
  notes: string | null;
}): Promise<ParkingTicket> {
  const { data, error } = await db.rpc('parking_update_ticket', {
    _ticket_id: input.ticketId,
    _valid_from: input.validFrom,
    _valid_to: input.validTo,
    _reservation_ref: input.reservationRef,
    _guest_name: input.guestName,
    _room_number: input.roomNumber,
    _notes: input.notes,
  });
  throwIfError(error);
  const result = singleResult<ParkingTicket>(data);
  if (!result) throw new Error('The updated parking ticket was not returned.');
  return result;
}

export async function voidParkingTicket(ticketId: string, reason: string): Promise<ParkingTicket> {
  const { data, error } = await db.rpc('parking_void_ticket', {
    _ticket_id: ticketId,
    _reason: reason,
  });
  throwIfError(error);
  const result = singleResult<ParkingTicket>(data);
  if (!result) throw new Error('The voided parking ticket was not returned.');
  return result;
}

export async function setCancellationReported(
  ticketId: string,
  reported: boolean,
): Promise<ParkingTicket> {
  const { data, error } = await db.rpc('parking_set_cancellation_reported', {
    _ticket_id: ticketId,
    _reported: reported,
  });
  throwIfError(error);
  const result = singleResult<ParkingTicket>(data);
  if (!result) throw new Error('The parking ticket was not returned.');
  return result;
}

export async function searchParkingTickets(input: {
  organizationSlug: string;
  hotelId: string;
  query?: string;
  status?: ParkingSearchStatus;
  limit?: number;
}): Promise<ParkingTicket[]> {
  const { data, error } = await db.rpc('parking_search_tickets', {
    _organization_slug: input.organizationSlug,
    _hotel_id: input.hotelId,
    _query: input.query || '',
    _status: input.status || 'all',
    _limit: input.limit || 100,
  });
  throwIfError(error);
  return (data || []) as ParkingTicket[];
}

export async function listParkingEvents(ticketId: string): Promise<ParkingTicketEvent[]> {
  const { data, error } = await db
    .from('parking_ticket_events')
    .select('id,ticket_id,event_type,actor_id,actor_name,details,created_at')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: false });
  throwIfError(error);
  return (data || []) as ParkingTicketEvent[];
}

export async function listParkingUsers(
  organizationSlug: string,
  hotelId: string,
): Promise<ParkingAccessUser[]> {
  const { data, error } = await db.rpc('parking_list_users', {
    _organization_slug: organizationSlug,
    _hotel_id: hotelId,
  });
  throwIfError(error);
  return (data || []) as ParkingAccessUser[];
}

export async function setParkingUserAccess(input: {
  organizationSlug: string;
  hotelId: string;
  userId: string;
  accessLevel: ParkingAccess;
}): Promise<void> {
  const { error } = await db.rpc('parking_set_user_access', {
    _organization_slug: input.organizationSlug,
    _hotel_id: input.hotelId,
    _user_id: input.userId,
    _access_level: input.accessLevel,
  });
  throwIfError(error);
}
