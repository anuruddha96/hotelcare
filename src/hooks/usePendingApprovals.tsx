import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function usePendingApprovals() {
  const [pendingCount, setPendingCount] = useState(0);
  const [maintenanceTicketCount, setMaintenanceTicketCount] = useState(0);

  const fetchPendingCount = useCallback(async () => {
      try {
        const dateStr = new Date().toISOString().split('T')[0];
        
        // Get current user's organization, hotel, and role
        const { data: currentUser } = await supabase.auth.getUser();
        if (!currentUser.user) {
          setPendingCount(0);
          setMaintenanceTicketCount(0);
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('organization_slug, assigned_hotel, role')
          .eq('id', currentUser.user.id)
          .single();

        if (profileError) throw profileError;

        const userOrgSlug = profile?.organization_slug;
        const userHotel = profile?.assigned_hotel;
        const userRole = profile?.role;
        
        if (!userOrgSlug) {
          setPendingCount(0);
          setMaintenanceTicketCount(0);
          return;
        }

        // Resolve hotel display name from hotel_configurations
        let resolvedHotelName = userHotel;
        if (userHotel) {
          const { data: hotelConfig } = await supabase
            .from('hotel_configurations')
            .select('hotel_name')
            .eq('hotel_id', userHotel)
            .maybeSingle();
          if (hotelConfig?.hotel_name) {
            resolvedHotelName = hotelConfig.hotel_name;
          }
        }

        // Build query for pending room assignments approvals
        let query = supabase
          .from('room_assignments')
          .select('id, rooms!inner(hotel)')
          .eq('status', 'completed')
          .eq('supervisor_approved', false)
          .eq('assignment_date', dateStr)
          .eq('organization_slug', userOrgSlug);

        // For managers/housekeeping_managers, filter by their assigned hotel
        // Admins and top_management see all hotels in their organization
        if (userHotel && !['admin', 'top_management'].includes(userRole || '')) {
          if (resolvedHotelName && resolvedHotelName !== userHotel) {
            query = query.or(`hotel.eq.${userHotel},hotel.eq.${resolvedHotelName}`, { referencedTable: 'rooms' });
          } else {
            query = query.eq('rooms.hotel', userHotel);
          }
        }

        const { data, error } = await query;

        if (error) throw error;

        setPendingCount((data || []).length);

        // Fetch pending maintenance ticket approvals
        let ticketQuery = supabase
          .from('tickets')
          .select('id, hotel')
          .eq('pending_supervisor_approval', true)
          .eq('department', 'maintenance')
          .eq('organization_slug', userOrgSlug);

        if (userHotel && !['admin', 'top_management'].includes(userRole || '')) {
          if (resolvedHotelName && resolvedHotelName !== userHotel) {
            ticketQuery = ticketQuery.or(`hotel.eq.${userHotel},hotel.eq.${resolvedHotelName}`);
          } else {
            ticketQuery = ticketQuery.or(`hotel.eq.${userHotel},hotel.ilike.%${userHotel}%`);
          }
        }

        const { data: ticketData, error: ticketError } = await ticketQuery;

        if (!ticketError) {
          setMaintenanceTicketCount((ticketData || []).length);
        }
      } catch (error) {
        console.error('Error fetching pending count:', error);
        setPendingCount(0);
        setMaintenanceTicketCount(0);
      }
  }, []);

  useEffect(() => {
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
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tickets'
        },
        () => fetchPendingCount()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchPendingCount]);

  const refetch = useCallback(() => {
    fetchPendingCount();
  }, [fetchPendingCount]);

  return { pendingCount, maintenanceTicketCount, totalCount: pendingCount + maintenanceTicketCount, refetch };
}
