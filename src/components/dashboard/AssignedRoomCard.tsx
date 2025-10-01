import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  Eye,
  Edit3,
  ArrowUpDown,
  Camera
} from 'lucide-react';
import { toast } from 'sonner';
import { RoomDetailDialog } from './RoomDetailDialog';
import { DNDPhotoDialog } from './DNDPhotoDialog';
import { DirtyLinenDialog } from './DirtyLinenDialog';
import { PausableTimerComponent } from './PausableTimerComponent';
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
      guest_nights_stayed?: number;
      towel_change_required?: boolean;
      linen_change_required?: boolean;
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
  const [changeTypeDialogOpen, setChangeTypeDialogOpen] = useState(false);
  const [newAssignmentType, setNewAssignmentType] = useState(assignment.assignment_type);

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

  const markAsDND = async () => {
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

  const updateAssignmentType = async () => {
    try {
      const { data, error } = await supabase.rpc('update_assignment_type', {
        assignment_id: assignment.id,
        new_assignment_type: newAssignmentType
      });

      if (error) throw error;

      const result = data as { success: boolean; error?: string };
      if (result.success) {
        toast.success('Assignment type updated successfully');
        setChangeTypeDialogOpen(false);
        // Refresh the assignment data
        onStatusUpdate(assignment.id, assignment.status);
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (error) {
      console.error('Error updating assignment type:', error);
      toast.error('Failed to update assignment type');
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
            {/* Special Requirements Badges */}
            {assignment.rooms?.towel_change_required && (
              <Badge 
                variant="default" 
                className="bg-blue-100 text-blue-800 border-blue-200 font-semibold px-3 py-1 text-xs rounded-full shadow-sm flex-shrink-0"
              >
                🏺 Towel Change
              </Badge>
            )}
            {assignment.rooms?.linen_change_required && (
              <Badge 
                variant="default" 
                className="bg-purple-100 text-purple-800 border-purple-200 font-semibold px-3 py-1 text-xs rounded-full shadow-sm flex-shrink-0"
              >
                🛏️ Linen Change
              </Badge>
            )}
            {assignment.rooms?.guest_nights_stayed && assignment.rooms.guest_nights_stayed > 0 && (
              <Badge 
                variant="outline" 
                className="bg-muted text-foreground border-border font-semibold px-3 py-1 text-xs rounded-full flex-shrink-0"
              >
                🌙 Night {assignment.rooms.guest_nights_stayed}
              </Badge>
            )}
            
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
                  <PausableTimerComponent 
                    assignmentId={assignment.id}
                    startedAt={assignment.started_at} 
                    userId={user?.id || ''}
                  />
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
        <div className="space-y-4">
          {/* Primary Action Buttons */}
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
              <Button
                size="lg"
                onClick={() => updateAssignmentStatus('completed')}
                disabled={loading}
                className="w-full sm:w-auto bg-green-600 hover:bg-green-700 text-white"
              >
                <CheckCircle className="h-5 w-5" />
                {t('housekeeping.complete')}
              </Button>
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
                    className="min-h-[80px] border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                  />
                  <div className="flex gap-2">
                    <Button 
                      onClick={addNote} 
                      disabled={!newNote.trim()} 
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                    >
                      {t('housekeeping.addNote')}
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={() => setNoteDialogOpen(false)}
                      className="border-slate-300 text-slate-600 hover:bg-slate-50"
                    >
                      {t('common.cancel')}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <Button 
              size="lg"
              variant="outline" 
              onClick={() => setRoomDetailOpen(true)} 
              className="w-full sm:w-auto"
            >
              <Eye className="h-5 w-5" />
              {t('common.details')}
            </Button>
          </div>

          {/* Required Actions Section - Group DND Photo and Dirty Linen for In-Progress Tasks */}
          {assignment.status === 'in_progress' && (
            <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 rounded-lg border-2 border-dashed border-amber-200">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                <span className="font-semibold text-amber-800">Required Actions</span>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Daily Photo Button */}
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => setDndPhotoDialogOpen(true)}
                  className="flex items-center gap-3 h-12 border-amber-300 text-amber-700 hover:bg-amber-100"
                >
                  <Camera className="h-5 w-5" />
                  <span>Daily Photo</span>
                </Button>

                {/* Dirty Linen Button */}
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => setDirtyLinenDialogOpen(true)}
                  className="flex items-center gap-3 h-12 border-amber-300 text-amber-700 hover:bg-amber-100"
                >
                  <Shirt className="h-5 w-5" />
                  <span>Dirty Linen</span>
                </Button>
              </div>
            </div>
          )}

          {/* Management Action Buttons */}
          {assignment.rooms && (user?.role === 'manager' || user?.role === 'admin' || user?.role === 'housekeeping_manager') && (
            <div className="flex gap-2">
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => setChangeTypeDialogOpen(true)}
                className="flex-1 text-xs sm:text-sm min-h-[40px] border-blue-300 text-blue-700 hover:bg-blue-50"
              >
                <ArrowUpDown className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                <span className="hidden sm:inline">Change Type</span>
                <span className="sm:hidden">Type</span>
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

      {/* Change Assignment Type Dialog */}
      <Dialog open={changeTypeDialogOpen} onOpenChange={setChangeTypeDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">
              Change Assignment Type - Room {assignment.rooms?.room_number}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                Current Type: {getAssignmentTypeLabel(assignment.assignment_type)}
              </label>
            </div>
            <div>
              <label className="text-sm font-medium">New Assignment Type</label>
              <Select value={newAssignmentType} onValueChange={(value) => setNewAssignmentType(value as 'daily_cleaning' | 'checkout_cleaning' | 'maintenance' | 'deep_cleaning')}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select new type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily_cleaning">Daily Cleaning</SelectItem>
                  <SelectItem value="checkout_cleaning">Checkout Cleaning</SelectItem>
                  <SelectItem value="deep_cleaning">Deep Cleaning</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-3">
              <Button 
                variant="outline" 
                onClick={() => setChangeTypeDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button 
                onClick={updateAssignmentType}
                disabled={newAssignmentType === assignment.assignment_type}
              >
                Update Type
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}