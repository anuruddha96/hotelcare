import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Check,
  GripVertical,
  Layers,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
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

type SectionColor = 'sky' | 'emerald' | 'amber' | 'violet' | 'rose' | 'slate';

interface HousekeepingSection {
  id: string;
  hotel_name: string;
  name: string;
  floor_number: number;
  description: string | null;
  color: SectionColor;
  sort_order: number;
  is_active: boolean;
}

interface SectionRoomMapping {
  room_id: string;
  section_id: string;
}

interface SectionTask {
  id: string;
  section_id: string;
  task_name: string;
  icon: string;
  instructions: string | null;
  estimated_duration: number;
  auto_assign: boolean;
  is_active: boolean;
  sort_order: number;
}

interface HotelFloorMapProps {
  rooms: RoomData[];
  assignments: Map<string, AssignmentData>;
  staffMap: Record<string, string>;
  onRoomClick?: (room: RoomData) => void;
  hotelName: string;
  isAdmin?: boolean;
}

interface SectionEditorState {
  open: boolean;
  section: HousekeepingSection | null;
  floor: number;
}

interface TaskEditorState {
  open: boolean;
  section: HousekeepingSection | null;
}

const STATUS_COLORS: Record<string, string> = {
  clean: 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-200',
  dirty: 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/50 dark:text-amber-200',
  in_progress: 'bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-950/50 dark:text-sky-200',
  out_of_order: 'bg-red-100 text-red-900 border-red-300 dark:bg-red-950/50 dark:text-red-200',
  inspected: 'bg-teal-100 text-teal-900 border-teal-300 dark:bg-teal-950/50 dark:text-teal-200',
};

const SECTION_COLORS: Record<SectionColor, string> = {
  sky: 'border-sky-300 bg-sky-50/50 dark:border-sky-800 dark:bg-sky-950/20',
  emerald: 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20',
  amber: 'border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20',
  violet: 'border-violet-300 bg-violet-50/50 dark:border-violet-800 dark:bg-violet-950/20',
  rose: 'border-rose-300 bg-rose-50/50 dark:border-rose-800 dark:bg-rose-950/20',
  slate: 'border-slate-300 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-900/20',
};

const AREA_PRESETS = [
  { name: 'Corridor', icon: '🚶', duration: 15 },
  { name: 'Staircase', icon: '🪜', duration: 15 },
  { name: 'Public Toilet', icon: '🚻', duration: 15 },
  { name: 'Storage', icon: '📦', duration: 10 },
  { name: 'Kitchen', icon: '🍳', duration: 20 },
  { name: 'Sauna', icon: '♨️', duration: 20 },
  { name: 'Jacuzzi', icon: '🫧', duration: 20 },
  { name: 'Gym', icon: '🏋️', duration: 20 },
  { name: 'Decorations', icon: '✨', duration: 15 },
  { name: 'Lobby', icon: '🏨', duration: 20 },
];

function inferFloor(room: RoomData): number {
  if (room.floor_number != null) return room.floor_number;
  const digits = String(room.room_number).match(/\d+/)?.[0];
  return digits ? Math.floor(Number(digits) / 100) : 0;
}

function floorLabel(floor: number): string {
  if (floor === 0) return 'Ground Floor';
  const lastTwo = Math.abs(floor) % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13
    ? 'th'
    : floor % 10 === 1
      ? 'st'
      : floor % 10 === 2
        ? 'nd'
        : floor % 10 === 3
          ? 'rd'
          : 'th';
  return `${floor}${suffix} Floor`;
}

function sortRooms(a: RoomData, b: RoomData): number {
  return a.room_number.localeCompare(b.room_number, undefined, { numeric: true });
}

interface RoomChipProps {
  room: RoomData;
  assignment: AssignmentData | undefined;
  staffName: string | null;
  editMode: boolean;
  selected: boolean;
  onRoomClick?: (room: RoomData) => void;
  onSelect: (roomId: string) => void;
  onDragStart: (event: React.DragEvent, roomId: string) => void;
  onDragEnd: () => void;
}

function RoomChip({
  room,
  assignment,
  staffName,
  editMode,
  selected,
  onRoomClick,
  onSelect,
  onDragStart,
  onDragEnd,
}: RoomChipProps) {
  const status = assignment?.status === 'in_progress'
    ? 'in_progress'
    : assignment?.status === 'completed'
      ? 'clean'
      : room.status || 'dirty';
  const flags = parseRoomFlags(room.notes || null);

  return (
    <button
      type="button"
      draggable={editMode}
      onDragStart={event => onDragStart(event, room.id)}
      onDragEnd={onDragEnd}
      onClick={event => {
        event.stopPropagation();
        if (editMode) onSelect(room.id);
        else onRoomClick?.(room);
      }}
      aria-pressed={editMode ? selected : undefined}
      className={`inline-flex min-h-8 items-center gap-1 rounded-md border px-2 py-1 text-xs font-bold shadow-sm transition-all ${
        STATUS_COLORS[status] || 'border-border bg-background text-foreground'
      } ${editMode ? 'cursor-grab active:cursor-grabbing' : 'hover:-translate-y-0.5 hover:shadow'} ${
        selected ? 'ring-2 ring-primary ring-offset-2' : ''
      } ${room.is_dnd ? 'ring-2 ring-violet-500 ring-offset-1' : ''}`}
      title={[
        `Room ${room.room_number}`,
        staffName ? `Assigned to ${staffName}` : '',
        room.room_category || '',
      ].filter(Boolean).join(' · ')}
    >
      {editMode && <GripVertical className="h-3 w-3 opacity-50" />}
      <span>{room.room_number}</span>
      {room.bed_type === 'shabath' && <span className="text-[8px] font-extrabold text-blue-700">SH</span>}
      {room.towel_change_required && !room.is_checkout_room && <span className="rounded bg-blue-600 px-1 text-[8px] text-white">T</span>}
      {room.linen_change_required && !room.is_checkout_room && <span className="rounded bg-orange-500 px-1 text-[8px] text-white">C</span>}
      {flags.roomCleaning && <span className="rounded bg-green-600 px-1 text-[8px] text-white">RC</span>}
      {flags.collectExtraTowels && <span className="text-[10px]">🧺</span>}
    </button>
  );
}

export function HotelFloorMap({
  rooms,
  assignments,
  staffMap,
  onRoomClick,
  hotelName,
  isAdmin = false,
}: HotelFloorMapProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [sections, setSections] = useState<HousekeepingSection[]>([]);
  const [roomMappings, setRoomMappings] = useState<SectionRoomMapping[]>([]);
  const [tasks, setTasks] = useState<SectionTask[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [draggingRoomId, setDraggingRoomId] = useState<string | null>(null);
  const [dragOverSectionId, setDragOverSectionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sectionEditor, setSectionEditor] = useState<SectionEditorState>({ open: false, section: null, floor: 0 });
  const [sectionName, setSectionName] = useState('');
  const [sectionFloor, setSectionFloor] = useState(0);
  const [sectionDescription, setSectionDescription] = useState('');
  const [sectionColor, setSectionColor] = useState<SectionColor>('sky');
  const [deleteSection, setDeleteSection] = useState<HousekeepingSection | null>(null);
  const [taskEditor, setTaskEditor] = useState<TaskEditorState>({ open: false, section: null });
  const [taskName, setTaskName] = useState('');
  const [taskIcon, setTaskIcon] = useState('🧹');
  const [taskDuration, setTaskDuration] = useState(15);
  const [taskInstructions, setTaskInstructions] = useState('');

  const loadMap = useCallback(async () => {
    if (!hotelName) return;
    setLoading(true);
    try {
      const { data: sectionRows, error: sectionError } = await (supabase as any)
        .from('hotel_housekeeping_sections')
        .select('id, hotel_name, name, floor_number, description, color, sort_order, is_active')
        .eq('hotel_name', hotelName)
        .eq('is_active', true)
        .order('floor_number')
        .order('sort_order')
        .order('name');
      if (sectionError) throw sectionError;

      const loadedSections = (sectionRows || []) as HousekeepingSection[];
      setSections(loadedSections);
      if (loadedSections.length === 0) {
        setRoomMappings([]);
        setTasks([]);
        return;
      }

      const sectionIds = loadedSections.map(section => section.id);
      const [mappingResult, taskResult] = await Promise.all([
        (supabase as any)
          .from('hotel_housekeeping_section_rooms')
          .select('room_id, section_id')
          .in('section_id', sectionIds),
        (supabase as any)
          .from('hotel_housekeeping_section_tasks')
          .select('id, section_id, task_name, icon, instructions, estimated_duration, auto_assign, is_active, sort_order')
          .in('section_id', sectionIds)
          .eq('is_active', true)
          .order('sort_order')
          .order('task_name'),
      ]);
      if (mappingResult.error) throw mappingResult.error;
      if (taskResult.error) throw taskResult.error;
      setRoomMappings((mappingResult.data || []) as SectionRoomMapping[]);
      setTasks((taskResult.data || []) as SectionTask[]);
    } catch (error) {
      console.error('[HotelFloorMap] failed to load section map', error);
      toast.error('The housekeeping section map could not be loaded');
    } finally {
      setLoading(false);
    }
  }, [hotelName]);

  useEffect(() => {
    void loadMap();
  }, [loadMap]);

  const mappingByRoom = useMemo(
    () => new Map(roomMappings.map(mapping => [mapping.room_id, mapping.section_id])),
    [roomMappings],
  );

  const persistedRoomsBySection = useMemo(() => {
    const result = new Map<string, RoomData[]>();
    sections.forEach(section => result.set(section.id, []));
    rooms.forEach(room => {
      const sectionId = mappingByRoom.get(room.id);
      if (sectionId && result.has(sectionId)) result.get(sectionId)!.push(room);
    });
    result.forEach(sectionRooms => sectionRooms.sort(sortRooms));
    return result;
  }, [mappingByRoom, rooms, sections]);

  const unmappedRooms = useMemo(
    () => rooms.filter(room => !mappingByRoom.has(room.id)).sort(sortRooms),
    [mappingByRoom, rooms],
  );

  const legacySections = useMemo<HousekeepingSection[]>(() => {
    if (sections.length > 0 || editMode) return [];
    const keys = new Map<string, HousekeepingSection>();
    rooms.forEach(room => {
      const floor = inferFloor(room);
      const wing = room.wing || 'Unmapped';
      const id = `legacy-${floor}-${wing}`;
      if (!keys.has(id)) {
        keys.set(id, {
          id,
          hotel_name: hotelName,
          name: room.wing ? `Wing ${wing}` : 'Unmapped',
          floor_number: floor,
          description: 'Legacy room grouping',
          color: 'slate',
          sort_order: 0,
          is_active: true,
        });
      }
    });
    return Array.from(keys.values());
  }, [editMode, hotelName, rooms, sections.length]);

  const legacyRoomsBySection = useMemo(() => {
    const result = new Map<string, RoomData[]>();
    legacySections.forEach(section => result.set(section.id, []));
    rooms.forEach(room => {
      const id = `legacy-${inferFloor(room)}-${room.wing || 'Unmapped'}`;
      result.get(id)?.push(room);
    });
    result.forEach(sectionRooms => sectionRooms.sort(sortRooms));
    return result;
  }, [legacySections, rooms]);

  const displaySections = sections.length > 0 ? sections : legacySections;
  const roomsBySection = sections.length > 0 ? persistedRoomsBySection : legacyRoomsBySection;

  const floorOrder = useMemo(() => {
    const floors = new Set<number>();
    displaySections.forEach(section => floors.add(section.floor_number));
    if (editMode) rooms.forEach(room => floors.add(inferFloor(room)));
    return Array.from(floors).sort((a, b) => a - b);
  }, [displaySections, editMode, rooms]);

  const tasksBySection = useMemo(() => {
    const result = new Map<string, SectionTask[]>();
    tasks.forEach(task => {
      if (!result.has(task.section_id)) result.set(task.section_id, []);
      result.get(task.section_id)!.push(task);
    });
    return result;
  }, [tasks]);

  const openCreateSection = (floor: number) => {
    setSectionName(floor === 0 ? 'Ground Floor' : `${floor * 100} Side`);
    setSectionFloor(floor);
    setSectionDescription('');
    setSectionColor(floor === 0 ? 'emerald' : 'sky');
    setSectionEditor({ open: true, section: null, floor });
  };

  const openEditSection = (section: HousekeepingSection) => {
    setSectionName(section.name);
    setSectionFloor(section.floor_number);
    setSectionDescription(section.description || '');
    setSectionColor(section.color);
    setSectionEditor({ open: true, section, floor: section.floor_number });
  };

  const saveSection = async () => {
    const name = sectionName.trim();
    if (!name) return;
    setBusy(true);
    try {
      if (sectionEditor.section) {
        const { data, error } = await (supabase as any)
          .from('hotel_housekeeping_sections')
          .update({
            name,
            floor_number: sectionFloor,
            description: sectionDescription.trim() || null,
            color: sectionColor,
          })
          .eq('id', sectionEditor.section.id)
          .select('id, hotel_name, name, floor_number, description, color, sort_order, is_active')
          .single();
        if (error) throw error;
        setSections(previous => previous.map(section => section.id === data.id ? data : section));
        toast.success(`Section “${name}” updated`);
      } else {
        const maxOrder = sections.reduce((max, section) => Math.max(max, section.sort_order), 0);
        const { data, error } = await (supabase as any)
          .from('hotel_housekeeping_sections')
          .insert({
            hotel_name: hotelName,
            name,
            floor_number: sectionFloor,
            description: sectionDescription.trim() || null,
            color: sectionColor,
            sort_order: maxOrder + 10,
            created_by: user?.id || null,
          })
          .select('id, hotel_name, name, floor_number, description, color, sort_order, is_active')
          .single();
        if (error) throw error;
        setSections(previous => [...previous, data]);
        toast.success(`Section “${name}” created`);
      }
      setSectionEditor({ open: false, section: null, floor: 0 });
    } catch (error: any) {
      console.error('[HotelFloorMap] section save failed', error);
      toast.error(error?.code === '23505' ? 'A section with this name already exists' : 'Section could not be saved');
    } finally {
      setBusy(false);
    }
  };

  const confirmDeleteSection = async () => {
    if (!deleteSection) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any)
        .from('hotel_housekeeping_sections')
        .delete()
        .eq('id', deleteSection.id);
      if (error) throw error;
      setSections(previous => previous.filter(section => section.id !== deleteSection.id));
      setRoomMappings(previous => previous.filter(mapping => mapping.section_id !== deleteSection.id));
      setTasks(previous => previous.filter(task => task.section_id !== deleteSection.id));
      toast.success(`Section “${deleteSection.name}” removed`);
      setDeleteSection(null);
    } catch (error) {
      console.error('[HotelFloorMap] section delete failed', error);
      toast.error('Section could not be removed');
    } finally {
      setBusy(false);
    }
  };

  const moveRoomToSection = async (roomId: string, sectionId: string) => {
    const previousSectionId = mappingByRoom.get(roomId);
    if (previousSectionId === sectionId) {
      setSelectedRoomId(null);
      return;
    }
    const room = rooms.find(candidate => candidate.id === roomId);
    const section = sections.find(candidate => candidate.id === sectionId);
    if (!room || !section) return;

    setRoomMappings(previous => [
      ...previous.filter(mapping => mapping.room_id !== roomId),
      { room_id: roomId, section_id: sectionId },
    ]);
    setSelectedRoomId(null);
    try {
      const { error } = await (supabase as any)
        .from('hotel_housekeeping_section_rooms')
        .upsert({
          room_id: roomId,
          section_id: sectionId,
          created_by: user?.id || null,
        }, { onConflict: 'room_id' });
      if (error) throw error;
      toast.success(`Room ${room.room_number} moved to ${section.name}`);
    } catch (error) {
      console.error('[HotelFloorMap] room move failed', error);
      setRoomMappings(previous => {
        const withoutRoom = previous.filter(mapping => mapping.room_id !== roomId);
        return previousSectionId
          ? [...withoutRoom, { room_id: roomId, section_id: previousSectionId }]
          : withoutRoom;
      });
      toast.error('Room could not be moved');
    }
  };

  const unmapRoom = async (roomId: string) => {
    const previousSectionId = mappingByRoom.get(roomId);
    if (!previousSectionId) return;
    setRoomMappings(previous => previous.filter(mapping => mapping.room_id !== roomId));
    setSelectedRoomId(null);
    try {
      const { error } = await (supabase as any)
        .from('hotel_housekeeping_section_rooms')
        .delete()
        .eq('room_id', roomId);
      if (error) throw error;
      toast.success('Room returned to Unmapped');
    } catch (error) {
      setRoomMappings(previous => [...previous, { room_id: roomId, section_id: previousSectionId }]);
      toast.error('Room could not be unmapped');
    }
  };

  const autoMapFloors = async () => {
    const rows = unmappedRooms.flatMap(room => {
      const floor = inferFloor(room);
      const onFloor = sections.filter(section => section.floor_number === floor);
      const preferredName = floor === 0 ? 'ground floor' : `${floor * 100} side`;
      const target = onFloor.find(section => section.name.toLowerCase() === preferredName)
        || (onFloor.length === 1 ? onFloor[0] : null);
      return target ? [{ room_id: room.id, section_id: target.id, created_by: user?.id || null }] : [];
    });
    if (rows.length === 0) {
      toast.info('Create one default section per floor before auto-mapping');
      return;
    }

    setBusy(true);
    try {
      const { error } = await (supabase as any)
        .from('hotel_housekeeping_section_rooms')
        .upsert(rows, { onConflict: 'room_id' });
      if (error) throw error;
      setRoomMappings(previous => [
        ...previous.filter(mapping => !rows.some(row => row.room_id === mapping.room_id)),
        ...rows.map(({ room_id, section_id }) => ({ room_id, section_id })),
      ]);
      toast.success(`${rows.length} room${rows.length === 1 ? '' : 's'} mapped by floor number`);
    } catch (error) {
      console.error('[HotelFloorMap] auto-map failed', error);
      toast.error('Rooms could not be auto-mapped');
    } finally {
      setBusy(false);
    }
  };

  const openAddTask = (section: HousekeepingSection) => {
    setTaskName('');
    setTaskIcon('🧹');
    setTaskDuration(15);
    setTaskInstructions('');
    setTaskEditor({ open: true, section });
  };

  const choosePreset = (preset: typeof AREA_PRESETS[number]) => {
    setTaskName(preset.name);
    setTaskIcon(preset.icon);
    setTaskDuration(preset.duration);
  };

  const saveTask = async () => {
    if (!taskEditor.section || !taskName.trim()) return;
    setBusy(true);
    try {
      const sectionTasks = tasksBySection.get(taskEditor.section.id) || [];
      const { data, error } = await (supabase as any)
        .from('hotel_housekeeping_section_tasks')
        .insert({
          section_id: taskEditor.section.id,
          task_name: taskName.trim(),
          icon: taskIcon.trim() || '🧹',
          instructions: taskInstructions.trim() || null,
          estimated_duration: Math.max(1, Math.min(480, taskDuration)),
          auto_assign: true,
          sort_order: sectionTasks.length * 10 + 10,
          created_by: user?.id || null,
        })
        .select('id, section_id, task_name, icon, instructions, estimated_duration, auto_assign, is_active, sort_order')
        .single();
      if (error) throw error;
      setTasks(previous => [...previous, data]);
      setTaskEditor({ open: false, section: null });
      toast.success(`${data.task_name} will be included in Auto-Assign`);
    } catch (error: any) {
      console.error('[HotelFloorMap] area task save failed', error);
      toast.error(error?.code === '23505' ? 'This area task already exists in the section' : 'Area task could not be saved');
    } finally {
      setBusy(false);
    }
  };

  const removeTask = async (task: SectionTask) => {
    setTasks(previous => previous.filter(candidate => candidate.id !== task.id));
    try {
      const { error } = await (supabase as any)
        .from('hotel_housekeeping_section_tasks')
        .delete()
        .eq('id', task.id);
      if (error) throw error;
      toast.success(`${task.task_name} removed from Auto-Assign`);
    } catch (error) {
      setTasks(previous => [...previous, task]);
      toast.error('Area task could not be removed');
    }
  };

  const startRoomDrag = (event: React.DragEvent, roomId: string) => {
    event.dataTransfer.setData('application/x-hotelcare-room', roomId);
    event.dataTransfer.setData('text/plain', roomId);
    event.dataTransfer.effectAllowed = 'move';
    setDraggingRoomId(roomId);
    setSelectedRoomId(null);
  };

  const droppedRoomId = (event: React.DragEvent): string | null => (
    event.dataTransfer.getData('application/x-hotelcare-room')
    || event.dataTransfer.getData('text/plain')
    || draggingRoomId
    || null
  );

  const selectedRoom = selectedRoomId ? rooms.find(room => room.id === selectedRoomId) : null;

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-3 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Operational room sections</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Floors show the physical level. Sections keep nearby rooms and their shared-area cleaning together.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant="secondary">{sections.length || legacySections.length} sections</Badge>
              <Badge variant="secondary">{rooms.length} rooms</Badge>
              <Badge variant="secondary">{tasks.filter(task => task.auto_assign).length} auto area tasks</Badge>
              {unmappedRooms.length > 0 && sections.length > 0 && (
                <Badge variant="outline" className="border-amber-400 text-amber-700">{unmappedRooms.length} unmapped</Badge>
              )}
            </div>
          </div>

          {isAdmin && (
            <div className="flex flex-wrap items-center gap-2">
              {editMode ? (
                <>
                  <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                    <Check className="mr-1 h-3 w-3" />Changes save automatically
                  </Badge>
                  <Button size="sm" variant="outline" onClick={() => openCreateSection(floorOrder[0] ?? 0)}>
                    <Plus className="mr-1 h-3.5 w-3.5" />New section
                  </Button>
                  <Button size="sm" variant="outline" onClick={autoMapFloors} disabled={busy || unmappedRooms.length === 0}>
                    <Sparkles className="mr-1 h-3.5 w-3.5" />Auto-map floors
                  </Button>
                  <Button size="sm" onClick={() => { setEditMode(false); setSelectedRoomId(null); }}>
                    Done
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setEditMode(true)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" />Manage map
                </Button>
              )}
            </div>
          )}
        </div>

        {editMode && (
          <div className="mt-3 rounded-lg bg-primary/5 px-3 py-2 text-xs text-primary">
            Drag a room into a section. On a phone, tap the room and then tap its destination section.
            {selectedRoom && <strong className="ml-1">Room {selectedRoom.room_number} is selected.</strong>}
          </div>
        )}

        {sections.length === 0 && !editMode && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            This is the old wing grouping shown in a readable layout. An eligible manager can create operational sections from Manage map.
          </p>
        )}
      </div>

      {editMode && (
        <div
          className={`rounded-xl border-2 border-dashed p-3 transition-colors ${
            dragOverSectionId === 'unmapped' ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/20' : 'border-amber-300 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/10'
          }`}
          onClick={() => selectedRoomId && mappingByRoom.has(selectedRoomId) && void unmapRoom(selectedRoomId)}
          onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOverSectionId('unmapped'); }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOverSectionId(null); }}
          onDrop={event => {
            event.preventDefault();
            const roomId = droppedRoomId(event);
            setDragOverSectionId(null);
            setDraggingRoomId(null);
            if (roomId) void unmapRoom(roomId);
          }}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">Unmapped rooms ({unmappedRooms.length})</p>
              <p className="text-[10px] text-muted-foreground">New PMS rooms appear here. Drop a mapped room here to remove it from a section.</p>
            </div>
          </div>
          <div className="flex min-h-9 flex-wrap gap-1.5">
            {unmappedRooms.map(room => (
              <RoomChip
                key={room.id}
                room={room}
                assignment={assignments.get(room.id)}
                staffName={assignments.get(room.id) ? staffMap[assignments.get(room.id)!.assigned_to] || null : null}
                editMode
                selected={selectedRoomId === room.id}
                onRoomClick={onRoomClick}
                onSelect={roomId => setSelectedRoomId(previous => previous === roomId ? null : roomId)}
                onDragStart={startRoomDrag}
                onDragEnd={() => { setDraggingRoomId(null); setDragOverSectionId(null); }}
              />
            ))}
            {unmappedRooms.length === 0 && <span className="self-center text-xs text-muted-foreground">All rooms are mapped ✓</span>}
          </div>
        </div>
      )}

      {floorOrder.map(floor => {
        const floorSections = displaySections.filter(section => section.floor_number === floor);
        return (
          <section key={floor} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-semibold">{floorLabel(floor)}</Badge>
                <span className="text-xs text-muted-foreground">
                  {floorSections.length} section{floorSections.length === 1 ? '' : 's'} · {' '}
                  {floorSections.reduce((sum, section) => sum + (roomsBySection.get(section.id)?.length || 0), 0)} rooms
                </span>
              </div>
              {editMode && (
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openCreateSection(floor)}>
                  <Plus className="mr-1 h-3 w-3" />Section
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {floorSections.map(section => {
                const sectionRooms = roomsBySection.get(section.id) || [];
                const sectionTasks = tasksBySection.get(section.id) || [];
                const dropTarget = dragOverSectionId === section.id;
                const mismatchedFloors = sectionRooms.filter(room => inferFloor(room) !== section.floor_number).length;
                const legacy = section.id.startsWith('legacy-');

                return (
                  <div
                    key={section.id}
                    className={`min-w-0 rounded-xl border p-3 shadow-sm transition-all ${SECTION_COLORS[section.color] || SECTION_COLORS.slate} ${
                      dropTarget ? 'scale-[1.01] border-primary ring-2 ring-primary/30' : ''
                    } ${editMode && selectedRoomId ? 'cursor-pointer hover:ring-2 hover:ring-primary/30' : ''}`}
                    onClick={() => editMode && selectedRoomId && !legacy && void moveRoomToSection(selectedRoomId, section.id)}
                    onDragOver={!legacy && editMode ? event => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      setDragOverSectionId(section.id);
                    } : undefined}
                    onDragLeave={!legacy && editMode ? event => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOverSectionId(null);
                    } : undefined}
                    onDrop={!legacy && editMode ? event => {
                      event.preventDefault();
                      const roomId = droppedRoomId(event);
                      setDragOverSectionId(null);
                      setDraggingRoomId(null);
                      if (roomId) void moveRoomToSection(roomId, section.id);
                    } : undefined}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <h4 className="truncate text-sm font-semibold">{section.name}</h4>
                          <Badge variant="secondary" className="text-[10px]">{sectionRooms.length} rooms</Badge>
                        </div>
                        {section.description && <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{section.description}</p>}
                      </div>
                      {editMode && !legacy && (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={event => { event.stopPropagation(); openEditSection(section); }} title="Edit section">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={event => { event.stopPropagation(); setDeleteSection(section); }} title="Delete section">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>

                    {mismatchedFloors > 0 && (
                      <Badge variant="outline" className="mt-2 border-amber-400 text-[10px] text-amber-700">
                        {mismatchedFloors} room floor mismatch{mismatchedFloors === 1 ? '' : 'es'}
                      </Badge>
                    )}

                    <div className="mt-3 flex min-h-12 flex-wrap content-start gap-1.5 rounded-lg border border-black/5 bg-background/70 p-2 dark:border-white/5">
                      {sectionRooms.map(room => (
                        <RoomChip
                          key={room.id}
                          room={room}
                          assignment={assignments.get(room.id)}
                          staffName={assignments.get(room.id) ? staffMap[assignments.get(room.id)!.assigned_to] || null : null}
                          editMode={editMode && !legacy}
                          selected={selectedRoomId === room.id}
                          onRoomClick={onRoomClick}
                          onSelect={roomId => setSelectedRoomId(previous => previous === roomId ? null : roomId)}
                          onDragStart={startRoomDrag}
                          onDragEnd={() => { setDraggingRoomId(null); setDragOverSectionId(null); }}
                        />
                      ))}
                      {sectionRooms.length === 0 && (
                        <div className={`flex w-full items-center justify-center rounded border border-dashed p-3 text-center text-xs text-muted-foreground ${dropTarget ? 'bg-primary/5 text-primary' : ''}`}>
                          {editMode ? 'Drop or tap a room here' : 'No rooms in this section'}
                        </div>
                      )}
                    </div>

                    <div className="mt-3 border-t border-black/5 pt-2 dark:border-white/5">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Shared-area work · auto-assigned
                        </p>
                        {editMode && !legacy && (
                          <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={event => { event.stopPropagation(); openAddTask(section); }}>
                            <Plus className="mr-1 h-3 w-3" />Area
                          </Button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {sectionTasks.map(task => (
                          <span key={task.id} className="inline-flex items-center gap-1 rounded-full border bg-background/80 px-2 py-1 text-[10px]" title={task.instructions || task.task_name}>
                            <span>{task.icon}</span>
                            <span>{task.task_name}</span>
                            <span className="text-muted-foreground">{task.estimated_duration}m</span>
                            {editMode && (
                              <button type="button" className="ml-0.5 rounded-full text-muted-foreground hover:text-destructive" onClick={event => { event.stopPropagation(); void removeTask(task); }} aria-label={`Remove ${task.task_name}`}>
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </span>
                        ))}
                        {sectionTasks.length === 0 && <span className="text-[10px] text-muted-foreground">No recurring area work</span>}
                      </div>
                    </div>
                  </div>
                );
              })}

              {editMode && floorSections.length === 0 && (
                <button type="button" onClick={() => openCreateSection(floor)} className="flex min-h-36 items-center justify-center rounded-xl border-2 border-dashed text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary">
                  <Plus className="mr-2 h-4 w-4" />Create a section on {floorLabel(floor)}
                </button>
              )}
            </div>
          </section>
        );
      })}

      {floorOrder.length === 0 && (
        <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
          No room sections yet. {isAdmin && 'Choose Manage map, then create the first section.'}
        </div>
      )}

      <Dialog open={sectionEditor.open} onOpenChange={open => !busy && setSectionEditor(previous => ({ ...previous, open }))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{sectionEditor.section ? 'Edit section' : 'Create section'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="section-name">Section name</label>
              <input id="section-name" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={sectionName} onChange={event => setSectionName(event.target.value)} placeholder="e.g. 200 Side" autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="section-floor">Floor number</label>
                <input id="section-floor" type="number" min={-5} max={99} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={sectionFloor} onChange={event => setSectionFloor(Number(event.target.value))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="section-color">Colour</label>
                <select id="section-color" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={sectionColor} onChange={event => setSectionColor(event.target.value as SectionColor)}>
                  {Object.keys(SECTION_COLORS).map(color => <option key={color} value={color}>{color[0].toUpperCase() + color.slice(1)}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="section-description">Description (optional)</label>
              <textarea id="section-description" rows={3} className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm" value={sectionDescription} onChange={event => setSectionDescription(event.target.value)} placeholder="Where this section is and what it covers" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSectionEditor({ open: false, section: null, floor: 0 })} disabled={busy}>Cancel</Button>
            <Button onClick={saveSection} disabled={busy || !sectionName.trim()}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{sectionEditor.section ? 'Save changes' : 'Create section'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={taskEditor.open} onOpenChange={open => !busy && setTaskEditor(previous => ({ ...previous, open }))}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add shared-area work to {taskEditor.section?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Quick choices</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {AREA_PRESETS.map(preset => (
                  <button key={preset.name} type="button" onClick={() => choosePreset(preset)} className={`rounded-lg border p-2 text-center text-xs transition-colors hover:border-primary ${taskName === preset.name ? 'border-primary bg-primary/5' : ''}`}>
                    <span className="block text-lg">{preset.icon}</span>
                    <span className="block truncate">{preset.name}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-[72px_1fr_100px] gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="task-icon">Icon</label>
                <input id="task-icon" className="w-full rounded-md border border-input bg-background px-3 py-2 text-center text-sm" value={taskIcon} onChange={event => setTaskIcon(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="task-name">Area or service</label>
                <input id="task-name" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={taskName} onChange={event => setTaskName(event.target.value)} placeholder="Custom area name" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="task-duration">Minutes</label>
                <input id="task-duration" type="number" min={1} max={480} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={taskDuration} onChange={event => setTaskDuration(Number(event.target.value))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="task-instructions">Instructions (optional)</label>
              <textarea id="task-instructions" rows={3} className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm" value={taskInstructions} onChange={event => setTaskInstructions(event.target.value)} placeholder="What the housekeeper needs to clean or check" />
            </div>
            <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:bg-blue-950/30 dark:text-blue-200">
              This work will automatically follow the housekeeper who receives most rooms in this section.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTaskEditor({ open: false, section: null })} disabled={busy}>Cancel</Button>
            <Button onClick={saveTask} disabled={busy || !taskName.trim()}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add to Auto-Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteSection} onOpenChange={open => !open && !busy && setDeleteSection(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteSection?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its {(deleteSection && roomsBySection.get(deleteSection.id)?.length) || 0} room mappings and recurring area tasks will be removed. The rooms return to Unmapped and can be placed in another section.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={event => { event.preventDefault(); void confirmDeleteSection(); }} disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Remove section
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
