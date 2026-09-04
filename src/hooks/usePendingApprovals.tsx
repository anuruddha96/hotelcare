import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { todayBudapest } from '@/lib/budapestTime';
import { resolveHotelKeys } from '@/lib/hotelKeys';

/**
 * Live count used by the Housekeeping "Pending Approvals" navigation badge.
 *
 * Important: room rows in the RD Hotels database can store either the canonical
 * hotel id (for example `memories-budapest`) or the legacy display name
 * (`Hotel Memories Budapest`).  Do not push that alias matching into a nested
 * PostgREST `or()` filter here: that query has proved browser/client-version
 * sensitive and a failed count query silently makes the badge disappear even
 * while SupervisorApprovalView can load the exact same approvals.
 *
 * Instead we fetch the already-authorized pending rows for the organization and
 * apply the shared canonical hotel-key resolver in memory.  This keeps the
 * count property-isolated while making the badge use the same underlying rows
 * as the approvals page on desktop, Android and iOS.
 */
export function usePendingApprovals() {
  const [pendingCount, setPendingCount] = useState(0);
  const [maintenanceTicketCount, setMaintenanceTicketCount] = useState(0);

  const fetchPendingCount = useCallback(async () => {
    try {
      const dateStr = todayBudapest();

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

      if (!userOrgSlug || !userHotel) {
        // Never fall back to an organization-wide count for a property badge.
        setPendingCount(0);
        setMaintenanceTicketCount(0);
        return;
      }

      const resolvedKeys = await resolveHotelKeys(userHotel);
      const activeHotelKeys = new Set(
        (resolvedKeys.length ? resolvedKeys : [userHotel]).filter(Boolean),
      );
      // The raw profile value is always a valid comparison fallback even if
      // hotel_configurations is temporarily unavailable.
      activeHotelKeys.add(userHotel);

      // Fetch the same completed/unapproved assignment population used by the
      // supervisor page, then isolate it to the active property's aliases.
      const { data: assignmentData, error: assignmentError } = await supabase
        .from('room_assignments')
        .select('id, rooms!inner(hotel)')
        .eq('status', 'completed')
        .eq('supervisor_approved', false)
        .eq('assignment_date', dateStr)
        .eq('organization_slug', userOrgSlug);

      if (assignmentError) throw assignmentError;

      const roomApprovalCount = (assignmentData || []).filter((row: any) => {
        const hotel = row.rooms?.hotel;
        return !!hotel && activeHotelKeys.has(hotel);
      }).length;

      // Maintenance approvals use a direct hotel column. Fetch first and apply
      // the identical alias set locally so the two badge sources cannot drift.
      const { data: ticketData, error: ticketError } = await supabase
        .from('tickets')
        .select('id, hotel')
        .eq('pending_supervisor_approval', true)
        .eq('department', 'maintenance')
        .eq('organization_slug', userOrgSlug);

      const maintenanceCount = ticketError
        ? 0
        : (ticketData || []).filter((ticket: any) =>
            !!ticket.hotel && activeHotelKeys.has(ticket.hotel),
          ).length;

      setMaintenanceTicketCount(maintenanceCount);

      // Late minibar additions are actionable from the same approvals section.
      // Keep them in the navigation badge, but still isolate by active hotel.
      let lateMinibarCount = 0;
      try {
        const { data: lateMinibar, error: lateMinibarError } = await (supabase as any)
          .from('room_minibar_usage')
          .select('id, rooms:room_id(hotel)')
          .eq('pending_supervisor_review', true)
          .eq('organization_slug', userOrgSlug)
          .limit(500);

        if (!lateMinibarError) {
          lateMinibarCount = (lateMinibar || []).filter((row: any) => {
            const hotel = row.rooms?.hotel;
            return !!hotel && activeHotelKeys.has(hotel);
          }).length;
        }
      } catch {
        // Non-critical: room/maintenance approval counts must still render.
      }

      setPendingCount(roomApprovalCount + lateMinibarCount);
    } catch (error) {
      console.error('Error fetching pending count:', error);
      setPendingCount(0);
      setMaintenanceTicketCount(0);
    }
  }, []);

  useEffect(() => {
    void fetchPendingCount();

    // Realtime gives instant updates. A short polling fallback is intentional:
    // some Android/Desktop sessions can suspend or reconnect a Realtime socket
    // without replaying the event that changed the count.
    const channel = supabase
      .channel('pending-approvals-count')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_assignments',
        },
        () => void fetchPendingCount(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tickets',
        },
        () => void fetchPendingCount(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_minibar_usage',
        },
        () => void fetchPendingCount(),
      )
      .subscribe();

    const pollId = window.setInterval(() => {
      void fetchPendingCount();
    }, 20_000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void fetchPendingCount();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(pollId);
      document.removeEventListener('visibilitychange', handleVisibility);
      supabase.removeChannel(channel);
    };
  }, [fetchPendingCount]);

  const refetch = useCallback(() => {
    void fetchPendingCount();
  }, [fetchPendingCount]);

  return {
    pendingCount,
    maintenanceTicketCount,
    totalCount: pendingCount + maintenanceTicketCount,
    refetch,
  };
}
