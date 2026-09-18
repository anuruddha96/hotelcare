import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Shirt } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { hasManagerPowers } from '@/lib/roleAccess';
import { todayBudapest } from '@/lib/budapestTime';
import { deriveMemoriesLegacyIncidents, keepSameStayIncidents, type MemoriesIncident,
  type MemoriesSnapshot, type MemoriesDatedAssignment, type MemoriesDndPhoto } from '@/lib/memoriesLegacyService';

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

/** RLS prevents housekeepers from reading checkout incident rows. No saved
 * assignment or historical snapshot is written or changed. Pre-migration
 * incidents are reconstructed read-only from DATED evidence, never had_dnd. */
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
      // The ledger begins at deployment. Read old verified assignments/photos
      // for exactly yesterday, so 17 September incidents remain visible on
      // 18 September without manufacturing events or mutating old rows.
      if (yesterday && !incidents.some(event => event.source_business_date === yesterday)) {
        const [saved, dated, photos] = await Promise.all([
          (supabase as any).from('housekeeping_room_snapshots')
            .select('room_id,business_date,towel_change_required,linen_change_required')
            .eq('room_id', roomId).eq('business_date', yesterday).maybeSingle(),
          (supabase as any).from('room_assignments')
            .select('id,room_id,assignment_date,assignment_type,status,service_result,notes,is_dnd,dnd_attempt_count,completed_at')
            .eq('room_id', roomId).eq('assignment_date', yesterday),
          (supabase as any).from('dnd_photos')
            .select('room_id,assignment_id,assignment_date,marked_at')
            .eq('room_id', roomId).eq('assignment_date', yesterday),
        ]);
        if (saved.error || dated.error || photos.error) {
          throw saved.error || dated.error || photos.error;
        }
        incidents = incidents.concat(deriveMemoriesLegacyIncidents(
          saved.data ? [saved.data as MemoriesSnapshot] : [],
          (dated.data || []) as MemoriesDatedAssignment[],
          (photos.data || []) as MemoriesDndPhoto[], yesterday,
        ));
      }
      // Prevent a pending item from belonging to a different guest after an
      // intervening checkout (including a full cleanup and new arrival).
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
        incidents = keepSameStayIncidents(incidents, checkoutDates, assignmentDate);
        // If the oldest available history is newer than an incident, its
        // guest boundary is unverified: fail closed rather than leak an old stay.
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
