import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { RotateCw, Move, Save, RotateCcw, Pencil } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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
  bed_type: string | null;
  towel_change_required: boolean | null;
  linen_change_required: boolean | null;
}

interface AssignmentData {
  room_id: string;
  assigned_to: string;
  status: string;
}

interface WingLayout {
  x: number;
  y: number;
  rotation: number;
}

interface HotelFloorMapProps {
  rooms: RoomData[];
  assignments: Map<string, AssignmentData>;
  staffMap: Record<string, string>;
  onRoomClick?: (room: RoomData) => void;
  hotelName: string;
  isAdmin?: boolean;
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

function getDefaultLayout(floor: number, wingKey: string, wingIndex: number): WingLayout {
  const totalWings = FLOOR_WINGS[floor]?.length || 1;
  const spacing = 100 / (totalWings + 1);
  return {
    x: spacing * (wingIndex + 1) - 10,
    y: 20,
    rotation: 0,
  };
}

export function HotelFloorMap({ rooms, assignments, staffMap, onRoomClick, hotelName, isAdmin }: HotelFloorMapProps) {
  const [editMode, setEditMode] = useState(false);
  const [layouts, setLayouts] = useState<Record<string, WingLayout>>({});
  const [savedLayouts, setSavedLayouts] = useState<Record<string, WingLayout>>({});
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [rotating, setRotating] = useState<string | null>(null);
  const dragStart = useRef<{ x: number; y: number; layoutX: number; layoutY: number } | null>(null);
  const rotateStart = useRef<{ centerX: number; centerY: number; startAngle: number; layoutRotation: number } | null>(null);
  const containerRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const canvasRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const roomsByWing = new Map<string, RoomData[]>();
  rooms.forEach(room => {
    const wing = room.wing || 'unknown';
    if (!roomsByWing.has(wing)) roomsByWing.set(wing, []);
    roomsByWing.get(wing)!.push(room);
  });

  // Load layouts from DB
  useEffect(() => {
    if (!hotelName) return;
    const loadLayouts = async () => {
      const { data } = await supabase
        .from('hotel_floor_layouts')
        .select('floor_number, wing, x, y, rotation')
        .eq('hotel_name', hotelName);

      if (data && data.length > 0) {
        const map: Record<string, WingLayout> = {};
        data.forEach(row => {
          map[`${row.floor_number}-${row.wing}`] = {
            x: Number(row.x),
            y: Number(row.y),
            rotation: Number(row.rotation),
          };
        });
        setLayouts(map);
        setSavedLayouts(map);
      }
    };
    loadLayouts();
  }, [hotelName]);

  const getLayout = (floor: number, wing: string, wingIndex: number): WingLayout => {
    const key = `${floor}-${wing}`;
    return layouts[key] || getDefaultLayout(floor, wing, wingIndex);
  };

  const setWingLayout = (floor: number, wing: string, layout: WingLayout) => {
    setLayouts(prev => ({ ...prev, [`${floor}-${wing}`]: layout }));
  };

  // Drag handlers
  const handleDragStart = (e: React.PointerEvent, floor: number, wing: string, wingIndex: number) => {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    const layout = getLayout(floor, wing, wingIndex);
    const canvas = canvasRefs.current[floor];
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      layoutX: layout.x,
      layoutY: layout.y,
    };
    setDragging(`${floor}-${wing}`);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleDragMove = (e: React.PointerEvent, floor: number, wing: string) => {
    if (!dragging || dragging !== `${floor}-${wing}` || !dragStart.current) return;
    const canvas = canvasRefs.current[floor];
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dx = ((e.clientX - dragStart.current.x) / rect.width) * 100;
    const dy = ((e.clientY - dragStart.current.y) / rect.height) * 100;
    setWingLayout(floor, wing, {
      ...getLayout(floor, wing, 0),
      x: dragStart.current.layoutX + dx,
      y: dragStart.current.layoutY + dy,
    });
  };

  const handleDragEnd = () => {
    setDragging(null);
    dragStart.current = null;
  };

  // Rotation handlers
  const handleRotateStart = (e: React.PointerEvent, floor: number, wing: string, wingIndex: number) => {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    const container = containerRefs.current[`${floor}-${wing}`];
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI);
    const layout = getLayout(floor, wing, wingIndex);
    rotateStart.current = { centerX, centerY, startAngle, layoutRotation: layout.rotation };
    setRotating(`${floor}-${wing}`);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleRotateMove = (e: React.PointerEvent, floor: number, wing: string) => {
    if (!rotating || rotating !== `${floor}-${wing}` || !rotateStart.current) return;
    const { centerX, centerY, startAngle, layoutRotation } = rotateStart.current;
    const currentAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI);
    const delta = currentAngle - startAngle;
    const newRotation = Math.round((layoutRotation + delta) / 5) * 5; // snap to 5deg
    setWingLayout(floor, wing, {
      ...getLayout(floor, wing, 0),
      rotation: newRotation,
    });
  };

  const handleRotateEnd = () => {
    setRotating(null);
    rotateStart.current = null;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const upserts = Object.entries(layouts).map(([key, layout]) => {
        const [floor, wing] = key.split('-');
        return {
          hotel_name: hotelName,
          floor_number: parseInt(floor),
          wing,
          x: layout.x,
          y: layout.y,
          rotation: layout.rotation,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        };
      });

      const { error } = await supabase
        .from('hotel_floor_layouts')
        .upsert(upserts, { onConflict: 'hotel_name,floor_number,wing' });

      if (error) throw error;
      setSavedLayouts({ ...layouts });
      toast.success('Layout saved successfully');
      setEditMode(false);
    } catch (err: any) {
      console.error('Error saving layout:', err);
      toast.error('Failed to save layout');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setLayouts({ ...savedLayouts });
  };

  const handleCancelEdit = () => {
    setLayouts({ ...savedLayouts });
    setEditMode(false);
  };

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
              onClick={(e) => {
                if (editMode) { e.stopPropagation(); return; }
                onRoomClick?.(room);
              }}
              className={`
                px-1.5 py-0.5 rounded text-[10px] font-bold border min-w-[32px] text-center
                transition-all hover:scale-110 hover:shadow-md
                ${colorClass}
                ${room.is_dnd ? 'ring-2 ring-purple-500 ring-offset-1' : ''}
              `}
            >
              {room.room_number}
              {room.bed_type === 'shabath' && <span className="text-[7px] text-blue-700 font-bold ml-0.5">SH</span>}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <p className="font-semibold">Room {room.room_number}</p>
            <p>Status: {room.status || 'unknown'}</p>
            {room.room_category && <p className="text-[10px]">{room.room_category}</p>}
            {room.bed_type === 'shabath' && <p className="text-blue-600">✡ Shabath Room</p>}
            {room.room_size_sqm && <p>Size: ~{room.room_size_sqm}m²</p>}
            {room.towel_change_required && <p className="text-red-600">🔄 Towel Change</p>}
            {room.linen_change_required && <p className="text-red-600">🛏️ Room Cleaning</p>}
            {staff && <p>Assigned: {staff}</p>}
            {room.is_dnd && <p className="text-purple-600">🚫 DND</p>}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  return (
    <div className="space-y-3">
      {/* Admin controls */}
      {isAdmin && (
        <div className="flex items-center gap-2">
          {!editMode ? (
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setEditMode(true)}>
              <Pencil className="h-3 w-3" /> Edit Layout
            </Button>
          ) : (
            <>
              <Button variant="default" size="sm" className="h-7 text-xs gap-1" onClick={handleSave} disabled={saving}>
                <Save className="h-3 w-3" /> {saving ? 'Saving...' : 'Save Layout'}
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleReset}>
                <RotateCcw className="h-3 w-3" /> Reset
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleCancelEdit}>
                Cancel
              </Button>
              <span className="text-[10px] text-muted-foreground ml-2">
                Drag wings to reposition • Use rotation handle to rotate
              </span>
            </>
          )}
        </div>
      )}

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

            {/* Canvas for this floor */}
            <div
              ref={el => { canvasRefs.current[floor] = el; }}
              className="relative border border-border/30 rounded-lg bg-muted/10 overflow-visible"
              style={{ minHeight: editMode ? '220px' : '120px' }}
            >
              {wings.map((wingKey, wingIndex) => {
                const wingRooms = (roomsByWing.get(wingKey) || []).sort(
                  (a, b) => parseInt(a.room_number) - parseInt(b.room_number)
                );
                if (wingRooms.length === 0) return null;
                const info = WING_INFO[wingKey];
                const layout = getLayout(floor, wingKey, wingIndex);
                const key = `${floor}-${wingKey}`;

                return (
                  <div
                    key={key}
                    ref={el => { containerRefs.current[key] = el; }}
                    className={`
                      absolute origin-center
                      ${editMode ? 'cursor-grab active:cursor-grabbing' : ''}
                      ${dragging === key ? 'z-20 opacity-90' : 'z-10'}
                    `}
                    style={{
                      left: `${layout.x}%`,
                      top: `${layout.y}%`,
                      transform: `rotate(${layout.rotation}deg)`,
                      transformOrigin: 'center center',
                    }}
                    onPointerDown={editMode ? (e) => handleDragStart(e, floor, wingKey, wingIndex) : undefined}
                    onPointerMove={editMode ? (e) => {
                      handleDragMove(e, floor, wingKey);
                      handleRotateMove(e, floor, wingKey);
                    } : undefined}
                    onPointerUp={editMode ? () => { handleDragEnd(); handleRotateEnd(); } : undefined}
                  >
                    {/* Counter-rotated content so text stays upright */}
                    <div
                      className="border border-border/50 rounded-lg p-2 bg-background/80 backdrop-blur-sm shadow-sm"
                      style={{ transform: `rotate(${-layout.rotation}deg)` }}
                    >
                      <div className="flex items-center gap-1 mb-1">
                        <span className="text-[10px] font-bold text-primary">{info?.label || wingKey}</span>
                        {info?.view && (
                          <span className="text-[9px] text-muted-foreground">({info.view})</span>
                        )}
                        {editMode && (
                          <span className="text-[8px] text-muted-foreground ml-1">
                            {Math.round(layout.rotation)}°
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {wingRooms.map(room => renderRoom(room))}
                      </div>
                    </div>

                    {/* Rotation handle (only in edit mode) */}
                    {editMode && (
                      <div
                        className="absolute -top-3 -right-3 w-6 h-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center cursor-grab hover:scale-110 transition-transform shadow-md z-30"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          handleRotateStart(e, floor, wingKey, wingIndex);
                        }}
                        onPointerMove={(e) => {
                          e.stopPropagation();
                          handleRotateMove(e, floor, wingKey);
                        }}
                        onPointerUp={(e) => {
                          e.stopPropagation();
                          handleRotateEnd();
                        }}
                      >
                        <RotateCw className="h-3 w-3" />
                      </div>
                    )}
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
