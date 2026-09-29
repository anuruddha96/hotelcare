import { useEffect, useMemo, useState } from 'react';
import { addDays, format, startOfDay, startOfWeek } from 'date-fns';
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  MapPin,
  Search,
  Send,
  UserRound,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useVenues } from '@/hooks/useVenues';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { HousekeepingAutomationSettings } from './HousekeepingAutomationSettings';

type WorkStatus = 'working' | 'off' | 'leave' | 'sick' | 'training';
type LifecycleStatus = 'draft' | 'published';

type Staff = {
  id: string;
  full_name: string;
  nickname?: string | null;
  role?: string | null;
  assigned_hotel?: string | null;
  acts_as_housekeeper?: boolean | null;
};

type Shift = {
  id: string;
  user_id: string;
  work_date: string;
  shift_start: string | null;
  shift_end: string | null;
  status: string | null;
  work_status?: string | null;
  notes: string | null;
  published_at?: string | null;
  staff_schedule_venues?: { venue_id: string }[];
};

type ShiftTemplate = {
  workStatus: WorkStatus;
  shiftStart: string;
  shiftEnd: string;
  notes: string;
  venueIds: string[];
};

const WORK_STATUS_LABELS: Record<WorkStatus, string> = {
  working: 'Working',
  off: 'Off',
  leave: 'Leave',
  sick: 'Sick',
  training: 'Training',
};

const WORK_STATUS_SHORT: Record<WorkStatus, string> = {
  working: 'Work',
  off: 'Off',
  leave: 'Leave',
  sick: 'Sick',
  training: 'Training',
};

const isActiveShift = (status: WorkStatus) => status === 'working' || status === 'training';

const deriveWorkStatus = (shift?: Shift | null): WorkStatus => {
  if (!shift) return 'off';
  const explicit = shift.work_status as WorkStatus | undefined;
  if (explicit && Object.prototype.hasOwnProperty.call(WORK_STATUS_LABELS, explicit)) return explicit;
  if (shift.status === 'off' || (!shift.shift_start && !shift.shift_end)) return 'off';
  return 'working';
};

const lifecycleOf = (shift?: Shift | null): LifecycleStatus =>
  shift?.status === 'published' || !!shift?.published_at ? 'published' : 'draft';

export function StaffSchedulePlanner() {
  const { profile } = useAuth();
  const { visibleVenues, hasScopes, myVenueIds } = useVenues();
  const [anchorDate, setAnchorDate] = useState(() => startOfDay(new Date()));
  const [mobileDate, setMobileDate] = useState(() => format(startOfDay(new Date()), 'yyyy-MM-dd'));
  const [staff, setStaff] = useState<Staff[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [venueFilter, setVenueFilter] = useState('all');
  const [editing, setEditing] = useState<{ user: Staff; date: string } | null>(null);
  const [shiftStart, setShiftStart] = useState('09:00');
  const [shiftEnd, setShiftEnd] = useState('17:00');
  const [workStatus, setWorkStatus] = useState<WorkStatus>('working');
  const [notes, setNotes] = useState('');
  const [venueIds, setVenueIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [clipboard, setClipboard] = useState<ShiftTemplate | null>(null);
  const [selectedCell, setSelectedCell] = useState<string | null>(null);

  const weekStart = useMemo(() => startOfWeek(anchorDate, { weekStartsOn: 1 }), [anchorDate]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const dates = useMemo(() => weekDays.map((day) => format(day, 'yyyy-MM-dd')), [weekDays]);
  const start = dates[0];
  const end = dates[6];
  const shiftMap = useMemo(() => new Map(shifts.map((s) => [`${s.user_id}|${s.work_date}`, s])), [shifts]);
  const venueNameById = useMemo(() => new Map(visibleVenues.map((venue) => [venue.id, venue.name])), [visibleVenues]);

  const load = async () => {
    if (!profile?.assigned_hotel || !profile.organization_slug) return;
    setLoading(true);
    const [{ data: staffRows, error: staffError }, { data: shiftRows, error: shiftError }] = await Promise.all([
      supabase.from('profiles').select('*')
        .eq('organization_slug', profile.organization_slug)
        .eq('assigned_hotel', profile.assigned_hotel)
        .or('role.eq.housekeeping,acts_as_housekeeper.eq.true').order('full_name'),
      (supabase as any).from('staff_schedules')
        .select('*,staff_schedule_venues(venue_id)')
        .eq('hotel_id', profile.assigned_hotel).gte('work_date', start).lte('work_date', end),
    ]);

    if (staffError) toast.error(staffError.message);
    if (shiftError) toast.error(shiftError.message);

    let allowedStaff = (staffRows ?? []) as Staff[];
    if (hasScopes && allowedStaff.length) {
      const { data: scopes } = await supabase.from('user_property_scopes').select('user_id, venue_id').in('user_id', allowedStaff.map((s) => s.id));
      const visible = new Set(myVenueIds);
      const byUser = new Map<string, string[]>();
      for (const scope of scopes ?? []) byUser.set(scope.user_id, [...(byUser.get(scope.user_id) ?? []), scope.venue_id]);
      allowedStaff = allowedStaff.filter((person) => {
        const personScopes = byUser.get(person.id) ?? [];
        return personScopes.length === 0 || personScopes.some((id) => visible.has(id));
      });
    }

    setStaff(allowedStaff);
    setShifts((shiftRows ?? []) as Shift[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [profile?.assigned_hotel, profile?.organization_slug, start, end, hasScopes, myVenueIds.join('|')]);

  useEffect(() => {
    if (!dates.includes(mobileDate)) setMobileDate(start);
  }, [start, end]);

  const baseVenueLabel = (person: Staff) => {
    if (!person.assigned_hotel) return 'Not set';
    return venueNameById.get(person.assigned_hotel) ?? person.assigned_hotel;
  };

  const filteredStaff = useMemo(() => {
    const term = search.trim().toLowerCase();
    return staff.filter((person) => {
      const matchesSearch = !term || [person.full_name, person.nickname, person.role, baseVenueLabel(person)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
      if (!matchesSearch) return false;
      if (venueFilter === 'all') return true;
      if (person.assigned_hotel === venueFilter) return true;
      return dates.some((date) => shiftMap.get(`${person.id}|${date}`)?.staff_schedule_venues?.some((v) => v.venue_id === venueFilter));
    });
  }, [staff, search, venueFilter, dates, shiftMap, venueNameById]);

  const summary = useMemo(() => {
    const weekShifts = shifts.filter((shift) => dates.includes(shift.work_date));
    return {
      housekeepers: filteredStaff.length,
      published: weekShifts.filter((shift) => lifecycleOf(shift) === 'published').length,
      drafts: weekShifts.filter((shift) => lifecycleOf(shift) === 'draft').length,
    };
  }, [shifts, dates, filteredStaff.length]);

  const templateFromShift = (shift: Shift): ShiftTemplate => ({
    workStatus: deriveWorkStatus(shift),
    shiftStart: shift.shift_start?.slice(0, 5) ?? '09:00',
    shiftEnd: shift.shift_end?.slice(0, 5) ?? '17:00',
    notes: shift.notes ?? '',
    venueIds: shift.staff_schedule_venues?.map((venue) => venue.venue_id) ?? [],
  });

  const persistSchedule = async (userId: string, date: string, template: ShiftTemplate) => {
    if (!profile?.id || !profile.assigned_hotel || !profile.organization_slug) {
      return { error: new Error('Missing hotel or user context'), id: null as string | null };
    }

    const active = isActiveShift(template.workStatus);
    const basePayload = {
      organization_slug: profile.organization_slug,
      hotel_id: profile.assigned_hotel,
      user_id: userId,
      work_date: date,
      shift_start: active ? template.shiftStart : null,
      shift_end: active ? template.shiftEnd : null,
      status: 'draft',
      notes: template.notes.trim() || null,
      created_by: profile.id,
      published_at: null,
      published_by: null,
    };

    let result = await (supabase as any).from('staff_schedules').upsert(
      { ...basePayload, work_status: template.workStatus },
      { onConflict: 'organization_slug,hotel_id,user_id,work_date' },
    ).select('id').single();

    // Allows the UI branch to remain usable before the migration reaches an environment.
    if (result.error && String(result.error.message ?? '').toLowerCase().includes('work_status')) {
      const legacyPayload = {
        ...basePayload,
        status: template.workStatus === 'off' ? 'off' : 'draft',
      };
      result = await (supabase as any).from('staff_schedules').upsert(
        legacyPayload,
        { onConflict: 'organization_slug,hotel_id,user_id,work_date' },
      ).select('id').single();
    }

    if (result.error || !result.data?.id) return { error: result.error ?? new Error('Could not save schedule'), id: null };

    const scheduleId = result.data.id as string;
    const { error: deleteVenueError } = await (supabase as any).from('staff_schedule_venues').delete().eq('schedule_id', scheduleId);
    if (deleteVenueError) return { error: deleteVenueError, id: scheduleId };

    if (active && template.venueIds.length) {
      const { error: venueError } = await (supabase as any).from('staff_schedule_venues').insert(
        template.venueIds.map((venueId) => ({ schedule_id: scheduleId, venue_id: venueId })),
      );
      if (venueError) return { error: venueError, id: scheduleId };
    }

    return { error: null, id: scheduleId };
  };

  const openEditor = (user: Staff, date: string) => {
    const existing = shiftMap.get(`${user.id}|${date}`);
    setEditing({ user, date });
    setShiftStart(existing?.shift_start?.slice(0, 5) ?? '09:00');
    setShiftEnd(existing?.shift_end?.slice(0, 5) ?? '17:00');
    setWorkStatus(existing ? deriveWorkStatus(existing) : 'working');
    setNotes(existing?.notes ?? '');
    setVenueIds(existing?.staff_schedule_venues?.map((v) => v.venue_id) ?? []);
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    const { error } = await persistSchedule(editing.user.id, editing.date, {
      workStatus,
      shiftStart,
      shiftEnd,
      notes,
      venueIds,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Schedule saved as draft');
    setEditing(null);
    await load();
  };

  const applyTemplate = async (user: Staff, date: string, template: ShiftTemplate) => {
    const { error } = await persistSchedule(user.id, date, template);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Copied to ${user.full_name} · ${format(new Date(`${date}T12:00:00`), 'EEE MMM d')}`);
    await load();
  };

  const publishWeek = async () => {
    if (!profile?.id || !profile.assigned_hotel) return;
    const { error } = await (supabase as any).from('staff_schedules').update({
      status: 'published',
      published_at: new Date().toISOString(),
      published_by: profile.id,
    }).eq('hotel_id', profile.assigned_hotel).gte('work_date', start).lte('work_date', end).in('status', ['draft', 'off']);

    if (error) toast.error(error.message);
    else {
      toast.success('This week is published to staff');
      await load();
    }
  };

  const copyPreviousWeek = async () => {
    if (!profile?.id || !profile.assigned_hotel || !profile.organization_slug) return;
    const previousStart = format(addDays(weekStart, -7), 'yyyy-MM-dd');
    const previousEnd = format(addDays(weekStart, -1), 'yyyy-MM-dd');
    const { data: previousRows, error } = await (supabase as any).from('staff_schedules')
      .select('*,staff_schedule_venues(venue_id)')
      .eq('hotel_id', profile.assigned_hotel)
      .gte('work_date', previousStart)
      .lte('work_date', previousEnd);

    if (error) {
      toast.error(error.message);
      return;
    }

    const existingKeys = new Set(shifts.map((shift) => `${shift.user_id}|${shift.work_date}`));
    const candidates = ((previousRows ?? []) as Shift[]).filter((shift) => {
      const target = format(addDays(new Date(`${shift.work_date}T12:00:00`), 7), 'yyyy-MM-dd');
      return !existingKeys.has(`${shift.user_id}|${target}`);
    });

    if (!candidates.length) {
      toast.info('There are no previous-week shifts to copy, or this week is already filled');
      return;
    }

    setSaving(true);
    let copied = 0;
    for (const source of candidates) {
      const targetDate = format(addDays(new Date(`${source.work_date}T12:00:00`), 7), 'yyyy-MM-dd');
      const result = await persistSchedule(source.user_id, targetDate, templateFromShift(source));
      if (!result.error) copied += 1;
    }
    setSaving(false);
    toast.success(`${copied} previous-week shifts copied as drafts`);
    await load();
  };

  const moveWeek = (offset: number) => {
    const next = addDays(weekStart, offset * 7);
    setAnchorDate(next);
    setMobileDate(format(next, 'yyyy-MM-dd'));
  };

  const goToday = () => {
    const today = startOfDay(new Date());
    setAnchorDate(today);
    setMobileDate(format(today, 'yyyy-MM-dd'));
  };

  const handleCellKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, person: Staff, date: string, shift?: Shift) => {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'c' && shift) {
      event.preventDefault();
      setClipboard(templateFromShift(shift));
      toast.success('Shift copied');
      return;
    }
    if (modifier && event.key.toLowerCase() === 'v' && clipboard) {
      event.preventDefault();
      void applyTemplate(person, date, clipboard);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openEditor(person, date);
    }
  };

  const renderShiftContents = (shift?: Shift) => {
    if (!shift) return <span className="text-muted-foreground">＋ Add</span>;
    const operationalStatus = deriveWorkStatus(shift);
    const lifecycle = lifecycleOf(shift);
    const active = isActiveShift(operationalStatus);
    const workingVenues = shift.staff_schedule_venues?.map((item) => venueNameById.get(item.venue_id) ?? 'Venue').join(', ');

    return (
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant={operationalStatus === 'working' ? 'secondary' : 'outline'} className="text-[10px]">
            {WORK_STATUS_SHORT[operationalStatus]}
          </Badge>
          <Badge variant={lifecycle === 'published' ? 'default' : 'outline'} className="text-[9px]">
            {lifecycle}
          </Badge>
        </div>
        {active && shift.shift_start && shift.shift_end && (
          <div className="flex items-center gap-1 font-medium">
            <Clock className="h-3 w-3" />
            {shift.shift_start.slice(0, 5)}–{shift.shift_end.slice(0, 5)}
          </div>
        )}
        {active && workingVenues && (
          <div className="flex items-start gap-1 text-[10px] text-muted-foreground leading-tight">
            <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
            <span className="line-clamp-2">{workingVenues}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Housekeeping staff schedule</h2>
          <p className="text-sm text-muted-foreground">Prepare the weekly roster quickly. The same schedule is ready to power Auto Assign in the next phase.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={copyPreviousWeek} disabled={saving}>
            <Copy className="h-4 w-4 mr-1" />Copy previous week
          </Button>
          <Button onClick={publishWeek} disabled={saving || summary.drafts === 0}>
            <Send className="h-4 w-4 mr-1" />Publish drafts
          </Button>
        </div>
      </div>

      <HousekeepingAutomationSettings />

      <div className="grid grid-cols-3 gap-2">
        <Card><CardContent className="p-3"><div className="text-2xl font-semibold">{summary.housekeepers}</div><div className="text-xs text-muted-foreground">Housekeepers</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-2xl font-semibold">{summary.published}</div><div className="text-xs text-muted-foreground">Published shifts</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-2xl font-semibold">{summary.drafts}</div><div className="text-xs text-muted-foreground">Draft shifts</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-3 space-y-3">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => moveWeek(-1)} aria-label="Previous week"><ChevronLeft className="h-4 w-4" /></Button>
              <Button variant="outline" size="icon" onClick={() => moveWeek(1)} aria-label="Next week"><ChevronRight className="h-4 w-4" /></Button>
              <div className="min-w-40 text-center font-semibold">{format(weekStart, 'MMM d')} – {format(addDays(weekStart, 6), 'MMM d, yyyy')}</div>
              <Button variant="ghost" onClick={goToday}>Today</Button>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative sm:w-60">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find staff" className="pl-9" />
              </div>
              <Select value={venueFilter} onValueChange={setVenueFilter}>
                <SelectTrigger className="sm:w-56"><SelectValue placeholder="All venues" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All my venues</SelectItem>
                  {visibleVenues.map((venue) => <SelectItem key={venue.id} value={venue.id}>{venue.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <Copy className="h-3.5 w-3.5" />
            Tip: select a shift cell, use Ctrl/Cmd+C and Ctrl/Cmd+V, or drag a filled cell onto another day to copy it.
          </div>

          <div className="hidden md:block overflow-auto max-h-[68vh] rounded-md border">
            <table className="w-full min-w-[1180px] border-collapse text-xs">
              <thead className="sticky top-0 z-20 bg-background">
                <tr>
                  <th className="sticky left-0 z-30 bg-background border-b border-r p-3 text-left min-w-52">Staff</th>
                  <th className="border-b border-r p-3 text-left min-w-32">Position</th>
                  <th className="border-b border-r p-3 text-left min-w-40">Base venue</th>
                  {weekDays.map((day) => (
                    <th key={format(day, 'yyyy-MM-dd')} className="border-b border-r p-2 min-w-32 text-center">
                      <div>{format(day, 'EEE')}</div>
                      <div className="text-muted-foreground font-normal">{format(day, 'MMM d')}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredStaff.map((person) => (
                  <tr key={person.id}>
                    <th className="sticky left-0 z-10 bg-background border-r border-b p-3 text-left">
                      <div className="font-medium">{person.full_name}</div>
                      {person.nickname && <div className="text-muted-foreground font-normal">{person.nickname}</div>}
                    </th>
                    <td className="border-r border-b p-3 text-muted-foreground">{person.role || (person.acts_as_housekeeper ? 'Housekeeper' : 'Staff')}</td>
                    <td className="border-r border-b p-3 text-muted-foreground">{baseVenueLabel(person)}</td>
                    {dates.map((date) => {
                      const key = `${person.id}|${date}`;
                      const shift = shiftMap.get(key);
                      return (
                        <td key={date} className="border-r border-b p-1 align-top">
                          <button
                            type="button"
                            draggable={!!shift}
                            onClick={() => { setSelectedCell(key); openEditor(person, date); }}
                            onFocus={() => setSelectedCell(key)}
                            onKeyDown={(event) => handleCellKeyDown(event, person, date, shift)}
                            onDragStart={(event) => {
                              if (!shift) return;
                              const template = templateFromShift(shift);
                              setClipboard(template);
                              event.dataTransfer.effectAllowed = 'copy';
                              event.dataTransfer.setData('text/plain', key);
                            }}
                            onDragOver={(event) => {
                              if (clipboard || event.dataTransfer.types.includes('text/plain')) event.preventDefault();
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              if (clipboard) void applyTemplate(person, date, clipboard);
                            }}
                            className={`w-full min-h-24 rounded-md border p-2 text-left hover:bg-muted/60 transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${selectedCell === key ? 'ring-2 ring-ring' : ''}`}
                          >
                            {renderShiftContents(shift)}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && filteredStaff.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">No housekeeping staff match these filters.</div>}
          </div>

          <div className="md:hidden space-y-3">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {weekDays.map((day) => {
                const date = format(day, 'yyyy-MM-dd');
                return (
                  <Button key={date} variant={mobileDate === date ? 'default' : 'outline'} className="shrink-0" onClick={() => setMobileDate(date)}>
                    <span className="flex flex-col leading-tight"><span>{format(day, 'EEE')}</span><span className="text-[10px]">{format(day, 'd')}</span></span>
                  </Button>
                );
              })}
            </div>
            <div className="space-y-2">
              {filteredStaff.map((person) => {
                const shift = shiftMap.get(`${person.id}|${mobileDate}`);
                return (
                  <button key={person.id} type="button" onClick={() => openEditor(person, mobileDate)} className="w-full rounded-lg border p-3 text-left hover:bg-muted/50">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 font-medium"><UserRound className="h-4 w-4" />{person.full_name}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{person.role || 'Housekeeper'} · {baseVenueLabel(person)}</div>
                      </div>
                      <div className="max-w-[48%] text-right">{renderShiftContents(shift)}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.user.full_name}</DialogTitle>
            {editing && <div className="flex items-center gap-2 text-sm text-muted-foreground"><CalendarDays className="h-4 w-4" />{format(new Date(`${editing.date}T12:00:00`), 'EEEE, MMMM d')}</div>}
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Work status</Label>
              <Select value={workStatus} onValueChange={(value) => setWorkStatus(value as WorkStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(WORK_STATUS_LABELS) as WorkStatus[]).map((value) => <SelectItem key={value} value={value}>{WORK_STATUS_LABELS[value]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {isActiveShift(workStatus) && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Start</Label><Input type="time" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} /></div>
                  <div><Label>End</Label><Input type="time" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)} /></div>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1"><MapPin className="h-4 w-4" />Working venue</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto rounded-md border p-2">
                    {visibleVenues.map((venue) => (
                      <label key={venue.id} className="flex items-center gap-2 text-sm">
                        <Checkbox checked={venueIds.includes(venue.id)} onCheckedChange={(checked) => setVenueIds((old) => checked ? [...old, venue.id] : old.filter((id) => id !== venue.id))} />
                        {venue.name}
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">This changes where the person works for this shift. It does not change their base venue.</p>
                </div>
              </>
            )}

            <div>
              <Label>Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional schedule note" />
            </div>

            {editing && lifecycleOf(shiftMap.get(`${editing.user.id}|${editing.date}`)) === 'published' && (
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">Editing a published shift returns that shift to draft so a manager can review and publish the change again.</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : <><Check className="h-4 w-4 mr-1" />Save draft</>}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
