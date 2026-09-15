import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, differenceInCalendarDays, format, isSameDay, parseISO, startOfDay } from 'date-fns';
import {
  BedDouble,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  DoorOpen,
  List,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  UserRoundCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  availableStatusActions,
  buildReadonlyPrevioStays,
  computeFrontDeskMetrics,
  createPmsManualReservation,
  getPmsFrontDeskFeed,
  reservationNightlyRate,
  reservationRoomId,
  transitionPmsManualReservation,
  updatePmsManualReservation,
  type PMSFrontDeskFeed,
  type PMSReadonlyStay,
  type PMSReservation,
  type PMSRoom,
} from '@/lib/pmsFrontDesk';
import type { ReservationStatus } from '@/domain/pms/reservations';

const WINDOW_DAYS = 14;
const ROOM_COLUMN_WIDTH = 178;
const DAY_WIDTH = 92;

const STATUS_STYLE: Record<string, string> = {
  tentative: 'bg-amber-100 border-amber-300 text-amber-950',
  confirmed: 'bg-blue-100 border-blue-300 text-blue-950',
  checked_in: 'bg-emerald-100 border-emerald-300 text-emerald-950',
  checked_out: 'bg-slate-100 border-slate-300 text-slate-700',
  cancelled: 'bg-rose-50 border-rose-200 text-rose-700',
  no_show: 'bg-rose-100 border-rose-300 text-rose-900',
};

const ACTION_LABEL: Partial<Record<ReservationStatus, string>> = {
  confirmed: 'Confirm',
  checked_in: 'Check in',
  checked_out: 'Check out',
  cancelled: 'Cancel',
  no_show: 'No-show',
};

type ViewMode = 'board' | 'list';

type EditorState = {
  open: boolean;
  reservation: PMSReservation | null;
};

type FormState = {
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  arrivalDate: string;
  departureDate: string;
  roomId: string;
  adults: string;
  children: string;
  nightlyRate: string;
  currency: string;
  notes: string;
};

function todayKey() {
  return format(startOfDay(new Date()), 'yyyy-MM-dd');
}

function blankForm(feed: PMSFrontDeskFeed | null, startDate: Date): FormState {
  return {
    guestName: '',
    guestEmail: '',
    guestPhone: '',
    arrivalDate: format(startDate, 'yyyy-MM-dd'),
    departureDate: format(addDays(startDate, 1), 'yyyy-MM-dd'),
    roomId: 'unassigned',
    adults: '1',
    children: '0',
    nightlyRate: '',
    currency: feed?.settings?.currency || 'EUR',
    notes: '',
  };
}

function reservationForm(reservation: PMSReservation): FormState {
  return {
    guestName: reservation.primary_guest_name || '',
    guestEmail: reservation.primary_guest_email || '',
    guestPhone: reservation.primary_guest_phone || '',
    arrivalDate: reservation.arrival_date,
    departureDate: reservation.departure_date,
    roomId: reservationRoomId(reservation) || 'unassigned',
    adults: String(reservation.adults ?? 1),
    children: String(reservation.children ?? 0),
    nightlyRate: String(reservationNightlyRate(reservation) ?? ''),
    currency: reservation.currency || 'EUR',
    notes: reservation.notes || '',
  };
}

function timeFraction(value: string | undefined, fallbackHour: number) {
  if (!value) return fallbackHour / 24;
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return fallbackHour / 24;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return fallbackHour / 24;
  return Math.max(0, Math.min(1, (hour + minute / 60) / 24));
}

function statusLabel(status: string) {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function stayGeometry(
  arrivalDate: string,
  departureDate: string,
  startDate: Date,
  checkInFraction: number,
  checkOutFraction: number,
) {
  const arrivalDay = differenceInCalendarDays(parseISO(arrivalDate), startDate);
  const departureDay = differenceInCalendarDays(parseISO(departureDate), startDate);
  const start = Math.max(0, arrivalDay + checkInFraction);
  const end = Math.min(WINDOW_DAYS, departureDay + checkOutFraction);
  return {
    left: start * DAY_WIDTH,
    width: Math.max(26, (end - start) * DAY_WIDTH),
  };
}

function naturalRoomSort(a: PMSRoom, b: PMSRoom) {
  return a.room_number.localeCompare(b.room_number, undefined, { numeric: true, sensitivity: 'base' });
}

export function PMSFrontDeskWorkspace() {
  const { profile } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const org = organizationSlug || profile?.organization_slug || '';
  const hotelId = profile?.assigned_hotel || '';

  const [startDate, setStartDate] = useState(() => startOfDay(new Date()));
  const [feed, setFeed] = useState<PMSFrontDeskFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('board');
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<EditorState>({ open: false, reservation: null });
  const [form, setForm] = useState<FormState>(() => blankForm(null, startOfDay(new Date())));
  const [saving, setSaving] = useState(false);

  const endDate = useMemo(() => addDays(startDate, WINDOW_DAYS), [startDate]);
  const startKey = format(startDate, 'yyyy-MM-dd');
  const endKey = format(endDate, 'yyyy-MM-dd');

  const loadFeed = useCallback(async () => {
    if (!org || !hotelId) {
      setFeed(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await getPmsFrontDeskFeed(org, hotelId, startKey, endKey);
      setFeed(next);
    } catch (err: any) {
      console.error('PMS front desk feed failed', err);
      setError(err?.message || 'Unable to load the front desk workspace.');
    } finally {
      setLoading(false);
    }
  }, [org, hotelId, startKey, endKey]);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  const rooms = useMemo(() => [...(feed?.rooms || [])].sort(naturalRoomSort), [feed?.rooms]);
  const readonlyStays = useMemo(() => buildReadonlyPrevioStays(feed?.previo_snapshots || []), [feed?.previo_snapshots]);
  const currentMetrics = useMemo(
    () => computeFrontDeskMetrics(feed?.reservations || [], todayKey()),
    [feed?.reservations],
  );

  const checkInFraction = timeFraction(feed?.settings?.default_check_in, 15);
  const checkOutFraction = timeFraction(feed?.settings?.default_check_out, 10);
  const dateRange = useMemo(
    () => Array.from({ length: WINDOW_DAYS }, (_, index) => addDays(startDate, index)),
    [startDate],
  );
  const timelineWidth = WINDOW_DAYS * DAY_WIDTH;

  const roomIdByNumber = useMemo(
    () => new Map(rooms.map((room) => [room.room_number, room.id])),
    [rooms],
  );

  const nativeByRoom = useMemo(() => {
    const map = new Map<string, PMSReservation[]>();
    for (const reservation of feed?.reservations || []) {
      const roomId = reservationRoomId(reservation);
      if (!roomId) continue;
      const list = map.get(roomId) || [];
      list.push(reservation);
      map.set(roomId, list);
    }
    return map;
  }, [feed?.reservations]);

  const previoByRoom = useMemo(() => {
    const map = new Map<string, PMSReadonlyStay[]>();
    for (const stay of readonlyStays) {
      const roomId = roomIdByNumber.get(stay.roomNumber);
      if (!roomId) continue;
      const list = map.get(roomId) || [];
      list.push(stay);
      map.set(roomId, list);
    }
    return map;
  }, [readonlyStays, roomIdByNumber]);

  const filteredNative = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return feed?.reservations || [];
    return (feed?.reservations || []).filter((reservation) =>
      [
        reservation.primary_guest_name,
        reservation.confirmation_code,
        reservation.primary_guest_email,
        reservation.primary_guest_phone,
        reservation.status,
      ].some((value) => value?.toLowerCase().includes(term)),
    );
  }, [feed?.reservations, search]);

  const filteredPrevio = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return readonlyStays;
    return readonlyStays.filter((stay) =>
      [stay.guestName, stay.roomNumber, stay.source, stay.status].some((value) => value.toLowerCase().includes(term)),
    );
  }, [readonlyStays, search]);

  const unassigned = useMemo(
    () => (feed?.reservations || []).filter((reservation) => !reservationRoomId(reservation) && !['cancelled', 'no_show', 'checked_out'].includes(reservation.status)),
    [feed?.reservations],
  );

  const openCreate = () => {
    setForm(blankForm(feed, startDate));
    setEditor({ open: true, reservation: null });
  };

  const openEdit = (reservation: PMSReservation) => {
    setForm(reservationForm(reservation));
    setEditor({ open: true, reservation });
  };

  const closeEditor = () => {
    if (saving) return;
    setEditor({ open: false, reservation: null });
  };

  const saveReservation = async () => {
    if (!org || !hotelId) return;
    const nightlyRate = Number(form.nightlyRate);
    const adults = Number(form.adults);
    const children = Number(form.children);
    if (!form.guestName.trim()) return toast.error('Guest name is required.');
    if (!form.arrivalDate || !form.departureDate || form.departureDate <= form.arrivalDate) {
      return toast.error('Departure must be after arrival.');
    }
    if (!Number.isFinite(nightlyRate) || nightlyRate < 0) return toast.error('Enter a valid nightly rate.');
    if (!Number.isInteger(adults) || adults < 0 || !Number.isInteger(children) || children < 0) {
      return toast.error('Guest counts must be non-negative whole numbers.');
    }

    setSaving(true);
    try {
      if (editor.reservation) {
        await updatePmsManualReservation(editor.reservation.id, {
          primary_guest_name: form.guestName.trim(),
          primary_guest_email: form.guestEmail.trim(),
          primary_guest_phone: form.guestPhone.trim(),
          arrival_date: form.arrivalDate,
          departure_date: form.departureDate,
          room_id: form.roomId === 'unassigned' ? null : form.roomId,
          adults,
          children,
          nightly_rate: nightlyRate,
          currency: form.currency.toUpperCase(),
          notes: form.notes.trim() || null,
        });
        toast.success('Reservation updated.');
      } else {
        await createPmsManualReservation({
          organizationSlug: org,
          hotelId,
          guestName: form.guestName.trim(),
          guestEmail: form.guestEmail.trim(),
          guestPhone: form.guestPhone.trim(),
          arrivalDate: form.arrivalDate,
          departureDate: form.departureDate,
          roomId: form.roomId === 'unassigned' ? undefined : form.roomId,
          adults,
          children,
          nightlyRate,
          currency: form.currency.toUpperCase(),
          notes: form.notes.trim(),
        });
        toast.success('HotelCare reservation created.');
      }
      setEditor({ open: false, reservation: null });
      await loadFeed();
    } catch (err: any) {
      console.error('PMS reservation save failed', err);
      toast.error(err?.message || 'Could not save the reservation.');
    } finally {
      setSaving(false);
    }
  };

  const transition = async (reservation: PMSReservation, nextStatus: ReservationStatus) => {
    setSaving(true);
    try {
      await transitionPmsManualReservation(reservation.id, nextStatus);
      toast.success(`Reservation marked ${statusLabel(nextStatus).toLowerCase()}.`);
      setEditor({ open: false, reservation: null });
      await loadFeed();
    } catch (err: any) {
      console.error('PMS status transition failed', err);
      toast.error(err?.message || 'Could not update reservation status.');
    } finally {
      setSaving(false);
    }
  };

  if (!hotelId) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <CircleAlert className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
          <p className="font-medium">Select a hotel to open Reservations v2.</p>
          <p className="mt-1 text-sm text-muted-foreground">The PMS front desk is always property-scoped.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight">Reservations v2</h1>
            <Badge variant="outline">PMS Phase 2</Badge>
            <Badge variant="secondary">Dual-run safe</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            HotelCare-native reservations are editable. Previo stays remain visible but read-only until reconciliation/cutover.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setStartDate(addDays(startDate, -7))} aria-label="Previous week">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => setStartDate(startOfDay(new Date()))}>Today</Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setStartDate(addDays(startDate, 7))} aria-label="Next week">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void loadFeed()} disabled={loading} aria-label="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          {feed?.can_manage && (
            <Button size="sm" className="h-8 gap-1.5" onClick={openCreate}>
              <Plus className="h-4 w-4" /> New reservation
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <MetricCard icon={<LogIn className="h-4 w-4" />} label="Arrivals today" value={currentMetrics.arrivals} />
        <MetricCard icon={<DoorOpen className="h-4 w-4" />} label="In house" value={currentMetrics.inHouse} />
        <MetricCard icon={<LogOut className="h-4 w-4" />} label="Departures today" value={currentMetrics.departures} />
        <MetricCard icon={<CircleAlert className="h-4 w-4" />} label="Unassigned" value={currentMetrics.unassigned} />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex rounded-md border p-0.5">
          <Button size="sm" variant={view === 'board' ? 'default' : 'ghost'} className="h-7 gap-1.5" onClick={() => setView('board')}>
            <CalendarDays className="h-3.5 w-3.5" /> Board
          </Button>
          <Button size="sm" variant={view === 'list' ? 'default' : 'ghost'} className="h-7 gap-1.5" onClick={() => setView('list')}>
            <List className="h-3.5 w-3.5" /> List
          </Button>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search guest, confirmation, phone…" className="h-8 pl-8" />
        </div>
      </div>

      {error ? (
        <Card><CardContent className="p-8 text-center"><p className="font-medium text-destructive">Could not load Reservations v2</p><p className="mt-1 text-sm text-muted-foreground">{error}</p><Button className="mt-3" variant="outline" size="sm" onClick={() => void loadFeed()}>Try again</Button></CardContent></Card>
      ) : loading && !feed ? (
        <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">Loading rooms and reservations…</CardContent></Card>
      ) : view === 'board' ? (
        <ReservationBoard
          rooms={rooms}
          nativeByRoom={nativeByRoom}
          previoByRoom={previoByRoom}
          startDate={startDate}
          dateRange={dateRange}
          timelineWidth={timelineWidth}
          checkInFraction={checkInFraction}
          checkOutFraction={checkOutFraction}
          search={search}
          canManage={!!feed?.can_manage}
          onOpen={openEdit}
        />
      ) : (
        <ReservationList
          native={filteredNative}
          previo={filteredPrevio}
          rooms={rooms}
          canManage={!!feed?.can_manage}
          onOpen={openEdit}
        />
      )}

      {unassigned.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><CircleAlert className="h-4 w-4 text-amber-600" /> Needs room assignment</div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {unassigned.map((reservation) => (
                <button key={reservation.id} onClick={() => openEdit(reservation)} className="min-w-48 rounded-md border bg-card p-2 text-left hover:bg-accent">
                  <div className="truncate text-sm font-medium">{reservation.primary_guest_name || 'Guest'}</div>
                  <div className="text-xs text-muted-foreground">{reservation.arrival_date} → {reservation.departure_date}</div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={editor.open} onOpenChange={(open) => !open && closeEditor()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editor.reservation ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {editor.reservation ? 'Reservation details' : 'New HotelCare reservation'}
            </DialogTitle>
            <DialogDescription>
              {editor.reservation
                ? `${editor.reservation.confirmation_code || editor.reservation.id.slice(0, 8)} · ${statusLabel(editor.reservation.status)}`
                : 'Creates a HotelCare-native manual reservation. Previo is not updated in Phase 2.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Guest name" className="sm:col-span-2"><Input value={form.guestName} onChange={(e) => setForm((v) => ({ ...v, guestName: e.target.value }))} /></Field>
            <Field label="Email"><Input type="email" value={form.guestEmail} onChange={(e) => setForm((v) => ({ ...v, guestEmail: e.target.value }))} /></Field>
            <Field label="Phone"><Input value={form.guestPhone} onChange={(e) => setForm((v) => ({ ...v, guestPhone: e.target.value }))} /></Field>
            <Field label="Arrival"><Input type="date" value={form.arrivalDate} onChange={(e) => setForm((v) => ({ ...v, arrivalDate: e.target.value }))} /></Field>
            <Field label="Departure"><Input type="date" value={form.departureDate} onChange={(e) => setForm((v) => ({ ...v, departureDate: e.target.value }))} /></Field>
            <Field label="Room">
              <Select value={form.roomId} onValueChange={(roomId) => setForm((v) => ({ ...v, roomId }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {rooms.map((room) => <SelectItem key={room.id} value={room.id}>{room.room_number}{room.room_type ? ` · ${room.room_type}` : ''}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Adults"><Input type="number" min="0" step="1" value={form.adults} onChange={(e) => setForm((v) => ({ ...v, adults: e.target.value }))} /></Field>
              <Field label="Children"><Input type="number" min="0" step="1" value={form.children} onChange={(e) => setForm((v) => ({ ...v, children: e.target.value }))} /></Field>
            </div>
            <Field label="Nightly booked rate"><Input type="number" min="0" step="0.01" value={form.nightlyRate} onChange={(e) => setForm((v) => ({ ...v, nightlyRate: e.target.value }))} /></Field>
            <Field label="Currency"><Input maxLength={3} value={form.currency} onChange={(e) => setForm((v) => ({ ...v, currency: e.target.value.toUpperCase() }))} /></Field>
            <Field label="Notes" className="sm:col-span-2"><Textarea value={form.notes} onChange={(e) => setForm((v) => ({ ...v, notes: e.target.value }))} rows={3} /></Field>
          </div>

          {editor.reservation && (
            <div className="rounded-md border bg-muted/25 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Front desk actions</div>
              <div className="flex flex-wrap gap-2">
                {availableStatusActions(editor.reservation.status).map((status) => (
                  <Button
                    key={status}
                    type="button"
                    size="sm"
                    variant={status === 'cancelled' || status === 'no_show' ? 'destructive' : 'outline'}
                    disabled={saving}
                    onClick={() => void transition(editor.reservation!, status)}
                  >
                    {status === 'checked_in' && <UserRoundCheck className="mr-1.5 h-4 w-4" />}
                    {status === 'checked_out' && <CheckCircle2 className="mr-1.5 h-4 w-4" />}
                    {ACTION_LABEL[status] || statusLabel(status)}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeEditor} disabled={saving}>Close</Button>
            {feed?.can_manage && (!editor.reservation || !['checked_out', 'cancelled', 'no_show'].includes(editor.reservation.status)) && (
              <Button onClick={() => void saveReservation()} disabled={saving}>{saving ? 'Saving…' : editor.reservation ? 'Save changes' : 'Create reservation'}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, className = '', children }: { label: string; className?: string; children: React.ReactNode }) {
  return <div className={`space-y-1.5 ${className}`}><Label>{label}</Label>{children}</div>;
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-3">
        <div className="rounded-md bg-muted p-2 text-muted-foreground">{icon}</div>
        <div><div className="text-xl font-bold leading-none">{value}</div><div className="mt-1 text-[11px] text-muted-foreground">{label}</div></div>
      </CardContent>
    </Card>
  );
}

function ReservationBoard({
  rooms,
  nativeByRoom,
  previoByRoom,
  startDate,
  dateRange,
  timelineWidth,
  checkInFraction,
  checkOutFraction,
  search,
  canManage,
  onOpen,
}: {
  rooms: PMSRoom[];
  nativeByRoom: Map<string, PMSReservation[]>;
  previoByRoom: Map<string, PMSReadonlyStay[]>;
  startDate: Date;
  dateRange: Date[];
  timelineWidth: number;
  checkInFraction: number;
  checkOutFraction: number;
  search: string;
  canManage: boolean;
  onOpen: (reservation: PMSReservation) => void;
}) {
  const today = startOfDay(new Date());
  const term = search.trim().toLowerCase();
  const visibleRooms = term
    ? rooms.filter((room) => {
        const native = nativeByRoom.get(room.id) || [];
        const previo = previoByRoom.get(room.id) || [];
        return room.room_number.toLowerCase().includes(term)
          || native.some((r) => [r.primary_guest_name, r.confirmation_code].some((value) => value?.toLowerCase().includes(term)))
          || previo.some((r) => r.guestName.toLowerCase().includes(term));
      })
    : rooms;

  if (rooms.length === 0) {
    return <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">No rooms are configured for this hotel.</CardContent></Card>;
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="max-h-[68vh] overflow-auto overscroll-contain">
          <div style={{ minWidth: ROOM_COLUMN_WIDTH + timelineWidth }}>
            <div className="sticky top-0 z-30 flex border-b bg-card shadow-sm">
              <div className="sticky left-0 z-40 flex shrink-0 items-center border-r bg-card px-3 text-[11px] font-semibold text-muted-foreground" style={{ width: ROOM_COLUMN_WIDTH }}>ROOM</div>
              <div className="flex" style={{ width: timelineWidth }}>
                {dateRange.map((date) => (
                  <div key={date.toISOString()} className={`shrink-0 border-r px-1 py-1.5 text-center ${isSameDay(date, today) ? 'bg-primary/10' : ''}`} style={{ width: DAY_WIDTH }}>
                    <div className="text-[9px] uppercase text-muted-foreground">{format(date, 'EEE')}</div>
                    <div className={`text-xs font-semibold ${isSameDay(date, today) ? 'text-primary' : ''}`}>{format(date, 'd MMM')}</div>
                  </div>
                ))}
              </div>
            </div>

            {visibleRooms.map((room) => {
              const native = nativeByRoom.get(room.id) || [];
              const previo = previoByRoom.get(room.id) || [];
              return (
                <div key={room.id} className="flex min-h-[58px] border-b hover:bg-accent/20">
                  <div className="sticky left-0 z-20 flex shrink-0 flex-col justify-center border-r bg-card/95 px-3 backdrop-blur" style={{ width: ROOM_COLUMN_WIDTH }}>
                    <div className="flex items-center gap-1.5"><BedDouble className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-sm font-semibold">{room.room_number}</span>{room.is_dnd && <Badge variant="outline" className="h-4 px-1 text-[9px]">DND</Badge>}</div>
                    <div className="truncate text-[10px] text-muted-foreground">{room.room_type || room.room_category || room.room_name || 'Room'}{room.floor_number != null ? ` · F${room.floor_number}` : ''}</div>
                  </div>
                  <div className="relative shrink-0" style={{ width: timelineWidth }}>
                    <div className="pointer-events-none absolute inset-0 flex">
                      {dateRange.map((date) => <div key={date.toISOString()} className={`h-full shrink-0 border-r ${isSameDay(date, today) ? 'bg-primary/[0.03]' : ''}`} style={{ width: DAY_WIDTH }} />)}
                    </div>
                    {previo.map((stay) => {
                      const g = stayGeometry(stay.arrivalDate, stay.departureDate, startDate, checkInFraction, checkOutFraction);
                      return (
                        <div key={stay.key} className="absolute top-1.5 h-[22px] overflow-hidden rounded border border-dashed border-violet-300 bg-violet-50 px-1.5 text-left text-[10px] text-violet-900" style={{ left: g.left, width: g.width }} title={`${stay.guestName} · Previo read-only`}>
                          <span className="font-medium">{stay.guestName}</span> <span className="opacity-70">· Previo</span>
                        </div>
                      );
                    })}
                    {native.map((reservation) => {
                      const g = stayGeometry(reservation.arrival_date, reservation.departure_date, startDate, checkInFraction, checkOutFraction);
                      return (
                        <button
                          key={reservation.id}
                          type="button"
                          onClick={() => onOpen(reservation)}
                          className={`absolute top-[29px] h-[24px] overflow-hidden rounded border px-1.5 text-left text-[10px] shadow-sm ${STATUS_STYLE[reservation.status] || STATUS_STYLE.confirmed} ${canManage ? 'hover:brightness-[0.98]' : ''}`}
                          style={{ left: g.left, width: g.width }}
                          title={`${reservation.primary_guest_name || 'Guest'} · ${statusLabel(reservation.status)}`}
                        >
                          <span className="font-semibold">{reservation.primary_guest_name || 'Guest'}</span>
                          {reservation.confirmation_code && <span className="ml-1 opacity-70">{reservation.confirmation_code}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t bg-muted/20 px-3 py-2 text-[10px] text-muted-foreground">
          <span><span className="mr-1 inline-block h-2.5 w-4 rounded border border-blue-300 bg-blue-100" />HotelCare native</span>
          <span><span className="mr-1 inline-block h-2.5 w-4 rounded border border-dashed border-violet-300 bg-violet-50" />Previo read-only</span>
          <span className="ml-auto">Visible window: {format(startDate, 'd MMM')} – {format(addDays(startDate, WINDOW_DAYS - 1), 'd MMM yyyy')}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function ReservationList({
  native,
  previo,
  rooms,
  canManage,
  onOpen,
}: {
  native: PMSReservation[];
  previo: PMSReadonlyStay[];
  rooms: PMSRoom[];
  canManage: boolean;
  onOpen: (reservation: PMSReservation) => void;
}) {
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b bg-muted/30 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Guest</th><th className="px-3 py-2">Stay</th><th className="px-3 py-2">Room</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Source</th><th className="px-3 py-2 text-right">Value</th><th className="px-3 py-2" /></tr></thead>
            <tbody>
              {native.map((reservation) => {
                const room = reservationRoomId(reservation) ? roomById.get(reservationRoomId(reservation)!) : null;
                return (
                  <tr key={reservation.id} className="border-b last:border-0 hover:bg-accent/20">
                    <td className="px-3 py-2"><div className="font-medium">{reservation.primary_guest_name || 'Guest'}</div><div className="text-[10px] text-muted-foreground">{reservation.confirmation_code || reservation.id.slice(0, 8)}</div></td>
                    <td className="px-3 py-2 text-xs">{reservation.arrival_date} → {reservation.departure_date}</td>
                    <td className="px-3 py-2">{room?.room_number || <span className="text-amber-700">Unassigned</span>}</td>
                    <td className="px-3 py-2"><Badge variant="outline" className={STATUS_STYLE[reservation.status]}>{statusLabel(reservation.status)}</Badge></td>
                    <td className="px-3 py-2"><Badge variant="secondary">HotelCare</Badge></td>
                    <td className="px-3 py-2 text-right font-medium">{reservation.total_amount == null ? '—' : `${reservation.currency} ${Number(reservation.total_amount).toFixed(2)}`}</td>
                    <td className="px-3 py-2 text-right"><Button variant="ghost" size="sm" onClick={() => onOpen(reservation)}>{canManage ? 'Open' : 'View'}</Button></td>
                  </tr>
                );
              })}
              {previo.map((stay) => (
                <tr key={stay.key} className="border-b last:border-0 bg-violet-50/30">
                  <td className="px-3 py-2 font-medium">{stay.guestName}</td>
                  <td className="px-3 py-2 text-xs">{stay.arrivalDate} → {stay.departureDate}</td>
                  <td className="px-3 py-2">{stay.roomNumber}</td>
                  <td className="px-3 py-2"><Badge variant="outline">{statusLabel(stay.status)}</Badge></td>
                  <td className="px-3 py-2"><Badge variant="outline" className="border-violet-300 text-violet-700">Previo · read-only</Badge></td>
                  <td className="px-3 py-2 text-right text-muted-foreground">—</td>
                  <td className="px-3 py-2" />
                </tr>
              ))}
              {native.length === 0 && previo.length === 0 && <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">No reservations in this window.</td></tr>}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
