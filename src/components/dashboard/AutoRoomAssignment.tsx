import React, { useState, useEffect, useCallback } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Wand2, Users, ArrowRight, Check, Loader2, RefreshCw, AlertCircle, Clock, AlertTriangle, Move, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { 
  autoAssignRooms, 
  AssignmentPreview, 
  RoomForAssignment, 
  StaffForAssignment,
  moveRoom,
  calculateRoomWeight,
  formatMinutesToTime,
  buildWingProximityMap,
  WingProximityMap,
  CHECKOUT_MINUTES,
  DAILY_MINUTES,
  BREAK_TIME_MINUTES
} from '@/lib/roomAssignmentAlgorithm';
import { getLocalDateString } from '@/lib/utils';

const PUBLIC_AREAS = [
  { key: 'lobby_cleaning', name: 'Lobby', icon: '🏨' },
  { key: 'reception_cleaning', name: 'Reception', icon: '🛎️' },
  { key: 'back_office_cleaning', name: 'Back Office', icon: '🏢' },
  { key: 'kitchen_cleaning', name: 'Kitchen', icon: '🍳' },
  { key: 'guest_toilets_men', name: 'Guest Toilets (Men)', icon: '🚹' },
  { key: 'guest_toilets_women', name: 'Guest Toilets (Women)', icon: '🚺' },
  { key: 'common_areas_cleaning', name: 'Common Areas', icon: '🏠' },
  { key: 'stairways_cleaning', name: 'Stairways & Corridors', icon: '🚶' },
  { key: 'breakfast_room_cleaning', name: 'Breakfast Room', icon: '🍽️' },
  { key: 'dining_area_cleaning', name: 'Dining Area', icon: '🍴' },
];

interface AutoRoomAssignmentProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDate: string;
  onAssignmentCreated: () => void;
}

type Step = 'select-staff' | 'preview' | 'confirm' | 'public-areas';

export function AutoRoomAssignment({
  open,
  onOpenChange,
  selectedDate,
  onAssignmentCreated
}: AutoRoomAssignmentProps) {
  const { user, profile } = useAuth();
  const { t } = useTranslation();
  
  const [step, setStep] = useState<Step>('select-staff');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
  // Data
  const [allStaff, setAllStaff] = useState<StaffForAssignment[]>([]);
  const [selectedStaffIds, setSelectedStaffIds] = useState<Set<string>>(new Set());
  const [dirtyRooms, setDirtyRooms] = useState<RoomForAssignment[]>([]);
  const [checkedInStaff, setCheckedInStaff] = useState<Set<string>>(new Set());
  
  // Preview
  const [assignmentPreviews, setAssignmentPreviews] = useState<AssignmentPreview[]>([]);
  const [selectedRoomForMove, setSelectedRoomForMove] = useState<{roomId: string; fromStaffId: string} | null>(null);
  
  // Drag and drop
  const [dragOverStaffId, setDragOverStaffId] = useState<string | null>(null);
  const [draggingRoomId, setDraggingRoomId] = useState<string | null>(null);
  const [justDroppedStaffId, setJustDroppedStaffId] = useState<string | null>(null);
  const [justDroppedRoomId, setJustDroppedRoomId] = useState<string | null>(null);
  const isMobile = useIsMobile();
  // Over-allocation confirmation
  const [showOverAllocationDialog, setShowOverAllocationDialog] = useState(false);
  const [overAllocatedStaff, setOverAllocatedStaff] = useState<AssignmentPreview[]>([]);

  // Wing proximity map for smart assignments
  const [wingProximity, setWingProximity] = useState<WingProximityMap | undefined>(undefined);

  // Public area assignments (post-room assignment step)
  const [publicAreaAssignments, setPublicAreaAssignments] = useState<Map<string, string>>(new Map()); // areaKey -> staffId

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setStep('select-staff');
      setSelectedStaffIds(new Set());
      setAssignmentPreviews([]);
      setSelectedRoomForMove(null);
      setShowOverAllocationDialog(false);
      setPublicAreaAssignments(new Map());
      fetchData();
    }
  }, [open]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Get manager's hotel
      const hotelName = await getManagerHotel();
      if (!hotelName) {
        toast.error('No hotel assigned');
        return;
      }

      // Fetch housekeeping staff for this hotel
      const { data: staffData } = await supabase
        .from('profiles')
        .select('id, full_name, nickname')
        .eq('role', 'housekeeping')
        .eq('assigned_hotel', hotelName)
        .eq('organization_slug', profile?.organization_slug)
        .order('full_name');

      const staffList = staffData || [];
      setAllStaff(staffList);
      
      // Get staff IDs from this hotel only
      const hotelStaffIds = new Set(staffList.map(s => s.id));

      // Fetch today's attendance to see who's checked in
      const { data: attendanceData } = await supabase
        .from('staff_attendance')
        .select('user_id')
        .eq('work_date', selectedDate)
        .in('status', ['checked_in', 'on_break']);

      // Filter checked-in staff to only include those from this hotel
      const allCheckedIn = (attendanceData || []).map(a => a.user_id);
      const hotelCheckedIn = allCheckedIn.filter(id => hotelStaffIds.has(id));
      
      setCheckedInStaff(new Set(hotelCheckedIn));
      // Auto-select only staff who are checked in AND from this hotel
      setSelectedStaffIds(new Set(hotelCheckedIn));

      // Fetch dirty rooms that don't have assignments for today
      const { data: roomsData } = await supabase
        .from('rooms')
        .select('id, room_number, hotel, floor_number, room_size_sqm, room_capacity, is_checkout_room, status, towel_change_required, linen_change_required, wing, elevator_proximity, room_category')
        .eq('hotel', hotelName)
        .eq('status', 'dirty');

      // Get existing assignments for today
      const { data: existingAssignments } = await supabase
        .from('room_assignments')
        .select('room_id')
        .eq('assignment_date', selectedDate);

      const assignedRoomIds = new Set((existingAssignments || []).map(a => a.room_id));
      
      // Filter out already assigned rooms
      const availableRooms = (roomsData || []).filter(r => !assignedRoomIds.has(r.id));
      setDirtyRooms(availableRooms);

      // Fetch wing layouts for proximity-based smart assignment
      const { data: layoutData } = await supabase
        .from('hotel_floor_layouts')
        .select('floor_number, wing, x, y')
        .eq('hotel_name', hotelName);
      
      if (layoutData && layoutData.length > 0) {
        setWingProximity(buildWingProximityMap(layoutData.map(l => ({
          floor_number: l.floor_number,
          wing: l.wing,
          x: Number(l.x),
          y: Number(l.y),
        }))));
      } else {
        setWingProximity(undefined);
      }

    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const getManagerHotel = async (): Promise<string | null> => {
    if (!profile?.assigned_hotel) return null;

    // Try to get hotel name from hotel_id
    const { data: hotelConfig } = await supabase
      .from('hotel_configurations')
      .select('hotel_name')
      .eq('hotel_id', profile.assigned_hotel)
      .single();

    return hotelConfig?.hotel_name || profile.assigned_hotel;
  };

  const toggleStaffSelection = (staffId: string) => {
    const newSelection = new Set(selectedStaffIds);
    if (newSelection.has(staffId)) {
      newSelection.delete(staffId);
    } else {
      newSelection.add(staffId);
    }
    setSelectedStaffIds(newSelection);
  };

  const handleGeneratePreview = () => {
    const selectedStaff = allStaff.filter(s => selectedStaffIds.has(s.id));
    const previews = autoAssignRooms(dirtyRooms, selectedStaff, wingProximity);
    setAssignmentPreviews(previews);
    setStep('preview');
  };

  const handleMoveRoom = (toStaffId: string) => {
    if (!selectedRoomForMove) return;
    
    const newPreviews = moveRoom(
      assignmentPreviews,
      selectedRoomForMove.roomId,
      selectedRoomForMove.fromStaffId,
      toStaffId
    );
    
    setAssignmentPreviews(newPreviews);
    setSelectedRoomForMove(null);
  };

  const handleProceedToConfirm = () => {
    // Check for over-allocated staff
    const overAllocated = assignmentPreviews.filter(p => p.exceedsShift && p.rooms.length > 0);
    
    if (overAllocated.length > 0) {
      setOverAllocatedStaff(overAllocated);
      setShowOverAllocationDialog(true);
    } else {
      setStep('confirm');
    }
  };

  const handleConfirmAssignment = async () => {
    if (!user) return;
    
    setSubmitting(true);
    try {
      // Create all assignments
      const assignments = assignmentPreviews.flatMap(preview => 
        preview.rooms.map((room, index) => ({
          room_id: room.id,
          assigned_to: preview.staffId,
          assigned_by: user.id,
          assignment_date: selectedDate,
          assignment_type: (room.is_checkout_room ? 'checkout_cleaning' : 'daily_cleaning') as 'checkout_cleaning' | 'daily_cleaning',
          status: 'assigned' as const,
          priority: index + 1,
          organization_slug: profile?.organization_slug,
          ready_to_clean: !room.is_checkout_room // Daily rooms are ready, checkout rooms wait
        }))
      );

      if (assignments.length === 0) {
        toast.error('No rooms to assign');
        return;
      }

      const { error } = await supabase
        .from('room_assignments')
        .insert(assignments);

      if (error) throw error;

      const totalRooms = assignments.length;
      const staffCount = assignmentPreviews.filter(p => p.rooms.length > 0).length;
      
      toast.success(`Assigned ${totalRooms} rooms to ${staffCount} housekeepers`);
      onAssignmentCreated();
      
      // Move to public areas step instead of closing
      setStep('public-areas');

    } catch (error) {
      console.error('Error creating assignments:', error);
      toast.error('Failed to create assignments');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssignPublicAreas = async () => {
    if (publicAreaAssignments.size === 0 || !user) {
      onOpenChange(false);
      return;
    }

    setSubmitting(true);
    try {
      const today = getLocalDateString();
      const hotelName = await getManagerHotel();
      
      const tasks = Array.from(publicAreaAssignments.entries()).map(([areaKey, staffId]) => {
        const area = PUBLIC_AREAS.find(a => a.key === areaKey)!;
        return {
          task_name: area.name,
          task_description: area.name,
          task_type: areaKey,
          assigned_to: staffId,
          assigned_by: user.id,
          assigned_date: today,
          hotel: hotelName || '',
          priority: 1,
          status: 'assigned',
          organization_slug: profile?.organization_slug || '',
        };
      });

      const { error } = await supabase.from('general_tasks').insert(tasks);
      if (error) throw error;

      toast.success(`Assigned ${tasks.length} public area(s)`);
      onAssignmentCreated();
      onOpenChange(false);
    } catch (error) {
      console.error('Error assigning public areas:', error);
      toast.error('Failed to assign public areas');
    } finally {
      setSubmitting(false);
    }
  };

  const togglePublicAreaAssignment = (areaKey: string, staffId: string) => {
    const newMap = new Map(publicAreaAssignments);
    if (newMap.get(areaKey) === staffId) {
      newMap.delete(areaKey);
    } else {
      newMap.set(areaKey, staffId);
    }
    setPublicAreaAssignments(newMap);
  };

  const getWeightColor = (weight: number, avgWeight: number) => {
    const diff = weight - avgWeight;
    if (Math.abs(diff) < 0.5) return 'text-green-600';
    if (diff > 0) return 'text-amber-600';
    return 'text-blue-600';
  };

  const avgWeight = assignmentPreviews.length > 0 
    ? assignmentPreviews.reduce((sum, p) => sum + p.totalWeight, 0) / assignmentPreviews.length 
    : 0;

  const renderRoomChip = (room: RoomForAssignment, preview: AssignmentPreview) => {
    const isSelected = selectedRoomForMove?.roomId === room.id;
    const chipColor = room.is_checkout_room
      ? 'bg-amber-100 text-amber-900 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300'
      : 'bg-blue-100 text-blue-900 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300';

    return (
      <div
        key={room.id}
        draggable={!isMobile}
        onDragStart={(e) => {
          e.dataTransfer.setData('roomId', room.id);
          e.dataTransfer.setData('fromStaffId', preview.staffId);
          e.dataTransfer.effectAllowed = 'move';
          setDraggingRoomId(room.id);
          const ghost = document.createElement('div');
          ghost.textContent = room.room_number;
          ghost.style.cssText = `position:fixed;top:-100px;left:-100px;padding:6px 14px;border-radius:8px;font-size:13px;font-weight:700;box-shadow:0 8px 24px rgba(0,0,0,0.18);z-index:9999;background:${room.is_checkout_room ? '#fef3c7' : '#dbeafe'};color:${room.is_checkout_room ? '#92400e' : '#1e40af'};border:2px solid ${room.is_checkout_room ? '#f59e0b' : '#3b82f6'};`;
          document.body.appendChild(ghost);
          e.dataTransfer.setDragImage(ghost, 20, 15);
          requestAnimationFrame(() => document.body.removeChild(ghost));
        }}
        onDragEnd={() => { setDraggingRoomId(null); setDragOverStaffId(null); }}
        className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium transition-all duration-200 select-none ${
          !isMobile ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
        } ${chipColor} ${isSelected ? 'ring-2 ring-primary ring-offset-1 scale-105' : ''}
        ${draggingRoomId === room.id ? 'opacity-30 scale-95' : ''}
        ${justDroppedRoomId === room.id ? 'animate-scale-in ring-2 ring-green-500' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          if (isSelected) setSelectedRoomForMove(null);
          else setSelectedRoomForMove({ roomId: room.id, fromStaffId: preview.staffId });
        }}
        title={`Room ${room.room_number}${room.wing ? ` · Wing ${room.wing}` : ''}${room.room_size_sqm ? ` · ${room.room_size_sqm}m²` : ''}`}
      >
        <span>{room.room_number}</span>
        {room.towel_change_required && (
          <span className="text-[10px] px-0.5 font-bold text-red-600">T</span>
        )}
        {room.linen_change_required && (
          <span className="text-[10px] px-0.5 font-bold text-red-600">L</span>
        )}
      </div>
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5" />
              Auto Room Assignment
            </DialogTitle>
          </DialogHeader>

          {/* Step Indicator */}
          <div className="flex items-center justify-center gap-1.5 py-2 flex-wrap">
            <Badge variant={step === 'select-staff' ? 'default' : 'secondary'} className="text-xs">1. Staff</Badge>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <Badge variant={step === 'preview' ? 'default' : 'secondary'} className="text-xs">2. Preview</Badge>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <Badge variant={step === 'confirm' ? 'default' : 'secondary'} className="text-xs">3. Confirm</Badge>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <Badge variant={step === 'public-areas' ? 'default' : 'secondary'} className="text-xs">4. Public Areas</Badge>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-1">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : step === 'select-staff' ? (
              <div className="space-y-4">
                {/* Stats */}
                <div className="grid grid-cols-3 gap-4 p-4 bg-muted rounded-lg">
                  <div className="text-center">
                    <p className="text-2xl font-bold">{dirtyRooms.length}</p>
                    <p className="text-sm text-muted-foreground">Total Rooms</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-amber-600">
                      {dirtyRooms.filter(r => r.is_checkout_room).length}
                    </p>
                    <p className="text-sm text-muted-foreground">Checkouts</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-blue-600">
                      {dirtyRooms.filter(r => !r.is_checkout_room).length}
                    </p>
                    <p className="text-sm text-muted-foreground">Daily</p>
                  </div>
                </div>

                {/* Time estimation info */}
                <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg text-sm">
                  <Clock className="h-4 w-4 text-blue-600" />
                  <span>
                    Checkout rooms: <strong>{CHECKOUT_MINUTES} min</strong> | 
                    Daily rooms: <strong>{DAILY_MINUTES} min</strong> | 
                    Break: <strong>{BREAK_TIME_MINUTES} min</strong>
                  </span>
                </div>

                {dirtyRooms.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No dirty rooms available for assignment</p>
                  </div>
                ) : (
                  <>
                    <h3 className="font-medium flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Select Working Housekeepers ({selectedStaffIds.size} selected)
                    </h3>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {allStaff.map(staff => {
                        const isCheckedIn = checkedInStaff.has(staff.id);
                        const isSelected = selectedStaffIds.has(staff.id);

                        return (
                          <div
                            key={staff.id}
                            className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                              isSelected ? 'border-primary bg-primary/5' : 'hover:bg-muted'
                            }`}
                            onClick={() => toggleStaffSelection(staff.id)}
                          >
                            <Checkbox checked={isSelected} />
                            <div className="flex-1">
                              <p className="font-medium">{staff.full_name}</p>
                              {staff.nickname && (
                                <p className="text-sm text-muted-foreground">{staff.nickname}</p>
                              )}
                            </div>
                            {isCheckedIn && (
                              <Badge variant="outline" className="text-green-600 border-green-600">
                                <Check className="h-3 w-3 mr-1" />
                                Checked In
                              </Badge>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            ) : step === 'preview' ? (
              <div className="space-y-3">
                {/* Color Legend */}
                <div className="flex flex-wrap items-center gap-3 px-3 py-2 bg-muted/60 rounded-lg text-xs">
                  <span className="text-muted-foreground font-medium">Legend:</span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded bg-amber-200 border border-amber-400"></span>
                    Checkout
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded bg-blue-200 border border-blue-400"></span>
                    Daily
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-red-600">T</span>
                    Towel change
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-red-600">L</span>
                    Linen change
                  </span>
                </div>

                {/* Summary */}
                <div className="px-3 py-2 bg-muted/40 rounded-lg text-sm flex items-center justify-between flex-wrap gap-2">
                  <p>
                    <strong>{dirtyRooms.length}</strong> rooms → <strong>{assignmentPreviews.filter(p => p.rooms.length > 0).length}</strong> staff
                  </p>
                  <p className="text-muted-foreground flex items-center gap-1 text-xs">
                    <Move className="h-3.5 w-3.5" />
                    {isMobile ? 'Tap room → tap card to move' : 'Drag rooms to reassign'}
                  </p>
                </div>

                {/* Assignment Preview Cards */}
                <div className="space-y-3">
                  {assignmentPreviews.map(preview => {
                    const isDropTarget = selectedRoomForMove && selectedRoomForMove.fromStaffId !== preview.staffId;
                    const isDragOver = dragOverStaffId === preview.staffId;
                    const isOverShift = preview.exceedsShift && preview.rooms.length > 0;
                    
                    return (
                      <Card 
                        key={preview.staffId} 
                        className={`overflow-hidden transition-all duration-300 ${
                          isDropTarget ? 'ring-2 ring-primary ring-offset-2 cursor-pointer' : ''
                        } ${isDragOver ? 'ring-2 ring-blue-500 ring-offset-2 border-dashed border-blue-400 bg-blue-50/50 dark:bg-blue-950/20 scale-[1.01]' : ''}
                        ${justDroppedStaffId === preview.staffId ? 'ring-2 ring-green-500 bg-green-50/50 dark:bg-green-950/20' : ''}
                        ${draggingRoomId && !isDragOver && selectedRoomForMove?.fromStaffId !== preview.staffId ? 'border-primary/30' : ''}
                        ${isOverShift ? 'border-destructive' : ''}`}
                        onClick={() => isDropTarget && handleMoveRoom(preview.staffId)}
                        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                        onDragEnter={(e) => { e.preventDefault(); setDragOverStaffId(preview.staffId); }}
                        onDragLeave={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverStaffId(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragOverStaffId(null);
                          setDraggingRoomId(null);
                          const roomId = e.dataTransfer.getData('roomId');
                          const fromStaffId = e.dataTransfer.getData('fromStaffId');
                          if (roomId && fromStaffId && fromStaffId !== preview.staffId) {
                            const newPreviews = moveRoom(assignmentPreviews, roomId, fromStaffId, preview.staffId);
                            setAssignmentPreviews(newPreviews);
                            setJustDroppedStaffId(preview.staffId);
                            setJustDroppedRoomId(roomId);
                            setTimeout(() => { setJustDroppedStaffId(null); setJustDroppedRoomId(null); }, 600);
                          }
                        }}
                      >
                        {/* Compact header with summary */}
                        {(() => {
                          const checkoutRooms = preview.rooms.filter(r => r.is_checkout_room);
                          const dailyRooms = preview.rooms.filter(r => !r.is_checkout_room);
                          const towelCount = preview.rooms.filter(r => r.towel_change_required).length;
                          const linenCount = preview.rooms.filter(r => r.linen_change_required).length;
                          return (
                            <div className={`px-3 py-2 ${isOverShift ? 'bg-destructive/10' : 'bg-muted/40'}`}>
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-sm">{preview.staffName}</span>
                                  {isOverShift && <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
                                </div>
                                <span className={`text-xs ${isOverShift ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                                  {formatMinutesToTime(preview.totalWithBreak)}
                                  {isOverShift && ` (+${formatMinutesToTime(preview.overageMinutes)})`}
                                </span>
                              </div>
                              {preview.rooms.length > 0 && (
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                  {checkoutRooms.length} checkouts · {dailyRooms.length} daily
                                  {towelCount > 0 && <> · <span className="text-red-600 font-semibold">{towelCount}T</span></>}
                                  {linenCount > 0 && <> · <span className="text-red-600 font-semibold">{linenCount}L</span></>}
                                </p>
                              )}
                            </div>
                          );
                        })()}

                        {/* Room chips - grouped by checkout then daily */}
                        <div className="px-3 py-2.5">
                          {preview.rooms.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-2">No rooms assigned</p>
                          ) : (
                            <div className="space-y-2">
                              {/* Checkout rooms */}
                              {(() => {
                                const checkouts = preview.rooms
                                  .filter(r => r.is_checkout_room)
                                  .sort((a, b) => parseInt(a.room_number) - parseInt(b.room_number));
                                if (checkouts.length === 0) return null;
                                return (
                                  <div>
                                    <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Checkouts</p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {checkouts.map(room => renderRoomChip(room, preview))}
                                    </div>
                                  </div>
                                );
                              })()}
                              {/* Daily rooms */}
                              {(() => {
                                const dailys = preview.rooms
                                  .filter(r => !r.is_checkout_room)
                                  .sort((a, b) => parseInt(a.room_number) - parseInt(b.room_number));
                                if (dailys.length === 0) return null;
                                return (
                                  <div>
                                    <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Daily</p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {dailys.map(room => renderRoomChip(room, preview))}
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          )}

                          {/* Drop zone indicators */}
                          {isDropTarget && !isDragOver && (
                            <div className="mt-2 p-1.5 border-2 border-dashed border-primary rounded-lg text-center text-xs text-primary">
                              Click to move room here
                            </div>
                          )}
                          {isDragOver && (
                            <div className="mt-2 p-1.5 border-2 border-dashed border-blue-500 rounded-lg text-center text-xs text-blue-600 bg-blue-50 dark:bg-blue-950/30">
                              Drop room here
                            </div>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ) : step === 'confirm' ? (
              <div className="space-y-4 text-center py-8">
                <Check className="h-16 w-16 mx-auto text-green-600" />
                <h3 className="text-xl font-semibold">Ready to Assign</h3>
                <p className="text-muted-foreground">
                  {dirtyRooms.length} rooms will be assigned to {assignmentPreviews.filter(p => p.rooms.length > 0).length} housekeepers.
                </p>
                
                {/* Summary of assignments */}
                <div className="mt-4 text-left">
                  <div className="space-y-2">
                    {assignmentPreviews.filter(p => p.rooms.length > 0).map(preview => (
                      <div key={preview.staffId} className="flex items-center justify-between p-2 bg-muted rounded">
                        <span className="font-medium">{preview.staffName}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{preview.rooms.length} rooms</Badge>
                          <span className={`text-sm ${preview.exceedsShift ? 'text-destructive' : 'text-green-600'}`}>
                            {formatMinutesToTime(preview.totalWithBreak)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : step === 'public-areas' ? (
              <div className="space-y-4">
                <div className="text-center">
                  <Check className="h-12 w-12 mx-auto text-green-600 mb-2" />
                  <h3 className="text-lg font-semibold">Rooms Assigned Successfully!</h3>
                  <p className="text-sm text-muted-foreground">Now optionally assign public areas to your team.</p>
                </div>

                <div className="space-y-2">
                  {PUBLIC_AREAS.map(area => {
                    const assignedStaffId = publicAreaAssignments.get(area.key);
                    return (
                      <div key={area.key} className="flex items-center gap-3 p-3 border rounded-lg">
                        <span className="text-lg">{area.icon}</span>
                        <span className="text-sm font-medium flex-1 min-w-0">{area.name}</span>
                        <Select
                          value={assignedStaffId || ''}
                          onValueChange={(val) => {
                            const newMap = new Map(publicAreaAssignments);
                            if (val === 'none') {
                              newMap.delete(area.key);
                            } else {
                              newMap.set(area.key, val);
                            }
                            setPublicAreaAssignments(newMap);
                          }}
                        >
                          <SelectTrigger className="w-[160px]">
                            <SelectValue placeholder="Not assigned" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Not assigned</SelectItem>
                            {allStaff.filter(s => selectedStaffIds.has(s.id)).map(s => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.full_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>

                {publicAreaAssignments.size > 0 && (
                  <div className="p-3 bg-primary/5 rounded-lg text-sm">
                    <p className="font-medium">{publicAreaAssignments.size} area(s) will be assigned</p>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <DialogFooter className="flex-shrink-0 gap-2">
            {step === 'select-staff' && (
              <>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleGeneratePreview}
                  disabled={selectedStaffIds.size === 0 || dirtyRooms.length === 0}
                >
                  Generate Preview
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </>
            )}
            
            {step === 'preview' && (
              <>
                <Button variant="outline" onClick={() => setStep('select-staff')}>
                  Back
                </Button>
                <Button 
                  variant="outline"
                  onClick={handleGeneratePreview}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Regenerate
                </Button>
                <Button onClick={handleProceedToConfirm}>
                  Proceed to Confirm
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </>
            )}
            
            {step === 'confirm' && (
              <>
                <Button variant="outline" onClick={() => setStep('preview')}>
                  Back
                </Button>
                <Button 
                  onClick={handleConfirmAssignment}
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Assigning...
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      Confirm & Assign
                    </>
                  )}
                </Button>
              </>
            )}

            {step === 'public-areas' && (
              <>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Skip & Close
                </Button>
                <Button
                  onClick={handleAssignPublicAreas}
                  disabled={submitting || publicAreaAssignments.size === 0}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Assigning...
                    </>
                  ) : (
                    <>
                      <MapPin className="h-4 w-4 mr-2" />
                      Assign {publicAreaAssignments.size} Area(s)
                    </>
                  )}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Over-allocation confirmation dialog */}
      <AlertDialog open={showOverAllocationDialog} onOpenChange={setShowOverAllocationDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Shift Hours Exceeded
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>The following housekeepers have been allocated more work than the standard 8-hour shift:</p>
              <div className="space-y-2 mt-2">
                {overAllocatedStaff.map(staff => (
                  <div key={staff.staffId} className="flex justify-between items-center p-2 bg-destructive/10 rounded">
                    <span className="font-medium">{staff.staffName}</span>
                    <span className="text-destructive font-semibold">
                      {formatMinutesToTime(staff.totalWithBreak)} 
                      <span className="text-sm ml-1">(+{formatMinutesToTime(staff.overageMinutes)})</span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-sm">
                You can go back and adjust the assignments, or proceed with the current allocation.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go Back & Adjust</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => {
                setShowOverAllocationDialog(false);
                setStep('confirm');
              }}
              className="bg-destructive hover:bg-destructive/90"
            >
              Proceed Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
