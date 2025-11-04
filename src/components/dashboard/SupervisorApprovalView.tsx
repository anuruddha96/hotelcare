import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  CheckCircle, 
  RefreshCw, 
  Clock, 
  User,
  MapPin,
  AlertTriangle,
  History
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/hooks/useTranslation';
import { useNotifications } from '@/hooks/useNotifications';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { CompletionDataView } from './CompletionDataView';
import { ApprovalHistoryView } from './ApprovalHistoryView';

interface PendingAssignment {
  id: string;
  room_id: string;
  assignment_type: 'daily_cleaning' | 'checkout_cleaning' | 'maintenance' | 'deep_cleaning';
  status: string;
  priority: number;
  estimated_duration: number;
  notes: string;
  completed_at: string;
  started_at: string | null;
  supervisor_approved: boolean;
  assigned_to: string;
  assignment_date: string;
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
  profiles: {
    full_name: string;
    nickname: string;
  } | null;
}

interface Staff {
  id: string;
  full_name: string;
  nickname: string;
  role: string;
}

export function SupervisorApprovalView() {
  const { t } = useTranslation();
  const { showNotification } = useNotifications();
  const [pendingAssignments, setPendingAssignments] = useState<PendingAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [staff, setStaff] = useState<Staff[]>([]);
  const [reassignDialogOpen, setReassignDialogOpen] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<string | null>(null);
  const [selectedHousekeeper, setSelectedHousekeeper] = useState<string>('');
  const [earlySignoutRequests, setEarlySignoutRequests] = useState<any[]>([]);

  useEffect(() => {
    fetchPendingAssignments();
    fetchStaff();
    
    // Set up real-time subscription
    const channel = supabase
      .channel('supervisor-assignments')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_assignments',
          filter: 'status=eq.completed'
        },
        (payload) => {
          fetchPendingAssignments();
          if (payload.eventType === 'INSERT' || (payload.eventType === 'UPDATE' && payload.new.status === 'completed' && payload.old.status !== 'completed')) {
            showNotification(t('notifications.newCompletion'), 'info');
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedDate, showNotification, t]);

  const fetchStaff = async () => {
    try {
      const { data: currentUser } = await supabase.auth.getUser();
      if (!currentUser.user) return;

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', currentUser.user.id)
        .single();

      if (profileError) throw profileError;

      const { data, error } = await supabase.rpc('get_assignable_staff_secure', {
        requesting_user_role: profile?.role
      });

      if (error) throw error;
      setStaff(data || []);
    } catch (error) {
      console.error('Error fetching staff:', error);
    }
  };

  const fetchPendingAssignments = async () => {
    setLoading(true);
    try {
      const dateStr = selectedDate.toISOString().split('T')[0];
      
      // Get current user's profile to get assigned hotel
      const { data: currentUser } = await supabase.auth.getUser();
      if (!currentUser.user) return;

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('assigned_hotel')
        .eq('id', currentUser.user.id)
        .single();

      if (profileError) throw profileError;

      // Get hotel name from hotel_id if needed
      const userHotelId = profile?.assigned_hotel;
      let userHotelName = userHotelId;

      if (userHotelId) {
        const { data: hotelName } = await supabase
          .rpc('get_hotel_name_from_id', { hotel_id: userHotelId });
        if (hotelName) {
          userHotelName = hotelName;
        }
      }
      
      // First fetch room assignments, then fetch early sign-out requests
      const { data: assignmentData, error: assignmentError } = await supabase
        .from('room_assignments')
        .select(`
          *,
          rooms!inner (
            room_number,
            hotel,
            status,
            room_name,
            floor_number,
            towel_change_required,
            linen_change_required,
            guest_nights_stayed
          ),
          profiles!assigned_to (
            full_name,
            nickname
          )
        `)
        .eq('status', 'completed')
        .eq('supervisor_approved', false)
        .eq('assignment_date', dateStr)
        .order('completed_at', { ascending: false });

      if (assignmentError) throw assignmentError;

      // Fetch early sign-out requests
      const { data: earlySignoutData, error: earlySignoutError } = await supabase
        .from('early_signout_requests')
        .select(`
          id,
          user_id,
          requested_at,
          status,
          rejection_reason,
          profiles!user_id (
            full_name,
            nickname
          )
        `)
        .eq('status', 'pending')
        .order('requested_at', { ascending: false });

      if (earlySignoutError) throw earlySignoutError;

      // Filter room assignments by the user's selected hotel
      let assignments = (assignmentData as any) || [];
      if (userHotelName) {
        assignments = assignments.filter((assignment: any) => 
          assignment.rooms?.hotel === userHotelName || 
          assignment.rooms?.hotel === userHotelId
        );
      }
      
      // Store both types in separate state or combine them for display
      setPendingAssignments(assignments);
      setEarlySignoutRequests(earlySignoutData || []);
    } catch (error) {
      console.error('Error fetching pending assignments:', error);
      toast.error('Failed to fetch pending assignments');
    } finally {
      setLoading(false);
    }
  };

  const calculateDuration = (startTime: string, endTime: string) => {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const diffMs = end.getTime() - start.getTime();
    const diffMins = Math.round(diffMs / (1000 * 60));
    
    const hours = Math.floor(diffMins / 60);
    const minutes = diffMins % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const handleApproval = async (assignmentId: string) => {
    try {
      const assignment = pendingAssignments.find(a => a.id === assignmentId);
      
      const updateData: any = {
        supervisor_approved: true,
        supervisor_approved_by: (await supabase.auth.getUser()).data.user?.id,
        supervisor_approved_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('room_assignments')
        .update(updateData)
        .eq('id', assignmentId);

      if (error) throw error;

      // Push status to Previo if room is approved
      if (assignment?.room_id) {
        try {
          await supabase.functions.invoke('previo-update-room-status', {
            body: { 
              roomId: assignment.room_id,
              status: 'clean'
            }
          });
          console.log('Room status pushed to Previo');
        } catch (previoError) {
          console.error('Failed to update Previo:', previoError);
          // Don't fail the approval if Previo update fails
        }
      }

      toast.success('Assignment approved successfully');
      showNotification(t('supervisor.roomMarkedClean'), 'success');
      fetchPendingAssignments();
    } catch (error) {
      console.error('Error updating assignment approval:', error);
      toast.error('Failed to update approval status');
    }
  };

  const handleReassignment = async () => {
    if (!selectedAssignment || !selectedHousekeeper) return;

    try {
      const assignment = pendingAssignments.find(a => a.id === selectedAssignment);
      if (!assignment) return;

      // First, check if there's already an active assignment for this room on the same date
      const { data: existingAssignments, error: checkError } = await supabase
        .from('room_assignments')
        .select('id, assigned_to, status')
        .eq('room_id', assignment.room_id)
        .eq('assignment_date', assignment.assignment_date)
        .in('status', ['assigned', 'in_progress'])
        .neq('id', selectedAssignment);

      if (checkError) throw checkError;

      // Cancel or mark as superseded any existing active assignments for this room
      if (existingAssignments && existingAssignments.length > 0) {
        const { error: updateError } = await supabase
          .from('room_assignments')
          .update({
            status: 'completed',
            supervisor_approved: true,
            supervisor_approved_by: (await supabase.auth.getUser()).data.user?.id,
            supervisor_approved_at: new Date().toISOString(),
            notes: 'Reassigned to another housekeeper'
          })
          .in('id', existingAssignments.map(a => a.id));

        if (updateError) throw updateError;
      }

      // Create new assignment for the selected housekeeper
      const { error } = await supabase
        .from('room_assignments')
        .insert({
          room_id: assignment.room_id,
          assigned_to: selectedHousekeeper,
          assigned_by: (await supabase.auth.getUser()).data.user?.id,
          assignment_date: assignment.assignment_date,
          assignment_type: assignment.assignment_type,
          estimated_duration: assignment.estimated_duration,
          priority: assignment.priority,
          notes: `Reassigned - Previous completion needs review`
        });

      if (error) throw error;

      // Mark the current assignment as approved (remove from pending list)
      await supabase
        .from('room_assignments')
        .update({
          supervisor_approved: true,
          supervisor_approved_by: (await supabase.auth.getUser()).data.user?.id,
          supervisor_approved_at: new Date().toISOString()
        })
        .eq('id', selectedAssignment);

      toast.success('Room reassigned successfully');
      fetchPendingAssignments();
      setReassignDialogOpen(false);
      setSelectedAssignment(null);
      setSelectedHousekeeper('');
    } catch (error) {
      console.error('Error reassigning room:', error);
      toast.error('Failed to reassign room');
    }
  };

  const getAssignmentTypeLabel = (type: string) => {
    switch (type) {
      case 'daily_cleaning':
        return t('housekeeping.assignmentType.dailyClean');
      case 'checkout_cleaning':
        return t('housekeeping.assignmentType.checkoutClean');
      case 'deep_cleaning':
        return t('housekeeping.assignmentType.deepClean');
      case 'maintenance':
        return t('housekeeping.assignmentType.maintenance');
      default:
        return type;
    }
  };


  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground mb-2">
          {t('supervisor.approvals')}
        </h2>
        <p className="text-muted-foreground">
          {t('supervisor.manageApprovals')}
        </p>
      </div>

      <Tabs defaultValue="pending" className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="pending" className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            {t('supervisor.pendingApprovals')}
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-2">
            <History className="h-4 w-4" />
            {t('supervisor.approvalHistory')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
            <div>
              <p className="text-muted-foreground">
                {t('supervisor.reviewCompletedTasks')}
              </p>
            </div>
        
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-full sm:w-auto">
              <Clock className="h-4 w-4 mr-2" />
              {format(selectedDate, 'PPP')}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => date && setSelectedDate(date)}
              initialFocus
            />
          </PopoverContent>
        </Popover>
          </div>

          {pendingAssignments.length === 0 && earlySignoutRequests.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <CheckCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">
              {t('supervisor.noTasksPending')}
            </h3>
            <p className="text-muted-foreground">
              {t('supervisor.allTasksReviewed')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Early Sign-Out Request Cards */}
          {earlySignoutRequests.length > 0 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-xl font-bold text-foreground flex items-center gap-2">
                  <Clock className="h-5 w-5 text-orange-600" />
                  Early Sign-Out Requests
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Staff requesting to sign out before regular hours
                </p>
              </div>
              
              {earlySignoutRequests.map((request) => (
              <Card key={request.id} className="border-2 border-orange-300 bg-orange-50/50">
                <CardHeader>
                  <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                    <div className="flex items-center gap-3">
                      <CardTitle className="text-xl font-bold text-foreground">
                        {request.profiles?.full_name || 'Unknown'}
                      </CardTitle>
                      <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300">
                        Early Sign-Out Request
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                      <Clock className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Requested At</p>
                        <p className="text-lg font-semibold">
                          {new Date(request.requested_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex gap-3">
                    <Button
                      onClick={async () => {
                        try {
                          const { error } = await supabase
                            .from('early_signout_requests')
                            .update({
                              status: 'approved',
                              approved_by: (await supabase.auth.getUser()).data.user?.id,
                              approved_at: new Date().toISOString()
                            })
                            .eq('id', request.id);

                          if (error) throw error;

                          // Actually check out the staff member
                          const { data: attendance } = await supabase
                            .from('staff_attendance')
                            .select('*')
                            .eq('user_id', request.user_id)
                            .eq('work_date', new Date().toISOString().split('T')[0])
                            .eq('status', 'checked_in')
                            .single();

                          if (attendance) {
                            await supabase
                              .from('staff_attendance')
                              .update({
                                check_out_time: new Date().toISOString(),
                                status: 'checked_out'
                              })
                              .eq('id', attendance.id);
                          }

                          toast.success('Early sign-out approved');
                          fetchPendingAssignments();
                        } catch (error: any) {
                          console.error('Error approving early signout:', error);
                          toast.error('Failed to approve early sign-out');
                        }
                      }}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Approve Early Sign-Out
                    </Button>
                    
                    <Button
                      variant="destructive"
                      onClick={async () => {
                        const reason = prompt('Enter rejection reason:');
                        if (!reason) return;
                        
                        try {
                          const { error } = await supabase
                            .from('early_signout_requests')
                            .update({
                              status: 'rejected',
                              approved_by: (await supabase.auth.getUser()).data.user?.id,
                              approved_at: new Date().toISOString(),
                              rejection_reason: reason
                            })
                            .eq('id', request.id);

                          if (error) throw error;

                          toast.success('Early sign-out rejected');
                          fetchPendingAssignments();
                        } catch (error: any) {
                          console.error('Error rejecting early signout:', error);
                          toast.error('Failed to reject early sign-out');
                        }
                      }}
                    >
                      <AlertTriangle className="h-4 w-4 mr-2" />
                      Reject
                    </Button>
                  </div>
                </CardContent>
              </Card>
              ))}
            </div>
          )}
          
          {/* Room Assignment Cards */}
          {pendingAssignments.length > 0 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-xl font-bold text-foreground flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  Room Completion Approvals
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Review completed room cleanings
                </p>
              </div>
              
              <div className="grid gap-4">
          {pendingAssignments.map((assignment) => (
            <Card key={assignment.id} className="border border-border shadow-sm hover:shadow-md transition-all duration-200">
              <CardHeader>
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                  <div className="flex items-center gap-3">
                    <CardTitle className="text-xl font-bold text-foreground">
                      Room {assignment.rooms?.room_number || 'N/A'}
                    </CardTitle>
                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                      {t('housekeeping.completed')}
                    </Badge>
                  </div>
                   <Badge variant="outline" className="bg-muted text-foreground border-border">
                     {getAssignmentTypeLabel(assignment.assignment_type)}
                   </Badge>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                    <User className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">
                        {t('supervisor.cleanedBy')}
                      </p>
                      <p className="text-lg font-semibold text-foreground">
                        {assignment.profiles?.full_name || 'Unknown'}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                    <MapPin className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">{t('supervisor.hotel')}</p>
                      <p className="text-lg font-semibold text-foreground">
                        {assignment.rooms?.hotel || 'Unknown'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                    <Clock className="h-5 w-5 text-blue-600" />
                    <div>
                      <p className="text-sm font-medium text-blue-700">{t('supervisor.startedAt')}</p>
                      <p className="text-lg font-semibold text-blue-800">
                        {assignment.started_at ? new Date(assignment.started_at).toLocaleTimeString() : 'N/A'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
                    <Clock className="h-5 w-5 text-green-600" />
                    <div>
                      <p className="text-sm font-medium text-green-700">{t('supervisor.completedAt')}</p>
                      <p className="text-lg font-semibold text-green-800">
                        {new Date(assignment.completed_at).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                </div>

                {assignment.started_at && (
                  <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
                    <div className="flex items-center gap-2 mb-2">
                      <Clock className="h-5 w-5 text-amber-600" />
                      <h4 className="font-semibold text-amber-800">{t('supervisor.duration')}</h4>
                    </div>
                    <p className="text-2xl font-bold text-amber-900">
                      {calculateDuration(assignment.started_at, assignment.completed_at)}
                    </p>
                    <p className="text-sm text-amber-700 mt-1">
                      {t('supervisor.totalTimeTaken')}
                    </p>
                  </div>
                )}

                 {/* Important Assignment Notes - Prominently Displayed */}
                 {assignment.notes && (
                  <div className="relative p-5 bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-50 rounded-xl border-2 border-amber-300 shadow-lg mb-4">
                    <div className="absolute -top-3 -left-3 bg-amber-400 text-white rounded-full p-2 shadow-md">
                      <AlertTriangle className="h-5 w-5" />
                    </div>
                    <div className="ml-6">
                      <h4 className="font-bold text-amber-900 mb-2 text-lg flex items-center gap-2">
                        📝 {t('housekeeping.assignmentNotes')}
                      </h4>
                      <p className="text-base text-amber-800 leading-relaxed font-semibold bg-white/60 p-3 rounded-lg border border-amber-200">
                        {assignment.notes}
                      </p>
                    </div>
                  </div>
                 )}

                 {/* Completion Photos, DND Photos, and Dirty Linen */}
                 <CompletionDataView
                   assignmentId={assignment.id}
                   roomId={assignment.room_id}
                   assignmentDate={assignment.assignment_date}
                   housekeeperId={assignment.assigned_to}
                 />

                {/* Towel and Linen Change Requirements */}
                {(assignment.rooms?.towel_change_required || assignment.rooms?.linen_change_required) && (
                  <div className="space-y-3">
                    <h4 className="font-semibold text-foreground">Special Requirements</h4>
                    <div className="flex flex-wrap gap-2">
                      {assignment.rooms.towel_change_required && (
                        <div className="p-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg flex-1 min-w-[200px]">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="text-lg">🏺</div>
                            <div className="font-bold">TOWEL CHANGE REQUIRED</div>
                          </div>
                          <p className="text-sm opacity-90">
                            Guest stayed {assignment.rooms.guest_nights_stayed || 0} nights
                          </p>
                        </div>
                      )}
                      
                      {assignment.rooms.linen_change_required && (
                        <div className="p-3 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg flex-1 min-w-[200px]">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="text-lg">🛏️</div>
                            <div className="font-bold">BED LINEN CHANGE REQUIRED</div>
                          </div>
                          <p className="text-sm opacity-90">
                            Guest stayed {assignment.rooms.guest_nights_stayed || 0} nights
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                  <div className="flex flex-col sm:flex-row gap-3">
                   <Button
                     onClick={() => handleApproval(assignment.id)}
                     className="w-full sm:w-auto bg-green-600 hover:bg-green-700 text-white"
                   >
                     <CheckCircle className="h-4 w-4 mr-2" />
                     {t('supervisor.approveTask')}
                   </Button>
                   
                   <Dialog 
                     open={reassignDialogOpen && selectedAssignment === assignment.id} 
                     onOpenChange={(open) => {
                       setReassignDialogOpen(open);
                       if (!open) {
                         setSelectedAssignment(null);
                         setSelectedHousekeeper('');
                       }
                     }}
                   >
                     <DialogTrigger asChild>
                       <Button
                         variant="outline"
                         onClick={() => setSelectedAssignment(assignment.id)}
                         className="w-full sm:w-auto"
                       >
                         <RefreshCw className="h-4 w-4 mr-2" />
                         {t('supervisor.reassignRoom')}
                       </Button>
                     </DialogTrigger>
                     <DialogContent>
                       <DialogHeader>
                         <DialogTitle>
                           {t('supervisor.reassignRoomTitle')} {assignment.rooms?.room_number}
                         </DialogTitle>
                       </DialogHeader>
                       <div className="space-y-4">
                         <div>
                           <label className="text-sm font-medium text-foreground mb-2 block">
                             {t('supervisor.selectHousekeeper')}
                           </label>
                           <Select value={selectedHousekeeper} onValueChange={setSelectedHousekeeper}>
                             <SelectTrigger>
                               <SelectValue placeholder={t('supervisor.chooseHousekeeper')} />
                             </SelectTrigger>
                             <SelectContent>
                               {staff.map((person) => (
                                 <SelectItem key={person.id} value={person.id}>
                                   {person.full_name} ({person.nickname})
                                 </SelectItem>
                               ))}
                             </SelectContent>
                           </Select>
                         </div>
                         <div className="flex justify-end gap-3">
                           <Button 
                             variant="outline" 
                             onClick={() => {
                               setReassignDialogOpen(false);
                               setSelectedAssignment(null);
                               setSelectedHousekeeper('');
                             }}
                           >
                             {t('common.cancel')}
                           </Button>
                           <Button 
                             onClick={handleReassignment}
                             disabled={!selectedHousekeeper}
                           >
                             {t('supervisor.confirmReassign')}
                           </Button>
                         </div>
                       </div>
                     </DialogContent>
                   </Dialog>
                  </div>
               </CardContent>
             </Card>
            ))}
              </div>
            </div>
          )}
        </div>
      )}
        </TabsContent>

        <TabsContent value="history" className="space-y-6">
          <ApprovalHistoryView />
        </TabsContent>
      </Tabs>
    </div>
  );
}