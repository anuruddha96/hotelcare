import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function usePendingApprovals() {
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const fetchPendingCount = async () => {
      try {
        const dateStr = new Date().toISOString().split('T')[0];
        
        const { count, error } = await supabase
          .from('room_assignments')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'completed')
          .eq('supervisor_approved', false)
          .eq('assignment_date', dateStr);

        if (error) throw error;
        setPendingCount(count || 0);
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