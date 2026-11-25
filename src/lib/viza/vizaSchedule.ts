/**
 * The VIZA worker (cron job "viza-thf-worker-10min") runs every 10 minutes, at minute 4, 14, …, 54.
 * Same rule as workerRunAtOrAfter in supabase/functions/_shared/viza/outcome.ts; a test keeps them equal.
 */
export const VIZA_WORKER_MINUTE = 4;

/**
 * The first worker run at or after `t`: the next automatic connection check, when waiting guest
 * reports go out. Budapest is a whole number of hours from UTC, so the minute is the same in both.
 */
export function vizaWorkerRunAtOrAfter(t: Date | string | number = Date.now()): Date {
  const at = new Date(t);
  const slot = new Date(at.getTime());
  slot.setUTCSeconds(0, 0);
  slot.setUTCMinutes(slot.getUTCMinutes() + ((VIZA_WORKER_MINUTE - (slot.getUTCMinutes() % 10) + 10) % 10));
  if (slot.getTime() < at.getTime()) slot.setUTCMinutes(slot.getUTCMinutes() + 10);
  return slot;
}
