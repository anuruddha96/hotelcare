import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';

export function AutoAssignmentService() {
  const { profile } = useAuth();

  useEffect(() => {
    if (!profile) return;

    const checkAndAssignTickets = async () => {
      try {
        // Update user's last login time
        await supabase
          .from('profiles')
          .update({ last_login: new Date().toISOString() })
          .eq('id', profile.id);

        // Check for unassigned tickets that are older than 4 hours and match user's department
        const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
        
        // Map user roles to departments they can handle
        const userDepartments = [];
        if (['maintenance', 'maintenance_manager'].includes(profile.role)) {
          userDepartments.push('maintenance');
        }
        if (['housekeeping', 'housekeeping_manager'].includes(profile.role)) {
          userDepartments.push('housekeeping');
          // Housekeeping can also handle maintenance
          userDepartments.push('maintenance');
        }
        if (['reception', 'reception_manager'].includes(profile.role)) {
          userDepartments.push('reception');
        }
        if (['marketing', 'marketing_manager'].includes(profile.role)) {
          userDepartments.push('marketing');
        }
        if (profile.role === 'back_office_manager') {
          userDepartments.push('back_office');
        }
        if (profile.role === 'control_manager') {
          userDepartments.push('control');
        }
        if (profile.role === 'finance_manager') {
          userDepartments.push('finance');
        }
        if (profile.role === 'top_management_manager') {
          userDepartments.push('top_management');
        }

        if (userDepartments.length === 0) return;

        const { data: unassignedTickets, error } = await supabase
          .from('tickets')
          .select('*')
          .is('assigned_to', null)
          .in('department', userDepartments)
          .eq('status', 'open')
          .lt('created_at', fourHoursAgo)
          .limit(1);

        if (error) throw error;

        if (unassignedTickets && unassignedTickets.length > 0) {
          const ticket = unassignedTickets[0];
          
          // Auto-assign the ticket to the current user
          const { error: updateError } = await supabase
            .from('tickets')
            .update({ 
              assigned_to: profile.id,
              status: 'in_progress'
            })
            .eq('id', ticket.id);

          if (updateError) throw updateError;

          toast({
            title: 'Ticket Auto-Assigned',
            description: `Ticket ${ticket.ticket_number} has been automatically assigned to you.`,
          });
        }
      } catch (error: any) {
        console.error('Auto-assignment error:', error);
      }
    };

    // Run auto-assignment check on component mount (user login)
    checkAndAssignTickets();

    // Set up interval to check every 5 minutes
    const interval = setInterval(checkAndAssignTickets, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [profile]);

  return null; // This is a service component, no UI
}
