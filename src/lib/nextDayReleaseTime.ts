import { supabase } from '@/integrations/supabase/client';

export const NEXT_DAY_RELEASE_TIMES = [
  '06:00',
  '06:30',
  '07:00',
  '07:30',
  '08:00',
  '08:30',
] as const;

export type NextDayReleaseTime = (typeof NEXT_DAY_RELEASE_TIMES)[number];

export const DEFAULT_NEXT_DAY_RELEASE_TIME: NextDayReleaseTime = '08:00';

export function normalizeNextDayReleaseTime(value: string | null | undefined): NextDayReleaseTime {
  const hhmm = String(value || '').slice(0, 5) as NextDayReleaseTime;
  return NEXT_DAY_RELEASE_TIMES.includes(hhmm) ? hhmm : DEFAULT_NEXT_DAY_RELEASE_TIME;
}

export async function updateNextDayReleaseTime(planId: string, releaseTime: NextDayReleaseTime) {
  const { data, error } = await (supabase as any).rpc('update_next_day_housekeeping_release_time', {
    p_plan_id: planId,
    p_release_time: releaseTime,
  });
  if (error) throw error;
  return data as {
    id: string;
    release_time: string;
    scheduled_release_at: string;
  } | null;
}
