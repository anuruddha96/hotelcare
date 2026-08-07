import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Users, Plus, Calendar, CheckCircle, Trash2, Clock, Wand2, MapPin } from 'lucide-react';
import { EnhancedRoomCardV2 } from './EnhancedRoomCardV2';
import { CompactRoomCard } from './CompactRoomCard';
import { RoomAssignmentDialog } from './RoomAssignmentDialog';
import { WorkingRoomDetailDialog } from './WorkingRoomDetailDialog';
import { PendingRoomsDialog } from './PendingRoomsDialog';
import { DoneRoomsDialog } from './DoneRoomsDialog';
import { EarlySignoutApprovalView } from './EarlySignoutApprovalView';
import { AutoRoomAssignment } from './AutoRoomAssignment';
import { HotelRoomOverview } from './HotelRoomOverview';
import { PublicAreaAssignment } from './PublicAreaAssignment';
import { AssignmentSuccessAnimation } from './AssignmentSuccessAnimation';
import { PmsRefreshButton } from './PmsRefreshButton';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { usePropertyTerms } from '@/lib/propertyTerminology';
import { useTenantFeatures } from '@/hooks/useTenantFeatures';
import { setRoomDragPayload, readRoomDragPayload, assignRoomToStaff, unassignRoom } from '@/lib/hkAssignmentDnd';
import {
  initStagedScope,
  stageMove,
  undoLastStagedMove,
  discardStagedMoves,
  dropStagedMoves,
  acknowledgeRestore,
  useStagedMoves,
} from '@/lib/stagedAssignments';

// Real-time Break Timer Display Component for Managers
function BreakTimerDisplay({ breakType, startedAt }: { breakType: string; startedAt: string }) {
  const [elapsed, setElapsed] = useState(0);
  const [breakDuration, setBreakDuration] = useState(30);

  useEffect(() => {
    const fetchBreakDuration = async () => {
      const { data } = await supabase
        .from('break_types')
        .select('duration_minutes')
        .eq('name', breakType)
        .eq('is_active', true)
        .maybeSingle();

      if (data) setBreakDuration(data.duration_minutes);
    };

    fetchBreakDuration();
  }, [breakType]);

  useEffect(() => {
    const updateTimer = () => {
      const startTime = new Date(startedAt).getTime();
      const now = Date.now();
      const elapsedSeconds = Math.floor((now - startTime) / 1000);
      setElapsed(elapsedSeconds);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const timeRemaining = (breakDuration * 60) - elapsed;
  const isOvertime = timeRemaining <= 0;

  return (
    <div className={`text-xs space-y-1 px-2 py-1 rounded ${
      isOvertime ? 'bg-red-50' : 'bg-blue-50'
    }`}>
      <div className="flex items-center gap-1">
        <Clock className="h-3 w-3" />
        <span className="font-medium">Break: {formatTime(elapsed)}</span>
      </div>
      <div className={`font-semibold ${isOvertime ? 'text-red-600 animate-pulse' : 'text-green-600'}`}>
        {isOvertime ? '⚠️ Over by ' + formatTime(Math.abs(timeRemaining)) : `⏱️ ${formatTime(Math.abs(timeRemaining))} remaining`}
      </div>
    </div>
  );
}

interface HousekeepingStaff {
  id: string;
  full_name: string;
  nickname: string;
  email: string;
}

interface TeamAssignment {
  staff_id: string;
  staff_name: string;
  total_assigned: number;
  completed: number;
  in_progress: number;
  pending: number;
  /** Rooms parked for a 2nd DND attempt — they must stay visible to managers. */
  dnd: number;
}


interface RoomAssignment {
  id: string;
  room_id: string;
  assigned_to: string;
  status: string;
  room_number: string;
  hotel: string;
}

interface HousekeepingManagerViewProps {
  onActiveInnerTabChange?: (tab: string) => void;
}

export function HousekeepingManagerView({ onActiveInnerTabChange }: HousekeepingManagerViewProps = {}) {
  const { user, profile } = useAuth();
  const { t } = useTranslation();
  const terms = usePropertyTerms();
  const { venuesEnabled } = useTenantFeatures();
  // Managers/supervisors may move work between housekeepers by drag & drop.
  const canDragAssign = !!profile?.role && ['admin', 'manager', 'housekeeping_manager', 'supervisor'].includes(profile.role);
  const [housekeepingStaff, setHousekeepingStaff] = useState<HousekeepingStaff[]>([]);
  const [teamAssignments, setTeamAssignments] = useState<TeamAssignment[]>([]);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [loading, setLoading] = useState(true);
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
  const [autoAssignDialogOpen, setAutoAssignDialogOpen] = useState(false);
  const [publicAreaDialogOpen, setPublicAreaDialogOpen] = useState(false);
  const [bulkUnassignMode, setBulkUnassignMode] = useState(false);
  const [selectedAssignments, setSelectedAssignments] = useState<string[]>([]);
  const [roomAssignments, setRoomAssignments] = useState<RoomAssignment[]>([]);
  // Drag-and-drop assignment (SLNT-style boards): pending confirmation + hover target.
  const [dropTargetStaffId, setDropTargetStaffId] = useState<string | null>(null);
  const [pendingAssign, setPendingAssign] = useState<
    { roomId: string; roomNumber: string; staffId: string; staffName: string; sourceType: string; fromName: string | null } | null
  >(null);
  const [assigning, setAssigning] = useState(false);
  const [unassignDialogOpen, setUnassignDialogOpen] = useState(false);
  const [workingRoomDialogOpen, setWorkingRoomDialogOpen] = useState(false);
  const [pendingRoomsDialogOpen, setPendingRoomsDialogOpen] = useState(false);
  const [doneRoomsDialogOpen, setDoneRoomsDialogOpen] = useState(false);
  const [staffAttendance, setStaffAttendance] = useState<Record<string, any>>({});
  const [selectedStaff, setSelectedStaff] = useState<{ id: string; name: string } | null>(null);
  const [managerHotelName, setManagerHotelName] = useState<string>('');
  const [overviewRefreshKey, setOverviewRefreshKey] = useState(0);
  const [successAnimation, setSuccessAnimation] = useState<{ show: boolean; roomCount: number; staffCount: number }>({ show: false, roomCount: 0, staffCount: 0 });

  // Staged (unsaved) drag & drop moves — no dialog per move, one blanket apply.
  const stagedEnabled = venuesEnabled && canDragAssign;
  const { moves: stagedMoves, restored: stagedRestored } = useStagedMoves();
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!stagedEnabled || !user?.id) return;
    initStagedScope(`${user.id}:${profile?.assigned_hotel ?? 'all'}:${selectedDate}`);
  }, [stagedEnabled, user?.id, profile?.assigned_hotel, selectedDate]);

  // Warn before losing unapplied moves.
  useEffect(() => {
    if (stagedMoves.length === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [stagedMoves.length]);

  // Drop restored moves whose unit is no longer on today's board.
  useEffect(() => {
    if (!stagedRestored || roomAssignments.length === 0) return;
    acknowledgeRestore();
    toast.info(`Restored ${stagedMoves.length} unsaved ${stagedMoves.length === 1 ? 'move' : 'moves'} — Apply or Discard below.`);
  }, [stagedRestored, roomAssignments.length]);

  const applyStagedMoves = async () => {
    if (!user?.id || stagedMoves.length === 0) return;
    setApplying(true);
    const applied: string[] = [];
    const failed: string[] = [];
    for (const move of stagedMoves) {
      try {
        if (move.toStaffId) {
          await assignRoomToStaff({
            roomId: move.roomId,
            staffId: move.toStaffId,
            assignmentDate: selectedDate,
            assignedBy: user.id,
            organizationSlug: profile?.organization_slug ?? null,
            isCheckoutRoom: move.sourceType === 'checkout',
          });
        } else {
          await unassignRoom(move.roomId, selectedDate);
        }
        applied.push(move.roomId);
      } catch (err) {
        console.error('[staged apply] failed for', move.roomNumber, err);
        failed.push(move.roomNumber);
      }
    }
    dropStagedMoves(applied);
    if (applied.length > 0) toast.success(`${applied.length} ${applied.length === 1 ? 'move' : 'moves'} saved`);
    if (failed.length > 0) toast.error(`Could not save: ${failed.join(', ')}`);
    await Promise.all([fetchTeamAssignments(), fetchRoomAssignments()]);
    window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
    setApplying(false);
  };

  useEffect(() => {
    fetchHousekeepingStaff();
    fetchTeamAssignments();
    fetchRoomAssignments();
    fetchStaffAttendance();
    fetchManagerHotelName();
  }, [selectedDate]);

  // Keep the cards in sync when the unit board unassigns something.
  useEffect(() => {
    const onChanged = () => {
      fetchTeamAssignments();
      fetchRoomAssignments();
    };
    window.addEventListener('hk-assignments-changed', onChanged);
    return () => window.removeEventListener('hk-assignments-changed', onChanged);
  }, [selectedDate]);

  // The unit board stages unassigns; keep both panels showing the same draft.
  useEffect(() => {
    const onStaged = (e: Event) => {
      const d = (e as CustomEvent).detail as
        | { roomId: string; roomNumber: string; fromStaffId: string | null; fromStaffName: string | null }
        | undefined;
      if (!d || !stagedEnabled) return;
      stageMove({
        roomId: d.roomId,
        roomNumber: d.roomNumber,
        toStaffId: null,
        toStaffName: null,
        fromStaffId: d.fromStaffId,
        fromStaffName: d.fromStaffName,
        sourceType: 'assigned',
      });
    };
    window.addEventListener('hk-stage-unassign', onStaged);
    return () => window.removeEventListener('hk-stage-unassign', onStaged);
  }, [stagedEnabled]);


  // Real-time subscriptions for live updates
  useEffect(() => {
    // Subscribe to profile changes (new housekeeping staff)
    const profilesChannel = supabase
      .channel('profiles-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
          filter: 'role=eq.housekeeping'
        },
        () => {
          console.log('Profile change detected, refreshing staff list');
          fetchHousekeepingStaff();
        }
      )
      .subscribe();

    // Subscribe to room assignment changes
    const assignmentsChannel = supabase
      .channel('assignments-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_assignments'
        },
        () => {
          console.log('Assignment change detected, refreshing data');
          fetchTeamAssignments();
          fetchRoomAssignments();
        }
      )
      .subscribe();

    // Subscribe to staff attendance changes (for break status)
    const attendanceChannel = supabase
      .channel('attendance-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'staff_attendance',
          filter: `work_date=eq.${selectedDate}`
        },
        () => {
          console.log('Attendance change detected, refreshing attendance data');
          fetchStaffAttendance();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(profilesChannel);
      supabase.removeChannel(assignmentsChannel);
      supabase.removeChannel(attendanceChannel);
    };
  }, [selectedDate]);

  const fetchHousekeepingStaff = async () => {
    try {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('assigned_hotel, organization_slug')
        .eq('id', user?.id)
        .single();

      if (!profileData?.organization_slug) {
        console.log('No organization assigned to user');
        setHousekeepingStaff([]);
        return;
      }

      const hotelKeys = await resolveHotelKeys(profileData.assigned_hotel);

      let query = supabase
        .from('profiles')
        .select('id, full_name, nickname, email, assigned_hotel, organization_slug')
        .or('role.eq.housekeeping,acts_as_housekeeper.eq.true')
        .eq('organization_slug', profileData.organization_slug)
        .order('full_name');

      if (hotelKeys.length > 0) {
        query = query.in('assigned_hotel', hotelKeys);
      }

      const { data: filteredStaff, error } = await query;
      if (error) throw error;

      const baseStaff = filteredStaff || [];

      // Also include any non-housekeeping profile (e.g. managers who clean rooms)
      // that has at least one room assignment for the selected date in this hotel.
      try {
        const { data: todaysAssignments } = await supabase
          .from('room_assignments')
          .select('assigned_to, rooms!inner(hotel)')
          .eq('assignment_date', selectedDate);

        const assigneeIds = new Set<string>();
        (todaysAssignments || []).forEach((row: any) => {
          if (!row.assigned_to) return;
          if (hotelKeys.length > 0 && !hotelKeys.includes(row.rooms?.hotel)) return;
          assigneeIds.add(row.assigned_to);
        });

        const knownIds = new Set(baseStaff.map(s => s.id));
        const extraIds = Array.from(assigneeIds).filter(id => !knownIds.has(id));

        if (extraIds.length > 0) {
          const { data: extraProfiles } = await supabase
            .from('profiles')
            .select('id, full_name, nickname, email, assigned_hotel, organization_slug, role')
            .in('id', extraIds)
            .eq('organization_slug', profileData.organization_slug);

          if (extraProfiles && extraProfiles.length > 0) {
            baseStaff.push(...extraProfiles.map((p: any) => ({
              id: p.id,
              full_name: p.full_name,
              nickname: p.nickname,
              email: p.email,
              assigned_hotel: p.assigned_hotel,
              organization_slug: p.organization_slug,
            })));
          }
        }
      } catch (extraErr) {
        console.warn('Failed to load non-housekeeping assignees:', extraErr);
      }

      setHousekeepingStaff(baseStaff);
    } catch (error) {
      console.error('Error fetching housekeeping staff:', error);
      toast.error('Failed to load housekeeping staff');
    } finally {
      setLoading(false);
    }
  };

  const fetchTeamAssignments = async () => {
    try {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('assigned_hotel, organization_slug')
        .eq('id', user?.id)
        .single();

      const hotelKeys = await resolveHotelKeys(profileData?.assigned_hotel);

      const { data: assignmentsData, error: assignmentsError } = await supabase
        .from('room_assignments')
        .select('assigned_to, status, room_id')
        .eq('assignment_date', selectedDate);

      if (assignmentsError) throw assignmentsError;

      const roomIds = Array.from(new Set((assignmentsData || []).map(a => a.room_id).filter(Boolean)));
      let roomMap = new Map<string, any>();

      if (roomIds.length > 0) {
        let roomsQuery = supabase.from('rooms').select('id, hotel').in('id', roomIds);
        if (hotelKeys.length > 0) roomsQuery = roomsQuery.in('hotel', hotelKeys);
        const { data: roomsData } = await roomsQuery;
        if (roomsData) roomsData.forEach(room => roomMap.set(room.id, room));
      }

      // Only keep assignments whose room is in this hotel (when filter active)
      const filteredData = hotelKeys.length > 0
        ? (assignmentsData || []).filter((a: any) => roomMap.has(a.room_id))
        : (assignmentsData || []);

      const summaryMap = new Map<string, TeamAssignment>();

      // Initialize all staff with zero counts so cards always show
      housekeepingStaff.forEach(staff => {
        summaryMap.set(staff.id, {
          staff_id: staff.id,
          staff_name: staff.full_name,
          total_assigned: 0,
          completed: 0,
          in_progress: 0,
          pending: 0,
          dnd: 0,
        });

      });

      filteredData.forEach((row: any) => {
        const staffId = row.assigned_to as string;
        let summary = summaryMap.get(staffId);
        if (!summary) {
          const staff = housekeepingStaff.find(s => s.id === staffId);
          summary = {
            staff_id: staffId,
            staff_name: staff?.full_name || 'Unassigned',
            total_assigned: 0,
            completed: 0,
            in_progress: 0,
            pending: 0,
            dnd: 0,
          };
          summaryMap.set(staffId, summary);
        }
        summary.total_assigned += 1;
        if (row.status === 'completed') summary.completed += 1;
        else if (row.status === 'in_progress') summary.in_progress += 1;
        else if (row.status === 'assigned') summary.pending += 1;
        // Rooms awaiting a 2nd DND attempt get their own bucket so they never
        // silently drop out of the manager's team cards.
        else if (row.status === 'dnd_pending_retry') summary.dnd += 1;
      });




      setTeamAssignments(Array.from(summaryMap.values()));
    } catch (error) {
      console.error('Error fetching team assignments:', error);
      toast.error('Failed to load team assignments');
    }
  };

  const fetchRoomAssignments = async () => {
    try {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('assigned_hotel')
        .eq('id', user?.id)
        .single();

      const hotelKeys = await resolveHotelKeys(profileData?.assigned_hotel);

      const { data, error } = await supabase
        .from('room_assignments')
        .select(`
          id,
          room_id,
          assigned_to,
          status,
          rooms!inner(room_number, hotel)
        `)
        .eq('assignment_date', selectedDate);

      if (error) throw error;

      const filteredData = hotelKeys.length > 0
        ? (data || []).filter((item: any) => item.rooms?.hotel && hotelKeys.includes(item.rooms.hotel))
        : (data || []);

      const assignments = filteredData.map((item: any) => ({
        id: item.id,
        room_id: item.room_id,
        assigned_to: item.assigned_to,
        status: item.status,
        room_number: item.rooms.room_number,
        hotel: item.rooms.hotel,
      }));

      setRoomAssignments(assignments);
    } catch (error) {
      console.error('Error fetching room assignments:', error);
    }
  };

  const fetchStaffAttendance = async () => {
    try {
      const today = selectedDate;
      const { data } = await supabase
        .from('staff_attendance')
        .select('user_id, status, break_type')
        .eq('work_date', today);

      const attendanceMap: Record<string, any> = {};
      data?.forEach(record => {
        attendanceMap[record.user_id] = record;
      });
      
      setStaffAttendance(attendanceMap);
    } catch (error) {
      console.error('Error fetching staff attendance:', error);
    }
  };

  const fetchManagerHotelName = async () => {
    // Try the user's assigned hotel first
    if (profile?.assigned_hotel) {
      const { data: hotelConfig } = await supabase
        .from('hotel_configurations')
        .select('hotel_name')
        .eq('hotel_id', profile.assigned_hotel)
        .maybeSingle();
      setManagerHotelName(hotelConfig?.hotel_name || profile.assigned_hotel);
      return;
    }
    // Fallback for admins / top management with no assigned hotel:
    // pick the first hotel of their organization so the Hotel Room Overview
    // (and housekeeper assignment chips) renders instead of being blank.
    if (profile?.role && ['admin', 'top_management', 'top_management_manager'].includes(profile.role)) {
      const { data: hotels } = await supabase.rpc('get_user_organization_hotels');
      const first = (hotels || [])[0];
      if (first?.hotel_name) setManagerHotelName(first.hotel_name);
    }
  };



  const handleAssignmentCreated = (roomCount?: number, staffCount?: number) => {
    // Show success animation
    setSuccessAnimation({ show: true, roomCount: roomCount || 0, staffCount: staffCount || 0 });
    
    // Refresh all views
    fetchTeamAssignments();
    fetchRoomAssignments();
    setOverviewRefreshKey(prev => prev + 1);
    setAssignmentDialogOpen(false);
    setAutoAssignDialogOpen(false);
  };

  const handleBulkUnassign = async () => {
    if (selectedAssignments.length === 0) return;

    try {
      const { error } = await supabase
        .from('room_assignments')
        .delete()
        .in('id', selectedAssignments);

      if (error) throw error;

      toast.success(t('team.unassignSuccess').replace('{count}', selectedAssignments.length.toString()));
      setSelectedAssignments([]);
      setBulkUnassignMode(false);
      fetchTeamAssignments();
      fetchRoomAssignments();
    } catch (error) {
      console.error('Error unassigning rooms:', error);
      toast.error(t('team.unassignError'));
    }
  };

  const toggleAssignmentSelection = (assignmentId: string) => {
    setSelectedAssignments(prev => 
      prev.includes(assignmentId) 
        ? prev.filter(id => id !== assignmentId)
        : [...prev, assignmentId]
    );
  };

  const getProgressPercentage = (completed: number, total: number) => {
    return total > 0 ? Math.round((completed / total) * 100) : 0;
  };

  // Allow training to switch sub-tabs (team / early-signout) via the
  // `tour:navigate { subTab }` event.
  const [innerTab, setInnerTab] = React.useState<string>('team');
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const sub = detail.subTab;
      if (sub === 'team' || sub === 'early-signout') setInnerTab(sub);
    };
    window.addEventListener('tour:navigate', handler);
    window.addEventListener('training-navigate', handler);
    return () => {
      window.removeEventListener('tour:navigate', handler);
      window.removeEventListener('training-navigate', handler);
    };
  }, []);

  if (loading) {
    return <div className="flex justify-center p-8">{t('common.loading')}</div>;
  }

  const isReception = profile?.role === 'reception';


  return (
    <>
    <Tabs value={innerTab} onValueChange={(val) => { setInnerTab(val); onActiveInnerTabChange?.(val); }} className="space-y-6">
      {!isReception && (
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="team" className="text-xs sm:text-sm truncate" data-training="team-view-tab">{t('manager.teamView')}</TabsTrigger>
          <TabsTrigger value="early-signout" className="text-xs sm:text-sm truncate" data-training="pending-approvals">{t('manager.earlySignOutApprovals')}</TabsTrigger>
        </TabsList>
      )}

      <TabsContent value="team" className="space-y-6" data-training="team-view">
      {/* Header with Actions */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-semibold">{t('team.management')}</h2>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 border rounded-md"
          />
        </div>
        
        <div className="flex flex-wrap gap-2 justify-end w-full sm:w-auto relative z-10">
          {profile && (profile.role === 'admin' || profile.role === 'manager' || profile.role === 'housekeeping_manager') && (
            <PmsRefreshButton />
          )}
          {profile && (profile.role === 'admin' || profile.role === 'manager' || profile.role === 'housekeeping_manager') && (
            <>
              <Button
                variant={bulkUnassignMode ? "destructive" : "outline"}
                onClick={() => {
                  setBulkUnassignMode(!bulkUnassignMode);
                  setSelectedAssignments([]);
                }}
                className="flex items-center gap-2 w-full sm:w-auto touch-manipulation relative z-10 pointer-events-auto"
              >
                <Trash2 className="h-4 w-4" />
                {bulkUnassignMode ? t('common.cancel') : t('team.bulkUnassign')}
              </Button>
              
              {bulkUnassignMode && selectedAssignments.length > 0 && (
                <Button
                  variant="destructive"
                  onClick={() => setUnassignDialogOpen(true)}
                  className="flex items-center gap-2 w-full sm:w-auto touch-manipulation relative z-10 pointer-events-auto"
                >
                  {t('team.unassignSelected')} ({selectedAssignments.length})
                </Button>
              )}

              <Button
                variant="default"
                data-tour="auto-assign-btn"
                data-training="auto-assign-btn"
                onClick={() => setAutoAssignDialogOpen(true)}
                className="flex items-center gap-2 w-full sm:w-auto touch-manipulation relative z-10 pointer-events-auto bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Wand2 className="h-4 w-4" />
                <span className="truncate">{t('manager.autoAssign')}</span>
               </Button>

               <Button
                 variant="outline"
                 onClick={() => setPublicAreaDialogOpen(true)}
                 className="flex items-center gap-2 w-full sm:w-auto touch-manipulation relative z-10 pointer-events-auto"
               >
                 <MapPin className="h-4 w-4" />
                 <span className="truncate">{t('manager.publicAreas')}</span>
               </Button>
               
               <Button 
                 variant="outline"
                 className="flex items-center gap-2 w-full sm:w-auto touch-manipulation relative z-10 pointer-events-auto"
                 onClick={() => setAssignmentDialogOpen(true)}
               >
                 <Plus className="h-4 w-4" />
                 {t('team.assignRoom')}
               </Button>
             </>
           )}
         </div>
       </div>

      {/* Assignment Dialogs - conditionally mounted to prevent invisible overlays */}
      {assignmentDialogOpen && (
        <Dialog open={assignmentDialogOpen} onOpenChange={setAssignmentDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t('team.createAssignment')}</DialogTitle>
            </DialogHeader>
            <RoomAssignmentDialog 
              onAssignmentCreated={handleAssignmentCreated}
              selectedDate={selectedDate}
            />
          </DialogContent>
        </Dialog>
      )}

      {autoAssignDialogOpen && (
        <AutoRoomAssignment
          open={autoAssignDialogOpen}
          onOpenChange={setAutoAssignDialogOpen}
          selectedDate={selectedDate}
          onAssignmentCreated={handleAssignmentCreated}
        />
      )}

      {publicAreaDialogOpen && (
        <PublicAreaAssignment
          open={publicAreaDialogOpen}
          onOpenChange={setPublicAreaDialogOpen}
          staff={housekeepingStaff}
          hotelName={managerHotelName}
          onAssigned={() => {
            fetchTeamAssignments();
          }}
        />
      )}

      {/* Hotel Room Overview */}
      {managerHotelName && (
        <HotelRoomOverview
          selectedDate={selectedDate}
          hotelName={managerHotelName}
          staffMap={Object.fromEntries(housekeepingStaff.map(s => [s.id, s.full_name]))}
          refreshKey={overviewRefreshKey}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...housekeepingStaff].sort((a, b) => {
          const aCount = teamAssignments.find(t => t.staff_id === a.id)?.total_assigned || 0;
          const bCount = teamAssignments.find(t => t.staff_id === b.id)?.total_assigned || 0;
          if (aCount > 0 && bCount === 0) return -1;
          if (aCount === 0 && bCount > 0) return 1;
          return bCount - aCount;
        }).map((staff) => {
          const assignment = teamAssignments.find(a => a.staff_id === staff.id);
          const progressPercentage = assignment ? getProgressPercentage(assignment.completed, assignment.total_assigned) : 0;
          
          // Chips shown = saved assignments adjusted by staged (unsaved) moves.
          const movedAway = new Set(stagedMoves.filter(m => m.toStaffId !== staff.id).map(m => m.roomId));
          const savedChips = roomAssignments
            .filter(a => a.assigned_to === staff.id && !movedAway.has(a.room_id))
            .map(a => ({ key: a.id, roomId: a.room_id, roomNumber: a.room_number, status: a.status, pending: false }));
          const stagedIn = stagedMoves
            .filter(m => m.toStaffId === staff.id)
            .map(m => ({ key: `staged-${m.roomId}`, roomId: m.roomId, roomNumber: m.roomNumber, status: 'assigned', pending: true }));
          const myChips = [...savedChips, ...stagedIn];
          const isDropTarget = dropTargetStaffId === staff.id;

          return (
            <Card
              key={staff.id}
              className={`transition-all duration-200 ${
                isDropTarget
                  ? 'ring-2 ring-primary shadow-lg scale-[1.02] bg-primary/5'
                  : 'hover:shadow-md'
              }`}
              onDragOver={canDragAssign ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropTargetStaffId(staff.id); } : undefined}
              onDragLeave={canDragAssign ? (e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTargetStaffId(null);
              } : undefined}
              onDrop={canDragAssign ? (e) => {
                e.preventDefault();
                setDropTargetStaffId(null);
                const payload = readRoomDragPayload(e);
                if (!payload) return;
                if (payload.assignedTo === staff.id) return;
                if (stagedEnabled) {
                  stageMove({
                    roomId: payload.roomId,
                    roomNumber: payload.roomNumber,
                    toStaffId: staff.id,
                    toStaffName: staff.full_name,
                    fromStaffId: payload.assignedTo ?? null,
                    fromStaffName: payload.assignedToName ?? null,
                    sourceType: payload.sourceType,
                  });
                  return;
                }
                setPendingAssign({

                  roomId: payload.roomId,
                  roomNumber: payload.roomNumber,
                  staffId: staff.id,
                  staffName: staff.full_name,
                  sourceType: payload.sourceType,
                  fromName: payload.assignedToName ?? null,
                });
              } : undefined}
            >
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-lg">{staff.full_name}</CardTitle>
                    {staff.nickname && (
                      <p className="text-sm text-muted-foreground">({staff.nickname})</p>
                    )}
                    {staffAttendance[staff.id]?.status === 'on_break' && (
                      <div className="mt-2 space-y-1">
                        <Badge className="bg-amber-500 text-white text-xs font-semibold">
                          🕐 On Break - {staffAttendance[staff.id]?.break_type || 'Break'}
                        </Badge>
                        {staffAttendance[staff.id]?.break_started_at && (
                          <BreakTimerDisplay 
                            breakType={staffAttendance[staff.id]?.break_type || 'break'}
                            startedAt={staffAttendance[staff.id]?.break_started_at}
                          />
                        )}
                      </div>
                    )}
                  </div>
                  <Badge variant={assignment?.total_assigned ? "default" : "secondary"}>
                    {assignment?.total_assigned || 0} {terms.unitPlural.toLowerCase()}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Assigned unit chips — drag one out to unassign, drop one in to assign. */}
                {venuesEnabled && (
                  <div
                    className={`flex flex-wrap gap-1.5 rounded-md border border-dashed p-2 min-h-[46px] transition-colors ${
                      isDropTarget ? 'border-primary bg-primary/10' : 'border-border/60'
                    }`}
                  >
                    {myChips.length === 0 && (
                      <span className="text-xs text-muted-foreground self-center">
                        {isDropTarget ? `Drop to assign` : `Drag ${terms.unitPlural.toLowerCase()} here`}
                      </span>
                    )}
                    {myChips.map((a) => (
                      <span
                        key={a.key}
                        draggable={canDragAssign}
                        onDragStart={canDragAssign ? (e) => {
                          setRoomDragPayload(e, {
                            roomId: a.roomId,
                            roomNumber: a.roomNumber,
                            sourceType: 'assigned',
                            origin: 'housekeeper',
                            assignedTo: staff.id,
                            assignedToName: staff.full_name,
                          });
                          (e.currentTarget as HTMLElement).style.opacity = '0.5';
                        } : undefined}
                        onDragEnd={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border animate-fade-in transition-transform duration-150 hover:scale-105 ${
                          a.pending
                            ? 'bg-primary/10 text-primary border-primary border-dashed'
                            : a.status === 'completed'
                              ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                              : a.status === 'in_progress'
                                ? 'bg-blue-100 text-blue-800 border-blue-200'
                                : 'bg-muted text-foreground border-border'
                        } ${canDragAssign ? 'cursor-grab active:cursor-grabbing' : ''}`}
                        title={a.pending ? `${a.roomNumber} — not saved yet` : a.roomNumber}
                      >
                        {a.roomNumber}
                        {a.pending && <span className="text-[9px] opacity-70">●</span>}
                      </span>
                    ))}

                  </div>
                )}
                {assignment ? (
                  <>
                    {/* Progress Bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>{t('team.progress')}</span>
                        <span>{progressPercentage}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-green-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${progressPercentage}%` }}
                        />
                      </div>
                    </div>

                    {/* Status Breakdown */}
                        <div className="grid grid-cols-4 gap-2 text-center">
                      <div 
                        className="cursor-pointer hover:bg-green-50 rounded p-1 transition-colors"
                        onClick={() => {
                          if (assignment && assignment.completed > 0) {
                            setSelectedStaff({ id: staff.id, name: staff.full_name });
                            setDoneRoomsDialogOpen(true);
                          }
                        }}
                      >
                        <p className="text-lg font-semibold text-green-600">{assignment?.completed || 0}</p>
                        <p className="text-xs text-muted-foreground">{t('team.done')}</p>
                        {assignment && assignment.completed > 0 && (
                          <p className="text-xs text-green-600">{t('team.clickToView')}</p>
                        )}
                      </div>
                      <div 
                        className="cursor-pointer hover:bg-blue-50 rounded p-1 transition-colors"
                        onClick={() => {
                          if (assignment.in_progress > 0) {
                            setSelectedStaff({ id: staff.id, name: staff.full_name });
                            setWorkingRoomDialogOpen(true);
                          }
                        }}
                      >
                        <p className="text-lg font-semibold text-blue-600">{assignment.in_progress}</p>
                        <p className="text-xs text-muted-foreground">{t('team.working')}</p>
                        {assignment.in_progress > 0 && (
                          <p className="text-xs text-blue-600 font-medium">{t('team.clickToView')}</p>
                        )}
                      </div>
                      <div 
                        className="cursor-pointer hover:bg-orange-50 rounded p-1 transition-colors"
                        onClick={() => {
                          if (assignment.pending > 0) {
                            setSelectedStaff({ id: staff.id, name: staff.full_name });
                            setPendingRoomsDialogOpen(true);
                          }
                        }}
                      >
                        <p className="text-lg font-semibold text-orange-600">{assignment.pending}</p>
                        <p className="text-xs text-muted-foreground">{t('team.pending')}</p>
                        {assignment.pending > 0 && (
                          <p className="text-xs text-orange-600 font-medium">{t('team.clickToView')}</p>
                        )}
                      </div>
                      {/* DND (2nd attempt) — kept visible so parked rooms never vanish */}
                      <div
                        className="cursor-pointer hover:bg-purple-50 rounded p-1 transition-colors"
                        onClick={() => {
                          if (assignment.dnd > 0) {
                            setSelectedStaff({ id: staff.id, name: staff.full_name });
                            setPendingRoomsDialogOpen(true);
                          }
                        }}
                      >
                        <p className="text-lg font-semibold text-purple-600">{assignment.dnd}</p>
                        <p className="text-xs text-muted-foreground">{t('status.dndPendingRetry')}</p>
                        {assignment.dnd > 0 && (
                          <p className="text-xs text-purple-600 font-medium">{t('team.clickToView')}</p>
                        )}
                      </div>
                    </div>

                  </>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-muted-foreground text-sm">{t('team.noAssignments')} {format(new Date(selectedDate), 'MMM dd')}</p>
                  </div>
                )}
                {/* Inline Bulk Unassign Checkboxes */}
                {bulkUnassignMode && (
                  <div className="mt-3 border-t pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-destructive">{t('team.selectForUnassign')}</span>
                      {(() => {
                        const staffRooms = roomAssignments.filter(a => a.assigned_to === staff.id);
                        const allSelected = staffRooms.length > 0 && staffRooms.every(a => selectedAssignments.includes(a.id));
                        return staffRooms.length > 0 ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs h-7"
                            onClick={() => {
                              if (allSelected) {
                                setSelectedAssignments(prev => prev.filter(id => !staffRooms.find(a => a.id === id)));
                              } else {
                                setSelectedAssignments(prev => [...new Set([...prev, ...staffRooms.map(a => a.id)])]);
                              }
                            }}
                          >
                            {allSelected ? t('common.deselectAll') || 'Deselect All' : t('common.selectAll') || 'Select All'}
                          </Button>
                        ) : null;
                      })()}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {roomAssignments
                        .filter(a => a.assigned_to === staff.id)
                        .map(assignment => (
                          <div
                            key={assignment.id}
                            className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-sm cursor-pointer transition-colors ${
                              selectedAssignments.includes(assignment.id) 
                                ? 'bg-destructive/10 border-destructive' 
                                : 'bg-muted/50 border-border hover:bg-muted'
                            }`}
                            onClick={() => toggleAssignmentSelection(assignment.id)}
                          >
                            <Checkbox
                              checked={selectedAssignments.includes(assignment.id)}
                              onCheckedChange={() => toggleAssignmentSelection(assignment.id)}
                              className="h-3.5 w-3.5"
                            />
                            <span className="font-medium">{assignment.room_number}</span>
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                              {assignment.status}
                            </Badge>
                          </div>
                        ))}
                      {roomAssignments.filter(a => a.assigned_to === staff.id).length === 0 && (
                        <p className="text-xs text-muted-foreground">{t('team.noAssignments')}</p>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Quick Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {t('team.summary')} {format(new Date(selectedDate), 'MMMM dd, yyyy')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold">{housekeepingStaff.length}</p>
              <p className="text-sm text-muted-foreground">{t('team.teamMembers')}</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{teamAssignments.reduce((sum, a) => sum + a.total_assigned, 0)}</p>
              <p className="text-sm text-muted-foreground">{t('team.totalAssignments')}</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-green-600">{teamAssignments.reduce((sum, a) => sum + a.completed, 0)}</p>
              <p className="text-sm text-muted-foreground">{t('team.completed')}</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-blue-600">{teamAssignments.reduce((sum, a) => sum + a.in_progress, 0)}</p>
              <p className="text-sm text-muted-foreground">{t('team.inProgress')}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <AlertDialog open={unassignDialogOpen} onOpenChange={setUnassignDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('team.unassignRooms')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('team.confirmUnassign')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              handleBulkUnassign();
              setUnassignDialogOpen(false);
            }}>
              {t('team.unassignSelected')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Working Room Detail Dialog */}
      {selectedStaff && (
        <WorkingRoomDetailDialog
          open={workingRoomDialogOpen}
          onOpenChange={setWorkingRoomDialogOpen}
          staffId={selectedStaff.id}
          staffName={selectedStaff.name}
          selectedDate={selectedDate}
        />
      )}

      {/* Pending Rooms Dialog */}
      {selectedStaff && (
        <PendingRoomsDialog
          open={pendingRoomsDialogOpen}
          onOpenChange={setPendingRoomsDialogOpen}
          staffId={selectedStaff.id}
          staffName={selectedStaff.name}
          selectedDate={selectedDate}
        />
      )}

      {/* Done Rooms Dialog */}
      {selectedStaff && (
        <DoneRoomsDialog
          open={doneRoomsDialogOpen}
          onOpenChange={setDoneRoomsDialogOpen}
          staffId={selectedStaff.id}
          staffName={selectedStaff.name}
          selectedDate={selectedDate}
        />
      )}
      </TabsContent>

      {!isReception && (
        <TabsContent value="early-signout">
          <EarlySignoutApprovalView />
        </TabsContent>
      )}
    </Tabs>

    {/* Success Animation Overlay */}
    <AssignmentSuccessAnimation
      show={successAnimation.show}
      roomCount={successAnimation.roomCount}
      staffCount={successAnimation.staffCount}
      onComplete={() => setSuccessAnimation({ show: false, roomCount: 0, staffCount: 0 })}
    />

    {/* Staged moves bar — one blanket confirmation for all drag & drop changes. */}
    {stagedEnabled && stagedMoves.length > 0 && (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[min(680px,calc(100%-1.5rem))] animate-fade-in">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card/95 backdrop-blur px-4 py-3 shadow-lg">
          <span className="text-sm font-medium">
            {stagedMoves.length} unsaved {stagedMoves.length === 1 ? 'move' : 'moves'}
          </span>
          <span className="hidden sm:inline text-xs text-muted-foreground truncate max-w-[220px]">
            {stagedMoves.slice(-3).map(m => `${m.roomNumber} → ${m.toStaffName ?? 'unassigned'}`).join(', ')}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={applying} onClick={() => undoLastStagedMove()}>
              Undo last
            </Button>
            <Button variant="outline" size="sm" disabled={applying} onClick={() => discardStagedMoves()}>
              Discard
            </Button>
            <Button size="sm" disabled={applying} onClick={applyStagedMoves}>
              {applying ? 'Saving…' : `Apply ${stagedMoves.length}`}
            </Button>
          </div>
        </div>
      </div>
    )}



    <AlertDialog open={!!pendingAssign} onOpenChange={(o) => { if (!o) setPendingAssign(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Assign {terms.unit.toLowerCase()} to {pendingAssign?.staffName}?</AlertDialogTitle>
          <AlertDialogDescription>
            {pendingAssign?.fromName
              ? `${pendingAssign.roomNumber} will move from ${pendingAssign.fromName} to ${pendingAssign.staffName}.`
              : `${pendingAssign?.roomNumber ?? ''} will be assigned to ${pendingAssign?.staffName ?? ''}.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={assigning}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={assigning}
            onClick={async (e) => {
              e.preventDefault();
              if (!pendingAssign || !user?.id) return;
              setAssigning(true);
              try {
                await assignRoomToStaff({
                  roomId: pendingAssign.roomId,
                  staffId: pendingAssign.staffId,
                  assignmentDate: selectedDate,
                  assignedBy: user.id,
                  organizationSlug: profile?.organization_slug ?? null,
                  isCheckoutRoom: pendingAssign.sourceType === 'checkout',
                });
                toast.success(`${pendingAssign.roomNumber} → ${pendingAssign.staffName}`);
                setPendingAssign(null);
                await Promise.all([fetchTeamAssignments(), fetchRoomAssignments()]);
                window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
              } catch (err) {
                console.error(err);
                toast.error('Failed to assign');
              } finally {
                setAssigning(false);
              }
            }}
          >
            {assigning ? 'Assigning…' : 'Assign'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}