import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle, CheckCircle2, Clock3 } from 'lucide-react';

type Service = { service: string; label: string; dueNight: number; dueDate: string };
type ExtensionReview = {
  id: string;
  room_id: string;
  arrival_date: string;
  original_checkout_date: string;
  previous_checkout_date: string;
  revised_checkout_date: string;
  nights_completed: number;
  planned_nights: number;
  identity_status: 'needs_verification' | 'verified';
  status: 'pending' | 'acknowledged' | 'resolved';
  policy_configured: boolean;
  services_due: Service[];
  next_services: Service[];
  updated_at: string;
};

type Props = { hotel: string | null | undefined; organizationSlug: string | null | undefined };

/** Read-only by default: an inferred room-night continuity match needs a human
 * identity check. This panel never changes cleaning tasks or completed work. */
export function StayExtensionReviewQueue({ hotel, organizationSlug }: Props) {
  const [hotelId, setHotelId] = useState<string | null>(null);
  const [reviews, setReviews] = useState<ExtensionReview[]>([]);
  const [roomNames, setRoomNames] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHotelId(null);
    setReviews([]);
    setRoomNames({});
    if (!hotel || !organizationSlug) return;
    let cancelled = false;
    void (async () => {
      const { data, error: lookupError } = await supabase
        .from('hotel_configurations')
        .select('hotel_id')
        .or(`hotel_id.eq.${hotel},hotel_name.eq.${hotel}`)
        .limit(1)
        .maybeSingle();
      if (!cancelled) {
        if (lookupError) setError('Could not identify the selected hotel for extension reviews.');
        setHotelId(data?.hotel_id ?? null);
      }
    })();
    return () => { cancelled = true; };
  }, [hotel, organizationSlug]);

  const load = useCallback(async () => {
    if (!hotelId || !organizationSlug) return;
    const { data, error: readError } = await supabase
      .from('housekeeping_stay_extension_reviews' as any)
      .select('id, room_id, arrival_date, original_checkout_date, previous_checkout_date, revised_checkout_date, nights_completed, planned_nights, identity_status, status, policy_configured, services_due, next_services, updated_at')
      .eq('hotel_id', hotelId)
      .eq('organization_slug', organizationSlug)
      .neq('status', 'resolved')
      .order('updated_at', { ascending: false })
      .limit(30);
    if (readError) {
      // Feature is gated by the DB migration; do not break the dashboard if
      // the UI deploy reaches the browser before the schema deploy.
      if (!/does not exist|could not find the table|404|PGRST205/i.test(readError.message)) {
        setError('Extension reviews could not be loaded. Refresh or contact an administrator.');
      }
      return;
    }
    const current = (data ?? []) as unknown as ExtensionReview[];
    setReviews(current);
    setError(null);
    const roomIds = [...new Set(current.map((item) => item.room_id))];
    if (!roomIds.length) { setRoomNames({}); return; }
    const { data: rooms } = await supabase.from('rooms').select('id, room_number').in('id', roomIds);
    setRoomNames(Object.fromEntries((rooms ?? []).map((room) => [room.id, room.room_number])));
  }, [hotelId, organizationSlug]);

  useEffect(() => {
    if (!hotelId || !organizationSlug) return;
    void load();
    const channel = supabase.channel(`stay-extension-review:${organizationSlug}:${hotelId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'housekeeping_stay_extension_reviews',
        filter: `hotel_id=eq.${hotelId}`,
      }, () => { void load(); })
      .subscribe();
    // Also pick up new records if Realtime is briefly unavailable.
    const refresh = window.setInterval(() => { void load(); }, 60_000);
    return () => {
      window.clearInterval(refresh);
      void supabase.removeChannel(channel);
    };
  }, [hotelId, organizationSlug, load]);

  const acknowledge = async (item: ExtensionReview, resolved: boolean, verified: boolean) => {
    const note = (notes[item.id] ?? '').trim();
    if (resolved && !verified && !note) {
      setError('Please give a reason when dismissing a possible extension as a different guest.');
      return;
    }
    setBusyId(item.id);
    setError(null);
    const { error: updateError } = await (supabase.rpc as CallableFunction)('hc_acknowledge_stay_extension', {
      _review_id: item.id,
      _identity_verified: verified,
      _resolution_note: note || null,
      _resolved: resolved,
    });
    setBusyId(null);
    if (updateError) {
      setError(updateError.message ?? 'Could not save the review.');
      return;
    }
    await load();
  };

  if ((!hotelId || !organizationSlug) && !error) return null;
  if (!reviews.length && !error) return null;

  return (
    <section aria-label="Guest stay extensions requiring supervisor review" className="mx-4 mt-3 rounded-xl border border-amber-300/70 bg-amber-50/80 p-3 text-slate-900 shadow-sm dark:border-amber-600 dark:bg-amber-950/40 dark:text-slate-100 sm:mx-6">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold">
        <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-300" aria-hidden="true" />
        Stay extensions requiring service review
        {reviews.length > 0 && <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs text-amber-950">{reviews.length}</span>}
      </div>
      {error && <p role="alert" className="mb-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
      <div className="space-y-3">
        {reviews.map((item) => (
          <article key={item.id} className="rounded-lg border border-amber-200 bg-white p-3 text-sm dark:border-amber-700 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <strong>Room {roomNames[item.room_id] ?? '—'}</strong>
              <span className="text-xs">{item.status === 'pending' ? 'Needs supervisor review' : 'Stay verified — review services'}</span>
            </div>
            <p className="mt-1">Arrival {item.arrival_date} · Departure {item.previous_checkout_date} → {item.revised_checkout_date}</p>
            <p className="mt-1 font-medium">{item.nights_completed} nights completed · {item.planned_nights} nights planned</p>
            {!item.policy_configured ? (
              <p className="mt-2 text-amber-800 dark:text-amber-200">This property's towel/linen/full-clean schedule needs configuration. No automatic service has been assigned.</p>
            ) : item.services_due.length > 0 ? (
              <p className="mt-2 font-medium">Due for review: {item.services_due.map((service) => `${service.label} (night ${service.dueNight})`).join(', ')}</p>
            ) : (
              <p className="mt-2">No additional service is currently due under the configured schedule.</p>
            )}
            {item.next_services.length > 0 && (
              <p className="mt-1 flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300"><Clock3 className="h-3.5 w-3.5" />Next: {item.next_services.map((service) => `${service.label} ${service.dueDate}`).join(', ')}</p>
            )}
            {item.identity_status === 'needs_verification' && (
              <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">Room-night continuity suggests an extension; confirm the same guest with reception before acting.</p>
            )}
            <label htmlFor={`extension-note-${item.id}`} className="mt-3 block text-xs font-medium">Supervisor note (required when dismissing)</label>
            <input id={`extension-note-${item.id}`} value={notes[item.id] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white" placeholder="Optional review note" />
            <div className="mt-2 flex flex-wrap gap-2">
              {item.identity_status !== 'verified' ? (
                <button type="button" disabled={busyId === item.id} onClick={() => void acknowledge(item, false, true)} className="rounded-md bg-emerald-700 px-3 py-1.5 text-white disabled:opacity-50">Confirm same guest</button>
              ) : (
                <button type="button" disabled={busyId === item.id} onClick={() => void acknowledge(item, true, true)} className="flex items-center gap-1 rounded-md bg-emerald-700 px-3 py-1.5 text-white disabled:opacity-50"><CheckCircle2 className="h-4 w-4" />Service reviewed</button>
              )}
              <button type="button" disabled={busyId === item.id} onClick={() => void acknowledge(item, true, false)} className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50">Different guest / dismiss</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
