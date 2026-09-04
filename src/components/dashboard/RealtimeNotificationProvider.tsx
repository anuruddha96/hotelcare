import React, { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/hooks/useNotifications';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * Global notifications that are NOT owned by the housekeeping notification hook.
 *
 * Room assignments, completed-room approvals and break requests are deliberately
 * handled only by useNotifications. Keeping a single owner prevents duplicate
 * alerts and lets that hook enforce the operational-manager audience centrally.
 */
export function RealtimeNotificationProvider({ children }: { children: React.ReactNode }) {
  const { user, profile } = useAuth();
  const { showNotification } = useNotifications();
  const { t } = useTranslation();

  useEffect(() => {
    if (!user?.id) return;

    // Maintenance approvals remain visible to senior management because they
    // can require management action. Routine housekeeping workflow does not.
    const maintenanceApprovalRoles = new Set([
      'manager',
      'housekeeping_manager',
      'admin',
      'top_management',
      'top_management_manager',
    ]);

    const channels = [
      ...(profile?.role && maintenanceApprovalRoles.has(profile.role) ? [
        supabase
          .channel(`maintenance-pending-approvals-${user.id}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'tickets'
            },
            (payload: any) => {
              if (
                payload.new.pending_supervisor_approval === true &&
                payload.old.pending_supervisor_approval !== true &&
                payload.new.department === 'maintenance'
              ) {
                showNotification(
                  t('notifications.maintenanceReview'),
                  'info',
                  t('notifications.maintenanceApproval')
                );
              }
            }
          )
          .subscribe()
      ] : []),

      // Personal ticket notifications are role-neutral: only the assignee or
      // creator receives them.
      supabase
        .channel(`ticket-notifications-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'tickets',
            filter: `assigned_to=eq.${user.id}`
          },
          () => {
            showNotification(
              t('notifications.newTicketAssigned'),
              'info',
              t('notifications.newTicketLabel')
            );
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'tickets',
            filter: `created_by=eq.${user.id}`
          },
          (payload) => {
            if (payload.new.status !== payload.old.status) {
              showNotification(
                t('notifications.ticketStatusChanged').replace('{status}', payload.new.status),
                'info',
                t('notifications.ticketUpdateLabel')
              );
            }
          }
        )
        .subscribe()
    ];

    return () => {
      channels.forEach((channel) => {
        if (channel) supabase.removeChannel(channel);
      });
    };
  }, [user?.id, profile?.role, showNotification, t]);

  return <>{children}</>;
}
