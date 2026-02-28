import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar, Clock, CheckCircle, AlertCircle, CalendarDays, MapPin } from 'lucide-react';
import { AssignedRoomCard } from './AssignedRoomCard';
import { MobileHousekeepingView } from './MobileHousekeepingView';
import { PublicAreaTaskCard } from './PublicAreaTaskCard';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useIsMobile } from '@/hooks/use-mobile';
import { useTranslation } from '@/hooks/useTranslation';
import { useNotifications } from '@/hooks/useNotifications';
import { PerformanceRaceGame } from './PerformanceRaceGame';
import { getLocalDateString } from '@/lib/utils';

interface Assignment {
  id: string;
  room_id: string;
  assignment_type: 'daily_cleaning' | 'checkout_cleaning' | 'maintenance' | 'deep_cleaning';
  status: 'assigned' | 'in_progress' | 'completed' | 'cancelled';
  priority: number;
  estimated_duration: number;
  notes: string;
  assignment_date: string;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  ready_to_clean?: boolean; // prioritize when true
  rooms: {
    room_number: string;
    hotel: string;
    status: string;
    room_name: string | null;
    floor_number: number | null;
    bed_type?: string | null;
    bed_configuration?: string | null;
  } | null;
}

interface Summary {
  total_assigned: number;
  completed: number;
  in_progress: number;
  pending: number;
}

export function HousekeepingStaffView() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const { t } = useTranslation();
  const { showNotification } = useNotifications();


  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [publicTasks, setPublicTasks] = useState<any[]>([]);
  const [summary, setSummary] = useState<Summary>({ total_assigned: 0, completed: 0, in_progress: 0, pending: 0 });
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [statusFilter, setStatusFilter] = useState<'assigned' | 'in_progress' | 'completed' | 'total' | null>('assigned');

  useEffect(() => {
    if (user?.id) {
      fetchAssignments();
      fetchSummary();
      fetchPublicTasks();
    }
  }, [user?.id, selectedDate, statusFilter]);

  // Real-time subscription for assignment updates
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel('assignment-updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'room_assignments',
          filter: `assigned_to=eq.${user.id}`
        },
        () => {
          fetchAssignments();
          fetchSummary();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'room_assignments',
          filter: `assigned_to=eq.${user.id}`
        },
        () => {
          fetchAssignments();
          fetchSummary();
          showNotification(t('notifications.newAssignment'), 'info');
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, selectedDate, showNotification, t]);

  if (isMobile) {
    return <MobileHousekeepingView />;
  }

  const fetchAssignments = async () => {
    if (!user?.id) return;
    
    try {
      let query = supabase
        .from('room_assignments')
        .select(`
          *,
          rooms (
            room_number,
            hotel,
            status,
            room_name,
            floor_number,
            bed_type,
            bed_configuration,
            guest_nights_stayed,
            towel_change_required,
            linen_change_required,
            notes
          )
        `)
        .eq('assigned_to', user.id)
        .eq('assignment_date', selectedDate);

      // Apply status filter if set
      if (statusFilter && statusFilter !== 'total') {
        query = query.eq('status', statusFilter as 'assigned' | 'in_progress' | 'completed');
      }

      const { data, error } = await query;

      if (error) {
        console.error('Database query error:', error);
        throw error;
      }
      
      console.log('Fetched assignments:', data);
      let assignmentsData = data || [];

      // Backfill room details if nested join didn't return them
      const missingRoomIds = assignmentsData.filter((a: any) => !a.rooms).map((a: any) => a.room_id);
      if (missingRoomIds.length > 0) {
        const { data: roomRows, error: roomsError } = await supabase
          .from('rooms')
          .select('id, room_number, hotel, status, room_name, floor_number, bed_type, bed_configuration, guest_nights_stayed, towel_change_required, linen_change_required')
          .in('id', missingRoomIds);
        if (!roomsError && roomRows) {
          const roomMap = Object.fromEntries(roomRows.map((r: any) => [r.id, r]));
          assignmentsData = assignmentsData.map((a: any) => ({
            ...a,
            rooms: a.rooms ?? roomMap[a.room_id] ?? null,
          }));
        }
      }

      // Show ALL assignments including checkout rooms not ready
      // Checkout rooms will display a "waiting for checkout" indicator

      // Sort with unified priority: in_progress > high priority > ready checkouts (by floor) > daily (by floor) > waiting checkouts > completed
      assignmentsData.sort((a, b) => {
        // Helper to get sort bucket
        const getBucket = (x: any): number => {
          if (x.status === 'in_progress') return 0;
          if (x.status === 'completed') return 5;
          if (x.status === 'cancelled') return 6;
          // assigned status
          if ((x.priority ?? 1) >= 3) return 1; // high priority
          if (x.assignment_type === 'checkout_cleaning' && x.ready_to_clean) return 2; // ready checkout
          if (x.assignment_type === 'daily_cleaning') return 3; // daily
          if (x.assignment_type === 'checkout_cleaning' && !x.ready_to_clean) return 4; // waiting checkout
          return 3; // default to daily bucket
        };

        const bucketDiff = getBucket(a) - getBucket(b);
        if (bucketDiff !== 0) return bucketDiff;

        // Within same bucket, group by floor then room number
        const aFloor = a.rooms?.floor_number ?? 999;
        const bFloor = b.rooms?.floor_number ?? 999;
        if (aFloor !== bFloor) return aFloor - bFloor;

        const aRoomNum = parseInt(a.rooms?.room_number?.replace(/\D/g, '') || '999');
        const bRoomNum = parseInt(b.rooms?.room_number?.replace(/\D/g, '') || '999');
        return aRoomNum - bRoomNum;
      });

      setAssignments(assignmentsData);
    } catch (error) {
      console.error('Error fetching assignments:', error);
      toast.error('Failed to load assignments');
    } finally {
      setLoading(false);
    }
  };

  const fetchSummary = async () => {
    try {
      const { data, error } = await supabase
        .rpc('get_housekeeping_summary', {
          user_id: user?.id,
          target_date: selectedDate
        });

      if (error) throw error;
      
      // Parse JSON response
      const summaryData = typeof data === 'string' ? JSON.parse(data) : data;
      setSummary(summaryData || { total_assigned: 0, completed: 0, in_progress: 0, pending: 0 });
    } catch (error) {
      console.error('Error fetching summary:', error);
    }
  };

  const handleStatusUpdate = (assignmentId: string, newStatus: 'assigned' | 'in_progress' | 'completed' | 'cancelled') => {
    setAssignments(prev =>
      prev.map(assignment =>
        assignment.id === assignmentId ? { ...assignment, status: newStatus } : assignment
      )
    );
    fetchSummary(); // Refresh summary
  };

  const getAssignmentTypeLabel = (type: string) => {
    switch (type) {
      case 'daily_cleaning': return t('housekeeping.assignmentType.dailyClean');
      case 'checkout_cleaning': return t('housekeeping.assignmentType.checkoutClean');
      case 'maintenance': return t('housekeeping.assignmentType.maintenance');
      case 'deep_cleaning': return t('housekeeping.assignmentType.deepClean');
      default: return type;
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <span className="ml-3 text-muted-foreground">{t('housekeeping.loadingTasks')}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Date Selector - Mobile Optimized */}
      <Card className="bg-gradient-to-r from-primary/5 to-accent/10 border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <CalendarDays className="h-5 w-5 text-primary" />
            <span>{t('housekeeping.workSchedule')}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="flex-1 px-3 py-2 border rounded-md text-sm bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
            <Badge variant="outline" className="text-xs">
              {format(new Date(selectedDate), 'MMM dd')}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards - Mobile Grid with Clickable Filters */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <Card 
          className={`cursor-pointer transition-all duration-200 transform hover:scale-105 ${
            statusFilter === 'total' 
              ? 'ring-2 ring-blue-500 bg-blue-100 shadow-lg border-blue-500' 
              : 'bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 border-blue-200 dark:border-blue-800 hover:shadow-md'
          }`}
          onClick={() => setStatusFilter(statusFilter === 'total' ? null : 'total')}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-blue-600" />
              <div className="min-w-0">
                <p className="text-xl sm:text-2xl font-bold text-blue-700 dark:text-blue-300">{summary.total_assigned}</p>
                <p className="text-xs sm:text-sm text-blue-600 dark:text-blue-400 font-medium">{t('housekeeping.totalTasksForToday')}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card 
          className={`cursor-pointer transition-all duration-200 transform hover:scale-105 ${
            statusFilter === 'completed' 
              ? 'ring-2 ring-green-500 bg-green-100 shadow-lg border-green-500' 
              : 'bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950 dark:to-green-900 border-green-200 dark:border-green-800 hover:shadow-md'
          }`}
          onClick={() => setStatusFilter(statusFilter === 'completed' ? null : 'completed')}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <div className="min-w-0">
                <p className="text-xl sm:text-2xl font-bold text-green-700 dark:text-green-300">{summary.completed}</p>
                <p className="text-xs sm:text-sm text-green-600 dark:text-green-400 font-medium">{t('housekeeping.completed')}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card 
          className={`cursor-pointer transition-all duration-200 transform hover:scale-105 ${
            statusFilter === 'in_progress' 
              ? 'ring-2 ring-amber-500 bg-amber-100 shadow-lg border-amber-500' 
              : 'bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950 dark:to-amber-900 border-amber-200 dark:border-amber-800 hover:shadow-md'
          }`}
          onClick={() => setStatusFilter(statusFilter === 'in_progress' ? null : 'in_progress')}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-600" />
              <div className="min-w-0">
                <p className="text-xl sm:text-2xl font-bold text-amber-700 dark:text-amber-300">{summary.in_progress}</p>
                <p className="text-xs sm:text-sm text-amber-600 dark:text-amber-400 font-medium">{t('housekeeping.inProgress')}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card 
          className={`cursor-pointer transition-all duration-200 transform hover:scale-105 ${
            statusFilter === 'assigned' 
              ? 'ring-2 ring-orange-500 bg-orange-100 shadow-lg border-orange-500' 
              : 'bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-950 dark:to-orange-900 border-orange-200 dark:border-orange-800 hover:shadow-md'
          } ${summary.pending > 0 ? 'animate-pulse ring-2 ring-orange-400' : ''}`}
          onClick={() => setStatusFilter(statusFilter === 'assigned' ? null : 'assigned')}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <AlertCircle className={`h-4 w-4 text-orange-600 ${summary.pending > 0 ? 'animate-bounce' : ''}`} />
              <div className="min-w-0">
                <p className="text-xl sm:text-2xl font-bold text-orange-700 dark:text-orange-300">{summary.pending}</p>
                <p className="text-xs sm:text-sm text-orange-600 dark:text-orange-400 font-medium">
                  {summary.pending > 0 ? `⚠️ ${t('housekeeping.waiting')}` : t('housekeeping.waiting')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Performance Race Game */}
      <PerformanceRaceGame />

      {/* Today's Tasks */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">{t('housekeeping.todaysTasks')}</h3>
          {assignments.length > 0 && (
            <Badge variant="outline" className="text-xs">
              {assignments.length} {t('housekeeping.tasks')}
            </Badge>
          )}
        </div>
        
        {assignments.length === 0 ? (
          <Card className="text-center py-8">
            <CardContent>
              {summary.total_assigned === 0 ? (
                <>
                  <AlertCircle className="h-12 w-12 mx-auto text-amber-500 mb-4" />
                  <p className="text-lg font-medium text-foreground mb-2">{t('housekeeping.noAssignments')}</p>
                  <p className="text-sm text-muted-foreground mb-2">
                    {t('housekeeping.noAssignmentsFor')} {format(new Date(selectedDate), 'MMMM dd, yyyy')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('housekeeping.contactManager')}
                  </p>
                </>
              ) : (
                <>
                  <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-4" />
                  <p className="text-lg font-medium text-foreground mb-2">{t('housekeeping.allDone')}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('housekeeping.noTasksFor')} {format(new Date(selectedDate), 'MMMM dd, yyyy')}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {assignments
              .map((assignment) => (
                <AssignedRoomCard
                  key={assignment.id}
                  assignment={assignment}
                  onStatusUpdate={handleStatusUpdate}
                />
              ))}
          </div>
        )}
      </div>

      {/* Public Area Tasks */}
      {publicTasks.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" />
            <h3 className="text-lg font-semibold">Public Area Tasks</h3>
            <Badge variant="outline" className="text-xs">{publicTasks.length}</Badge>
          </div>
          <div className="space-y-2">
            {publicTasks.map(task => (
              <PublicAreaTaskCard
                key={task.id}
                task={task}
                onStatusUpdate={(id, status) => {
                  setPublicTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t));
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );

  function fetchPublicTasks() {
    if (!user?.id) return;
    const today = getLocalDateString(new Date(selectedDate));
    supabase
      .from('general_tasks')
      .select('*')
      .eq('assigned_to', user.id)
      .eq('assigned_date', today)
      .then(({ data, error }) => {
        if (!error) setPublicTasks(data || []);
      });
  }
}