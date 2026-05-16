import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { UI_HINTS } from '@/lib/ui-hints';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Hotel, BedDouble, EyeOff, MapPin, UserX, Map as MapIcon, CheckCircle, ArrowLeftRight, Loader2, RefreshCw, ChevronDown, Settings, MessageSquare, Ban } from 'lucide-react';
import { parseRoomFlags, toggleFlag } from '@/lib/room-service-flags';

import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { getLocalDateString } from '@/lib/utils';
import { HotelFloorMap } from './HotelFloorMap';
import { resolveHotelKeys } from '@/lib/hotelKeys';

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
  created_at?: string | null;
  pms_metadata?: any;
}

interface AssignmentData {
  room_id: string;
  assigned_to: string;
  status: string;
  assignment_type: string;
  started_at: string | null;
  supervisor_approved: boolean | null;
  ready_to_clean: boolean | null;
  notes: string | null;
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
  refreshKey?: number;
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

export function HotelRoomOverview({ selectedDate, hotelName, staffMap, refreshKey }: HotelRoomOverviewProps) {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const isMobile = useIsMobile();
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
  const [showLegend, setShowLegend] = useState(false);
  const [hoveredRoomId, setHoveredRoomId] = useState<string | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [popoverNotes, setPopoverNotes] = useState<string>('');
  const [dragOverSection, setDragOverSection] = useState<'checkout' | 'daily' | null>(null);
  const [managerMessage, setManagerMessage] = useState('');

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
  }, [selectedDate, hotelName, refreshKey]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const hotelKeys = await resolveHotelKeys(hotelName);
      const keys = hotelKeys.length ? hotelKeys : [hotelName];
      const [roomsRes, assignmentsRes, tasksRes, completedRes] = await Promise.all([
        supabase
          .from('rooms')
          .select('id, room_number, floor_number, status, is_checkout_room, is_dnd, notes, room_size_sqm, wing, room_category, elevator_proximity, room_type, bed_type, room_name, guest_nights_stayed, towel_change_required, linen_change_required, created_at, pms_metadata')
          .in('hotel', keys)
          .order('room_number'),
        supabase
          .from('room_assignments')
          .select('room_id, assigned_to, status, assignment_type, started_at, supervisor_approved, ready_to_clean, notes')
          .eq('assignment_date', selectedDate),
        supabase
          .from('general_tasks')
          .select('id, task_name, task_type, assigned_to, status')
          .in('hotel', keys)
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

  const canInteractWithRooms = isManagerOrAdmin || isReception;
  const [roomNotes, setRoomNotes] = useState('');

  const handleRoomClick = (room: RoomData) => {
    if (!canInteractWithRooms) return;
    // On mobile, open the dialog directly. On desktop, popover handles it.
    if (isMobile) {
      setSelectedRoom(room);
      setSelectedSize(String(room.room_size_sqm || 25));
      setSelectedCategory(room.room_category || '');
      setRoomNotes(room.notes || '');
      setRoomSizeDialogOpen(true);
    }
  };

  const openSettingsDialog = (room: RoomData) => {
    setSelectedRoom(room);
    setSelectedSize(String(room.room_size_sqm || 25));
    setSelectedCategory(room.room_category || '');
    setRoomNotes(room.notes || '');
    setHoveredRoomId(null);
    setRoomSizeDialogOpen(true);
  };

  const handleHoverEnter = useCallback((roomId: string, room: RoomData) => {
    if (isMobile || !canInteractWithRooms) return;
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredRoomId(roomId);
      const flags = parseRoomFlags(room.notes);
      setPopoverNotes(flags.cleanNotes);
    }, 150);
  }, [isMobile, canInteractWithRooms]);

  const handleHoverLeave = useCallback(() => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredRoomId(null);
    }, 200);
  }, []);

  const handlePopoverEnter = useCallback(() => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
  }, []);

  const handlePopoverLeave = useCallback(() => {
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredRoomId(null);
    }, 150);
  }, []);

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
    const roomFlags = parseRoomFlags(room.notes);
    const isPendingApproval = assignmentStatus === 'completed' && assignment?.supervisor_approved === false;
    const roomOverdue = isOverdue(assignment, assignment?.started_at || undefined);
    
    let statusKey: string;
    if (roomOverdue) statusKey = 'overdue';
    else if (isPendingApproval) statusKey = 'pending_approval';
    else if (assignmentStatus === 'in_progress') statusKey = 'in_progress';
    else if (assignmentStatus === 'completed' && assignment?.supervisor_approved) statusKey = 'clean';
    else if (assignmentStatus === 'completed') statusKey = 'pending_approval';
    else statusKey = room.status || 'dirty';
    
    const colorClass = STATUS_COLORS[statusKey] || DEFAULT_COLOR;
    const isDND = room.is_dnd;
    const noShow = isNoShow(room) && !isEarlyCheckout(room);
    const earlyCheckout = isEarlyCheckout(room);
    const staffName = getStaffName(room.id);
    const sizeLabel = getSizeLabel(room.room_size_sqm);
    const isCheckout = assignment?.assignment_type === 'checkout_cleaning' || room.is_checkout_room;
    const isPopoverOpen = hoveredRoomId === room.id && !isMobile && canInteractWithRooms;

    const chipContent = (
      <div 
        className="flex flex-col items-center gap-0.5"
        draggable={isManagerOrAdmin ? true : undefined}
        onDragStart={isManagerOrAdmin ? (e) => {
          e.dataTransfer.setData('roomId', room.id);
          e.dataTransfer.setData('roomNumber', room.room_number);
          e.dataTransfer.setData('sourceType', isCheckout ? 'checkout' : 'daily');
          e.dataTransfer.effectAllowed = 'move';
          (e.currentTarget as HTMLElement).style.opacity = '0.5';
        } : undefined}
        onDragEnd={isManagerOrAdmin ? (e) => {
          (e.currentTarget as HTMLElement).style.opacity = '1';
          setDragOverSection(null);
        } : undefined}
        onClick={() => handleRoomClick(room)}
        onMouseEnter={() => handleHoverEnter(room.id, room)}
        onMouseLeave={handleHoverLeave}
        style={{ cursor: isManagerOrAdmin ? 'grab' : canInteractWithRooms ? 'pointer' : 'default' }}
      >
        <div
          className={`
            px-2 py-1 rounded text-xs font-bold border-2 transition-all min-w-[40px] text-center
            ${colorClass}
            ${isDND ? 'ring-2 ring-purple-500 ring-offset-1' : ''}
            ${noShow ? 'ring-2 ring-red-600 ring-offset-1' : ''}
            ${earlyCheckout ? 'ring-2 ring-orange-500 ring-offset-1' : ''}
            ${roomOverdue ? 'animate-pulse' : ''}
            ${canInteractWithRooms ? 'hover:scale-110 hover:shadow-md' : ''}
          `}
        >
          {room.room_number}
          {room.bed_type === 'shabath' && <span className="ml-0.5 text-[9px] font-extrabold text-blue-700 dark:text-blue-300">SH</span>}
          {room.towel_change_required && <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-blue-600 text-white">T</span>}
          {room.linen_change_required && <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-orange-500 text-white">C</span>}
          {roomFlags.roomCleaning && <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-green-600 text-white">RC</span>}
          {roomFlags.collectExtraTowels && <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-orange-500 text-white">🧺</span>}
          {assignment?.ready_to_clean && isCheckout && !(assignment?.status === 'completed' && assignment?.supervisor_approved) && (
            <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-green-600 text-white">RTC</span>
          )}
          {assignment?.notes?.includes('[NO_SERVICE]') && <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-gray-500 text-white">NS</span>}
          {assignment?.status === 'completed' && assignment?.supervisor_approved && !assignment?.notes?.includes('[NO_SERVICE]') && <span className="ml-0.5 text-[9px]">✅</span>}
          {isDND && <span className="ml-0.5 text-[9px]">🚫</span>}
          {noShow && <span className="ml-0.5 text-[9px]">⚠️</span>}
          {earlyCheckout && <span className="ml-0.5 text-[9px]">🔶</span>}
          {isPendingApproval && <span className="ml-0.5 text-[9px]">⏳</span>}
          {roomOverdue && <span className="ml-0.5 text-[9px]">🔴</span>}
          {sizeLabel && <span className="ml-0.5 text-[8px] opacity-70">{sizeLabel}</span>}
        </div>
        {/* Bed config & staff name indicators below chip */}
        <div className="flex flex-col items-center gap-0">
          {(room as any).bed_configuration && (
            <span className="text-[8px] text-purple-600 dark:text-purple-400 font-semibold truncate max-w-[48px]">
              {(() => {
                const bc = (room as any).bed_configuration;
                if (bc.includes('Double')) return 'DB';
                if (bc.includes('Twin') && bc.includes('Sep')) return 'TW-S';
                if (bc.includes('Twin')) return 'TW';
                if (bc.includes('Single')) return 'SGL';
                if (bc.includes('Baby')) return '👶BB';
                if (bc.includes('Extra') || bc.includes('Cot')) return '+COT';
                return bc.substring(0, 3).toUpperCase();
              })()}
            </span>
          )}
          {roomFlags.cleanNotes && (
            <span className="text-[8px]" title={roomFlags.cleanNotes}>📝</span>
          )}
          {staffName && (
            <span className="text-[9px] text-muted-foreground font-medium truncate max-w-[48px]">
              {staffName}
            </span>
          )}
        </div>
      </div>
    );

    // Desktop: hover popover with quick actions
    if (!isMobile && canInteractWithRooms) {
      return (
        <Popover key={room.id} open={isPopoverOpen}>
          <PopoverTrigger asChild>
            {chipContent}
          </PopoverTrigger>
          <PopoverContent 
            side="top" 
            align="center"
            className="w-56 p-0 shadow-lg"
            onMouseEnter={handlePopoverEnter}
            onMouseLeave={handlePopoverLeave}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="p-2.5 space-y-2">
              {/* Header */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-foreground">Room {room.room_number}</span>
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 uppercase ${
                  statusKey === 'clean' ? 'bg-emerald-100 text-emerald-700 border-emerald-300' :
                  statusKey === 'in_progress' ? 'bg-sky-100 text-sky-700 border-sky-300' :
                  statusKey === 'pending_approval' ? 'bg-violet-100 text-violet-700 border-violet-300' :
                  'bg-amber-100 text-amber-700 border-amber-300'
                }`}>
                  {statusKey === 'pending_approval' ? 'Pending' : statusKey.replace(/_/g, ' ')}
                </Badge>
              </div>

              {/* Ready to Clean - PROMINENT for checkout rooms */}
              {isCheckout && assignment && !assignment.ready_to_clean && (
                <button
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-bold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors shadow-sm"
                  disabled={actionLoading === `ready-${room.id}`}
                  onClick={async (e) => {
                    e.stopPropagation();
                    setActionLoading(`ready-${room.id}`);
                    try {
                      const { error } = await supabase.from('room_assignments').update({ ready_to_clean: true } as any).eq('room_id', room.id).eq('assignment_date', selectedDate);
                      if (error) throw error;
                      setAssignments(prev => prev.map(a => a.room_id === room.id ? { ...a, ready_to_clean: true } : a));
                      toast.success(`Room ${room.room_number} ready to clean`);
                    } catch { toast.error('Failed'); }
                    finally { setActionLoading(null); }
                  }}
                >
                  <CheckCircle className="h-4 w-4" /> ✅ Mark Ready to Clean
                </button>
              )}
              {isCheckout && assignment?.ready_to_clean && (
                <div className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700 border border-emerald-200">
                  ✅ Ready to Clean
                </div>
              )}

              {/* Services Section */}
              <div className="space-y-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Services</p>
                <button
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                    room.towel_change_required 
                      ? 'bg-red-100 text-red-800 border border-red-200 hover:bg-red-200' 
                      : 'bg-muted/50 text-muted-foreground hover:bg-muted border border-transparent'
                  }`}
                  disabled={actionLoading === `towel-${room.id}`}
                  onClick={async (e) => {
                    e.stopPropagation();
                    setActionLoading(`towel-${room.id}`);
                    const newVal = !room.towel_change_required;
                    try {
                      // Check if room is already completed
                      if (assignmentStatus === 'completed') {
                        toast.warning(`⚠️ Room ${room.room_number} was already cleaned. Please inform the housekeeper separately.`, { duration: 5000 });
                      }
                      const { error } = await supabase.from('rooms').update({ towel_change_required: newVal } as any).eq('id', room.id);
                      if (error) throw error;
                      setRooms(prev => prev.map(r => r.id === room.id ? { ...r, towel_change_required: newVal } : r));
                      toast.success(`Towel ${newVal ? 'enabled' : 'disabled'} — ${room.room_number}`);
                    } catch { toast.error('Failed'); }
                    finally { setActionLoading(null); }
                  }}
                >
                  <span>🔄 Towel Change</span>
                  <span className="text-[10px]">{room.towel_change_required ? '✓ Required' : 'Off'}</span>
                </button>
                <button
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                    room.linen_change_required 
                      ? 'bg-purple-100 text-purple-800 border border-purple-200 hover:bg-purple-200' 
                      : 'bg-muted/50 text-muted-foreground hover:bg-muted border border-transparent'
                  }`}
                  disabled={actionLoading === `linen-${room.id}`}
                  onClick={async (e) => {
                    e.stopPropagation();
                    setActionLoading(`linen-${room.id}`);
                    const newVal = !room.linen_change_required;
                    try {
                      if (assignmentStatus === 'completed') {
                        toast.warning(`⚠️ Room ${room.room_number} was already cleaned. Please inform the housekeeper separately.`, { duration: 5000 });
                      }
                      const { error } = await supabase.from('rooms').update({ linen_change_required: newVal } as any).eq('id', room.id);
                      if (error) throw error;
                      setRooms(prev => prev.map(r => r.id === room.id ? { ...r, linen_change_required: newVal } : r));
                      toast.success(`Bed Linen ${newVal ? 'enabled' : 'disabled'} — ${room.room_number}`);
                    } catch { toast.error('Failed'); }
                    finally { setActionLoading(null); }
                  }}
                >
                  <span>🛏️ Clean Room (C)</span>
                  <span className="text-[10px]">{room.linen_change_required ? '✓ Required' : 'Off'}</span>
                </button>
                <button
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                    roomFlags.roomCleaning 
                      ? 'bg-blue-100 text-blue-800 border border-blue-200 hover:bg-blue-200' 
                      : 'bg-muted/50 text-muted-foreground hover:bg-muted border border-transparent'
                  }`}
                  disabled={actionLoading === `rc-${room.id}`}
                  onClick={async (e) => {
                    e.stopPropagation();
                    setActionLoading(`rc-${room.id}`);
                    const newVal = !roomFlags.roomCleaning;
                    try {
                      if (assignmentStatus === 'completed') {
                        toast.warning(`⚠️ Room ${room.room_number} was already cleaned. Please inform the housekeeper separately.`, { duration: 5000 });
                      }
                      const updatedNotes = toggleFlag(room.notes, 'ROOM_CLEANING', newVal);
                      const { error } = await supabase.from('rooms').update({ notes: updatedNotes || null } as any).eq('id', room.id);
                      if (error) throw error;
                      setRooms(prev => prev.map(r => r.id === room.id ? { ...r, notes: updatedNotes || null } : r));
                      toast.success(`Room Cleaning ${newVal ? 'enabled' : 'disabled'} — ${room.room_number}`);
                    } catch { toast.error('Failed'); }
                    finally { setActionLoading(null); }
                  }}
                >
                  <span>🧹 Room Cleaning (RC)</span>
                  <span className="text-[10px]">{roomFlags.roomCleaning ? '✓ Required' : 'Off'}</span>
                </button>
                <button
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                    roomFlags.collectExtraTowels 
                      ? 'bg-orange-100 text-orange-800 border border-orange-200 hover:bg-orange-200' 
                      : 'bg-muted/50 text-muted-foreground hover:bg-muted border border-transparent'
                  }`}
                  disabled={actionLoading === `extratowel-${room.id}`}
                  onClick={async (e) => {
                    e.stopPropagation();
                    setActionLoading(`extratowel-${room.id}`);
                    const newVal = !roomFlags.collectExtraTowels;
                    try {
                      if (assignmentStatus === 'completed') {
                        toast.warning(`⚠️ Room ${room.room_number} was already cleaned. Please inform the housekeeper separately.`, { duration: 5000 });
                      }
                      const updatedNotes = toggleFlag(room.notes, 'COLLECT_EXTRA_TOWELS', newVal);
                      const { error } = await supabase.from('rooms').update({ notes: updatedNotes || null } as any).eq('id', room.id);
                      if (error) throw error;
                      setRooms(prev => prev.map(r => r.id === room.id ? { ...r, notes: updatedNotes || null } : r));
                      toast.success(`Collect Extra Towels ${newVal ? 'enabled' : 'disabled'} — ${room.room_number}`);
                    } catch { toast.error('Failed'); }
                    finally { setActionLoading(null); }
                  }}
                >
                  <span>🧺 Collect Extra Towels</span>
                  <span className="text-[10px]">{roomFlags.collectExtraTowels ? '✓ Yes' : 'Off'}</span>
                </button>
              </div>

              {/* Bed Configuration */}
              {isManagerOrAdmin && (
                <div className="border-t border-border pt-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Bed Config</p>
                  <select
                    className="w-full text-xs p-1.5 rounded border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                    value={(room as any).bed_configuration || ''}
                    onClick={(e) => e.stopPropagation()}
                    onChange={async (e) => {
                      const val = e.target.value || null;
                      try {
                        const { error } = await supabase.from('rooms').update({ bed_configuration: val } as any).eq('id', room.id);
                        if (error) throw error;
                        setRooms(prev => prev.map(r => r.id === room.id ? { ...r, bed_configuration: val } as any : r));
                        toast.success(`Bed config updated — ${room.room_number}`);
                      } catch { toast.error('Failed'); }
                    }}
                  >
                    <option value="">None</option>
                    <option value="Double Bed">Double Bed</option>
                    <option value="Twin Beds">Twin Beds</option>
                    <option value="Twin Beds Separated">Twin Beds Separated</option>
                    <option value="Single Bed">Single Bed</option>
                    <option value="Baby Bed">Baby Bed</option>
                    <option value="Extra Cot Added">Extra Cot Added</option>
                  </select>
                </div>
              )}

              {/* Quick Actions */}
              <div className="space-y-1 border-t border-border pt-1.5">
                {/* Switch Type */}
                <button
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium bg-sky-50 text-sky-700 hover:bg-sky-100 transition-colors"
                  disabled={actionLoading === `switch-${room.id}`}
                  onClick={async (e) => {
                    e.stopPropagation();
                    setActionLoading(`switch-${room.id}`);
                    const newType = isCheckout ? 'daily_cleaning' : 'checkout_cleaning';
                    const newIsCheckout = !isCheckout;
                    try {
                      const updates = [
                        supabase.from('rooms').update({ is_checkout_room: newIsCheckout } as any).eq('id', room.id).then(),
                      ];
                      if (assignment) {
                        updates.push(
                          supabase.from('room_assignments').update({ assignment_type: newType } as any).eq('room_id', room.id).eq('assignment_date', selectedDate).then()
                        );
                      }
                      await Promise.all(updates);
                      toast.success(`Room ${room.room_number} → ${newIsCheckout ? 'Checkout' : 'Daily'}`);
                      await fetchData();
                    } catch { toast.error('Failed'); }
                    finally { setActionLoading(null); }
                  }}
                >
                  <ArrowLeftRight className="h-3 w-3" /> Switch to {isCheckout ? 'Daily' : 'Checkout'}
                </button>

                {/* Status change - hidden for checkout rooms not yet ready */}
                {room.status === 'clean' && (
                  <button
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
                    disabled={actionLoading === `dirty-${room.id}`}
                    onClick={async (e) => {
                      e.stopPropagation();
                      setActionLoading(`dirty-${room.id}`);
                      try {
                        await supabase.from('rooms').update({ status: 'dirty' } as any).eq('id', room.id);
                        setRooms(prev => prev.map(r => r.id === room.id ? { ...r, status: 'dirty' } : r));
                        toast.success(`Room ${room.room_number} → Dirty`);
                      } catch { toast.error('Failed'); }
                      finally { setActionLoading(null); }
                    }}
                  >
                    Mark as Dirty
                  </button>
                )}
                {(room.status === 'dirty' || room.status === 'in_progress') && !(isCheckout && !assignment?.ready_to_clean) && (
                  <button
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                    disabled={actionLoading === `clean-${room.id}`}
                    onClick={async (e) => {
                      e.stopPropagation();
                      setActionLoading(`clean-${room.id}`);
                      try {
                        await supabase.from('rooms').update({ status: 'clean' } as any).eq('id', room.id);
                        setRooms(prev => prev.map(r => r.id === room.id ? { ...r, status: 'clean' } : r));
                        toast.success(`Room ${room.room_number} → Clean`);
                      } catch { toast.error('Failed'); }
                      finally { setActionLoading(null); }
                    }}
                  >
                    <CheckCircle className="h-3 w-3" /> Mark as Clean
                  </button>
                )}
              </div>

              {/* Notes - auto-save on blur */}
              {isManagerOrAdmin && (
                <div className="border-t border-border pt-1.5">
                  <textarea
                    className="w-full text-xs p-1.5 rounded border border-input bg-background min-h-[36px] resize-none placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="Manager notes..."
                    value={popoverNotes}
                    onChange={(e) => setPopoverNotes(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={async (e) => {
                      const textarea = e.target as HTMLTextAreaElement;
                      // Preserve flags when saving notes
                      const currentFlags = parseRoomFlags(room.notes);
                      const { buildRoomNotes } = await import('@/lib/room-service-flags');
                      const newFullNotes = buildRoomNotes(
                        { collectExtraTowels: currentFlags.collectExtraTowels, roomCleaning: currentFlags.roomCleaning },
                        popoverNotes
                      );
                      if (newFullNotes !== (room.notes || '')) {
                        try {
                          if (assignmentStatus === 'completed') {
                            toast.warning(`⚠️ Room ${room.room_number} was already cleaned. The housekeeper will need to be informed.`, { duration: 5000 });
                          }
                          await supabase.from('rooms').update({ notes: newFullNotes || null } as any).eq('id', room.id);
                          setRooms(prev => prev.map(r => r.id === room.id ? { ...r, notes: newFullNotes || null } : r));
                          // Show inline saved indicator
                          const parent = textarea.parentElement;
                          if (parent) {
                            const indicator = document.createElement('span');
                            indicator.className = 'text-[10px] text-emerald-600 font-medium animate-in fade-in';
                            indicator.textContent = '✓ Auto-saved';
                            parent.appendChild(indicator);
                            setTimeout(() => indicator.remove(), 2000);
                          }
                        } catch { toast.error('Failed to save notes'); }
                      }
                    }}
                  />
                </div>
              )}

              {/* Send Message to Housekeeper */}
              {isManagerOrAdmin && assignment && (
                <div className="border-t border-border pt-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">💬 Message Housekeeper</p>
                  <div className="flex gap-1">
                    <input
                      className="flex-1 text-xs p-1.5 rounded border border-input bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      placeholder="Type message..."
                      value={managerMessage}
                      onChange={(e) => setManagerMessage(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).nextElementSibling?.dispatchEvent(new Event('click', { bubbles: true })); } }}
                    />
                    <button
                      className="px-2 py-1.5 rounded text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                      disabled={!managerMessage.trim() || actionLoading === `msg-${room.id}`}
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!managerMessage.trim()) return;
                        setActionLoading(`msg-${room.id}`);
                        try {
                          const userId = (await supabase.auth.getUser()).data.user?.id;
                          const { error } = await supabase.from('housekeeping_notes').insert({
                            room_id: room.id,
                            assignment_id: null,
                            content: managerMessage,
                            note_type: 'message',
                            created_by: userId
                          } as any);
                          if (error) throw error;
                          setManagerMessage('');
                          toast.success(`Message sent for Room ${room.room_number}`);
                        } catch { toast.error('Failed to send'); }
                        finally { setActionLoading(null); }
                      }}
                    >
                      <MessageSquare className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )}

              {/* No Service Override */}
              {isManagerOrAdmin && assignment && !assignment.notes?.includes('[NO_SERVICE]') && (
                <button
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  disabled={actionLoading === `ns-${room.id}`}
                  onClick={async (e) => {
                    e.stopPropagation();
                    setActionLoading(`ns-${room.id}`);
                    try {
                      const now = new Date().toISOString();
                      const currentNotes = assignment.notes || '';
                      await supabase.from('room_assignments').update({
                        status: 'completed',
                        completed_at: now,
                        notes: `${currentNotes}\n[NO_SERVICE] Manager override`.trim()
                      } as any).eq('room_id', room.id).eq('assignment_date', selectedDate);
                      toast.success(`Room ${room.room_number} marked No Service`);
                      await fetchData();
                    } catch { toast.error('Failed'); }
                    finally { setActionLoading(null); }
                  }}
                >
                  <Ban className="h-3 w-3" /> Mark No Service
                </button>
              )}

              {/* Settings link */}
              {isManagerOrAdmin && (
                <button
                  className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    openSettingsDialog(room);
                  }}
                >
                  <Settings className="h-3 w-3" /> Room Settings...
                </button>
              )}
            </div>
          </PopoverContent>
        </Popover>
      );
    }

    // Mobile / non-interactive: simple chip (click opens dialog on mobile)
    return (
      <React.Fragment key={room.id}>
        {chipContent}
      </React.Fragment>
    );
  };

  const handleDrop = async (e: React.DragEvent, targetType: 'checkout' | 'daily') => {
    e.preventDefault();
    setDragOverSection(null);
    const roomId = e.dataTransfer.getData('roomId');
    const roomNumber = e.dataTransfer.getData('roomNumber');
    const sourceType = e.dataTransfer.getData('sourceType');
    if (!roomId || sourceType === targetType) return;

    const newIsCheckout = targetType === 'checkout';
    const newAssignmentType = newIsCheckout ? 'checkout_cleaning' : 'daily_cleaning';
    const assignment = assignmentMap.get(roomId);

    // Optimistic update
    setRooms(prev => prev.map(r => r.id === roomId ? { ...r, is_checkout_room: newIsCheckout } : r));

    try {
      const roomUpdate = supabase.from('rooms').update({ is_checkout_room: newIsCheckout } as any).eq('id', roomId);
      const promises: any[] = [roomUpdate];
      if (assignment) {
        const assignmentUpdate: any = { assignment_type: newAssignmentType };
        if (newIsCheckout) {
          assignmentUpdate.ready_to_clean = false;
        } else {
          assignmentUpdate.ready_to_clean = null;
        }
        promises.push(
          supabase.from('room_assignments').update(assignmentUpdate).eq('room_id', roomId).eq('assignment_date', selectedDate)
        );
      }
      await Promise.all(promises);
      toast.success(`Room ${roomNumber} → ${newIsCheckout ? 'Checkout' : 'Daily'}`);
      await fetchData();
    } catch {
      toast.error('Failed to switch room type');
      await fetchData(); // revert
    }
  };

  const renderSection = (title: string, roomList: RoomData[], icon: React.ReactNode, sectionType: 'checkout' | 'daily') => {
    const floors = groupByFloor(roomList);
    const dndCount = roomList.filter(r => r.is_dnd).length;
    const isDragOver = dragOverSection === sectionType;

    return (
      <div
        className={`space-y-2 rounded-lg transition-all duration-200 ${
          isDragOver ? 'ring-2 ring-primary/40 bg-primary/5 p-2 -m-2' : ''
        }`}
        onDragOver={isManagerOrAdmin ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverSection(sectionType); } : undefined}
        onDragEnter={isManagerOrAdmin ? (e) => { e.preventDefault(); setDragOverSection(sectionType); } : undefined}
        onDragLeave={isManagerOrAdmin ? (e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverSection(null);
        } : undefined}
        onDrop={isManagerOrAdmin ? (e) => handleDrop(e, sectionType) : undefined}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            {icon}
            <span className="text-sm font-semibold">{title}</span>
            <Badge variant="secondary" className="text-xs">{roomList.length}</Badge>
            {sectionType === 'checkout' && roomList.length > 0 && (() => {
              const pmsCount = roomList.filter(r => r.is_checkout_room).length;
              const manualCount = roomList.length - pmsCount;
              if (pmsCount === 0 && manualCount === 0) return null;
              return (
                <span className="text-[10px] text-muted-foreground">
                  {pmsCount} PMS · {manualCount} manual
                </span>
              );
            })()}
            {isDragOver && <Badge className="text-[10px] bg-primary/20 text-primary border-primary/30 animate-pulse">Drop here</Badge>}
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
        <CardHeader className="pb-2 pt-3 px-3 sm:px-4 space-y-3">
          {/* Row 1: Title + actions */}
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm sm:text-base font-semibold flex items-center gap-1.5 min-w-0">
              <Hotel className="h-4 w-4 text-primary shrink-0" />
              <span className="truncate">Hotel Room Overview</span>
            </CardTitle>
            <div className="flex items-center gap-1 shrink-0">
              {canViewFullOverview && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={() => setViewMode(viewMode === 'list' ? 'map' : 'list')}
                  aria-label={viewMode === 'list' ? 'Switch to map view' : 'Switch to list view'}
                >
                  <MapIcon className="h-3.5 w-3.5 sm:mr-1" />
                  <span className="hidden sm:inline">{viewMode === 'list' ? 'Map' : 'List'}</span>
                </Button>
              )}
              <HelpTooltip hint={UI_HINTS["room.refresh"]}>
                <Button
                  variant="default"
                  size="sm"
                  className="h-8 px-2 sm:px-3 text-xs font-semibold shadow-sm"
                  onClick={handleRefresh}
                  disabled={refreshing}
                  aria-label="Refresh"
                >
                  <RefreshCw className={`h-3.5 w-3.5 sm:mr-1 ${refreshing ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">{refreshing ? 'Refreshing...' : 'Refresh'}</span>
                </Button>
              </HelpTooltip>
            </div>
          </div>

          {/* Row 2: Compact stat grid */}
          <div className="grid grid-cols-4 gap-2">
            <div className="rounded-lg border bg-muted/40 px-2 py-1.5 text-center">
              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Total</div>
              <div className="text-sm font-semibold leading-tight">{rooms.length}</div>
            </div>
            <div className={`rounded-lg border px-2 py-1.5 text-center ${earlyCheckoutRooms.length > 0 ? 'bg-orange-50 border-orange-200 dark:bg-orange-900/20 dark:border-orange-700' : 'bg-muted/40'}`}>
              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Early C/O</div>
              <div className={`text-sm font-semibold leading-tight ${earlyCheckoutRooms.length > 0 ? 'text-orange-700 dark:text-orange-300' : ''}`}>{earlyCheckoutRooms.length}</div>
            </div>
            <div className={`rounded-lg border px-2 py-1.5 text-center ${noShowRooms.length > 0 ? 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-700' : 'bg-muted/40'}`}>
              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">No-Show</div>
              <div className={`text-sm font-semibold leading-tight ${noShowRooms.length > 0 ? 'text-red-700 dark:text-red-300' : ''}`}>{noShowRooms.length}</div>
            </div>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="rounded-lg border bg-muted/40 px-2 py-1.5 text-center cursor-help">
                    <div className="text-[9px] uppercase tracking-wide text-muted-foreground">ACT</div>
                    <div className="text-sm font-semibold leading-tight">{averageCleanTime !== null ? `${averageCleanTime}m` : '--'}</div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {t('room.actTooltip')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          {/* Row 3: Toggle Legend (collapsed by default) */}
          <div>
            <button
              onClick={() => setShowLegend(prev => !prev)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown className={`h-3 w-3 transition-transform ${showLegend ? '' : '-rotate-90'}`} />
              {showLegend ? t('legend.hideLegend') : t('legend.showLegend')}
            </button>
            {showLegend && (
              <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-x-3 gap-y-1.5 mt-2 p-2 rounded-md bg-muted/30 border border-border/50">
                {[
                  { label: t('legend.approvedClean'), cls: 'bg-emerald-200 border-emerald-500', hint: t('legend.approvedCleanHint') },
                  { label: t('legend.dirtyAssigned'), cls: 'bg-amber-200 border-amber-500', hint: t('legend.dirtyAssignedHint') },
                  { label: t('legend.inProgress'), cls: 'bg-sky-200 border-sky-500', hint: t('legend.inProgressHint') },
                  { label: t('legend.pendingApproval'), cls: 'bg-violet-200 border-violet-500', hint: UI_HINTS["room.pendingApproval"] },
                  { label: t('legend.overdue'), cls: 'bg-rose-300 border-rose-600', hint: UI_HINTS["room.overdue"] },
                  { label: t('legend.outOfOrder'), cls: 'bg-red-200 border-red-500', hint: t('legend.outOfOrderHint') },
                  { label: t('legend.dnd'), cls: 'ring-2 ring-purple-500 bg-muted', hint: UI_HINTS["room.dnd"] },
                  { label: t('legend.noShow'), cls: 'ring-2 ring-red-600 bg-muted', hint: UI_HINTS["room.noShow"] },
                  { label: t('legend.earlyCheckout'), cls: 'ring-2 ring-orange-500 bg-muted', hint: UI_HINTS["room.earlyCheckout"] },
                  { label: t('legend.towelChange'), cls: 'bg-blue-600 text-white text-[8px] font-bold px-0.5', isText: true, text: 'T', hint: UI_HINTS["room.towelChange"] },
                  { label: 'Clean Room', cls: 'bg-orange-500 text-white text-[8px] font-bold px-0.5', isText: true, text: 'C', hint: UI_HINTS["room.linenChange"] },
                  { label: t('legend.roomCleaning'), cls: 'bg-green-600 text-white text-[8px] font-bold px-0.5', isText: true, text: 'RC', hint: t('legend.roomCleaningHint') },
                  { label: t('legend.extraTowels'), cls: 'bg-orange-500 text-white text-[8px] font-bold px-0.5', isText: true, text: '🧺', hint: t('legend.extraTowelsHint') },
                  { label: t('legend.readyToClean'), cls: 'bg-green-600 text-white text-[8px] font-bold px-0.5', isText: true, text: 'RTC', hint: UI_HINTS["room.rtc"] },
                  { label: t('legend.approved'), cls: 'text-[10px]', isText: true, text: '✅', hint: t('legend.approvedHint') },
                ].map(item => (
                  <HelpTooltip key={item.label} hint={(item as any).hint}>
                    <div className="flex items-center gap-1 cursor-help">
                      {(item as any).isText ? (
                        <span className={`rounded ${item.cls}`}>{(item as any).text}</span>
                      ) : (
                        <div className={`w-3 h-3 rounded border-2 ${item.cls}`} />
                      )}
                      <span className="text-[10px] text-muted-foreground">{item.label}</span>
                    </div>
                  </HelpTooltip>
                ))}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-3 space-y-3">
          {viewMode === 'map' ? (
            <HotelFloorMap
              rooms={rooms}
              assignments={assignmentMap}
              staffMap={staffMap}
              onRoomClick={canInteractWithRooms ? handleRoomClick : undefined}
              hotelName={hotelName}
              isAdmin={profile?.role === 'admin'}
            />
          ) : (
            <>
               {renderSection('Checkout Rooms', checkoutRooms, <BedDouble className="h-3.5 w-3.5 text-amber-600" />, 'checkout')}
               <div className="border-t border-border/50" />
               {renderSection('Daily Rooms', dailyRooms, <BedDouble className="h-3.5 w-3.5 text-blue-600" />, 'daily')}
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
        <DialogContent className="w-[calc(100vw-2rem)] max-w-sm max-h-[85vh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Room {selectedRoom?.room_number} {selectedRoom?.wing ? `(Wing ${selectedRoom.wing})` : ''}
              {selectedRoom && (
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                  selectedRoom.status === 'clean' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' :
                  selectedRoom.status === 'in_progress' ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' :
                  'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                }`}>
                  {selectedRoom.status === 'in_progress' ? 'In Progress' : selectedRoom.status === 'clean' ? 'Clean' : 'Dirty'}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* Room Status */}
            {selectedRoom && (() => {
              const assignment = assignmentMap.get(selectedRoom.id);
              const isCheckout = assignment?.assignment_type === 'checkout_cleaning' || selectedRoom.is_checkout_room;
              const roomStatus = selectedRoom.status;
              return (
                <>
                  {/* Room Status Section */}
                  <div className="space-y-2 pb-3 border-b">
                    <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">🔄 Change Room Status</label>
                    <p className="text-[11px] text-muted-foreground -mt-1">Manually update this room's cleaning status</p>
                    <div className="flex gap-2">
                      {roomStatus === 'clean' && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-600 dark:text-amber-300 dark:hover:bg-amber-900/30"
                          disabled={actionLoading === 'dirty'}
                          onClick={async () => {
                            setActionLoading('dirty');
                            try {
                              const { error } = await supabase
                                .from('rooms')
                                .update({ status: 'dirty' } as any)
                                .eq('id', selectedRoom.id);
                              if (error) throw error;
                              setRooms(prev => prev.map(r => r.id === selectedRoom.id ? { ...r, status: 'dirty' } : r));
                              toast.success(`Room ${selectedRoom.room_number} marked as dirty`);
                              setRoomSizeDialogOpen(false);
                              await fetchData();
                            } catch (err) {
                              toast.error('Failed to update room status');
                            } finally {
                              setActionLoading(null);
                            }
                          }}
                        >
                          {actionLoading === 'dirty' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          Mark as Dirty
                        </Button>
                      )}
                      {(roomStatus === 'dirty' || roomStatus === 'in_progress') && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-600 dark:text-emerald-300 dark:hover:bg-emerald-900/30"
                          disabled={actionLoading === 'clean'}
                          onClick={async () => {
                            setActionLoading('clean');
                            try {
                              const { error } = await supabase
                                .from('rooms')
                                .update({ status: 'clean' } as any)
                                .eq('id', selectedRoom.id);
                              if (error) throw error;
                              setRooms(prev => prev.map(r => r.id === selectedRoom.id ? { ...r, status: 'clean' } : r));
                              toast.success(`Room ${selectedRoom.room_number} marked as clean`);
                              setRoomSizeDialogOpen(false);
                              await fetchData();
                            } catch (err) {
                              toast.error('Failed to update room status');
                            } finally {
                              setActionLoading(null);
                            }
                          }}
                        >
                          {actionLoading === 'clean' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                          Mark as Clean
                        </Button>
                      )}
                      {roomStatus === 'dirty' && assignment?.status === 'assigned' && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 gap-1.5 border-sky-300 text-sky-700 hover:bg-sky-50 dark:border-sky-600 dark:text-sky-300 dark:hover:bg-sky-900/30"
                          disabled={actionLoading === 'start'}
                          onClick={async () => {
                            setActionLoading('start');
                            try {
                              const { error } = await supabase
                                .from('room_assignments')
                                .update({ status: 'in_progress', started_at: new Date().toISOString() } as any)
                                .eq('room_id', selectedRoom.id)
                                .eq('assignment_date', selectedDate);
                              if (error) throw error;
                              setAssignments(prev => prev.map(a => a.room_id === selectedRoom.id ? { ...a, status: 'in_progress', started_at: new Date().toISOString() } : a));
                              setRooms(prev => prev.map(r => r.id === selectedRoom.id ? { ...r, status: 'in_progress' } : r));
                              toast.success(`Room ${selectedRoom.room_number} cleaning started`);
                              setRoomSizeDialogOpen(false);
                              await fetchData();
                            } catch (err) {
                              toast.error('Failed to start cleaning');
                            } finally {
                              setActionLoading(null);
                            }
                          }}
                        >
                          {actionLoading === 'start' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          Start Cleaning
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Special Instructions Section */}
                  <div className="space-y-2 pb-3 border-b">
                    <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">🧺 Towel & Linen Change</label>
                    <div className="grid grid-cols-1 gap-2">
                      <Button
                        variant={selectedRoom.towel_change_required ? "default" : "outline"}
                        size="sm"
                        className={`w-full justify-start gap-2 text-xs ${selectedRoom.towel_change_required 
                          ? 'bg-red-600 hover:bg-red-700 text-white' 
                          : 'border-border hover:bg-accent'}`}
                        disabled={actionLoading === 'towel'}
                        onClick={async () => {
                          setActionLoading('towel');
                          const newVal = !selectedRoom.towel_change_required;
                          try {
                            const { error } = await supabase
                              .from('rooms')
                              .update({ towel_change_required: newVal } as any)
                              .eq('id', selectedRoom.id);
                            if (error) throw error;
                            setRooms(prev => prev.map(r => r.id === selectedRoom.id ? { ...r, towel_change_required: newVal } : r));
                            setSelectedRoom(prev => prev ? { ...prev, towel_change_required: newVal } : prev);
                            toast.success(`Towel change ${newVal ? 'enabled' : 'disabled'} for room ${selectedRoom.room_number}`);
                          } catch (err) {
                            toast.error('Failed to toggle towel change');
                          } finally {
                            setActionLoading(null);
                          }
                        }}
                      >
                        {actionLoading === 'towel' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        🔄 Towel: {selectedRoom.towel_change_required ? 'Required' : 'Not Required'}
                      </Button>
                      <Button
                        variant={selectedRoom.linen_change_required ? "default" : "outline"}
                        size="sm"
                        className={`w-full justify-start gap-2 text-xs ${selectedRoom.linen_change_required 
                          ? 'bg-red-600 hover:bg-red-700 text-white' 
                          : 'border-border hover:bg-accent'}`}
                        disabled={actionLoading === 'linen'}
                        onClick={async () => {
                          setActionLoading('linen');
                          const newVal = !selectedRoom.linen_change_required;
                          try {
                            const { error } = await supabase
                              .from('rooms')
                              .update({ linen_change_required: newVal } as any)
                              .eq('id', selectedRoom.id);
                            if (error) throw error;
                            setRooms(prev => prev.map(r => r.id === selectedRoom.id ? { ...r, linen_change_required: newVal } : r));
                            setSelectedRoom(prev => prev ? { ...prev, linen_change_required: newVal } : prev);
                            toast.success(`Linen change ${newVal ? 'enabled' : 'disabled'} for room ${selectedRoom.room_number}`);
                          } catch (err) {
                            toast.error('Failed to toggle linen change');
                          } finally {
                            setActionLoading(null);
                          }
                        }}
                      >
                        {actionLoading === 'linen' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        🛏️ Linen: {selectedRoom.linen_change_required ? 'Required' : 'Not Required'}
                      </Button>
                    </div>
                  </div>

                  {/* Manager Notes Section - only for managers/admins */}
                  {isManagerOrAdmin && (
                    <div className="space-y-2 pb-3 border-b">
                      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">📝 Manager Notes</label>
                      <Textarea
                        value={roomNotes}
                        onChange={(e) => setRoomNotes(e.target.value)}
                        placeholder="Add notes for housekeepers..."
                        className="min-h-[60px] text-sm"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        disabled={actionLoading === 'notes'}
                        onClick={async () => {
                          setActionLoading('notes');
                          try {
                            const { error } = await supabase
                              .from('rooms')
                              .update({ notes: roomNotes || null } as any)
                              .eq('id', selectedRoom.id);
                            if (error) throw error;
                            setRooms(prev => prev.map(r => r.id === selectedRoom.id ? { ...r, notes: roomNotes || null } : r));
                            toast.success(`Notes saved for room ${selectedRoom.room_number}`);
                          } catch (err) {
                            toast.error('Failed to save notes');
                          } finally {
                            setActionLoading(null);
                          }
                        }}
                      >
                        {actionLoading === 'notes' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                        Save Notes
                      </Button>
                    </div>
                  )}

                  {/* Quick Actions Section */}
                  <div className="space-y-2 pb-3 border-b">
                    <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">⚡ Quick Actions</label>
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
                              const { error } = await supabase
                                .from('rooms')
                                .update({ status: 'ready_to_clean' } as any)
                                .eq('id', selectedRoom.id);
                              if (error) throw error;
                            }
                            if (assignment) {
                              setAssignments(prev => prev.map(a => 
                                a.room_id === selectedRoom.id ? { ...a, ready_to_clean: true } : a
                              ));
                            }
                            toast.success(`Room ${selectedRoom.room_number} marked as ready to clean`);
                            setRoomSizeDialogOpen(false);
                            await fetchData();
                          } catch (err) {
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
                          const updates = [
                            supabase
                              .from('rooms')
                              .update({ is_checkout_room: newIsCheckout } as any)
                              .eq('id', selectedRoom.id)
                              .then(),
                          ];
                          if (assignment) {
                            updates.push(
                              supabase
                                .from('room_assignments')
                                .update({ assignment_type: newType } as any)
                                .eq('room_id', selectedRoom.id)
                                .eq('assignment_date', selectedDate)
                                .then()
                            );
                          }
                          const results = await Promise.all(updates);
                          if (results.some(r => r.error)) throw results.find(r => r.error)?.error;
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
                  </div>
                </>
              );
            })()}

            {/* Room Settings Section - only for managers/admins */}
            {isManagerOrAdmin && (
              <>
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">⚙️ Room Settings</label>
                <p className="text-xs text-muted-foreground">Size affects auto-assignment workload balancing.</p>
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
                {/* Bed Configuration */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">🛏️ Bed Configuration</label>
                  <p className="text-xs text-muted-foreground">Set the current guest bed requirement</p>
                  <Select
                    value={(selectedRoom as any)?.bed_configuration || 'none'}
                    onValueChange={async (val) => {
                      const newVal = val === 'none' ? null : val;
                      try {
                        const { error } = await supabase
                          .from('rooms')
                          .update({ bed_configuration: newVal } as any)
                          .eq('id', selectedRoom!.id);
                        if (error) throw error;
                        setRooms(prev => prev.map(r => r.id === selectedRoom!.id ? { ...r, bed_configuration: newVal } : r));
                        setSelectedRoom((prev: any) => prev ? { ...prev, bed_configuration: newVal } : prev);
                        toast.success(`Bed configuration updated for room ${selectedRoom!.room_number}`);
                      } catch (err) {
                        toast.error('Failed to update bed configuration');
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select bed configuration" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="Double Bed">Double Bed</SelectItem>
                      <SelectItem value="Twin Beds">Twin Beds</SelectItem>
                      <SelectItem value="Twin Beds Separated">Twin Beds Separated</SelectItem>
                      <SelectItem value="Single Bed">Single Bed</SelectItem>
                      <SelectItem value="Extra Cot Added">Extra Cot Added</SelectItem>
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
              </>
            )}
            {!isManagerOrAdmin && (
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setRoomSizeDialogOpen(false)}>
                  Close
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
