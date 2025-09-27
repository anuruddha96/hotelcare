import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Users, Plus, Calendar, CheckCircle, Trash2 } from 'lucide-react';
import { EnhancedRoomCardV2 } from './EnhancedRoomCardV2';
import { CompactRoomCard } from './CompactRoomCard';
import { RoomAssignmentDialog } from './RoomAssignmentDialog';
import { WorkingRoomDetailDialog } from './WorkingRoomDetailDialog';
import { PendingRoomsDialog } from './PendingRoomsDialog';
import { DoneRoomsDialog } from './DoneRoomsDialog';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface HousekeepingStaff {
  id: string;
  full_name: string;
  nickname: string;
  email: string;
}

interface TeamAssignment {
  staff_id: string;
  staff_name: string;
  total_assigned: number;
  completed: number;
  in_progress: number;
  pending: number;
}

interface RoomAssignment {
  id: string;
  room_id: string;
  assigned_to: string;
  status: string;
  room_number: string;
  hotel: string;
}

export function HousekeepingManagerView() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [housekeepingStaff, setHousekeepingStaff] = useState<HousekeepingStaff[]>([]);
  const [teamAssignments, setTeamAssignments] = useState<TeamAssignment[]>([]);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [loading, setLoading] = useState(true);
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
  const [bulkUnassignMode, setBulkUnassignMode] = useState(false);
  const [selectedAssignments, setSelectedAssignments] = useState<string[]>([]);
  const [roomAssignments, setRoomAssignments] = useState<RoomAssignment[]>([]);
  const [unassignDialogOpen, setUnassignDialogOpen] = useState(false);
  const [workingRoomDialogOpen, setWorkingRoomDialogOpen] = useState(false);
  const [pendingRoomsDialogOpen, setPendingRoomsDialogOpen] = useState(false);
  const [doneRoomsDialogOpen, setDoneRoomsDialogOpen] = useState(false);
  const [staffAttendance, setStaffAttendance] = useState<Record<string, any>>({});
  const [selectedStaff, setSelectedStaff] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    fetchHousekeepingStaff();
    fetchTeamAssignments();
    fetchRoomAssignments();
  }, [selectedDate]);

  // Real-time subscriptions for live updates
  useEffect(() => {
    // Subscribe to profile changes (new housekeeping staff)
    const profilesChannel = supabase
      .channel('profiles-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
          filter: 'role=eq.housekeeping'
        },
        () => {
          console.log('Profile change detected, refreshing staff list');
          fetchHousekeepingStaff();
        }
      )
      .subscribe();

    // Subscribe to room assignment changes
    const assignmentsChannel = supabase
      .channel('assignments-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_assignments'
        },
        () => {
          console.log('Assignment change detected, refreshing data');
          fetchTeamAssignments();
          fetchRoomAssignments();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(profilesChannel);
      supabase.removeChannel(assignmentsChannel);
    };
  }, [selectedDate]);

  const fetchHousekeepingStaff = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, nickname, email')
        .eq('role', 'housekeeping');

      if (error) throw error;
      setHousekeepingStaff(data || []);
    } catch (error) {
      console.error('Error fetching housekeeping staff:', error);
      toast.error('Failed to load housekeeping staff');
    } finally {
      setLoading(false);
    }
  };

  const fetchTeamAssignments = async () => {
    try {
      // Fetch assignments for selected date and compute counts in JS (avoids unsupported group())
      const { data, error } = await supabase
        .from('room_assignments')
        .select('assigned_to,status')
        .eq('assignment_date', selectedDate);

      if (error) throw error;

      const summaryMap = new Map<string, TeamAssignment>();

      // Initialize all staff with zero counts so cards always show
      housekeepingStaff.forEach(staff => {
        summaryMap.set(staff.id, {
          staff_id: staff.id,
          staff_name: staff.full_name,
          total_assigned: 0,
          completed: 0,
          in_progress: 0,
          pending: 0,
        });
      });

      // Apply counts
      (data || []).forEach((row: any) => {
        const staffId = row.assigned_to as string;
        let summary = summaryMap.get(staffId);
        if (!summary) {
          const staff = housekeepingStaff.find(s => s.id === staffId);
          summary = {
            staff_id: staffId,
            staff_name: staff?.full_name || 'Unassigned',
            total_assigned: 0,
            completed: 0,
            in_progress: 0,
            pending: 0,
          };
          summaryMap.set(staffId, summary);
        }
        summary.total_assigned += 1;
        if (row.status === 'completed') summary.completed += 1;
        else if (row.status === 'in_progress') summary.in_progress += 1;
        else if (row.status === 'assigned') summary.pending += 1;
      });

      setTeamAssignments(Array.from(summaryMap.values()));
    } catch (error) {
      console.error('Error fetching team assignments:', error);
      toast.error('Failed to load team assignments');
    }
  };

  const fetchRoomAssignments = async () => {
    try {
      const { data, error } = await supabase
        .from('room_assignments')
        .select(`
          id,
          room_id,
          assigned_to,
          status,
          rooms!inner(room_number, hotel)
        `)
        .eq('assignment_date', selectedDate);

      if (error) throw error;

      const assignments = (data || []).map((item: any) => ({
        id: item.id,
        room_id: item.room_id,
        assigned_to: item.assigned_to,
        status: item.status,
        room_number: item.rooms.room_number,
        hotel: item.rooms.hotel,
      }));

      setRoomAssignments(assignments);
    } catch (error) {
      console.error('Error fetching room assignments:', error);
    }
  };

  const fetchStaffAttendance = async () => {
    try {
      const today = selectedDate;
      const { data } = await supabase
        .from('staff_attendance')
        .select('user_id, status, break_type')
        .eq('work_date', today);

      const attendanceMap: Record<string, any> = {};
      data?.forEach(record => {
        attendanceMap[record.user_id] = record;
      });
      
      setStaffAttendance(attendanceMap);
    } catch (error) {
      console.error('Error fetching staff attendance:', error);
    }
  };


  const handleAssignmentCreated = () => {
    fetchTeamAssignments();
    fetchRoomAssignments();
    setAssignmentDialogOpen(false);
    toast.success(t('assignment.successMessage').replace('{count}', '1').replace('{staffName}', 'staff'));
  };

  const handleBulkUnassign = async () => {
    if (selectedAssignments.length === 0) return;

    try {
      const { error } = await supabase
        .from('room_assignments')
        .delete()
        .in('id', selectedAssignments);

      if (error) throw error;

      toast.success(t('team.unassignSuccess').replace('{count}', selectedAssignments.length.toString()));
      setSelectedAssignments([]);
      setBulkUnassignMode(false);
      fetchTeamAssignments();
      fetchRoomAssignments();
    } catch (error) {
      console.error('Error unassigning rooms:', error);
      toast.error(t('team.unassignError'));
    }
  };

  const toggleAssignmentSelection = (assignmentId: string) => {
    setSelectedAssignments(prev => 
      prev.includes(assignmentId) 
        ? prev.filter(id => id !== assignmentId)
        : [...prev, assignmentId]
    );
  };

  const getProgressPercentage = (completed: number, total: number) => {
    return total > 0 ? Math.round((completed / total) * 100) : 0;
  };

  if (loading) {
    return <div className="flex justify-center p-8">{t('common.loading')}</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header with Actions */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-semibold">{t('team.management')}</h2>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 border rounded-md"
          />
        </div>
        
        <div className="flex gap-2">
          {user && (user.role === 'admin' || user.role === 'manager' || user.role === 'housekeeping_manager') && (
            <>
              <Button
                variant={bulkUnassignMode ? "destructive" : "outline"}
                onClick={() => {
                  setBulkUnassignMode(!bulkUnassignMode);
                  setSelectedAssignments([]);
                }}
                className="flex items-center gap-2"
              >
                <Trash2 className="h-4 w-4" />
                {bulkUnassignMode ? t('common.cancel') : t('team.bulkUnassign')}
              </Button>
              
              {bulkUnassignMode && selectedAssignments.length > 0 && (
                <Button
                  variant="destructive"
                  onClick={() => setUnassignDialogOpen(true)}
                  className="flex items-center gap-2"
                >
                  {t('team.unassignSelected')} ({selectedAssignments.length})
                </Button>
              )}
            </>
          )}
          
          <Dialog open={assignmentDialogOpen} onOpenChange={setAssignmentDialogOpen}>
            <DialogTrigger asChild>
              <Button className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                {t('team.assignRoom')}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{t('team.createAssignment')}</DialogTitle>
              </DialogHeader>
              <RoomAssignmentDialog 
                onAssignmentCreated={handleAssignmentCreated}
                selectedDate={selectedDate}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Team Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {housekeepingStaff.map((staff) => {
          const assignment = teamAssignments.find(a => a.staff_id === staff.id);
          const progressPercentage = assignment ? getProgressPercentage(assignment.completed, assignment.total_assigned) : 0;
          
          return (
            <Card key={staff.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-lg">{staff.full_name}</CardTitle>
                    {staff.nickname && (
                      <p className="text-sm text-muted-foreground">({staff.nickname})</p>
                    )}
                    {staffAttendance[staff.id]?.status === 'on_break' && (
                      <Badge className="bg-yellow-500 text-white text-xs mt-1">
                        On Break - {staffAttendance[staff.id]?.break_type || 'Break'}
                      </Badge>
                    )}
                  </div>
                  <Badge variant={assignment?.total_assigned ? "default" : "secondary"}>
                    {assignment?.total_assigned || 0} rooms
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {assignment ? (
                  <>
                    {/* Progress Bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>{t('team.progress')}</span>
                        <span>{progressPercentage}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-green-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${progressPercentage}%` }}
                        />
                      </div>
                    </div>

                    {/* Status Breakdown */}
                        <div className="grid grid-cols-3 gap-2 text-center">
                      <div 
                        className="cursor-pointer hover:bg-green-50 rounded p-1 transition-colors"
                        onClick={() => {
                          if (assignment && assignment.completed > 0) {
                            setSelectedStaff({ id: staff.id, name: staff.full_name });
                            setDoneRoomsDialogOpen(true);
                          }
                        }}
                      >
                        <p className="text-lg font-semibold text-green-600">{assignment?.completed || 0}</p>
                        <p className="text-xs text-muted-foreground">{t('team.done')}</p>
                        {assignment && assignment.completed > 0 && (
                          <p className="text-xs text-green-600">{t('team.clickToView')}</p>
                        )}
                      </div>
                      <div 
                        className="cursor-pointer hover:bg-blue-50 rounded p-1 transition-colors"
                        onClick={() => {
                          if (assignment.in_progress > 0) {
                            setSelectedStaff({ id: staff.id, name: staff.full_name });
                            setWorkingRoomDialogOpen(true);
                          }
                        }}
                      >
                        <p className="text-lg font-semibold text-blue-600">{assignment.in_progress}</p>
                        <p className="text-xs text-muted-foreground">{t('team.working')}</p>
                        {assignment.in_progress > 0 && (
                          <p className="text-xs text-blue-600 font-medium">{t('team.clickToView')}</p>
                        )}
                      </div>
                      <div 
                        className="cursor-pointer hover:bg-orange-50 rounded p-1 transition-colors"
                        onClick={() => {
                          if (assignment.pending > 0) {
                            setSelectedStaff({ id: staff.id, name: staff.full_name });
                            setPendingRoomsDialogOpen(true);
                          }
                        }}
                      >
                        <p className="text-lg font-semibold text-orange-600">{assignment.pending}</p>
                        <p className="text-xs text-muted-foreground">{t('team.pending')}</p>
                        {assignment.pending > 0 && (
                          <p className="text-xs text-orange-600 font-medium">{t('team.clickToView')}</p>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-muted-foreground text-sm">{t('team.noAssignments')} {format(new Date(selectedDate), 'MMM dd')}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Quick Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {t('team.summary')} {format(new Date(selectedDate), 'MMMM dd, yyyy')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold">{housekeepingStaff.length}</p>
              <p className="text-sm text-muted-foreground">{t('team.teamMembers')}</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{teamAssignments.reduce((sum, a) => sum + a.total_assigned, 0)}</p>
              <p className="text-sm text-muted-foreground">{t('team.totalAssignments')}</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-green-600">{teamAssignments.reduce((sum, a) => sum + a.completed, 0)}</p>
              <p className="text-sm text-muted-foreground">{t('team.completed')}</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-blue-600">{teamAssignments.reduce((sum, a) => sum + a.in_progress, 0)}</p>
              <p className="text-sm text-muted-foreground">{t('team.inProgress')}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Unassign View */}
      {bulkUnassignMode && (
        <Card>
          <CardHeader>
            <CardTitle>{t('team.selectForUnassign')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {roomAssignments.map((assignment) => {
                const staff = housekeepingStaff.find(s => s.id === assignment.assigned_to);
                return (
                  <div key={assignment.id} className="border rounded-lg p-4 flex items-center space-x-3">
                    <Checkbox
                      checked={selectedAssignments.includes(assignment.id)}
                      onCheckedChange={() => toggleAssignmentSelection(assignment.id)}
                    />
                    <div className="flex-1">
                      <p className="font-medium">{assignment.room_number}</p>
                      <p className="text-sm text-muted-foreground">{assignment.hotel}</p>
                      <p className="text-sm text-muted-foreground">
                        {staff?.full_name || 'Unknown Staff'}
                      </p>
                      <Badge variant={assignment.status === 'completed' ? 'default' : 'secondary'}>
                        {assignment.status}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Confirmation Dialog */}
      <AlertDialog open={unassignDialogOpen} onOpenChange={setUnassignDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('team.unassignRooms')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('team.confirmUnassign')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              handleBulkUnassign();
              setUnassignDialogOpen(false);
            }}>
              {t('team.unassignSelected')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Working Room Detail Dialog */}
      {selectedStaff && (
        <WorkingRoomDetailDialog
          open={workingRoomDialogOpen}
          onOpenChange={setWorkingRoomDialogOpen}
          staffId={selectedStaff.id}
          staffName={selectedStaff.name}
          selectedDate={selectedDate}
        />
      )}

      {/* Pending Rooms Dialog */}
      {selectedStaff && (
        <PendingRoomsDialog
          open={pendingRoomsDialogOpen}
          onOpenChange={setPendingRoomsDialogOpen}
          staffId={selectedStaff.id}
          staffName={selectedStaff.name}
          selectedDate={selectedDate}
        />
      )}

      {/* Done Rooms Dialog */}
      {selectedStaff && (
        <DoneRoomsDialog
          open={doneRoomsDialogOpen}
          onOpenChange={setDoneRoomsDialogOpen}
          staffId={selectedStaff.id}
          staffName={selectedStaff.name}
          selectedDate={selectedDate}
        />
      )}
    </div>
  );
}