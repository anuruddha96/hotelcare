// Browser side of the native rates & availability store (Reception -> Rates & Availability).
// Writes go through the SECURITY DEFINER RPC pms_ari_save, which checks hotel access.
// Publishing to Channex happens server-side from the change signals (channex-ari-worker).
import { supabase } from "@/integrations/supabase/client";

// The generated Database types do not include the Channex tables/RPCs yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type AriRoomType = { id: string; name: string; num_rooms: number };
export type AriRatePlan = { id: string; name: string; room_type_id: string | null; base_rate: number; currency: string | null; code: string | null };
export type AriAvailabilityRow = { room_type_id: string; date: string; total_rooms: number; booked: number; out_of_order: number; sell_limit: number | null; availability: number };
export type AriRateRow = {
  rate_plan_id: string; date: string; rate: number | null; min_stay_arrival: number | null; min_stay_through: number | null;
  max_stay: number | null; closed_to_arrival: boolean | null; closed_to_departure: boolean | null; stop_sell: boolean | null;
};
export type AriGrid = {
  native: boolean; publishing: boolean; mode: 'off' | 'dry_run' | 'live' | null; room_types: AriRoomType[]; rate_plans: AriRatePlan[];
  availability: AriAvailabilityRow[]; rates: AriRateRow[]; pending_outbox: number;
};

export type RateField = "rate" | "min_stay_arrival" | "min_stay_through" | "max_stay" | "closed_to_arrival" | "closed_to_departure" | "stop_sell";
export type RateChange = { rate_plan_id: string; date_from: string; date_to: string; weekdays?: number[] } & Partial<Record<RateField, number | boolean>>;
export type AvailabilityChange = { room_type_id: string; date_from: string; date_to: string; weekdays?: number[]; availability?: number };
export type AriChanges = { rates: RateChange[]; availability: AvailabilityChange[] };

export async function loadAriGrid(hotelId: string, from: string, to: string): Promise<AriGrid> {
  const { data, error } = await db.rpc("pms_ari_grid", { _hotel_id: hotelId, _from: from, _to: to });
  if (error) throw new Error(error.message);
  return data as AriGrid;
}

export async function saveAri(hotelId: string, changes: AriChanges) {
  const { data, error } = await db.rpc("pms_ari_save", { _hotel_id: hotelId, _changes: changes });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; rate_days: number; availability_days: number; publishing: boolean };
}

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) out.push(d);
  return out;
}
