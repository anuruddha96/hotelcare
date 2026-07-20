import React, { useState, useEffect } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
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
  Info,
  Globe,
  Ban,
  ClipboardList,
  Wrench,
  Loader2 as LucideLoader
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
import { PreCompleteChecklistDialog } from './PreCompleteChecklistDialog';
import { PausableTimerComponent } from './PausableTimerComponent';
import { RoomAssignmentChangeDialog } from './RoomAssignmentChangeDialog';
import { useTranslation } from '@/hooks/useTranslation';
import { translateText, shouldTranslateContent } from '@/lib/translation-utils';
import { parseRoomFlags } from '@/lib/room-service-flags';

interface AssignedRoomCardProps {
  assignment: {
    id: string;
    room_id: string;
    assignment_type: 'daily_cleaning' | 'checkout_cleaning' | 'maintenance' | 'deep_cleaning';
    status: 'assigned' | 'in_progress' | 'completed' | 'cancelled' | 'dnd_pending_retry';
    priority: number;
    estimated_duration: number;
    notes: string;
    started_at?: string | null;
    completed_at?: string | null;
    completion_photos?: string[] | null;
    is_dnd?: boolean;
    dnd_marked_at?: string | null;
    dnd_marked_by?: string | null;
    dnd_attempt_count?: number | null;
    dnd_first_attempt_at?: string | null;
    dnd_retry_unlocked_at?: string | null;
    supervisor_approved?: boolean;
    supervisor_approved_by?: string | null;
    supervisor_approved_at?: string | null;
    ready_to_clean?: boolean;
    rooms: {
      room_number: string;
      hotel: string;
      status: string;
      room_name: string | null;
      floor_number: number | null;
      guest_nights_stayed?: number;
      towel_change_required?: boolean;
      linen_change_required?: boolean;
      checkout_time?: string | null;
      notes?: string | null;
      bed_configuration?: string | null;
      is_checkout_room?: boolean | null;
      pms_metadata?: any;
    } | null;
  };
  onStatusUpdate: (assignmentId: string, newStatus: 'assigned' | 'in_progress' | 'completed' | 'cancelled' | 'dnd_pending_retry') => void;
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
  const [noServiceDialogOpen, setNoServiceDialogOpen] = useState(false);
  const [noServiceLoading, setNoServiceLoading] = useState(false);
  const [noServiceConsent, setNoServiceConsent] = useState(false);
  const [warningInfoOpen, setWarningInfoOpen] = useState(false);
  const [preCompleteOpen, setPreCompleteOpen] = useState(false);

  // Messaging state
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [translatingMsgId, setTranslatingMsgId] = useState<string | null>(null);
  const [translatedMessages, setTranslatedMessages] = useState<Record<string, string>>({});

  // Priority and styling - static glow for high priority
  const isHighPriority = assignment.priority >= 3;
  const showPriorityGlow = isHighPriority && assignment.status !== 'completed' && assignment.status !== 'in_progress';
  
  // Check if this is a checkout room waiting for guest to leave
  const isCheckoutWaiting = assignment.assignment_type === 'checkout_cleaning' && !assignment.ready_to_clean;
  // Checkout cleans always include a full towel change — hide the extra
  // "Towel Change" badges/instructions to avoid redundant noise.
  const isCheckoutClean = assignment.assignment_type === 'checkout_cleaning'
    || !!assignment.rooms?.is_checkout_room
    || (assignment.rooms as any)?.pms_metadata?.scheduledDepartureToday === true;
  const showTowelChange = !!assignment.rooms?.towel_change_required && !isCheckoutClean;
  
  const cardClassName = [
    "group bg-card border shadow-sm hover:shadow-md transition-all duration-200 rounded-xl w-full",
    showPriorityGlow && "border-red-500 shadow-lg shadow-red-500/50",
    assignment.status === 'in_progress' && "ring-2 ring-blue-500 ring-offset-2",
    assignment.status === 'completed' && "opacity-75 bg-green-50 dark:bg-green-950",
    isCheckoutWaiting && "border-l-4 border-l-orange-400 bg-orange-50/50 dark:bg-orange-950/20"
  ].filter(Boolean).join(" ");

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

  // Fetch messages for this assignment
  useEffect(() => {
    const fetchMessages = async () => {
      const { data } = await supabase
        .from('housekeeping_notes')
        .select('id, content, note_type, created_by, created_at, is_resolved')
        .eq('room_id', assignment.room_id)
        .eq('assignment_id', assignment.id)
        .order('created_at', { ascending: true });
      setMessages(data || []);
    };
    fetchMessages();

    const channel = supabase
      .channel(`notes-${assignment.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'housekeeping_notes', filter: `assignment_id=eq.${assignment.id}` }, () => fetchMessages())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [assignment.id, assignment.room_id]);

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
      const currentAttempts = assignment.dnd_attempt_count ?? 0;
      const nextAttempt = currentAttempts + 1;
      const isSecondAttempt = nextAttempt >= 2;

      if (isSecondAttempt) {
        // Second (or later) DND attempt → send to manager approval
        const { error: assignmentError } = await supabase
          .from('room_assignments')
          .update({
            status: 'completed',
            is_dnd: true,
            dnd_marked_at: now,
            dnd_marked_by: user?.id,
            dnd_attempt_count: nextAttempt,
            completed_at: now,
          } as any)
          .eq('id', assignment.id);
        if (assignmentError) throw assignmentError;

        const { error: roomError } = await supabase
          .from('rooms')
          .update({
            is_dnd: true,
            dnd_marked_at: now,
            dnd_marked_by: user?.id,
          })
          .eq('id', assignment.room_id);
        if (roomError) throw roomError;

        onStatusUpdate(assignment.id, 'completed');
        const roomNum = assignment.rooms?.room_number ?? '—';
        toast.success(`Room ${roomNum} — 2nd DND attempt recorded, sent for manager approval`);
      } else {
        // First DND attempt → recycle to bottom of housekeeper's list
        const { error: assignmentError } = await supabase
          .from('room_assignments')
          .update({
            status: 'dnd_pending_retry',
            dnd_attempt_count: 1,
            dnd_first_attempt_at: now,
            dnd_retry_unlocked_at: null,
          } as any)
          .eq('id', assignment.id);
        if (assignmentError) throw assignmentError;

        onStatusUpdate(assignment.id, 'dnd_pending_retry');
        const roomNum = assignment.rooms?.room_number ?? '—';
        toast.success(`Room ${roomNum} — we'll try again after your other rooms or at 14:30`);
      }
    } catch (error) {
      console.error('Error marking as DND:', error);
      toast.error('Failed to mark room as DND');
    } finally {
      setLoading(false);
      setDndPhotoDialogOpen(false);
    }
  };

  const markAsNoService = async () => {
    setNoServiceLoading(true);
    try {
      const now = new Date().toISOString();
      
      // Mark assignment as completed with no_service flag
      const { error: assignmentError } = await supabase
        .from('room_assignments')
        .update({ 
          status: 'completed',
          completed_at: now,
          notes: `${assignment.notes || ''}\n[NO_SERVICE] Guest confirmed no service required`.trim()
        })
        .eq('id', assignment.id);

      if (assignmentError) throw assignmentError;
      
      onStatusUpdate(assignment.id, 'completed');
      const roomNum = assignment.rooms?.room_number ?? '—';
      toast.success(`Room ${roomNum} marked as No Service - guest declined`);
    } catch (error) {
      console.error('Error marking as no service:', error);
      toast.error('Failed to mark room as no service');
    } finally {
      setNoServiceLoading(false);
      setNoServiceDialogOpen(false);
    }
  };

  const updateAssignmentStatus = async (newStatus: 'assigned' | 'in_progress' | 'completed' | 'cancelled' | 'dnd_pending_retry') => {
    // Check for room photos on daily cleaning completion - require ALL 5 categories
    if (newStatus === 'completed' && assignment.assignment_type === 'daily_cleaning') {
      const { data: assignmentData } = await supabase
        .from('room_assignments')
        .select('completion_photos')
        .eq('id', assignment.id)
        .single();

      const photos: string[] = assignmentData?.completion_photos || [];
      const requiredCategories = ['trash_bin', 'bathroom', 'bed', 'minibar', 'tea_coffee_table'];
      const missing = requiredCategories.filter(cat => {
        return !photos.some(url => {
          const filename = url.split('/').pop() || '';
          return filename.startsWith(cat + '_');
        });
      });

      if (photos.length === 0 || missing.length > 0) {
        toast.error(t('actions.photosRequired'), {
          description: missing.length > 0
            ? `${t('actions.photosRequiredMessage')} (Missing: ${missing.join(', ')})`
            : t('actions.photosRequiredMessage'),
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
        toast.error("🌸 Take Your Time", {
          description: "Please finish your break before starting work. Your well-being matters! 😌",
          duration: 10000,
        });
        return;
      }

      // Check if user is checked in before starting work
      if (!freshAttendanceStatus || freshAttendanceStatus === 'checked_out') {
        console.log('❌ User not checked in - blocking start', { freshAttendanceStatus });
        toast.error("⚠️ " + t('attendance.notCheckedIn'), {
          description: "Please sign in first to start cleaning. Use the Attendance tab to check in.",
          duration: 15000,
          action: {
            label: t('attendance.goToCheckIn') || 'Go to Check-in',
            onClick: () => {
              // Try multiple selectors for robust tab redirect
              const selectors = [
                '[data-value="attendance"]',
                'button[value="attendance"]',
                '[role="tab"][value="attendance"]',
                // Mobile-specific selectors
                '[data-tab="attendance"]',
                'button:has(svg)',
              ];
              let found = false;
              for (const selector of selectors) {
                const tabs = document.querySelectorAll(selector);
                for (const tab of tabs) {
                  const text = tab.textContent?.toLowerCase() || '';
                  if (selector.includes('attendance') || text.includes('attendance') || text.includes('ircé') || text.includes('check')) {
                    (tab as HTMLElement).click();
                    found = true;
                    break;
                  }
                }
                if (found) break;
              }
              if (!found) {
                // Fallback: scroll to top where tabs are
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }
          }
        });
        return;
      }
    } else if (freshIsManualCheckIn) {
      console.log('✅ Skipping attendance checks - manual check-in detected');
    }

    // Check if user already has a room in progress (only for housekeepers)
    // Allow starting high-priority rooms even with active rooms
    // Managers, admins, and super admins can start multiple rooms
    if (newStatus === 'in_progress') {
      const isHousekeeper = profile?.role === 'housekeeping';
      const currentIsHighPriority = assignment.priority >= 3;
      
      if (isHousekeeper && !currentIsHighPriority) {
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
            description: `Please complete ${activeRoomNumber} before starting work on this room. High-priority rooms can be started anytime.`,
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

      // Always stamp a fresh started_at when transitioning into in_progress.
      // The DB trigger guard_room_assignment_started_at is the source of truth
      // and overwrites this with now() server-side, but we send a value so the
      // optimistic UI stays in sync.
      if (newStatus === 'in_progress' && assignment.status !== 'in_progress') {
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

  const sendMessage = async () => {
    if (!newMessage.trim()) return;
    setSendingMessage(true);
    try {
      const { error } = await supabase
        .from('housekeeping_notes')
        .insert({
          room_id: assignment.room_id,
          assignment_id: assignment.id,
          content: newMessage,
          note_type: 'message',
          created_by: (await supabase.auth.getUser()).data.user?.id
        });
      if (error) throw error;
      setNewMessage('');
      toast.success(t('roomCard.messageSent') || 'Message sent');
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error('Failed to send message');
    } finally {
      setSendingMessage(false);
    }
  };

  const handleTranslateMessage = async (msgId: string, text: string) => {
    setTranslatingMsgId(msgId);
    try {
      const { data, error } = await supabase.functions.invoke('translate-note', {
        body: { text, targetLanguage: language }
      });
      if (error) throw error;
      setTranslatedMessages(prev => ({ ...prev, [msgId]: data.translatedText }));
    } catch {
      toast.error('Translation failed');
    } finally {
      setTranslatingMsgId(null);
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

  // Parse room flags from notes
  const roomFlags = parseRoomFlags(assignment.rooms?.notes || null);
  // Strip PMS-imported reception/kitchen sections from the note shown to
  // housekeepers — those are OTA/reservation blobs that leak through the
  // Previo `Recepce:` / `Kuchyně:` prefixes and are not actionable for
  // cleaning. Keep only manager-typed free text and the explicit
  // `Housekeeping:` section (which IS meant for the housekeeper).
  const managerVisibleNote = (() => {
    const raw = (roomFlags.cleanNotes || '').trim();
    if (!raw) return '';
    const PMS_SECTION_RE = /(Recepce|Reception|Kuchyn[ěe]|Kitchen|Syst[ée]m|Poznámka)\s*:\s*/i;
    // If the note contains any PMS section labels, only keep the
    // `Housekeeping:` / `Takarítás` / `Hózvezetés` slice; drop everything else.
    if (PMS_SECTION_RE.test(raw) || /Housekeeping\s*:/i.test(raw)) {
      const parts = raw.split(/\s•\s|\s\|\s/);
      const kept = parts
        .map((p) => p.trim())
        .filter((p) => /^(Housekeeping|Takar[ií]t[aá]s|H[oó]zvezet[ée]s)\s*:/i.test(p))
        .map((p) => p.replace(/^[^:]+:\s*/, '').trim())
        .filter(Boolean);
      return kept.join(' • ');
    }
    return raw;
  })();
  const hasManagerNotes = !!managerVisibleNote;
  // Prefer PMS-inferred bed config, but fall back to the manager-set
  // `bed_configuration` column so manual bed setup instructions still reach
  // the housekeeper when there's no housekeeping note to infer from.
  const rawBedInstruction = assignment.rooms?.pms_metadata?.inferredBedConfig?.value
    || assignment.rooms?.pms_metadata?.inferredBedConfig?.bedConfiguration
    || assignment.rooms?.bed_configuration
    || null;
  const bedInstruction = typeof rawBedInstruction === 'string' && rawBedInstruction.trim()
    ? rawBedInstruction.trim()
    : null;
  
  // Count special instructions
  const hasSpecialInstructions = showTowelChange || assignment.rooms?.linen_change_required || !!bedInstruction || hasManagerNotes || assignment.notes || roomFlags.collectExtraTowels || roomFlags.roomCleaning;
  const instructionCount = [showTowelChange, assignment.rooms?.linen_change_required, !!bedInstruction, hasManagerNotes, assignment.notes, roomFlags.collectExtraTowels, roomFlags.roomCleaning].filter(Boolean).length;

  // AI translation state
  const [translating, setTranslating] = useState(false);
  const [translatedManagerNote, setTranslatedManagerNote] = useState<string | null>(null);
  const [translatedAssignmentNote, setTranslatedAssignmentNote] = useState<string | null>(null);

  const handleTranslateNote = async (noteText: string, setter: (val: string) => void) => {
    setTranslating(true);
    try {
      const { data, error } = await supabase.functions.invoke('translate-note', {
        body: { text: noteText, targetLanguage: language }
      });
      if (error) throw error;
      setter(data.translatedText);
      toast.success('Note translated');
    } catch (err: any) {
      toast.error('Translation failed');
    } finally {
      setTranslating(false);
    }
  };

  return (
    <Card className={`${cardClassName}${hasSpecialInstructions ? ' border-l-4 border-l-amber-400' : ''}`}>
      <CardHeader className="pb-4">
        {/* Checkout Waiting Banner */}
        {isCheckoutWaiting && (
          <div className="mb-4 p-3 bg-gradient-to-r from-orange-100 to-amber-100 dark:from-orange-900/40 dark:to-amber-900/40 rounded-lg border border-orange-300 dark:border-orange-700">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-orange-600 dark:text-orange-400 animate-pulse" />
              <div>
                <p className="font-semibold text-orange-800 dark:text-orange-200 text-sm">
                  {t('housekeeping.waitingForCheckout') || 'Waiting for guest checkout'}
                </p>
                <p className="text-xs text-orange-600 dark:text-orange-400">
                  {t('housekeeping.checkoutNotReady') || 'Guest is still in room - cannot start cleaning yet'}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-start">
          <div className="flex items-center gap-3 flex-wrap min-w-0 flex-1">
            <CardTitle className="text-xl sm:text-2xl font-bold text-foreground break-words">
              {t('common.room')} {assignment.rooms?.room_number || 'N/A'}
            </CardTitle>
            <Badge 
              className={`${getStatusColor(assignment.status)} font-semibold px-3 py-1 text-xs uppercase rounded-full shadow-sm flex-shrink-0 max-w-full whitespace-normal break-words leading-tight text-center`}
            >
              {isCheckoutWaiting
                ? (t('housekeeping.guestInRoom') || 'Guest in room')
                : assignment.status === 'in_progress' 
                ? t('housekeeping.inProgress')
                : assignment.status === 'completed'
                ? t('housekeeping.completed')
                : assignment.status === 'assigned'
                ? t('housekeeping.waiting')
                : assignment.status.replace('_', ' ')
              }
            </Badge>
            {hasSpecialInstructions && (
              <Badge 
                variant="destructive" 
                className="text-[10px] px-1.5 py-0.5 animate-pulse flex-shrink-0 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  setWarningInfoOpen(true);
                }}
              >
                ⚠️ {instructionCount}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Checkout Room Indicator */}
            {isCheckoutWaiting && (
              <Badge 
                variant="default" 
                className="bg-orange-500 text-white font-semibold px-3 py-1 text-xs rounded-full shadow-sm flex-shrink-0 animate-pulse max-w-full whitespace-normal break-words leading-tight text-center"
              >
                🚪 {t('housekeeping.assignmentType.checkoutClean') || 'Checkout'}
              </Badge>
            )}
            {/* Special Requirements Badges */}
            {showTowelChange && (
              <Badge 
                variant="default" 
                className="bg-primary/10 text-primary border-primary/20 font-semibold px-3 py-1 text-xs rounded-full shadow-sm flex-shrink-0 max-w-full whitespace-normal break-words leading-tight text-center"
              >
                🏺 {t('roomCard.towelChange')}
              </Badge>
            )}
            {assignment.rooms?.linen_change_required && (
              <Badge 
                variant="default" 
                className="bg-accent text-accent-foreground border-border font-semibold px-3 py-1 text-xs rounded-full shadow-sm flex-shrink-0 max-w-full whitespace-normal break-words leading-tight text-center"
              >
                🛏️ {t('roomCard.linenChange')}
              </Badge>
            )}
            {(assignment.rooms?.guest_nights_stayed ?? 0) > 0 && (
              <Badge 
                variant="outline" 
                className="bg-muted text-foreground border-border font-semibold px-3 py-1 text-xs rounded-full flex-shrink-0 max-w-full whitespace-normal break-words leading-tight text-center"
              >
                🌙 {t('roomCard.night')} {assignment.rooms.guest_nights_stayed}
              </Badge>
            )}
            
            {assignment.priority > 1 && assignment.status !== 'in_progress' && (
              <Badge 
                variant="outline" 
                className={`${getPriorityColor(assignment.priority)} font-semibold px-3 py-1 text-xs border rounded-full shadow-sm flex-shrink-0 animate-pulse max-w-full whitespace-normal break-words leading-tight text-center`}
              >
                ⭐ {assignment.priority === 3 ? t('housekeeping.priority.high') : t('housekeeping.priority.medium')}
              </Badge>
            )}
            {assignment.status === 'in_progress' && (
              <Badge 
                variant="default"
                className="bg-primary text-primary-foreground font-semibold px-3 py-1 text-xs rounded-full shadow-sm flex-shrink-0 animate-pulse max-w-full whitespace-normal break-words leading-tight text-center"
              >
                🔥 {t('housekeeping.inProgress')}
              </Badge>
            )}
            {!isCheckoutWaiting && (
              <Badge 
                variant="outline" 
                className="bg-muted text-foreground border-border font-semibold px-3 py-1 text-xs rounded-full hover:bg-muted/80 transition-colors flex-shrink-0 max-w-full whitespace-normal break-words leading-tight text-center"
              >
                {getAssignmentTypeLabel(assignment.assignment_type)}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      {/* === SPECIAL INSTRUCTIONS — Between header and content === */}
      {hasSpecialInstructions && (
        <div className="px-6 pb-2 space-y-2">
          {showTowelChange && (
            <div className="p-3 bg-yellow-50 dark:bg-yellow-950/30 border-2 border-yellow-400 dark:border-yellow-600 rounded-lg">
              <div className="flex items-center gap-2">
                <span className="text-lg">🧺</span>
                <p className="font-bold text-yellow-800 dark:text-yellow-200 text-sm">{t('roomCard.towelChange') || 'Towel Change Required'}</p>
              </div>
            </div>
          )}
          {assignment.rooms?.linen_change_required && (
            <div className="p-3 bg-purple-50 dark:bg-purple-950/30 border-2 border-purple-400 dark:border-purple-600 rounded-lg">
              <div className="flex items-center gap-2">
                <span className="text-lg">🛏️</span>
                <p className="font-bold text-purple-800 dark:text-purple-200 text-sm">{t('roomCard.bedLinenChange') || 'Bed Linen Change (LC)'}</p>
              </div>
            </div>
          )}
          {roomFlags.roomCleaning && (
            <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border-2 border-blue-400 dark:border-blue-600 rounded-lg">
              <div className="flex items-center gap-2">
                <span className="text-lg">🧹</span>
                <p className="font-bold text-blue-800 dark:text-blue-200 text-sm">{t('roomCard.roomCleaning') || 'Full Room Cleaning (RC)'}</p>
              </div>
            </div>
          )}
          {roomFlags.collectExtraTowels && (
            <div className="p-3 bg-orange-50 dark:bg-orange-950/30 border-2 border-orange-400 dark:border-orange-600 rounded-lg animate-pulse">
              <div className="flex items-center gap-2">
                <span className="text-lg">🧺</span>
                <div>
                  <p className="font-bold text-orange-800 dark:text-orange-200 text-sm">{t('roomCard.collectExtraTowels') || 'Collect Extra Towels'}</p>
                  <p className="text-xs text-orange-700 dark:text-orange-300">{t('roomCard.collectExtraTowelsDesc') || 'Reception gave extra towels — please collect them'}</p>
                </div>
              </div>
            </div>
          )}
          {bedInstruction && (
            <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border-2 border-blue-400 dark:border-blue-600 rounded-lg">
              <div className="flex items-center gap-2">
                <BedDouble className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <div>
                  <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">{t('roomCard.bedConfiguration') || 'Bed Configuration'}</p>
                  <p className="font-bold text-blue-800 dark:text-blue-200 text-sm">{bedInstruction}</p>
                </div>
              </div>
            </div>
          )}
          {hasManagerNotes && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-400 dark:border-amber-600 rounded-lg">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide">{t('roomCard.managerNotes') || 'Manager Notes'}</p>
                  <p className="text-sm text-amber-800 dark:text-amber-200 mt-0.5">
                    {translatedManagerNote || managerVisibleNote}
                  </p>
                  {!translatedManagerNote && (
                    <button
                      className="mt-1.5 flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800 font-medium"
                      onClick={() => handleTranslateNote(managerVisibleNote, setTranslatedManagerNote)}
                      disabled={translating}
                    >
                      {translating ? <LucideLoader className="h-3 w-3 animate-spin" /> : <Globe className="h-3 w-3" />}
                      {t('roomCard.translateNote') || '🌐 Translate'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
          {assignment.notes && (
            <div className="p-3 bg-gradient-to-r from-amber-50 via-yellow-50 to-orange-50 dark:from-amber-950/30 dark:via-yellow-950/30 dark:to-orange-950/30 border-2 border-amber-300 dark:border-amber-600 rounded-lg shadow-sm">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-xs font-semibold text-amber-900 dark:text-amber-300 uppercase tracking-wide">📝 {t('housekeeping.assignmentNotes')}</p>
                  <p className="text-sm text-amber-800 dark:text-amber-200 font-semibold mt-0.5">
                    {translatedAssignmentNote || (shouldTranslateContent(language) ? translateText(assignment.notes, language) : assignment.notes)}
                  </p>
                  {!translatedAssignmentNote && (
                    <button
                      className="mt-1.5 flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800 font-medium"
                      onClick={() => handleTranslateNote(assignment.notes, setTranslatedAssignmentNote)}
                      disabled={translating}
                    >
                      {translating ? <LucideLoader className="h-3 w-3 animate-spin" /> : <Globe className="h-3 w-3" />}
                      {t('roomCard.translateNote') || '🌐 Translate'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <CardContent className="space-y-4">
        {/* Compact Room Info Line */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <MapPin className="h-3 w-3" />
            <span>{t('common.floor')} {assignment.rooms?.floor_number ?? '?'}</span>
            <span>·</span>
            <span>{assignment.rooms?.hotel || 'Unknown'}</span>
            {assignment.rooms?.room_name && (
              <>
                <span>·</span>
                <span className="font-medium text-foreground">{assignment.rooms.room_name}</span>
              </>
            )}
          </div>
          {/* Room Status as small badge */}
          {assignment.rooms?.status && assignment.rooms.status !== 'clean' && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">
              {assignment.rooms.status === 'dirty' ? t('rooms.dirty') : 
               assignment.rooms.status === 'maintenance' ? t('rooms.maintenance') :
               assignment.rooms.status === 'out_of_order' ? t('rooms.outOfOrder') :
               assignment.rooms.status}
            </Badge>
          )}
        </div>

        {/* Timer - always visible while in-progress so housekeepers see time spent per room */}
        {assignment.status === 'in_progress' && assignment.started_at && (
          <div className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-primary" />
              <span className="font-medium">
                {assignment.estimated_duration
                  ? `${assignment.estimated_duration} ${t('common.minutes')}`
                  : t('completion.timeOnRoom') || 'Time on this room'}
              </span>
            </div>
            <div className="bg-background px-2 py-1 rounded-md shadow-sm border border-border">
              <PausableTimerComponent
                assignmentId={assignment.id}
                startedAt={assignment.started_at}
                userId={user?.id || ''}
              />
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-4">
          {/* 2nd-attempt DND banner */}
          {assignment.status === 'dnd_pending_retry' && (
            <div className="rounded-md border border-orange-300 bg-orange-50 dark:bg-orange-950/40 dark:border-orange-800 px-3 py-2 text-sm text-orange-900 dark:text-orange-200">
              <div className="font-semibold">2nd attempt</div>
              <div className="text-xs">
                {assignment.dnd_retry_unlocked_at
                  ? 'You can try this room again now. If the guest is still DND, mark it and it will go to your supervisor.'
                  : 'Finish your other rooms first — we\'ll unlock this again at 14:30 or after your other rooms are done.'}
              </div>
            </div>
          )}
          {/* Primary Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Wrap HoldButton in a div with bottom padding to accommodate the absolute "Press & Hold" text */}
          {(assignment.status === 'assigned' || (assignment.status === 'dnd_pending_retry' && assignment.dnd_retry_unlocked_at)) && !isCheckoutWaiting && (
              <div className="pb-7 w-full sm:w-auto">
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
                  data-training="start-room-button"
                >
                  <Play className="h-5 w-5" />
                  {t('housekeeping.start')}
                </HoldButton>
              </div>
            )}

            {/* No Service Button - when guest declines cleaning */}
            {assignment.status === 'assigned' && assignment.assignment_type === 'daily_cleaning' && !isCheckoutWaiting && (
              <Dialog open={noServiceDialogOpen} onOpenChange={(open) => {
                setNoServiceDialogOpen(open);
                if (!open) setNoServiceConsent(false);
              }}>
                <DialogTrigger asChild>
                  <Button
                    size="lg"
                    variant="outline"
                    className="w-full sm:w-auto border-gray-400 text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    <Ban className="h-5 w-5" />
                    {t('housekeeping.noService')}
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle className="text-xl font-bold">
                      🚫 {t('housekeeping.noServiceTitle')}
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      {t('housekeeping.noServiceConfirm')}
                    </p>
                    <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-700 rounded-lg">
                      <p className="text-sm text-amber-800 dark:text-amber-200">
                        {t('housekeeping.noServiceNote')}
                      </p>
                    </div>
                    {/* Mandatory guest consent checkbox */}
                    <div className="flex items-start gap-3 p-3 bg-muted/50 border border-border rounded-lg">
                      <Checkbox
                        id="no-service-consent"
                        checked={noServiceConsent}
                        onCheckedChange={(checked) => setNoServiceConsent(checked === true)}
                        className="mt-0.5"
                      />
                      <label htmlFor="no-service-consent" className="text-sm font-medium leading-snug cursor-pointer select-none">
                        {t('housekeeping.noServiceConsent')}
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        onClick={markAsNoService} 
                        disabled={noServiceLoading || !noServiceConsent}
                        className="flex-1 bg-gray-600 hover:bg-gray-700 text-white font-semibold disabled:opacity-50"
                      >
                        {noServiceLoading ? '...' : t('housekeeping.confirmNoService')}
                      </Button>
                      <Button 
                        variant="outline" 
                        onClick={() => { setNoServiceDialogOpen(false); setNoServiceConsent(false); }}
                      >
                        {t('common.cancel')}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            )}

            {/* Show disabled message for checkout rooms waiting */}
            {assignment.status === 'assigned' && isCheckoutWaiting && (
              <div className="w-full p-3 bg-orange-100 dark:bg-orange-900/30 rounded-lg border border-orange-300 dark:border-orange-700 text-center">
                <p className="text-sm text-orange-700 dark:text-orange-300 font-medium">
                  ⏳ {t('housekeeping.cannotStartYet') || 'Cannot start - waiting for guest checkout'}
                </p>
              </div>
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

          {/* Room checklist — modern, friendly card of optional in-room tools */}
          {assignment.status === 'in_progress' && (() => {
            const tileBase = 'group flex flex-col items-center justify-center gap-1.5 h-auto min-h-[76px] py-3 px-2 rounded-xl border bg-card hover:bg-accent/40 hover:-translate-y-0.5 transition-all shadow-sm';
            const iconWrap = 'flex items-center justify-center h-8 w-8 rounded-full';
            const label = 'text-[11px] leading-tight text-center break-words hyphens-auto text-foreground/80 font-medium';
            return (
              <div className="p-4 bg-card rounded-2xl border border-border shadow-sm">
                <div className="flex items-start gap-2 mb-3">
                  <div className="flex items-center justify-center h-9 w-9 rounded-full bg-primary/10 shrink-0">
                    <ClipboardList className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-foreground text-sm">
                      {t('actions.checklistTitle')}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                      {t('actions.checklistSubtitle')}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {assignment.assignment_type !== 'checkout_cleaning' && (
                    <button
                      type="button"
                      onClick={() => setDailyPhotoDialogOpen(true)}
                      className={`${tileBase} border-border`}
                      data-training="room-photos-button"
                    >
                      <span className={`${iconWrap} bg-blue-100 text-blue-700`}>
                        <Camera className="h-4 w-4" />
                      </span>
                      <span className={label}>{t('actions.roomPhotos')}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setEnhancedDndPhotoDialogOpen(true)}
                    className={`${tileBase} border-border`}
                    data-training="dnd-button"
                  >
                    <span className={`${iconWrap} bg-orange-100 text-orange-700`}>
                      <AlertTriangle className="h-4 w-4" />
                    </span>
                    <span className={label}>{t('actions.dndPhoto')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDirtyLinenDialogOpen(true)}
                    className={`${tileBase} border-border`}
                    data-training="dirty-linen-button"
                  >
                    <span className={`${iconWrap} bg-amber-100 text-amber-700`}>
                      <Shirt className="h-4 w-4" />
                    </span>
                    <span className={label}>{t('actions.dirtyLinen')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRoomDetailOpen(true)}
                    className={`${tileBase} border-border`}
                  >
                    <span className={`${iconWrap} bg-purple-100 text-purple-700`}>
                      <BedDouble className="h-4 w-4" />
                    </span>
                    <span className={label}>{t('actions.minibar')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setLostFoundDialogOpen(true)}
                    className={`${tileBase} border-border`}
                    data-training="lost-found-button"
                  >
                    <span className={`${iconWrap} bg-emerald-100 text-emerald-700`}>
                      <Package className="h-4 w-4" />
                    </span>
                    <span className={label}>{t('actions.lostAndFound')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMaintenanceDialogOpen(true)}
                    className={`${tileBase} border-border`}
                    data-training="maintenance-button"
                  >
                    <span className={`${iconWrap} bg-rose-100 text-rose-700`}>
                      <Wrench className="h-4 w-4" />
                    </span>
                    <span className={label}>{t('actions.maintenance')}</span>
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Complete, Add Note, Details Buttons - After Required Actions */}
          {assignment.status === 'in_progress' && (
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative pb-8 w-full sm:w-auto">
                <HoldButton 
                  onClick={() => setPreCompleteOpen(true)}
                  onHoldComplete={() => setPreCompleteOpen(true)}
                  holdDuration={2000}
                  disabled={loading}
                  className="w-full h-12 bg-green-600 hover:bg-green-700 text-white"
                  holdText={t('housekeeping.holdToComplete')}
                  releaseText={t('housekeeping.keepHolding')}
                  data-training="complete-room-button"
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
                    data-training="notes-button"
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

        {/* Allow Dirty Linen + Minibar access for completed rooms */}
        {assignment.status === 'completed' && (
          <div className="mt-4 p-3 bg-purple-50 border border-purple-200 rounded-lg space-y-2">
            <p className="text-sm text-purple-800 mb-2">
              {t('roomCard.needUpdateAfterCompletion')}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDirtyLinenDialogOpen(true)}
                className="w-full border-purple-300 text-purple-700 hover:bg-purple-100 h-auto min-h-[44px] py-2 px-2 whitespace-normal text-xs leading-tight flex items-center justify-center gap-2"
              >
                <Shirt className="h-4 w-4 shrink-0" />
                <span className="text-center break-words">{t('actions.updateDirtyLinen')}</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRoomDetailOpen(true)}
                className="w-full border-purple-300 text-purple-700 hover:bg-purple-100 h-auto min-h-[44px] py-2 px-2 whitespace-normal text-xs leading-tight flex items-center justify-center gap-2"
              >
                <BedDouble className="h-4 w-4 shrink-0" />
                <span className="text-center break-words">{t('roomCard.addMinibarLate')}</span>
              </Button>
            </div>

            {assignment.supervisor_approved && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                {t('minibar.addedLateNotice')}
              </p>
            )}
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

        {/* Messages Section - Two-way communication */}
        {assignment.status === 'in_progress' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {t('roomCard.messages') || 'Messages'}
              </span>
            </div>
            
            {/* Message thread */}
            {messages.filter(m => m.note_type === 'message').length > 0 && (
              <div className="space-y-1.5 max-h-32 overflow-y-auto">
                {messages.filter(m => m.note_type === 'message').map(msg => {
                  const isOwnMessage = msg.created_by === user?.id;
                  return (
                    <div key={msg.id} className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] px-3 py-1.5 rounded-lg text-xs ${
                        isOwnMessage 
                          ? 'bg-primary/10 text-foreground' 
                          : 'bg-muted text-foreground'
                      }`}>
                        <p>{translatedMessages[msg.id] || msg.content}</p>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {!translatedMessages[msg.id] && (
                            <button
                              className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
                              onClick={() => handleTranslateMessage(msg.id, msg.content)}
                              disabled={translatingMsgId === msg.id}
                            >
                              {translatingMsgId === msg.id ? <LucideLoader className="h-2.5 w-2.5 animate-spin" /> : <Globe className="h-2.5 w-2.5" />}
                              {t('roomCard.translateNote') || 'Translate'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Reply input */}
            <div className="flex gap-2">
              <Textarea
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder={t('roomCard.typeMessage') || 'Type a message...'}
                className="min-h-[36px] text-xs resize-none flex-1"
                rows={1}
              />
              <Button
                size="sm"
                onClick={sendMessage}
                disabled={sendingMessage || !newMessage.trim()}
                className="h-9 px-3 self-end"
              >
                {sendingMessage ? <LucideLoader className="h-3 w-3 animate-spin" /> : <MessageSquare className="h-3 w-3" />}
              </Button>
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
          lateAddition={assignment.status === 'completed'}
          alreadyApproved={assignment.status === 'completed' && !!assignment.supervisor_approved}
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
        attemptNumber={(assignment.dnd_attempt_count ?? 0) + 1}
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

      {/* Pre-complete confirmation dialog */}
      <PreCompleteChecklistDialog
        open={preCompleteOpen}
        onOpenChange={setPreCompleteOpen}
        loading={loading}
        onOpenDirtyLinen={() => {
          setPreCompleteOpen(false);
          setDirtyLinenDialogOpen(true);
        }}
        onOpenMinibar={() => {
          setPreCompleteOpen(false);
          setRoomDetailOpen(true);
        }}
        onConfirm={async () => {
          setPreCompleteOpen(false);
          await updateAssignmentStatus('completed');
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

      {/* Warning Info Dialog - explains special instructions to housekeepers */}
      <Dialog open={warningInfoOpen} onOpenChange={setWarningInfoOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              ⚠️ {t('housekeeping.specialInstructions') || 'Special Instructions'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t('housekeeping.warningExplanation') || 'This room has special instructions that require your attention before cleaning:'}
            </p>
            <ul className="space-y-2 text-sm">
              {showTowelChange && (
                <li className="flex items-center gap-2 p-2 bg-yellow-50 dark:bg-yellow-950/30 rounded-md">
                  🧺 {t('roomCard.towelChange') || 'Towel Change Required'}
                </li>
              )}
              {assignment.rooms?.linen_change_required && (
                <li className="flex items-center gap-2 p-2 bg-purple-50 dark:bg-purple-950/30 rounded-md">
                  🛏️ {t('roomCard.bedLinenChange') || 'Bed Linen Change'}
                </li>
              )}
              {roomFlags.roomCleaning && (
                <li className="flex items-center gap-2 p-2 bg-blue-50 dark:bg-blue-950/30 rounded-md">
                  🧹 {t('roomCard.roomCleaning') || 'Full Room Cleaning'}
                </li>
              )}
              {roomFlags.collectExtraTowels && (
                <li className="flex items-center gap-2 p-2 bg-orange-50 dark:bg-orange-950/30 rounded-md">
                  🧺 {t('roomCard.collectExtraTowels') || 'Collect Extra Towels'}
                </li>
              )}
              {bedInstruction && (
                <li className="flex items-center gap-2 p-2 bg-blue-50 dark:bg-blue-950/30 rounded-md">
                  🛌 {t('roomCard.bedConfiguration') || 'Bed Configuration'}: {bedInstruction}
                </li>
              )}
              {hasManagerNotes && (
                <li className="flex items-start gap-2 p-2 bg-amber-50 dark:bg-amber-950/30 rounded-md">
                  <span>📝</span>
                  <span>{translatedManagerNote || managerVisibleNote}</span>
                </li>
              )}
              {assignment.notes && (
                <li className="flex items-start gap-2 p-2 bg-amber-50 dark:bg-amber-950/30 rounded-md">
                  <span>📋</span>
                  <span>{translatedAssignmentNote || (shouldTranslateContent(language) ? translateText(assignment.notes, language) : assignment.notes)}</span>
                </li>
              )}
            </ul>
            <p className="text-xs text-muted-foreground italic">
              {t('housekeeping.warningNoAction') || 'No action required — just review before starting.'}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}