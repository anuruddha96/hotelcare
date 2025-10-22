import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar, Clock, CheckCircle, AlertCircle, CalendarDays, AlertTriangle, Camera, Shirt } from 'lucide-react';
import { AssignedRoomCard } from './AssignedRoomCard';
import { DirtyLinenDialog } from './DirtyLinenDialog';
import { ImageCaptureDialog } from './ImageCaptureDialog';
import { SimplifiedPhotoCapture } from './SimplifiedPhotoCapture';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useIsMobile } from '@/hooks/use-mobile';
import { useTranslation } from '@/hooks/useTranslation';

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
    towel_change_required?: boolean;
    linen_change_required?: boolean;
    guest_nights_stayed?: number;
  } | null;
}

interface Summary {
  total_assigned: number;
  completed: number;
  in_progress: number;
  pending: number;
}

export function MobileHousekeepingView() {
  const { user, profile } = useAuth();
  const isMobile = useIsMobile();
  const { t } = useTranslation();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [summary, setSummary] = useState<Summary>({ total_assigned: 0, completed: 0, in_progress: 0, pending: 0 });
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [statusFilter, setStatusFilter] = useState<'assigned' | 'in_progress' | 'completed' | 'total' | null>(null);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [completionDialogOpen, setCompletionDialogOpen] = useState(false);
  const [linenDialogOpen, setLinenDialogOpen] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<{ id: string; room_number: string } | null>(null);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);
  const [imageCaptureDialogOpen, setImageCaptureDialogOpen] = useState(false);

  useEffect(() => {
    if (user) {
      fetchAssignments();
      
      // Set up real-time subscription for assignment updates
      const channel = supabase
        .channel('mobile-assignments')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'room_assignments',
            filter: `assigned_to=eq.${user.id}`
          },
          () => {
            fetchAssignments();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user, selectedDate, statusFilter]);

  // Real-time subscription for assignment updates - only for new assignments or external changes
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel('assignment_changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'room_assignments',
          filter: `assigned_to=eq.${user.id}`
        },
        () => {
          console.log('New assignment received, refetching...');
          fetchAssignments();
          fetchSummary();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'room_assignments',
          filter: `assigned_to=eq.${user.id}`
        },
        () => {
          console.log('Assignment deleted, refetching...');
          fetchAssignments();
          fetchSummary();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const fetchAssignments = async () => {
    if (!user?.id) return;
    
    try {
      // 1) Fetch assignments only (no nested join to avoid FK dependency)
      let query = supabase
        .from('room_assignments')
        .select('*')
        .eq('assigned_to', user.id)
        .eq('assignment_date', selectedDate);

      // Apply status filter if set
      if (statusFilter && statusFilter !== 'total') {
        query = query.eq('status', statusFilter as 'assigned' | 'in_progress' | 'completed');
      }

      const { data, error } = await query;

      if (error) throw error;
      let assignmentsData: any[] = data || [];

      // 2) Always fetch room details in a separate query and merge
      const roomIds = Array.from(new Set(assignmentsData.map((a: any) => a.room_id).filter(Boolean)));
      console.log('Room IDs to fetch:', roomIds);
      
      if (roomIds.length > 0) {
        const { data: roomRows, error: roomsError } = await supabase
          .from('rooms')
          .select('id, room_number, hotel, status, room_name, floor_number, bed_type, towel_change_required, linen_change_required, guest_nights_stayed')
          .in('id', roomIds);
          
        console.log('Rooms fetch result:', { roomRows, roomsError });
        
        if (!roomsError && roomRows) {
          const roomMap = Object.fromEntries(roomRows.map((r: any) => [r.id, r]));
          console.log('Room map created:', roomMap);
          
          assignmentsData = assignmentsData.map((a: any) => ({
            ...a,
            rooms: roomMap[a.room_id] ?? null,
          }));
          
      console.log('Final assignments with rooms:', assignmentsData);
        } else {
          console.error('Rooms fetch error:', roomsError);
        }
      }

      // Filter out checkout rooms that are not ready to clean
      assignmentsData = assignmentsData.filter((assignment: any) => {
        // Only show checkout rooms if they are marked as ready to clean
        if (assignment.assignment_type === 'checkout_cleaning') {
          return assignment.ready_to_clean === true;
        }
        return true; // Show all non-checkout assignments
      });

      // Sort with smart prioritization: in_progress > manual priority > checkout (by floor) > daily (by floor)
      assignmentsData.sort((a, b) => {
        const statusPriority: Record<string, number> = {
          'in_progress': 1,
          'assigned': 2,
          'completed': 3,
          'cancelled': 4
        };

        // 1. In-progress rooms ALWAYS at the top
        const statusDiff = (statusPriority[a.status] ?? 99) - (statusPriority[b.status] ?? 99);
        if (statusDiff !== 0) return statusDiff;

        // 2. Manual priority (only for assigned/in_progress)
        const aPriority = (a.priority ?? 1);
        const bPriority = (b.priority ?? 1);
        const priorityDiff = bPriority - aPriority;
        if (priorityDiff !== 0) return priorityDiff;

        // 3. Checkout rooms before daily rooms
        const aIsCheckout = a.assignment_type === 'checkout_cleaning' && a.ready_to_clean;
        const bIsCheckout = b.assignment_type === 'checkout_cleaning' && b.ready_to_clean;
        if (aIsCheckout && !bIsCheckout) return -1;
        if (!aIsCheckout && bIsCheckout) return 1;

        // 4. Within same type, group by floor
        const aFloor = a.rooms?.floor_number ?? 999;
        const bFloor = b.rooms?.floor_number ?? 999;
        const floorDiff = aFloor - bFloor;
        if (floorDiff !== 0) return floorDiff;

        // 5. Within same floor, sort by room number
        const aRoomNum = parseInt(a.rooms?.room_number?.replace(/\D/g, '') || '999');
        const bRoomNum = parseInt(b.rooms?.room_number?.replace(/\D/g, '') || '999');
        return aRoomNum - bRoomNum;
      });

      // If no specific filter, exclude completed tasks for cleaner view
      if (!statusFilter) {
        assignmentsData = assignmentsData.filter((a: any) => a.status !== 'completed');
      }
      
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
      
      const summaryData = typeof data === 'string' ? JSON.parse(data) : data;
      setSummary(summaryData || { total_assigned: 0, completed: 0, in_progress: 0, pending: 0 });
    } catch (error) {
      console.error('Error fetching summary:', error);
    }
  };

  // Initialize summary on component mount
  useEffect(() => {
    if (user?.id) {
      fetchSummary();
    }
  }, [user?.id, selectedDate]);

  const handleStatusUpdate = (assignmentId: string, newStatus: 'assigned' | 'in_progress' | 'completed' | 'cancelled') => {
    setAssignments(prev => {
      // Update the specific assignment while maintaining the original order
      const updatedAssignments = prev.map(assignment => {
        if (assignment.id === assignmentId) {
          return { 
            ...assignment, 
            status: newStatus,
            started_at: newStatus === 'in_progress' ? new Date().toISOString() : assignment.started_at,
            completed_at: newStatus === 'completed' ? new Date().toISOString() : assignment.completed_at
          };
        }
        return assignment;
      });
      
      console.log('Local status update - maintaining order for assignment:', assignmentId, 'new status:', newStatus);
      return updatedAssignments;
    });
    fetchSummary();
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
    <div className="w-full max-w-md mx-auto px-4 py-4 space-y-4 min-h-screen overflow-x-hidden">
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
      <div className="grid grid-cols-2 gap-3">
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
          }`}
          onClick={() => setStatusFilter(statusFilter === 'assigned' ? null : 'assigned')}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-orange-600" />
              <div className="min-w-0">
                <p className="text-xl sm:text-2xl font-bold text-orange-700 dark:text-orange-300">{summary.pending}</p>
                <p className="text-xs sm:text-sm text-orange-600 dark:text-orange-400 font-medium">{t('housekeeping.waiting')}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

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
        
        {/* Hotel Assignment Info */}
        {profile?.assigned_hotel && (
          <div className="text-xs text-muted-foreground p-2 bg-muted rounded-md mb-4">
            <p className="font-medium">{t('tasks.hotelAssignment')}: {profile.assigned_hotel}</p>
          </div>
        )}

        {assignments.length === 0 ? (
          <Card className="text-center py-8">
            <CardContent>
              <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-4" />
              <p className="text-lg font-medium text-foreground mb-2">{t('housekeeping.allDone')}</p>
              <p className="text-sm text-muted-foreground">
                {t('housekeeping.noTasksFor')} {format(new Date(selectedDate), 'MMMM dd, yyyy')}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {assignments.map((assignment) => (
              <div key={assignment.id}>
                <AssignedRoomCard
                  assignment={assignment}
                  onStatusUpdate={handleStatusUpdate}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Dialogs */}
      {selectedAssignment && (
        <div>
          {/* Room Detail Dialog placeholder */}
        </div>
      )}

      {selectedRoom && (
        <DirtyLinenDialog
          open={linenDialogOpen}
          onOpenChange={setLinenDialogOpen}
          roomId={selectedRoom.id}
          roomNumber={selectedRoom.room_number}
          assignmentId={selectedAssignmentId}
        />
      )}

      {/* Daily Room Photo Capture Dialog */}
      {selectedRoom && selectedAssignmentId && (
        <SimplifiedPhotoCapture
          open={imageCaptureDialogOpen}
          onOpenChange={setImageCaptureDialogOpen}
          roomNumber={selectedRoom.room_number}
          assignmentId={selectedAssignmentId}
          onPhotoCaptured={() => {
            console.log('Daily room photos captured');
            toast.success('Daily room photos captured successfully');
          }}
        />
      )}
    </div>
  );
}