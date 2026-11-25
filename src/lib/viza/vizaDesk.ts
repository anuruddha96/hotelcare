import { supabase } from '@/integrations/supabase/client';

/** Reception's VIZA calls: rejected guests to correct, the outage summary and the instant send. */

export type VizaPhase = 'arrival' | 'departure';

export interface VizaInstantResult {
  event_id: string;
  phase: VizaPhase;
  outcome: 'accepted' | 'rejected' | 'pending';
  receipt: string | null;
  error: string | null;
  guest_name: string | null;
  reservation_number: string | null;
}

export interface VizaSendNowResponse {
  ok: boolean;
  enabled: boolean;
  busy?: boolean;
  results: VizaInstantResult[];
  unreachable?: boolean;
  next_try_at?: string | null;
  support_notified_at?: string | null;
}

export interface VizaDeskOutage {
  since: string | null;
  last_attempt_at: string | null;
  next_try_at: string | null;
  waiting: number;
  support_notified_at: string | null;
}

export async function callVizaDesk<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('viza-thf', { body });
  if (error) {
    const parsed = await (error as { context?: Response }).context?.json().catch(() => null) as { error?: string } | null | undefined;
    throw new Error(parsed?.error ?? error.message);
  }
  if (data?.ok === false) throw new Error(String(data.error ?? 'Request failed'));
  return data as T;
}

/** Send right away (guide 6.2: at the moment of check-in) and get each guest's result back. */
export function vizaSendNow(input: { hotelId: string; reservationId?: string | null; eventId?: string | null; phase: VizaPhase }) {
  return callVizaDesk<VizaSendNowResponse>({
    action: 'desk_send_now',
    hotel_id: input.hotelId,
    reservation_id: input.reservationId ?? undefined,
    event_id: input.eventId ?? undefined,
    phase: input.phase,
  });
}

/** Opens the correction popup on the reception page for these rejected guest reports. */
export const VIZA_REJECTED_EVENT = 'hc:viza-rejected';
export interface VizaRejectedDetail { hotelId: string; eventIds: string[] }
export function announceVizaRejected(detail: VizaRejectedDetail) {
  window.dispatchEvent(new CustomEvent<VizaRejectedDetail>(VIZA_REJECTED_EVENT, { detail }));
}
