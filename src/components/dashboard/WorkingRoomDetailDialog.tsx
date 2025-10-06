import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from '@/hooks/useTranslation';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock, MapPin, User, CheckCircle, AlertCircle } from 'lucide-react';
import { format, differenceInMinutes } from 'date-fns';
import { toast } from 'sonner';

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
  const [assignment, setAssignment] = useState<WorkingAssignment | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && staffId) {
      fetchWorkingAssignment();
    }
  }, [open, staffId, selectedDate]);

  const fetchWorkingAssignment = async () => {
    setLoading(true);
    try {
      // Changed from .single() to get all in-progress rooms and take the first one
      // This fixes the issue where multiple working rooms caused .single() to fail
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
        .order('started_at', { ascending: false }) // Most recently started first
        .limit(1);

      if (error) throw error;

      // Get the first (most recent) working room
      if (data && data.length > 0) {
        const firstRoom = data[0];
        setAssignment({
          id: firstRoom.id,
          room_number: firstRoom.rooms.room_number,
          hotel: firstRoom.rooms.hotel,
          assignment_type: firstRoom.assignment_type,
          started_at: firstRoom.started_at,
          estimated_duration: firstRoom.estimated_duration,
          ready_to_clean: firstRoom.ready_to_clean,
          status: firstRoom.status,
          room_status: firstRoom.rooms.status,
          is_checkout_room: firstRoom.rooms.is_checkout_room,
        });
      } else {
        setAssignment(null);
      }
    } catch (error) {
      console.error('Error fetching working assignment:', error);
      toast.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  const markAsReadyToClean = async () => {
    if (!assignment) return;

    try {
      const { error } = await supabase
        .from('room_assignments')
        .update({ ready_to_clean: true })
        .eq('id', assignment.id);

      if (error) throw error;

      setAssignment(prev => prev ? { ...prev, ready_to_clean: true } : null);
      toast.success(t('manager.roomMarkedReady'));
    } catch (error) {
      console.error('Error marking room as ready:', error);
      toast.error(t('common.error'));
    }
  };

  const getElapsedTime = () => {
    if (!assignment?.started_at) return '0 min';
    const elapsed = differenceInMinutes(new Date(), new Date(assignment.started_at));
    const hours = Math.floor(elapsed / 60);
    const minutes = elapsed % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  const getProgressStatus = () => {
    if (!assignment?.started_at || !assignment.estimated_duration) return 'on_track';
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {t('manager.workingRoomDetails')}
          </DialogTitle>
        </DialogHeader>

        {assignment ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg">{staffName}</h3>
              <Badge variant={getProgressStatus() === 'overdue' ? 'destructive' : getProgressStatus() === 'at_risk' ? 'secondary' : 'default'}>
                {getProgressStatus() === 'overdue' ? t('manager.overdue') : 
                 getProgressStatus() === 'at_risk' ? t('manager.atRisk') : 
                 t('manager.onTrack')}
              </Badge>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Room {assignment.room_number}</span>
                <span className="text-muted-foreground">• {assignment.hotel}</span>
              </div>

              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span>{t('manager.timeElapsed')}: <strong>{getElapsedTime()}</strong></span>
                {assignment.estimated_duration && (
                  <span className="text-muted-foreground">
                    / {assignment.estimated_duration}min
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Badge variant="outline">
                  {assignment.assignment_type === 'checkout_cleaning' ? t('assignment.checkoutRoom') : t('assignment.dailyCleaningRoom')}
                </Badge>
                {assignment.is_checkout_room && (
                  <Badge variant={assignment.ready_to_clean ? 'default' : 'secondary'}>
                    {assignment.ready_to_clean ? t('manager.readyToClean') : t('manager.waitingCheckout')}
                  </Badge>
                )}
              </div>

              {assignment.started_at && (
                <div className="text-sm text-muted-foreground">
                  {t('manager.startedAt')}: {format(new Date(assignment.started_at), 'HH:mm')}
                </div>
              )}
            </div>

            {assignment.is_checkout_room && !assignment.ready_to_clean && (
              <div className="border-t pt-4">
                <div className="flex items-start gap-2 p-3 bg-orange-50 rounded-lg border border-orange-200">
                  <AlertCircle className="h-4 w-4 text-orange-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-orange-800 font-medium">
                      {t('manager.waitingGuestCheckout')}
                    </p>
                    <p className="text-xs text-orange-700 mt-1">
                      {t('manager.markReadyWhenGuestLeaves')}
                    </p>
                  </div>
                </div>
                <Button 
                  onClick={markAsReadyToClean}
                  className="w-full mt-3"
                  variant="outline"
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  {t('manager.markReadyToClean')}
                </Button>
              </div>
            )}

            {assignment.ready_to_clean && assignment.is_checkout_room && (
              <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg border border-green-200">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span className="text-sm text-green-800 font-medium">
                  {t('manager.roomReadyForCleaning')}
                </span>
              </div>
            )}
          </div>
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