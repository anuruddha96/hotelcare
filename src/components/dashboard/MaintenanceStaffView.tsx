import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Wrench, Clock, CheckCircle, Play, MessageSquare, Camera, AlertTriangle, Calendar as CalendarIcon, Pause, Timer, RotateCcw, Hourglass, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { format, differenceInHours, differenceInMinutes, isBefore, addHours } from 'date-fns';

interface MaintenanceTicket {
  id: string;
  ticket_number: string;
  title: string;
  description: string;
  room_number: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'completed';
  created_at: string;
  updated_at: string;
  hotel?: string;
  sla_due_date?: string;
  on_hold?: boolean;
  hold_reason?: string;
  pending_supervisor_approval?: boolean;
  created_by_profile?: {
    full_name: string;
    role: string;
  };
  completion_photos?: string[];
  resolution_text?: string;
}

// SLA hours by priority
const SLA_HOURS: { [key: string]: number } = {
  urgent: 4,
  high: 24,
  medium: 72,
  low: 168
};

// Hold reasons
const HOLD_REASONS = [
  { value: 'parts_pending', labelEn: 'New parts pending', labelHu: 'Új alkatrészekre vár' },
  { value: 'purchase_in_progress', labelEn: 'Purchase in progress', labelHu: 'Beszerzés folyamatban' },
  { value: 'need_additional_parts', labelEn: 'Need additional parts', labelHu: 'További alkatrészek szükségesek' },
  { value: 'waiting_for_approval', labelEn: 'Waiting for approval', labelHu: 'Jóváhagyásra vár' },
  { value: 'other', labelEn: 'Other reason', labelHu: 'Egyéb ok' },
];

export function MaintenanceStaffView() {
  const { user, profile } = useAuth();
  const { t, language } = useTranslation();
  const [activeTickets, setActiveTickets] = useState<MaintenanceTicket[]>([]);
  const [pendingApprovalTickets, setPendingApprovalTickets] = useState<MaintenanceTicket[]>([]);
  const [completedTickets, setCompletedTickets] = useState<MaintenanceTicket[]>([]);
  const [datesWithJobs, setDatesWithJobs] = useState<Date[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState<MaintenanceTicket | null>(null);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [holdDialogOpen, setHoldDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [note, setNote] = useState('');
  const [resolution, setResolution] = useState('');
  const [holdReason, setHoldReason] = useState('');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Translations
  const getText = (key: string) => {
    const translations: { [key: string]: { en: string; hu: string } } = {
      myTasks: { en: 'My Maintenance Tasks', hu: 'Karbantartási feladataim' },
      tasksAssigned: { en: 'Tasks assigned to you', hu: 'Önhöz rendelt feladatok' },
      allDone: { en: 'All Done!', hu: 'Minden kész!' },
      noTasks: { en: 'No maintenance tasks assigned to you', hu: 'Nincs Önhöz rendelt karbantartási feladat' },
      total: { en: 'Total', hu: 'Összes' },
      open: { en: 'Open', hu: 'Nyitott' },
      inProgress: { en: 'In Progress', hu: 'Folyamatban' },
      onHold: { en: 'On Hold', hu: 'Várakozik' },
      pendingApproval: { en: 'Pending Approval', hu: 'Jóváhagyásra vár' },
      startWork: { en: 'Start Work', hu: 'Munka indítása' },
      addNote: { en: 'Add Note', hu: 'Jegyzet hozzáadása' },
      markComplete: { en: 'Mark Complete', hu: 'Befejezés' },
      completeTask: { en: 'Complete Task', hu: 'Feladat befejezése' },
      resolution: { en: 'Resolution Description', hu: 'Megoldás leírása' },
      resolutionPlaceholder: { en: 'Describe what was done to resolve the issue...', hu: 'Írja le, hogyan oldotta meg a problémát...' },
      submitApproval: { en: 'Submit for Approval', hu: 'Beküldés jóváhagyásra' },
      awaitingApproval: { en: 'This will send the task for supervisor approval.', hu: 'Ez a feladat felügyelői jóváhagyásra kerül küldésre.' },
      reportedBy: { en: 'Reported by', hu: 'Jelentette' },
      slaDue: { en: 'SLA Due', hu: 'SLA határidő' },
      slaOverdue: { en: 'OVERDUE', hu: 'LEJÁRT' },
      completionPhoto: { en: 'Completion Photo', hu: 'Befejezési fotó' },
      photoRequired: { en: 'Photo required before completion', hu: 'Fotó szükséges a befejezés előtt' },
      takePhoto: { en: 'Take Photo', hu: 'Fotó készítése' },
      retakePhoto: { en: 'Retake', hu: 'Újra' },
      viewHistory: { en: 'View History', hu: 'Előzmények' },
      putOnHold: { en: 'Put on Hold', hu: 'Várakoztatás' },
      removeHold: { en: 'Remove Hold', hu: 'Várakoztatás megszüntetése' },
      holdReason: { en: 'Hold Reason', hu: 'Várakoztatás oka' },
      selectReason: { en: 'Select a reason...', hu: 'Válasszon okot...' },
      confirmHold: { en: 'Confirm Hold', hu: 'Várakoztatás megerősítése' },
      ticketOnHold: { en: 'Ticket put on hold', hu: 'Jegy várakoztatva' },
      holdRemoved: { en: 'Hold removed, work can continue', hu: 'Várakoztatás megszüntetve, folytathatja a munkát' },
      workStarted: { en: 'Work started on ticket', hu: 'Munka elkezdve' },
      noteAdded: { en: 'Note added successfully', hu: 'Jegyzet sikeresen hozzáadva' },
      taskCompleted: { en: 'Task completed! Awaiting supervisor approval.', hu: 'Feladat befejezve! Jóváhagyásra vár.' },
      cancel: { en: 'Cancel', hu: 'Mégse' },
      saveNote: { en: 'Save Note', hu: 'Jegyzet mentése' },
      room: { en: 'Room', hu: 'Szoba' },
      history: { en: 'Completed Jobs History', hu: 'Befejezett munkák előzményei' },
      noJobsOnDate: { en: 'No completed jobs on this date', hu: 'Nincs befejezett munka ezen a napon' },
      capturing: { en: 'Capture', hu: 'Rögzítés' },
      reopenCase: { en: 'Reopen Case', hu: 'Újranyitás' },
      caseReopened: { en: 'Case reopened for further work', hu: 'Ügy újranyitva további munkára' },
      awaitingManagerReview: { en: 'Awaiting manager review', hu: 'Vezetői felülvizsgálatra vár' },
      viewDetails: { en: 'View Details', hu: 'Részletek' },
    };
    return translations[key]?.[language === 'hu' ? 'hu' : 'en'] || key;
  };

  const getHoldReasonLabel = (value: string) => {
    const reason = HOLD_REASONS.find(r => r.value === value);
    return reason ? (language === 'hu' ? reason.labelHu : reason.labelEn) : value;
  };

  const fetchAssignedTickets = async () => {
    if (!user?.id) return;
    
    setLoading(true);
    try {
      // Fetch active tickets (not completed, not pending approval)
      const { data: activeData, error: activeError } = await supabase
        .from('tickets')
        .select(`
          *,
          created_by_profile:profiles!tickets_created_by_fkey(full_name, role)
        `)
        .eq('assigned_to', user.id)
        .eq('department', 'maintenance')
        .neq('status', 'completed')
        .eq('pending_supervisor_approval', false)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });

      if (activeError) throw activeError;
      
      // Fetch pending approval tickets
      const { data: pendingData, error: pendingError } = await supabase
        .from('tickets')
        .select(`
          *,
          created_by_profile:profiles!tickets_created_by_fkey(full_name, role)
        `)
        .eq('assigned_to', user.id)
        .eq('department', 'maintenance')
        .eq('pending_supervisor_approval', true)
        .order('updated_at', { ascending: false });

      if (pendingError) throw pendingError;
      
      const parseTickets = (data: any[]) => (data || []).map((d: any) => ({
        id: d.id,
        ticket_number: d.ticket_number,
        title: d.title,
        description: d.description,
        room_number: d.room_number,
        priority: d.priority,
        status: d.status,
        created_at: d.created_at,
        updated_at: d.updated_at,
        hotel: d.hotel,
        sla_due_date: d.sla_due_date,
        on_hold: d.on_hold,
        hold_reason: d.hold_reason,
        pending_supervisor_approval: d.pending_supervisor_approval,
        created_by_profile: d.created_by_profile,
        completion_photos: d.completion_photos,
        resolution_text: d.resolution_text,
      }));
      
      // Sort by priority
      const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
      const active = parseTickets(activeData);
      active.sort((a, b) => (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4));
      
      setActiveTickets(active);
      setPendingApprovalTickets(parseTickets(pendingData));
    } catch (error) {
      console.error('Error fetching tickets:', error);
      toast.error('Failed to load maintenance tasks');
    } finally {
      setLoading(false);
    }
  };

  const fetchCompletedTickets = async (date: Date) => {
    if (!user?.id) return;
    
    try {
      const dateStr = format(date, 'yyyy-MM-dd');
      const nextDay = format(new Date(date.getTime() + 86400000), 'yyyy-MM-dd');
      
      const { data, error } = await supabase
        .from('tickets')
        .select(`
          *,
          created_by_profile:profiles!tickets_created_by_fkey(full_name, role)
        `)
        .eq('assigned_to', user.id)
        .eq('department', 'maintenance')
        .eq('status', 'completed')
        .gte('closed_at', dateStr)
        .lt('closed_at', nextDay)
        .order('closed_at', { ascending: false });

      if (error) throw error;
      setCompletedTickets(data || []);
    } catch (error) {
      console.error('Error fetching completed tickets:', error);
    }
  };

  const fetchDatesWithJobs = async () => {
    if (!user?.id) return;
    
    try {
      // Get the last 60 days of completed tickets
      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
      
      const { data, error } = await supabase
        .from('tickets')
        .select('closed_at')
        .eq('assigned_to', user.id)
        .eq('department', 'maintenance')
        .eq('status', 'completed')
        .gte('closed_at', sixtyDaysAgo.toISOString())
        .not('closed_at', 'is', null);

      if (error) throw error;
      
      const dates = (data || []).map(d => new Date(d.closed_at));
      setDatesWithJobs(dates);
    } catch (error) {
      console.error('Error fetching dates with jobs:', error);
    }
  };

  useEffect(() => {
    fetchAssignedTickets();
    fetchDatesWithJobs();
    
    // Set up real-time subscription
    const channel = supabase
      .channel('maintenance-tickets')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tickets',
          filter: `assigned_to=eq.${user?.id}`,
        },
        () => {
          fetchAssignedTickets();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  useEffect(() => {
    if (historyDialogOpen) {
      fetchCompletedTickets(selectedDate);
    }
  }, [selectedDate, historyDialogOpen]);

  const handleStartWork = async (ticket: MaintenanceTicket) => {
    try {
      const { error } = await supabase
        .from('tickets')
        .update({ 
          status: 'in_progress', 
          on_hold: false,
          hold_reason: null,
          updated_at: new Date().toISOString() 
        })
        .eq('id', ticket.id);

      if (error) throw error;
      toast.success(getText('workStarted'));
      fetchAssignedTickets();
    } catch (error) {
      console.error('Error starting work:', error);
      toast.error('Failed to start work');
    }
  };

  const handleAddNote = async () => {
    if (!selectedTicket || !note.trim()) return;
    
    try {
      const { error } = await supabase
        .from('comments')
        .insert({
          ticket_id: selectedTicket.id,
          user_id: user?.id,
          content: note,
        });

      if (error) throw error;
      toast.success(getText('noteAdded'));
      setNote('');
      setNoteDialogOpen(false);
    } catch (error) {
      console.error('Error adding note:', error);
      toast.error('Failed to add note');
    }
  };

  const handlePutOnHold = async () => {
    if (!selectedTicket || !holdReason) {
      toast.error(language === 'hu' ? 'Kérjük, válasszon okot' : 'Please select a reason');
      return;
    }
    
    try {
      const reasonLabel = HOLD_REASONS.find(r => r.value === holdReason)?.[language === 'hu' ? 'labelHu' : 'labelEn'] || holdReason;
      
      // Update ticket with hold status
      const { error: updateError } = await supabase
        .from('tickets')
        .update({
          on_hold: true,
          hold_reason: holdReason,
          updated_at: new Date().toISOString()
        })
        .eq('id', selectedTicket.id);

      if (updateError) throw updateError;

      // Add a comment with the hold reason
      await supabase
        .from('comments')
        .insert({
          ticket_id: selectedTicket.id,
          user_id: user?.id,
          content: `🔒 ${getText('putOnHold')}: ${reasonLabel}`,
        });

      toast.success(getText('ticketOnHold'));
      setHoldReason('');
      setHoldDialogOpen(false);
      fetchAssignedTickets();
    } catch (error) {
      console.error('Error putting ticket on hold:', error);
      toast.error('Failed to put ticket on hold');
    }
  };

  const handleRemoveHold = async (ticket: MaintenanceTicket) => {
    try {
      const { error } = await supabase
        .from('tickets')
        .update({
          on_hold: false,
          hold_reason: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', ticket.id);

      if (error) throw error;

      // Add a comment
      await supabase
        .from('comments')
        .insert({
          ticket_id: ticket.id,
          user_id: user?.id,
          content: `🔓 ${getText('removeHold')}`,
        });

      toast.success(getText('holdRemoved'));
      fetchAssignedTickets();
    } catch (error) {
      console.error('Error removing hold:', error);
      toast.error('Failed to remove hold');
    }
  };

  const handleReopenCase = async (ticket: MaintenanceTicket) => {
    try {
      const { error } = await supabase
        .from('tickets')
        .update({
          pending_supervisor_approval: false,
          status: 'in_progress',
          updated_at: new Date().toISOString()
        })
        .eq('id', ticket.id);

      if (error) throw error;

      // Add a comment
      await supabase
        .from('comments')
        .insert({
          ticket_id: ticket.id,
          user_id: user?.id,
          content: `🔄 ${getText('reopenCase')}`,
        });

      toast.success(getText('caseReopened'));
      fetchAssignedTickets();
    } catch (error) {
      console.error('Error reopening case:', error);
      toast.error('Failed to reopen case');
    }
  };

  const startCamera = async () => {
    try {
      setIsCapturing(true);
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (error) {
      console.error('Error accessing camera:', error);
      toast.error('Failed to access camera');
      setIsCapturing(false);
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      setCapturedPhoto(dataUrl);
      stopCamera();
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCapturing(false);
  };

  const handleCompleteTicket = async () => {
    if (!selectedTicket || !resolution.trim()) {
      toast.error(language === 'hu' ? 'Kérjük, adja meg a megoldás leírását' : 'Please provide a resolution description');
      return;
    }
    
    if (!capturedPhoto) {
      toast.error(language === 'hu' ? 'Kérjük, készítsen fotót a befejezett munkáról' : 'Please take a photo of the completed work');
      return;
    }
    
    try {
      // Upload the photo
      const photoBlob = await fetch(capturedPhoto).then(r => r.blob());
      const fileName = `maintenance-completion/${selectedTicket.id}-${Date.now()}.jpg`;
      
      const { error: uploadError } = await supabase.storage
        .from('ticket-attachments')
        .upload(fileName, photoBlob);
      
      if (uploadError) {
        console.error('Upload error:', uploadError);
        // Continue without photo if upload fails
      }
      
      const { data: urlData } = supabase.storage
        .from('ticket-attachments')
        .getPublicUrl(fileName);
      
      const photoUrl = urlData?.publicUrl;
      
      // Update ticket - set pending_supervisor_approval to true
      const { error } = await supabase
        .from('tickets')
        .update({
          status: 'in_progress',
          resolution_text: resolution,
          pending_supervisor_approval: true,
          on_hold: false,
          hold_reason: null,
          completion_photos: photoUrl ? [photoUrl] : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedTicket.id);

      if (error) throw error;
      toast.success(getText('taskCompleted'));
      setResolution('');
      setCapturedPhoto(null);
      setCompleteDialogOpen(false);
      fetchAssignedTickets();
    } catch (error) {
      console.error('Error completing ticket:', error);
      toast.error('Failed to complete task');
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-500 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'medium': return 'bg-yellow-500 text-black';
      case 'low': return 'bg-green-500 text-white';
      default: return 'bg-gray-500 text-white';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-blue-100 text-blue-800';
      case 'in_progress': return 'bg-amber-100 text-amber-800';
      case 'completed': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getSlaInfo = (ticket: MaintenanceTicket) => {
    const createdAt = new Date(ticket.created_at);
    const slaHours = SLA_HOURS[ticket.priority] || 72;
    const dueDate = addHours(createdAt, slaHours);
    const now = new Date();
    const isOverdue = isBefore(dueDate, now);
    const hoursRemaining = differenceInHours(dueDate, now);
    const minutesRemaining = differenceInMinutes(dueDate, now) % 60;
    
    return { dueDate, isOverdue, hoursRemaining, minutesRemaining };
  };

  const summary = {
    total: activeTickets.length + pendingApprovalTickets.length,
    open: activeTickets.filter(t => t.status === 'open').length,
    inProgress: activeTickets.filter(t => t.status === 'in_progress' && !t.on_hold).length,
    onHold: activeTickets.filter(t => t.on_hold).length,
    pendingApproval: pendingApprovalTickets.length,
  };

  // Check if a date has jobs
  const hasJobsOnDate = (date: Date) => {
    return datesWithJobs.some(d => 
      d.getFullYear() === date.getFullYear() &&
      d.getMonth() === date.getMonth() &&
      d.getDate() === date.getDate()
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Wrench className="h-6 w-6" />
            {getText('myTasks')}
          </h2>
          <p className="text-muted-foreground">{getText('tasksAssigned')}</p>
        </div>
        <Button variant="outline" onClick={() => setHistoryDialogOpen(true)}>
          <CalendarIcon className="h-4 w-4 mr-2" />
          {getText('viewHistory')}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="bg-primary/5">
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold">{summary.total}</p>
            <p className="text-xs text-muted-foreground">{getText('total')}</p>
          </CardContent>
        </Card>
        <Card className="bg-blue-50">
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-blue-600">{summary.open}</p>
            <p className="text-xs text-muted-foreground">{getText('open')}</p>
          </CardContent>
        </Card>
        <Card className="bg-amber-50">
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-amber-600">{summary.inProgress}</p>
            <p className="text-xs text-muted-foreground">{getText('inProgress')}</p>
          </CardContent>
        </Card>
        <Card className="bg-orange-50">
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-orange-600">{summary.onHold}</p>
            <p className="text-xs text-muted-foreground">{getText('onHold')}</p>
          </CardContent>
        </Card>
        <Card className="bg-purple-50">
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-purple-600">{summary.pendingApproval}</p>
            <p className="text-xs text-muted-foreground">{getText('pendingApproval')}</p>
          </CardContent>
        </Card>
      </div>

      {/* Active Tasks */}
      {activeTickets.length === 0 && pendingApprovalTickets.length === 0 ? (
        <Card className="p-8 text-center">
          <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-4" />
          <h3 className="text-lg font-semibold">{getText('allDone')}</h3>
          <p className="text-muted-foreground">{getText('noTasks')}</p>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Active Tickets Section */}
          {activeTickets.length > 0 && (
            <div className="space-y-4">
              {activeTickets.map((ticket) => {
                const slaInfo = getSlaInfo(ticket);
                const isOnHold = ticket.on_hold;
                
                return (
                  <Card 
                    key={ticket.id} 
                    className={`overflow-hidden border-l-4 ${isOnHold ? 'bg-orange-50/50 border-l-orange-500' : ''}`}
                    style={{ borderLeftColor: isOnHold ? undefined : (ticket.priority === 'urgent' ? '#ef4444' : ticket.priority === 'high' ? '#f97316' : ticket.priority === 'medium' ? '#eab308' : '#22c55e') }}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="font-mono">
                              {getText('room')} {ticket.room_number}
                            </Badge>
                            <Badge className={getPriorityColor(ticket.priority)}>
                              {ticket.priority.toUpperCase()}
                            </Badge>
                            {isOnHold ? (
                              <Badge className="bg-orange-500 text-white">
                                <Pause className="h-3 w-3 mr-1" />
                                {getText('onHold')}
                              </Badge>
                            ) : (
                              <Badge className={getStatusColor(ticket.status)}>
                                {ticket.status === 'in_progress' ? getText('inProgress') : getText(ticket.status)}
                              </Badge>
                            )}
                          </div>
                          <CardTitle className="text-lg">{ticket.title}</CardTitle>
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          #{ticket.ticket_number}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm text-muted-foreground">{ticket.description}</p>
                      
                      {/* Hold Reason Display */}
                      {isOnHold && ticket.hold_reason && (
                        <div className="p-3 rounded-lg bg-orange-100 border border-orange-300 flex items-start gap-3">
                          <Pause className="h-5 w-5 text-orange-600 mt-0.5" />
                          <div>
                            <p className="text-sm font-medium text-orange-800">{getText('holdReason')}:</p>
                            <p className="text-sm text-orange-700">{getHoldReasonLabel(ticket.hold_reason)}</p>
                          </div>
                        </div>
                      )}
                      
                      {/* SLA Info */}
                      {!isOnHold && (
                        <div className={`p-3 rounded-lg flex items-center gap-3 ${slaInfo.isOverdue ? 'bg-red-100 border border-red-300' : 'bg-blue-50 border border-blue-200'}`}>
                          <Timer className={`h-5 w-5 ${slaInfo.isOverdue ? 'text-red-600' : 'text-blue-600'}`} />
                          <div>
                            <p className={`text-sm font-medium ${slaInfo.isOverdue ? 'text-red-700' : 'text-blue-700'}`}>
                              {slaInfo.isOverdue ? getText('slaOverdue') : getText('slaDue')}
                            </p>
                            <p className={`text-xs ${slaInfo.isOverdue ? 'text-red-600' : 'text-blue-600'}`}>
                              {slaInfo.isOverdue 
                                ? `${Math.abs(slaInfo.hoursRemaining)}h ${Math.abs(slaInfo.minutesRemaining)}m ago`
                                : `${slaInfo.hoursRemaining}h ${slaInfo.minutesRemaining}m remaining`
                              }
                            </p>
                          </div>
                        </div>
                      )}
                      
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <CalendarIcon className="h-3 w-3" />
                          {format(new Date(ticket.created_at), 'MMM d, yyyy HH:mm')}
                        </span>
                        {ticket.created_by_profile && (
                          <span>{getText('reportedBy')}: {ticket.created_by_profile.full_name}</span>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {/* Show Remove Hold button if on hold */}
                        {isOnHold && (
                          <Button
                            size="sm"
                            onClick={() => handleRemoveHold(ticket)}
                            className="flex items-center gap-1 bg-orange-600 hover:bg-orange-700"
                          >
                            <Play className="h-4 w-4" />
                            {getText('removeHold')}
                          </Button>
                        )}
                        
                        {ticket.status === 'open' && !isOnHold && (
                          <Button
                            size="sm"
                            onClick={() => handleStartWork(ticket)}
                            className="flex items-center gap-1"
                          >
                            <Play className="h-4 w-4" />
                            {getText('startWork')}
                          </Button>
                        )}
                        
                        {ticket.status === 'in_progress' && !isOnHold && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedTicket(ticket);
                                setNoteDialogOpen(true);
                              }}
                              className="flex items-center gap-1"
                            >
                              <MessageSquare className="h-4 w-4" />
                              {getText('addNote')}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedTicket(ticket);
                                setHoldDialogOpen(true);
                              }}
                              className="flex items-center gap-1"
                            >
                              <Pause className="h-4 w-4" />
                              {getText('putOnHold')}
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => {
                                setSelectedTicket(ticket);
                                setCompleteDialogOpen(true);
                              }}
                              className="flex items-center gap-1 bg-green-600 hover:bg-green-700"
                            >
                              <CheckCircle className="h-4 w-4" />
                              {getText('markComplete')}
                            </Button>
                          </>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Pending Approval Section */}
          {pendingApprovalTickets.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Hourglass className="h-5 w-5 text-purple-600" />
                <h3 className="text-lg font-semibold">{getText('pendingApproval')}</h3>
                <Badge className="bg-purple-100 text-purple-800">{pendingApprovalTickets.length}</Badge>
              </div>
              
              {pendingApprovalTickets.map((ticket) => (
                <Card key={ticket.id} className="overflow-hidden border-l-4 border-l-purple-500 bg-purple-50/30">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="font-mono">
                            {getText('room')} {ticket.room_number}
                          </Badge>
                          <Badge className={getPriorityColor(ticket.priority)}>
                            {ticket.priority.toUpperCase()}
                          </Badge>
                          <Badge className="bg-purple-500 text-white">
                            <Hourglass className="h-3 w-3 mr-1" />
                            {getText('pendingApproval')}
                          </Badge>
                        </div>
                        <CardTitle className="text-lg">{ticket.title}</CardTitle>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        #{ticket.ticket_number}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="p-3 rounded-lg bg-purple-100 border border-purple-300 flex items-start gap-3">
                      <Hourglass className="h-5 w-5 text-purple-600 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-purple-800">{getText('awaitingManagerReview')}</p>
                        {ticket.resolution_text && (
                          <p className="text-sm text-purple-700 mt-1">{getText('resolution')}: {ticket.resolution_text}</p>
                        )}
                      </div>
                    </div>
                    
                    {/* Show completion photo if exists */}
                    {ticket.completion_photos && ticket.completion_photos.length > 0 && (
                      <div className="flex gap-2">
                        {ticket.completion_photos.map((photo, idx) => (
                          <img 
                            key={idx} 
                            src={photo} 
                            alt="Completion" 
                            className="w-20 h-20 object-cover rounded-lg border"
                          />
                        ))}
                      </div>
                    )}
                    
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleReopenCase(ticket)}
                        className="flex items-center gap-1"
                      >
                        <RotateCcw className="h-4 w-4" />
                        {getText('reopenCase')}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add Note Dialog */}
      <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{getText('addNote')} - {selectedTicket?.title}</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder={language === 'hu' ? 'Adja meg a jegyzetét...' : 'Enter your note or update...'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteDialogOpen(false)}>
              {getText('cancel')}
            </Button>
            <Button onClick={handleAddNote} disabled={!note.trim()}>
              {getText('saveNote')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hold Dialog */}
      <Dialog open={holdDialogOpen} onOpenChange={setHoldDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{getText('putOnHold')} - {selectedTicket?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">{getText('holdReason')}</label>
              <Select value={holdReason} onValueChange={setHoldReason}>
                <SelectTrigger>
                  <SelectValue placeholder={getText('selectReason')} />
                </SelectTrigger>
                <SelectContent>
                  {HOLD_REASONS.map((reason) => (
                    <SelectItem key={reason.value} value={reason.value}>
                      {language === 'hu' ? reason.labelHu : reason.labelEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHoldDialogOpen(false)}>
              {getText('cancel')}
            </Button>
            <Button onClick={handlePutOnHold} disabled={!holdReason}>
              {getText('confirmHold')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complete Dialog */}
      <Dialog open={completeDialogOpen} onOpenChange={(open) => {
        if (!open) stopCamera();
        setCompleteDialogOpen(open);
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{getText('completeTask')} - {selectedTicket?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Photo Capture */}
            <div>
              <label className="text-sm font-medium flex items-center gap-2">
                <Camera className="h-4 w-4" />
                {getText('completionPhoto')} *
              </label>
              <p className="text-xs text-muted-foreground mb-2">{getText('photoRequired')}</p>
              
              {isCapturing ? (
                <div className="space-y-2">
                  <video 
                    ref={videoRef} 
                    autoPlay 
                    playsInline 
                    className="w-full rounded-lg bg-black"
                  />
                  <div className="flex gap-2">
                    <Button onClick={capturePhoto} className="flex-1">
                      <Camera className="h-4 w-4 mr-2" />
                      {getText('capturing')}
                    </Button>
                    <Button variant="outline" onClick={stopCamera}>
                      {getText('cancel')}
                    </Button>
                  </div>
                </div>
              ) : capturedPhoto ? (
                <div className="space-y-2">
                  <img src={capturedPhoto} alt="Completion" className="w-full rounded-lg" />
                  <Button variant="outline" onClick={() => {
                    setCapturedPhoto(null);
                    startCamera();
                  }} className="w-full">
                    {getText('retakePhoto')}
                  </Button>
                </div>
              ) : (
                <Button onClick={startCamera} variant="outline" className="w-full">
                  <Camera className="h-4 w-4 mr-2" />
                  {getText('takePhoto')}
                </Button>
              )}
            </div>
            
            <div>
              <label className="text-sm font-medium">{getText('resolution')} *</label>
              <Textarea
                placeholder={getText('resolutionPlaceholder')}
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                rows={4}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {getText('awaitingApproval')}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteDialogOpen(false)}>
              {getText('cancel')}
            </Button>
            <Button 
              onClick={handleCompleteTicket} 
              disabled={!resolution.trim() || !capturedPhoto} 
              className="bg-green-600 hover:bg-green-700"
            >
              {getText('submitApproval')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History Dialog */}
      <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{getText('history')}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => date && setSelectedDate(date)}
                modifiers={{
                  hasJobs: (date) => hasJobsOnDate(date)
                }}
                modifiersStyles={{
                  hasJobs: { 
                    fontWeight: 'bold',
                    position: 'relative',
                  }
                }}
                components={{
                  DayContent: ({ date }) => (
                    <div className="relative">
                      {date.getDate()}
                      {hasJobsOnDate(date) && (
                        <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-primary" />
                      )}
                    </div>
                  )
                }}
              />
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              <h4 className="font-medium">{format(selectedDate, 'PPP')}</h4>
              {completedTickets.length === 0 ? (
                <p className="text-sm text-muted-foreground">{getText('noJobsOnDate')}</p>
              ) : (
                completedTickets.map((ticket) => (
                  <Card key={ticket.id} className="p-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium text-sm">{ticket.title}</p>
                        <p className="text-xs text-muted-foreground">{getText('room')} {ticket.room_number}</p>
                      </div>
                      <Badge className={getPriorityColor(ticket.priority)} variant="outline">
                        {ticket.priority}
                      </Badge>
                    </div>
                    {ticket.resolution_text && (
                      <p className="text-xs mt-2 text-muted-foreground">{ticket.resolution_text}</p>
                    )}
                  </Card>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
