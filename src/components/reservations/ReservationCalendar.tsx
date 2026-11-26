import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addDays, differenceInDays, format, isSameDay, parseISO, startOfDay } from 'date-fns';
import {
  AlertTriangle, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Loader2,
  PanelLeftClose, PanelLeftOpen, Radio, Search, Settings2, Siren, Waves,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { ReservationHoverDetails } from '@/components/reservations/ReservationHoverDetails';
import { toast } from 'sonner';
import { todayBudapest } from '@/lib/budapestTime';
import { floatingState, needsAction, nightlyOccupancy, reservationAttention, topSeverity, type AttentionFlag } from '@/lib/receptionAttention';
import { columnWidthFor, groupRoomsByType, initialCalendarDays, loadCalendarOptions, saveCalendarOptions, type CalendarOptions, type CalendarWindowDays } from '@/lib/receptionCalendarOptions';
import { useTranslation } from '@/hooks/useTranslation';
import { useLocaleFormat } from '@/lib/i18n/localeFormat';
import { bookingSourceLabel, reservationStatusLabel, roomStatusLabel } from '@/lib/i18n/receptionLabels';
import { nightsBetween as stayNights, reservationChannel, reservationGuestLabel } from '@/lib/reservations';
import { getRoomLaneCount, layoutRoomStays } from '@/lib/receptionPlanner';
import { displayRoomType } from '@/lib/roomTypeDisplay';
import { LifecycleError, updateReservation } from '@/lib/pmsLifecycle';

interface PlannerRoom {
  id: string;
  room_number: string;
  room_type?: string | null;
  status?: string | null;
}

/** Reservation rows as delivered by the reception workspace (loosely typed upstream). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CalReservation = Record<string, any>;

interface ReservationCalendarProps {
  rooms: PlannerRoom[];
  reservations: any[];
  basePath: string;
  showUnassigned?: boolean;
  /** Full-width reception route; other calendar consumers retain their defaults. */
  wideWorkspace?: boolean;
  /** Allow drag-to-move / edge-resize with a confirmation dialog (native PMS hotels). */
  editable?: boolean;
  /** Called after a confirmed drag/resize change is saved, so the caller can refetch. */
  onChanged?: () => void;
  /** One-tap check-in / check-out from the right-click menu (dialogs live in the caller). */
  onQuickAction?: (reservation: CalReservation, action: 'checkin' | 'checkout') => void;
  /** Name of the PMS that owns the bookings (e.g. "Previo"); null when HotelCare is the PMS. */
  pmsName?: string | null;
  /** Reception changes a room's housekeeping status from the room column. Omit to make it read-only. */
  onRoomStatusChange?: (room: PlannerRoom, status: RoomStatus) => Promise<void> | void;
  onRoomPeriodManage?: (room: PlannerRoom) => void;
}

export type RoomStatus = 'clean' | 'dirty' | 'out_of_order' | 'out_of_service' | 'maintenance';
const ROOM_STATUSES: RoomStatus[] = ['clean', 'dirty', 'out_of_order', 'out_of_service', 'maintenance'];
/** Pill + dot colours per room status; unknown values fall back to a neutral pill. */
const ROOM_STATUS_STYLE: Record<string, { pill: string; dot: string }> = {
  clean: { pill: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800', dot: 'bg-emerald-500' },
  dirty: { pill: 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800', dot: 'bg-amber-500' },
  out_of_order: { pill: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-950 dark:text-red-200 dark:border-red-800', dot: 'bg-red-600' },
  out_of_service: { pill: 'bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-950 dark:text-violet-200 dark:border-violet-800', dot: 'bg-violet-600' },
  maintenance: { pill: 'bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-950 dark:text-violet-200 dark:border-violet-800', dot: 'bg-violet-500' },
};
const ROOM_STATUS_FALLBACK = { pill: 'bg-muted text-muted-foreground border-border', dot: 'bg-muted-foreground/40' };

const ROOM_WIDTH = 216;
const ROOM_WIDTH_WIDE_WORKSPACE = 184;
const ROOM_WIDTH_COLLAPSED = 104;
/** Fixed header heights so the three frozen rows stack exactly. */
const HEAD_MONTH_H = 28;
const HEAD_DAYS_H = 58;
const HEAD_OCC_H = 38;
const FLOATING_ROW = '__floating__';
const ACTIVE_STATUSES = new Set(['pending', 'confirmed', 'checked_in', 'checked_out']);
const EDGE_PX = 9;

const RESERVATION_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 border-amber-400 text-amber-950 dark:bg-amber-950 dark:text-amber-100',
  confirmed: 'bg-emerald-600 border-emerald-700 text-white',
  checked_in: 'bg-sky-600 border-sky-700 text-white',
  checked_out: 'bg-slate-400 border-slate-500 text-white',
};

function startNearToday() {
  // Two preceding days are enough to explain turnarounds without burying arrivals.
  return addDays(startOfDay(new Date()), -2);
}

const ATTENTION_DOT: Record<string, string> = {
  high: 'bg-red-600 ring-white',
  medium: 'bg-amber-400 ring-white',
};

type DragMode = 'move' | 'start' | 'end';
interface DragState {
  reservation: CalReservation;
  mode: DragMode;
  originX: number;
  originY: number;
  dayDelta: number;
  targetRoomId: string | null;
  moved: boolean;
  pointerId: number;
}
interface PendingChange {
  reservation: CalReservation;
  fromRoom: PlannerRoom | null;
  toRoom: PlannerRoom | null;
  fromIn: string;
  fromOut: string;
  toIn: string;
  toOut: string;
}

const nightsBetween = (from: string, to: string) =>
  Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86400000));

/** Read-only snapshot bookings are displayed separately from editable HotelCare records. */
export function ReservationCalendar({ rooms, reservations, basePath, showUnassigned = true, editable = false, onChanged, onQuickAction, pmsName = null, onRoomStatusChange, onRoomPeriodManage, wideWorkspace = false }: ReservationCalendarProps) {
  const { t } = useTranslation();
  const locale = useLocaleFormat();
  const navigate = useNavigate();
  // Prefer a longer range on spacious reception workstations without resetting manual choices.
  const [days, setDays] = useState<CalendarWindowDays>(() => initialCalendarDays(typeof window === 'undefined' ? 0 : window.innerWidth, wideWorkspace));
  const [startDate, setStartDate] = useState(startNearToday);
  const [roomSearch, setRoomSearch] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  // Dim every booking that does not need a person to act.
  const [focusAttention, setFocusAttention] = useState(false);
  const [roomsCollapsed, setRoomsCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth > 0 && window.innerWidth < 640);
  const [options, setOptions] = useState<CalendarOptions>(loadCalendarOptions);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [containerWidth, setContainerWidth] = useState(0);
  const setOption = <K extends keyof CalendarOptions>(key: K, value: CalendarOptions[K]) => {
    setOptions((current) => { const next = { ...current, [key]: value }; saveCalendarOptions(next); return next; });
  };
  const [resQuery, setResQuery] = useState('');
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusMenuRoom, setStatusMenuRoom] = useState<string | null>(null);
  const [statusSaving, setStatusSaving] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  // A press that the drag logic already handled (opened or moved) must not open the booking a second time on click.
  const pointerHandled = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const today = todayBudapest();
  const roomWidth = roomsCollapsed ? ROOM_WIDTH_COLLAPSED : wideWorkspace ? ROOM_WIDTH_WIDE_WORKSPACE : ROOM_WIDTH;
  const columnWidth = columnWidthFor(options, containerWidth - roomWidth, days);
  const columnRef = useRef(columnWidth);
  columnRef.current = columnWidth;
  const laneHeight = options.compact ? 29 : 43;
  const barHeight = options.compact ? 24 : 38;
  const rowHeight = options.compact ? 34 : 50;

  // Responsive: the day columns stretch or shrink with the space that is really there.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    setContainerWidth(node.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => setContainerWidth(Math.round(entries[0]?.contentRect.width ?? 0)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const endDate = useMemo(() => addDays(startDate, days), [startDate, days]);
  const dates = useMemo(() => Array.from({ length: days }, (_, i) => addDays(startDate, i)), [startDate, days]);
  const currentStart = format(startDate, 'yyyy-MM-dd', { locale: locale.dateFnsLocale });
  const currentEnd = format(endDate, 'yyyy-MM-dd', { locale: locale.dateFnsLocale });
  const active = useMemo(() => reservations.filter((reservation) =>
    ACTIVE_STATUSES.has(reservation.status)
    && !(options.hideCheckedOut && reservation.status === 'checked_out')
    && typeof reservation.check_in_date === 'string'
    && typeof reservation.check_out_date === 'string'
    && reservation.check_out_date > currentStart
    && reservation.check_in_date < currentEnd
    && reservation.check_out_date > reservation.check_in_date,
  ), [reservations, currentStart, currentEnd, options.hideCheckedOut]);

  const roomBookings = useMemo(() => {
    const bookings = new Map<string, any[]>();
    for (const reservation of active) {
      if (!reservation.room_id) continue;
      const group = bookings.get(reservation.room_id) ?? [];
      group.push(reservation);
      bookings.set(reservation.room_id, group);
    }
    return bookings;
  }, [active]);

  const visibleRooms = useMemo(() => {
    const term = roomSearch.trim().toLocaleLowerCase();
    return rooms
      .filter((room) => (!term || `${room.room_number} ${room.room_type ?? ''} ${displayRoomType(room.room_type)}`.toLocaleLowerCase().includes(term))
        && (!onlyAvailable || !(roomBookings.get(room.id)?.length)))
      .slice()
      .sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));
  }, [rooms, roomBookings, roomSearch, onlyAvailable]);

  const unassigned = useMemo(() => active.filter((r) => !r.room_id && r.status !== 'checked_out' && !r.snapshotOnly), [active]);
  const floatingStays = useMemo(() => layoutRoomStays(unassigned), [unassigned]);
  const floatingUrgent = useMemo(() => unassigned.filter((r) => floatingState(r, today) === 'urgent').length, [unassigned, today]);
  const roomGroups = useMemo(() => groupRoomsByType(visibleRooms, options.groupByType), [visibleRooms, options.groupByType]);
  // Arrivals / departures per day, under each date.
  const dayMoves = useMemo(() => {
    const moves = new Map<string, { arrivals: number; departures: number }>();
    for (const r of active) {
      if (r.snapshotOnly) continue;
      const a = moves.get(r.check_in_date) ?? { arrivals: 0, departures: 0 };
      a.arrivals += 1; moves.set(r.check_in_date, a);
      const d = moves.get(r.check_out_date) ?? { arrivals: 0, departures: 0 };
      d.departures += 1; moves.set(r.check_out_date, d);
    }
    return moves;
  }, [active]);

  const roomById = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms]);
  const attentionById = useMemo(() => {
    const flags = new Map<string, AttentionFlag[]>();
    for (const reservation of active) {
      const room = reservation.room_id ? roomById.get(reservation.room_id) : undefined;
      flags.set(reservation.id, reservationAttention(reservation, today, room?.status));
    }
    return flags;
  }, [active, roomById, today]);
  const actionCount = useMemo(
    () => [...attentionById.values()].filter((flags) => needsAction(flags)).length,
    [attentionById],
  );
  const occupancy = useMemo(
    () => nightlyOccupancy(reservations, dates.map((date) => format(date, 'yyyy-MM-dd', { locale: locale.dateFnsLocale })), rooms.length),
    [reservations, dates, rooms.length],
  );
  const conflictRooms = useMemo(() => {
    let count = 0;
    for (const room of rooms) {
      if (layoutRoomStays(roomBookings.get(room.id) ?? []).some((stay) => stay.overlaps)) count += 1;
    }
    return count;
  }, [rooms, roomBookings]);

  // Find any reservation by guest, number or OTA code and jump the window to it.
  const searchMatches = useMemo(() => {
    const term = resQuery.trim().toLocaleLowerCase();
    if (term.length < 2) return [];
    return reservations
      .filter((r) => ACTIVE_STATUSES.has(r.status) && typeof r.check_in_date === 'string')
      .filter((r) => `${reservationGuestLabel(r)} ${r.reservation_number ?? ''} ${r.ota_reservation_code ?? ''}`.toLocaleLowerCase().includes(term))
      .sort((a, b) => String(a.check_in_date).localeCompare(String(b.check_in_date)))
      .slice(0, 8);
  }, [reservations, resQuery]);

  const jumpToReservation = (reservation: CalReservation) => {
    setResQuery('');
    setRoomSearch('');
    setOnlyAvailable(false);
    setStartDate(addDays(parseISO(reservation.check_in_date), -2));
    setHighlightId(reservation.id);
  };

  useEffect(() => {
    if (!highlightId) return;
    const reservation = reservations.find((r) => r.id === highlightId);
    const row = reservation?.room_id ? rowRefs.current.get(reservation.room_id) : null;
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const timer = setTimeout(() => setHighlightId(null), 4000);
    return () => clearTimeout(timer);
  }, [highlightId, reservations]);

  const openReservation = (reservation: any) => {
    if (reservation.snapshotOnly) return;
    navigate(`${basePath}/reservations/${reservation.id}`);
  };

  const setAnchor = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    const date = parseISO(value);
    if (Number.isNaN(date.getTime())) return;
    setStartDate(addDays(date, -2));
  };

  // ---- drag to move / resize -------------------------------------------------
  const canDrag = (reservation: CalReservation, mode: DragMode): boolean => {
    if (!editable || reservation.snapshotOnly) return false;
    if (mode === 'end') return ['pending', 'confirmed', 'checked_in'].includes(reservation.status);
    return ['pending', 'confirmed'].includes(reservation.status);
  };

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>, reservation: CalReservation) => {
    if (!editable || reservation.snapshotOnly || event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const mode: DragMode = offsetX <= EDGE_PX ? 'start' : offsetX >= rect.width - EDGE_PX ? 'end' : 'move';
    if (!canDrag(reservation, mode)) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const state: DragState = {
      reservation, mode, originX: event.clientX, originY: event.clientY,
      dayDelta: 0, targetRoomId: reservation.room_id ?? null, moved: false, pointerId: event.pointerId,
    };
    dragRef.current = state;
    setDrag(state);
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state || event.pointerId !== state.pointerId) return;
    const dayDelta = Math.round((event.clientX - state.originX) / columnRef.current);
    let targetRoomId = state.targetRoomId;
    if (state.mode === 'move') {
      const hit = document.elementFromPoint?.(event.clientX, event.clientY)?.closest('[data-cal-room]');
      // Dropping on the floating lane never un-assigns a room: that stays an explicit edit.
      if (hit && hit.getAttribute('data-cal-room') !== FLOATING_ROW) targetRoomId = hit.getAttribute('data-cal-room');
    }
    const moved = state.moved || Math.abs(event.clientX - state.originX) > 5 || Math.abs(event.clientY - state.originY) > 5;
    const next = { ...state, dayDelta, targetRoomId, moved };
    dragRef.current = next;
    setDrag(next);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state || event.pointerId !== state.pointerId) return;
    dragRef.current = null;
    setDrag(null);
    pointerHandled.current = true;
    setTimeout(() => { pointerHandled.current = false; }, 400);
    const { reservation, mode, dayDelta, targetRoomId, moved } = state;
    if (!moved) { openReservation(reservation); return; }

    const fromIn: string = reservation.check_in_date;
    const fromOut: string = reservation.check_out_date;
    let toIn = fromIn;
    let toOut = fromOut;
    if (mode === 'move') {
      toIn = format(addDays(parseISO(fromIn), dayDelta), 'yyyy-MM-dd', { locale: locale.dateFnsLocale });
      toOut = format(addDays(parseISO(fromOut), dayDelta), 'yyyy-MM-dd', { locale: locale.dateFnsLocale });
    } else if (mode === 'start') {
      toIn = format(addDays(parseISO(fromIn), dayDelta), 'yyyy-MM-dd', { locale: locale.dateFnsLocale });
      if (toIn >= fromOut) toIn = format(addDays(parseISO(fromOut), -1), 'yyyy-MM-dd', { locale: locale.dateFnsLocale });
    } else {
      toOut = format(addDays(parseISO(fromOut), dayDelta), 'yyyy-MM-dd', { locale: locale.dateFnsLocale });
      if (toOut <= fromIn) toOut = format(addDays(parseISO(fromIn), 1), 'yyyy-MM-dd', { locale: locale.dateFnsLocale });
    }
    const fromRoom = reservation.room_id ? roomById.get(reservation.room_id) ?? null : null;
    const toRoom = mode === 'move' && targetRoomId ? roomById.get(targetRoomId) ?? fromRoom : fromRoom;
    if (toIn === fromIn && toOut === fromOut && (toRoom?.id ?? null) === (fromRoom?.id ?? null)) return;
    setPending({ reservation, fromRoom, toRoom, fromIn, fromOut, toIn, toOut });
  };

  const applyPending = async () => {
    if (!pending) return;
    setSaving(true);
    try {
      await updateReservation({
        reservationId: pending.reservation.id,
        checkIn: pending.toIn !== pending.fromIn ? pending.toIn : null,
        checkOut: pending.toOut !== pending.fromOut ? pending.toOut : null,
        roomId: pending.toRoom && pending.toRoom.id !== pending.fromRoom?.id ? pending.toRoom.id : null,
      });
      toast.success(t('pms.cal.changed'));
      setPending(null);
      onChanged?.();
    } catch (error) {
      const key = error instanceof LifecycleError ? error.translationKey : null;
      toast.error(key ? t(key) : (error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const gridWidth = days * columnWidth;
  const monthGroups = useMemo(() => {
    const groups: { key: string; label: string; count: number }[] = [];
    for (const date of dates) {
      const key = format(date, 'yyyy-MM', { locale: locale.dateFnsLocale });
      const latest = groups[groups.length - 1];
      if (latest?.key === key) latest.count += 1;
      else groups.push({ key, label: locale.formatMonthYear(date), count: 1 });
    }
    return groups;
  }, [dates, locale]);

  const stickyLeft = 'sticky left-0 z-20 bg-card border-r border-border shrink-0';
  const todayCol = (date: Date) => isSameDay(date, new Date());

  const copyReference = (reservation: CalReservation) => {
    const ref = String(reservation.ota_reservation_code || reservation.pms_reservation_id || reservation.reservation_number || '');
    if (!ref) return;
    void navigator.clipboard?.writeText(ref).then(() => toast.success(t('pms.cal.copied'))).catch(() => undefined);
  };

  const renderBar = (reservation: CalReservation, lane: number, overlaps: boolean, roomLabel: string | null) => {
    const start = Math.max(0, differenceInDays(parseISO(reservation.check_in_date), startDate));
    const end = Math.min(days, differenceInDays(parseISO(reservation.check_out_date), startDate));
    if (end <= start) return null;
    const snapshot = reservation.snapshotOnly === true;
    const label = reservationGuestLabel(reservation);
    const flags = attentionById.get(reservation.id) ?? [];
    const severity = topSeverity(flags);
    const actionable = needsAction(flags);
    const dimmed = focusAttention && !actionable && !overlaps;
    const reasons = flags.map((flag) => t(`pms.attention.${flag.kind}`)).join(', ');
    const dragging = drag?.moved && drag.reservation.id === reservation.id;
    const dragShift = dragging && drag ? (drag.mode === 'start' ? 0 : drag.dayDelta * columnWidth) : 0;
    const dragResize = dragging && drag && drag.mode !== 'move' ? drag.dayDelta * columnWidth * (drag.mode === 'start' ? -1 : 1) : 0;
    const draggable = editable && !snapshot && canDrag(reservation, 'move');
    const resizable = editable && !snapshot && canDrag(reservation, 'end');
    const highlighted = highlightId === reservation.id;
    const floating = !reservation.room_id;
    const channel = reservationChannel(reservation);
    const width = Math.max(20, (end - start) * columnWidth - 4 + dragResize);
    const nights = stayNights(reservation.check_in_date, reservation.check_out_date);
    // One word for where the booking stands; a confirmed booking without a room reads "Floating".
    const statusWord = floating && ['pending', 'confirmed'].includes(reservation.status)
      ? t('pms.cal.statusFloating')
      : reservationStatusLabel(reservation.status, t);
    const nightsLabel = nights > 0 ? `${nights} ${t(nights === 1 ? 'pms.cal.night' : 'pms.cal.nights')}` : '';
    const detail = [statusWord, options.showNights ? nightsLabel : ''].filter(Boolean).join(' · ');
    const canCheckIn = !!onQuickAction && !snapshot && ['pending', 'confirmed'].includes(reservation.status) && reservation.check_in_date <= today;
    const canCheckOut = !!onQuickAction && !snapshot && reservation.status === 'checked_in';
    const bar = (
      <div
        role="button"
        tabIndex={snapshot ? -1 : 0}
        aria-disabled={snapshot}
        onPointerDown={(event) => beginDrag(event, reservation)}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={() => { dragRef.current = null; setDrag(null); }}
        // Read-only plans (Previo hotels) and bookings that cannot be dragged never start a drag: a plain click opens them.
        onClick={() => { if (pointerHandled.current) { pointerHandled.current = false; return; } openReservation(reservation); }}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openReservation(reservation); } }}
        aria-label={`${label}, ${statusWord}${nightsLabel ? `, ${nightsLabel}` : ''}, ${locale.formatDate(reservation.check_in_date)} – ${locale.formatDate(reservation.check_out_date)}${snapshot ? ', ' + t('pms.workspace.readOnlySnapshot') : ''}${overlaps ? ', ' + t('pms.workspace.roomConflict') : ''}${reasons ? `, ${reasons}` : ''}`}
        className={`absolute flex items-center gap-1 rounded border font-semibold text-left px-1 overflow-hidden transition-opacity select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${options.compact ? 'text-[10px]' : 'text-[11px]'} ${RESERVATION_COLORS[reservation.status] || 'bg-muted border-border'} ${snapshot ? 'border-dashed opacity-75 cursor-not-allowed' : draggable ? 'hover:brightness-95 cursor-grab active:cursor-grabbing' : 'hover:brightness-95 cursor-pointer'} ${floating ? 'border-dashed' : ''} ${overlaps ? 'ring-2 ring-destructive ring-inset' : ''} ${dimmed ? 'opacity-25' : ''} ${dragging ? 'z-30 opacity-80 shadow-lg ring-2 ring-primary' : ''} ${highlighted ? 'z-20 ring-4 ring-primary animate-pulse' : ''}`}
        style={{
          left: start * columnWidth + 2 + dragShift + (dragging && drag?.mode === 'start' ? drag.dayDelta * columnWidth : 0),
          top: lane * laneHeight + 4,
          width,
          height: barHeight,
          touchAction: draggable || resizable ? 'none' : undefined,
        }}
      >
        {resizable && <span className="absolute inset-y-0 left-0 w-[7px] cursor-ew-resize bg-black/0 hover:bg-black/20" aria-hidden="true" />}
        <span
          className={`shrink-0 grid place-items-center rounded-[4px] font-bold leading-none ${options.compact ? 'h-4 min-w-4 px-0.5 text-[9px]' : 'h-5 min-w-5 px-1 text-[10px]'} ${channel.badgeClass}`}
          title={channel.label}
          data-channel={channel.key}
          aria-hidden="true"
        >{channel.letter}</span>
        {options.compact
          ? <span className="truncate">{label}{width > 150 && detail ? <span className="font-normal opacity-85"> · {detail}</span> : null}</span>
          : <span className="min-w-0 flex-1 leading-[1.15]">
              <span className="block truncate">{label}</span>
              <span className="block truncate text-[10px] font-medium opacity-85">{width > 96 ? detail : (options.showNights && nightsLabel) || statusWord}</span>
            </span>}
        {snapshot && <Radio className="h-3 w-3 shrink-0 ml-auto" />}
        {actionable && severity && ATTENTION_DOT[severity] && (
          <span className={`ml-auto h-2.5 w-2.5 shrink-0 rounded-full ring-2 ${ATTENTION_DOT[severity]}`} aria-hidden="true" />
        )}
        {resizable && <span className="absolute inset-y-0 right-0 w-[7px] cursor-ew-resize bg-black/0 hover:bg-black/20" aria-hidden="true" />}
      </div>
    );
    const hover = (
      <HoverCard key={reservation.id} openDelay={250} closeDelay={80}>
        <HoverCardTrigger asChild>{bar}</HoverCardTrigger>
        <HoverCardContent side="top" align="start" className="w-72 p-3">
          <ReservationHoverDetails reservation={reservation} roomLabel={roomLabel ?? t('pms.cal.floating')} flags={flags} />
        </HoverCardContent>
      </HoverCard>
    );
    if (snapshot) return hover;
    // Right-click (or long-press): the actions reception uses most, without opening the booking first.
    return (
      <ContextMenu key={reservation.id}>
        <ContextMenuTrigger asChild><div className="contents">{hover}</div></ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuLabel className="truncate text-xs">{label}<span className="block font-normal text-muted-foreground">{bookingSourceLabel(channel.label, t)} · {locale.formatDate(reservation.check_in_date)} → {locale.formatDate(reservation.check_out_date)}</span></ContextMenuLabel>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => openReservation(reservation)}>{t('pms.cal.ctxOpen')}</ContextMenuItem>
          {canCheckIn && <ContextMenuItem onSelect={() => onQuickAction?.(reservation, 'checkin')}>{t('pms.checkIn')}</ContextMenuItem>}
          {canCheckOut && <ContextMenuItem onSelect={() => onQuickAction?.(reservation, 'checkout')}>{t('pms.checkOut')}</ContextMenuItem>}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => copyReference(reservation)}>{t('pms.cal.ctxCopy')}</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  const dayStripes = (
    <div className="absolute inset-0 flex" aria-hidden="true">{dates.map((date) => <div key={format(date, 'yyyy-MM-dd', { locale: locale.dateFnsLocale })} className={`shrink-0 border-r ${todayCol(date) ? 'border-x border-primary/30 bg-primary/5' : `border-border ${[0, 6].includes(date.getDay()) ? 'bg-muted/20' : ''}`}`} style={{ width: columnWidth }} />)}</div>
  );

  // Room status lives next to the room number: readable at a glance, one tap to change.
  const renderRoomStatus = (room: PlannerRoom) => {
    const status = String(room.status ?? '');
    const style = ROOM_STATUS_STYLE[status] ?? ROOM_STATUS_FALLBACK;
    const text = roomStatusLabel(status, t);
    const face = roomsCollapsed
      ? <span className={`h-2.5 w-2.5 rounded-full ${style.dot}`} />
      : <><span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden="true" /><span className="truncate">{text}</span></>;
    const pillClass = roomsCollapsed
      ? 'h-6 w-6 shrink-0 grid place-items-center rounded-full'
      : `shrink-0 ${wideWorkspace ? 'max-w-[92px]' : 'max-w-[112px]'} inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none ${style.pill}`;
    if (!onRoomStatusChange) return <span className={pillClass} title={text} data-room-status={status}>{face}</span>;
    const choose = async (next: RoomStatus) => {
      setStatusMenuRoom(null);
      if (next === status) return;
      if ((next === 'out_of_order' || next === 'out_of_service') && onRoomPeriodManage) {
        onRoomPeriodManage(room);
        return;
      }
      setStatusSaving(room.id);
      try { await onRoomStatusChange(room, next); } finally { setStatusSaving(null); }
    };
    return (
      <Popover open={statusMenuRoom === room.id} onOpenChange={(open) => setStatusMenuRoom(open ? room.id : null)}>
        <PopoverTrigger asChild>
          <button type="button" disabled={statusSaving === room.id} data-room-status={status}
            aria-label={`${room.room_number}: ${text}. ${t('pms.room.setStatus')}`} title={`${text} · ${t('pms.room.setStatus')}`}
            className={`${pillClass} transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${roomsCollapsed ? 'hover:bg-accent' : ''}`}>
            {face}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="right" className="w-52 p-2">
          <p className="px-1 pb-1.5 text-xs font-semibold">{room.room_number} · {t('pms.room.setStatus')}</p>
          <div className="grid gap-1">
            {ROOM_STATUSES.map((option) => (
              <button key={option} type="button" onClick={() => void choose(option)} aria-pressed={option === status}
                className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs font-medium text-left transition hover:brightness-95 ${ROOM_STATUS_STYLE[option].pill} ${option === status ? 'ring-2 ring-primary' : ''}`}>
                <span className={`h-2 w-2 rounded-full ${ROOM_STATUS_STYLE[option].dot}`} aria-hidden="true" />
                {t(`pms.room.status_${option}`)}
              </button>
            ))}
          </div>
          {onRoomPeriodManage && <Button size="sm" variant="outline" className="mt-2 w-full text-xs"
            onClick={() => { setStatusMenuRoom(null); onRoomPeriodManage(room); }}>
            {t('ntak.phase4.manage')}
          </Button>}
          <p className="px-1 pt-2 text-[10px] text-muted-foreground">{t('pms.room.statusHint')}</p>
        </PopoverContent>
      </Popover>
    );
  };

  const renderRoomRow = (room: PlannerRoom, roomIndex: number) => {
    const positioned = layoutRoomStays(roomBookings.get(room.id) ?? []);
    const roomHeight = Math.max(rowHeight, getRoomLaneCount(positioned) * laneHeight + 7);
    const conflict = positioned.some((stay) => stay.overlaps);
    const dropTarget = drag?.mode === 'move' && drag.moved && drag.targetRoomId === room.id;
    return <div
      key={room.id}
      ref={(node) => { if (node) rowRefs.current.set(room.id, node); else rowRefs.current.delete(room.id); }}
      data-cal-room={room.id}
      className={`flex border-b border-border ${dropTarget ? 'bg-primary/10' : roomIndex % 2 ? 'bg-muted/10' : 'bg-card'}`}
    >
      <div className={`${stickyLeft} ${roomsCollapsed ? "px-1.5 gap-1.5" : "px-2.5 gap-2"} flex items-center ${dropTarget ? 'bg-primary/10' : ''}`} style={{ width: roomWidth, minHeight: roomHeight }}>
        <div className="min-w-0 flex-1">
          <div className="flex gap-1.5 items-center text-xs font-semibold">
            <span className="truncate" title={room.room_number}>{room.room_number}</span>
            {conflict && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-label={t('pms.cal.conflictHelp')}><title>{t('pms.cal.conflictHelp')}</title></AlertTriangle>}
            <span className="ml-auto shrink-0">{renderRoomStatus(room)}</span>
          </div>
          {!roomsCollapsed && !options.compact && <div className="text-[10px] text-muted-foreground truncate" title={displayRoomType(room.room_type)}>{displayRoomType(room.room_type) || '—'}</div>}
        </div>
      </div>
      <div className="relative shrink-0" style={{ width: gridWidth, height: roomHeight }}>
        {dayStripes}
        {positioned.map(({ reservation, lane, overlaps }) => renderBar(reservation, lane, overlaps, room.room_number))}
      </div>
    </div>;
  };

  const floatingHeight = Math.max(rowHeight, getRoomLaneCount(floatingStays) * laneHeight + 7);

  return (
    <Card data-training="res-planner" className="min-w-0 overflow-hidden">
      <CardHeader className="p-3 border-b border-border space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <h2 className="text-sm font-semibold flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{t('pms.planner.title')}</h2>
            <Badge variant="secondary" className="text-[11px]">{visibleRooms.length}/{rooms.length} {t('pms.res.room')}</Badge>
            {conflictRooms > 0 && <Badge variant="destructive" role="alert" className="gap-1 text-[11px]" title={t('pms.cal.conflictHelp')}>⚠️ {conflictRooms} {t('pms.cal.conflicts')}</Badge>}
            <Button
              type="button"
              size="sm"
              variant={focusAttention ? 'default' : 'outline'}
              className="h-7 gap-1 px-2 text-[11px]"
              aria-pressed={focusAttention}
              title={t('pms.planner.needsActionHint')}
              onClick={() => setFocusAttention((value) => !value)}
            >
              <Siren className="h-3.5 w-3.5" />
              {t('pms.planner.needsAction')}
              <span className={`rounded-full px-1.5 text-[10px] font-semibold ${actionCount > 0 ? 'bg-red-600 text-white' : 'bg-muted text-muted-foreground'}`}>{actionCount}</span>
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={() => setStartDate((current) => addDays(current, -7))} aria-label={t('pms.workspace.previousWeek')}><ChevronLeft className="h-4 w-4" /></Button>
            <Input type="date" aria-label={t('pms.workspace.focusDate')} className="h-8 w-[143px] text-xs" value={format(addDays(startDate, 2), 'yyyy-MM-dd', { locale: locale.dateFnsLocale })} onChange={(event) => setAnchor(event.target.value)} />
            <Button type="button" size="sm" variant="secondary" className="h-8 px-2.5 font-semibold" onClick={() => setStartDate(startNearToday())}>📍 {t('pms.planner.today')}</Button>
            <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={() => setStartDate((current) => addDays(current, 7))} aria-label={t('pms.workspace.nextWeek')}><ChevronRight className="h-4 w-4" /></Button>
            <div className="flex overflow-hidden rounded-md border border-border" role="group" aria-label={t('pms.workspace.dateRange')}>
              {([7, 14, 21, 31] as CalendarWindowDays[]).map((count) => <Button key={count} type="button" size="sm" variant={count === days ? 'default' : 'ghost'} className="rounded-none h-8 px-2 text-xs" aria-pressed={count === days} onClick={() => setDays(count)}>{t('pms.workspace.rangeDays').replace('{count}', String(count))}</Button>)}
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" size="icon" variant="outline" className="h-8 w-8" aria-label={t('pms.cal.options')} title={t('pms.cal.options')}><Settings2 className="h-4 w-4" /></Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 space-y-2.5 p-3" data-training="cal-options">
                <p className="text-xs font-semibold">{t('pms.cal.options')}</p>
                {([
                  ['fitToScreen', 'pms.cal.optFit'], ['compact', 'pms.cal.optCompact'], ['groupByType', 'pms.cal.optGroup'],
                  ['showNights', 'pms.cal.optNights'], ['hideCheckedOut', 'pms.cal.optHideOut'],
                ] as Array<[keyof CalendarOptions, string]>).map(([key, labelKey]) => (
                  <label key={key} className="flex items-center justify-between gap-3 text-xs cursor-pointer">
                    <span>{t(labelKey)}</span>
                    <Switch checked={options[key]} onCheckedChange={(value) => setOption(key, value)} aria-label={t(labelKey)} />
                  </label>
                ))}
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <div className="flex items-center flex-wrap gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input
              value={resQuery}
              onChange={(event) => setResQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && searchMatches[0]) jumpToReservation(searchMatches[0]); }}
              placeholder={t('pms.cal.findReservation')}
              aria-label={t('pms.cal.findReservation')}
              className="h-8 pl-8 text-xs"
            />
            {resQuery.trim().length >= 2 && (
              <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-md overflow-hidden">
                {searchMatches.length === 0
                  ? <div className="px-3 py-2 text-xs text-muted-foreground">{t('pms.cal.noMatches')}</div>
                  : searchMatches.map((r) => (
                    <button key={r.id} type="button" onClick={() => jumpToReservation(r)}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2">
                      <span className="font-semibold truncate">{reservationGuestLabel(r)}</span>
                      <span className="text-muted-foreground truncate">{locale.formatDate(r.check_in_date)} → {locale.formatDate(r.check_out_date)}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{r.room_id ? roomById.get(r.room_id)?.room_number ?? '' : t('pms.cal.floating')}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>
          <div className="relative w-full sm:w-52">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input value={roomSearch} onChange={(event) => setRoomSearch(event.target.value)} placeholder={t('pms.cal.roomFilter')} aria-label={t('pms.cal.roomFilter')} className="h-8 pl-8 text-xs" />
          </div>
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={onlyAvailable} onChange={(event) => setOnlyAvailable(event.target.checked)} className="accent-primary" />
            {t('pms.cal.onlyFree')}
          </label>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 items-center text-[11px] text-muted-foreground" aria-label={t('pms.workspace.legend')}>
          {(['confirmed', 'checked_in', 'pending', 'checked_out'] as const).map((status) => (
            <span key={status} className="inline-flex items-center gap-1"><span className={`inline-block w-4 h-2.5 rounded-sm border ${RESERVATION_COLORS[status]}`} /> {t(`pms.planner.legend_${status}`)}</span>
          ))}
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-red-600" /> {t('pms.planner.legendUrgent')}</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" /> {t('pms.planner.legendCheck')}</span>
          {editable && <span className="inline-flex items-center gap-1 text-primary/80">✥ {t('pms.cal.dragHint')}</span>}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {/* One scroll area for both axes so the three header rows and the room
            column stay frozen until the last room has scrolled past. */}
        <div ref={scrollRef} className={`w-full overflow-auto overscroll-x-contain ${wideWorkspace ? 'max-h-[70dvh] [scrollbar-gutter:stable]' : 'max-h-[72vh]'}`} data-training="res-planner-scroll" tabIndex={0} role="region" aria-label={t('pms.workspace.calendarRegion')}>
          <div style={{ minWidth: roomWidth + gridWidth }}>
            <div className="flex border-b border-border bg-card sticky top-0 z-30" style={{ height: HEAD_MONTH_H }}>
              <div className={`${stickyLeft} z-40 px-2 flex items-center justify-between gap-1 text-xs font-semibold`} style={{ width: roomWidth }}>
                {!roomsCollapsed && <span className="truncate">{t('pms.cal.roomsDates')}</span>}
                <Button type="button" size="icon" variant="ghost" className="h-6 w-6 shrink-0" aria-label={roomsCollapsed ? t('pms.cal.expandRooms') : t('pms.cal.collapseRooms')} title={roomsCollapsed ? t('pms.cal.expandRooms') : t('pms.cal.collapseRooms')} onClick={() => setRoomsCollapsed((value) => !value)}>
                  {roomsCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                </Button>
              </div>
              <div className="flex bg-muted/30" style={{ width: gridWidth }}>
                {monthGroups.map((group) => <div key={group.key} className="border-r border-border text-[11px] font-semibold flex justify-center items-center overflow-hidden whitespace-nowrap" style={{ width: group.count * columnWidth }}>{group.label}</div>)}
              </div>
            </div>
            <div className="flex border-b border-border bg-card sticky z-30" style={{ top: HEAD_MONTH_H, height: HEAD_DAYS_H }}>
              <div className={`${stickyLeft} z-40 px-3 flex items-center text-[10px] text-muted-foreground`} style={{ width: roomWidth }}>{visibleRooms.length} {!roomsCollapsed && t('pms.cal.rooms')}</div>
              <div className="flex bg-card" style={{ width: gridWidth }}>
                {dates.map((date) => {
                  const iso = format(date, 'yyyy-MM-dd', { locale: locale.dateFnsLocale });
                  const moves = dayMoves.get(iso);
                  return <div key={iso} className={`shrink-0 text-center border-r py-1 ${todayCol(date) ? 'border-x-2 border-primary bg-primary/15 text-primary' : `border-border ${[0, 6].includes(date.getDay()) ? 'bg-muted/50' : ''}`}`} style={{ width: columnWidth }}>
                    <div className={`text-[10px] uppercase truncate ${todayCol(date) ? 'font-bold' : 'text-muted-foreground'}`}>{todayCol(date) ? t('pms.planner.today') : locale.formatWeekdayShort(date)}</div>
                    <div className="text-sm font-semibold leading-tight">{format(date, 'd', { locale: locale.dateFnsLocale })}</div>
                    <div className="h-3 text-[9px] leading-3 text-muted-foreground whitespace-nowrap" title={moves ? `${moves.arrivals} ${t('pms.cal.arrivals')} · ${moves.departures} ${t('pms.cal.departures')}` : undefined}>
                      {moves && <><span className="text-emerald-700 dark:text-emerald-400">↓{moves.arrivals}</span> <span className="text-sky-700 dark:text-sky-400">↑{moves.departures}</span></>}
                    </div>
                  </div>;
                })}
              </div>
            </div>
            <div className="flex border-b border-border bg-card sticky z-30" style={{ top: HEAD_MONTH_H + HEAD_DAYS_H, height: HEAD_OCC_H }} aria-label={t('pms.planner.occupancy')}>
              <div className={`${stickyLeft} z-40 px-3 flex items-center text-[10px] text-muted-foreground`} style={{ width: roomWidth }}>{!roomsCollapsed && t('pms.planner.occupancy')}</div>
              <div className="flex bg-muted/20" style={{ width: gridWidth }}>
                {occupancy.map((night) => (
                  <div key={night.date} className="shrink-0 border-r border-border px-1 py-1 bg-inherit overflow-hidden" style={{ width: columnWidth }} title={`${night.occupied}/${rooms.length}`}>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-semibold">{night.percent == null ? '—' : `${night.percent}%`}</span>
                      {columnWidth >= 70 && <span className="text-muted-foreground">{night.occupied}/{rooms.length}</span>}
                    </div>
                    <div className="mt-0.5 h-1 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full ${night.percent != null && night.percent >= 90 ? 'bg-red-500' : night.percent != null && night.percent >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${night.percent ?? 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {showUnassigned && unassigned.length > 0 && (
              <div data-cal-room={FLOATING_ROW} data-training="cal-floating" className="flex border-b-2 border-dashed border-border bg-amber-50/50 dark:bg-amber-950/10" role="group" aria-label={`${t('pms.cal.floating')}: ${unassigned.length}`}>
                <div className={`${stickyLeft} bg-amber-50 dark:bg-amber-950/30 px-2.5 flex items-center gap-2`} style={{ width: roomWidth, minHeight: floatingHeight }} title={t(pmsName ? 'pms.cal.floatingHintPms' : 'pms.cal.floatingHintNative').replace('{pms}', pmsName ?? '')}>
                  <Waves className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 text-xs font-semibold"><span className="truncate">{roomsCollapsed ? unassigned.length : t('pms.cal.floating')}</span>{!roomsCollapsed && <Badge variant="secondary" className="h-4 px-1 text-[10px]">{unassigned.length}</Badge>}</div>
                    {!roomsCollapsed && floatingUrgent > 0 && <div className="text-[10px] text-amber-800 dark:text-amber-300 truncate">{floatingUrgent} {t('pms.cal.floatingUrgent')}</div>}
                  </div>
                </div>
                <div className="relative shrink-0" style={{ width: gridWidth, height: floatingHeight }}>
                  {dayStripes}
                  {floatingStays.map(({ reservation, lane }) => renderBar(reservation, lane, false, null))}
                </div>
              </div>
            )}
            {visibleRooms.length === 0 ? <div className="p-10 text-center text-sm text-muted-foreground">{t('pms.cal.noRoomsMatch')}</div> : roomGroups.map((group) => {
              const closed = group.label !== null && collapsedGroups.has(group.key);
              return <div key={group.key}>
                {group.label !== null && (
                  <div className="flex border-b border-border bg-muted/40">
                    <button type="button" aria-expanded={!closed}
                      onClick={() => setCollapsedGroups((current) => { const next = new Set(current); if (next.has(group.key)) next.delete(group.key); else next.add(group.key); return next; })}
                      className="sticky left-0 z-20 flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${closed ? '-rotate-90' : ''}`} />
                      {displayRoomType(group.label)}<Badge variant="secondary" className="h-4 px-1 text-[10px]">{group.rooms.length}</Badge>
                    </button>
                  </div>
                )}
                {!closed && group.rooms.map((room, roomIndex) => renderRoomRow(room, roomIndex))}
              </div>;
            })}
          </div>
        </div>
        {wideWorkspace && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium tabular-nums">{visibleRooms.length}/{rooms.length} {t('pms.cal.rooms')}</span>
          <span className="tabular-nums">{locale.formatDate(currentStart)} → {locale.formatDate(format(addDays(endDate, -1), 'yyyy-MM-dd'))}</span>
        </div>}
      </CardContent>

      <Dialog open={pending !== null} onOpenChange={(open) => { if (!open && !saving) setPending(null); }}>
        <DialogContent className="sm:max-w-md" data-training="cal-confirm-change">
          <DialogHeader><DialogTitle>{t('pms.cal.confirmTitle')}</DialogTitle></DialogHeader>
          {pending && (
            <div className="space-y-2 text-sm">
              <p className="font-semibold">{reservationGuestLabel(pending.reservation)} <span className="text-muted-foreground font-normal">· {pending.reservation.reservation_number}</span></p>
              <div className="rounded-md border border-border divide-y divide-border text-xs">
                <div className="grid grid-cols-[72px_1fr] gap-2 px-3 py-2">
                  <span className="text-muted-foreground">{t('pms.cal.room')}</span>
                  {pending.toRoom?.id !== pending.fromRoom?.id
                    ? <span><s className="text-muted-foreground">{pending.fromRoom?.room_number ?? t('pms.unified.unassigned')}</s> → <strong>{pending.toRoom?.room_number}</strong></span>
                    : <span>{pending.fromRoom?.room_number ?? t('pms.unified.unassigned')} <span className="text-muted-foreground">({t('pms.cal.unchanged')})</span></span>}
                </div>
                <div className="grid grid-cols-[72px_1fr] gap-2 px-3 py-2">
                  <span className="text-muted-foreground">{t('pms.cal.dates')}</span>
                  {pending.toIn !== pending.fromIn || pending.toOut !== pending.fromOut
                    ? <span><s className="text-muted-foreground">{pending.fromIn} → {pending.fromOut}</s><br /><strong>{pending.toIn} → {pending.toOut}</strong> · {nightsBetween(pending.toIn, pending.toOut)} {t('pms.cal.nights')}</span>
                    : <span>{pending.fromIn} → {pending.fromOut} <span className="text-muted-foreground">({t('pms.cal.unchanged')})</span></span>}
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">{t('pms.cal.logNote')}</p>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setPending(null)}>{t('common.cancel')}</Button>
            <Button type="button" disabled={saving} onClick={applyPending} className="gap-1.5">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}{t('pms.cal.apply')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
