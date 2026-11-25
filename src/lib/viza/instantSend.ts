import { toast } from 'sonner';
import { announceVizaRejected, vizaSendNow, type VizaPhase, type VizaSendNowResponse } from './vizaDesk';
import { vizaRejectionReason } from './vizaReason';

type T = (key: string) => string;

const hhmm = (iso: string) => new Intl.DateTimeFormat('hu-HU', {
  timeZone: 'Europe/Budapest', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(iso));

/**
 * Right after check-in, check-out or a correction: send to VIZA in the background and show
 * the result as a small note. Never blocks reception and never throws: if the call itself
 * fails, the 10-minute run sends the data anyway. A rejection also opens the correction popup.
 */
export async function startVizaInstantSend(input: {
  hotelId: string; reservationId?: string | null; eventId?: string | null; phase: VizaPhase; t: T;
}): Promise<VizaSendNowResponse | null> {
  const { t } = input;
  const id = `viza-${input.eventId ?? input.reservationId}-${input.phase}`;
  // Only say "sending" if it takes a moment; hotels without VIZA see nothing at all.
  const slow = setTimeout(() => toast.loading(t('pms.viza.instant.sending'), { id, duration: 30_000 }), 700);
  try {
    const res = await vizaSendNow(input);
    clearTimeout(slow);
    if (!res.enabled || !res.results.length) { toast.dismiss(id); return res; }
    const rejected = res.results.filter((r) => r.outcome === 'rejected');
    const accepted = res.results.filter((r) => r.outcome === 'accepted');
    const names = (rows: typeof res.results) => rows.map((r) => r.guest_name).filter(Boolean).join(', ');
    if (rejected.length) {
      toast.error(t('pms.viza.instant.rejected'), { id, description: `${names(rejected)} · ${vizaRejectionReason(rejected[0].error, t)}`, duration: 10_000 });
      announceVizaRejected({ hotelId: input.hotelId, eventIds: rejected.map((r) => r.event_id) });
    } else if (accepted.length === res.results.length) {
      toast.success(t(accepted[0].phase === 'departure' ? 'pms.viza.instant.acceptedDeparture' : 'pms.viza.instant.acceptedArrival'), { id, description: names(accepted), duration: 5_000 });
    } else if (res.unreachable) {
      const hint = res.next_try_at ? t('pms.viza.instant.unreachableHint').replace('{time}', hhmm(res.next_try_at)) : t('pms.viza.outageNothingQueued');
      toast.warning(t('pms.viza.instant.unreachable'), { id, description: hint, duration: 9_000 });
    } else {
      toast.message(t('pms.viza.instant.pending'), { id, duration: 5_000 });
    }
    return res;
  } catch {
    clearTimeout(slow);
    toast.dismiss(id);
    return null;
  }
}
