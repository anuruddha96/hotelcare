import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface RoomData {
  id: string;
  room_number: string;
  floor_number: number | null;
  status: string | null;
  is_checkout_room: boolean | null;
  is_dnd: boolean | null;
  wing: string | null;
  room_category: string | null;
  room_size_sqm: number | null;
}

interface AssignmentData {
  room_id: string;
  assigned_to: string;
  status: string;
}

interface HotelFloorMapProps {
  rooms: RoomData[];
  assignments: Map<string, AssignmentData>;
  staffMap: Record<string, string>;
  onRoomClick?: (room: RoomData) => void;
}

const STATUS_COLORS: Record<string, string> = {
  clean: 'bg-green-200 text-green-900 border-green-400',
  dirty: 'bg-orange-200 text-orange-900 border-orange-400',
  in_progress: 'bg-blue-200 text-blue-900 border-blue-400',
  out_of_order: 'bg-red-200 text-red-900 border-red-400',
  inspected: 'bg-emerald-200 text-emerald-900 border-emerald-400',
};

const WING_INFO: Record<string, { label: string; view?: string }> = {
  A: { label: 'Wing A' },
  B: { label: 'Wing B' },
  C: { label: 'Wing C' },
  D: { label: 'Wing D', view: 'Synagogue View' },
  E: { label: 'Wing E', view: 'Courtyard Inner' },
  F: { label: 'Wing F', view: 'Courtyard' },
  G: { label: 'Wing G', view: 'Courtyard' },
  H: { label: 'Wing H', view: 'Street View' },
  I: { label: 'Wing I' },
  J: { label: 'Wing J', view: 'Synagogue View' },
  K: { label: 'Wing K', view: 'Courtyard' },
  L: { label: 'Wing L' },
};

const FLOOR_ORDER = [0, 1, 2, 3];
const FLOOR_LABELS: Record<number, string> = {
  0: 'Ground Floor',
  1: '1st Floor',
  2: '2nd Floor',
  3: '3rd Floor',
};

const FLOOR_WINGS: Record<number, string[]> = {
  0: ['A', 'B', 'C'],
  1: ['D', 'E', 'F', 'G', 'H'],
  2: ['I', 'J', 'K'],
  3: ['L'],
};

export function HotelFloorMap({ rooms, assignments, staffMap, onRoomClick }: HotelFloorMapProps) {
  const roomsByWing = new Map<string, RoomData[]>();
  rooms.forEach(room => {
    const wing = room.wing || 'unknown';
    if (!roomsByWing.has(wing)) roomsByWing.set(wing, []);
    roomsByWing.get(wing)!.push(room);
  });

  const getAssignmentStatus = (roomId: string): string | null => {
    return assignments.get(roomId)?.status || null;
  };

  const getStaffName = (roomId: string): string | null => {
    const assignment = assignments.get(roomId);
    if (!assignment) return null;
    return staffMap[assignment.assigned_to] || null;
  };

  const renderRoom = (room: RoomData) => {
    const assignStatus = getAssignmentStatus(room.id);
    const statusKey = assignStatus === 'in_progress' ? 'in_progress'
      : assignStatus === 'completed' ? 'clean'
      : room.status || 'dirty';
    const colorClass = STATUS_COLORS[statusKey] || 'bg-muted text-muted-foreground border-border';
    const staff = getStaffName(room.id);

    return (
      <TooltipProvider key={room.id} delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => onRoomClick?.(room)}
              className={`
                px-1.5 py-0.5 rounded text-[10px] font-bold border min-w-[32px] text-center
                transition-all hover:scale-110 hover:shadow-md
                ${colorClass}
                ${room.is_dnd ? 'ring-2 ring-purple-500 ring-offset-1' : ''}
              `}
            >
              {room.room_number}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <p className="font-semibold">Room {room.room_number}</p>
            <p>Status: {room.status || 'unknown'}</p>
            {room.room_category && <p className="text-[10px]">{room.room_category}</p>}
            {room.room_size_sqm && <p>Size: ~{room.room_size_sqm}m²</p>}
            {staff && <p>Assigned: {staff}</p>}
            {room.is_dnd && <p className="text-purple-600">🚫 DND</p>}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  return (
    <div className="space-y-3">
      {FLOOR_ORDER.map(floor => {
        const wings = FLOOR_WINGS[floor] || [];
        const hasRooms = wings.some(w => (roomsByWing.get(w) || []).length > 0);
        if (!hasRooms) return null;

        return (
          <div key={floor} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] font-bold">
                {FLOOR_LABELS[floor]}
              </Badge>
              {floor === 0 && (
                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                  🛗 Elevator
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              {wings.map(wingKey => {
                const wingRooms = (roomsByWing.get(wingKey) || []).sort(
                  (a, b) => parseInt(a.room_number) - parseInt(b.room_number)
                );
                if (wingRooms.length === 0) return null;
                const info = WING_INFO[wingKey];

                return (
                  <div key={wingKey} className="border border-border/50 rounded-lg p-2 bg-muted/30">
                    <div className="flex items-center gap-1 mb-1">
                      <span className="text-[10px] font-bold text-primary">{info?.label || wingKey}</span>
                      {info?.view && (
                        <span className="text-[9px] text-muted-foreground">({info.view})</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {wingRooms.map(room => renderRoom(room))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
