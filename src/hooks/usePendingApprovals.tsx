import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function usePendingApprovals() {
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const fetchPendingCount = async () => {
      try {
        const dateStr = new Date().toISOString().split('T')[0];
        
        // Get current user's organization
        const { data: currentUser } = await supabase.auth.getUser();
        if (!currentUser.user) {
          setPendingCount(0);
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('organization_slug')
          .eq('id', currentUser.user.id)
          .single();

        if (profileError) throw profileError;

        const userOrgSlug = profile?.organization_slug;
        if (!userOrgSlug) {
          setPendingCount(0);
          return;
        }

        // Fetch assignments filtered by organization
        const { data, error } = await supabase
          .from('room_assignments')
          .select('id')
          .eq('status', 'completed')
          .eq('supervisor_approved', false)
          .eq('assignment_date', dateStr)
          .eq('organization_slug', userOrgSlug);

        if (error) throw error;

        setPendingCount((data || []).length);
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