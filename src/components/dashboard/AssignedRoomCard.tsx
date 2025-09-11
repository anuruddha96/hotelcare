import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { 
  Clock, 
  MapPin, 
  Play, 
  CheckCircle, 
  MessageSquare,
  AlertTriangle,
  BedDouble,
  Shirt,
  Eye
} from 'lucide-react';
import { toast } from 'sonner';
import { RoomDetailDialog } from './RoomDetailDialog';
import { DNDPhotoDialog } from './DNDPhotoDialog';
import { DirtyLinenDialog } from './DirtyLinenDialog';
import { TimerComponent } from './TimerComponent';
import { useTranslation } from '@/hooks/useTranslation';
import { translateText, shouldTranslateContent } from '@/lib/translation-utils';

interface AssignedRoomCardProps {
  assignment: {
    id: string;
    room_id: string;
    assignment_type: 'daily_cleaning' | 'checkout_cleaning' | 'maintenance' | 'deep_cleaning';
    status: 'assigned' | 'in_progress' | 'completed' | 'cancelled';
    priority: number;
    estimated_duration: number;
    notes: string;
    started_at?: string | null;
    completed_at?: string | null;
    rooms: {
      room_number: string;
      hotel: string;
      status: string;
      room_name: string | null;
      floor_number: number | null;
    } | null;
  };
  onStatusUpdate: (assignmentId: string, newStatus: 'assigned' | 'in_progress' | 'completed' | 'cancelled') => void;
}

export function AssignedRoomCard({ assignment, onStatusUpdate }: AssignedRoomCardProps) {
  const { t, language } = useTranslation();
  const { user } = useAuth();
  const { toast: showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [roomDetailOpen, setRoomDetailOpen] = useState(false);
  const [dndPhotoDialogOpen, setDndPhotoDialogOpen] = useState(false);
  const [dirtyLinenDialogOpen, setDirtyLinenDialogOpen] = useState(false);
  const [attendanceStatus, setAttendanceStatus] = useState<string | null>(null);

  useEffect(() => {
    checkAttendanceStatus();
  }, [user]);

  const checkAttendanceStatus = async () => {
    if (!user?.id) return;
    
    const today = new Date().toISOString().split('T')[0];
    
    const { data, error } = await supabase
      .from('staff_attendance')
      .select('status')
      .eq('user_id', user.id)
      .eq('work_date', today)
      .single();
    
    if (!error && data) {
      setAttendanceStatus(data.status);
    } else {
      setAttendanceStatus(null);
    }
  };

  const markAsDND = async (photoUrl: string) => {
    setLoading(true);
    try {
      const now = new Date().toISOString();
      
      // Mark assignment as DND
      const { error: assignmentError } = await supabase
        .from('room_assignments')
        .update({ 
          status: 'completed',
          is_dnd: true,
          dnd_marked_at: now,
          dnd_marked_by: user?.id,
          completed_at: now
        })
        .eq('id', assignment.id);

      if (assignmentError) throw assignmentError;

      // Also mark the room as DND for display purposes
      const { error: roomError } = await supabase
        .from('rooms')
        .update({
          is_dnd: true,
          dnd_marked_at: now,
          dnd_marked_by: user?.id
        })
        .eq('id', assignment.room_id);

      if (roomError) throw roomError;
      
      onStatusUpdate(assignment.id, 'completed');
      const roomNum = assignment.rooms?.room_number ?? '—';
      toast.success(`Room ${roomNum} marked as DND with photo evidence`);
    } catch (error) {
      console.error('Error marking as DND:', error);
      toast.error('Failed to mark room as DND');
    } finally {
      setLoading(false);
      setDndPhotoDialogOpen(false);
    }
  };

  const updateAssignmentStatus = async (newStatus: 'assigned' | 'in_progress' | 'completed' | 'cancelled') => {
    // Check if user is on break before starting work
    if (newStatus === 'in_progress' && attendanceStatus === 'on_break') {
      showToast({
        title: "🌸 Take Your Time",
        description: "Please finish your break before starting work. Your well-being matters! 😌",
      });
      return;
    }

    // Check if user is checked in before starting work
    if (newStatus === 'in_progress' && (!attendanceStatus || attendanceStatus === 'checked_out')) {
      showToast({
        title: "Check-in Required",
        description: "Please check in first before starting your tasks",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    try {
      const updateData: any = { status: newStatus };
      
      // If starting work, track the start time
      if (newStatus === 'in_progress') {
        updateData.started_at = new Date().toISOString();
      }
      
      // If completing, set completed_at but don't update room status (requires supervisor approval)
      if (newStatus === 'completed') {
        updateData.completed_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('room_assignments')
        .update(updateData)
        .eq('id', assignment.id);

      if (error) throw error;
      
      onStatusUpdate(assignment.id, newStatus);
      const roomNum = assignment.rooms?.room_number ?? '—';
      const message = newStatus === 'completed' 
        ? `Room ${roomNum} completed and awaiting supervisor approval`
        : `Room ${roomNum} marked as ${newStatus}`;
      toast.success(message);
    } catch (error) {
      console.error('Error updating assignment status:', error);
      toast.error('Failed to update status');
    } finally {
      setLoading(false);
    }
  };

  const addNote = async () => {
    if (!newNote.trim()) return;

    try {
      const { error } = await supabase
        .from('housekeeping_notes')
        .insert({
          room_id: assignment.room_id,
          assignment_id: assignment.id,
          content: newNote,
          note_type: 'general',
          created_by: (await supabase.auth.getUser()).data.user?.id
        });

      if (error) throw error;
      
      setNewNote('');
      setNoteDialogOpen(false);
      toast.success('Note added successfully');
    } catch (error) {
      console.error('Error adding note:', error);
      toast.error('Failed to add note');
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-secondary text-secondary-foreground border-transparent';
      case 'in_progress':
        return 'bg-primary text-primary-foreground border-transparent';
      case 'assigned':
        return 'bg-accent text-accent-foreground border-transparent';
      default:
        return 'bg-muted text-foreground border-transparent';
    }
  };

  const getPriorityColor = (priority: number) => {
    switch (priority) {
      case 3:
        return 'bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20';
      case 2:
        return 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/20';
      default:
        return 'bg-muted text-foreground border-border hover:bg-muted/80';
    }
  };

  return (
    <Card className="group bg-card border border-border shadow-sm hover:shadow-md transition-all duration-200 rounded-xl w-full">
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-start">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <CardTitle className="text-xl sm:text-2xl font-bold text-foreground truncate">
              Room {assignment.rooms?.room_number || 'N/A'}
            </CardTitle>
            <Badge 
              className={`${getStatusColor(assignment.status)} font-semibold px-3 py-1 text-xs uppercase tracking-wide rounded-full shadow-sm flex-shrink-0`}
            >
              {assignment.status === 'in_progress' 
                ? t('housekeeping.inProgress')
                : assignment.status === 'completed'
                ? t('housekeeping.completed')
                : assignment.status === 'assigned'
                ? t('housekeeping.waiting')
                : assignment.status.replace('_', ' ')
              }
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {assignment.priority > 1 && (
              <Badge 
                variant="outline" 
                className={`${getPriorityColor(assignment.priority)} font-semibold px-3 py-1 text-xs border rounded-full shadow-sm flex-shrink-0`}
              >
                {assignment.priority === 3 ? t('housekeeping.priority.high') : t('housekeeping.priority.medium')}
              </Badge>
            )}
            <Badge 
              variant="outline" 
              className="bg-muted text-foreground border-border font-semibold px-3 py-1 text-xs rounded-full hover:bg-muted/80 transition-colors flex-shrink-0"
            >
              {getAssignmentTypeLabel(assignment.assignment_type)}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Room Details */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
            <MapPin className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">Hotel</p>
              <p className="text-lg font-semibold text-foreground">{assignment.rooms?.hotel || 'Unknown Hotel'}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
            <BedDouble className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">Floor</p>
              <p className="text-lg font-semibold text-foreground">
                {assignment.rooms?.floor_number !== undefined && assignment.rooms?.floor_number !== null 
                  ? `Floor ${assignment.rooms.floor_number}` 
                  : 'Floor info unavailable'
                }
              </p>
            </div>
          </div>
          {assignment.rooms?.room_name && (
            <div className="col-span-2 p-3 bg-muted/50 rounded-lg border border-border">
              <p className="text-sm font-medium text-muted-foreground">Room Name</p>
              <p className="text-lg font-semibold text-foreground">{assignment.rooms.room_name}</p>
            </div>
          )}
          {assignment.estimated_duration && (
            <div className="col-span-2 flex items-center justify-between p-3 bg-muted/50 rounded-lg border border-border">
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Estimated Time</p>
                  <p className="text-lg font-semibold text-foreground">{assignment.estimated_duration} minutes</p>
                </div>
              </div>
              {assignment.status === 'in_progress' && assignment.started_at && (
                <div className="bg-background px-3 py-2 rounded-md shadow-sm border border-border">
                  <TimerComponent startedAt={assignment.started_at} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Assignment Notes */}
        {assignment.notes && (
          <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
            <h4 className="font-semibold text-blue-800 mb-2">{t('housekeeping.assignmentNotes')}</h4>
            <p className="text-sm text-blue-700 leading-relaxed">
              {shouldTranslateContent(language) 
                ? translateText(assignment.notes, language)
                : assignment.notes
              }
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          {assignment.status === 'assigned' && (
            <Button
              size="lg"
              onClick={() => updateAssignmentStatus('in_progress')}
              disabled={loading}
              className="w-full sm:w-auto"
            >
              <Play className="h-5 w-5" />
              {t('housekeeping.start')}
            </Button>
          )}
          
          {assignment.status === 'in_progress' && (
            <div className="flex gap-3 w-full sm:w-auto">
              <Button
                size="lg"
                onClick={() => updateAssignmentStatus('completed')}
                disabled={loading}
                className="flex-1 sm:w-auto bg-green-600 hover:bg-green-700 text-white"
              >
                <CheckCircle className="h-5 w-5" />
                {t('housekeeping.complete')}
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => setDndPhotoDialogOpen(true)}
                disabled={loading}
                className="flex-1 sm:w-auto border-orange-300 text-orange-700 hover:bg-orange-50"
              >
                📷 DND
              </Button>
            </div>
          )}

          <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
            <DialogTrigger asChild>
              <Button 
                size="lg" 
                variant="outline" 
                className="w-full sm:w-auto"
              >
                <MessageSquare className="h-5 w-5" />
                {t('housekeeping.addNote')}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-xl font-bold text-slate-800">
                  {t('housekeeping.addNoteTitle')} {assignment.rooms?.room_number || 'N/A'}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <Textarea
                  placeholder={t('housekeeping.enterNote')}
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  className="min-h-[100px] border-2 border-slate-200 focus:border-blue-400 rounded-lg"
                />
                <div className="flex justify-end gap-3">
                  <Button 
                    variant="outline" 
                    onClick={() => setNoteDialogOpen(false)}
                    className="border-2 border-slate-300 text-slate-700 hover:bg-slate-50 px-6 py-2 rounded-lg font-semibold"
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button 
                    onClick={addNote} 
                    disabled={!newNote.trim()}
                    className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white px-6 py-2 rounded-lg font-semibold shadow-md hover:shadow-lg transition-all"
                  >
                    {t('housekeeping.addNote')}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {assignment.rooms && (
            <div className="flex gap-2">
              <Button 
                size="lg" 
                variant="outline"
                onClick={() => setRoomDetailOpen(true)}
                className="flex-1"
              >
                <Eye className="h-4 w-4 mr-2" />
                {t('housekeeping.roomDetails')}
              </Button>
              
              <Button 
                size="lg" 
                variant="outline"
                onClick={() => setDirtyLinenDialogOpen(true)}
                className="flex-1"
              >
                <Shirt className="h-4 w-4 mr-2" />
                Dirty Linen
              </Button>
            </div>
          )}
        </div>

        {/* Room Status Indicator */}
        {assignment.rooms?.status && assignment.rooms.status !== 'clean' && (
          <div className="flex items-center gap-3 p-4 bg-muted/50 border border-border rounded-lg shadow-sm">
            <AlertTriangle className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">Room Status Alert</p>
              <p className="text-lg font-semibold text-foreground capitalize">
                {t('housekeeping.roomStatus')} {assignment.rooms.status}
              </p>
            </div>
          </div>
        )}
      </CardContent>

      {roomDetailOpen && assignment.rooms && (
        <RoomDetailDialog
          room={{
            id: assignment.room_id,
            room_number: assignment.rooms.room_number,
            hotel: assignment.rooms.hotel,
            status: assignment.rooms.status,
            room_name: assignment.rooms.room_name,
            floor_number: assignment.rooms.floor_number
          }}
          open={roomDetailOpen}
          onOpenChange={setRoomDetailOpen}
        />
      )}

      {/* DND Photo Dialog */}
      <DNDPhotoDialog
        open={dndPhotoDialogOpen}
        onOpenChange={setDndPhotoDialogOpen}
        roomNumber={assignment.rooms?.room_number || 'N/A'}
        roomId={assignment.room_id}
        assignmentId={assignment.id}
        onPhotoUploaded={markAsDND}
      />

      {/* Dirty Linen Dialog */}
      <DirtyLinenDialog
        open={dirtyLinenDialogOpen}
        onOpenChange={setDirtyLinenDialogOpen}
        roomId={assignment.room_id}
        roomNumber={assignment.rooms?.room_number || 'Unknown'}
        assignmentId={assignment.id}
      />
    </Card>
  );
}