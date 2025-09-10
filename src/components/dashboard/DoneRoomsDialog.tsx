import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Clock, MapPin, CheckCircle } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

interface DoneRoomsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staffId: string;
  staffName: string;
  selectedDate: string;
}

interface CompletedAssignment {
  id: string;
  room_id: string;
  assignment_type: string;
  started_at: string | null;
  completed_at: string;
  notes: string | null;
  supervisor_approved: boolean;
  rooms: {
    room_number: string;
    hotel: string;
    room_name: string | null;
  } | null;
}

export function DoneRoomsDialog({ 
  open, 
  onOpenChange, 
  staffId, 
  staffName, 
  selectedDate 
}: DoneRoomsDialogProps) {
  const { t } = useTranslation();
  const [assignments, setAssignments] = useState<CompletedAssignment[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && staffId && selectedDate) {
      fetchCompletedAssignments();
    }
  }, [open, staffId, selectedDate]);

  const fetchCompletedAssignments = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('room_assignments')
        .select(`
          *,
          rooms!inner (
            room_number,
            hotel,
            room_name
          )
        `)
        .eq('assigned_to', staffId)
        .eq('assignment_date', selectedDate)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false });

      if (error) throw error;
      setAssignments((data as any) || []);
    } catch (error) {
      console.error('Error fetching completed assignments:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateDuration = (startTime: string | null, endTime: string) => {
    if (!startTime) return 'N/A';
    
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">
            Done Rooms - {staffName}
          </DialogTitle>
          <p className="text-muted-foreground">
            Completed assignments on {new Date(selectedDate).toLocaleDateString()}
          </p>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : assignments.length === 0 ? (
          <div className="text-center py-8">
            <CheckCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No completed rooms found for this date.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {assignments.map((assignment) => (
              <Card key={assignment.id} className="border">
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold text-lg">
                        Room {assignment.rooms?.room_number}
                      </h3>
                      <Badge 
                        variant={assignment.supervisor_approved ? "default" : "secondary"}
                        className={assignment.supervisor_approved ? "bg-green-100 text-green-800" : ""}
                      >
                        {assignment.supervisor_approved ? 'Approved' : 'Pending Approval'}
                      </Badge>
                      <Badge variant="outline">
                        {getAssignmentTypeLabel(assignment.assignment_type)}
                      </Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm text-muted-foreground">Hotel</p>
                        <p className="font-medium">{assignment.rooms?.hotel}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-blue-500" />
                      <div>
                        <p className="text-sm text-muted-foreground">Completed At</p>
                        <p className="font-medium">
                          {new Date(assignment.completed_at).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-green-500" />
                      <div>
                        <p className="text-sm text-muted-foreground">Duration</p>
                        <p className="font-medium">
                          {calculateDuration(assignment.started_at, assignment.completed_at)}
                        </p>
                      </div>
                    </div>
                  </div>

                  {assignment.notes && (
                    <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                      <p className="text-sm text-muted-foreground mb-1">Notes:</p>
                      <p className="text-sm">{assignment.notes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}