import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Shirt } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { hasManagerPowers } from '@/lib/roleAccess';
import { todayBudapest } from '@/lib/budapestTime';
import { keepSameStayIncidents, type MemoriesIncident } from '@/lib/memoriesLegacyService';

type Proof = { service_type: 'towel' | 'linen' };
type Props = {
  assignmentId: string;
  assignmentDate: string;
  roomId: string;
  roomNumber: string;
  isCheckout: boolean;
  assignmentStatus: string;
  assignmentIsDnd?: boolean | null;
  assignmentNotes?: string | null;
  towelRequired?: boolean | null;
  linenRequired?: boolean | null;
};

export function previousBusinessDate(date: string): string {
  const parsed = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed - 86400000).toISOString().slice(0, 10);
}

export function pendingServices(incident: MemoriesIncident): string[] {
  return [incident.towel_due && !incident.towel_confirmed_at ? 'towel change' : '',
    incident.linen_due && !incident.linen_confirmed_at ? 'full linen change' : ''].filter(Boolean);
}

/** RLS prevents housekeepers from reading checkout incident rows. The dated
 * legacy fallback is a sanitized SECURITY DEFINER RPC restricted to the
 * signed-in person's CURRENT assignment; historical rows stay unchanged. */
export function MemoriesServiceCarryover({ assignmentId, assignmentDate, roomId, roomNumber,
  isCheckout, assignmentStatus, assignmentIsDnd, assignmentNotes, towelRequired, linenRequired }: Props) {
  const { user, profile } = useAuth();
  const canManage = hasManagerPowers(profile?.role);
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<'towel' | 'linen' | null>(null);
  const yesterday = previousBusinessDate(assignmentDate);
  const enabled = Boolean(user?.id && roomId && assignmentId && assignmentDate === todayBudapest()
    && (!isCheckout || canManage));
  const queryKey = ['memories-service-carryover', roomId, assignmentDate, assignmentId];
  const { data, error } = useQuery({
    queryKey,
    enabled,
    staleTime: 60_000,
    retry: 1,
    queryFn: async () => {
      const [events, proofs] = await Promise.all([
        (supabase as any).from('memories_service_carryovers')
          .select('id,room_id,source_business_date,incident_type,towel_due,linen_due,towel_confirmed_at,linen_confirmed_at,incident_resolved_same_day')
          .eq('room_id', roomId).lt('source_business_date', assignmentDate)
          .order('source_business_date', { ascending: false }),
        (supabase as any).from('memories_textile_confirmations')
          .select('service_type').eq('assignment_id', assignmentId),
      ]);
      if (events.error) throw events.error;
      if (proofs.error) throw proofs.error;
      let incidents = (events.data || []) as MemoriesIncident[];
      const todayProofs = (proofs.data || []) as Proof[];
      // The new ledger has no historical backfill. The RPC independently
      // verifies yesterday's dated assignment and its DND evidence, including
      // 17 September -> 18 September, without granting general snapshot access.
      if (yesterday && !incidents.some(event => event.source_business_date === yesterday)) {
        const legacy = await (supabase as any).rpc('memories_previous_day_service', {
          p_assignment_id: assignmentId,
        });
        if (legacy.error) throw legacy.error;
        incidents = incidents.concat((legacy.data || []).map((item: any) => ({
          id: `legacy-${item.source_assignment_id}`,
          room_id: roomId,
          source_business_date: item.source_business_date,
          incident_type: item.incident_type,
          towel_due: item.towel_due,
          linen_due: item.linen_due,
          towel_confirmed_at: null,
          linen_confirmed_at: null,
          incident_resolved_same_day: item.incident_resolved_same_day,
          legacy_verified: true,
        } as MemoriesIncident)));
      }
      // A new guest must never inherit an earlier guest's deferred textile
      // work after an intervening checkout. Yesterday's verified note survives.
      if (incidents.some(event => event.source_business_date < yesterday)) {
        const history = await (supabase as any).from('housekeeping_room_snapshots')
          .select('business_date,is_checkout_room,assignment_type,pms_metadata')
          .eq('room_id', roomId).lt('business_date', assignmentDate)
          .order('business_date', { ascending: false }).limit(180);
        if (history.error) throw history.error;
        const checkoutDates = (history.data || []).filter((row: any) =>
          row.pms_metadata?.manual_daily !== true &&
          (row.is_checkout_room === true || row.pms_metadata?.scheduledDepartureToday === true
            || row.assignment_type === 'checkout_cleaning')).map((row: any) => row.business_date);
        // Housekeepers are intentionally barred from raw snapshots. Their
        // previous-day RPC still works; older unverified items fail closed.
        incidents = keepSameStayIncidents(incidents, checkoutDates, assignmentDate);
        if (!canManage) incidents = incidents.filter(event => event.source_business_date === yesterday);
        const oldestSavedDate = (history.data || []).at(-1)?.business_date;
        if (history.data?.length === 180 && oldestSavedDate) {
          incidents = incidents.filter(event => event.source_business_date >= oldestSavedDate);
        }
      }
      return { incidents, proofs: todayProofs };
    },
  });
  const confirmed = new Set((data?.proofs || []).map(proof => proof.service_type));
  const incidents = useMemo(() => (data?.incidents || []).map(event => ({ ...event,
    towel_confirmed_at: event.towel_confirmed_at || (confirmed.has('towel') ? 'confirmed-today' : null),
    linen_confirmed_at: event.linen_confirmed_at || (confirmed.has('linen') ? 'confirmed-today' : null),
  })).filter(event => event.source_business_date === yesterday ||
    (!isCheckout && pendingServices(event).length > 0)),
  [data, yesterday, isCheckout]);
  const dueTowel = !isCheckout && !confirmed.has('towel') && (Boolean(towelRequired)
    || incidents.some(event => pendingServices(event).includes('towel change')));
  const dueLinen = !isCheckout && !confirmed.has('linen') && (Boolean(linenRequired)
    || incidents.some(event => pendingServices(event).includes('full linen change')));
  const eligible = !isCheckout && (assignmentStatus === 'in_progress' || assignmentStatus === 'completed')
    && !assignmentIsDnd && !assignmentNotes?.includes('[NO_SERVICE]');

  const confirm = async (serviceType: 'towel' | 'linen') => {
    if (!user?.id || !eligible || saving) return;
    setSaving(serviceType);
    try {
      const { error: insertError } = await (supabase as any)
        .from('memories_textile_confirmations').insert({
          room_id: roomId, assignment_id: assignmentId,
          service_type: serviceType, performed_by: user.id,
        });
      if (insertError) throw insertError;
      await queryClient.invalidateQueries({ queryKey });
      toast.success(`${serviceType === 'towel' ? 'Towels' : 'Bed linen'} confirmed as replaced in room ${roomNumber}.`);
    } catch (failure: any) {
      toast.error('Could not record textile replacement', { description: failure?.message });
    } finally { setSaving(null); }
  };

  if (!enabled) return null;
  if (error) return <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
    Previous service information is temporarily unavailable. Check the manager before closing any outstanding towel or linen service.
  </p>;
  if (!data) return null;
  if (!incidents.length && !dueTowel && !dueLinen) return null;

  return <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100" role="status">
    <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />Room {roomNumber} — previous service information</p>
    {incidents.map(event => <p key={event.id} className="mt-1 text-xs">
      {event.source_business_date === yesterday ? 'Yesterday' : event.source_business_date}:
      {' '}{event.incident_type === 'dnd' ? 'DND attempt' : 'No Service (guest declined / no cleaning requested)'}.
      {event.incident_resolved_same_day ? ' Cleaning subsequently completed that day.' : ''}
      {isCheckout ? ' Normal checkout cleaning today; previous incident is for management only.'
        : pendingServices(event).length ? ` Outstanding: ${pendingServices(event).join(' and ')}.`
          : ' No outstanding textile requirement recorded from this incident.'}
    </p>)}
    {eligible && (dueTowel || dueLinen) && <div className="mt-3 flex flex-wrap gap-2">
      {dueTowel && <button type="button" disabled={Boolean(saving)}
        className="inline-flex min-h-10 items-center gap-1 rounded-md border border-amber-500 bg-white px-3 py-2 text-xs font-semibold text-amber-950 disabled:opacity-60"
        onClick={() => void confirm('towel')}>
        <Shirt className="h-4 w-4" />{saving === 'towel' ? 'Recording…' : 'Confirm towels actually replaced'}
      </button>}
      {dueLinen && <button type="button" disabled={Boolean(saving)}
        className="inline-flex min-h-10 items-center gap-1 rounded-md border border-amber-500 bg-white px-3 py-2 text-xs font-semibold text-amber-950 disabled:opacity-60"
        onClick={() => void confirm('linen')}>
        <Shirt className="h-4 w-4" />{saving === 'linen' ? 'Recording…' : 'Confirm bed linen actually replaced'}
      </button>}
    </div>}
    {(confirmed.has('towel') || confirmed.has('linen')) && <p className="mt-2 flex items-center gap-1 text-xs text-green-900 dark:text-green-200"><CheckCircle2 className="h-4 w-4" />
      Confirmed today: {[confirmed.has('towel') ? 'towels' : '', confirmed.has('linen') ? 'bed linen' : ''].filter(Boolean).join(' and ')}.
    </p>}
    {!isCheckout && (dueTowel || dueLinen) && <p className="mt-2 text-xs">Do not confirm a change unless the replacement was actually performed. A room marked DND or No Service cannot confirm a replacement.</p>}
  </div>;
}
