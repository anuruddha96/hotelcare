import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Hotel, BedDouble, Ban, EyeOff } from 'lucide-react';
import { getLocalDateString } from '@/lib/utils';

interface RoomData {
  id: string;
  room_number: string;
  floor_number: number | null;
  status: string | null;
  is_checkout_room: boolean | null;
  is_dnd: boolean | null;
}

interface AssignmentData {
  room_id: string;
  assigned_to: string;
  status: string;
  assignment_type: string;
}

interface StaffMap {
  [id: string]: string; // id -> name
}

interface HotelRoomOverviewProps {
  selectedDate: string;
  hotelName: string;
  staffMap: StaffMap;
}

const STATUS_COLORS: Record<string, string> = {
  clean: 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/40 dark:text-green-300 dark:border-green-700',
  dirty: 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-700',
  in_progress: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700',
  out_of_order: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700',
  inspected: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700',
};

const DEFAULT_COLOR = 'bg-muted text-muted-foreground border-border';

export function HotelRoomOverview({ selectedDate, hotelName, staffMap }: HotelRoomOverviewProps) {
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [assignments, setAssignments] = useState<AssignmentData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [selectedDate, hotelName]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [roomsRes, assignmentsRes] = await Promise.all([
        supabase
          .from('rooms')
          .select('id, room_number, floor_number, status, is_checkout_room, is_dnd')
          .eq('hotel', hotelName)
          .order('room_number'),
        supabase
          .from('room_assignments')
          .select('room_id, assigned_to, status, assignment_type')
          .eq('assignment_date', selectedDate)
      ]);

      setRooms(roomsRes.data || []);
      
      // Filter assignments to only rooms in this hotel
      const roomIds = new Set((roomsRes.data || []).map(r => r.id));
      setAssignments((assignmentsRes.data || []).filter(a => roomIds.has(a.room_id)));
    } catch (error) {
      console.error('Error fetching room overview:', error);
    } finally {
      setLoading(false);
    }
  };

  const assignmentMap = new Map<string, AssignmentData>();
  assignments.forEach(a => assignmentMap.set(a.room_id, a));

  // Determine room type from assignment or is_checkout_room flag
  const checkoutRooms = rooms.filter(r => {
    const assignment = assignmentMap.get(r.id);
    return r.is_checkout_room || assignment?.assignment_type === 'checkout_cleaning';
  });
  const dailyRooms = rooms.filter(r => {
    const assignment = assignmentMap.get(r.id);
    return !r.is_checkout_room && assignment?.assignment_type !== 'checkout_cleaning';
  });

  // Check for no-show: room is dirty but not checkout and has no assignment
  const isNoShow = (room: RoomData) => {
    return room.status === 'dirty' && !assignmentMap.has(room.id) && !room.is_checkout_room;
  };

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
    // Return short name (first name or nickname)
    const parts = name.split(' ');
    return parts[0].length <= 8 ? parts[0] : parts[0].substring(0, 7) + '.';
  };

  const getAssignmentStatus = (roomId: string): string | null => {
    return assignmentMap.get(roomId)?.status || null;
  };

  const renderRoomChip = (room: RoomData) => {
    const statusKey = getAssignmentStatus(room.id) === 'in_progress' ? 'in_progress' 
      : getAssignmentStatus(room.id) === 'completed' ? 'clean' 
      : room.status || 'dirty';
    const colorClass = STATUS_COLORS[statusKey] || DEFAULT_COLOR;
    const isDND = room.is_dnd;
    const noShow = isNoShow(room);
    const staffName = getStaffName(room.id);

    return (
      <TooltipProvider key={room.id} delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex flex-col items-center gap-0.5">
              <div
                className={`
                  px-2 py-1 rounded text-xs font-semibold border transition-all min-w-[40px] text-center
                  ${colorClass}
                  ${isDND ? 'ring-2 ring-purple-500 ring-offset-1' : ''}
                  ${noShow ? 'line-through opacity-60' : ''}
                `}
              >
                {room.room_number}
                {isDND && <span className="ml-0.5 text-[9px]">🚫</span>}
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
              <p>Status: {room.status || 'unknown'}</p>
              {isDND && <p className="text-purple-600 font-medium">🚫 Do Not Disturb</p>}
              {noShow && <p className="text-gray-500">No Show</p>}
              {staffName && <p>Assigned: {staffMap[assignmentMap.get(room.id)?.assigned_to || ''] || staffName}</p>}
              {getAssignmentStatus(room.id) && <p>Task: {getAssignmentStatus(room.id)}</p>}
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
    <Card className="border-primary/20">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Hotel className="h-4 w-4 text-primary" />
          Hotel Room Overview
          <Badge variant="secondary" className="text-xs ml-auto">{rooms.length} rooms</Badge>
        </CardTitle>
        {/* Legend */}
        <div className="flex flex-wrap gap-2 mt-1">
          {[
            { label: 'Clean', cls: 'bg-green-100 border-green-300' },
            { label: 'Dirty', cls: 'bg-orange-100 border-orange-300' },
            { label: 'In Progress', cls: 'bg-blue-100 border-blue-300' },
            { label: 'Out of Order', cls: 'bg-red-100 border-red-300' },
            { label: 'DND', cls: 'ring-2 ring-purple-500 bg-muted' },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-1">
              <div className={`w-3 h-3 rounded border ${item.cls}`} />
              <span className="text-[10px] text-muted-foreground">{item.label}</span>
            </div>
          ))}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-3">
        {renderSection('Checkout Rooms', checkoutRooms, <BedDouble className="h-3.5 w-3.5 text-amber-600" />)}
        <div className="border-t border-border/50" />
        {renderSection('Daily Rooms', dailyRooms, <BedDouble className="h-3.5 w-3.5 text-blue-600" />)}
      </CardContent>
    </Card>
  );
}
