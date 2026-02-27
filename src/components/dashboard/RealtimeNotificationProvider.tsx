import React, { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/hooks/useNotifications';
import { useTranslation } from '@/hooks/useTranslation';

export function RealtimeNotificationProvider({ children }: { children: React.ReactNode }) {
  const { user, profile } = useAuth();
  const { showNotification } = useNotifications();
  const { t } = useTranslation();

  useEffect(() => {
    if (!user?.id) return;

    // Set up comprehensive real-time notifications
    const channels = [
    // Manager-only channels (room assignment notifications are handled by useNotifications hook)

      // Break requests for managers
      ...(profile?.role && ['manager', 'housekeeping_manager', 'admin'].includes(profile.role) ? [
        supabase
          .channel('break-requests-notifications')
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'break_requests'
            },
            () => {
              showNotification(
                'New break request submitted',
                'info',
                'Break Request'
              );
            }
          )
          .subscribe()
      ] : []),

      // Supervisor approvals for room assignments (filtered by hotel)
      ...(profile?.role && ['manager', 'housekeeping_manager', 'admin'].includes(profile.role) ? [
        supabase
          .channel('supervisor-approvals-notifications')
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'room_assignments',
              filter: 'status=eq.completed'
            },
            async (payload) => {
              if (payload.new.status === 'completed' && payload.old.status !== 'completed') {
                const { data: roomData } = await supabase
                  .from('rooms')
                  .select('hotel')
                  .eq('id', payload.new.room_id)
                  .single();

                if (roomData) {
                  const { data: profileData } = await supabase
                    .from('profiles')
                    .select('assigned_hotel')
                    .eq('id', user.id)
                    .single();

                  const userHotelId = profileData?.assigned_hotel;
                  let userHotelName = userHotelId;

                  if (userHotelId) {
                    const { data: hotelName } = await supabase
                      .rpc('get_hotel_name_from_id', { hotel_id: userHotelId });
                    if (hotelName) {
                      userHotelName = hotelName;
                    }
                  }

                  if (roomData.hotel === userHotelName || roomData.hotel === userHotelId) {
                    showNotification(
                      `Room completed and ready for approval`,
                      'info',
                      'Approval Required'
                    );
                  }
                }
              }
            }
          )
          .subscribe(),
          
        // Maintenance ticket pending approvals for managers
        supabase
          .channel('maintenance-pending-approvals')
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'tickets'
            },
            (payload: any) => {
              if (payload.new.pending_supervisor_approval === true && 
                  payload.old.pending_supervisor_approval !== true &&
                  payload.new.department === 'maintenance') {
                showNotification(
                  'Maintenance task ready for review',
                  'info',
                  'Maintenance Approval'
                );
              }
            }
          )
          .subscribe()
      ] : []),

      // Ticket notifications
      supabase
        .channel('ticket-notifications')
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
              'New ticket assigned to you',
              'info',
              'New Ticket'
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
                `Your ticket status changed to ${payload.new.status}`,
                'info',
                'Ticket Update'
              );
            }
          }
        )
        .subscribe()
    ];

    // Cleanup function
    return () => {
      channels.forEach(channel => {
        if (channel) {
          supabase.removeChannel(channel);
        }
      });
    };
  }, [user?.id, profile?.role, showNotification, t]);

  return <>{children}</>;
}
