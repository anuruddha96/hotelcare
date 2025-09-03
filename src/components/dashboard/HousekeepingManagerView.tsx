import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Users, Plus, Calendar, CheckCircle } from 'lucide-react';
import { RoomAssignmentDialog } from './RoomAssignmentDialog';
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

export function HousekeepingManagerView() {
  const { user } = useAuth();
  const [housekeepingStaff, setHousekeepingStaff] = useState<HousekeepingStaff[]>([]);
  const [teamAssignments, setTeamAssignments] = useState<TeamAssignment[]>([]);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [loading, setLoading] = useState(true);
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);

  useEffect(() => {
    fetchHousekeepingStaff();
    fetchTeamAssignments();
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
      // Get assignments for each staff member
      const { data: assignments, error } = await supabase
        .from('room_assignments')
        .select(`
          assigned_to,
          status,
          profiles:assigned_to (
            full_name,
            nickname
          )
        `)
        .eq('assignment_date', selectedDate);

      if (error) throw error;

      // Process assignments to create summary
      const summaryMap = new Map<string, TeamAssignment>();
      
      assignments?.forEach((assignment: any) => {
        const staffId = assignment.assigned_to;
        const staffName = assignment.profiles?.full_name || 'Unknown';
        
        if (!summaryMap.has(staffId)) {
          summaryMap.set(staffId, {
            staff_id: staffId,
            staff_name: staffName,
            total_assigned: 0,
            completed: 0,
            in_progress: 0,
            pending: 0
          });
        }
        
        const summary = summaryMap.get(staffId)!;
        summary.total_assigned++;
        
        switch (assignment.status) {
          case 'completed':
            summary.completed++;
            break;
          case 'in_progress':
            summary.in_progress++;
            break;
          case 'assigned':
            summary.pending++;
            break;
        }
      });

      setTeamAssignments(Array.from(summaryMap.values()));
    } catch (error) {
      console.error('Error fetching team assignments:', error);
    }
  };

  const handleAssignmentCreated = () => {
    fetchTeamAssignments();
    setAssignmentDialogOpen(false);
    toast.success('Room assigned successfully');
  };

  const getProgressPercentage = (completed: number, total: number) => {
    return total > 0 ? Math.round((completed / total) * 100) : 0;
  };

  if (loading) {
    return <div className="flex justify-center p-8">Loading team data...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header with Actions */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-semibold">Team Management</h2>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 border rounded-md"
          />
        </div>
        
        <Dialog open={assignmentDialogOpen} onOpenChange={setAssignmentDialogOpen}>
          <DialogTrigger asChild>
            <Button className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Assign Rooms
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Assign Rooms to Staff</DialogTitle>
            </DialogHeader>
            <RoomAssignmentDialog 
              onAssignmentCreated={handleAssignmentCreated}
              selectedDate={selectedDate}
            />
          </DialogContent>
        </Dialog>
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
                        <span>Progress</span>
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
                      <div>
                        <p className="text-lg font-semibold text-green-600">{assignment.completed}</p>
                        <p className="text-xs text-muted-foreground">Done</p>
                      </div>
                      <div>
                        <p className="text-lg font-semibold text-blue-600">{assignment.in_progress}</p>
                        <p className="text-xs text-muted-foreground">Working</p>
                      </div>
                      <div>
                        <p className="text-lg font-semibold text-orange-600">{assignment.pending}</p>
                        <p className="text-xs text-muted-foreground">Pending</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-muted-foreground text-sm">No assignments for {format(new Date(selectedDate), 'MMM dd')}</p>
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
            Team Summary for {format(new Date(selectedDate), 'MMMM dd, yyyy')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold">{housekeepingStaff.length}</p>
              <p className="text-sm text-muted-foreground">Team Members</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{teamAssignments.reduce((sum, a) => sum + a.total_assigned, 0)}</p>
              <p className="text-sm text-muted-foreground">Total Assignments</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-green-600">{teamAssignments.reduce((sum, a) => sum + a.completed, 0)}</p>
              <p className="text-sm text-muted-foreground">Completed</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-blue-600">{teamAssignments.reduce((sum, a) => sum + a.in_progress, 0)}</p>
              <p className="text-sm text-muted-foreground">In Progress</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}