import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from '@/hooks/useTranslation';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock, MapPin, User, CheckCircle, AlertCircle } from 'lucide-react';
import { format, differenceInMinutes } from 'date-fns';
import { toast } from 'sonner';
import { ScrollArea } from '@/components/ui/scroll-area';

interface WorkingRoomDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staffId: string;
  staffName: string;
  selectedDate: string;
}

interface WorkingAssignment {
  id: string;
  room_number: string;
  hotel: string;
  assignment_type: string;
  started_at: string;
  estimated_duration: number;
  ready_to_clean: boolean;
  status: string;
  room_status: string;
  is_checkout_room: boolean;
}

export function WorkingRoomDetailDialog({
  open,
  onOpenChange,
  staffId,
  staffName,
  selectedDate,
}: WorkingRoomDetailDialogProps) {
  const { t } = useTranslation();
  const [assignments, setAssignments] = useState<WorkingAssignment[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && staffId) {
      fetchWorkingAssignments();
    }
  }, [open, staffId, selectedDate]);

  const fetchWorkingAssignments = async () => {
    setLoading(true);
    try {
      // Fetch ALL in-progress rooms for this staff member
      const { data, error } = await supabase
        .from('room_assignments')
        .select(`
          id,
          started_at,
          estimated_duration,
          ready_to_clean,
          status,
          assignment_type,
          rooms!inner(
            room_number,
            hotel,
            status,
            is_checkout_room
          )
        `)
        .eq('assigned_to', staffId)
        .eq('assignment_date', selectedDate)
        .eq('status', 'in_progress')
        .order('started_at', { ascending: false }); // Most recently started first

      if (error) throw error;

      // Map all working rooms
      const workingRooms = (data || []).map((item: any) => ({
        id: item.id,
        room_number: item.rooms.room_number,
        hotel: item.rooms.hotel,
        assignment_type: item.assignment_type,
        started_at: item.started_at,
        estimated_duration: item.estimated_duration,
        ready_to_clean: item.ready_to_clean,
        status: item.status,
        room_status: item.rooms.status,
        is_checkout_room: item.rooms.is_checkout_room,
      }));

      setAssignments(workingRooms);
    } catch (error) {
      console.error('Error fetching working assignments:', error);
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

      // Update local state
      setAssignments(prev => 
        prev.map(a => a.id === assignmentId ? { ...a, ready_to_clean: true } : a)
      );
      toast.success(t('manager.roomMarkedReady'));
    } catch (error) {
      console.error('Error marking room as ready:', error);
      toast.error(t('common.error'));
    }
  };

  const getElapsedTime = (startedAt: string) => {
    const elapsed = differenceInMinutes(new Date(), new Date(startedAt));
    const hours = Math.floor(elapsed / 60);
    const minutes = elapsed % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  const getProgressStatus = (assignment: WorkingAssignment) => {
    if (!assignment.started_at || !assignment.estimated_duration) return 'on_track';
    const elapsed = differenceInMinutes(new Date(), new Date(assignment.started_at));
    const progress = (elapsed / assignment.estimated_duration) * 100;
    
    if (progress > 120) return 'overdue';
    if (progress > 100) return 'at_risk';
    return 'on_track';
  };

  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <div className="flex items-center justify-center p-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {t('manager.workingRoomDetails')}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {staffName} - {assignments.length} {assignments.length === 1 ? 'room' : 'rooms'} in progress
          </p>
        </DialogHeader>

        {assignments.length > 0 ? (
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-4 pr-4">
              {assignments.map((assignment) => (
                <div key={assignment.id} className="border rounded-lg p-4 space-y-3 bg-card">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <h3 className="font-semibold text-lg">Room {assignment.room_number}</h3>
                      <span className="text-sm text-muted-foreground">• {assignment.hotel}</span>
                    </div>
                    <Badge variant={
                      getProgressStatus(assignment) === 'overdue' ? 'destructive' : 
                      getProgressStatus(assignment) === 'at_risk' ? 'secondary' : 
                      'default'
                    }>
                      {getProgressStatus(assignment) === 'overdue' ? t('manager.overdue') : 
                       getProgressStatus(assignment) === 'at_risk' ? t('manager.atRisk') : 
                       t('manager.onTrack')}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-muted-foreground text-xs">{t('manager.timeElapsed')}</p>
                        <p className="font-medium">{getElapsedTime(assignment.started_at)}</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">{t('manager.startedAt')}</p>
                      <p className="font-medium">{format(new Date(assignment.started_at), 'HH:mm')}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">
                      {assignment.assignment_type === 'checkout_cleaning' ? 
                        t('assignment.checkoutRoom') : 
                        t('assignment.dailyCleaning')}
                    </Badge>
                    {assignment.estimated_duration && (
                      <Badge variant="secondary">
                        Est: {assignment.estimated_duration}min
                      </Badge>
                    )}
                  </div>

                  {assignment.assignment_type === 'checkout_cleaning' && !assignment.ready_to_clean && (
                    <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-yellow-900">
                            {t('manager.waitingGuestCheckout')}
                          </p>
                          <p className="text-xs text-yellow-700 mt-1">
                            {t('manager.markReadyWhenGuestLeaves')}
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2 border-yellow-300 hover:bg-yellow-100"
                            onClick={() => markAsReadyToClean(assignment.id)}
                          >
                            <CheckCircle className="h-4 w-4 mr-2" />
                            {t('manager.markReady')}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {assignment.assignment_type === 'checkout_cleaning' && assignment.ready_to_clean && (
                    <div className="rounded-lg border border-green-200 bg-green-50 p-3 flex items-center gap-2">
                      <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
                      <span className="text-sm text-green-800 font-medium">
                        {t('manager.roomReadyForCleaning')}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <div className="text-center py-8">
            <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">{t('manager.noActiveWork')}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {staffName} {t('manager.notCurrentlyWorking')}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
