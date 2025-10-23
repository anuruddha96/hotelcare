import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from '@/hooks/useTranslation';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Clock, MapPin, CheckCircle, AlertCircle, Calendar, Star, X, ArrowLeftRight } from 'lucide-react';
import { toast } from 'sonner';

interface PendingRoomsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staffId: string;
  staffName: string;
  selectedDate: string;
}

interface PendingAssignment {
  id: string;
  room_number: string;
  hotel: string;
  assignment_type: string;
  estimated_duration: number;
  ready_to_clean: boolean;
  is_checkout_room: boolean;
  priority: number;
  notes?: string;
}

export function PendingRoomsDialog({
  open,
  onOpenChange,
  staffId,
  staffName,
  selectedDate,
}: PendingRoomsDialogProps) {
  const { t } = useTranslation();
  const [assignments, setAssignments] = useState<PendingAssignment[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && staffId) {
      fetchPendingAssignments();
    }
  }, [open, staffId, selectedDate]);

  const fetchPendingAssignments = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('room_assignments')
        .select(`
          id,
          estimated_duration,
          ready_to_clean,
          assignment_type,
          priority,
          notes,
          rooms!inner(
            room_number,
            hotel,
            is_checkout_room
          )
        `)
        .eq('assigned_to', staffId)
        .eq('assignment_date', selectedDate)
        .eq('status', 'assigned')
        .order('priority', { ascending: false })
        .order('ready_to_clean', { ascending: false });

      if (error) throw error;

      const pendingAssignments = (data || []).map((item: any) => ({
        id: item.id,
        room_number: item.rooms.room_number,
        hotel: item.rooms.hotel,
        assignment_type: item.assignment_type,
        estimated_duration: item.estimated_duration,
        ready_to_clean: item.ready_to_clean,
        is_checkout_room: item.rooms.is_checkout_room,
        priority: item.priority,
        notes: item.notes,
      }));

      // Sort assignments by room number numerically
      const sortedAssignments = pendingAssignments.sort((a, b) => {
        const roomA = parseInt(a.room_number) || 0;
        const roomB = parseInt(b.room_number) || 0;
        return roomA - roomB;
      });
      
      setAssignments(sortedAssignments);
    } catch (error) {
      console.error('Error fetching pending assignments:', error);
      toast.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  const markAsReadyToClean = async (assignmentId: string) => {
    try {
      const { error } = await supabase
        .from('room_assignments')
        .update({ ready_to_clean: true })
        .eq('id', assignmentId);

      if (error) throw error;

      setAssignments(prev => 
        prev.map(assignment => 
          assignment.id === assignmentId 
            ? { ...assignment, ready_to_clean: true }
            : assignment
        )
      );
      toast.success(t('manager.roomMarkedReady'));
    } catch (error) {
      console.error('Error marking room as ready:', error);
      toast.error(t('common.error'));
    }
  };

  const unassignRoom = async (assignmentId: string, roomNumber: string) => {
    try {
      const { error } = await supabase
        .from('room_assignments')
        .delete()
        .eq('id', assignmentId);

      if (error) throw error;

      setAssignments(prev => prev.filter(a => a.id !== assignmentId));
      toast.success(`Room ${roomNumber} unassigned`);
    } catch (error) {
      console.error('Error unassigning room:', error);
      toast.error(t('common.error'));
    }
  };

  const updatePriority = async (assignmentId: string, newPriority: number) => {
    try {
      const { error } = await supabase
        .from('room_assignments')
        .update({ priority: newPriority })
        .eq('id', assignmentId);

      if (error) throw error;

      setAssignments(prev => 
        prev.map(assignment => 
          assignment.id === assignmentId 
            ? { ...assignment, priority: newPriority }
            : assignment
        )
      );
      
      const priorityLabel = newPriority >= 3 ? 'High' : newPriority === 2 ? 'Medium' : 'Low';
      toast.success(`Priority set to ${priorityLabel}`);
    } catch (error) {
      console.error('Error updating priority:', error);
      toast.error(t('common.error'));
    }
  };

  const changeAssignmentType = async (assignmentId: string, roomNumber: string, newType: 'checkout_cleaning' | 'daily_cleaning') => {
    try {
      const { error } = await supabase
        .from('room_assignments')
        .update({ assignment_type: newType })
        .eq('id', assignmentId);

      if (error) throw error;

      setAssignments(prev => 
        prev.map(assignment => 
          assignment.id === assignmentId 
            ? { ...assignment, assignment_type: newType }
            : assignment
        )
      );
      
      const typeLabel = newType === 'checkout_cleaning' ? 'Checkout Cleaning' : 'Daily Cleaning';
      toast.success(`Room ${roomNumber} changed to ${typeLabel}`);
    } catch (error) {
      console.error('Error changing assignment type:', error);
      toast.error(t('common.error'));
    }
  };

  const getPriorityColor = (priority: number) => {
    if (priority >= 3) return 'destructive';
    if (priority === 2) return 'secondary';
    return 'outline';
  };

  const getPriorityLabel = (priority: number) => {
    if (priority >= 3) return t('priority.high');
    if (priority === 2) return t('priority.medium');
    return t('priority.low');
  };

  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <div className="flex items-center justify-center p-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            {t('manager.pendingRooms')} - {staffName}
          </DialogTitle>
        </DialogHeader>

        {assignments.length > 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {assignments.length} {t('manager.roomsPending')}
            </p>
            
            {assignments.map((assignment) => (
              <div
                key={assignment.id}
                className="border rounded-lg p-4 space-y-3 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">Room {assignment.room_number}</span>
                    <span className="text-muted-foreground">• {assignment.hotel}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={getPriorityColor(assignment.priority)}>
                      {getPriorityLabel(assignment.priority)}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => unassignRoom(assignment.id, assignment.room_number)}
                      className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    <span>{assignment.estimated_duration || 30}min</span>
                  </div>
                  <Badge variant="outline">
                    {assignment.assignment_type === 'checkout_cleaning' ? 
                      t('assignment.checkoutRoom') : 
                      t('assignment.dailyCleaningRoom')}
                  </Badge>
                </div>

                {assignment.is_checkout_room && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {assignment.ready_to_clean ? (
                        <div className="flex items-center gap-2 text-green-600">
                          <CheckCircle className="h-4 w-4" />
                          <span className="text-sm font-medium">{t('manager.readyToClean')}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-orange-600">
                          <AlertCircle className="h-4 w-4" />
                          <span className="text-sm font-medium">{t('manager.waitingCheckout')}</span>
                        </div>
                      )}
                    </div>
                    
                    {!assignment.ready_to_clean && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => markAsReadyToClean(assignment.id)}
                      >
                        <CheckCircle className="h-3 w-3 mr-1" />
                        {t('manager.markReady')}
                      </Button>
                    )}
                  </div>
                )}

                {assignment.notes && (
                  <div className="text-sm text-muted-foreground bg-gray-100 p-2 rounded">
                    <strong>{t('assignment.notes')}:</strong> {assignment.notes}
                  </div>
                )}

                {/* Priority Controls */}
                <div className="flex items-center gap-2 pt-2 border-t">
                  <Star className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground font-medium">Set Priority:</span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant={assignment.priority === 1 ? "default" : "outline"}
                      onClick={() => updatePriority(assignment.id, 1)}
                      className={`h-7 text-xs ${assignment.priority === 1 ? 'bg-gray-500' : ''}`}
                    >
                      Low
                    </Button>
                    <Button
                      size="sm"
                      variant={assignment.priority === 2 ? "default" : "outline"}
                      onClick={() => updatePriority(assignment.id, 2)}
                      className={`h-7 text-xs ${assignment.priority === 2 ? 'bg-blue-500' : ''}`}
                    >
                      Medium
                    </Button>
                    <Button
                      size="sm"
                      variant={assignment.priority === 3 ? "default" : "outline"}
                      onClick={() => updatePriority(assignment.id, 3)}
                      className={`h-7 text-xs ${assignment.priority === 3 ? 'bg-red-500' : ''}`}
                    >
                      High
                    </Button>
                  </div>
                </div>

                {/* Change Assignment Type */}
                <div className="flex items-center gap-2 pt-2 border-t">
                  <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground font-medium">Change Type:</span>
                  <Select
                    value={assignment.assignment_type}
                    onValueChange={(value) => changeAssignmentType(assignment.id, assignment.room_number, value as 'checkout_cleaning' | 'daily_cleaning')}
                  >
                    <SelectTrigger className="h-7 text-xs w-[160px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="checkout_cleaning">Checkout Cleaning</SelectItem>
                      <SelectItem value="daily_cleaning">Daily Cleaning</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">{t('manager.noPendingRooms')}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {staffName} {t('manager.hasNoWaitingTasks')}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}