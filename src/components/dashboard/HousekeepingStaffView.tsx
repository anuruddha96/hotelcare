import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar, Clock, CheckCircle, AlertCircle } from 'lucide-react';
import { AssignedRoomCard } from './AssignedRoomCard';
import { toast } from 'sonner';
import { format } from 'date-fns';

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
  rooms: {
    room_number: string;
    hotel: string;
    status: string;
    room_name: string | null;
    floor_number: number | null;
  };
}

interface Summary {
  total_assigned: number;
  completed: number;
  in_progress: number;
  pending: number;
}

export function HousekeepingStaffView() {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [summary, setSummary] = useState<Summary>({ total_assigned: 0, completed: 0, in_progress: 0, pending: 0 });
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  useEffect(() => {
    if (user?.id) {
      fetchAssignments();
      fetchSummary();
    }
  }, [user?.id, selectedDate]);

  const fetchAssignments = async () => {
    try {
      const { data, error } = await supabase
        .from('room_assignments')
        .select(`
          id,
          room_id,
          assignment_type,
          status,
          priority,
          estimated_duration,
          notes,
          assignment_date,
          created_at,
          rooms (
            room_number,
            hotel,
            status,
            room_name,
            floor_number
          )
        `)
        .eq('assigned_to', user?.id)
        .eq('assignment_date', selectedDate)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: true });

      if (error) throw error;
      
      // Filter and properly type the assignments
      const validAssignments = (data || [])
        .filter(assignment => assignment.rooms && !('error' in assignment.rooms))
        .map(assignment => ({
          ...assignment,
          rooms: assignment.rooms as any
        }));
      setAssignments(validAssignments);
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
        assignment.id === assignmentId 
          ? { ...assignment, status: newStatus }
          : assignment
      )
    );
    fetchSummary(); // Refresh summary
  };

  const getPriorityBadge = (priority: number) => {
    switch (priority) {
      case 3:
        return <Badge variant="destructive">High Priority</Badge>;
      case 2:
        return <Badge variant="secondary">Medium Priority</Badge>;
      default:
        return <Badge variant="outline">Low Priority</Badge>;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'text-green-600';
      case 'in_progress':
        return 'text-blue-600';
      case 'assigned':
        return 'text-orange-600';
      default:
        return 'text-gray-600';
    }
  };

  if (loading) {
    return <div className="flex justify-center p-8">Loading assignments...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Date Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Work Schedule
          </CardTitle>
        </CardHeader>
        <CardContent>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 border rounded-md"
          />
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-blue-600" />
              <div>
                <p className="text-2xl font-bold">{summary.total_assigned}</p>
                <p className="text-sm text-muted-foreground">Total Assigned</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <div>
                <p className="text-2xl font-bold">{summary.completed}</p>
                <p className="text-sm text-muted-foreground">Completed</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-blue-600" />
              <div>
                <p className="text-2xl font-bold">{summary.in_progress}</p>
                <p className="text-sm text-muted-foreground">In Progress</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-orange-600" />
              <div>
                <p className="text-2xl font-bold">{summary.pending}</p>
                <p className="text-sm text-muted-foreground">Pending</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Assignments List */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Today's Assignments</h3>
        {assignments.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">No assignments for {format(new Date(selectedDate), 'MMM dd, yyyy')}</p>
            </CardContent>
          </Card>
        ) : (
          assignments.map((assignment) => (
            <AssignedRoomCard
              key={assignment.id}
              assignment={assignment}
              onStatusUpdate={handleStatusUpdate}
            />
          ))
        )}
      </div>
    </div>
  );
}