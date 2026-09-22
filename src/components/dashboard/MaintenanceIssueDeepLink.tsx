import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { canManageMaintenance } from './MaintenanceManagerControls';
import { TicketDetailDialog } from './TicketDetailDialog';

const isUuid = (value: string | null): value is string =>
  !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

type DetailTicket = React.ComponentProps<typeof TicketDetailDialog>['ticket'];

/** Mount alongside Dashboard so ?tab=tickets&maintenanceIssue=UUID opens the
 * existing ticket detail, not a copied ticket. All reads use the current
 * user's RLS session and exact organization + assigned-hotel constraints. */
export function MaintenanceIssueDeepLink() {
  const { profile } = useAuth();
  const { language } = useTranslation();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawId = searchParams.get('maintenanceIssue');
  const [ticket, setTicket] = useState<DetailTicket | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const close = useCallback(() => {
    const next = new URLSearchParams(window.location.search);
    next.delete('maintenanceIssue');
    setSearchParams(next, { replace: true });
    setTicket(null);
    setError('');
  }, [setSearchParams]);

  const fetchIssue = useCallback(async () => {
    if (!rawId) return;
    setBusy(true);
    setError('');
    setTicket(null);
    try {
      if (!isUuid(rawId) || !profile?.organization_slug || !profile.assigned_hotel ||
          organizationSlug !== profile.organization_slug || !canManageMaintenance(profile.role)) {
        throw new Error('You do not have access to this maintenance issue.');
      }
      const hotelKeys = await resolveHotelKeys(profile.assigned_hotel);
      if (!hotelKeys.length) throw new Error('The selected hotel could not be resolved.');
      const { data, error: queryError } = await (supabase as any).from('tickets')
        .select(`*, created_by_profile:profiles!tickets_created_by_fkey(full_name, role),
          assigned_to_profile:profiles!tickets_assigned_to_fkey(full_name, role),
          closed_by_profile:profiles!tickets_closed_by_fkey(full_name, role)`)
        .eq('id', rawId)
        .eq('organization_slug', profile.organization_slug)
        .in('hotel', hotelKeys)
        .eq('department', 'maintenance')
        .maybeSingle();
      if (queryError || !data) throw new Error('Issue unavailable for this hotel.');
      setTicket({
        id: data.id, ticket_number: data.ticket_number, title: data.title,
        description: data.description, room_number: data.room_number,
        priority: data.priority, status: data.status,
        department: 'maintenance', hotel: data.hotel,
        on_hold: data.on_hold, pending_supervisor_approval: data.pending_supervisor_approval,
        sla_due_date: data.sla_due_date, created_at: data.created_at,
        updated_at: data.updated_at, resolution_text: data.resolution_text,
        closed_at: data.closed_at, attachment_urls: data.attachment_urls,
        completion_photos: data.completion_photos,
        created_by: data.created_by_profile || undefined,
        assigned_to: data.assigned_to_profile || undefined,
        closed_by: data.closed_by_profile || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Issue unavailable.');
    } finally { setBusy(false); }
  }, [rawId, profile?.organization_slug, profile?.assigned_hotel, profile?.role, organizationSlug]);

  useEffect(() => { void fetchIssue(); }, [fetchIssue]);

  useEffect(() => {
    if (!rawId || !profile?.organization_slug) return;
    const channel = supabase.channel(`maintenance-deeplink-${rawId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'tickets',
        filter: `organization_slug=eq.${profile.organization_slug}`,
      }, (event: any) => {
        if (event.new?.id === rawId || event.old?.id === rawId) void fetchIssue();
      }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [rawId, profile?.organization_slug, fetchIssue]);

  if (!rawId) return null;
  if (ticket) return <TicketDetailDialog ticket={ticket} open onOpenChange={open => { if (!open) close(); }}
    onTicketUpdated={() => { window.dispatchEvent(new Event('maintenance-ticket-created')); void fetchIssue(); }} />;
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="w-[calc(100vw-1rem)] max-w-md">
      <DialogHeader><DialogTitle>{language === 'hu' ? 'Karbantartási hiba' : 'Maintenance issue'}</DialogTitle></DialogHeader>
      <p role={error ? 'alert' : 'status'} className="text-sm">{busy ? (language === 'hu' ? 'Friss jegy betöltése…' : 'Loading latest issue…') : error}</p>
      <div className="flex justify-end gap-2">
        {!!error && <Button variant="outline" onClick={() => void fetchIssue()}>{language === 'hu' ? 'Újrapróbálás' : 'Retry'}</Button>}
        <Button onClick={close}>{language === 'hu' ? 'Bezárás' : 'Close'}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
