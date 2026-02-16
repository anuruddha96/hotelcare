import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { RotateCw, RotateCcw, Save, Pencil, GripVertical, RotateCcwIcon } from 'lucide-react';
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

function getDefaultLayout(floor: number, _wingKey: string, wingIndex: number): WingLayout {
  const totalWings = FLOOR_WINGS[floor]?.length || 1;
  const spacing = 100 / (totalWings + 1);
  return {
    x: spacing * (wingIndex + 1) - 10,
    y: 20,
    rotation: 0,
  };
}

interface RoomChipProps {
  room: RoomData;
  editMode: boolean;
  assignStatus: string | null;
  staffName: string | null;
  onRoomClick?: (room: RoomData) => void;
}

function RoomChip({ room, editMode, assignStatus, staffName, onRoomClick }: RoomChipProps) {
  const statusKey = assignStatus === 'in_progress' ? 'in_progress'
    : assignStatus === 'completed' ? 'clean'
    : room.status || 'dirty';
  const colorClass = STATUS_COLORS[statusKey] || 'bg-muted text-muted-foreground border-border';

  return (
    <TooltipProvider delayDuration={200}>
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
          {staffName && <p>Assigned: {staffName}</p>}
          {room.is_dnd && <p className="text-purple-600">🚫 DND</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface WingCardProps {
  floor: number;
  wingKey: string;
  wingIndex: number;
  wingRooms: RoomData[];
  layout: WingLayout;
  editMode: boolean;
  isDragging: boolean;
  isSelected: boolean;
  assignments: Map<string, AssignmentData>;
  staffMap: Record<string, string>;
  onRoomClick?: (room: RoomData) => void;
  onDragStart: (e: React.PointerEvent) => void;
  onDragMove: (e: React.PointerEvent) => void;
  onDragEnd: () => void;
  onRotate: (delta: number) => void;
  onResetRotation: () => void;
  containerRef: (el: HTMLDivElement | null) => void;
}

function WingCard({
  floor, wingKey, wingRooms, layout, editMode, isDragging, isSelected,
  assignments, staffMap, onRoomClick,
  onDragStart, onDragMove, onDragEnd,
  onRotate, onResetRotation, containerRef,
}: WingCardProps) {
  const info = WING_INFO[wingKey];
  const key = `${floor}-${wingKey}`;

  return (
    <div
      ref={containerRef}
      className={`absolute origin-center ${isDragging ? 'z-30' : 'z-10'}`}
      style={{
        left: `${layout.x}%`,
        top: `${layout.y}%`,
        transform: `rotate(${layout.rotation}deg)`,
        transformOrigin: 'center center',
      }}
    >
      {/* The card border/background rotates with the wing */}
      <div
        className={`
          border border-border/50 rounded-lg p-2 bg-background/90 backdrop-blur-sm shadow-sm
          transition-shadow
          ${editMode && isSelected ? 'ring-2 ring-primary shadow-lg' : ''}
          ${editMode ? 'border-primary/30' : ''}
        `}
      >
        {/* Counter-rotated content so text stays readable */}
        <div style={{ transform: `rotate(${-layout.rotation}deg)` }}>
          <div className="flex items-center gap-1 mb-1">
            {/* Drag handle - only this initiates dragging */}
            {editMode && (
              <div
                className="cursor-grab active:cursor-grabbing p-0.5 rounded hover:bg-muted touch-none"
                onPointerDown={onDragStart}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
              >
                <GripVertical className="h-3 w-3 text-muted-foreground" />
              </div>
            )}
            <span className="text-[10px] font-bold text-primary">{info?.label || wingKey}</span>
            {info?.view && (
              <span className="text-[9px] text-muted-foreground">({info.view})</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {wingRooms.map(room => (
              <RoomChip
                key={room.id}
                room={room}
                editMode={editMode}
                assignStatus={assignments.get(room.id)?.status || null}
                staffName={assignments.get(room.id) ? (staffMap[assignments.get(room.id)!.assigned_to] || null) : null}
                onRoomClick={onRoomClick}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Rotation controls - outside the card, counter-rotated to stay upright */}
      {editMode && (
        <div
          className="absolute -bottom-9 left-1/2 -translate-x-1/2 flex items-center gap-0.5 bg-background/95 border border-border rounded-full px-1.5 py-0.5 shadow-md whitespace-nowrap"
          style={{ transform: `rotate(${-layout.rotation}deg)` }}
        >
          <button
            className="p-0.5 rounded-full hover:bg-muted transition-colors"
            onClick={(e) => { e.stopPropagation(); onRotate(-15); }}
            title="Rotate left 15°"
          >
            <RotateCcw className="h-3 w-3 text-muted-foreground" />
          </button>
          <span className="text-[9px] font-mono text-muted-foreground min-w-[28px] text-center">
            {Math.round(layout.rotation)}°
          </span>
          <button
            className="p-0.5 rounded-full hover:bg-muted transition-colors"
            onClick={(e) => { e.stopPropagation(); onRotate(15); }}
            title="Rotate right 15°"
          >
            <RotateCw className="h-3 w-3 text-muted-foreground" />
          </button>
          {layout.rotation !== 0 && (
            <button
              className="p-0.5 rounded-full hover:bg-destructive/10 transition-colors ml-0.5"
              onClick={(e) => { e.stopPropagation(); onResetRotation(); }}
              title="Reset to 0°"
            >
              <RotateCcwIcon className="h-2.5 w-2.5 text-destructive" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function HotelFloorMap({ rooms, assignments, staffMap, onRoomClick, hotelName, isAdmin }: HotelFloorMapProps) {
  const [editMode, setEditMode] = useState(false);
  const [layouts, setLayouts] = useState<Record<string, WingLayout>>({});
  const [savedLayouts, setSavedLayouts] = useState<Record<string, WingLayout>>({});
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [selectedWing, setSelectedWing] = useState<string | null>(null);
  const dragStart = useRef<{ x: number; y: number; layoutX: number; layoutY: number } | null>(null);
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

  const getLayout = useCallback((floor: number, wing: string, wingIndex: number): WingLayout => {
    const key = `${floor}-${wing}`;
    return layouts[key] || getDefaultLayout(floor, wing, wingIndex);
  }, [layouts]);

  const setWingLayout = useCallback((floor: number, wing: string, layout: WingLayout) => {
    setLayouts(prev => ({ ...prev, [`${floor}-${wing}`]: layout }));
  }, []);

  // Drag handlers - isolated to the grip handle
  const handleDragStart = useCallback((e: React.PointerEvent, floor: number, wing: string, wingIndex: number) => {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    const layout = getLayout(floor, wing, wingIndex);
    const canvas = canvasRefs.current[floor];
    if (!canvas) return;
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      layoutX: layout.x,
      layoutY: layout.y,
    };
    setDragging(`${floor}-${wing}`);
    setSelectedWing(`${floor}-${wing}`);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [editMode, getLayout]);

  const handleDragMove = useCallback((e: React.PointerEvent, floor: number, wing: string) => {
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
  }, [dragging, getLayout, setWingLayout]);

  const handleDragEnd = useCallback(() => {
    setDragging(null);
    dragStart.current = null;
  }, []);

  // Precision rotation
  const handleRotate = useCallback((floor: number, wing: string, wingIndex: number, delta: number) => {
    const layout = getLayout(floor, wing, wingIndex);
    setWingLayout(floor, wing, { ...layout, rotation: layout.rotation + delta });
    setSelectedWing(`${floor}-${wing}`);
  }, [getLayout, setWingLayout]);

  const handleResetRotation = useCallback((floor: number, wing: string, wingIndex: number) => {
    const layout = getLayout(floor, wing, wingIndex);
    setWingLayout(floor, wing, { ...layout, rotation: 0 });
  }, [getLayout, setWingLayout]);

  // Compute wing proximity after save
  const computeProximity = useCallback((currentLayouts: Record<string, WingLayout>) => {
    const entries = Object.entries(currentLayouts);
    const proximityMap: Record<string, Record<string, number>> = {};
    for (let i = 0; i < entries.length; i++) {
      const [keyA, layoutA] = entries[i];
      const wingA = keyA.split('-')[1];
      if (!proximityMap[wingA]) proximityMap[wingA] = {};
      for (let j = 0; j < entries.length; j++) {
        if (i === j) continue;
        const [keyB, layoutB] = entries[j];
        const wingB = keyB.split('-')[1];
        const dist = Math.sqrt(Math.pow(layoutA.x - layoutB.x, 2) + Math.pow(layoutA.y - layoutB.y, 2));
        // Keep shortest distance if wing appears on multiple floors
        if (!proximityMap[wingA][wingB] || dist < proximityMap[wingA][wingB]) {
          proximityMap[wingA][wingB] = Math.round(dist * 100) / 100;
        }
      }
    }
    console.log('Wing proximity map computed:', proximityMap);
    return proximityMap;
  }, []);

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

      // Compute and log proximity for the assignment algorithm
      computeProximity(layouts);

      setSavedLayouts({ ...layouts });
      toast.success('Layout saved — proximity data updated');
      setEditMode(false);
    } catch (err: any) {
      console.error('Error saving layout:', err);
      toast.error('Failed to save layout');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setLayouts({ ...savedLayouts });
    setEditMode(false);
    setSelectedWing(null);
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
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setLayouts({ ...savedLayouts })}>
                <RotateCcw className="h-3 w-3" /> Reset
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleCancelEdit}>
                Cancel
              </Button>
              <span className="text-[10px] text-muted-foreground ml-2">
                Drag ≡ handle to move • Use ±15° buttons to rotate
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

            {/* Canvas */}
            <div
              ref={el => { canvasRefs.current[floor] = el; }}
              className="relative border border-border/30 rounded-lg overflow-visible"
              style={{
                minHeight: editMode ? '400px' : '120px',
                backgroundColor: editMode ? undefined : 'hsl(var(--muted) / 0.1)',
                backgroundImage: editMode
                  ? 'radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)'
                  : undefined,
                backgroundSize: editMode ? '20px 20px' : undefined,
              }}
              onClick={() => editMode && setSelectedWing(null)}
            >
              {wings.map((wingKey, wingIndex) => {
                const wingRooms = (roomsByWing.get(wingKey) || []).sort(
                  (a, b) => parseInt(a.room_number) - parseInt(b.room_number)
                );
                if (wingRooms.length === 0) return null;
                const layout = getLayout(floor, wingKey, wingIndex);
                const key = `${floor}-${wingKey}`;

                return (
                  <WingCard
                    key={key}
                    floor={floor}
                    wingKey={wingKey}
                    wingIndex={wingIndex}
                    wingRooms={wingRooms}
                    layout={layout}
                    editMode={editMode}
                    isDragging={dragging === key}
                    isSelected={selectedWing === key}
                    assignments={assignments}
                    staffMap={staffMap}
                    onRoomClick={onRoomClick}
                    onDragStart={(e) => handleDragStart(e, floor, wingKey, wingIndex)}
                    onDragMove={(e) => handleDragMove(e, floor, wingKey)}
                    onDragEnd={handleDragEnd}
                    onRotate={(delta) => handleRotate(floor, wingKey, wingIndex, delta)}
                    onResetRotation={() => handleResetRotation(floor, wingKey, wingIndex)}
                    containerRef={(el) => { containerRefs.current[key] = el; }}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
