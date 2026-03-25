import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { UI_HINTS } from '@/lib/ui-hints';
import { getSignedPhotoUrls } from '@/lib/storageUrls';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import { 
  CheckCircle, 
  RefreshCw, 
  Clock, 
  User,
  MapPin,
  AlertTriangle,
  History,
  Wrench,
  Camera,
  FileText,
  Building2,
  ChevronDown,
  ChevronRight,
  Zap,
  TrendingUp,
  TrendingDown,
  Timer,
  CheckCheck,
  Layers,
  BedDouble,
  DoorClosed,
  Globe,
  Loader2 as LucideLoader,
  MessageSquare
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/hooks/useTranslation';
import { useNotifications } from '@/hooks/useNotifications';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { CompletionDataView } from './CompletionDataView';
import { ApprovalHistoryView } from './ApprovalHistoryView';

interface LinenSummaryItem {
  display_name: string;
  count: number;
}

interface PendingAssignment {
  id: string;
  room_id: string;
  assignment_type: 'daily_cleaning' | 'checkout_cleaning' | 'maintenance' | 'deep_cleaning';
  status: string;
  priority: number;
  estimated_duration: number;
  notes: string;
  completed_at: string;
  started_at: string | null;
  supervisor_approved: boolean;
  assigned_to: string;
  assignment_date: string;
  completion_photos?: string[] | null;
  rooms: {
    room_number: string;
    hotel: string;
    status: string;
    room_name: string | null;
    floor_number: number | null;
    towel_change_required?: boolean;
    linen_change_required?: boolean;
    guest_nights_stayed?: number;
    bed_configuration?: string | null;
    is_dnd?: boolean;
    dnd_marked_at?: string | null;
  } | null;
  profiles: {
    full_name: string;
    nickname: string;
  } | null;
}

interface Staff {
  id: string;
  full_name: string;
  nickname: string;
  role: string;
}

// Speed benchmark thresholds in minutes
const BENCHMARKS = {
  daily_cleaning: { fast: 8, normalMax: 45, slow: 45 },
  checkout_cleaning: { fast: 20, normalMax: 120, slow: 120 },
  deep_cleaning: { fast: 30, normalMax: 180, slow: 180 },
  maintenance: { fast: 5, normalMax: 60, slow: 60 },
};

function getSpeedIndicator(type: string, durationMinutes: number) {
  const bench = BENCHMARKS[type as keyof typeof BENCHMARKS] || BENCHMARKS.daily_cleaning;
  if (durationMinutes < bench.fast) {
    return { label: 'Suspiciously Fast', color: 'text-red-700 bg-red-100 border-red-300', icon: Zap, severity: 'warning' };
  }
  if (durationMinutes <= bench.normalMax) {
    return { label: 'Normal', color: 'text-green-700 bg-green-100 border-green-300', icon: TrendingUp, severity: 'ok' };
  }
  return { label: 'Very Slow', color: 'text-orange-700 bg-orange-100 border-orange-300', icon: TrendingDown, severity: 'warning' };
}

function getDurationMinutes(startedAt: string | null, completedAt: string): number {
  if (!startedAt) return 0;
  return Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 60000);
}

function getMinutesSince(dateStr: string): number {
  return Math.round((Date.now() - new Date(dateStr).getTime()) / 60000);
}

export function SupervisorApprovalView() {
  const { t, language } = useTranslation();
  const { showNotification } = useNotifications();
  const [pendingAssignments, setPendingAssignments] = useState<PendingAssignment[]>([]);
  const [pendingMaintenanceTickets, setPendingMaintenanceTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [staff, setStaff] = useState<Staff[]>([]);
  const [maintenanceStaff, setMaintenanceStaff] = useState<{ id: string; full_name: string; role: string }[]>([]);
  const [reassignDialogOpen, setReassignDialogOpen] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<string | null>(null);
  const [selectedHousekeeper, setSelectedHousekeeper] = useState<string>('');
  const [earlySignoutRequests, setEarlySignoutRequests] = useState<any[]>([]);
  const [signedPhotoUrls, setSignedPhotoUrls] = useState<{ [ticketId: string]: string[] }>({});
  const [completionPhotoUrls, setCompletionPhotoUrls] = useState<{ [assignmentId: string]: string[] }>({});
  const [linenSummaries, setLinenSummaries] = useState<{ [assignmentId: string]: LinenSummaryItem[] }>({});
  const [bulkApproving, setBulkApproving] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [collapsedHotels, setCollapsedHotels] = useState<Set<string>>(new Set());
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [housekeeperNotes, setHousekeeperNotes] = useState<Record<string, any[]>>({});
  const [translatedApprovalMsgs, setTranslatedApprovalMsgs] = useState<Record<string, string>>({});
  const [translatingApprovalMsg, setTranslatingApprovalMsg] = useState<string | null>(null);
  // Group assignments by hotel
  const hotelGroups = useMemo(() => {
    const groups: Record<string, PendingAssignment[]> = {};
    for (const a of pendingAssignments) {
      const hotel = a.rooms?.hotel || 'Unknown';
      if (!groups[hotel]) groups[hotel] = [];
      groups[hotel].push(a);
    }
    return groups;
  }, [pendingAssignments]);

  // Summary stats
  const summaryStats = useMemo(() => {
    const hotelCounts = Object.entries(hotelGroups).map(([hotel, items]) => ({ hotel, count: items.length }));
    const roomCount = pendingAssignments.length;
    const maintenanceCount = pendingMaintenanceTickets.length;
    const earlySignoutCount = earlySignoutRequests.length;
    const totalCount = roomCount + maintenanceCount + earlySignoutCount;

    // Find oldest pending
    let oldestMinutes = 0;
    for (const a of pendingAssignments) {
      const mins = getMinutesSince(a.completed_at);
      if (mins > oldestMinutes) oldestMinutes = mins;
    }
    for (const t of pendingMaintenanceTickets) {
      const mins = getMinutesSince(t.created_at);
      if (mins > oldestMinutes) oldestMinutes = mins;
    }

    // Count flagged items (suspiciously fast or very slow)
    let flaggedCount = 0;
    for (const a of pendingAssignments) {
      if (a.started_at) {
        const dur = getDurationMinutes(a.started_at, a.completed_at);
        const indicator = getSpeedIndicator(a.assignment_type, dur);
        if (indicator.severity === 'warning') flaggedCount++;
      }
    }

    return { hotelCounts, roomCount, maintenanceCount, earlySignoutCount, totalCount, oldestMinutes, flaggedCount };
  }, [hotelGroups, pendingAssignments, pendingMaintenanceTickets, earlySignoutRequests]);

  useEffect(() => {
    fetchPendingAssignments();
    fetchStaff();
    fetchPendingMaintenanceTickets();
    
    const channel = supabase
      .channel('supervisor-assignments')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_assignments',
          filter: 'status=eq.completed'
        },
        (payload) => {
          fetchPendingAssignments();
          if (payload.eventType === 'INSERT' || (payload.eventType === 'UPDATE' && payload.new.status === 'completed' && payload.old.status !== 'completed')) {
            showNotification(t('notifications.newCompletion'), 'info');
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedDate, showNotification, t]);

  const fetchStaff = async () => {
    try {
      const { data: currentUser } = await supabase.auth.getUser();
      if (!currentUser.user) return;

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role, assigned_hotel')
        .eq('id', currentUser.user.id)
        .single();

      if (profileError) throw profileError;

      const { data, error } = await supabase.rpc('get_assignable_staff_secure', {
        requesting_user_role: profile?.role
      });

      if (error) throw error;
      setStaff(data || []);

      const { data: maintStaff, error: maintError } = await supabase.rpc('get_assignable_staff', {
        hotel_filter: profile?.assigned_hotel
      });

      if (!maintError) {
        const maintenanceOnly = (maintStaff || []).filter((s: any) => s.role === 'maintenance');
        setMaintenanceStaff(maintenanceOnly);
      }
    } catch (error) {
      console.error('Error fetching staff:', error);
    }
  };

  const fetchPendingMaintenanceTickets = async () => {
    try {
      const { data: currentUser } = await supabase.auth.getUser();
      if (!currentUser.user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('organization_slug, assigned_hotel')
        .eq('id', currentUser.user.id)
        .single();

      if (!profile?.organization_slug) return;

      let query = supabase
        .from('tickets')
        .select(`
          *,
          created_by_profile:profiles!tickets_created_by_fkey(full_name, nickname),
          assigned_to_profile:profiles!tickets_assigned_to_fkey(full_name, nickname)
        `)
        .eq('pending_supervisor_approval', true)
        .eq('department', 'maintenance')
        .eq('organization_slug', profile.organization_slug)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });

      if (profile.assigned_hotel) {
        query = query.eq('hotel', profile.assigned_hotel);
      }

      const { data, error } = await query;
      if (error) throw error;
      setPendingMaintenanceTickets(data || []);
      
      loadSignedUrlsForTickets(data || []);
    } catch (error) {
      console.error('Error fetching maintenance tickets:', error);
    }
  };

  const loadSignedUrlsForTickets = async (tickets: any[]) => {
    const urlsMap: { [ticketId: string]: string[] } = {};
    
    for (const ticket of tickets) {
      if (ticket.completion_photos && ticket.completion_photos.length > 0) {
        const signedUrls = await getSignedPhotoUrls(ticket.completion_photos, 'ticket-attachments');
        if (signedUrls.length > 0) {
          urlsMap[ticket.id] = signedUrls;
        }
      }
    }
    
    setSignedPhotoUrls(prev => ({ ...prev, ...urlsMap }));
  };

  const handleApproveTicket = async (ticketId: string) => {
    setPendingMaintenanceTickets(prev => prev.filter(t => t.id !== ticketId));
    try {
      const { error } = await supabase
        .from('tickets')
        .update({
          status: 'completed',
          pending_supervisor_approval: false,
          supervisor_approved: true,
          supervisor_approved_at: new Date().toISOString(),
          supervisor_approved_by: (await supabase.auth.getUser()).data.user?.id,
          closed_at: new Date().toISOString(),
          closed_by: (await supabase.auth.getUser()).data.user?.id
        })
        .eq('id', ticketId);

      if (error) throw error;

      toast.success('Maintenance ticket approved');
      fetchPendingMaintenanceTickets();
    } catch (error) {
      console.error('Error approving ticket:', error);
      toast.error('Failed to approve ticket');
      fetchPendingMaintenanceTickets();
    }
  };

  const handleReassignTicket = async (ticketId: string, newAssigneeId: string) => {
    try {
      const { error } = await supabase
        .from('tickets')
        .update({
          assigned_to: newAssigneeId,
          pending_supervisor_approval: false,
          status: 'in_progress'
        })
        .eq('id', ticketId);

      if (error) throw error;

      toast.success('Ticket reassigned successfully');
      fetchPendingMaintenanceTickets();
    } catch (error) {
      console.error('Error reassigning ticket:', error);
      toast.error('Failed to reassign ticket');
    }
  };

  const fetchPendingAssignments = async () => {
    setLoading(true);
    try {
      const dateStr = selectedDate.toISOString().split('T')[0];
      
      const { data: currentUser } = await supabase.auth.getUser();
      if (!currentUser.user) return;

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('organization_slug')
        .eq('id', currentUser.user.id)
        .single();

      if (profileError) throw profileError;

      const userOrgSlug = profile?.organization_slug;
      if (!userOrgSlug) {
        setPendingAssignments([]);
        setEarlySignoutRequests([]);
        return;
      }
      
      const { data: assignmentData, error: assignmentError } = await supabase
        .from('room_assignments')
        .select(`
          *,
          rooms!inner (
            room_number,
            hotel,
            status,
            room_name,
            floor_number,
            towel_change_required,
            linen_change_required,
            guest_nights_stayed,
            bed_configuration,
            is_dnd,
            dnd_marked_at
          ),
          profiles!assigned_to (
            full_name,
            nickname
          )
        `)
        .eq('status', 'completed')
        .eq('supervisor_approved', false)
        .eq('assignment_date', dateStr)
        .eq('organization_slug', userOrgSlug)
        .order('completed_at', { ascending: false });

      if (assignmentError) throw assignmentError;

      const { data: earlySignoutData, error: earlySignoutError } = await supabase
        .from('early_signout_requests')
        .select(`
          id,
          user_id,
          requested_at,
          status,
          rejection_reason,
          profiles!user_id (
            full_name,
            nickname
          )
        `)
        .eq('status', 'pending')
        .eq('organization_slug', userOrgSlug)
        .order('requested_at', { ascending: false });

      if (earlySignoutError) throw earlySignoutError;
      
      setPendingAssignments(assignmentData || []);
      setEarlySignoutRequests(earlySignoutData || []);

      // Load completion photo thumbnails, dirty linen summaries, and housekeeper messages
      if (assignmentData && assignmentData.length > 0) {
        loadCompletionPhotos(assignmentData);
        loadLinenSummaries(assignmentData, dateStr);
        loadHousekeeperNotes(assignmentData);
      }
    } catch (error) {
      console.error('Error fetching pending assignments:', error);
      toast.error('Failed to fetch pending assignments');
    } finally {
      setLoading(false);
    }
  };

  const loadCompletionPhotos = async (assignments: any[]) => {
    const urlsMap: { [id: string]: string[] } = {};
    for (const a of assignments) {
      if (a.completion_photos && a.completion_photos.length > 0) {
        const signed = await getSignedPhotoUrls(a.completion_photos, 'room-photos');
        if (signed.length > 0) urlsMap[a.id] = signed;
      }
    }
    setCompletionPhotoUrls(prev => ({ ...prev, ...urlsMap }));
  };

  const loadLinenSummaries = async (assignments: any[], dateStr: string) => {
    try {
      const roomIds = assignments.map((a: any) => a.room_id);
      const { data, error } = await supabase
        .from('dirty_linen_counts')
        .select('room_id, count, dirty_linen_items(display_name)')
        .in('room_id', roomIds)
        .eq('work_date', dateStr);
      
      if (error || !data) return;

      const summaryMap: { [assignmentId: string]: LinenSummaryItem[] } = {};
      for (const a of assignments) {
        const roomCounts = data.filter((d: any) => d.room_id === a.room_id && d.count > 0);
        if (roomCounts.length > 0) {
          summaryMap[a.id] = roomCounts.map((d: any) => ({
            display_name: (d.dirty_linen_items as any)?.display_name || 'Unknown',
            count: d.count
          }));
        }
      }
    setLinenSummaries(prev => ({ ...prev, ...summaryMap }));
    } catch (e) {
      console.error('Error loading linen summaries:', e);
    }
  };

  const loadHousekeeperNotes = async (assignments: any[]) => {
    try {
      const roomIds = assignments.map((a: any) => a.room_id);
      const { data, error } = await supabase
        .from('housekeeping_notes')
        .select('id, content, note_type, created_by, created_at, room_id, assignment_id')
        .in('room_id', roomIds)
        .eq('note_type', 'message')
        .order('created_at', { ascending: true });
      if (error || !data) return;
      const notesMap: Record<string, any[]> = {};
      for (const a of assignments) {
        const roomNotes = data.filter((d: any) => d.room_id === a.room_id);
        if (roomNotes.length > 0) notesMap[a.id] = roomNotes;
      }
      setHousekeeperNotes(prev => ({ ...prev, ...notesMap }));
    } catch (e) {
      console.error('Error loading housekeeper notes:', e);
    }
  };

  const handleTranslateApprovalMsg = async (msgId: string, text: string) => {
    setTranslatingApprovalMsg(msgId);
    try {
      const { data, error } = await supabase.functions.invoke('translate-note', {
        body: { text, targetLanguage: language }
      });
      if (error) throw error;
      setTranslatedApprovalMsgs(prev => ({ ...prev, [msgId]: data.translatedText }));
    } catch {
      toast.error('Translation failed');
    } finally {
      setTranslatingApprovalMsg(null);
    }
  };

  const calculateDuration = (startTime: string, endTime: string) => {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const diffMs = end.getTime() - start.getTime();
    const diffMins = Math.round(diffMs / (1000 * 60));
    
    const hours = Math.floor(diffMins / 60);
    const minutes = diffMins % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const handleApproval = async (assignmentId: string) => {
    const previousAssignments = [...pendingAssignments];
    setPendingAssignments(prev => prev.filter(a => a.id !== assignmentId));
    try {
      const assignment = previousAssignments.find(a => a.id === assignmentId);
      
      const updateData: any = {
        supervisor_approved: true,
        supervisor_approved_by: (await supabase.auth.getUser()).data.user?.id,
        supervisor_approved_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('room_assignments')
        .update(updateData)
        .eq('id', assignmentId);

      if (error) throw error;

      // Push status to Previo only for specific hotels with PMS integration
      if (assignment?.room_id && assignment?.rooms?.hotel) {
        const hotelValue = assignment.rooms.hotel;
        
        const { data: hotelConfigs } = await supabase
          .from('hotel_configurations')
          .select('hotel_id, hotel_name');
        
        const matchingConfig = hotelConfigs?.find(
          config => config.hotel_id === hotelValue || config.hotel_name === hotelValue
        );
        
        if (matchingConfig) {
          const { data: pmsConfig } = await supabase
            .from('pms_configurations')
            .select('is_active, pms_type, hotel_id')
            .eq('hotel_id', matchingConfig.hotel_id)
            .eq('pms_type', 'previo')
            .eq('is_active', true)
            .maybeSingle();
          
          if (pmsConfig) {
            try {
              const { data: result, error: previoError } = await supabase.functions.invoke('previo-update-room-status', {
                body: { 
                  roomId: assignment.room_id,
                  status: 'clean'
                }
              });
              
              if (previoError) {
                console.error('❌ Previo update error:', previoError);
              }
            } catch (previoError) {
              console.error('Failed to update Previo:', previoError);
            }
          }
        }
      }

      toast.success('Assignment approved successfully');
      showNotification(t('supervisor.roomMarkedClean'), 'success');
      fetchPendingAssignments();
    } catch (error) {
      console.error('Error updating assignment approval:', error);
      toast.error('Failed to update approval status');
      setPendingAssignments(previousAssignments);
    }
  };

  const handleBulkApprove = async (hotelName: string) => {
    const assignments = hotelGroups[hotelName];
    if (!assignments || assignments.length === 0) return;

    setBulkApproving(hotelName);
    setBulkProgress(0);

    const userId = (await supabase.auth.getUser()).data.user?.id;
    let approved = 0;

    for (const assignment of assignments) {
      try {
        const { error } = await supabase
          .from('room_assignments')
          .update({
            supervisor_approved: true,
            supervisor_approved_by: userId,
            supervisor_approved_at: new Date().toISOString()
          })
          .eq('id', assignment.id);

        if (!error) approved++;
      } catch (e) {
        console.error('Bulk approve error for', assignment.id, e);
      }
      setBulkProgress(Math.round(((approved) / assignments.length) * 100));
    }

    setBulkApproving(null);
    setBulkProgress(0);
    toast.success(`${approved} rooms approved for ${hotelName}`);
    fetchPendingAssignments();
  };

  const handleReassignment = async () => {
    if (!selectedAssignment || !selectedHousekeeper) return;

    try {
      const assignment = pendingAssignments.find(a => a.id === selectedAssignment);
      if (!assignment) return;

      const { data: existingAssignments, error: checkError } = await supabase
        .from('room_assignments')
        .select('id, assigned_to, status')
        .eq('room_id', assignment.room_id)
        .eq('assignment_date', assignment.assignment_date)
        .in('status', ['assigned', 'in_progress'])
        .neq('id', selectedAssignment);

      if (checkError) throw checkError;

      if (existingAssignments && existingAssignments.length > 0) {
        const { error: updateError } = await supabase
          .from('room_assignments')
          .update({
            status: 'completed',
            supervisor_approved: true,
            supervisor_approved_by: (await supabase.auth.getUser()).data.user?.id,
            supervisor_approved_at: new Date().toISOString(),
            notes: 'Reassigned to another housekeeper'
          })
          .in('id', existingAssignments.map(a => a.id));

        if (updateError) throw updateError;
      }

      const { error } = await supabase
        .from('room_assignments')
        .insert({
          room_id: assignment.room_id,
          assigned_to: selectedHousekeeper,
          assigned_by: (await supabase.auth.getUser()).data.user?.id,
          assignment_date: assignment.assignment_date,
          assignment_type: assignment.assignment_type,
          estimated_duration: assignment.estimated_duration,
          priority: assignment.priority,
          notes: `Reassigned - Previous completion needs review`
        });

      if (error) throw error;

      await supabase
        .from('room_assignments')
        .update({
          supervisor_approved: true,
          supervisor_approved_by: (await supabase.auth.getUser()).data.user?.id,
          supervisor_approved_at: new Date().toISOString()
        })
        .eq('id', selectedAssignment);

      toast.success('Room reassigned successfully');
      fetchPendingAssignments();
      setReassignDialogOpen(false);
      setSelectedAssignment(null);
      setSelectedHousekeeper('');
    } catch (error) {
      console.error('Error reassigning room:', error);
      toast.error('Failed to reassign room');
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

  const toggleHotelCollapse = (hotel: string) => {
    setCollapsedHotels(prev => {
      const next = new Set(prev);
      if (next.has(hotel)) next.delete(hotel);
      else next.add(hotel);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }


  const toggleCardExpand = (id: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderAssignmentCard = (assignment: PendingAssignment) => {
    const durationMins = getDurationMinutes(assignment.started_at, assignment.completed_at);
    const speedIndicator = assignment.started_at ? getSpeedIndicator(assignment.assignment_type, durationMins) : null;
    const SpeedIcon = speedIndicator?.icon || Timer;
    const isExpanded = expandedCards.has(assignment.id);
    const hasDetails = !!(
      completionPhotoUrls[assignment.id]?.length ||
      linenSummaries[assignment.id]?.length ||
      assignment.rooms?.bed_configuration ||
      assignment.rooms?.is_dnd
    );

    return (
      <Card key={assignment.id} className={`border shadow-sm hover:shadow-md transition-all duration-200 ${
        speedIndicator?.severity === 'warning' ? 'border-l-4 border-l-orange-400' : 'border-l-4 border-l-green-400'
      }`}>
        <CardContent className="p-3 sm:p-4 space-y-2">
          {/* Compact Header: Room + Type + Speed + Actions */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="text-base font-bold text-foreground">
                Room {assignment.rooms?.room_number || 'N/A'}
              </span>
              <Badge variant="outline" className="bg-muted text-foreground border-border text-[10px] px-1.5 py-0">
                {getAssignmentTypeLabel(assignment.assignment_type)}
              </Badge>
              {speedIndicator && (
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${speedIndicator.color}`}>
                  <SpeedIcon className="h-3 w-3 mr-0.5" />
                  {speedIndicator.label}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                onClick={() => handleApproval(assignment.id)}
                className="bg-green-600 hover:bg-green-700 text-white h-7 px-2 text-xs"
                size="sm"
              >
                <CheckCircle className="h-3.5 w-3.5 mr-1" />
                Approve
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedAssignment(assignment.id);
                  setReassignDialogOpen(true);
                }}
                className="h-7 px-2 text-xs"
                size="sm"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Single-line summary: Cleaned by · Duration · Started */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
            <User className="h-3 w-3 shrink-0" />
            <span className="font-semibold text-foreground">{assignment.profiles?.full_name || 'Unknown'}</span>
            <span>·</span>
            {assignment.started_at ? (
              <>
                <Timer className={`h-3 w-3 shrink-0 ${speedIndicator?.severity === 'warning' ? 'text-orange-600' : 'text-green-600'}`} />
                <span className={`font-bold ${speedIndicator?.severity === 'warning' ? 'text-orange-700' : 'text-green-700'}`}>
                  {calculateDuration(assignment.started_at, assignment.completed_at)}
                </span>
                <span>·</span>
                <span>Started {new Date(assignment.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </>
            ) : (
              <span>Duration N/A</span>
            )}
          </div>

          {/* Special Requirements - always visible when present */}
          {(assignment.rooms?.towel_change_required || assignment.rooms?.linen_change_required) && (
            <div className="flex flex-wrap gap-1.5">
              {assignment.rooms.towel_change_required && (
                <Badge className="bg-blue-500 text-white text-[10px] px-1.5 py-0.5">
                  🏺 Towel Change
                </Badge>
              )}
              {assignment.rooms.linen_change_required && (
                <Badge className="bg-purple-500 text-white text-[10px] px-1.5 py-0.5">
                  🛏️ Linen Change
                </Badge>
              )}
            </div>
          )}

          {/* No Service Badge */}
          {assignment.notes?.includes('[NO_SERVICE]') && (
            <Badge className="bg-gray-500 text-white text-[10px] px-1.5 py-0.5">
              🚫 {t('housekeeping.noServiceBadge') || 'No Service'}
            </Badge>
          )}

          {/* Notes - always visible when present */}
          {assignment.notes && (
            <div className={`p-2 rounded-md border flex items-start gap-1.5 ${
              assignment.notes.includes('[NO_SERVICE]')
                ? 'bg-gray-50 border-gray-300 dark:bg-gray-900/30 dark:border-gray-600'
                : 'bg-amber-50 border-amber-200'
            }`}>
              <AlertTriangle className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${
                assignment.notes.includes('[NO_SERVICE]') ? 'text-gray-500' : 'text-amber-600'
              }`} />
              <p className={`text-xs ${
                assignment.notes.includes('[NO_SERVICE]') ? 'text-gray-700 dark:text-gray-300' : 'text-amber-800'
              }`}>{assignment.notes}</p>
            </div>
          )}

          {/* Expandable Details */}
          {hasDetails && (
            <div>
              <button
                onClick={() => toggleCardExpand(assignment.id)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Details
              </button>

              {isExpanded && (
                <div className="mt-2 space-y-2 pl-4 border-l-2 border-muted">
                  {/* DND & Bed Config */}
                  <div className="flex flex-wrap gap-1.5">
                    {assignment.rooms?.is_dnd && (
                      <Badge className="text-[10px] bg-orange-100 text-orange-800 border border-orange-300 px-1.5 py-0">
                        DND
                      </Badge>
                    )}
                    {assignment.rooms?.bed_configuration && (
                      <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200 px-1.5 py-0">
                        <BedDouble className="h-3 w-3 mr-0.5" />
                        {assignment.rooms.bed_configuration}
                      </Badge>
                    )}
                    {assignment.rooms?.floor_number && (
                      <Badge variant="outline" className="text-[10px] bg-muted px-1.5 py-0">
                        F{assignment.rooms.floor_number}
                      </Badge>
                    )}
                  </div>

                  {/* Start/Complete times */}
                  <div className="text-xs text-muted-foreground">
                    Started: {assignment.started_at ? new Date(assignment.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                    {' · '}
                    Completed: {new Date(assignment.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>

                  {/* Photos */}
                  {completionPhotoUrls[assignment.id] && completionPhotoUrls[assignment.id].length > 0 && (
                    <div className="flex items-center gap-1.5">
                      {completionPhotoUrls[assignment.id].slice(0, 4).map((url, idx) => (
                        <img
                          key={idx}
                          src={url}
                          alt={`Photo ${idx + 1}`}
                          className="h-10 w-10 rounded object-cover border border-border"
                        />
                      ))}
                      {completionPhotoUrls[assignment.id].length > 4 && (
                        <div className="h-10 w-10 rounded bg-muted flex items-center justify-center text-[10px] font-semibold text-muted-foreground border border-border">
                          +{completionPhotoUrls[assignment.id].length - 4}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Linen */}
                  {linenSummaries[assignment.id] && linenSummaries[assignment.id].length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] text-muted-foreground">🧺 Linen:</span>
                      {linenSummaries[assignment.id].map((item, idx) => (
                        <Badge key={idx} variant="outline" className="text-[10px] bg-muted/50 px-1 py-0">
                          {item.display_name}: {item.count}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Completion Data */}
                  <CompletionDataView
                    assignmentId={assignment.id}
                    roomId={assignment.room_id}
                    assignmentDate={assignment.assignment_date}
                    housekeeperId={assignment.assigned_to}
                  />
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  {/* Reassign Dialog - shared */}
  const renderReassignDialog = () => (
    <Dialog 
      open={reassignDialogOpen} 
      onOpenChange={(open) => {
        setReassignDialogOpen(open);
        if (!open) {
          setSelectedAssignment(null);
          setSelectedHousekeeper('');
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('supervisor.reassignRoomTitle')} {pendingAssignments.find(a => a.id === selectedAssignment)?.rooms?.room_number}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">
              {t('supervisor.selectHousekeeper')}
            </label>
            <Select value={selectedHousekeeper} onValueChange={setSelectedHousekeeper}>
              <SelectTrigger>
                <SelectValue placeholder={t('supervisor.chooseHousekeeper')} />
              </SelectTrigger>
              <SelectContent>
                {staff.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.full_name} ({person.nickname})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-3">
            <Button 
              variant="outline" 
              onClick={() => {
                setReassignDialogOpen(false);
                setSelectedAssignment(null);
                setSelectedHousekeeper('');
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button 
              onClick={handleReassignment}
              disabled={!selectedHousekeeper}
            >
              {t('supervisor.confirmReassign')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground mb-2">
          {t('supervisor.approvals')}
        </h2>
        <p className="text-muted-foreground">
          {t('supervisor.manageApprovals')}
        </p>
      </div>

      <Tabs defaultValue="pending" className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="pending" className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            {t('supervisor.pendingApprovals')}
            {summaryStats.totalCount > 0 && (
              <Badge className="ml-1 h-5 px-1.5 text-xs">{summaryStats.totalCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-2">
            <History className="h-4 w-4" />
            {t('supervisor.approvalHistory')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-6">
          {/* Date picker */}
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
            <div>
              <p className="text-muted-foreground">
                {t('supervisor.reviewCompletedTasks')}
              </p>
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full sm:w-auto">
                  <Clock className="h-4 w-4 mr-2" />
                  {format(selectedDate, 'PPP')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => date && setSelectedDate(date)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Summary Dashboard */}
          {summaryStats.totalCount > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Room Approvals */}
              <HelpTooltip hint={UI_HINTS["approval.rooms"]}>
                <Card className="border-l-4 border-l-green-500">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span className="text-xs font-medium text-muted-foreground">Rooms</span>
                    </div>
                    <p className="text-2xl font-bold text-foreground">{summaryStats.roomCount}</p>
                  </CardContent>
                </Card>
              </HelpTooltip>

              {/* Maintenance */}
              <HelpTooltip hint={UI_HINTS["approval.maintenance"]}>
                <Card className="border-l-4 border-l-blue-500">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Wrench className="h-4 w-4 text-blue-600" />
                      <span className="text-xs font-medium text-muted-foreground">Maintenance</span>
                    </div>
                    <p className="text-2xl font-bold text-foreground">{summaryStats.maintenanceCount}</p>
                  </CardContent>
                </Card>
              </HelpTooltip>

              {/* Flagged */}
              <HelpTooltip hint={UI_HINTS["approval.flagged"]}>
                <Card className={`border-l-4 ${summaryStats.flaggedCount > 0 ? 'border-l-orange-500' : 'border-l-muted'}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle className={`h-4 w-4 ${summaryStats.flaggedCount > 0 ? 'text-orange-600' : 'text-muted-foreground'}`} />
                      <span className="text-xs font-medium text-muted-foreground">Flagged</span>
                    </div>
                    <p className="text-2xl font-bold text-foreground">{summaryStats.flaggedCount}</p>
                  </CardContent>
                </Card>
              </HelpTooltip>

              {/* Oldest Waiting */}
              <HelpTooltip hint={UI_HINTS["approval.oldest"]}>
                <Card className={`border-l-4 ${summaryStats.oldestMinutes > 60 ? 'border-l-red-500' : 'border-l-muted'}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Clock className={`h-4 w-4 ${summaryStats.oldestMinutes > 60 ? 'text-red-600' : 'text-muted-foreground'}`} />
                      <span className="text-xs font-medium text-muted-foreground">Oldest</span>
                    </div>
                    <p className="text-2xl font-bold text-foreground">
                      {summaryStats.oldestMinutes > 60 
                        ? `${Math.floor(summaryStats.oldestMinutes / 60)}h ${summaryStats.oldestMinutes % 60}m`
                        : `${summaryStats.oldestMinutes}m`
                      }
                    </p>
                  </CardContent>
                </Card>
              </HelpTooltip>
            </div>
          )}

          {/* Per-Hotel Breakdown Pills */}
          {summaryStats.hotelCounts.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {summaryStats.hotelCounts.map(({ hotel, count }) => (
                <Badge key={hotel} variant="outline" className="px-3 py-1.5 text-sm bg-muted/50">
                  <Building2 className="h-3.5 w-3.5 mr-1.5" />
                  {hotel}: <span className="font-bold ml-1">{count}</span>
                </Badge>
              ))}
            </div>
          )}

          {summaryStats.totalCount === 0 ? (
            <Card className="text-center py-12">
              <CardContent>
                <CheckCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {t('supervisor.noTasksPending')}
                </h3>
                <p className="text-muted-foreground">
                  {t('supervisor.allTasksReviewed')}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* Early Sign-Out Requests */}
              {earlySignoutRequests.length > 0 && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                      <Clock className="h-5 w-5 text-orange-600" />
                      {t('supervisor.earlySignOutRequests')}
                      <Badge className="bg-orange-100 text-orange-800 border-orange-300">{earlySignoutRequests.length}</Badge>
                    </h3>
                  </div>
                  
                  {earlySignoutRequests.map((request) => (
                    <Card key={request.id} className="border-l-4 border-l-orange-400">
                      <CardContent className="p-4">
                        <div className="flex flex-col sm:flex-row justify-between items-start gap-3">
                          <div>
                            <p className="font-semibold text-foreground">
                              {request.profiles?.full_name || 'Unknown'}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {t('supervisor.requested')}: {new Date(request.requested_at).toLocaleString()}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={async () => {
                                try {
                                  const { error } = await supabase
                                    .from('early_signout_requests')
                                    .update({
                                      status: 'approved',
                                      approved_by: (await supabase.auth.getUser()).data.user?.id,
                                      approved_at: new Date().toISOString()
                                    })
                                    .eq('id', request.id);

                                  if (error) throw error;

                                  const { data: attendance } = await supabase
                                    .from('staff_attendance')
                                    .select('*')
                                    .eq('user_id', request.user_id)
                                    .eq('work_date', new Date().toISOString().split('T')[0])
                                    .eq('status', 'checked_in')
                                    .single();

                                  if (attendance) {
                                    await supabase
                                      .from('staff_attendance')
                                      .update({
                                        check_out_time: new Date().toISOString(),
                                        status: 'checked_out'
                                      })
                                      .eq('id', attendance.id);
                                  }

                                  toast.success(t('supervisor.earlySignOutApproved'));
                                  fetchPendingAssignments();
                                } catch (error: any) {
                                  console.error('Error approving early signout:', error);
                                  toast.error(t('supervisor.failedApprove'));
                                }
                              }}
                              className="bg-green-600 hover:bg-green-700 text-white"
                            >
                              <CheckCircle className="h-4 w-4 mr-1" />
                              {t('supervisor.approveBtn')}
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={async () => {
                                const reason = prompt(t('supervisor.enterRejectionReason'));
                                if (!reason) return;
                                
                                try {
                                  const { error } = await supabase
                                    .from('early_signout_requests')
                                    .update({
                                      status: 'rejected',
                                      approved_by: (await supabase.auth.getUser()).data.user?.id,
                                      approved_at: new Date().toISOString(),
                                      rejection_reason: reason
                                    })
                                    .eq('id', request.id);

                                  if (error) throw error;

                                  toast.success(t('supervisor.earlySignOutRejected'));
                                  fetchPendingAssignments();
                                } catch (error: any) {
                                  console.error('Error rejecting early signout:', error);
                                  toast.error(t('supervisor.failedReject'));
                                }
                              }}
                            >
                              {t('supervisor.rejectBtn')}
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
              
              {/* Room Assignments Grouped by Hotel */}
              {pendingAssignments.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                      <CheckCircle className="h-5 w-5 text-green-600" />
                      Room Completion Approvals
                      <Badge className="bg-green-100 text-green-800 border-green-300">{pendingAssignments.length}</Badge>
                    </h3>
                  </div>

                  {Object.entries(hotelGroups).map(([hotel, assignments]) => (
                    <div key={hotel} className="border rounded-lg overflow-hidden bg-card">
                      {/* Hotel Group Header - compact single row */}
                      <div 
                        className="flex items-center justify-between px-3 py-2 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors gap-2"
                        onClick={() => toggleHotelCollapse(hotel)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {collapsedHotels.has(hotel) 
                            ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                            : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                          }
                          <Building2 className="h-4 w-4 text-primary shrink-0" />
                          <span className="font-bold text-foreground text-sm truncate">{hotel}</span>
                          <Badge variant="outline" className="text-xs shrink-0">{assignments.length}</Badge>
                          {(() => {
                            const flagged = assignments.filter(a => {
                              if (!a.started_at) return false;
                              const dur = getDurationMinutes(a.started_at, a.completed_at);
                              return getSpeedIndicator(a.assignment_type, dur).severity === 'warning';
                            }).length;
                            return flagged > 0 ? (
                              <Badge variant="outline" className="text-[10px] bg-orange-50 text-orange-700 border-orange-200 shrink-0">
                                ⚠ {flagged}
                              </Badge>
                            ) : null;
                          })()}
                        </div>

                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              className="bg-green-50 text-green-700 border-green-300 hover:bg-green-100 shrink-0 h-7 px-2 text-xs"
                              onClick={(e) => e.stopPropagation()}
                              disabled={bulkApproving === hotel}
                            >
                              <CheckCheck className="h-3.5 w-3.5 mr-1" />
                              Approve All
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Approve all {assignments.length} rooms for {hotel}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will approve all pending room completions for this hotel. 
                                {(() => {
                                  const flagged = assignments.filter(a => {
                                    if (!a.started_at) return false;
                                    const dur = getDurationMinutes(a.started_at, a.completed_at);
                                    return getSpeedIndicator(a.assignment_type, dur).severity === 'warning';
                                  }).length;
                                  return flagged > 0 ? ` ⚠️ ${flagged} item(s) are flagged for unusual duration.` : '';
                                })()}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction 
                                onClick={() => handleBulkApprove(hotel)}
                                className="bg-green-600 hover:bg-green-700"
                              >
                                Approve All
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>

                      {/* Bulk progress */}
                      {bulkApproving === hotel && (
                        <div className="px-3 py-1.5 bg-green-50">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-green-700">Approving...</span>
                            <Progress value={bulkProgress} className="flex-1 h-1.5" />
                            <span className="text-xs font-semibold text-green-700">{bulkProgress}%</span>
                          </div>
                        </div>
                      )}

                      {/* Assignment Cards */}
                      {!collapsedHotels.has(hotel) && (
                        <div className="p-3 space-y-2">
                          {assignments.map(renderAssignmentCard)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              
              {/* Maintenance Ticket Approvals */}
              {pendingMaintenanceTickets.length > 0 && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                      <Wrench className="h-5 w-5 text-blue-600" />
                      {t('supervisor.maintenanceApprovals') || 'Maintenance Ticket Approvals'}
                      <Badge className="bg-blue-100 text-blue-800 border-blue-300">{pendingMaintenanceTickets.length}</Badge>
                    </h3>
                  </div>
                  
                  <div className="grid gap-4">
                    {pendingMaintenanceTickets.map((ticket) => (
                      <Card key={ticket.id} className="border shadow-sm hover:shadow-md transition-all duration-200 border-l-4 border-l-blue-500">
                        <CardHeader className="pb-3">
                          <div className="flex flex-col sm:flex-row justify-between items-start gap-3">
                            <div className="flex items-center gap-3">
                              <CardTitle className="text-lg font-bold text-foreground">
                                {ticket.title}
                              </CardTitle>
                              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
                                Pending Approval
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge 
                                variant="outline" 
                                className={`text-xs ${
                                  ticket.priority === 'urgent' ? 'bg-red-100 text-red-800 border-red-300' :
                                  ticket.priority === 'high' ? 'bg-orange-100 text-orange-800 border-orange-300' :
                                  ticket.priority === 'medium' ? 'bg-yellow-100 text-yellow-800 border-yellow-300' :
                                  'bg-green-100 text-green-800 border-green-300'
                                }`}
                              >
                                {ticket.priority?.toUpperCase()}
                              </Badge>
                              {ticket.hotel && (
                                <Badge variant="outline" className="text-xs bg-muted">
                                  <Building2 className="h-3 w-3 mr-1" />
                                  {ticket.hotel}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </CardHeader>

                        <CardContent className="space-y-4">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div className="flex items-center gap-2 p-2.5 bg-muted/50 rounded-lg">
                              <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                              <div>
                                <p className="text-xs text-muted-foreground">Room</p>
                                <p className="text-sm font-semibold text-foreground">{ticket.room_number}</p>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-2 p-2.5 bg-muted/50 rounded-lg">
                              <User className="h-4 w-4 text-muted-foreground shrink-0" />
                              <div>
                                <p className="text-xs text-muted-foreground">Reported By</p>
                                <p className="text-sm font-semibold text-foreground truncate">
                                  {ticket.created_by_profile?.full_name || 'Unknown'}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 p-2.5 bg-blue-50 rounded-lg">
                              <Wrench className="h-4 w-4 text-blue-600 shrink-0" />
                              <div>
                                <p className="text-xs text-blue-600">Fixed By</p>
                                <p className="text-sm font-semibold text-blue-800">
                                  {ticket.assigned_to_profile?.full_name || 'Unknown'}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 p-2.5 bg-muted/50 rounded-lg">
                              <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                              <div>
                                <p className="text-xs text-muted-foreground">Waiting</p>
                                <p className="text-sm font-semibold text-foreground">
                                  {getMinutesSince(ticket.created_at)}m
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Issue Description */}
                          <div className="p-3 bg-muted/30 rounded-lg">
                            <h4 className="font-semibold text-foreground mb-1 flex items-center gap-2 text-sm">
                              <FileText className="h-3.5 w-3.5" />
                              Issue
                            </h4>
                            <p className="text-sm text-muted-foreground">{ticket.description}</p>
                          </div>

                          {/* Resolution */}
                          {ticket.resolution_text && (
                            <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                              <h4 className="font-semibold text-green-800 mb-1 flex items-center gap-2 text-sm">
                                <CheckCircle className="h-3.5 w-3.5" />
                                Resolution
                              </h4>
                              <p className="text-sm text-green-700">{ticket.resolution_text}</p>
                            </div>
                          )}

                          {/* Completion Photos */}
                          {signedPhotoUrls[ticket.id] && signedPhotoUrls[ticket.id].length > 0 && (
                            <div className="space-y-2">
                              <h4 className="font-semibold text-foreground flex items-center gap-2 text-sm">
                                <Camera className="h-3.5 w-3.5" />
                                Completion Photos
                              </h4>
                              <div className="flex flex-wrap gap-2">
                                {signedPhotoUrls[ticket.id].map((photoUrl: string, idx: number) => (
                                  <a 
                                    key={idx} 
                                    href={photoUrl} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="block"
                                  >
                                    <img 
                                      src={photoUrl} 
                                      alt={`Completion ${idx + 1}`}
                                      className="w-20 h-20 object-cover rounded-lg border hover:opacity-80 transition-opacity"
                                    />
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-border">
                            <Button
                              onClick={() => handleApproveTicket(ticket.id)}
                              className="w-full sm:w-auto bg-green-600 hover:bg-green-700 text-white"
                              size="sm"
                            >
                              <CheckCircle className="h-4 w-4 mr-2" />
                              Approve
                            </Button>
                            
                            <Select onValueChange={(value) => handleReassignTicket(ticket.id, value)}>
                              <SelectTrigger className="w-full sm:w-auto">
                                <SelectValue placeholder="Reassign to..." />
                              </SelectTrigger>
                              <SelectContent>
                                {maintenanceStaff.map((person) => (
                                  <SelectItem key={person.id} value={person.id}>
                                    {person.full_name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-6">
          <ApprovalHistoryView />
        </TabsContent>
      </Tabs>

      {/* Shared Reassign Dialog */}
      {renderReassignDialog()}
    </div>
  );
}
