import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/hooks/useNotifications';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { toast } from '@/hooks/use-toast';

export function AutoAssignmentService() {
  const { profile } = useAuth();
  const { showNotification } = useNotifications();

  useEffect(() => {
    if (!profile?.id) return;

    // Keep the existing overdue-ticket fallback for non-maintenance departments.
    // Maintenance is intentionally excluded: maintenance routing is now server-side
    // and requires a same-hotel maintenance employee to be checked in today.
    const checkAndAssignNonMaintenanceTickets = async () => {
      try {
        await supabase
          .from('profiles')
          .update({ last_login: new Date().toISOString() })
          .eq('id', profile.id);

        const departments: string[] = [];
        if (['housekeeping', 'housekeeping_manager'].includes(profile.role)) departments.push('housekeeping');
        if (['reception', 'reception_manager'].includes(profile.role)) departments.push('reception');
        if (['marketing', 'marketing_manager'].includes(profile.role)) departments.push('marketing');
        if (profile.role === 'back_office_manager') departments.push('back_office');
        if (profile.role === 'control_manager') departments.push('control');
        if (profile.role === 'finance_manager') departments.push('finance');
        if (profile.role === 'top_management_manager') departments.push('top_management');
        if (!departments.length) return;

        const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
        let query = supabase
          .from('tickets')
          .select('id, ticket_number, hotel, department')
          .is('assigned_to', null)
          .in('department', departments)
          .neq('department', 'maintenance')
          .eq('status', 'open')
          .lt('created_at', fourHoursAgo)
          .limit(1);

        if (profile.organization_slug) query = query.eq('organization_slug', profile.organization_slug);
        const hotelKeys = await resolveHotelKeys(profile.assigned_hotel);
        if (hotelKeys.length) query = query.in('hotel', hotelKeys);

        const { data: tickets, error } = await query;
        if (error) throw error;
        if (!tickets?.length) return;

        const ticket = tickets[0];
        const { error: updateError } = await supabase
          .from('tickets')
          .update({ assigned_to: profile.id, status: 'in_progress' })
          .eq('id', ticket.id)
          .is('assigned_to', null)
          .neq('department', 'maintenance');
        if (updateError) throw updateError;

        toast({
          title: 'Ticket Auto-Assigned',
          description: `Ticket ${ticket.ticket_number} has been automatically assigned to you.`,
        });
      } catch (error) {
        console.error('Non-maintenance auto-assignment error:', error);
      }
    };

    void checkAndAssignNonMaintenanceTickets();
    const interval = setInterval(checkAndAssignNonMaintenanceTickets, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [profile?.id, profile?.role, profile?.assigned_hotel, profile?.organization_slug]);

  useEffect(() => {
    if (!profile?.id || !profile?.assigned_hotel) return;
    let disposed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setup = async () => {
      const keys = await resolveHotelKeys(profile.assigned_hotel);
      const activeHotelKeys = keys.length ? keys : [profile.assigned_hotel];
      if (disposed) return;

      const isCurrentHotel = (hotel?: string | null) => !!hotel && activeHotelKeys.includes(hotel);
      const supervisorRoles = new Set([
        'manager', 'housekeeping_manager', 'maintenance_manager', 'admin',
        'top_management', 'top_management_manager', 'supervisor',
      ]);

      const notifyAssignee = (ticket: any) => {
        if (ticket.department !== 'maintenance' || ticket.assigned_to !== profile.id || !isCurrentHotel(ticket.hotel)) return;
        void showNotification(
          `Room ${ticket.room_number || '—'} · ${ticket.title || 'Maintenance issue'}`,
          ticket.priority === 'urgent' || ticket.priority === 'high' ? 'warning' : 'info',
          'New maintenance task'
        );
      };

      const notifySupervisorForwarded = async (ticket: any) => {
        if (!supervisorRoles.has(profile.role || '') || ticket.department !== 'maintenance' || !isCurrentHotel(ticket.hotel)) return;
        if (!(ticket.source === 'housekeeping' || ticket.source === 'housekeeping_legacy_bridge')) return;

        let assignee = '';
        if (ticket.assigned_to) {
          const { data } = await supabase.from('profiles').select('full_name').eq('id', ticket.assigned_to).maybeSingle();
          assignee = data?.full_name || 'maintenance';
        }
        void showNotification(
          ticket.assigned_to
            ? `Room ${ticket.room_number || '—'} maintenance issue was forwarded to ${assignee}.`
            : `Room ${ticket.room_number || '—'} maintenance issue is unassigned because no maintenance member is signed in.`,
          ticket.assigned_to ? 'info' : 'warning',
          'Maintenance escalation'
        );
      };

      channel = supabase
        .channel(`maintenance-workflow-${profile.id}-${profile.assigned_hotel}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tickets' }, (payload: any) => {
          const ticket = payload.new;
          notifyAssignee(ticket);
          void notifySupervisorForwarded(ticket);
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tickets' }, (payload: any) => {
          const ticket = payload.new;
          const old = payload.old || {};
          if (old.assigned_to !== ticket.assigned_to && ticket.assigned_to === profile.id) notifyAssignee(ticket);
          if (
            supervisorRoles.has(profile.role || '') &&
            ticket.department === 'maintenance' &&
            isCurrentHotel(ticket.hotel) &&
            old.pending_supervisor_approval !== true &&
            ticket.pending_supervisor_approval === true
          ) {
            void showNotification(
              `Room ${ticket.room_number || '—'} maintenance work is complete and waiting for your approval.`,
              'warning',
              'Maintenance approval'
            );
          }
        })
        .subscribe();
    };

    void setup();
    return () => {
      disposed = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [profile?.id, profile?.role, profile?.assigned_hotel, showNotification]);

  return null;
}
