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
    } | null;
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
      const roomNum = assignment.rooms?.room_number ?? '—';
      toast.success(`Room ${roomNum} marked as ${newStatus}${newStatus === 'completed' ? ' and status updated to clean' : ''}`);
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
        return 'bg-emerald-500 text-white border-emerald-600 shadow-sm';
      case 'in_progress':
        return 'bg-blue-500 text-white border-blue-600 shadow-sm';
      case 'assigned':
        return 'bg-amber-500 text-white border-amber-600 shadow-sm';
      default:
        return 'bg-slate-500 text-white border-slate-600 shadow-sm';
    }
  };

  const getPriorityColor = (priority: number) => {
    switch (priority) {
      case 3:
        return 'bg-red-50 text-red-700 border-red-300 hover:bg-red-100';
      case 2:
        return 'bg-yellow-50 text-yellow-700 border-yellow-300 hover:bg-yellow-100';
      default:
        return 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100';
    }
  };

  return (
    <Card className={`group hover:shadow-lg transition-all duration-300 border-0 bg-gradient-to-r ${assignment.status === 'completed' ? 'opacity-75 from-slate-50 to-slate-100' : 'from-white to-slate-50'} shadow-md`}>
      <CardHeader className="pb-4">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-3">
            <CardTitle className="text-2xl font-bold text-slate-800">
              Room {assignment.rooms?.room_number || 'N/A'}
            </CardTitle>
            <Badge 
              className={`${getStatusColor(assignment.status)} font-semibold px-4 py-2 text-sm uppercase tracking-wide rounded-full shadow-sm`}
            >
              {assignment.status === 'in_progress' ? 'In Progress' : assignment.status.replace('_', ' ')}
            </Badge>
            {assignment.priority > 1 && (
              <Badge 
                variant="outline" 
                className={`${getPriorityColor(assignment.priority)} font-semibold px-4 py-2 text-sm border-2 rounded-full shadow-sm`}
              >
                {assignment.priority === 3 ? t('housekeeping.priority.high') : t('housekeeping.priority.medium')}
              </Badge>
            )}
          </div>
          <Badge 
            variant="outline" 
            className="bg-indigo-50 text-indigo-700 border-indigo-200 font-semibold px-4 py-2 text-sm rounded-full hover:bg-indigo-100 transition-colors"
          >
            {getAssignmentTypeLabel(assignment.assignment_type)}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Room Details */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
            <MapPin className="h-5 w-5 text-slate-500" />
            <div>
              <p className="text-sm font-medium text-slate-600">Hotel</p>
              <p className="text-lg font-semibold text-slate-800">{assignment.rooms?.hotel || 'Unknown Hotel'}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
            <BedDouble className="h-5 w-5 text-slate-500" />
            <div>
              <p className="text-sm font-medium text-slate-600">Floor</p>
              <p className="text-lg font-semibold text-slate-800">
                {assignment.rooms?.floor_number !== undefined && assignment.rooms?.floor_number !== null 
                  ? `Floor ${assignment.rooms.floor_number}` 
                  : 'Floor info unavailable'
                }
              </p>
            </div>
          </div>
          {assignment.rooms?.room_name && (
            <div className="col-span-2 p-3 bg-blue-50 rounded-lg border border-blue-200">
              <p className="text-sm font-medium text-blue-600">Room Name</p>
              <p className="text-lg font-semibold text-blue-800">{assignment.rooms.room_name}</p>
            </div>
          )}
          {assignment.estimated_duration && (
            <div className="col-span-2 flex items-center justify-between p-3 bg-amber-50 rounded-lg border border-amber-200">
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-amber-600" />
                <div>
                  <p className="text-sm font-medium text-amber-600">Estimated Time</p>
                  <p className="text-lg font-semibold text-amber-800">{assignment.estimated_duration} minutes</p>
                </div>
              </div>
              {assignment.status === 'in_progress' && assignment.started_at && (
                <div className="bg-white px-3 py-2 rounded-md shadow-sm border border-amber-300">
                  <TimerComponent startedAt={assignment.started_at} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Assignment Notes */}
        {assignment.notes && (
          <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
            <h4 className="font-semibold text-blue-800 mb-2">Assignment Notes</h4>
            <p className="text-sm text-blue-700 leading-relaxed">
              {shouldTranslateContent(language) 
                ? translateText(assignment.notes, language)
                : assignment.notes
              }
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3">
          {assignment.status === 'assigned' && (
            <Button
              size="lg"
              onClick={() => updateAssignmentStatus('in_progress')}
              disabled={loading}
              className="flex items-center gap-3 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-semibold px-6 py-3 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105"
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
              className="flex items-center gap-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-semibold px-6 py-3 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105"
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
                className="flex items-center gap-3 border-2 border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 font-semibold px-6 py-3 rounded-xl shadow-md hover:shadow-lg transition-all duration-200"
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
            <Button 
              size="lg" 
              variant="outline"
              onClick={() => setRoomDetailOpen(true)}
              className="flex items-center gap-3 border-2 border-indigo-300 text-indigo-700 hover:bg-indigo-50 hover:border-indigo-400 font-semibold px-6 py-3 rounded-xl shadow-md hover:shadow-lg transition-all duration-200"
            >
              {t('housekeeping.roomDetails')}
            </Button>
          )}
        </div>

        {/* Room Status Indicator */}
        {assignment.rooms?.status && assignment.rooms.status !== 'clean' && (
          <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-yellow-50 to-amber-50 border-2 border-yellow-200 rounded-lg shadow-sm">
            <AlertTriangle className="h-5 w-5 text-yellow-600" />
            <div>
              <p className="text-sm font-medium text-yellow-600">Room Status Alert</p>
              <p className="text-lg font-semibold text-yellow-800 capitalize">
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
    </Card>
  );
}