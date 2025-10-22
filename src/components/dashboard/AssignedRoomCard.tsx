import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { HoldButton } from '@/components/ui/hold-button';
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
  Camera,
  Package,
  Info
} from 'lucide-react';
import { ImageCaptureDialog } from './ImageCaptureDialog';
import { SimplifiedPhotoCapture } from './SimplifiedPhotoCapture';
import { toast } from 'sonner';
import { RoomDetailDialog } from './RoomDetailDialog';
import { DNDPhotoDialog } from './DNDPhotoDialog';
import { EnhancedDNDPhotoCapture } from './EnhancedDNDPhotoCapture';

import { DirtyLinenDialog } from './DirtyLinenDialog';
import { MaintenanceIssueDialog } from './MaintenanceIssueDialog';
import { LostAndFoundDialog } from './LostAndFoundDialog';
import { PausableTimerComponent } from './PausableTimerComponent';
import { RoomAssignmentChangeDialog } from './RoomAssignmentChangeDialog';
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
    completion_photos?: string[] | null;
    is_dnd?: boolean;
    dnd_marked_at?: string | null;
    dnd_marked_by?: string | null;
    supervisor_approved?: boolean;
    supervisor_approved_by?: string | null;
    supervisor_approved_at?: string | null;
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
  const { user, profile } = useAuth();
  const { toast: showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [roomDetailOpen, setRoomDetailOpen] = useState(false);
  const [dndPhotoDialogOpen, setDndPhotoDialogOpen] = useState(false);
  const [enhancedDndPhotoDialogOpen, setEnhancedDndPhotoDialogOpen] = useState(false);
  const [dailyPhotoDialogOpen, setDailyPhotoDialogOpen] = useState(false);
  const [dirtyLinenDialogOpen, setDirtyLinenDialogOpen] = useState(false);
  const [attendanceStatus, setAttendanceStatus] = useState<string | null>(null);
  const [isManualCheckIn, setIsManualCheckIn] = useState(false);
  const [changeTypeDialogOpen, setChangeTypeDialogOpen] = useState(false);
  const [maintenanceDialogOpen, setMaintenanceDialogOpen] = useState(false);
  const [lostFoundDialogOpen, setLostFoundDialogOpen] = useState(false);
  const [currentPhotos, setCurrentPhotos] = useState<string[]>(assignment.completion_photos || []);
  const [isRetrievingDND, setIsRetrievingDND] = useState(false);

  useEffect(() => {
    checkAttendanceStatus();
    
    // Set up realtime subscription for attendance changes
    if (!user?.id) return;
    
    const channel = supabase
      .channel('attendance-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'staff_attendance',
          filter: `user_id=eq.${user.id}`
        },
        () => {
          // Refresh attendance status when it changes
          checkAttendanceStatus();
        }
      )
      .subscribe();
    
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Update current photos when assignment changes
  useEffect(() => {
    setCurrentPhotos(assignment.completion_photos || []);
  }, [assignment.completion_photos]);

  const checkAttendanceStatus = async () => {
    if (!user?.id) {
      console.log('❌ No user ID found');
      return;
    }
    
    const today = new Date().toISOString().split('T')[0];
    console.log('🔍 Checking attendance for:', { userId: user.id, date: today });
    
    const { data, error } = await supabase
      .from('staff_attendance')
      .select('id, status, notes, created_at, check_in_time')
      .eq('user_id', user.id)
      .eq('work_date', today)
      .order('created_at', { ascending: false });
    
    console.log('📊 Attendance records found:', data?.length || 0);
    console.log('📋 All records:', JSON.stringify(data, null, 2));
    
    if (error) {
      console.error('❌ Error fetching attendance:', error);
    }
    
    // Get the most recent record
    const latestRecord = data && data.length > 0 ? data[0] : null;
    
    console.log('✅ Latest record:', latestRecord);
    
    if (latestRecord) {
      const isManual = latestRecord.notes === 'Manually checked in by admin';
      console.log('📝 Setting attendance status:', {
        status: latestRecord.status,
        isManualCheckIn: isManual,
        notes: latestRecord.notes
      });
      
      setAttendanceStatus(latestRecord.status);
      setIsManualCheckIn(isManual);
    } else {
      console.log('⚠️ No attendance record found - setting to null');
      setAttendanceStatus(null);
      setIsManualCheckIn(false);
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

  const updateAssignmentStatus = async (newStatus: 'assigned' | 'in_progress' | 'completed' | 'cancelled') => {
    // Check for room photos on daily cleaning completion
    if (newStatus === 'completed' && assignment.assignment_type === 'daily_cleaning') {
      const { data: assignmentData } = await supabase
        .from('room_assignments')
        .select('completion_photos')
        .eq('id', assignment.id)
        .single();
      
      if (!assignmentData?.completion_photos || assignmentData.completion_photos.length === 0) {
        toast.error(t('actions.photosRequired'), {
          description: t('actions.photosRequiredMessage'),
          duration: 6000
        });
        setDailyPhotoDialogOpen(true);
        return;
      }
    }

    // CRITICAL: Fetch fresh attendance data before checking
    let freshAttendanceStatus: string | null = null;
    let freshIsManualCheckIn = false;
    
    if (newStatus === 'in_progress' && user?.id) {
      const today = new Date().toISOString().split('T')[0];
      console.log('🔄 Fetching FRESH attendance data...');
      console.log('   User ID:', user.id);
      console.log('   Date:', today);
      console.log('   Auth UID:', (await supabase.auth.getUser()).data.user?.id);
      
      const { data: attendanceRecords, error: attError } = await supabase
        .from('staff_attendance')
        .select('id, status, notes, created_at, check_in_time')
        .eq('user_id', user.id)
        .eq('work_date', today)
        .order('created_at', { ascending: false });
      
      console.log('📊 Query result:');
      console.log('   Error:', attError);
      console.log('   Records count:', attendanceRecords?.length || 0);
      console.log('   All records:', JSON.stringify(attendanceRecords, null, 2));
      
      const latestRecord = attendanceRecords && attendanceRecords.length > 0 ? attendanceRecords[0] : null;
      
      if (latestRecord) {
        freshAttendanceStatus = latestRecord.status;
        freshIsManualCheckIn = latestRecord.notes === 'Manually checked in by admin';
        console.log('✅ Latest record details:');
        console.log('   ID:', latestRecord.id);
        console.log('   Status:', latestRecord.status);
        console.log('   Notes:', latestRecord.notes);
        console.log('   Is Manual:', freshIsManualCheckIn);
        console.log('   Created at:', latestRecord.created_at);
      } else {
        console.log('⚠️ No attendance records found');
      }
    }

    // Skip attendance checks if user was manually checked in by admin
    console.log('🔐 Attendance check:', {
      newStatus,
      freshIsManualCheckIn,
      freshAttendanceStatus,
      willSkipChecks: freshIsManualCheckIn
    });
    
    if (!freshIsManualCheckIn && newStatus === 'in_progress') {
      // Check if user is on break before starting work
      if (freshAttendanceStatus === 'on_break') {
        console.log('⏸️ User is on break - blocking start');
        showToast({
          title: "🌸 Take Your Time",
          description: "Please finish your break before starting work. Your well-being matters! 😌",
        });
        return;
      }

      // Check if user is checked in before starting work
      if (!freshAttendanceStatus || freshAttendanceStatus === 'checked_out') {
        console.log('❌ User not checked in - blocking start', { freshAttendanceStatus });
        showToast({
          title: t('attendance.notCheckedIn'),
          description: t('attendance.checkInRequired'),
          variant: "destructive",
          action: (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // Redirect to attendance tab
                const attendanceTab = document.querySelector('[data-value="attendance"]') as HTMLElement;
                if (attendanceTab) {
                  attendanceTab.click();
                }
              }}
            >
              {t('attendance.goToCheckIn')}
            </Button>
          )
        });
        return;
      }
    } else if (freshIsManualCheckIn) {
      console.log('✅ Skipping attendance checks - manual check-in detected');
    }

    // Check if user already has a room in progress (only for housekeepers)
    // Managers, admins, and super admins can start multiple rooms
    if (newStatus === 'in_progress') {
      const isHousekeeper = profile?.role === 'housekeeping';
      
      if (isHousekeeper) {
        const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
        const { data: activeAssignments, error: checkError } = await supabase
          .from('room_assignments')
          .select('id, rooms(room_number)')
          .eq('assigned_to', user?.id)
          .eq('status', 'in_progress')
          .eq('assignment_date', today)
          .neq('id', assignment.id);

        if (checkError) {
          console.error('Error checking active assignments:', checkError);
        } else if (activeAssignments && activeAssignments.length > 0) {
          const activeRoomNumber = (activeAssignments[0] as any).rooms?.room_number || 'another room';
          showToast({
            title: "Already Working on a Room",
            description: `Please complete ${activeRoomNumber} before starting work on this room. You can only work on one room at a time.`,
            variant: "destructive"
          });
          return;
        }
      }
    }

    // Photo validation is now done in handleCompleteClick, so this is redundant here
    // but kept as a safety check in case updateAssignmentStatus is called directly

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

  const handleRetrieveDNDRoom = async () => {
    if (!user) return;
    
    setIsRetrievingDND(true);
    try {
      const roomNum = assignment.rooms?.room_number || 'N/A';
      const wasApproved = assignment.supervisor_approved;
      
      // Check if room is actually DND
      const { data: roomData } = await supabase
        .from('rooms')
        .select('is_dnd')
        .eq('id', assignment.room_id)
        .single();
        
      if (!roomData?.is_dnd) {
        toast.error('This room is not marked as DND');
        return;
      }

      // Clear DND status from room and set to dirty
      const { error: roomError } = await supabase
        .from('rooms')
        .update({
          is_dnd: false,
          dnd_marked_at: null,
          dnd_marked_by: null,
          status: 'dirty'
        })
        .eq('id', assignment.room_id);

      if (roomError) throw roomError;

      // Update assignment status back to 'assigned' and clear DND flags + supervisor approval
      const updateData: any = {
        status: 'assigned',
        is_dnd: false,
        dnd_marked_at: null,
        dnd_marked_by: null,
        completed_at: null,
        supervisor_approved: false,
        supervisor_approved_by: null,
        supervisor_approved_at: null,
        notes: wasApproved 
          ? `${assignment.notes || ''}\n\n[${new Date().toLocaleString()}] ${t('dnd.previouslyApprovedDesc')}`
          : assignment.notes
      };

      const { error: assignmentError } = await supabase
        .from('room_assignments')
        .update(updateData)
        .eq('id', assignment.id);

      if (assignmentError) throw assignmentError;

      // If it was previously approved, send notification to managers
      if (wasApproved) {
        toast.info(t('dnd.retrievedNotifyManager'), {
          description: `${t('common.room')} ${roomNum}`,
          duration: 5000
        });
      }

      // Notify success
      toast.success(t('dnd.retrievedSuccess'), {
        description: `${t('common.room')} ${roomNum}`
      });

      // Update local state
      onStatusUpdate(assignment.id, 'assigned');
    } catch (error: any) {
      console.error('Error retrieving DND room:', error);
      toast.error('Failed to retrieve DND room: ' + error.message);
    } finally {
      setIsRetrievingDND(false);
    }
  };

  // Refresh assignment photos after capture
  const handlePhotoCaptured = async () => {
    try {
      const { data, error } = await supabase
        .from('room_assignments')
        .select('completion_photos')
        .eq('id', assignment.id)
        .single();

      if (!error && data) {
        setCurrentPhotos(data.completion_photos || []);
        toast.success('Photos saved successfully! You can now complete the room.');
      }
    } catch (error) {
      console.error('Error refreshing photos:', error);
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
                🏺 {t('roomCard.towelChange')}
              </Badge>
            )}
            {assignment.rooms?.linen_change_required && (
              <Badge 
                variant="default" 
                className="bg-purple-100 text-purple-800 border-purple-200 font-semibold px-3 py-1 text-xs rounded-full shadow-sm flex-shrink-0"
              >
                🛏️ {t('roomCard.linenChange')}
              </Badge>
            )}
            {assignment.rooms?.guest_nights_stayed && assignment.rooms.guest_nights_stayed > 0 && (
              <Badge 
                variant="outline" 
                className="bg-muted text-foreground border-border font-semibold px-3 py-1 text-xs rounded-full flex-shrink-0"
              >
                🌙 {t('roomCard.night')} {assignment.rooms.guest_nights_stayed}
              </Badge>
            )}
            
            {assignment.priority > 1 && assignment.status !== 'in_progress' && (
              <Badge 
                variant="outline" 
                className={`${getPriorityColor(assignment.priority)} font-semibold px-3 py-1 text-xs border rounded-full shadow-sm flex-shrink-0 animate-pulse`}
              >
                ⭐ {assignment.priority === 3 ? t('housekeeping.priority.high') : t('housekeeping.priority.medium')}
              </Badge>
            )}
            {assignment.status === 'in_progress' && (
              <Badge 
                variant="default"
                className="bg-amber-500 text-white font-semibold px-3 py-1 text-xs rounded-full shadow-sm flex-shrink-0 animate-pulse"
              >
                🔥 {t('housekeeping.inProgress')}
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
              <p className="text-sm font-medium text-muted-foreground">{t('room.hotel')}</p>
              <p className="text-lg font-semibold text-foreground">{assignment.rooms?.hotel || 'Unknown Hotel'}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
            <BedDouble className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">{t('common.floor')}</p>
              <p className="text-lg font-semibold text-foreground">
                {assignment.rooms?.floor_number !== undefined && assignment.rooms?.floor_number !== null 
                  ? `${t('common.floor')} ${assignment.rooms.floor_number}` 
                  : t('roomCard.floorUnavailable')
                }
              </p>
            </div>
          </div>
          {assignment.rooms?.room_name && (
            <div className="col-span-2 p-3 bg-muted/50 rounded-lg border border-border">
              <p className="text-sm font-medium text-muted-foreground">{t('roomCard.roomName')}</p>
              <p className="text-lg font-semibold text-foreground">{assignment.rooms.room_name}</p>
            </div>
          )}
          {assignment.estimated_duration && assignment.status === 'in_progress' && (
            <div className="col-span-2 flex items-center justify-between p-3 bg-muted/50 rounded-lg border border-border">
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{t('roomCard.estimatedTime')}</p>
                  <p className="text-lg font-semibold text-foreground">{assignment.estimated_duration} {t('common.minutes')}</p>
                </div>
              </div>
              {assignment.started_at && (
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

        {/* Important Assignment Notes - Prominently Displayed */}
        {assignment.notes && (
          <div className="relative p-5 bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-50 rounded-xl border-2 border-amber-300 shadow-lg animate-pulse-slow">
            <div className="absolute -top-3 -left-3 bg-amber-400 text-white rounded-full p-2 shadow-md">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="ml-6">
              <h4 className="font-bold text-amber-900 mb-2 text-lg flex items-center gap-2">
                📝 {t('housekeeping.assignmentNotes')}
              </h4>
              <p className="text-base text-amber-800 leading-relaxed font-semibold bg-white/60 p-3 rounded-lg border border-amber-200">
                {shouldTranslateContent(language) 
                  ? translateText(assignment.notes, language)
                  : assignment.notes
                }
              </p>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-4">
          {/* Primary Action Buttons - Only Start button before Required Actions */}
          <div className="flex flex-col sm:flex-row gap-3">
          {assignment.status === 'assigned' && (
              <HoldButton
                size="lg"
                holdDuration={2000}
                onHoldComplete={() => {
                  console.log('Hold complete, starting room...');
                  updateAssignmentStatus('in_progress');
                }}
                disabled={loading}
                className="w-full sm:w-auto select-none"
                style={{
                  WebkitUserSelect: 'none',
                  WebkitTouchCallout: 'none',
                  userSelect: 'none'
                }}
                holdText={t('housekeeping.holdToStart')}
                releaseText={t('housekeeping.keepHolding')}
              >
                <Play className="h-5 w-5" />
                {t('housekeeping.start')}
              </HoldButton>
            )}

            {/* Change to Checkout Button - Only for managers/admins with daily cleaning */}
            {(profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'housekeeping_manager') && 
             assignment.assignment_type === 'daily_cleaning' && (
              <Button 
                size="lg"
                variant="outline" 
                onClick={() => setChangeTypeDialogOpen(true)} 
                className="w-full sm:w-auto border-blue-600 text-blue-700 hover:bg-blue-50"
              >
                <ArrowUpDown className="h-5 w-5" />
                {t('roomCard.changeToCheckout')}
              </Button>
            )}
          </div>

          {/* Required Actions Section - Daily Photo, DND Photo and Dirty Linen for In-Progress Tasks */}
          {assignment.status === 'in_progress' && (
            <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 rounded-lg border-2 border-dashed border-amber-200">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                <span className="font-semibold text-amber-800">{t('actions.required')}</span>
              </div>
              
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {/* Room Photos Button - Only show for daily cleaning rooms, not checkout rooms */}
                {assignment.assignment_type !== 'checkout_cleaning' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDailyPhotoDialogOpen(true)}
                    className="flex flex-col items-center justify-center gap-1 h-auto min-h-16 py-2 px-2 border-blue-300 text-blue-700 hover:bg-blue-100"
                  >
                    <Camera className="h-4 w-4 flex-shrink-0" />
                    <span className="text-[10px] leading-tight text-center break-words">{t('actions.roomPhotos')}</span>
                  </Button>
                )}

                {/* DND Photo Button */}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEnhancedDndPhotoDialogOpen(true)}
                  className="flex flex-col items-center justify-center gap-1 h-auto min-h-16 py-2 px-2 border-orange-300 text-orange-700 hover:bg-orange-100"
                >
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  <span className="text-[10px] leading-tight text-center break-words">{t('actions.dndPhoto')}</span>
                </Button>

                {/* Dirty Linen Button */}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDirtyLinenDialogOpen(true)}
                  className="flex flex-col items-center justify-center gap-1 h-auto min-h-16 py-2 px-2 border-amber-300 text-amber-700 hover:bg-amber-100"
                >
                  <Shirt className="h-4 w-4 flex-shrink-0" />
                  <span className="text-[10px] leading-tight text-center break-words">{t('actions.dirtyLinen')}</span>
                </Button>

                {/* Minibar Consumption Button */}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRoomDetailOpen(true)}
                  className="flex flex-col items-center justify-center gap-1 h-auto min-h-16 py-2 px-2 border-purple-300 text-purple-700 hover:bg-purple-100"
                >
                  <BedDouble className="h-4 w-4 flex-shrink-0" />
                  <span className="text-[10px] leading-tight text-center break-words">{t('actions.minibar')}</span>
                </Button>

                {/* Lost & Found Button */}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setLostFoundDialogOpen(true)}
                  className="flex flex-col items-center justify-center gap-1 h-auto min-h-16 py-2 px-2 border-green-300 text-green-700 hover:bg-green-100"
                >
                  <Package className="h-4 w-4 flex-shrink-0" />
                  <span className="text-[10px] leading-tight text-center break-words">{t('actions.lostAndFound')}</span>
                </Button>

                {/* Maintenance Issue Button */}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setMaintenanceDialogOpen(true)}
                  className="flex flex-col items-center justify-center gap-1 h-auto min-h-16 py-2 px-2 border-red-300 text-red-700 hover:bg-red-100"
                >
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  <span className="text-[10px] leading-tight text-center break-words">{t('actions.maintenance')}</span>
                </Button>
              </div>
            </div>
          )}

          {/* Complete, Add Note, Details Buttons - After Required Actions */}
          {assignment.status === 'in_progress' && (
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative pb-8 w-full sm:w-auto">
                <HoldButton 
                  onClick={() => updateAssignmentStatus('completed')}
                  onHoldComplete={() => updateAssignmentStatus('completed')}
                  holdDuration={2000}
                  disabled={loading}
                  className="w-full h-12 bg-green-600 hover:bg-green-700 text-white"
                  holdText={t('housekeeping.holdToComplete')}
                  releaseText={t('housekeeping.keepHolding')}
                >
                  <CheckCircle className="h-5 w-5 mr-2" /> 
                  {t('housekeeping.complete')} 
                </HoldButton>
              </div>

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

        {/* Allow Dirty Linen access for completed rooms */}
        {assignment.status === 'completed' && (
          <div className="mt-4 p-3 bg-purple-50 border border-purple-200 rounded-lg space-y-2">
            <p className="text-sm text-purple-800 mb-2">
              {t('roomCard.needUpdateAfterCompletion')}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDirtyLinenDialogOpen(true)}
              className="w-full border-purple-300 text-purple-700 hover:bg-purple-100"
            >
              <Shirt className="h-4 w-4 mr-2" />
              {t('actions.updateDirtyLinen')}
            </Button>
          </div>
        )}

        {/* Info: How to clean DND rooms from completed tasks */}
        {assignment.status === 'completed' && assignment.is_dnd && (
          <div className="mt-4 space-y-2">
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex gap-2">
                <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-800">
                  {t('dnd.tipCheckCompleted')}
                </p>
              </div>
            </div>

            <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-orange-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-orange-800 mb-1">
                    {t('dnd.signRemoved')}
                  </p>
                  <p className="text-xs text-orange-700 mb-3">
                    {t('dnd.signRemovedDesc')}
                  </p>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={handleRetrieveDNDRoom}
                    disabled={isRetrievingDND || loading}
                    className="w-full bg-orange-600 hover:bg-orange-700 text-white"
                  >
                    {isRetrievingDND ? (
                      <>
                        <Clock className="h-4 w-4 mr-2 animate-spin" />
                        {t('dnd.starting')}
                      </>
                    ) : (
                      <>
                        <CheckCircle className="h-4 w-4 mr-2" />
                        {t('dnd.startCleaning')}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Room Status Indicator */}
        {assignment.rooms?.status && assignment.rooms.status !== 'clean' && (
          <div className="flex items-center gap-3 p-4 bg-muted/50 border border-border rounded-lg shadow-sm">
            <AlertTriangle className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">{t('actions.roomStatusAlert')}</p>
              <p className="text-lg font-semibold text-foreground capitalize">
                {t('roomCard.roomStatus')}: {assignment.rooms.status}
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

      {/* Room Photos Dialog */}
      <SimplifiedPhotoCapture
        open={dailyPhotoDialogOpen}
        onOpenChange={setDailyPhotoDialogOpen}
        roomNumber={assignment.rooms?.room_number || 'N/A'}
        assignmentId={assignment.id}
        onPhotoCaptured={handlePhotoCaptured}
      />

      {/* Enhanced DND Photo Dialog */}
      <EnhancedDNDPhotoCapture
        open={enhancedDndPhotoDialogOpen}
        onOpenChange={setEnhancedDndPhotoDialogOpen}
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


      {/* Maintenance Issue Dialog */}
      <MaintenanceIssueDialog
        open={maintenanceDialogOpen}
        onOpenChange={setMaintenanceDialogOpen}
        roomNumber={assignment.rooms?.room_number || 'Unknown'}
        roomId={assignment.room_id}
        assignmentId={assignment.id}
        onIssueReported={() => {
          toast.success('Maintenance issue reported successfully');
        }}
      />

      {/* Lost & Found Dialog */}
      <LostAndFoundDialog
        open={lostFoundDialogOpen}
        onOpenChange={setLostFoundDialogOpen}
        roomNumber={assignment.rooms?.room_number || 'Unknown'}
        roomId={assignment.room_id}
        assignmentId={assignment.id}
        onItemReported={() => {
          toast.success('Lost & Found item reported successfully');
        }}
      />

      {/* Room Assignment Change Dialog - For changing daily to checkout */}
      <RoomAssignmentChangeDialog
        open={changeTypeDialogOpen}
        onOpenChange={setChangeTypeDialogOpen}
        roomId={assignment.room_id}
        roomNumber={assignment.rooms?.room_number || 'Unknown'}
        currentAssignmentType={assignment.assignment_type}
        onAssignmentChanged={() => {
          // Refresh the page or update assignment data
          window.location.reload();
        }}
      />
    </Card>
  );
}