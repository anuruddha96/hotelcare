import { supabase } from '@/integrations/supabase/client';

/** Calls the ntak-pms edge function and surfaces its error text. */
export async function callNtak<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('ntak-pms', { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx?.json) {
      const parsed = await ctx.json().catch(() => null) as { error?: string; checklist?: unknown } | null;
      if (parsed?.error) throw Object.assign(new Error(parsed.error), { details: parsed });
    }
    throw new Error(error.message || 'Request failed');
  }
  if (data?.ok === false) throw Object.assign(new Error(String(data.error ?? 'Request failed')), { details: data });
  return data as T;
}

export interface NtakIssue { field: string; value: string | null; key: string; message: string; hint?: string | null }
export interface ChecklistItem { level: 'error' | 'warning'; code: string; message: string; ref?: string }
export interface ClosureTotals { roomNights: number; guests: number; accommodationFee: number; ifa: number; charges: number; payments: number }
export interface RoomCounts { total: number; ooo: number; oos: number; rented: number; available: number }

export interface NtakSettings {
  hotel_id: string;
  enabled: boolean;
  environment: 'test' | 'production';
  endpoint_url: string | null;
  software_id: string | null;
  software_version: string;
  registration_number: string | null;
  provider_tax_number: string | null;
  accommodation_name: string | null;
  provider_name: string | null;
  unit_scope: 'all' | 'profiled_only';
  data_reporting_id: string | null;
  registered_room_count: number | null;
  registered_bed_count: number | null;
  accommodation_class: string;
  region: 'budapest' | 'countryside';
  ifa_type: 'SZAZALEKOS' | 'TETELES' | 'NINCS';
  ifa_rate: number;
  ifa_vat: number;
  accommodation_vat: number;
  signature_profile: string;
  unknown_country_code: string;
  closure_mode: 'manual' | 'auto';
  auto_close_time: string;
  first_closure_date: string | null;
  software_change_date: string | null;
  data_start_date: string | null;
  ledger_config: Record<string, unknown>;
  cert_subject: Record<string, string> | null;
  cert_not_after: string | null;
  cert_uploaded_at: string | null;
  has_pending_csr: boolean;
  pending_csr_pem: string | null;
  sending_blocked_reason: string | null;
  initial_booking_sync_started_at: string | null;
  initial_booking_sync_done_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
}

export interface NtakMessage {
  id: string; kind: 'closure' | 'booking' | 'event' | 'start_date'; ref: string; state: string; ntak_status: string | null;
  processing_id: string | null; warnings: NtakIssue[]; errors: NtakIssue[]; attempts: number; last_http_status: number | null;
  last_error: string | null; created_at: string; sent_at: string | null; verified_at: string | null; next_attempt_at: string; expected_start_date: string | null;
}

export interface NtakClosureRow {
  closed_day: string; state: string; classification: 'UJ' | 'MODOSITO'; protocol_id: string | null; reason: string | null;
  closed_at: string; accepted_once: boolean; needs_correction: boolean; totals: ClosureTotals | null; checklist: ChecklistItem[] | null;
}

export interface NtakUnitRow {
  room_id: string; building: string; room_number: string; unit_type: string; single_beds: number; double_beds: number; extra_beds: number; active: boolean;
}

export interface NtakStatus {
  can_manage: boolean;
  settings: NtakSettings | null;
  configuration_problems: string[];
  messages: NtakMessage[];
  closures: NtakClosureRow[];
  missing_closures: string[];
  units: NtakUnitRow[];
  room_types: { id: string; name: string; ntak: { unit_type: string; capacity: number; active: boolean } | null }[];
  rooms: { id: string; room_number: string; wing: string | null; room_capacity: number | null }[];
  booking_problems: { booking_no: string; dirty_at: string; last_sent_at: string | null; last_problem: string }[];
  pending_events: { id: string; reservation_id: string; kind: string; occurred_at: string; state: string; last_error: string | null; is_correction: boolean }[];
  today: string;
}

export interface ClosurePreview {
  day: string;
  classification: 'UJ' | 'MODOSITO';
  checklist: ChecklistItem[];
  totals: ClosureTotals;
  closure: { rooms: RoomCounts; capacity: RoomCounts; nights: unknown[]; checkoutSales: unknown[] };
  xml: string;
}

export const UNIT_TYPES = [
  'ECONOMY', 'STANDARD', 'SUPERIOR', 'JUNIOR_SUITE', 'SUITE', 'APARTMAN', 'PRIVAT_SZOBA_SAJAT_FURDOVEL', 'PRIVAT_SZOBA_KOZOS_FURDOVEL',
  'HALOTERMI_AGY', 'EGYEDI', 'MOBILHAZ', 'UDULOHAZ', 'PARCELLA', 'SATORHELY_KEMPINGHELY', 'EGYEB',
] as const;

export const ACCOMMODATION_CLASSES = [
  'hotel_5', 'hotel_4', 'hotel_3', 'hotel_2', 'hotel_1', 'hotel_unrated', 'guesthouse', 'camping', 'community', 'holiday_home', 'other', 'private', 'holiday_boat',
] as const;

export const fmtHuf = (n: number) => `${Math.round(n).toLocaleString('hu-HU')} Ft`;
