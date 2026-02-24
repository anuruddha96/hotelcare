import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Hotel, BedDouble, EyeOff, MapPin, UserX, Map as MapIcon, CheckCircle, ArrowLeftRight, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { getLocalDateString } from '@/lib/utils';
import { HotelFloorMap } from './HotelFloorMap';

interface RoomData {
  id: string;
  room_number: string;
  floor_number: number | null;
  status: string | null;
  is_checkout_room: boolean | null;
  is_dnd: boolean | null;
  notes: string | null;
  room_size_sqm: number | null;
  wing: string | null;
  room_category: string | null;
  elevator_proximity: number | null;
  room_type: string | null;
  bed_type: string | null;
  room_name: string | null;
  guest_nights_stayed: number | null;
  towel_change_required: boolean | null;
  linen_change_required: boolean | null;
}

interface AssignmentData {
  room_id: string;
  assigned_to: string;
  status: string;
  assignment_type: string;
  started_at: string | null;
  supervisor_approved: boolean | null;
  ready_to_clean: boolean | null;
}

interface PublicAreaTask {
  id: string;
  task_name: string;
  task_type: string;
  assigned_to: string;
  status: string;
}

interface StaffMap {
  [id: string]: string;
}

interface HotelRoomOverviewProps {
  selectedDate: string;
  hotelName: string;
  staffMap: StaffMap;
}

const ROOM_SIZE_OPTIONS = [
  { value: '15', label: 'S', fullLabel: 'Small (~15m²)' },
  { value: '25', label: 'M', fullLabel: 'Medium (~25m²)' },
  { value: '35', label: 'L', fullLabel: 'Large (~35m²)' },
  { value: '45', label: 'XL', fullLabel: 'Extra Large (~45m²)' },
];

const HOTEL_ROOM_CATEGORIES: Record<string, string[]> = {
  'Hotel Ottofiori': [
    'Economy Double Room',
    'Deluxe Double or Twin Room',
    'Deluxe Queen Room',
    'Deluxe Triple Room',
    'Deluxe Quadruple Room',
  ],
  default: [
    'Deluxe Double or Twin Room with Synagogue View',
    'Deluxe Double or Twin Room',
    'Deluxe Queen Room',
    'Deluxe Triple Room',
    'Deluxe Quadruple Room',
    'Comfort Quadruple Room',
    'Comfort Double Room with Small Window',
    'Deluxe Single Room',
  ],
};

function getSizeLabel(sqm: number | null): string | null {
  if (!sqm) return null;
  if (sqm <= 18) return 'S';
  if (sqm <= 30) return 'M';
  if (sqm <= 40) return 'L';
  return 'XL';
}

const STATUS_COLORS: Record<string, string> = {
  clean: 'bg-emerald-200 text-emerald-900 border-emerald-500 dark:bg-emerald-900/50 dark:text-emerald-200 dark:border-emerald-600',
  dirty: 'bg-amber-200 text-amber-900 border-amber-500 dark:bg-amber-900/50 dark:text-amber-200 dark:border-amber-600',
  in_progress: 'bg-sky-200 text-sky-900 border-sky-500 dark:bg-sky-900/50 dark:text-sky-200 dark:border-sky-600',
  out_of_order: 'bg-red-200 text-red-900 border-red-500 dark:bg-red-900/50 dark:text-red-200 dark:border-red-600',
  inspected: 'bg-teal-200 text-teal-900 border-teal-500 dark:bg-teal-900/50 dark:text-teal-200 dark:border-teal-600',
  pending_approval: 'bg-violet-200 text-violet-900 border-violet-500 dark:bg-violet-900/50 dark:text-violet-200 dark:border-violet-600',
  overdue: 'bg-rose-300 text-rose-950 border-rose-600 dark:bg-rose-900/60 dark:text-rose-200 dark:border-rose-500',
};

const TASK_STATUS_COLORS: Record<string, string> = {
  assigned: 'bg-amber-200 text-amber-900 border-amber-500 dark:bg-amber-900/50 dark:text-amber-200 dark:border-amber-600',
  in_progress: 'bg-sky-200 text-sky-900 border-sky-500 dark:bg-sky-900/50 dark:text-sky-200 dark:border-sky-600',
  completed: 'bg-emerald-200 text-emerald-900 border-emerald-500 dark:bg-emerald-900/50 dark:text-emerald-200 dark:border-emerald-600',
};

const DEFAULT_COLOR = 'bg-muted text-muted-foreground border-border';

// Check if a room assignment is overdue (assigned > 2 hours ago without completion)
function isOverdue(assignment: AssignmentData | undefined, startedAt?: string): boolean {
  if (!assignment || assignment.status === 'completed') return false;
  if (assignment.status === 'in_progress' && startedAt) {
    const started = new Date(startedAt).getTime();
    const now = Date.now();
    return (now - started) > 2 * 60 * 60 * 1000; // 2 hours
  }
  return false;
}

export function HotelRoomOverview({ selectedDate, hotelName, staffMap }: HotelRoomOverviewProps) {
  const { profile } = useAuth();
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [assignments, setAssignments] = useState<AssignmentData[]>([]);
  const [publicAreaTasks, setPublicAreaTasks] = useState<PublicAreaTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [averageCleanTime, setAverageCleanTime] = useState<number | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<RoomData | null>(null);
  const [roomSizeDialogOpen, setRoomSizeDialogOpen] = useState(false);
  const [selectedSize, setSelectedSize] = useState<string>('25');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [savingSize, setSavingSize] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const isManagerOrAdmin = profile?.role && ['admin', 'manager', 'housekeeping_manager'].includes(profile.role);
  const isReception = profile?.role === 'reception';
  const canViewFullOverview = isManagerOrAdmin || isReception;
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  useEffect(() => {
    fetchData();
  }, [selectedDate, hotelName]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [roomsRes, assignmentsRes, tasksRes, completedRes] = await Promise.all([
        supabase
          .from('rooms')
          .select('id, room_number, floor_number, status, is_checkout_room, is_dnd, notes, room_size_sqm, wing, room_category, elevator_proximity, room_type, bed_type, room_name, guest_nights_stayed, towel_change_required, linen_change_required')
          .eq('hotel', hotelName)
          .order('room_number'),
        supabase
          .from('room_assignments')
          .select('room_id, assigned_to, status, assignment_type, started_at, supervisor_approved, ready_to_clean')
          .eq('assignment_date', selectedDate),
        supabase
          .from('general_tasks')
          .select('id, task_name, task_type, assigned_to, status')
          .eq('hotel', hotelName)
          .eq('assigned_date', selectedDate),
        supabase
          .from('room_assignments')
          .select('started_at, completed_at, room_id')
          .eq('assignment_date', selectedDate)
          .eq('status', 'completed')
          .not('started_at', 'is', null)
          .not('completed_at', 'is', null)
      ]);

      setRooms(roomsRes.data || []);
      
      const roomIds = new Set((roomsRes.data || []).map(r => r.id));
      setAssignments((assignmentsRes.data || []).filter(a => roomIds.has(a.room_id)));
      setPublicAreaTasks(tasksRes.data || []);

      // Calculate ACT from completed assignments for this hotel's rooms
      const completedForHotel = (completedRes.data || []).filter(a => roomIds.has(a.room_id));
      if (completedForHotel.length > 0) {
        const totalMinutes = completedForHotel.reduce((sum, a) => {
          const start = new Date(a.started_at!).getTime();
          const end = new Date(a.completed_at!).getTime();
          return sum + (end - start) / 60000;
        }, 0);
        setAverageCleanTime(Math.round(totalMinutes / completedForHotel.length));
      } else {
        setAverageCleanTime(null);
      }
    } catch (error) {
      console.error('Error fetching room overview:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRoomClick = (room: RoomData) => {
    if (!isManagerOrAdmin) return;
    setSelectedRoom(room);
    setSelectedSize(String(room.room_size_sqm || 25));
    setSelectedCategory(room.room_category || '');
    setRoomSizeDialogOpen(true);
  };

  const handleSaveSize = async () => {
    if (!selectedRoom) return;
    setSavingSize(true);
    try {
      const { error } = await supabase
        .from('rooms')
        .update({ 
          room_size_sqm: parseInt(selectedSize, 10),
          room_category: selectedCategory === 'none' ? null : selectedCategory || null
        })
        .eq('id', selectedRoom.id);

      if (error) throw error;
      
      // Update local state
      setRooms(prev => prev.map(r => 
        r.id === selectedRoom.id ? { ...r, room_size_sqm: parseInt(selectedSize, 10), room_category: selectedCategory === 'none' ? null : selectedCategory || null } : r
      ));
      toast.success(`Room ${selectedRoom.room_number} size updated`);
      setRoomSizeDialogOpen(false);
    } catch (error) {
      console.error('Error updating room size:', error);
      toast.error('Failed to update room size');
    } finally {
      setSavingSize(false);
    }
  };

  const assignmentMap = new Map<string, AssignmentData>();
  assignments.forEach(a => assignmentMap.set(a.room_id, a));

  const checkoutRooms = rooms.filter(r => {
    const assignment = assignmentMap.get(r.id);
    return r.is_checkout_room || assignment?.assignment_type === 'checkout_cleaning';
  });
  const dailyRooms = rooms.filter(r => {
    const assignment = assignmentMap.get(r.id);
    return !r.is_checkout_room && assignment?.assignment_type !== 'checkout_cleaning';
  });

  const isNoShow = (room: RoomData) => {
    return room.notes?.toLowerCase().includes('no show') || false;
  };

  const isEarlyCheckout = (room: RoomData) => {
    return room.notes?.toLowerCase().includes('early checkout') || false;
  };

  const noShowRooms = rooms.filter(r => isNoShow(r) && !isEarlyCheckout(r));
  const earlyCheckoutRooms = rooms.filter(r => isEarlyCheckout(r));

  const groupByFloor = (roomList: RoomData[]) => {
    const floorMap = new Map<number, RoomData[]>();
    roomList.forEach(room => {
      const floor = room.floor_number ?? (Math.floor(parseInt(room.room_number) / 100) || 0);
      if (!floorMap.has(floor)) floorMap.set(floor, []);
      floorMap.get(floor)!.push(room);
    });
    return Array.from(floorMap.entries()).sort((a, b) => a[0] - b[0]);
  };

  const getStaffName = (roomId: string): string | null => {
    const assignment = assignmentMap.get(roomId);
    if (!assignment) return null;
    const name = staffMap[assignment.assigned_to];
    if (!name) return null;
    const parts = name.split(' ');
    return parts[0].length <= 8 ? parts[0] : parts[0].substring(0, 7) + '.';
  };

  const getAssignmentStatus = (roomId: string): string | null => {
    return assignmentMap.get(roomId)?.status || null;
  };

  const renderRoomChip = (room: RoomData) => {
    const assignment = assignmentMap.get(room.id);
    const assignmentStatus = assignment?.status || null;
    const isPendingApproval = assignmentStatus === 'completed' && assignment?.supervisor_approved === false;
    const roomOverdue = isOverdue(assignment, assignment?.started_at || undefined);
    
    // Determine color based on enhanced status logic
    let statusKey: string;
    if (roomOverdue) {
      statusKey = 'overdue';
    } else if (isPendingApproval) {
      statusKey = 'pending_approval';
    } else if (assignmentStatus === 'in_progress') {
      statusKey = 'in_progress';
    } else if (assignmentStatus === 'completed' && assignment?.supervisor_approved) {
      statusKey = 'clean'; // Only green if supervisor approved
    } else if (assignmentStatus === 'completed') {
      statusKey = 'pending_approval';
    } else {
      statusKey = room.status || 'dirty';
    }
    
    const colorClass = STATUS_COLORS[statusKey] || DEFAULT_COLOR;
    const isDND = room.is_dnd;
    const noShow = isNoShow(room) && !isEarlyCheckout(room);
    const earlyCheckout = isEarlyCheckout(room);
    const staffName = getStaffName(room.id);
    const sizeLabel = getSizeLabel(room.room_size_sqm);

    return (
      <TooltipProvider key={room.id} delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div 
              className="flex flex-col items-center gap-0.5"
              onClick={() => handleRoomClick(room)}
              style={{ cursor: isManagerOrAdmin ? 'pointer' : 'default' }}
            >
              <div
                className={`
                  px-2 py-1 rounded text-xs font-bold border-2 transition-all min-w-[40px] text-center
                  ${colorClass}
                  ${isDND ? 'ring-2 ring-purple-500 ring-offset-1' : ''}
                  ${noShow ? 'ring-2 ring-red-600 ring-offset-1' : ''}
                  ${earlyCheckout ? 'ring-2 ring-orange-500 ring-offset-1' : ''}
                  ${roomOverdue ? 'animate-pulse' : ''}
                  ${isManagerOrAdmin ? 'hover:scale-110 hover:shadow-md' : ''}
                `}
              >
                {room.room_number}
                {room.bed_type === 'shabath' && <span className="ml-0.5 text-[9px] font-extrabold text-blue-700 dark:text-blue-300">SH</span>}
                {room.towel_change_required && (
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-red-600 text-white cursor-help">T</span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">Towel Change Required</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {room.linen_change_required && (
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-red-600 text-white cursor-help">RC</span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">Room Change — Full Linen Change Required</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {assignment?.ready_to_clean && 
                 (room.is_checkout_room || assignment?.assignment_type === 'checkout_cleaning') &&
                 !(assignment?.status === 'completed' && assignment?.supervisor_approved) && (
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-green-600 text-white cursor-help">RTC</span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">Ready to Clean — Guest has checked out, room is available for cleaning</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {assignment?.status === 'completed' && assignment?.supervisor_approved && (
                  <span className="ml-0.5 text-[9px]">✅</span>
                )}
                {isDND && <span className="ml-0.5 text-[9px]">🚫</span>}
                {noShow && <span className="ml-0.5 text-[9px]">⚠️</span>}
                {earlyCheckout && <span className="ml-0.5 text-[9px]">🔶</span>}
                {isPendingApproval && <span className="ml-0.5 text-[9px]">⏳</span>}
                {roomOverdue && <span className="ml-0.5 text-[9px]">🔴</span>}
                {sizeLabel && <span className="ml-0.5 text-[8px] opacity-70">{sizeLabel}</span>}
              </div>
              {staffName && (
                <span className="text-[9px] text-muted-foreground font-medium truncate max-w-[48px]">
                  {staffName}
                </span>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <div className="space-y-1">
              <p className="font-semibold">Room {room.room_number}</p>
              {room.room_type && <p>Type: {room.room_type.replace(/_/g, ' ')}</p>}
              <p>Status: {room.status || 'unknown'}</p>
              {room.wing && <p>Wing: {room.wing}</p>}
              {room.room_size_sqm && <p>Size: ~{room.room_size_sqm}m²</p>}
              {room.room_category && <p className="text-[10px] text-muted-foreground">{room.room_category}</p>}
              {room.bed_type === 'shabath' && <p className="text-blue-600 font-medium">✡ Shabath Room</p>}
              {room.guest_nights_stayed != null && room.guest_nights_stayed > 0 && (
                <p>Guest Night: {room.guest_nights_stayed}</p>
              )}
              {room.towel_change_required && <p className="text-red-600 font-bold">🔄 Towel Change Required</p>}
              {room.linen_change_required && <p className="text-red-600 font-bold">🛏️ Linen Change Required</p>}
              {isDND && <p className="text-purple-600 font-medium">🚫 Do Not Disturb</p>}
              {noShow && <p className="text-red-600 font-medium">⚠️ No Show</p>}
              {earlyCheckout && <p className="text-orange-600 font-bold">🔶 Early Checkout</p>}
              {isPendingApproval && <p className="text-violet-600 font-bold">⏳ Pending Supervisor Approval</p>}
              {roomOverdue && <p className="text-rose-600 font-bold">🔴 OVERDUE - Check with housekeeper</p>}
              {staffName && <p>Assigned: {staffMap[assignmentMap.get(room.id)?.assigned_to || ''] || staffName}</p>}
              {assignmentStatus && <p>Task: {assignmentStatus}</p>}
              {room.room_name && <p className="text-[9px] text-muted-foreground">PMS: {room.room_name}</p>}
              {isManagerOrAdmin && <p className="text-primary font-medium">Click to edit room</p>}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  const renderSection = (title: string, roomList: RoomData[], icon: React.ReactNode) => {
    const floors = groupByFloor(roomList);
    const dndCount = roomList.filter(r => r.is_dnd).length;

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {icon}
            <span className="text-sm font-semibold">{title}</span>
            <Badge variant="secondary" className="text-xs">{roomList.length}</Badge>
          </div>
          {dndCount > 0 && (
            <Badge variant="outline" className="text-purple-600 border-purple-300 text-xs">
              <EyeOff className="h-3 w-3 mr-1" /> {dndCount} DND
            </Badge>
          )}
        </div>

        {floors.length === 0 ? (
          <p className="text-xs text-muted-foreground pl-6">No rooms</p>
        ) : (
          <div className="space-y-1.5">
            {floors.map(([floor, floorRooms]) => (
              <div key={floor} className="flex items-start gap-2">
                <Badge variant="outline" className="text-[10px] min-w-[28px] text-center shrink-0 mt-0.5">
                  F{floor}
                </Badge>
                <div className="flex flex-wrap gap-1.5">
                  {floorRooms.map(room => renderRoomChip(room))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderPublicAreas = () => {
    if (publicAreaTasks.length === 0) return null;

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <MapPin className="h-3.5 w-3.5 text-emerald-600" />
          <span className="text-sm font-semibold">Public Areas</span>
          <Badge variant="secondary" className="text-xs">{publicAreaTasks.length}</Badge>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {publicAreaTasks.map(task => {
            const colorClass = TASK_STATUS_COLORS[task.status] || DEFAULT_COLOR;
            const staffName = staffMap[task.assigned_to];
            const shortName = staffName ? (staffName.split(' ')[0].length <= 8 ? staffName.split(' ')[0] : staffName.split(' ')[0].substring(0, 7) + '.') : null;

            return (
              <TooltipProvider key={task.id} delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex flex-col items-center gap-0.5">
                      <div className={`px-2 py-1 rounded text-xs font-semibold border ${colorClass} min-w-[40px] text-center`}>
                        {task.task_name}
                      </div>
                      {shortName && (
                        <span className="text-[9px] text-muted-foreground font-medium truncate max-w-[60px]">
                          {shortName}
                        </span>
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    <div className="space-y-1">
                      <p className="font-semibold">{task.task_name}</p>
                      <p>Status: {task.status}</p>
                      {staffName && <p>Assigned: {staffName}</p>}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            );
          })}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
            Loading room overview...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="border-primary/20">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Hotel className="h-4 w-4 text-primary" />
            Hotel Room Overview
            <Badge variant="secondary" className="text-xs ml-auto">{rooms.length} rooms</Badge>
            {noShowRooms.length > 0 && (
              <Badge variant="outline" className="text-xs font-semibold text-red-700 border-red-400 bg-red-50 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700">
                <UserX className="h-3 w-3 mr-1" />
                {noShowRooms.length} No-Show
              </Badge>
            )}
            {earlyCheckoutRooms.length > 0 && (
              <Badge variant="outline" className="text-xs font-semibold text-orange-700 border-orange-400 bg-orange-50 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700">
                🔶 {earlyCheckoutRooms.length} Early Checkout
              </Badge>
            )}
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="text-xs font-semibold cursor-help">
                    ACT: {averageCleanTime !== null ? `${averageCleanTime}m` : '--'}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Average Cleaning Time
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {canViewFullOverview && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setViewMode(viewMode === 'list' ? 'map' : 'list')}
              >
                <MapIcon className="h-3 w-3 mr-1" />
                {viewMode === 'list' ? 'Map' : 'List'}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw className={`h-3 w-3 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? '' : 'Refresh'}
            </Button>
          </CardTitle>
          {/* Legend */}
          <div className="flex flex-wrap gap-2 mt-1">
            {[
              { label: 'Approved/Clean', cls: 'bg-emerald-200 border-emerald-500' },
              { label: 'Dirty/Assigned', cls: 'bg-amber-200 border-amber-500' },
              { label: 'In Progress', cls: 'bg-sky-200 border-sky-500' },
              { label: 'Pending Approval', cls: 'bg-violet-200 border-violet-500' },
              { label: 'Overdue', cls: 'bg-rose-300 border-rose-600' },
              { label: 'Out of Order', cls: 'bg-red-200 border-red-500' },
              { label: 'DND', cls: 'ring-2 ring-purple-500 bg-muted' },
              { label: 'No-Show', cls: 'ring-2 ring-red-600 bg-muted' },
              { label: 'Early Checkout', cls: 'ring-2 ring-orange-500 bg-muted' },
              { label: 'Towel Change', cls: 'bg-red-600 text-white text-[8px] font-bold px-0.5', isText: true, text: 'T' },
              { label: 'Linen Change', cls: 'bg-red-600 text-white text-[8px] font-bold px-0.5', isText: true, text: 'RC' },
              { label: 'Ready to Clean (Checkout)', cls: 'bg-green-600 text-white text-[8px] font-bold px-0.5', isText: true, text: 'RTC' },
              { label: 'Approved', cls: 'text-[10px]', isText: true, text: '✅' },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-1">
                {(item as any).isText ? (
                  <span className={`rounded ${item.cls}`}>{(item as any).text}</span>
                ) : (
                  <div className={`w-3 h-3 rounded border-2 ${item.cls}`} />
                )}
                <span className="text-[10px] text-muted-foreground">{item.label}</span>
              </div>
            ))}
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-3 space-y-3">
          {viewMode === 'map' ? (
            <HotelFloorMap
              rooms={rooms}
              assignments={assignmentMap}
              staffMap={staffMap}
              onRoomClick={isManagerOrAdmin ? handleRoomClick : undefined}
              hotelName={hotelName}
              isAdmin={profile?.role === 'admin'}
            />
          ) : (
            <>
              {renderSection('Checkout Rooms', checkoutRooms, <BedDouble className="h-3.5 w-3.5 text-amber-600" />)}
              <div className="border-t border-border/50" />
              {renderSection('Daily Rooms', dailyRooms, <BedDouble className="h-3.5 w-3.5 text-blue-600" />)}
            </>
          )}
          {publicAreaTasks.length > 0 && (
            <>
              <div className="border-t border-border/50" />
              {renderPublicAreas()}
            </>
          )}
        </CardContent>
      </Card>

      {/* Room Edit Dialog */}
      <Dialog open={roomSizeDialogOpen} onOpenChange={setRoomSizeDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Room {selectedRoom?.room_number} {selectedRoom?.wing ? `(Wing ${selectedRoom.wing})` : ''}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Room Actions */}
            {selectedRoom && (() => {
              const assignment = assignmentMap.get(selectedRoom.id);
              const isCheckout = assignment?.assignment_type === 'checkout_cleaning' || selectedRoom.is_checkout_room;
              return (
                <div className="space-y-2 pb-2 border-b">
                  <label className="text-sm font-medium">Quick Actions</label>
                  {/* Mark Ready to Clean */}
                  {isCheckout && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-start gap-2"
                      disabled={actionLoading === 'ready' || (assignment?.ready_to_clean === true)}
                      onClick={async () => {
                        setActionLoading('ready');
                        try {
                          if (assignment) {
                            const { error } = await supabase
                              .from('room_assignments')
                              .update({ ready_to_clean: true } as any)
                              .eq('room_id', selectedRoom.id)
                              .eq('assignment_date', selectedDate);
                            if (error) throw error;
                          } else {
                            // No assignment exists - update room status directly
                            const { error } = await supabase
                              .from('rooms')
                              .update({ status: 'ready_to_clean' } as any)
                              .eq('id', selectedRoom.id);
                            if (error) throw error;
                          }
                          // Optimistic local update
                          if (assignment) {
                            setAssignments(prev => prev.map(a => 
                              a.room_id === selectedRoom.id ? { ...a, ready_to_clean: true } : a
                            ));
                          }
                          toast.success(`Room ${selectedRoom.room_number} marked as ready to clean`);
                          setRoomSizeDialogOpen(false);
                          await fetchData();
                        } catch (err) {
                          console.error('Mark ready error:', err);
                          toast.error('Failed to mark room as ready');
                        } finally {
                          setActionLoading(null);
                        }
                      }}
                    >
                      {actionLoading === 'ready' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4 text-green-600" />}
                      {assignment?.ready_to_clean ? '✅ Already Marked Ready' : 'Mark as Ready to Clean'}
                    </Button>
                  )}
                  {/* Switch Room Type */}
                  {assignment && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-start gap-2"
                      disabled={actionLoading === 'switch'}
                      onClick={async () => {
                        setActionLoading('switch');
                        const newType = isCheckout ? 'daily_cleaning' : 'checkout_cleaning';
                        const newIsCheckout = !isCheckout;
                        try {
                          const [assignRes, roomRes] = await Promise.all([
                            supabase
                              .from('room_assignments')
                              .update({ assignment_type: newType } as any)
                              .eq('room_id', selectedRoom.id)
                              .eq('assignment_date', selectedDate),
                            supabase
                              .from('rooms')
                              .update({ is_checkout_room: newIsCheckout } as any)
                              .eq('id', selectedRoom.id),
                          ]);
                          if (assignRes.error) throw assignRes.error;
                          if (roomRes.error) throw roomRes.error;
                          toast.success(`Room ${selectedRoom.room_number} switched to ${newIsCheckout ? 'Checkout' : 'Daily'}`);
                          setRoomSizeDialogOpen(false);
                          await fetchData();
                        } catch (err) {
                          toast.error('Failed to switch room type');
                        } finally {
                          setActionLoading(null);
                        }
                      }}
                    >
                      {actionLoading === 'switch' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4 text-blue-600" />}
                      Switch to {isCheckout ? 'Daily' : 'Checkout'}
                    </Button>
                  )}
                  {!assignment && !isCheckout && (
                    <p className="text-xs text-muted-foreground">No assignment for today — assign a room first to use quick actions.</p>
                  )}
                </div>
              );
            })()}

            <p className="text-sm text-muted-foreground">
              Set the room size and category. Size affects auto-assignment workload balancing.
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium">Room Size</label>
              <Select value={selectedSize} onValueChange={setSelectedSize}>
                <SelectTrigger>
                  <SelectValue placeholder="Select size" />
                </SelectTrigger>
                <SelectContent>
                  {ROOM_SIZE_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.fullLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Room Category</label>
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {(HOTEL_ROOM_CATEGORIES[hotelName] || HOTEL_ROOM_CATEGORIES.default).map(cat => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setRoomSizeDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveSize} disabled={savingSize}>
                {savingSize ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
