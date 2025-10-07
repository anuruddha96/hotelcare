import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function usePendingApprovals() {
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const fetchPendingCount = async () => {
      try {
        const dateStr = new Date().toISOString().split('T')[0];
        
        // Get current user's assigned hotel
        const { data: currentUser } = await supabase.auth.getUser();
        if (!currentUser.user) {
          setPendingCount(0);
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('assigned_hotel')
          .eq('id', currentUser.user.id)
          .single();

        if (profileError) throw profileError;

        const userHotelId = profile?.assigned_hotel;
        let userHotelName = userHotelId;

        // Get hotel name from hotel_id if needed
        if (userHotelId) {
          const { data: hotelName } = await supabase
            .rpc('get_hotel_name_from_id', { hotel_id: userHotelId });
          if (hotelName) {
            userHotelName = hotelName;
          }
        }

        // Fetch assignments with room details to filter by hotel
        const { data, error } = await supabase
          .from('room_assignments')
          .select(`
            id,
            rooms!inner (
              hotel
            )
          `)
          .eq('status', 'completed')
          .eq('supervisor_approved', false)
          .eq('assignment_date', dateStr);

        if (error) throw error;

        // Filter by user's hotel
        let filteredAssignments = (data as any) || [];
        if (userHotelName) {
          filteredAssignments = filteredAssignments.filter((assignment: any) => 
            assignment.rooms?.hotel === userHotelName || 
            assignment.rooms?.hotel === userHotelId
          );
        }

        setPendingCount(filteredAssignments.length);
      } catch (error) {
        console.error('Error fetching pending count:', error);
        setPendingCount(0);
      }
    };

    fetchPendingCount();

    // Set up real-time subscription for pending count
    const channel = supabase
      .channel('pending-approvals-count')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_assignments',
          filter: 'status=eq.completed'
        },
        () => fetchPendingCount()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return pendingCount;
}