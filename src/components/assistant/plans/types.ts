import type { RatePlan } from '../../../../supabase/functions/_shared/ratePlan';
import type { PlannedCell, SchedulePlan } from '../../../../supabase/functions/_shared/schedulePlanner';

export type { RatePlan, PlannedCell, SchedulePlan };

/** The schedule plan as stored for the card (planner output + names and context). */
export type ScheduleCardPlan = SchedulePlan & {
  hotelName?: string;
  department?: string;
  staffNames?: Record<string, string>;
  existing?: Record<string, Record<string, string>>;
};

export type RequestStatus = 'pending' | 'approved' | 'applying' | 'applied' | 'partially_applied' | 'failed' | 'dismissed' | 'expired';

export type ActionRequestRow = {
  id: string;
  kind: 'rate_plan' | 'schedule_plan';
  title: string;
  summary: string | null;
  hotel_id: string;
  plan: RatePlan | ScheduleCardPlan;
  plan_hash: string;
  status: RequestStatus;
  approved_items: string[] | null;
  consent_text: string | null;
  decided_by_name: string | null;
  decided_by_role: string | null;
  decided_at: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  applied_at: string | null;
  expires_at: string;
  created_at: string;
};

export type ActionRequestAttachment = {
  kind: 'action_request';
  requestId: string;
  requestKind: 'rate_plan' | 'schedule_plan';
  title: string;
};

export function isActionRequestAttachment(value: unknown): value is ActionRequestAttachment {
  return Boolean(value) && typeof value === 'object'
    && (value as { kind?: unknown }).kind === 'action_request'
    && typeof (value as { requestId?: unknown }).requestId === 'string';
}

export function isRatePlan(value: unknown): value is RatePlan {
  return Boolean(value) && typeof value === 'object' && (value as { kind?: unknown }).kind === 'rate_plan'
    && Array.isArray((value as { days?: unknown }).days);
}

const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
export function dayLabel(date: string): string {
  return DAY.format(new Date(`${date}T12:00:00Z`));
}

export function money(value: number | null | undefined, currency = 'EUR'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}

export function hours(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  const h = Math.round(minutes / 6) / 10;
  return `${h > 0 && !Number.isInteger(h) ? h.toFixed(1) : h} h`;
}

export function signedHours(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  const h = Math.round(minutes / 6) / 10;
  return `${h > 0 ? '+' : ''}${h} h`;
}

export function when(value: string | null | undefined): string {
  if (!value) return '';
  return new Date(value).toLocaleString('en-GB', { timeZone: 'Europe/Budapest', dateStyle: 'medium', timeStyle: 'short' });
}
