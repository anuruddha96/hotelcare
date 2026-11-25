/**
 * What happened to each guest of a THF submission, and when a failed send is
 * tried again.
 *
 * The THF answers per guest (hibaLista): "OK" or one or more error codes with
 * an explanation. A guest the THF rejects has a data problem — sending the
 * same data again cannot succeed, so it waits for staff to correct the guest
 * and press "send again". A send that failed for technical reasons is retried
 * automatically on the schedule the interface guide recommends (6.2).
 */
import { readXmlTag, readXmlTags } from './messages.ts';

export type GuestOutcome =
  | { erkezesAzonosito: string; result: 'accepted' }
  | { erkezesAzonosito: string; result: 'resend' }
  | { erkezesAzonosito: string; result: 'rejected'; code: string; text: string };

export interface SubmissionOutcome {
  accepted: boolean;
  fogadasAzonosito: string | null;
  guests: GuestOutcome[];
}

/** Null when the reply is not a submission answer at all (SOAP fault, proxy page, empty body). */
export function readSubmissionOutcome(responseXml: string | null | undefined, erkezesAzonositok: string[]): SubmissionOutcome | null {
  const xml = String(responseXml ?? '');
  const flag = readXmlTag(xml, 'sikeresBefogadas');
  if (flag !== 'true' && flag !== 'false') return null;
  const accepted = flag === 'true';
  const byId = new Map(readXmlTags(xml, 'hibaLista').map((item) => [
    String(readXmlTag(item, 'erkezesAzonosito') ?? '').toLowerCase(),
    { code: String(readXmlTag(item, 'hibaKod') ?? '').trim(), text: String(readXmlTag(item, 'hibaSzoveg') ?? '').trim() },
  ]));
  const guests = erkezesAzonositok.map((id): GuestOutcome => {
    const item = byId.get(id.toLowerCase());
    if (item && item.code && item.code !== 'OK') {
      return { erkezesAzonosito: id, result: 'rejected', code: item.code, text: item.text };
    }
    // In a message the THF refused as a whole, the guests without an error were not stored either.
    return { erkezesAzonosito: id, result: accepted ? 'accepted' : 'resend' };
  });
  // Refused with no guest named: nothing identifies a data problem, so treat it as a failed send.
  if (!accepted && !guests.some((g) => g.result === 'rejected')) return null;
  return { accepted, fogadasAzonosito: readXmlTag(xml, 'fogadasAzonosito'), guests };
}

/** `attempts` value that marks a guest the THF rejected: never retried automatically. */
export const NEEDS_CORRECTION = 1000;

/**
 * Minutes to wait before the next automatic try, by failed sends so far.
 * Guide 6.2: three tries in quick succession, then 10 minutes, 1 hour,
 * 6 hours, then every 24 hours without end. The three quick tries happen
 * inside one worker run; the worker itself runs every 10 minutes.
 */
export function retryDelayMinutes(attempts: number): number {
  if (attempts <= 1) return 0; // next worker run (≤ 10 minutes)
  if (attempts === 2) return 60;
  if (attempts === 3) return 360;
  return 1440;
}

export function nextAttemptAt(attempts: number, lastTriedAt: string | Date): Date | null {
  if (attempts >= NEEDS_CORRECTION) return null;
  return new Date(new Date(lastTriedAt).getTime() + retryDelayMinutes(attempts) * 60_000);
}

export function isDue(attempts: number, lastTriedAt: string | Date, now = new Date()): boolean {
  const next = nextAttemptAt(attempts, lastTriedAt);
  return !!next && next.getTime() <= now.getTime();
}

/**
 * Which waiting reports a send may include.
 * - "worker" (every 10 minutes): each report whose place in the retry schedule has come.
 * - "instant" (reception, right after a check-in, check-out or correction): only reports never
 *   tried yet. Reports that already failed stay on the worker's schedule. Otherwise every check-in
 *   during an outage would also retry the older reports and use up their retry steps, pushing them
 *   to the 1-hour, 6-hour and 24-hour waits, so they would reach the VIZA long after the THF is back.
 */
export function isDueFor(mode: 'worker' | 'instant', attempts: number, lastTriedAt: string | Date, now = new Date()): boolean {
  return mode === 'instant' ? attempts === 0 : isDue(attempts, lastTriedAt, now);
}

/** The worker (cron job "viza-thf-worker-10min") runs every 10 minutes, at minute 4, 14, …, 54. */
export const WORKER_MINUTE = 4;

/**
 * The first worker run at or after `t`: when the next connection check happens, and when a
 * waiting report really goes out. Shown to reception as "next automatic try".
 * Budapest is a whole number of hours from UTC, so the minute is the same in both.
 */
export function workerRunAtOrAfter(t: string | Date): Date {
  const at = new Date(t);
  const slot = new Date(at.getTime());
  slot.setUTCSeconds(0, 0);
  slot.setUTCMinutes(slot.getUTCMinutes() + ((WORKER_MINUTE - (slot.getUTCMinutes() % 10) + 10) % 10));
  if (slot.getTime() < at.getTime()) slot.setUTCMinutes(slot.getUTCMinutes() + 10);
  return slot;
}

/** When a failed report goes out again: its retry time, rounded up to the worker run that sends it. */
export function nextSendAt(attempts: number, lastTriedAt: string | Date): Date | null {
  const next = nextAttemptAt(attempts, lastTriedAt);
  return next ? workerRunAtOrAfter(next) : null;
}
