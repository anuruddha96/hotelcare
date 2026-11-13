// Browser-side helpers for the native ARI store and the Channex workers.
// All writes go through SECURITY DEFINER RPCs or edge functions that check
// hotel access server-side; the browser never sees the Channex API key.
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
  native: boolean; publishing: boolean; room_types: AriRoomType[]; rate_plans: AriRatePlan[];
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

export type WorkerResult = { ok: boolean; error?: string; [key: string]: unknown };

async function invoke(fn: string, body: Record<string, unknown>): Promise<WorkerResult> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    // supabase-js wraps non-2xx; surface the function's own message when present.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = (error as any)?.context;
    try {
      const parsed = ctx && typeof ctx.json === "function" ? await ctx.json() : null;
      if (parsed?.error) return { ok: false, error: String(parsed.error) };
    } catch { /* ignore */ }
    return { ok: false, error: error.message };
  }
  return data as WorkerResult;
}

export const channexAri = (action: string, hotelId: string, extra: Record<string, unknown> = {}) =>
  invoke("channex-ari-worker", { action, hotel_id: hotelId, ...extra });
export const channexBookings = (action: string, hotelId: string) =>
  invoke("channex-booking-worker", { action, hotel_id: hotelId });

export function collectTaskIds(result: WorkerResult): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v)) {
        if (k === "task_ids" && Array.isArray(val)) out.push(...val.map(String));
        else walk(val);
      }
    }
  };
  walk(result);
  return out;
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
