import React, { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { 
  Clock, 
  MapPin, 
  Play, 
  CheckCircle, 
  MessageSquare,
  AlertTriangle,
  BedDouble
} from 'lucide-react';
import { toast } from 'sonner';
import { RoomDetailDialog } from './RoomDetailDialog';
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
    };
  };
  onStatusUpdate: (assignmentId: string, newStatus: 'assigned' | 'in_progress' | 'completed' | 'cancelled') => void;
}

export function AssignedRoomCard({ assignment, onStatusUpdate }: AssignedRoomCardProps) {
  const { t, language } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [roomDetailOpen, setRoomDetailOpen] = useState(false);

  const updateAssignmentStatus = async (newStatus: 'assigned' | 'in_progress' | 'completed' | 'cancelled') => {
    setLoading(true);
    try {
      const updateData: any = { status: newStatus };
      
      // If starting work, track the start time
      if (newStatus === 'in_progress') {
        updateData.started_at = new Date().toISOString();
      }
      
      // If completing, also update the room status and tracking info
      if (newStatus === 'completed') {
        updateData.completed_at = new Date().toISOString();
        
        // Update the room status to clean
        const { error: roomError } = await supabase
          .from('rooms')
          .update({ 
            status: 'clean',
            last_cleaned_at: new Date().toISOString(),
            last_cleaned_by: (await supabase.auth.getUser()).data.user?.id,
            updated_at: new Date().toISOString()
          })
          .eq('id', assignment.room_id);

        if (roomError) {
          console.error('Error updating room status:', roomError);
        }
      }

      const { error } = await supabase
        .from('room_assignments')
        .update(updateData)
        .eq('id', assignment.id);

      if (error) throw error;
      
      onStatusUpdate(assignment.id, newStatus);
      toast.success(`Room ${assignment.rooms.room_number} marked as ${newStatus}${newStatus === 'completed' ? ' and status updated to clean' : ''}`);
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
        return 'bg-green-100 text-green-800 border-green-200';
      case 'in_progress':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'assigned':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getPriorityColor = (priority: number) => {
    switch (priority) {
      case 3:
        return 'bg-red-100 text-red-800';
      case 2:
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <Card className={`hover:shadow-md transition-all duration-200 ${assignment.status === 'completed' ? 'opacity-75' : ''}`}>
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-3">
            <CardTitle className="text-xl">Room {assignment.rooms.room_number}</CardTitle>
            <Badge className={getStatusColor(assignment.status)}>
              {assignment.status.replace('_', ' ')}
            </Badge>
            {assignment.priority > 1 && (
              <Badge variant="outline" className={getPriorityColor(assignment.priority)}>
                {assignment.priority === 3 ? t('housekeeping.priority.high') : t('housekeeping.priority.medium')}
              </Badge>
            )}
          </div>
          <Badge variant="outline">
            {getAssignmentTypeLabel(assignment.assignment_type)}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Room Details */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <span>{assignment.rooms.hotel}</span>
          </div>
          <div className="flex items-center gap-2">
            <BedDouble className="h-4 w-4 text-muted-foreground" />
            <span>Floor {assignment.rooms.floor_number}</span>
          </div>
          {assignment.rooms.room_name && (
            <div className="col-span-2">
              <span className="font-medium">{assignment.rooms.room_name}</span>
            </div>
          )}
          {assignment.estimated_duration && (
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span>{assignment.estimated_duration} min</span>
              {assignment.status === 'in_progress' && assignment.started_at && (
                <TimerComponent startedAt={assignment.started_at} />
              )}
            </div>
          )}
        </div>

        {/* Assignment Notes */}
        {assignment.notes && (
          <div className="p-3 bg-muted rounded-md">
            <p className="text-sm">
              {shouldTranslateContent(language) 
                ? translateText(assignment.notes, language)
                : assignment.notes
              }
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2">
          {assignment.status === 'assigned' && (
            <Button
              size="sm"
              onClick={() => updateAssignmentStatus('in_progress')}
              disabled={loading}
              className="flex items-center gap-2"
            >
              <Play className="h-4 w-4" />
              {t('housekeeping.start')}
            </Button>
          )}
          
          {assignment.status === 'in_progress' && (
            <Button
              size="sm"
              onClick={() => updateAssignmentStatus('completed')}
              disabled={loading}
              className="flex items-center gap-2"
            >
              <CheckCircle className="h-4 w-4" />
              {t('housekeeping.complete')}
            </Button>
          )}

          <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                {t('housekeeping.addNote')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('housekeeping.addNoteTitle')} {assignment.rooms.room_number}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <Textarea
                  placeholder={t('housekeeping.enterNote')}
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setNoteDialogOpen(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button onClick={addNote} disabled={!newNote.trim()}>
                    {t('housekeeping.addNote')}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Button 
            size="sm" 
            variant="outline"
            onClick={() => setRoomDetailOpen(true)}
          >
            {t('housekeeping.roomDetails')}
          </Button>
        </div>

        {/* Room Status Indicator */}
        {assignment.rooms.status !== 'clean' && (
          <div className="flex items-center gap-2 p-2 bg-yellow-50 border border-yellow-200 rounded-md">
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
            <span className="text-sm text-yellow-800">
              {t('housekeeping.roomStatus')} {assignment.rooms.status}
            </span>
          </div>
        )}
      </CardContent>

      {roomDetailOpen && (
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
    </Card>
  );
}