import { useEffect, useMemo, useState } from 'react';
import { addDays, format, startOfDay, startOfWeek } from 'date-fns';
import {
  Building2,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  MapPin,
  Search,
  Send,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useVenues } from '@/hooks/useVenues';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

type WorkStatus = 'working' | 'off' | 'leave' | 'sick' | 'training';
type LifecycleStatus = 'draft' | 'published';

type Staff = {
  id: string;
  full_name: string;
  nickname?: string | null;
  role?: string | null;
  assigned_hotel?: string | null;
  job_title?: string | null;
  acts_as_housekeeper?: boolean | null;
};

type Shift = {
  id: string;
  organization_slug: string;
  hotel_id: string;
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

const MASTER_ROLES = ['admin', 'top_management', 'top_management_manager', 'hr'];
const WORK_STATUS_LABELS: Record<WorkStatus, string> = {
  working: 'Working',
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

const prettyRole = (role?: string | null) => (role || 'staff')
  .split('_')
  .filter(Boolean)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

export const departmentForRole = (role?: string | null) => {
  const value = (role || '').toLowerCase();
  if (value.includes('housekeeping')) return 'Housekeeping';
  if (value.includes('maintenance')) return 'Maintenance';
  if (value.includes('reception') || value.includes('front_office')) return 'Reception';
  if (value.includes('finance')) return 'Finance';
  if (value.includes('marketing')) return 'Marketing';
  if (value.includes('breakfast')) return 'Breakfast';
  if (value.includes('control')) return 'Control';
  if (value.includes('back_office')) return 'Back Office';
  if (value === 'hr') return 'HR';
  if (value.includes('manager') || value === 'admin' || value.includes('top_management')) return 'Management';
  return 'Other';
};

export function MasterStaffSchedulePlanner() {
  const { profile } = useAuth();
  const { venues } = useVenues();
  const [anchorDate, setAnchorDate] = useState(() => startOfDay(new Date()));
  const [mobileDate, setMobileDate] = useState(() => format(startOfDay(new Date()), 'yyyy-MM-dd'));
  const [staff, setStaff] = useState<Staff[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [baseVenueFilter, setBaseVenueFilter] = useState('all');
  const [workingVenueFilter, setWorkingVenueFilter] = useState('all');
  const [editing, setEditing] = useState<{ user: Staff; date: string } | null>(null);
  const [shiftStart, setShiftStart] = useState('09:00');
  const [shiftEnd, setShiftEnd] = useState('17:00');
  const [workStatus, setWorkStatus] = useState<WorkStatus>('working');
  const [notes, setNotes] = useState('');
  const [venueIds, setVenueIds] = useState<string[]>([]);
  const [clipboard, setClipboard] = useState<ShiftTemplate | null>(null);
  const [selectedCell, setSelectedCell] = useState<string | null>(null);

  const canManageMaster = !!profile?.is_super_admin || MASTER_ROLES.includes(profile?.role || '');
  const weekStart = useMemo(() => startOfWeek(anchorDate, { weekStartsOn: 1 }), [anchorDate]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const dates = useMemo(() => weekDays.map((day) => format(day, 'yyyy-MM-dd')), [weekDays]);
  const start = dates[0];
  const end = dates[6];

  const staffById = useMemo(() => new Map(staff.map((person) => [person.id, person])), [staff]);
  const shiftMap = useMemo(() => {
    const map = new Map<string, Shift>();
    for (const shift of shifts) {
      const key = `${shift.user_id}|${shift.work_date}`;
      const existing = map.get(key);
      const baseHotel = staffById.get(shift.user_id)?.assigned_hotel;
      if (!existing || shift.hotel_id === baseHotel || (lifecycleOf(shift) === 'published' && lifecycleOf(existing) !== 'published')) {
        map.set(key, shift);
      }
    }
    return map;
  }, [shifts, staffById]);

  const venueNameById = useMemo(() => new Map(venues.map((venue) => [venue.id, venue.name])), [venues]);
  const baseHotelName = useMemo(() => {
    const map = new Map<string, string>();
    for (const venue of venues) if (!map.has(venue.hotel_id)) map.set(venue.hotel_id, venue.name);
    return map;
  }, [venues]);

  const baseVenueLabel = (person: Staff) => {
    if (!person.assigned_hotel) return 'Not set';
    return baseHotelName.get(person.assigned_hotel) ?? venueNameById.get(person.assigned_hotel) ?? person.assigned_hotel;
  };

  const load = async () => {
    if (!profile?.organization_slug || !canManageMaster) return;
    setLoading(true);
    const [{ data: staffRows, error: staffError }, { data: shiftRows, error: shiftError }] = await Promise.all([
      supabase.from('profiles')
        .select('id,full_name,nickname,role,assigned_hotel,job_title,acts_as_housekeeper')
        .eq('organization_slug', profile.organization_slug)
        .order('full_name'),
      (supabase as any).from('staff_schedules')
        .select('*,staff_schedule_venues(venue_id)')
        .eq('organization_slug', profile.organization_slug)
        .gte('work_date', start)
        .lte('work_date', end),
    ]);
    if (staffError) toast.error(staffError.message);
    if (shiftError) toast.error(shiftError.message);
    setStaff((staffRows ?? []) as Staff[]);
    setShifts((shiftRows ?? []) as Shift[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [profile?.organization_slug, canManageMaster, start, end]);

  useEffect(() => {
    if (!dates.includes(mobileDate)) setMobileDate(start);
  }, [start, end]);

  const departments = useMemo(() => [...new Set(staff.map((person) => departmentForRole(person.role)))].sort(), [staff]);
  const roles = useMemo(() => [...new Set(staff.map((person) => person.role).filter(Boolean) as string[])].sort(), [staff]);
  const baseHotels = useMemo(() => [...new Set(staff.map((person) => person.assigned_hotel).filter(Boolean) as string[])].sort(), [staff]);

  const filteredStaff = useMemo(() => {
    const term = search.trim().toLowerCase();
    return staff.filter((person) => {
      const department = departmentForRole(person.role);
      const position = person.job_title || prettyRole(person.role);
      const matchesSearch = !term || [person.full_name, person.nickname, person.role, position, department, baseVenueLabel(person)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
      if (!matchesSearch) return false;
      if (departmentFilter !== 'all' && department !== departmentFilter) return false;
      if (roleFilter !== 'all' && person.role !== roleFilter) return false;
      if (baseVenueFilter !== 'all' && person.assigned_hotel !== baseVenueFilter) return false;
      if (workingVenueFilter !== 'all') {
        const hasWorkingVenue = dates.some((date) => {
          const shift = shiftMap.get(`${person.id}|${date}`);
          return shift?.staff_schedule_venues?.some((item) => item.venue_id === workingVenueFilter);
        });
        if (!hasWorkingVenue) return false;
      }
      return true;
    });
  }, [staff, search, departmentFilter, roleFilter, baseVenueFilter, workingVenueFilter, dates, shiftMap, venueNameById, baseHotelName]);

  const summary = useMemo(() => {
    const visibleIds = new Set(filteredStaff.map((person) => person.id));
    const weekShifts = shifts.filter((shift) => dates.includes(shift.work_date) && visibleIds.has(shift.user_id));
    return {
      staff: filteredStaff.length,
      working: weekShifts.filter((shift) => isActiveShift(deriveWorkStatus(shift))).length,
      published: weekShifts.filter((shift) => lifecycleOf(shift) === 'published').length,
      drafts: weekShifts.filter((shift) => lifecycleOf(shift) === 'draft').length,
    };
  }, [filteredStaff, shifts, dates]);

  const templateFromShift = (shift: Shift): ShiftTemplate => ({
    workStatus: deriveWorkStatus(shift),
    shiftStart: shift.shift_start?.slice(0, 5) ?? '09:00',
    shiftEnd: shift.shift_end?.slice(0, 5) ?? '17:00',
    notes: shift.notes ?? '',
    venueIds: shift.staff_schedule_venues?.map((item) => item.venue_id) ?? [],
  });

  const persistSchedule = async (person: Staff, date: string, template: ShiftTemplate) => {
    if (!profile?.id || !profile.organization_slug) return { error: new Error('Missing organization or user context') };
    const existing = shiftMap.get(`${person.id}|${date}`);
    const baseHotel = existing?.hotel_id || person.assigned_hotel;
    if (!baseHotel) return { error: new Error(`${person.full_name} has no base hotel. Set a base property before scheduling.`) };

    const active = isActiveShift(template.workStatus);
    const basePayload = {
      organization_slug: profile.organization_slug,
      hotel_id: baseHotel,
      user_id: person.id,
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

    if (result.error && String(result.error.message ?? '').toLowerCase().includes('work_status')) {
      result = await (supabase as any).from('staff_schedules').upsert(
        { ...basePayload, status: template.workStatus === 'off' ? 'off' : 'draft' },
        { onConflict: 'organization_slug,hotel_id,user_id,work_date' },
      ).select('id').single();
    }
    if (result.error || !result.data?.id) return { error: result.error ?? new Error('Could not save schedule') };

    const scheduleId = result.data.id as string;
    const { error: deleteVenueError } = await (supabase as any).from('staff_schedule_venues').delete().eq('schedule_id', scheduleId);
    if (deleteVenueError) return { error: deleteVenueError };
    if (active && template.venueIds.length) {
      const { error: venueError } = await (supabase as any).from('staff_schedule_venues').insert(
        template.venueIds.map((venueId) => ({ schedule_id: scheduleId, venue_id: venueId })),
      );
      if (venueError) return { error: venueError };
    }
    return { error: null };
  };

  const openEditor = (person: Staff, date: string) => {
    const existing = shiftMap.get(`${person.id}|${date}`);
    setEditing({ user: person, date });
    setShiftStart(existing?.shift_start?.slice(0, 5) ?? '09:00');
    setShiftEnd(existing?.shift_end?.slice(0, 5) ?? '17:00');
    setWorkStatus(existing ? deriveWorkStatus(existing) : 'working');
    setNotes(existing?.notes ?? '');
    setVenueIds(existing?.staff_schedule_venues?.map((item) => item.venue_id) ?? []);
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    const { error } = await persistSchedule(editing.user, editing.date, { workStatus, shiftStart, shiftEnd, notes, venueIds });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Schedule saved as draft');
    setEditing(null);
    await load();
  };

  const applyTemplate = async (person: Staff, date: string, template: ShiftTemplate) => {
    const { error } = await persistSchedule(person, date, template);
    if (error) return toast.error(error.message);
    toast.success(`Copied to ${person.full_name} · ${format(new Date(`${date}T12:00:00`), 'EEE MMM d')}`);
    await load();
  };

  const publishWeek = async () => {
    if (!profile?.id || !profile.organization_slug) return;
    const { error } = await (supabase as any).from('staff_schedules').update({
      status: 'published',
      published_at: new Date().toISOString(),
      published_by: profile.id,
    }).eq('organization_slug', profile.organization_slug)
      .gte('work_date', start)
      .lte('work_date', end)
      .in('status', ['draft', 'off']);
    if (error) return toast.error(error.message);
    toast.success('Organization schedule published for this week');
    await load();
  };

  const copyPreviousWeek = async () => {
    if (!profile?.organization_slug) return;
    const previousStart = format(addDays(weekStart, -7), 'yyyy-MM-dd');
    const previousEnd = format(addDays(weekStart, -1), 'yyyy-MM-dd');
    const { data, error } = await (supabase as any).from('staff_schedules')
      .select('*,staff_schedule_venues(venue_id)')
      .eq('organization_slug', profile.organization_slug)
      .gte('work_date', previousStart)
      .lte('work_date', previousEnd);
    if (error) return toast.error(error.message);

    const existingKeys = new Set(shifts.map((shift) => `${shift.user_id}|${shift.work_date}`));
    const candidates = ((data ?? []) as Shift[]).filter((source) => {
      const target = format(addDays(new Date(`${source.work_date}T12:00:00`), 7), 'yyyy-MM-dd');
      return staffById.has(source.user_id) && !existingKeys.has(`${source.user_id}|${target}`);
    });
    if (!candidates.length) return toast.info('No previous-week shifts are available to copy into empty cells');

    setSaving(true);
    let copied = 0;
    for (const source of candidates) {
      const person = staffById.get(source.user_id);
      if (!person) continue;
      const targetDate = format(addDays(new Date(`${source.work_date}T12:00:00`), 7), 'yyyy-MM-dd');
      const result = await persistSchedule(person, targetDate, templateFromShift(source));
      if (!result.error) copied += 1;
    }
    setSaving(false);
    toast.success(`${copied} shifts copied as drafts`);
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
      return toast.success('Shift copied');
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
    const workingVenues = shift.staff_schedule_venues?.map((item) => venueNameById.get(item.venue_id) ?? item.venue_id).join(', ');
    return (
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant={operationalStatus === 'working' ? 'secondary' : 'outline'} className="text-[10px]">{WORK_STATUS_LABELS[operationalStatus]}</Badge>
          <Badge variant={lifecycle === 'published' ? 'default' : 'outline'} className="text-[9px]">{lifecycle}</Badge>
        </div>
        {active && shift.shift_start && shift.shift_end && <div className="flex items-center gap-1 font-medium"><Clock className="h-3 w-3" />{shift.shift_start.slice(0, 5)}–{shift.shift_end.slice(0, 5)}</div>}
        {active && workingVenues && <div className="flex items-start gap-1 text-[10px] text-muted-foreground leading-tight"><MapPin className="h-3 w-3 shrink-0 mt-0.5" /><span className="line-clamp-2">{workingVenues}</span></div>}
      </div>
    );
  };

  if (!canManageMaster) {
    return <Card><CardContent className="p-6 text-sm text-muted-foreground">Master Staff Schedule is available to HR, administrators and top management.</CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /><h2 className="text-xl font-semibold">Master staff schedule</h2></div>
          <p className="text-sm text-muted-foreground">Organization-wide source of truth. Department schedules, including Housekeeping, edit these same records.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={copyPreviousWeek} disabled={saving}><Copy className="h-4 w-4 mr-1" />Copy previous week</Button>
          <Button onClick={publishWeek} disabled={saving || summary.drafts === 0}><Send className="h-4 w-4 mr-1" />Publish drafts</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Card><CardContent className="p-3"><div className="flex items-center gap-2"><Users className="h-4 w-4 text-muted-foreground" /><span className="text-2xl font-semibold">{summary.staff}</span></div><div className="text-xs text-muted-foreground">Visible staff</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-2xl font-semibold">{summary.working}</div><div className="text-xs text-muted-foreground">Working / training shifts</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-2xl font-semibold">{summary.published}</div><div className="text-xs text-muted-foreground">Published shifts</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-2xl font-semibold">{summary.drafts}</div><div className="text-xs text-muted-foreground">Draft shifts</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="space-y-3 p-3">
          <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => moveWeek(-1)} aria-label="Previous week"><ChevronLeft className="h-4 w-4" /></Button>
              <Button variant="outline" size="icon" onClick={() => moveWeek(1)} aria-label="Next week"><ChevronRight className="h-4 w-4" /></Button>
              <div className="min-w-40 text-center font-semibold">{format(weekStart, 'MMM d')} – {format(addDays(weekStart, 6), 'MMM d, yyyy')}</div>
              <Button variant="ghost" onClick={goToday}>Today</Button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
              <div className="relative sm:col-span-2 xl:col-span-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find staff" className="pl-9" /></div>
              <Select value={departmentFilter} onValueChange={setDepartmentFilter}><SelectTrigger><SelectValue placeholder="Department" /></SelectTrigger><SelectContent><SelectItem value="all">All departments</SelectItem>{departments.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
              <Select value={roleFilter} onValueChange={setRoleFilter}><SelectTrigger><SelectValue placeholder="Role" /></SelectTrigger><SelectContent><SelectItem value="all">All roles</SelectItem>{roles.map((value) => <SelectItem key={value} value={value}>{prettyRole(value)}</SelectItem>)}</SelectContent></Select>
              <Select value={baseVenueFilter} onValueChange={setBaseVenueFilter}><SelectTrigger><SelectValue placeholder="Base property" /></SelectTrigger><SelectContent><SelectItem value="all">All base properties</SelectItem>{baseHotels.map((value) => <SelectItem key={value} value={value}>{baseHotelName.get(value) ?? venueNameById.get(value) ?? value}</SelectItem>)}</SelectContent></Select>
              <Select value={workingVenueFilter} onValueChange={setWorkingVenueFilter}><SelectTrigger><SelectValue placeholder="Working venue" /></SelectTrigger><SelectContent><SelectItem value="all">All working venues</SelectItem>{venues.map((venue) => <SelectItem key={venue.id} value={venue.id}>{venue.name}</SelectItem>)}</SelectContent></Select>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground"><Copy className="h-3.5 w-3.5" />Ctrl/Cmd+C and Ctrl/Cmd+V copy schedule cells. Drag a filled cell to another day to copy it. Cross-property venue allocations are edited inside each cell.</div>

          <div className="hidden max-h-[68vh] overflow-auto rounded-md border md:block">
            <table className="w-full min-w-[1360px] border-collapse text-xs">
              <thead className="sticky top-0 z-20 bg-background"><tr>
                <th className="sticky left-0 z-30 min-w-52 border-b border-r bg-background p-3 text-left">Staff</th>
                <th className="min-w-32 border-b border-r p-3 text-left">Department</th>
                <th className="min-w-40 border-b border-r p-3 text-left">Position</th>
                <th className="min-w-40 border-b border-r p-3 text-left">Base property</th>
                {weekDays.map((day) => <th key={format(day, 'yyyy-MM-dd')} className="min-w-32 border-b border-r p-2 text-center"><div>{format(day, 'EEE')}</div><div className="font-normal text-muted-foreground">{format(day, 'MMM d')}</div></th>)}
              </tr></thead>
              <tbody>{filteredStaff.map((person) => <tr key={person.id}>
                <th className="sticky left-0 z-10 border-b border-r bg-background p-3 text-left"><div className="font-medium">{person.full_name}</div>{person.nickname && <div className="font-normal text-muted-foreground">{person.nickname}</div>}</th>
                <td className="border-b border-r p-3 text-muted-foreground">{departmentForRole(person.role)}</td>
                <td className="border-b border-r p-3 text-muted-foreground">{person.job_title || prettyRole(person.role)}</td>
                <td className="border-b border-r p-3 text-muted-foreground">{baseVenueLabel(person)}</td>
                {dates.map((date) => {
                  const key = `${person.id}|${date}`;
                  const shift = shiftMap.get(key);
                  return <td key={date} className="border-b border-r p-1 align-top"><button type="button" draggable={!!shift}
                    onClick={() => { setSelectedCell(key); openEditor(person, date); }} onFocus={() => setSelectedCell(key)} onKeyDown={(event) => handleCellKeyDown(event, person, date, shift)}
                    onDragStart={(event) => { if (!shift) return; const template = templateFromShift(shift); setClipboard(template); event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('text/plain', key); }}
                    onDragOver={(event) => { if (clipboard || event.dataTransfer.types.includes('text/plain')) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); if (clipboard) void applyTemplate(person, date, clipboard); }}
                    className={`min-h-24 w-full rounded-md border p-2 text-left transition-colors hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-ring ${selectedCell === key ? 'ring-2 ring-ring' : ''}`}>{renderShiftContents(shift)}</button></td>;
                })}
              </tr>)}</tbody>
            </table>
            {!loading && filteredStaff.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">No staff match these filters.</div>}
          </div>

          <div className="space-y-3 md:hidden">
            <div className="flex gap-2 overflow-x-auto pb-1">{weekDays.map((day) => { const date = format(day, 'yyyy-MM-dd'); return <Button key={date} variant={mobileDate === date ? 'default' : 'outline'} className="shrink-0" onClick={() => setMobileDate(date)}><span className="flex flex-col leading-tight"><span>{format(day, 'EEE')}</span><span className="text-[10px]">{format(day, 'd')}</span></span></Button>; })}</div>
            <div className="space-y-2">{filteredStaff.map((person) => { const shift = shiftMap.get(`${person.id}|${mobileDate}`); return <button key={person.id} type="button" onClick={() => openEditor(person, mobileDate)} className="w-full rounded-lg border p-3 text-left hover:bg-muted/50"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2 font-medium"><UserRound className="h-4 w-4" />{person.full_name}</div><div className="mt-1 text-xs text-muted-foreground">{departmentForRole(person.role)} · {person.job_title || prettyRole(person.role)} · {baseVenueLabel(person)}</div></div><div className="max-w-[48%] text-right">{renderShiftContents(shift)}</div></div></button>; })}</div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>{editing?.user.full_name}</DialogTitle>{editing && <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><CalendarDays className="h-4 w-4" />{format(new Date(`${editing.date}T12:00:00`), 'EEEE, MMMM d')}<span>·</span><Building2 className="h-4 w-4" />Base: {baseVenueLabel(editing.user)}</div>}</DialogHeader>
          <div className="space-y-4">
            <div><Label>Work status</Label><Select value={workStatus} onValueChange={(value) => setWorkStatus(value as WorkStatus)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(WORK_STATUS_LABELS) as WorkStatus[]).map((value) => <SelectItem key={value} value={value}>{WORK_STATUS_LABELS[value]}</SelectItem>)}</SelectContent></Select></div>
            {isActiveShift(workStatus) && <><div className="grid grid-cols-2 gap-3"><div><Label>Start</Label><Input type="time" value={shiftStart} onChange={(event) => setShiftStart(event.target.value)} /></div><div><Label>End</Label><Input type="time" value={shiftEnd} onChange={(event) => setShiftEnd(event.target.value)} /></div></div>
              <div className="space-y-2"><Label className="flex items-center gap-1"><MapPin className="h-4 w-4" />Working venue(s)</Label><div className="grid max-h-52 grid-cols-1 gap-2 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">{venues.map((venue) => <label key={venue.id} className="flex items-center gap-2 text-sm"><Checkbox checked={venueIds.includes(venue.id)} onCheckedChange={(checked) => setVenueIds((old) => checked ? [...old, venue.id] : old.filter((id) => id !== venue.id))} />{venue.name}</label>)}</div><p className="text-xs text-muted-foreground">Temporary cross-property work belongs here. The employee's base property is not changed.</p></div></>}
            <div><Label>Notes</Label><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional schedule note" /></div>
            {editing && lifecycleOf(shiftMap.get(`${editing.user.id}|${editing.date}`)) === 'published' && <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">Editing a published shift returns that shift to draft so it can be reviewed and republished.</p>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : <><Check className="mr-1 h-4 w-4" />Save draft</>}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
