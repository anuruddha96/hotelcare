import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { todayBudapest } from '@/lib/budapestTime';
import { resolveHotelKeys } from '@/lib/hotelKeys';

export function usePendingApprovals() {
  const [roomCount, setRoomCount] = useState(0);
  const [maintenanceTicketCount, setMaintenanceTicketCount] = useState(0);
  const [earlySignoutCount, setEarlySignoutCount] = useState(0);
  const [breakRequestCount, setBreakRequestCount] = useState(0);
  const [lateMinibarCount, setLateMinibarCount] = useState(0);

  const fetchPendingCount = useCallback(async () => {
      try {
        // Housekeeping business date follows the property's Budapest calendar,
        // not UTC (which can roll over two hours earlier in summer).
        const dateStr = todayBudapest();

        // Get current user's organization, hotel, and role
        const { data: currentUser } = await supabase.auth.getUser();
        if (!currentUser.user) {
          setRoomCount(0);
          setMaintenanceTicketCount(0);
          setEarlySignoutCount(0);
          setBreakRequestCount(0);
          setLateMinibarCount(0);
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

        if (!userOrgSlug || !userHotel) {
          // Strict per-hotel scoping: without an active hotel we never show org-wide totals
          setRoomCount(0);
          setMaintenanceTicketCount(0);
          setEarlySignoutCount(0);
          setBreakRequestCount(0);
          setLateMinibarCount(0);
          return;
        }

        // Use the same alias set as the approval page so the badge and queue can
        // never disagree when a property is stored by ID in one table and display
        // name in another.
        const hotelKeys = await resolveHotelKeys(userHotel);
        if (hotelKeys.length === 0) hotelKeys.push(userHotel);

        // Build query for pending room assignments approvals
        let query = supabase
          .from('room_assignments')
          .select('id, rooms!inner(hotel)')
          .eq('status', 'completed')
          .or('supervisor_approved.eq.false,supervisor_approved.is.null')
          .eq('assignment_date', dateStr)
          .eq('organization_slug', userOrgSlug);

        query = query.in('rooms.hotel', hotelKeys);

        const { data, error } = await query;

        if (error) throw error;

        setRoomCount((data || []).length);

        // Fetch pending maintenance ticket approvals
        let ticketQuery = supabase
          .from('tickets')
          .select('id, hotel')
          .eq('pending_supervisor_approval', true)
          .eq('department', 'maintenance')
          .eq('organization_slug', userOrgSlug);

        ticketQuery = ticketQuery.in('hotel', hotelKeys);

        const { data: ticketData, error: ticketError } = await ticketQuery;

        if (!ticketError) {
          setMaintenanceTicketCount((ticketData || []).length);
        } else {
          setMaintenanceTicketCount(0);
        }

        // Early sign-out requests are approvals too. Scope them through the
        // requesting staff member so another property's request is never counted.
        const { data: signoutData, error: signoutError } = await (supabase as any)
          .from('early_signout_requests')
          .select('id, requester:profiles!early_signout_requests_user_id_fkey!inner(assigned_hotel)')
          .eq('status', 'pending')
          .eq('organization_slug', userOrgSlug)
          .in('requester.assigned_hotel', hotelKeys);
        setEarlySignoutCount(signoutError ? 0 : (signoutData || []).length);

        const { data: breakData, error: breakError } = await (supabase as any)
          .from('break_requests')
          .select('id, requester:profiles!break_requests_user_id_fkey!inner(assigned_hotel)')
          .eq('status', 'pending')
          .eq('organization_slug', userOrgSlug)
          .in('requester.assigned_hotel', hotelKeys);
        setBreakRequestCount(breakError ? 0 : (breakData || []).length);

        // Late minibar additions and unresolved physical refills both need a
        // manager's attention. A blocked refill can stay open across days after
        // the Previo charge was already confirmed, so count it in the same
        // hotel-scoped minibar action queue.
        try {
          const { data: lateMinibar } = await (supabase as any)
            .from('room_minibar_usage')
            .select('id, rooms:room_id(hotel)')
            .or('pending_supervisor_review.eq.true,refill_status.eq.blocked_guest_inside')
            .eq('organization_slug', userOrgSlug)
            .limit(500);
          const hotelKeySet = new Set(hotelKeys);
          const lateCount = (lateMinibar || []).filter((r: any) => {
            const h = r.rooms?.hotel;
            return h && hotelKeySet.has(h);
          }).length;
          setLateMinibarCount(lateCount);
        } catch {
          setLateMinibarCount(0);
        }
      } catch (error) {
        console.error('Error fetching pending count:', error);
        setRoomCount(0);
        setMaintenanceTicketCount(0);
        setEarlySignoutCount(0);
        setBreakRequestCount(0);
        setLateMinibarCount(0);
      }
  }, []);

  useEffect(() => {
    fetchPendingCount();

    // Set up real-time subscription for pending count. RLS restricts RD Hotels
    // room assignment events to the active property; the refetch remains
    // hotel-scoped as a second layer of protection.
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
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'early_signout_requests' },
        () => fetchPendingCount()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'break_requests' },
        () => fetchPendingCount()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_minibar_usage' },
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

  const pendingCount = roomCount + earlySignoutCount + breakRequestCount;
  const totalCount = pendingCount + maintenanceTicketCount + lateMinibarCount;

  return {
    pendingCount,
    roomCount,
    maintenanceTicketCount,
    earlySignoutCount,
    breakRequestCount,
    lateMinibarCount,
    totalCount,
    refetch,
  };

}
