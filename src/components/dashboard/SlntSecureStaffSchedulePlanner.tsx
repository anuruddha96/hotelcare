import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, addWeeks, format, startOfWeek, subWeeks } from 'date-fns';
import {
  CalendarDays,
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Clock,
  Copy,
  MapPin,
  Search,
  Send,
  Settings2,
  Users,
  X,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useVenues } from '@/hooks/useVenues';
import { resolveCanonicalHotelId, resolveHotelKeys } from '@/lib/hotelKeys';
import { todayBudapest } from '@/lib/budapestTime';
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
import { HousekeepingAutomationSettings } from './HousekeepingAutomationSettings';

type Person = { id: string; full_name: string; nickname: string | null };
type Shift = {
  id: string;
  user_id: string;
  work_date: string;
  shift_start: string;
  shift_end: string;
  status: 'draft' | 'published' | 'off';
  notes: string | null;
  staff_schedule_venues: { venue_id: string }[];
};
type Editor = { person: Person; date: string; previous: Shift | null };
type SaveMode = 'draft' | 'published' | 'off';
type StaffFilter = 'all' | 'scheduled' | 'unscheduled' | 'drafts';
type SelectionAnchor = { userId: string; date: string } | null;
type ClipboardPattern = {
  width: number;
  height: number;
  cells: Array<{ rowOffset: number; colOffset: number; shift: Shift | null }>;
};
type RosterDayDraft = {
  iso_weekday: number;
  is_working: boolean;
  shift_start: string;
  shift_end: string;
  notes: string;
};

const localDate = (day: string) => new Date(`${day}T12:00:00`);
const iso = (date: Date) => format(date, 'yyyy-MM-dd');
const monday = (day: string) => iso(startOfWeek(localDate(day), { weekStartsOn: 1 }));
const key = (user: string, date: string) => `${user}|${date}`;
const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const defaultRosterDays = (): RosterDayDraft[] =>
  weekdayNames.map((_, index) => ({
    iso_weekday: index + 1,
    is_working: index < 5,
    shift_start: '09:00',
    shift_end: '17:00',
    notes: '',
  }));

/** SLNT only. All modifications are validated and committed atomically by SQL RPCs. */
export function SlntSecureStaffSchedulePlanner() {
  const { profile } = useAuth();
  const { visibleVenues, myVenueIds, hasScopes, loading: venuesLoading } = useVenues();
  const [hotel, setHotel] = useState<string | null>(null);
  const [aliases, setAliases] = useState<string[]>([]);
  const [week, setWeek] = useState(() => monday(todayBudapest()));
  const [mobileDay, setMobileDay] = useState(todayBudapest());
  const [people, setPeople] = useState<Person[]>([]);
  const [scopes, setScopes] = useState<Map<string, string[]>>(new Map());
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [search, setSearch] = useState('');
  const [filterVenue, setFilterVenue] = useState('all');
  const [filterStatus, setFilterStatus] = useState<StaffFilter>('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Editor | null>(null);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [selectedVenues, setSelectedVenues] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<SelectionAnchor>(null);
  const [clipboard, setClipboard] = useState<ClipboardPattern | null>(null);
  const [highlightedPerson, setHighlightedPerson] = useState<string | null>(null);
  const [rosterPerson, setRosterPerson] = useState<Person | null>(null);
  const [rosterDays, setRosterDays] = useState<RosterDayDraft[]>(defaultRosterDays);
  const [rosterVenues, setRosterVenues] = useState<string[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterBusy, setRosterBusy] = useState(false);
  const [applyRosterForward, setApplyRosterForward] = useState(true);
  const generation = useRef(0);
  const org = profile?.organization_slug;

  // Team View's "Open Staff schedule" CTA preserves the chosen working day.
  useEffect(() => {
    if (!profile?.assigned_hotel || !['slnt', 'slnt-group'].includes(org ?? '')) return;
    const storageKey = `slnt-roster-target:${profile.assigned_hotel}`;
    let target: string | null = null;
    try {
      target = window.sessionStorage.getItem(storageKey);
      window.sessionStorage.removeItem(storageKey);
    } catch {
      return;
    }
    if (target && /^\d{4}-\d{2}-\d{2}$/.test(target)) {
      setWeek(monday(target));
      setMobileDay(target);
    }
  }, [org, profile?.assigned_hotel]);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => iso(addDays(localDate(week), i))),
    [week],
  );
  const venues = useMemo(
    () => visibleVenues.filter((v) => v.hotel_id === hotel && v.organization_slug === 'slnt'),
    [visibleVenues, hotel],
  );
  const venueIds = useMemo(() => new Set(venues.map((v) => v.id)), [venues]);
  const venueNameById = useMemo(() => new Map(venues.map((v) => [v.id, v.name])), [venues]);
  const shiftMap = useMemo(
    () => new Map(shifts.map((s) => [key(s.user_id, s.work_date), s])),
    [shifts],
  );

  useEffect(() => {
    let active = true;
    generation.current++;
    setPeople([]);
    setShifts([]);
    setHotel(null);
    setAliases([]);
    setEditing(null);
    setSelectedCells(new Set());
    setSelectionAnchor(null);
    setError('');
    if (org !== 'slnt' || !profile?.assigned_hotel) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void Promise.all([
      resolveCanonicalHotelId(profile.assigned_hotel),
      resolveHotelKeys(profile.assigned_hotel),
    ])
      .then(([canonical, keys]) => {
        if (!active) return;
        if (!canonical || !keys.length) throw new Error('Unable to resolve the selected SLNT property.');
        setHotel(canonical);
        setAliases(keys);
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Hotel configuration failed');
          setLoading(false);
        }
      });
    return () => {
      active = false;
      generation.current++;
    };
  }, [org, profile?.assigned_hotel]);

  const load = useCallback(async () => {
    if (org !== 'slnt' || !hotel || !aliases.length || venuesLoading) return;
    const current = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const { data: access, error: accessError } = await (supabase as any).rpc(
        'can_manage_slnt_schedule',
        { _hotel_id: hotel },
      );
      if (accessError || access !== true) {
        throw new Error('You do not have permission to manage this SLNT hotel schedule.');
      }

      const [{ data: staff, error: staffError }, { data: roster, error: rosterError }] =
        await Promise.all([
          supabase
            .from('profiles')
            .select('id,full_name,nickname')
            .eq('organization_slug', 'slnt')
            .in('assigned_hotel', aliases)
            .is('deleted_at', null)
            .or('role.eq.housekeeping,acts_as_housekeeper.eq.true')
            .order('full_name'),
          (supabase as any)
            .from('staff_schedules')
            .select(
              'id,user_id,work_date,shift_start,shift_end,status,notes,staff_schedule_venues(venue_id)',
            )
            .eq('organization_slug', 'slnt')
            .eq('hotel_id', hotel)
            .gte('work_date', days[0])
            .lte('work_date', days[6]),
        ]);

      if (staffError || rosterError) {
        throw new Error(staffError?.message ?? rosterError?.message ?? 'Unable to load roster');
      }

      const candidates = (staff ?? []) as Person[];
      const scopeResult = candidates.length
        ? await supabase
            .from('user_property_scopes')
            .select('user_id,venue_id')
            .eq('organization_slug', 'slnt')
            .in(
              'user_id',
              candidates.map((p) => p.id),
            )
        : { data: [] as { user_id: string; venue_id: string }[], error: null };

      if (scopeResult.error) throw new Error('Unable to verify employee location permissions.');

      const mapped = new Map<string, string[]>();
      for (const row of scopeResult.data ?? []) {
        mapped.set(row.user_id, [...(mapped.get(row.user_id) ?? []), row.venue_id]);
      }
      const allowed = candidates.filter(
        (p) => !hasScopes || (mapped.get(p.id) ?? []).some((id) => myVenueIds.includes(id)),
      );
      const ids = new Set(allowed.map((p) => p.id));
      if (generation.current !== current) return;
      setScopes(mapped);
      setPeople(allowed);
      setShifts(((roster ?? []) as Shift[]).filter((s) => ids.has(s.user_id)));
    } catch (cause) {
      if (generation.current === current) {
        setError(cause instanceof Error ? cause.message : 'Unable to load this schedule');
      }
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, [org, hotel, aliases.join('|'), days.join('|'), venuesLoading, hasScopes, myVenueIds.join('|')]);

  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);

  const eligibleVenues = useCallback(
    (person: Person) => {
      const employeeScopes = scopes.get(person.id) ?? [];
      return venues.filter((v) => !employeeScopes.length || employeeScopes.includes(v.id));
    },
    [scopes, venues],
  );

  const editable = (shift: Shift | null | undefined) =>
    !shift ||
    !hasScopes ||
    (shift.staff_schedule_venues ?? []).every((link) => venueIds.has(link.venue_id));

  const open = (person: Person, date: string) => {
    const previous = shiftMap.get(key(person.id, date)) ?? null;
    if (!editable(previous)) {
      toast.error('This shift belongs to another venue.');
      return;
    }
    const permitted = eligibleVenues(person);
    setEditing({ person, date, previous });
    setStart(previous?.shift_start.slice(0, 5) ?? '09:00');
    setEnd(previous?.shift_end.slice(0, 5) ?? '17:00');
    setSelectedVenues(
      previous?.staff_schedule_venues?.map((v) => v.venue_id) ??
        (permitted.length === 1 ? [permitted[0].id] : []),
    );
    setNotes(previous?.notes ?? '');
  };

  const save = async (mode: SaveMode) => {
    if (busy || !editing || org !== 'slnt' || !hotel) return;
    if (!start || !end || end <= start) {
      toast.error('End time must be after start time. Overnight shifts are not supported.');
      return;
    }
    const permitted = new Set(eligibleVenues(editing.person).map((v) => v.id));
    if (
      mode !== 'off' &&
      (!selectedVenues.length || selectedVenues.some((id) => !permitted.has(id)))
    ) {
      toast.error('Choose at least one permitted working venue.');
      return;
    }
    if (
      mode === 'off' &&
      editing.previous?.status === 'published' &&
      !window.confirm(
        'Remove this published shift and mark the day off? The employee will no longer see a shift.',
      )
    ) {
      return;
    }

    setBusy(true);
    try {
      const { error: saveError } = await (supabase as any).rpc('slnt_save_staff_shift', {
        _hotel: hotel,
        _employee: editing.person.id,
        _date: editing.date,
        _start: start,
        _end: end,
        _status: mode,
        _notes: notes.trim(),
        _venues: mode === 'off' ? [] : selectedVenues,
      });
      if (saveError) throw new Error(saveError.message);
      setEditing(null);
      toast.success(
        mode === 'published'
          ? 'Shift published to this employee'
          : mode === 'draft'
            ? 'Draft saved privately'
            : 'Day marked off',
      );
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to save shift');
    } finally {
      setBusy(false);
    }
  };

  const drafts = shifts.filter(
    (s) =>
      s.status === 'draft' &&
      editable(s) &&
      (s.staff_schedule_venues?.length ?? 0) > 0,
  );

  const publish = async () => {
    if (busy || !hotel || !drafts.length || org !== 'slnt') return;
    if (
      !window.confirm(
        `Publish ${drafts.length} drafts for this week? Only their assigned employees will see the shifts.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const { data, error: publishError } = await (supabase as any).rpc(
        'slnt_publish_staff_week',
        {
          _hotel: hotel,
          _from: week,
          _ids: drafts.map((s) => s.id),
        },
      );
      if (publishError) throw new Error(publishError.message);
      toast.success(`${data} shifts published`);
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not publish');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (busy || !hotel || org !== 'slnt') return;
    if (
      !window.confirm(
        'Copy last week to empty days this week? Existing shifts will not be overwritten.',
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const { data, error: copyError } = await (supabase as any).rpc(
        'slnt_copy_staff_week',
        { _hotel: hotel, _from: week },
      );
      if (copyError) throw new Error(copyError.message);
      const result = data as { copied?: number; skipped?: number } | null;
      toast.info(
        `Copied ${result?.copied ?? 0} shifts as drafts; skipped ${result?.skipped ?? 0}.`,
      );
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not copy week');
    } finally {
      setBusy(false);
    }
  };

  const shown = useMemo(
    () =>
      people.filter((person) => {
        const employeeScopes = scopes.get(person.id) ?? [];
        const employeeVenueNames = (
          employeeScopes.length ? employeeScopes : venues.map((v) => v.id)
        )
          .map((id) => venueNameById.get(id))
          .filter(Boolean)
          .join(' ');
        const haystack =
          `${person.full_name} ${person.nickname ?? ''} ${employeeVenueNames}`.toLowerCase();
        if (!haystack.includes(search.trim().toLowerCase())) return false;
        if (
          filterVenue !== 'all' &&
          employeeScopes.length &&
          !employeeScopes.includes(filterVenue)
        ) {
          return false;
        }

        const personShifts = shifts.filter((shift) => shift.user_id === person.id);
        if (filterStatus === 'scheduled') {
          return personShifts.some((shift) => shift.status !== 'off');
        }
        if (filterStatus === 'unscheduled') {
          return !personShifts.some((shift) => shift.status !== 'off');
        }
        if (filterStatus === 'drafts') {
          return personShifts.some((shift) => shift.status === 'draft');
        }
        return true;
      }),
    [
      people,
      scopes,
      venues,
      venueNameById,
      search,
      filterVenue,
      filterStatus,
      shifts,
    ],
  );

  const today = todayBudapest();
  const move = (date: Date) => {
    const next = iso(date);
    setWeek(next);
    setMobileDay(next);
    setSelectedCells(new Set());
    setSelectionAnchor(null);
  };

  const selectCell = (
    person: Person,
    date: string,
    options: { range: boolean; toggle: boolean },
  ) => {
    const currentKey = key(person.id, date);
    const next = new Set(selectedCells);

    if (options.range && selectionAnchor) {
      const startRow = shown.findIndex((item) => item.id === selectionAnchor.userId);
      const endRow = shown.findIndex((item) => item.id === person.id);
      const startCol = days.indexOf(selectionAnchor.date);
      const endCol = days.indexOf(date);
      if (startRow >= 0 && endRow >= 0 && startCol >= 0 && endCol >= 0) {
        if (!options.toggle) next.clear();
        const minRow = Math.min(startRow, endRow);
        const maxRow = Math.max(startRow, endRow);
        const minCol = Math.min(startCol, endCol);
        const maxCol = Math.max(startCol, endCol);
        for (let row = minRow; row <= maxRow; row++) {
          for (let col = minCol; col <= maxCol; col++) {
            next.add(key(shown[row].id, days[col]));
          }
        }
      }
    } else if (options.toggle) {
      if (next.has(currentKey)) next.delete(currentKey);
      else next.add(currentKey);
      setSelectionAnchor({ userId: person.id, date });
    } else {
      next.clear();
      next.add(currentKey);
      setSelectionAnchor({ userId: person.id, date });
    }

    setSelectedCells(next);
  };

  const copySelection = useCallback(() => {
    if (!selectedCells.size) {
      toast.error('Select one or more schedule cells first.');
      return;
    }

    const coordinates = Array.from(selectedCells)
      .map((cellKey) => {
        const [userId, date] = cellKey.split('|');
        return {
          userId,
          date,
          row: shown.findIndex((person) => person.id === userId),
          col: days.indexOf(date),
        };
      })
      .filter((item) => item.row >= 0 && item.col >= 0);

    if (!coordinates.length) {
      toast.error('The selected cells are not visible in this schedule.');
      return;
    }

    const minRow = Math.min(...coordinates.map((item) => item.row));
    const maxRow = Math.max(...coordinates.map((item) => item.row));
    const minCol = Math.min(...coordinates.map((item) => item.col));
    const maxCol = Math.max(...coordinates.map((item) => item.col));
    const cells = coordinates.map((item) => ({
      rowOffset: item.row - minRow,
      colOffset: item.col - minCol,
      shift: shiftMap.get(key(item.userId, item.date)) ?? null,
    }));

    if (!cells.some((item) => item.shift)) {
      toast.error('The selection has no shifts to copy.');
      return;
    }

    setClipboard({
      width: maxCol - minCol + 1,
      height: maxRow - minRow + 1,
      cells,
    });
    setSelectedCells(new Set());
    setSelectionAnchor(null);
    setSelectionMode(true);
    toast.success(
      `Copied ${cells.filter((item) => item.shift).length} shift${cells.filter((item) => item.shift).length === 1 ? '' : 's'}. Select the target cells and paste.`,
    );
  }, [selectedCells, shown, days, shiftMap]);

  const pasteSelection = useCallback(async () => {
    if (!clipboard || !selectedCells.size || !hotel || busy) {
      if (!clipboard) toast.error('Copy a shift or range first.');
      else if (!selectedCells.size) toast.error('Select the target cells.');
      return;
    }

    const targets = Array.from(selectedCells)
      .map((cellKey) => {
        const [userId, date] = cellKey.split('|');
        return {
          userId,
          date,
          row: shown.findIndex((person) => person.id === userId),
          col: days.indexOf(date),
        };
      })
      .filter((item) => item.row >= 0 && item.col >= 0);

    if (!targets.length) {
      toast.error('No valid target cells are selected.');
      return;
    }

    const minRow = Math.min(...targets.map((item) => item.row));
    const minCol = Math.min(...targets.map((item) => item.col));
    const sourceByPosition = new Map(
      clipboard.cells.map((item) => [`${item.rowOffset}|${item.colOffset}`, item.shift]),
    );

    const items: Array<{
      employee: string;
      date: string;
      start: string;
      end: string;
      status: 'draft' | 'off';
      notes: string;
      venues: string[];
    }> = [];
    let skippedVenueMismatch = 0;
    let publishedTargets = 0;

    for (const target of targets) {
      const sourceRow = (target.row - minRow) % clipboard.height;
      const sourceCol = (target.col - minCol) % clipboard.width;
      const source = sourceByPosition.get(`${sourceRow}|${sourceCol}`);
      if (!source) continue;

      const targetPerson = shown[target.row];
      const existing = shiftMap.get(key(target.userId, target.date));
      if (existing?.status === 'published') publishedTargets++;

      const sourceVenueIds = source.staff_schedule_venues?.map((link) => link.venue_id) ?? [];
      if (source.status !== 'off') {
        const permitted = new Set(eligibleVenues(targetPerson).map((venue) => venue.id));
        if (!sourceVenueIds.length || sourceVenueIds.some((id) => !permitted.has(id))) {
          skippedVenueMismatch++;
          continue;
        }
      }

      items.push({
        employee: target.userId,
        date: target.date,
        start: source.shift_start.slice(0, 5),
        end: source.shift_end.slice(0, 5),
        status: source.status === 'off' ? 'off' : 'draft',
        notes: source.notes ?? '',
        venues: source.status === 'off' ? [] : sourceVenueIds,
      });
    }

    if (!items.length) {
      toast.error(
        skippedVenueMismatch
          ? 'The copied venue is not permitted for the selected housekeepers.'
          : 'No shifts in the copied pattern map to the selected targets.',
      );
      return;
    }

    let overwritePublished = false;
    if (publishedTargets > 0) {
      overwritePublished = window.confirm(
        `${publishedTargets} selected target${publishedTargets === 1 ? '' : 's'} already contain a published shift.\n\nOK = replace those published shifts as drafts.\nCancel = keep published shifts and paste into the other selected cells only.`,
      );
    }

    setBusy(true);
    try {
      const { data, error: pasteError } = await (supabase as any).rpc(
        'slnt_bulk_apply_staff_shifts',
        {
          _hotel: hotel,
          _items: items,
          _overwrite_published: overwritePublished,
        },
      );
      if (pasteError) throw new Error(pasteError.message);
      const result = data as { applied?: number; skipped_published?: number } | null;
      const details = [
        `${result?.applied ?? 0} shift${(result?.applied ?? 0) === 1 ? '' : 's'} pasted as drafts`,
        (result?.skipped_published ?? 0) > 0
          ? `${result?.skipped_published} published kept`
          : '',
        skippedVenueMismatch > 0 ? `${skippedVenueMismatch} venue mismatch skipped` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      toast.success(details);
      setSelectedCells(new Set());
      setSelectionAnchor(null);
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not paste schedule cells');
    } finally {
      setBusy(false);
    }
  }, [
    clipboard,
    selectedCells,
    hotel,
    busy,
    shown,
    days,
    shiftMap,
    eligibleVenues,
    load,
  ]);

  const openRoster = async (person: Person) => {
    if (!hotel) return;
    setRosterPerson(person);
    setRosterLoading(true);
    setApplyRosterForward(true);
    try {
      const { data, error: rosterError } = await (supabase as any)
        .from('slnt_staff_roster_templates')
        .select('iso_weekday,shift_start,shift_end,is_working,venue_ids,notes')
        .eq('organization_slug', 'slnt')
        .eq('hotel_id', hotel)
        .eq('user_id', person.id)
        .order('iso_weekday');

      if (rosterError) throw new Error(rosterError.message);

      const defaults = defaultRosterDays();
      const templateByDay = new Map<number, any>();
      for (const row of data ?? []) {
        templateByDay.set(Number((row as any).iso_weekday), row);
      }
      setRosterDays(
        defaults.map((day) => {
          const saved = templateByDay.get(day.iso_weekday);
          return saved
            ? {
                iso_weekday: day.iso_weekday,
                is_working: saved.is_working === true,
                shift_start: String(saved.shift_start).slice(0, 5),
                shift_end: String(saved.shift_end).slice(0, 5),
                notes: saved.notes ?? '',
              }
            : day;
        }),
      );

      const savedVenueIds = [
        ...new Set(
          (data ?? []).flatMap((row: any) =>
            Array.isArray(row.venue_ids) ? row.venue_ids : [],
          ),
        ),
      ] as string[];
      const permitted = eligibleVenues(person);
      setRosterVenues(
        savedVenueIds.length
          ? savedVenueIds.filter((id) => permitted.some((venue) => venue.id === id))
          : permitted.length === 1
            ? [permitted[0].id]
            : [],
      );
    } catch (cause) {
      setRosterPerson(null);
      toast.error(cause instanceof Error ? cause.message : 'Unable to load the default roster');
    } finally {
      setRosterLoading(false);
    }
  };

  const saveRoster = async () => {
    if (!rosterPerson || !hotel || rosterBusy) return;
    const workingDays = rosterDays.filter((day) => day.is_working);
    if (
      workingDays.some(
        (day) =>
          !day.shift_start ||
          !day.shift_end ||
          day.shift_end <= day.shift_start,
      )
    ) {
      toast.error('Each working day needs a valid start and end time.');
      return;
    }
    if (workingDays.length && !rosterVenues.length) {
      toast.error('Choose at least one normal working venue for this roster.');
      return;
    }

    setRosterBusy(true);
    try {
      const { error: saveError } = await (supabase as any).rpc(
        'slnt_replace_staff_roster_template',
        {
          _hotel: hotel,
          _employee: rosterPerson.id,
          _days: rosterDays,
          _venues: rosterVenues,
        },
      );
      if (saveError) throw new Error(saveError.message);

      let generated = 0;
      let skipped = 0;
      if (applyRosterForward) {
        const { data, error: applyError } = await (supabase as any).rpc(
          'slnt_apply_staff_roster_template',
          {
            _hotel: hotel,
            _employee: rosterPerson.id,
            _from: today,
            _weeks: 6,
          },
        );
        if (applyError) throw new Error(applyError.message);
        const result = data as { generated?: number; skipped_existing?: number } | null;
        generated = result?.generated ?? 0;
        skipped = result?.skipped_existing ?? 0;
      }

      toast.success(
        applyRosterForward
          ? `Default roster saved · ${generated} future drafts created · ${skipped} existing dates kept`
          : 'Default roster saved',
      );
      setRosterPerson(null);
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to save the default roster');
    } finally {
      setRosterBusy(false);
    }
  };

  const clearFilters = () => {
    setSearch('');
    setFilterVenue('all');
    setFilterStatus('all');
  };

  const cell = (person: Person, date: string) => {
    const cellKey = key(person.id, date);
    const shift = shiftMap.get(cellKey);
    const restricted = !!shift && !editable(shift);
    const selected = selectedCells.has(cellKey);
    const title = !shift
      ? '+ Add shift'
      : restricted
        ? 'Restricted venue'
        : shift.status === 'off'
          ? 'Day off'
          : `${shift.shift_start.slice(0, 5)}–${shift.shift_end.slice(0, 5)}`;
    const locationNames =
      shift && !restricted
        ? shift.staff_schedule_venues
            ?.map((link) => venueNameById.get(link.venue_id))
            .filter(Boolean)
        : [];
    const location =
      locationNames.length <= 2
        ? locationNames.join(', ')
        : `${locationNames.length} venues · ${locationNames.slice(0, 2).join(', ')}…`;

    return (
      <button
        type="button"
        disabled={busy || restricted || loading}
        onClick={(event) => {
          const selecting =
            selectionMode || event.metaKey || event.ctrlKey || event.shiftKey;
          if (selecting) {
            selectCell(person, date, {
              range: event.shiftKey,
              toggle: event.metaKey || event.ctrlKey,
            });
            return;
          }
          open(person, date);
        }}
        onDoubleClick={() => {
          if (!restricted && !busy) open(person, date);
        }}
        aria-label={`${person.full_name}, ${date}, ${title}`}
        aria-pressed={selected}
        className={[
          'w-full min-h-20 rounded-lg border p-2.5 text-left transition',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          selected
            ? 'border-primary bg-primary/10 ring-2 ring-inset ring-primary/30'
            : shift
              ? 'border-border bg-background shadow-sm hover:border-primary/60 hover:bg-primary/5'
              : 'border-dashed bg-background/70 hover:border-primary/50 hover:bg-primary/5',
          'disabled:opacity-60',
        ].join(' ')}
      >
        <span className={`text-xs font-semibold ${!shift ? 'text-muted-foreground' : ''}`}>
          {title}
        </span>
        {shift?.status !== 'off' && shift && !restricted && (
          <>
            <p className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
              {location || 'Venue missing — contact manager'}
            </p>
            <Badge
              variant={shift.status === 'published' ? 'default' : 'outline'}
              className="mt-1.5 text-[10px]"
            >
              {shift.status === 'published' ? 'Published' : 'Draft'}
            </Badge>
          </>
        )}
      </button>
    );
  };

  if (org !== 'slnt') {
    return (
      <Card>
        <CardContent className="p-6">This roster is available only to the SLNT organization.</CardContent>
      </Card>
    );
  }
  if (!profile?.assigned_hotel) {
    return (
      <Card>
        <CardContent className="p-6">Select an SLNT hotel to manage the roster.</CardContent>
      </Card>
    );
  }

  const filtersActive = !!search || filterVenue !== 'all' || filterStatus !== 'all';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <CalendarDays className="h-5 w-5" />
            Staff schedule
          </h2>
          <p className="text-sm text-muted-foreground">
            Maintain the normal roster, manage exceptions and publish confirmed shifts to staff.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy || loading || !!error}
            onClick={copy}
          >
            <Copy className="mr-1 h-4 w-4" />
            Copy last week
          </Button>
          <Button
            disabled={busy || loading || !!error || !drafts.length}
            onClick={publish}
          >
            <Send className="mr-1 h-4 w-4" />
            Publish {drafts.length || ''} drafts
          </Button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-3">
            <Users className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="text-xl font-semibold">{people.length}</div>
              <p className="text-xs text-muted-foreground">Housekeepers</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-3">
            <Check className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="text-xl font-semibold">
                {shifts.filter((s) => s.status === 'published').length}
              </div>
              <p className="text-xs text-muted-foreground">Published this week</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-3">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="text-xl font-semibold">{drafts.length}</div>
              <p className="text-xs text-muted-foreground">Ready-to-publish drafts</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent
          className="space-y-3 p-3"
          onKeyDown={(event) => {
            if (!(event.metaKey || event.ctrlKey)) return;
            if (event.key.toLowerCase() === 'c' && selectedCells.size) {
              event.preventDefault();
              copySelection();
            }
            if (event.key.toLowerCase() === 'v' && selectedCells.size && clipboard) {
              event.preventDefault();
              void pasteSelection();
            }
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="outline"
                aria-label="Previous week"
                disabled={busy}
                onClick={() => move(subWeeks(localDate(week), 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                aria-label="Next week"
                disabled={busy}
                onClick={() => move(addWeeks(localDate(week), 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <span className="px-2 text-sm font-semibold">
                {format(localDate(week), 'MMM d')} – {format(localDate(days[6]), 'MMM d, yyyy')}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => move(localDate(monday(today)))}
              >
                Today
              </Button>
            </div>

            <div className="flex flex-wrap gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  aria-label="Search employees"
                  className="w-56 pl-8"
                  placeholder="Search staff or venue"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              {venues.length > 0 && (
                <Select value={filterVenue} onValueChange={setFilterVenue}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All my venues</SelectItem>
                    {venues.map((v) => (
                      <SelectItem value={v.id} key={v.id}>
                        {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <Select
                value={filterStatus}
                onValueChange={(value) => setFilterStatus(value as StaffFilter)}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All staff</SelectItem>
                  <SelectItem value="scheduled">Has shifts</SelectItem>
                  <SelectItem value="unscheduled">Needs scheduling</SelectItem>
                  <SelectItem value="drafts">Has drafts</SelectItem>
                </SelectContent>
              </Select>

              {filtersActive && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-2">
            <Button
              size="sm"
              variant={selectionMode ? 'secondary' : 'outline'}
              onClick={() => {
                setSelectionMode((value) => !value);
                setSelectedCells(new Set());
                setSelectionAnchor(null);
              }}
            >
              {selectionMode ? 'Selecting cells' : 'Select cells'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!selectedCells.size}
              onClick={copySelection}
            >
              <Copy className="mr-1 h-4 w-4" />
              Copy {selectedCells.size || ''}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!clipboard || !selectedCells.size || busy}
              onClick={() => void pasteSelection()}
            >
              <ClipboardPaste className="mr-1 h-4 w-4" />
              Paste
            </Button>
            {!!selectedCells.size && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSelectedCells(new Set());
                  setSelectionAnchor(null);
                }}
              >
                <X className="mr-1 h-4 w-4" />
                Clear selection
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {selectedCells.size
                ? `${selectedCells.size} cell${selectedCells.size === 1 ? '' : 's'} selected`
                : clipboard
                  ? 'Copied pattern ready. Select target cells, then paste.'
                  : 'Tip: Select cells, then Shift-click to select a range. Cmd/Ctrl+C and Cmd/Ctrl+V also work.'}
            </span>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive p-3 text-sm text-destructive"
            >
              {error}{' '}
              <Button variant="outline" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          )}

          {loading || venuesLoading || !hotel ? (
            <p role="status" className="p-8 text-center text-sm text-muted-foreground">
              Loading SLNT roster…
            </p>
          ) : !shown.length ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              {filtersActive
                ? 'No matching housekeepers. Try clearing a filter.'
                : 'No housekeepers linked to this hotel. Check employee account and venue mappings.'}
            </p>
          ) : (
            <>
              <div className="hidden max-h-[65vh] overflow-auto rounded-lg border md:block">
                <table className="w-full min-w-[980px] border-collapse text-sm">
                  <thead className="sticky top-0 z-30">
                    <tr>
                      <th className="sticky left-0 z-40 min-w-52 border-b-2 border-r-2 bg-muted/95 p-3 text-left backdrop-blur">
                        Housekeeper
                      </th>
                      {days.map((day) => {
                        const isToday = day === today;
                        const weekday = localDate(day).getDay();
                        const weekend = weekday === 0 || weekday === 6;
                        return (
                          <th
                            key={day}
                            className={[
                              'min-w-32 border-b-2 border-r p-2 text-center',
                              isToday
                                ? 'border-primary/40 bg-primary/15'
                                : weekend
                                  ? 'bg-muted/70'
                                  : 'bg-muted/40',
                            ].join(' ')}
                          >
                            <div className={isToday ? 'font-bold text-primary' : 'font-semibold'}>
                              {format(localDate(day), 'EEE')}
                            </div>
                            <div className={`text-xs ${isToday ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>
                              {format(localDate(day), 'MMM d')}
                            </div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              {
                                shifts.filter(
                                  (s) => s.work_date === day && s.status === 'published',
                                ).length
                              }{' '}
                              scheduled
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((person) => (
                      <tr
                        key={person.id}
                        className={
                          highlightedPerson === person.id
                            ? 'bg-primary/[0.045]'
                            : 'hover:bg-muted/20'
                        }
                      >
                        <th className="sticky left-0 z-20 border-b border-r-2 bg-background/95 p-3 text-left backdrop-blur">
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              className="min-w-0 text-left"
                              onClick={() =>
                                setHighlightedPerson((current) =>
                                  current === person.id ? null : person.id,
                                )
                              }
                            >
                              <div className="truncate font-semibold">{person.full_name}</div>
                              <span className="text-xs font-normal text-muted-foreground">
                                {person.nickname}
                              </span>
                            </button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 shrink-0 px-2 text-xs"
                              onClick={() => void openRoster(person)}
                            >
                              <CalendarRange className="mr-1 h-3.5 w-3.5" />
                              Roster
                            </Button>
                          </div>
                        </th>
                        {days.map((day) => {
                          const isToday = day === today;
                          const weekday = localDate(day).getDay();
                          const weekend = weekday === 0 || weekday === 6;
                          return (
                            <td
                              key={day}
                              className={[
                                'border-b border-r p-1.5 align-top',
                                isToday
                                  ? 'bg-primary/[0.07]'
                                  : weekend
                                    ? 'bg-muted/25'
                                    : '',
                              ].join(' ')}
                            >
                              {cell(person, day)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-3 md:hidden">
                <div
                  role="group"
                  aria-label="Select schedule date"
                  className="flex gap-1 overflow-x-auto pb-2"
                >
                  {days.map((day) => (
                    <Button
                      key={day}
                      size="sm"
                      className="shrink-0"
                      variant={mobileDay === day ? 'default' : 'outline'}
                      onClick={() => setMobileDay(day)}
                    >
                      {format(localDate(day), 'EEE d')}
                    </Button>
                  ))}
                </div>
                {shown.map((person) => (
                  <div
                    key={person.id}
                    className={`rounded-lg border p-3 ${highlightedPerson === person.id ? 'border-primary/50 bg-primary/5' : ''}`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        className="text-left text-sm font-semibold"
                        onClick={() =>
                          setHighlightedPerson((current) =>
                            current === person.id ? null : person.id,
                          )
                        }
                      >
                        {person.full_name}
                        {person.nickname && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {person.nickname}
                          </span>
                        )}
                      </button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void openRoster(person)}
                      >
                        <CalendarRange className="mr-1 h-4 w-4" />
                        Roster
                      </Button>
                    </div>
                    {cell(person, days.includes(mobileDay) ? mobileDay : days[0])}
                  </div>
                ))}
              </div>
            </>
          )}

          <p className="text-xs text-muted-foreground">
            Published shifts are used for housekeeping assignment conflict checks. Copy/paste creates
            drafts by default and never silently replaces a published shift.
          </p>
        </CardContent>
      </Card>

      <details className="rounded-lg border bg-background">
        <summary className="flex cursor-pointer items-center gap-2 p-4 text-sm font-semibold">
          <Settings2 className="h-4 w-4" />
          Advanced · alerts and safeguards
        </summary>
        <div className="p-3 pt-0">
          <HousekeepingAutomationSettings />
        </div>
      </details>

      <Dialog
        open={!!editing}
        onOpenChange={(openDialog) => {
          if (!openDialog && !busy) setEditing(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing?.person.full_name} ·{' '}
              {editing && format(localDate(editing.date), 'EEE, MMM d')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="mb-2 block">Quick shift</Label>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: 'Morning', start: '08:00', end: '16:00' },
                  { label: 'Standard', start: '09:00', end: '17:00' },
                  { label: 'Late', start: '12:00', end: '20:00' },
                ].map((preset) => (
                  <Button
                    key={preset.label}
                    size="sm"
                    variant={
                      start === preset.start && end === preset.end ? 'default' : 'outline'
                    }
                    onClick={() => {
                      setStart(preset.start);
                      setEnd(preset.end);
                    }}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="shift-start">Start</Label>
                <Input
                  id="shift-start"
                  type="time"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="shift-end">End</Label>
                <Input
                  id="shift-end"
                  type="time"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label className="mb-2 flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                Working venue(s)
              </Label>
              <div className="max-h-44 space-y-2 overflow-auto rounded-lg border p-3">
                {editing && eligibleVenues(editing.person).length ? (
                  eligibleVenues(editing.person).map((v) => (
                    <label key={v.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedVenues.includes(v.id)}
                        onCheckedChange={(checked) =>
                          setSelectedVenues((old) =>
                            checked === true
                              ? [...new Set([...old, v.id])]
                              : old.filter((id) => id !== v.id),
                          )
                        }
                      />
                      {v.name}
                    </label>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No permitted venues. Ask SLNT management to map access.
                  </p>
                )}
              </div>
            </div>

            <div>
              <Label htmlFor="shift-note">Note visible to this employee (optional)</Label>
              <Textarea
                id="shift-note"
                maxLength={500}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="For example: start at the main entrance"
              />
            </div>

            {editing?.previous?.status === 'published' && (
              <p className="text-xs text-muted-foreground">
                Changes to this published shift become visible to the employee after saving.
              </p>
            )}
          </div>

          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void save('off')}>
              Day off
            </Button>
            {editing?.previous?.status !== 'published' && (
              <Button variant="outline" disabled={busy} onClick={() => void save('draft')}>
                Save draft
              </Button>
            )}
            <Button disabled={busy} onClick={() => void save('published')}>
              <Check className="mr-1 h-4 w-4" />
              {busy
                ? 'Saving…'
                : editing?.previous?.status === 'published'
                  ? 'Save changes'
                  : 'Save & publish'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!rosterPerson}
        onOpenChange={(openDialog) => {
          if (!openDialog && !rosterBusy) setRosterPerson(null);
        }}
      >
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Default roster{rosterPerson ? ` · ${rosterPerson.full_name}` : ''}
            </DialogTitle>
          </DialogHeader>

          {rosterLoading || !rosterPerson ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Loading default roster…
            </p>
          ) : (
            <div className="space-y-5">
              <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                Save the normal weekly pattern once. HotelCare can prepare future dates as private
                drafts, so the manager only needs to change exceptions such as a day off or a
                different shift. Existing dated shifts are never overwritten.
              </div>

              <div>
                <Label className="mb-2 flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  Normal working venue(s)
                </Label>
                <div className="grid max-h-40 gap-2 overflow-auto rounded-lg border p-3 sm:grid-cols-2">
                  {eligibleVenues(rosterPerson).map((venue) => (
                    <label key={venue.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={rosterVenues.includes(venue.id)}
                        onCheckedChange={(checked) =>
                          setRosterVenues((old) =>
                            checked === true
                              ? [...new Set([...old, venue.id])]
                              : old.filter((id) => id !== venue.id),
                          )
                        }
                      />
                      <span className="truncate">{venue.name}</span>
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  These venues are used for normal working days. A specific date can still be
                  edited afterwards.
                </p>
              </div>

              <div className="overflow-hidden rounded-lg border">
                <div className="grid grid-cols-[76px_88px_1fr_1fr] gap-2 border-b bg-muted/50 px-3 py-2 text-xs font-semibold sm:grid-cols-[90px_100px_1fr_1fr]">
                  <span>Day</span>
                  <span>Status</span>
                  <span>Start</span>
                  <span>End</span>
                </div>
                {rosterDays.map((day, index) => (
                  <div
                    key={day.iso_weekday}
                    className="grid grid-cols-[76px_88px_1fr_1fr] items-center gap-2 border-b px-3 py-2 last:border-b-0 sm:grid-cols-[90px_100px_1fr_1fr]"
                  >
                    <span className="text-sm font-semibold">
                      {weekdayNames[day.iso_weekday - 1]}
                    </span>
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={day.is_working}
                        onCheckedChange={(checked) =>
                          setRosterDays((old) =>
                            old.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, is_working: checked === true }
                                : item,
                            ),
                          )
                        }
                      />
                      {day.is_working ? 'Working' : 'Off'}
                    </label>
                    <Input
                      aria-label={`${weekdayNames[day.iso_weekday - 1]} start`}
                      type="time"
                      className="h-8"
                      disabled={!day.is_working}
                      value={day.shift_start}
                      onChange={(event) =>
                        setRosterDays((old) =>
                          old.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, shift_start: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                    <Input
                      aria-label={`${weekdayNames[day.iso_weekday - 1]} end`}
                      type="time"
                      className="h-8"
                      disabled={!day.is_working}
                      value={day.shift_end}
                      onChange={(event) =>
                        setRosterDays((old) =>
                          old.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, shift_end: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </div>
                ))}
              </div>

              <label className="flex items-start gap-2 rounded-lg border p-3">
                <Checkbox
                  className="mt-0.5"
                  checked={applyRosterForward}
                  onCheckedChange={(checked) => setApplyRosterForward(checked === true)}
                />
                <span>
                  <span className="block text-sm font-medium">
                    Prepare the next 6 weeks as drafts
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Existing shifts and published dates stay unchanged. Only empty future dates are
                    filled from this default roster.
                  </span>
                </span>
              </label>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              disabled={rosterBusy}
              onClick={() => setRosterPerson(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={rosterBusy || rosterLoading || !rosterPerson}
              onClick={() => void saveRoster()}
            >
              <CalendarRange className="mr-1 h-4 w-4" />
              {rosterBusy ? 'Saving…' : 'Save default roster'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
