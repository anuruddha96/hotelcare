// Durable "who changed what price, when" trail for the Rate & pickup calendar.
//
// Drafting a price and pushing it to Previo both leave a row in
// `rate_change_audit`, so the grid can show a cell's history on hover and the
// activity panel can list everything a user did.

import { supabase } from "@/integrations/supabase/client";

export interface RateAuditRow {
  id: string;
  stay_date: string | null;
  action: string;
  source: string | null;
  old_rate_eur: number | null;
  new_rate_eur: number | null;
  delta_eur: number | null;
  notes: string | null;
  performed_at: string;
  performed_by: string | null;
  payload: {
    room_type_name?: string;
    occupancy?: number;
    batch_id?: string;
    percent?: number | null;
    requested_price?: number | null;
    actual_previo_price?: number | null;
    confirmation_status?: string;
    push_run_id?: string | null;
    origin?: string | null;
    /** Set when someone checked Previo and closed a "did not land" flag. */
    resolved_at?: string | null;
    resolved_by?: string | null;
  } | null;

}

export interface RateAuditInput {
  hotelId: string;
  organizationSlug: string | null;
  /** Where the change came from: "day-tool", "cell-edit", "demand", "push". */
  source: string;
  action: string;
  batchId?: string;
  changes: Array<{
    stay_date: string;
    room_type_name: string;
    occupancy: number;
    old_price: number | null;
    new_price: number;
  }>;
  notes?: string | null;
}

export function cellKey(date: string, roomTypeName: string, occupancy: number) {
  return `${date}|${roomTypeName}|${occupancy}`;
}

/** "Today 09:14", "Yesterday 18:12", then "7 Aug 11:20". */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((day(new Date()) - day(d)) / 86400000);
  if (diffDays === 0) return `Today ${time}`;
  if (diffDays === 1) return `Yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
}


/** Percent change, rounded to one decimal, or null when there is no base. */
export function percentChange(from: number | null, to: number): number | null {
  if (from === null || !Number.isFinite(from) || from === 0) return null;
  return Math.round(((to - from) / from) * 1000) / 10;
}

/**
 * Record a batch of price changes. Never throws — an audit failure must not
 * cost the user their drafts.
 */
export async function logRateChanges(input: RateAuditInput): Promise<void> {
  if (!input.organizationSlug || input.changes.length === 0) return;
  try {
    const { data: auth } = await supabase.auth.getUser();
    const batch = input.batchId ?? crypto.randomUUID();
    const rows = input.changes.map((c) => ({
      hotel_id: input.hotelId,
      organization_slug: input.organizationSlug as string,
      action: input.action,
      source: input.source,
      stay_date: c.stay_date,
      old_rate_eur: c.old_price,
      new_rate_eur: c.new_price,
      delta_eur: c.old_price === null ? null : Math.round((c.new_price - c.old_price) * 100) / 100,
      notes: input.notes ?? null,
      performed_by: auth.user?.id ?? null,
      payload: {
        room_type_name: c.room_type_name,
        occupancy: c.occupancy,
        batch_id: batch,
        percent: percentChange(c.old_price, c.new_price),
      },
    }));
    await supabase.from("rate_change_audit").insert(rows);
  } catch {
    /* the trail is a convenience — never block the price change */
  }
}

/** Human wording for one audit row, e.g. "raised from €111 to €123 (+11%)". */
export function describeChange(row: RateAuditRow, money: (v: number | null) => string): string {
  const from = row.old_rate_eur;
  const to = row.new_rate_eur;
  if (to === null) return row.action;
  const dir = from === null ? "set" : to > from ? "raised" : to < from ? "lowered" : "kept";
  const pct = row.payload?.percent;
  const pctText = pct === null || pct === undefined ? "" : ` (${pct > 0 ? "+" : ""}${pct}%)`;
  return from === null
    ? `${dir} to ${money(to)}`
    : `${dir} ${money(from)} → ${money(to)}${pctText}`;
}

/**
 * Close out "did not land" flags after someone has checked Previo.
 *
 * The flag is a note in the trail, not a live state, so it used to stay red
 * forever even once Previo held the right price. Marking the rows resolved
 * keeps the history readable while clearing the red rings from the calendar.
 */
export async function resolveRateMismatches(rows: RateAuditRow[]): Promise<number> {
  const open = rows.filter((r) => r.source === "previo_different" && !r.payload?.resolved_at);
  if (open.length === 0) return 0;
  const { data: auth } = await supabase.auth.getUser();
  const at = new Date().toISOString();
  let done = 0;
  for (let i = 0; i < open.length; i += 25) {
    const slice = open.slice(i, i + 25);
    const results = await Promise.all(slice.map((r) => supabase
      .from("rate_change_audit")
      .update({ payload: { ...(r.payload ?? {}), resolved_at: at, resolved_by: auth.user?.id ?? null } as never })
      .eq("id", r.id)));
    done += results.filter((res) => !res.error).length;
  }
  return done;
}
