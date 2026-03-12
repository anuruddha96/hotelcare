import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { RotateCw, RotateCcw, Save, Pencil, GripVertical, RotateCcwIcon, Plus, Trash2, Edit2, Check, X, Layers } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { parseRoomFlags } from '@/lib/room-service-flags';

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
  notes?: string | null;
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

interface WingMeta {
  label: string;
  view?: string;
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
  clean: 'bg-emerald-200 text-emerald-900 border-emerald-400',
  dirty: 'bg-amber-200 text-amber-900 border-amber-400',
  in_progress: 'bg-sky-200 text-sky-900 border-sky-400',
  out_of_order: 'bg-red-200 text-red-900 border-red-400',
  inspected: 'bg-teal-200 text-teal-900 border-teal-400',
};

function getFloorLabel(floor: number): string {
  if (floor === 0) return 'Ground Floor';
  if (floor === 1) return '1st Floor';
  if (floor === 2) return '2nd Floor';
  if (floor === 3) return '3rd Floor';
  return `${floor}th Floor`;
}

function getDefaultLayout(floor: number, wingIndex: number, totalWings: number): WingLayout {
  const spacing = 100 / (totalWings + 1);
  return { x: spacing * (wingIndex + 1) - 10, y: 20, rotation: 0 };
}

// ─── RoomChip ────────────────────────────────────────────────────────────────

interface RoomChipProps {
  room: RoomData;
  editMode: boolean;
  assignStatus: string | null;
  staffName: string | null;
  onRoomClick?: (room: RoomData) => void;
  isSelectedForMove?: boolean;
  onSelectForMove?: () => void;
}

function RoomChip({ room, editMode, assignStatus, staffName, onRoomClick, isSelectedForMove, onSelectForMove }: RoomChipProps) {
  const statusKey = assignStatus === 'in_progress' ? 'in_progress'
    : assignStatus === 'completed' ? 'clean'
    : room.status || 'dirty';
  const colorClass = STATUS_COLORS[statusKey] || 'bg-muted text-muted-foreground border-border';
  const roomFlags = parseRoomFlags(room.notes || null);

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={(e) => {
              if (editMode && onSelectForMove) {
                e.stopPropagation();
                onSelectForMove();
                return;
              }
              if (editMode) { e.stopPropagation(); return; }
              onRoomClick?.(room);
            }}
            className={`
              px-1.5 py-0.5 rounded text-[10px] font-bold border min-w-[32px] text-center
              transition-all hover:scale-110 hover:shadow-md
              ${colorClass}
              ${room.is_dnd ? 'ring-2 ring-purple-500 ring-offset-1' : ''}
              ${isSelectedForMove ? 'ring-2 ring-primary ring-offset-1 scale-110' : ''}
            `}
          >
            {room.room_number}
            {room.bed_type === 'shabath' && <span className="text-[7px] text-blue-700 font-bold ml-0.5">SH</span>}
            {room.towel_change_required && <span className="ml-0.5 px-0.5 rounded text-[7px] font-extrabold bg-blue-600 text-white">T</span>}
            {room.linen_change_required && <span className="ml-0.5 px-0.5 rounded text-[7px] font-extrabold bg-orange-500 text-white">C</span>}
            {roomFlags.roomCleaning && <span className="ml-0.5 px-0.5 rounded text-[7px] font-extrabold bg-green-600 text-white">RC</span>}
            {roomFlags.collectExtraTowels && <span className="ml-0.5 px-0.5 rounded text-[7px] font-extrabold bg-orange-500 text-white">🧺</span>}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <p className="font-semibold">Room {room.room_number}</p>
          <p>Status: {room.status || 'unknown'}</p>
          {room.room_category && <p className="text-[10px]">{room.room_category}</p>}
          {room.bed_type === 'shabath' && <p className="text-blue-600">✡ Shabath Room</p>}
          {room.room_size_sqm && <p>Size: ~{room.room_size_sqm}m²</p>}
          {room.towel_change_required && <p className="text-red-600">🔄 Towel Change</p>}
          {room.linen_change_required && <p className="text-red-600">🛏️ Bed Linen Change</p>}
          {roomFlags.roomCleaning && <p className="text-green-600">🧹 Room Cleaning</p>}
          {roomFlags.collectExtraTowels && <p className="text-orange-600">🧺 Collect Extra Towels</p>}
          {staffName && <p>Assigned: {staffName}</p>}
          {room.is_dnd && <p className="text-purple-600">🚫 DND</p>}
          {roomFlags.cleanNotes && <p className="text-amber-600">📝 {roomFlags.cleanNotes}</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── WingCard ────────────────────────────────────────────────────────────────

interface WingCardProps {
  floor: number;
  wingKey: string;
  wingIndex: number;
  wingRooms: RoomData[];
  wingMeta: WingMeta;
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
  onEditLabel?: (newLabel: string) => void;
  onEditView?: (newView: string) => void;
  selectedRoomForMove: string | null;
  onSelectRoomForMove: (roomId: string | null) => void;
  onDropRoomHere?: () => void;
}

function WingCard({
  floor, wingKey, wingRooms, wingMeta, layout, editMode, isDragging, isSelected,
  assignments, staffMap, onRoomClick,
  onDragStart, onDragMove, onDragEnd,
  onRotate, onResetRotation, containerRef,
  onEditLabel, onEditView,
  selectedRoomForMove, onSelectRoomForMove, onDropRoomHere,
}: WingCardProps) {
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState(wingMeta.label);
  const [editingView, setEditingView] = useState(false);
  const [viewValue, setViewValue] = useState(wingMeta.view || '');

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
      <div
        className={`
          border border-border/50 rounded-lg p-2 bg-background/90 backdrop-blur-sm shadow-sm
          transition-shadow
          ${editMode && isSelected ? 'ring-2 ring-primary shadow-lg' : ''}
          ${editMode ? 'border-primary/30' : ''}
          ${editMode && selectedRoomForMove && !isSelected ? 'cursor-pointer hover:ring-2 hover:ring-blue-400' : ''}
        `}
        onClick={() => {
          if (editMode && selectedRoomForMove && onDropRoomHere) {
            onDropRoomHere();
          }
        }}
      >
        <div style={{ transform: `rotate(${-layout.rotation}deg)` }}>
          <div className="flex items-center gap-1 mb-1">
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
            {editMode && editingLabel ? (
              <div className="flex items-center gap-0.5">
                <input
                  className="text-[10px] font-bold w-16 px-1 py-0.5 rounded border border-input bg-background"
                  value={labelValue}
                  onChange={(e) => setLabelValue(e.target.value)}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
                <button onClick={(e) => { e.stopPropagation(); onEditLabel?.(labelValue); setEditingLabel(false); }} className="p-0.5"><Check className="h-2.5 w-2.5 text-green-600" /></button>
                <button onClick={(e) => { e.stopPropagation(); setEditingLabel(false); }} className="p-0.5"><X className="h-2.5 w-2.5 text-red-600" /></button>
              </div>
            ) : (
              <span 
                className={`text-[10px] font-bold text-primary ${editMode ? 'cursor-pointer hover:underline' : ''}`}
                onClick={(e) => { if (editMode) { e.stopPropagation(); setEditingLabel(true); } }}
              >
                {wingMeta.label}
              </span>
            )}
            {editMode && editingView ? (
              <div className="flex items-center gap-0.5">
                <input
                  className="text-[9px] w-20 px-1 py-0.5 rounded border border-input bg-background"
                  value={viewValue}
                  onChange={(e) => setViewValue(e.target.value)}
                  placeholder="View name..."
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
                <button onClick={(e) => { e.stopPropagation(); onEditView?.(viewValue); setEditingView(false); }} className="p-0.5"><Check className="h-2.5 w-2.5 text-green-600" /></button>
                <button onClick={(e) => { e.stopPropagation(); setEditingView(false); }} className="p-0.5"><X className="h-2.5 w-2.5 text-red-600" /></button>
              </div>
            ) : (
              wingMeta.view ? (
                <span 
                  className={`text-[9px] text-muted-foreground ${editMode ? 'cursor-pointer hover:underline' : ''}`}
                  onClick={(e) => { if (editMode) { e.stopPropagation(); setEditingView(true); } }}
                >
                  ({wingMeta.view})
                </span>
              ) : editMode ? (
                <button 
                  className="text-[9px] text-muted-foreground/50 hover:text-muted-foreground"
                  onClick={(e) => { e.stopPropagation(); setEditingView(true); }}
                >
                  + view
                </button>
              ) : null
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
                isSelectedForMove={selectedRoomForMove === room.id}
                onSelectForMove={() => onSelectRoomForMove(selectedRoomForMove === room.id ? null : room.id)}
              />
            ))}
          </div>
        </div>
      </div>

      {editMode && (
        <div
          className="absolute -bottom-9 left-1/2 -translate-x-1/2 flex items-center gap-0.5 bg-background/95 border border-border rounded-full px-1.5 py-0.5 shadow-md whitespace-nowrap"
          style={{ transform: `rotate(${-layout.rotation}deg)` }}
        >
          <button className="p-0.5 rounded-full hover:bg-muted transition-colors" onClick={(e) => { e.stopPropagation(); onRotate(-15); }} title="Rotate left 15°">
            <RotateCcw className="h-3 w-3 text-muted-foreground" />
          </button>
          <span className="text-[9px] font-mono text-muted-foreground min-w-[28px] text-center">{Math.round(layout.rotation)}°</span>
          <button className="p-0.5 rounded-full hover:bg-muted transition-colors" onClick={(e) => { e.stopPropagation(); onRotate(15); }} title="Rotate right 15°">
            <RotateCw className="h-3 w-3 text-muted-foreground" />
          </button>
          {layout.rotation !== 0 && (
            <button className="p-0.5 rounded-full hover:bg-destructive/10 transition-colors ml-0.5" onClick={(e) => { e.stopPropagation(); onResetRotation(); }} title="Reset to 0°">
              <RotateCcwIcon className="h-2.5 w-2.5 text-destructive" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ZoneGroupingPanel ───────────────────────────────────────────────────────

interface ZoneGroupingPanelProps {
  wings: string[];
  zoneMapping: Record<string, string>;
  onUpdateMapping: (mapping: Record<string, string>) => void;
}

function ZoneGroupingPanel({ wings, zoneMapping, onUpdateMapping }: ZoneGroupingPanelProps) {
  const [newZoneName, setNewZoneName] = useState('');

  const zones = useMemo(() => {
    const map = new Map<string, string[]>();
    wings.forEach(w => {
      const zone = zoneMapping[w] || w;
      if (!map.has(zone)) map.set(zone, []);
      map.get(zone)!.push(w);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [wings, zoneMapping]);

  const handleMoveWingToZone = (wing: string, zone: string) => {
    const updated = { ...zoneMapping, [wing]: zone };
    onUpdateMapping(updated);
  };

  const handleCreateZone = () => {
    if (!newZoneName.trim()) return;
    // Zone is just a label, no action needed until wings are assigned
    setNewZoneName('');
    toast.success(`Zone "${newZoneName}" created — now drag wings into it`);
  };

  return (
    <div className="space-y-2 p-3 border rounded-lg bg-muted/20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold">Zone Grouping (for Auto-Assignment)</span>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">Group wings into zones for smarter room assignment distribution</p>
      
      <div className="space-y-1.5">
        {zones.map(([zone, zoneWings]) => (
          <div key={zone} className="flex items-center gap-1.5 p-1.5 bg-background rounded border border-border/50">
            <span className="text-[10px] font-semibold text-primary min-w-[60px]">{zone}</span>
            <div className="flex flex-wrap gap-1">
              {zoneWings.map(w => (
                <Badge key={w} variant="outline" className="text-[9px] px-1 py-0">
                  {w}
                </Badge>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1.5 pt-1">
        <input
          className="text-[10px] px-1.5 py-1 rounded border border-input bg-background flex-1"
          placeholder="New zone name..."
          value={newZoneName}
          onChange={(e) => setNewZoneName(e.target.value)}
        />
        <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={handleCreateZone} disabled={!newZoneName.trim()}>
          <Plus className="h-2.5 w-2.5 mr-0.5" /> Add Zone
        </Button>
      </div>

      {/* Wing-to-zone assignment */}
      <div className="space-y-1 pt-1 border-t border-border/30">
        <p className="text-[10px] text-muted-foreground">Assign wings to zones:</p>
        {wings.map(wing => {
          const currentZone = zoneMapping[wing] || wing;
          const allZoneNames = [...new Set([...Object.values(zoneMapping), ...wings])].sort();
          return (
            <div key={wing} className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium min-w-[40px]">{wing}</span>
              <select
                className="text-[10px] px-1 py-0.5 rounded border border-input bg-background flex-1"
                value={currentZone}
                onChange={(e) => handleMoveWingToZone(wing, e.target.value)}
              >
                {allZoneNames.map(z => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function HotelFloorMap({ rooms, assignments, staffMap, onRoomClick, hotelName, isAdmin }: HotelFloorMapProps) {
  const [editMode, setEditMode] = useState(false);
  const [layouts, setLayouts] = useState<Record<string, WingLayout>>({});
  const [savedLayouts, setSavedLayouts] = useState<Record<string, WingLayout>>({});
  const [wingMetas, setWingMetas] = useState<Record<string, WingMeta>>({});
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [selectedWing, setSelectedWing] = useState<string | null>(null);
  const [selectedRoomForMove, setSelectedRoomForMove] = useState<string | null>(null);
  const [showZonePanel, setShowZonePanel] = useState(false);
  const [zoneMapping, setZoneMapping] = useState<Record<string, string>>({});
  const dragStart = useRef<{ x: number; y: number; layoutX: number; layoutY: number } | null>(null);
  const containerRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const canvasRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // ─── Derive floors and wings dynamically from room data ─────────────
  const { floorOrder, floorWings, roomsByFloorWing, unassignedRooms } = useMemo(() => {
    const floorsSet = new Set<number>();
    const wingsByFloor = new Map<number, Set<string>>();
    const byFloorWing = new Map<string, RoomData[]>();
    const unassigned: RoomData[] = [];

    rooms.forEach(room => {
      const floor = room.floor_number ?? Math.floor(parseInt(room.room_number) / 100);
      const wing = room.wing;

      if (!wing) {
        unassigned.push(room);
        return;
      }

      floorsSet.add(floor);
      if (!wingsByFloor.has(floor)) wingsByFloor.set(floor, new Set());
      wingsByFloor.get(floor)!.add(wing);

      const key = `${floor}-${wing}`;
      if (!byFloorWing.has(key)) byFloorWing.set(key, []);
      byFloorWing.get(key)!.push(room);
    });

    const order = Array.from(floorsSet).sort((a, b) => a - b);
    const wings: Record<number, string[]> = {};
    order.forEach(f => {
      wings[f] = Array.from(wingsByFloor.get(f) || []).sort();
    });

    return {
      floorOrder: order,
      floorWings: wings,
      roomsByFloorWing: byFloorWing,
      unassignedRooms: unassigned,
    };
  }, [rooms]);

  const allWings = useMemo(() => {
    const set = new Set<string>();
    rooms.forEach(r => { if (r.wing) set.add(r.wing); });
    return Array.from(set).sort();
  }, [rooms]);

  // Load layouts and wing metas from DB
  useEffect(() => {
    if (!hotelName) return;
    const load = async () => {
      const [layoutRes, configRes] = await Promise.all([
        supabase.from('hotel_floor_layouts').select('floor_number, wing, x, y, rotation').eq('hotel_name', hotelName),
        supabase.from('hotel_configurations').select('settings').eq('hotel_name', hotelName).single(),
      ]);

      if (layoutRes.data && layoutRes.data.length > 0) {
        const map: Record<string, WingLayout> = {};
        layoutRes.data.forEach(row => {
          map[`${row.floor_number}-${row.wing}`] = { x: Number(row.x), y: Number(row.y), rotation: Number(row.rotation) };
        });
        setLayouts(map);
        setSavedLayouts(map);
      }

      if (configRes.data?.settings) {
        const settings = configRes.data.settings as any;
        if (settings.wing_metas) setWingMetas(settings.wing_metas);
        if (settings.wing_zone_mapping) setZoneMapping(settings.wing_zone_mapping);
      }
    };
    load();
  }, [hotelName]);

  const getWingMeta = useCallback((wingKey: string): WingMeta => {
    return wingMetas[wingKey] || { label: `Wing ${wingKey}` };
  }, [wingMetas]);

  const getLayout = useCallback((floor: number, wing: string, wingIndex: number, totalWings: number): WingLayout => {
    const key = `${floor}-${wing}`;
    return layouts[key] || getDefaultLayout(floor, wingIndex, totalWings);
  }, [layouts]);

  const setWingLayout = useCallback((floor: number, wing: string, layout: WingLayout) => {
    setLayouts(prev => ({ ...prev, [`${floor}-${wing}`]: layout }));
  }, []);

  // Drag handlers
  const handleDragStart = useCallback((e: React.PointerEvent, floor: number, wing: string, wingIndex: number, totalWings: number) => {
    if (!editMode) return;
    e.preventDefault(); e.stopPropagation();
    const layout = getLayout(floor, wing, wingIndex, totalWings);
    const canvas = canvasRefs.current[floor];
    if (!canvas) return;
    dragStart.current = { x: e.clientX, y: e.clientY, layoutX: layout.x, layoutY: layout.y };
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
      ...getLayout(floor, wing, 0, 1),
      x: dragStart.current.layoutX + dx,
      y: dragStart.current.layoutY + dy,
    });
  }, [dragging, getLayout, setWingLayout]);

  const handleDragEnd = useCallback(() => {
    setDragging(null);
    dragStart.current = null;
  }, []);

  const handleRotate = useCallback((floor: number, wing: string, wingIndex: number, totalWings: number, delta: number) => {
    const layout = getLayout(floor, wing, wingIndex, totalWings);
    setWingLayout(floor, wing, { ...layout, rotation: layout.rotation + delta });
    setSelectedWing(`${floor}-${wing}`);
  }, [getLayout, setWingLayout]);

  const handleResetRotation = useCallback((floor: number, wing: string, wingIndex: number, totalWings: number) => {
    const layout = getLayout(floor, wing, wingIndex, totalWings);
    setWingLayout(floor, wing, { ...layout, rotation: 0 });
  }, [getLayout, setWingLayout]);

  // Move room to a different wing
  const handleMoveRoomToWing = useCallback(async (targetFloor: number, targetWing: string) => {
    if (!selectedRoomForMove) return;
    const room = rooms.find(r => r.id === selectedRoomForMove);
    if (!room) return;

    try {
      const { error } = await supabase.from('rooms').update({ 
        wing: targetWing, 
        floor_number: targetFloor 
      } as any).eq('id', room.id);
      if (error) throw error;
      toast.success(`Room ${room.room_number} → Wing ${targetWing} (F${targetFloor})`);
      setSelectedRoomForMove(null);
      // Rooms will refresh from parent
    } catch {
      toast.error('Failed to move room');
    }
  }, [selectedRoomForMove, rooms]);

  // Assign unassigned room to a wing
  const handleAssignRoom = useCallback(async (roomId: string, wing: string, floor: number) => {
    const room = rooms.find(r => r.id === roomId);
    if (!room) return;
    try {
      const { error } = await supabase.from('rooms').update({ wing, floor_number: floor } as any).eq('id', roomId);
      if (error) throw error;
      toast.success(`Room ${room.room_number} → Wing ${wing}`);
    } catch {
      toast.error('Failed to assign room');
    }
  }, [rooms]);

  // Save all layouts, metas, and zone mapping
  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Save layouts
      const upserts = Object.entries(layouts).map(([key, layout]) => {
        const [floor, wing] = key.split('-');
        return {
          hotel_name: hotelName, floor_number: parseInt(floor), wing,
          x: layout.x, y: layout.y, rotation: layout.rotation,
          updated_by: user.id, updated_at: new Date().toISOString(),
        };
      });

      const { error: layoutError } = await supabase
        .from('hotel_floor_layouts')
        .upsert(upserts, { onConflict: 'hotel_name,floor_number,wing' });
      if (layoutError) throw layoutError;

      // Save wing metas and zone mapping to hotel_configurations.settings
      const { data: existing } = await supabase
        .from('hotel_configurations')
        .select('settings')
        .eq('hotel_name', hotelName)
        .single();

      const currentSettings = (existing?.settings as any) || {};
      const updatedSettings = {
        ...currentSettings,
        wing_metas: wingMetas,
        wing_zone_mapping: zoneMapping,
      };

      await supabase
        .from('hotel_configurations')
        .update({ settings: updatedSettings } as any)
        .eq('hotel_name', hotelName);

      setSavedLayouts({ ...layouts });
      toast.success('Floor map & zone mapping saved');
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
    setSelectedRoomForMove(null);
    setShowZonePanel(false);
  };

  const updateWingMeta = (wingKey: string, updates: Partial<WingMeta>) => {
    setWingMetas(prev => ({
      ...prev,
      [wingKey]: { ...(prev[wingKey] || { label: `Wing ${wingKey}` }), ...updates },
    }));
  };

  return (
    <div className="space-y-3">
      {/* Admin controls */}
      {isAdmin && (
        <div className="flex items-center gap-2 flex-wrap">
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
              <Button 
                variant={showZonePanel ? 'default' : 'outline'} 
                size="sm" 
                className="h-7 text-xs gap-1" 
                onClick={() => setShowZonePanel(!showZonePanel)}
              >
                <Layers className="h-3 w-3" /> Zones
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleCancelEdit}>
                Cancel
              </Button>
              <span className="text-[10px] text-muted-foreground ml-2">
                Drag ≡ to move • ±15° to rotate • Click room then wing to reassign
              </span>
            </>
          )}
        </div>
      )}

      {/* Zone Grouping Panel */}
      {editMode && showZonePanel && (
        <ZoneGroupingPanel
          wings={allWings}
          zoneMapping={zoneMapping}
          onUpdateMapping={setZoneMapping}
        />
      )}

      {/* Unassigned rooms panel */}
      {editMode && unassignedRooms.length > 0 && (
        <div className="p-2 border border-dashed border-amber-400 rounded-lg bg-amber-50/50 dark:bg-amber-950/20">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[10px] font-semibold text-amber-700">⚠️ Unassigned Rooms ({unassignedRooms.length})</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {unassignedRooms.sort((a, b) => parseInt(a.room_number) - parseInt(b.room_number)).map(room => (
              <RoomChip
                key={room.id}
                room={room}
                editMode={editMode}
                assignStatus={null}
                staffName={null}
                isSelectedForMove={selectedRoomForMove === room.id}
                onSelectForMove={() => setSelectedRoomForMove(selectedRoomForMove === room.id ? null : room.id)}
              />
            ))}
          </div>
          {selectedRoomForMove && unassignedRooms.find(r => r.id === selectedRoomForMove) && (
            <p className="text-[10px] text-amber-600 mt-1">👆 Room selected — click a wing card to assign it there</p>
          )}
        </div>
      )}

      {floorOrder.map(floor => {
        const wings = floorWings[floor] || [];
        if (wings.length === 0) return null;

        return (
          <div key={floor} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] font-bold">
                {getFloorLabel(floor)}
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                {wings.length} wing{wings.length !== 1 ? 's' : ''} · {wings.reduce((sum, w) => sum + (roomsByFloorWing.get(`${floor}-${w}`)?.length || 0), 0)} rooms
              </span>
            </div>

            <div
              ref={el => { canvasRefs.current[floor] = el; }}
              className="relative border border-border/30 rounded-lg overflow-visible"
              style={{
                minHeight: editMode ? '400px' : '120px',
                backgroundColor: editMode ? undefined : 'hsl(var(--muted) / 0.1)',
                backgroundImage: editMode ? 'radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)' : undefined,
                backgroundSize: editMode ? '20px 20px' : undefined,
              }}
              onClick={() => editMode && setSelectedWing(null)}
            >
              {wings.map((wingKey, wingIndex) => {
                const wingRooms = (roomsByFloorWing.get(`${floor}-${wingKey}`) || []).sort(
                  (a, b) => parseInt(a.room_number) - parseInt(b.room_number)
                );
                if (wingRooms.length === 0) return null;
                const layout = getLayout(floor, wingKey, wingIndex, wings.length);
                const key = `${floor}-${wingKey}`;

                return (
                  <WingCard
                    key={key}
                    floor={floor}
                    wingKey={wingKey}
                    wingIndex={wingIndex}
                    wingRooms={wingRooms}
                    wingMeta={getWingMeta(wingKey)}
                    layout={layout}
                    editMode={editMode}
                    isDragging={dragging === key}
                    isSelected={selectedWing === key}
                    assignments={assignments}
                    staffMap={staffMap}
                    onRoomClick={onRoomClick}
                    onDragStart={(e) => handleDragStart(e, floor, wingKey, wingIndex, wings.length)}
                    onDragMove={(e) => handleDragMove(e, floor, wingKey)}
                    onDragEnd={handleDragEnd}
                    onRotate={(delta) => handleRotate(floor, wingKey, wingIndex, wings.length, delta)}
                    onResetRotation={() => handleResetRotation(floor, wingKey, wingIndex, wings.length)}
                    containerRef={(el) => { containerRefs.current[key] = el; }}
                    onEditLabel={(label) => updateWingMeta(wingKey, { label })}
                    onEditView={(view) => updateWingMeta(wingKey, { view: view || undefined })}
                    selectedRoomForMove={selectedRoomForMove}
                    onSelectRoomForMove={setSelectedRoomForMove}
                    onDropRoomHere={() => handleMoveRoomToWing(floor, wingKey)}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {floorOrder.length === 0 && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No rooms with wing/floor data. {isAdmin && 'Enable edit mode to assign rooms to wings.'}
        </div>
      )}
    </div>
  );
}
