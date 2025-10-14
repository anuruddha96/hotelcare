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
      // Room assignments for housekeepers
      supabase
        .channel('room-assignments-notifications')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'room_assignments',
            filter: `assigned_to=eq.${user.id}`
          },
          (payload) => {
            showNotification(
              t('notifications.newAssignment'),
              'info',
              'New Room Assignment'
            );
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'room_assignments',
            filter: `assigned_to=eq.${user.id}`
          },
          (payload) => {
            if (payload.new.status !== payload.old.status) {
              showNotification(
                `Assignment status changed to ${payload.new.status}`,
                'info',
                'Assignment Update'
              );
            }
          }
        )
        .subscribe(),

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

      // Supervisor approvals (filtered by hotel)
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
                // Fetch room details to check hotel
                const { data: roomData } = await supabase
                  .from('rooms')
                  .select('hotel')
                  .eq('id', payload.new.room_id)
                  .single();

                if (roomData) {
                  // Get manager's assigned hotel
                  const { data: profileData } = await supabase
                    .from('profiles')
                    .select('assigned_hotel')
                    .eq('id', user.id)
                    .single();

                  const userHotelId = profileData?.assigned_hotel;
                  let userHotelName = userHotelId;

                  // Get hotel name from hotel_id if needed
                  if (userHotelId) {
                    const { data: hotelName } = await supabase
                      .rpc('get_hotel_name_from_id', { hotel_id: userHotelId });
                    if (hotelName) {
                      userHotelName = hotelName;
                    }
                  }

                  // Only notify if the room belongs to the manager's hotel
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
