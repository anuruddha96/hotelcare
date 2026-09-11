import { useCallback, useEffect, useMemo, useState } from 'react';
import { DateRange } from 'react-day-picker';
import { Download, DoorOpen, History, Minus, Plus, Save, Shirt, ShieldCheck, UserRound, Waves } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { translateLinenItem } from '@/lib/linen-item-i18n';
import { getLocalDateString } from '@/lib/utils';
import { DateRangeFilter } from './DateRangeFilter';

type LinenItem = {
  id: string;
  name: string;
  display_name: string;
  sort_order: number;
};

type RoomRow = {
  id: string;
  room_number: string;
  hotel: string;
};

type LinenCountRow = {
  id: string;
  housekeeper_id: string;
  room_id: string;
  assignment_id: string | null;
  linen_item_id: string;
  count: number;
  work_date: string;
  created_at: string;
  updated_at?: string;
};

type AssignmentRow = {
  id: string;
  room_id: string;
  assigned_to: string;
  assignment_date: string;
  completed_at: string | null;
  supervisor_approved: boolean | null;
  supervisor_approved_by: string | null;
  supervisor_approved_at: string | null;
};

type ProfileRow = {
  id: string;
  full_name: string;
  nickname: string | null;
};

type PublicAreaCountRow = {
  id: string;
  housekeeper_id: string;
  task_id: string | null;
  area_type: 'gym' | 'sauna' | 'jacuzzi';
  hotel: string;
  linen_item_id: string;
  count: number;
  work_date: string;
};

type AuditRow = {
  id: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  housekeeper_id: string;
  room_id: string;
  linen_item_id: string;
  work_date: string;
  old_count: number | null;
  new_count: number | null;
  changed_by_name: string | null;
  room_number: string | null;
  linen_item_name: string | null;
  created_at: string;
};

type SessionItem = {
  item: LinenItem;
  count: number;
  rows: LinenCountRow[];
};

type RoomSession = {
  key: string;
  roomId: string;
  roomNumber: string;
  workDate: string;
  housekeeperId: string;
  housekeeperName: string;
  assignment: AssignmentRow | null;
  items: SessionItem[];
  total: number;
};

type HousekeeperSummary = {
  id: string;
  name: string;
  total: number;
  roomCount: number;
  items: Record<string, number>;
};

const PUBLIC_AREAS: Array<{ key: 'gym' | 'sauna' | 'jacuzzi'; label: string }> = [
  { key: 'gym', label: 'Gym' },
  { key: 'sauna', label: 'Sauna' },
  { key: 'jacuzzi', label: 'Jacuzzi' },
];

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export function DirtyLinenManagementV2() {
  const { profile } = useAuth();
  const { t } = useTranslation();

  const [dateRange, setDateRange] = useState<DateRange | undefined>({ from: new Date(), to: new Date() });
  const [linenItems, setLinenItems] = useState<LinenItem[]>([]);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [counts, setCounts] = useState<LinenCountRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [publicCounts, setPublicCounts] = useState<PublicAreaCountRow[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [selectedHousekeeperId, setSelectedHousekeeperId] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [draftCounts, setDraftCounts] = useState<Record<string, number>>({});

  const canCorrect = !!profile?.role && [
    'admin', 'manager', 'housekeeping_manager', 'top_management', 'top_management_manager',
  ].includes(profile.role);

  useEffect(() => {
    const loadItems = async () => {
      const { data, error } = await supabase
        .from('dirty_linen_items')
        .select('id, name, display_name, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (error) {
        console.error('[DirtyLinen] linen item load failed', error);
        return;
      }
      setLinenItems((data || []) as LinenItem[]);
    };
    void loadItems();
  }, []);

  const fetchData = useCallback(async () => {
    if (!profile?.assigned_hotel || !dateRange?.from) {
      setRooms([]);
      setCounts([]);
      setAssignments([]);
      setProfiles([]);
      setPublicCounts([]);
      setAuditRows([]);
      return;
    }

    const startDate = getLocalDateString(dateRange.from);
    const endDate = getLocalDateString(dateRange.to || dateRange.from);
    setLoading(true);

    try {
      const hotelKeys = await resolveHotelKeys(profile.assigned_hotel);
      if (!hotelKeys.length) return;

      const { data: roomData, error: roomError } = await supabase
        .from('rooms')
        .select('id, room_number, hotel')
        .in('hotel', hotelKeys)
        .order('room_number', { ascending: true });
      if (roomError) throw roomError;

      const hotelRooms = ((roomData || []) as RoomRow[]).sort((a, b) =>
        a.room_number.localeCompare(b.room_number, undefined, { numeric: true, sensitivity: 'base' }),
      );
      const roomIds = hotelRooms.map(room => room.id);

      let roomCounts: LinenCountRow[] = [];
      let roomAssignments: AssignmentRow[] = [];
      if (roomIds.length) {
        const [{ data: countData, error: countError }, { data: assignmentData, error: assignmentError }] = await Promise.all([
          supabase
            .from('dirty_linen_counts')
            .select('id, housekeeper_id, room_id, assignment_id, linen_item_id, count, work_date, created_at, updated_at')
            .in('room_id', roomIds)
            .gte('work_date', startDate)
            .lte('work_date', endDate)
            .gt('count', 0),
          supabase
            .from('room_assignments')
            .select('id, room_id, assigned_to, assignment_date, completed_at, supervisor_approved, supervisor_approved_by, supervisor_approved_at')
            .in('room_id', roomIds)
            .gte('assignment_date', startDate)
            .lte('assignment_date', endDate),
        ]);
        if (countError) throw countError;
        if (assignmentError) throw assignmentError;
        roomCounts = (countData || []) as LinenCountRow[];
        roomAssignments = (assignmentData || []) as AssignmentRow[];
      }

      const { data: publicData, error: publicError } = await (supabase as any)
        .from('dirty_linen_public_area_counts')
        .select('id, housekeeper_id, task_id, area_type, hotel, linen_item_id, count, work_date')
        .in('hotel', hotelKeys)
        .gte('work_date', startDate)
        .lte('work_date', endDate)
        .gt('count', 0);
      if (publicError) throw publicError;
      const publicRows = (publicData || []) as PublicAreaCountRow[];

      const personIds = new Set<string>();
      roomCounts.forEach(row => personIds.add(row.housekeeper_id));
      publicRows.forEach(row => personIds.add(row.housekeeper_id));
      roomAssignments.forEach(row => {
        if (row.assigned_to) personIds.add(row.assigned_to);
        if (row.supervisor_approved_by) personIds.add(row.supervisor_approved_by);
      });

      let people: ProfileRow[] = [];
      if (personIds.size) {
        const { data: peopleData, error: peopleError } = await supabase
          .from('profiles')
          .select('id, full_name, nickname')
          .in('id', Array.from(personIds));
        if (peopleError) throw peopleError;
        people = (peopleData || []) as ProfileRow[];
      }

      let audits: AuditRow[] = [];
      if (roomIds.length) {
        const { data: auditData, error: auditError } = await (supabase as any)
          .from('dirty_linen_correction_audit')
          .select('id, action, housekeeper_id, room_id, linen_item_id, work_date, old_count, new_count, changed_by_name, room_number, linen_item_name, created_at')
          .in('room_id', roomIds)
          .gte('work_date', startDate)
          .lte('work_date', endDate)
          .order('created_at', { ascending: false })
          .limit(100);
        if (!auditError) audits = (auditData || []) as AuditRow[];
      }

      setRooms(hotelRooms);
      setCounts(roomCounts);
      setAssignments(roomAssignments);
      setProfiles(people);
      setPublicCounts(publicRows);
      setAuditRows(audits);
    } catch (error) {
      console.error('[DirtyLinen] report load failed', error);
      toast.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [dateRange?.from, dateRange?.to, profile?.assigned_hotel, t]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!profile?.id) return;
    const channel = (supabase as any)
      .channel(`dirty-linen-manager-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dirty_linen_counts' }, () => { void fetchData(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dirty_linen_public_area_counts' }, () => { void fetchData(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_assignments' }, () => { void fetchData(); })
      .subscribe();
    return () => { void (supabase as any).removeChannel(channel); };
  }, [profile?.id, fetchData]);

  const itemById = useMemo(() => new Map(linenItems.map(item => [item.id, item])), [linenItems]);
  const roomById = useMemo(() => new Map(rooms.map(room => [room.id, room])), [rooms]);
  const profileById = useMemo(() => new Map(profiles.map(person => [person.id, person])), [profiles]);
  const assignmentById = useMemo(() => new Map(assignments.map(row => [row.id, row])), [assignments]);

  const displayPerson = useCallback((id?: string | null) => {
    if (!id) return '—';
    const person = profileById.get(id);
    return person?.nickname || person?.full_name || 'Unknown user';
  }, [profileById]);

  const sessions = useMemo<RoomSession[]>(() => {
    const map = new Map<string, RoomSession>();

    assignments.forEach(assignment => {
      const room = roomById.get(assignment.room_id);
      if (!room || !assignment.assigned_to) return;
      map.set(assignment.id, {
        key: assignment.id,
        roomId: assignment.room_id,
        roomNumber: room.room_number,
        workDate: assignment.assignment_date,
        housekeeperId: assignment.assigned_to,
        housekeeperName: displayPerson(assignment.assigned_to),
        assignment,
        items: linenItems.map(item => ({ item, count: 0, rows: [] })),
        total: 0,
      });
    });

    counts.forEach(row => {
      const room = roomById.get(row.room_id);
      const assignment = row.assignment_id ? assignmentById.get(row.assignment_id) : undefined;
      const fallback = assignments.find(candidate =>
        candidate.room_id === row.room_id &&
        candidate.assigned_to === row.housekeeper_id &&
        candidate.assignment_date === row.work_date,
      );
      const linkedAssignment = assignment || fallback || null;
      const key = linkedAssignment?.id || `orphan:${row.work_date}:${row.room_id}:${row.housekeeper_id}`;

      if (!map.has(key)) {
        map.set(key, {
          key,
          roomId: row.room_id,
          roomNumber: room?.room_number || 'Unknown room',
          workDate: row.work_date,
          housekeeperId: row.housekeeper_id,
          housekeeperName: displayPerson(row.housekeeper_id),
          assignment: linkedAssignment,
          items: linenItems.map(item => ({ item, count: 0, rows: [] })),
          total: 0,
        });
      }

      const session = map.get(key)!;
      const entry = session.items.find(candidate => candidate.item.id === row.linen_item_id);
      if (entry) {
        entry.count += row.count;
        entry.rows.push(row);
      } else {
        const item = itemById.get(row.linen_item_id);
        if (item) session.items.push({ item, count: row.count, rows: [row] });
      }
      session.total += row.count;
    });

    return Array.from(map.values()).sort((a, b) => {
      const dateDiff = b.workDate.localeCompare(a.workDate);
      if (dateDiff) return dateDiff;
      return a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [assignments, counts, roomById, assignmentById, displayPerson, linenItems, itemById]);

  const housekeepers = useMemo<HousekeeperSummary[]>(() => {
    const map = new Map<string, HousekeeperSummary>();
    sessions.forEach(session => {
      if (!map.has(session.housekeeperId)) {
        map.set(session.housekeeperId, {
          id: session.housekeeperId,
          name: session.housekeeperName,
          total: 0,
          roomCount: 0,
          items: {},
        });
      }
      const summary = map.get(session.housekeeperId)!;
      summary.roomCount += 1;
      summary.total += session.total;
      session.items.forEach(entry => {
        summary.items[entry.item.name] = (summary.items[entry.item.name] || 0) + entry.count;
      });
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [sessions]);

  const vendorItemTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    linenItems.forEach(item => { totals[item.name] = 0; });
    housekeepers.forEach(housekeeper => {
      linenItems.forEach(item => {
        totals[item.name] += housekeeper.items[item.name] || 0;
      });
    });
    return totals;
  }, [housekeepers, linenItems]);

  const totalCollected = useMemo(() => counts.reduce((sum, row) => sum + row.count, 0), [counts]);
  const roomTotals = useMemo(() => {
    const map = new Map<string, number>();
    counts.forEach(row => map.set(row.room_id, (map.get(row.room_id) || 0) + row.count));
    return map;
  }, [counts]);
  const publicTotal = useMemo(() => publicCounts.reduce((sum, row) => sum + row.count, 0), [publicCounts]);
  const towelItems = useMemo(() => linenItems.filter(item => item.name.includes('towel')), [linenItems]);

  const selectedHousekeeperSessions = useMemo(
    () => sessions.filter(session => session.housekeeperId === selectedHousekeeperId),
    [sessions, selectedHousekeeperId],
  );
  const selectedRoomSessions = useMemo(
    () => sessions.filter(session => session.roomId === selectedRoomId),
    [sessions, selectedRoomId],
  );

  const draftKey = (session: RoomSession, itemId: string) => `${session.key}|${itemId}`;

  const seedDrafts = useCallback((targetSessions: RoomSession[]) => {
    const next: Record<string, number> = {};
    targetSessions.forEach(session => {
      session.items.forEach(entry => { next[draftKey(session, entry.item.id)] = entry.count; });
    });
    setDraftCounts(next);
  }, []);

  useEffect(() => {
    if (selectedHousekeeperId) seedDrafts(selectedHousekeeperSessions);
  }, [selectedHousekeeperId, selectedHousekeeperSessions, seedDrafts]);

  useEffect(() => {
    if (selectedRoomId) seedDrafts(selectedRoomSessions);
  }, [selectedRoomId, selectedRoomSessions, seedDrafts]);

  const setDraft = (session: RoomSession, itemId: string, value: number) => {
    setDraftCounts(previous => ({ ...previous, [draftKey(session, itemId)]: Math.max(0, Math.floor(Number.isFinite(value) ? value : 0)) }));
  };

  const persistItemCount = async (session: RoomSession, entry: SessionItem, requestedCount: number) => {
    const nextCount = Math.max(0, Math.floor(requestedCount));
    if (nextCount === entry.count) return;

    if (entry.rows.length) {
      const [primary, ...duplicates] = entry.rows;
      if (nextCount === 0) {
        const ids = entry.rows.map(row => row.id);
        const { error } = await (supabase as any).from('dirty_linen_counts').delete().in('id', ids);
        if (error) throw error;
        return;
      }

      const { error: updateError } = await (supabase as any)
        .from('dirty_linen_counts')
        .update({ count: nextCount, updated_at: new Date().toISOString() })
        .eq('id', primary.id);
      if (updateError) throw updateError;

      if (duplicates.length) {
        const { error: duplicateError } = await (supabase as any)
          .from('dirty_linen_counts')
          .delete()
          .in('id', duplicates.map(row => row.id));
        if (duplicateError) throw duplicateError;
      }
      return;
    }

    if (nextCount > 0) {
      const { error } = await (supabase as any).from('dirty_linen_counts').insert({
        housekeeper_id: session.housekeeperId,
        room_id: session.roomId,
        assignment_id: session.assignment?.id || null,
        linen_item_id: entry.item.id,
        count: nextCount,
        work_date: session.workDate,
        organization_slug: profile?.organization_slug || null,
      });
      if (error) throw error;
    }
  };

  const saveSession = async (session: RoomSession) => {
    if (!canCorrect) return;
    setSavingKey(session.key);
    try {
      for (const entry of session.items) {
        const value = draftCounts[draftKey(session, entry.item.id)] ?? entry.count;
        await persistItemCount(session, entry, value);
      }
      toast.success(`Dirty linen updated for room ${session.roomNumber}`);
      await fetchData();
    } catch (error) {
      console.error('[DirtyLinen] correction failed', error);
      toast.error('Could not save the dirty linen correction.');
    } finally {
      setSavingKey(null);
    }
  };

  const exportCsv = () => {
    if (!dateRange?.from) return;
    const startDate = getLocalDateString(dateRange.from);
    const endDate = getLocalDateString(dateRange.to || dateRange.from);
    const lines = [
      ['Date', 'Housekeeper', 'Room', ...linenItems.map(item => item.display_name), 'Total'].map(csvCell).join(','),
      ...sessions.map(session => [
        session.workDate,
        session.housekeeperName,
        session.roomNumber,
        ...linenItems.map(item => session.items.find(entry => entry.item.id === item.id)?.count || 0),
        session.total,
      ].map(csvCell).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `dirty-linen-${startDate}-to-${endDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const renderSessionEditor = (session: RoomSession) => {
    const changed = session.items.some(entry =>
      (draftCounts[draftKey(session, entry.item.id)] ?? entry.count) !== entry.count,
    );
    const approved = !!session.assignment?.supervisor_approved;

    return (
      <Card key={session.key} className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold flex items-center gap-2"><DoorOpen className="h-4 w-4" />Room {session.roomNumber}</p>
            <p className="text-xs text-muted-foreground mt-1">{session.workDate} · {session.housekeeperName}</p>
          </div>
          <Badge variant={approved ? 'secondary' : 'outline'}>{approved ? 'Supervisor approved' : 'Pending approval'}</Badge>
        </div>

        <div className="grid gap-2">
          {session.items.map(entry => {
            const key = draftKey(session, entry.item.id);
            const value = draftCounts[key] ?? entry.count;
            return (
              <div key={entry.item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border p-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{translateLinenItem(entry.item.display_name, t)}</p>
                  {entry.rows.length > 1 && <p className="text-[10px] text-amber-600">Duplicate records will be consolidated on save.</p>}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={!canCorrect || savingKey === session.key || value <= 0} onClick={() => setDraft(session, entry.item.id, value - 1)}>
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                  <Input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={value}
                    disabled={!canCorrect || savingKey === session.key}
                    onChange={event => setDraft(session, entry.item.id, Number(event.target.value))}
                    className="h-8 w-16 text-center px-1 tabular-nums"
                  />
                  <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={!canCorrect || savingKey === session.key} onClick={() => setDraft(session, entry.item.id, value + 1)}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <div className="text-xs text-muted-foreground">
            {session.assignment?.completed_at ? `Cleaning finished ${formatDateTime(session.assignment.completed_at)}` : 'Cleaning not completed yet'}
          </div>
          {canCorrect && (
            <Button size="sm" disabled={!changed || savingKey === session.key} onClick={() => void saveSession(session)}>
              <Save className="h-4 w-4 mr-1.5" />{savingKey === session.key ? 'Saving…' : 'Save correction'}
            </Button>
          )}
        </div>
      </Card>
    );
  };

  const housekeeperAudit = useMemo(
    () => auditRows.filter(row => row.housekeeper_id === selectedHousekeeperId).slice(0, 12),
    [auditRows, selectedHousekeeperId],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">{t('linen.management')}</h2>
          <p className="text-muted-foreground">Housekeeper-by-housekeeper collection control with live room detail and manager corrections.</p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={!sessions.length}>
          <Download className="h-4 w-4 mr-2" />{t('linen.exportCsv')}
        </Button>
      </div>

      <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />

      <Card className="p-4 sm:p-6 overflow-hidden">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h3 className="font-bold text-lg">Vendor collection summary</h3>
            <p className="text-sm text-muted-foreground">Same housekeeper and linen-item order used for the vendor summary.</p>
          </div>
          <Badge variant="secondary">{totalCollected} total</Badge>
        </div>
        <div className="w-full overflow-x-auto rounded-md border">
          <table className="w-full min-w-[760px] table-fixed border-collapse">
            <colgroup>
              <col className="w-[12%]" />
              {linenItems.map(item => <col key={item.id} />)}
              <col className="w-[7%]" />
            </colgroup>
            <thead>
              <tr className="bg-muted/80">
                <th className="border-r border-b px-2 py-2 text-left text-[10px] xl:text-xs font-bold leading-tight break-words [hyphens:auto]">
                  {t('linen.housekeepers')}
                </th>
                {linenItems.map(item => {
                  const label = translateLinenItem(item.display_name, t);
                  return (
                    <th key={item.id} title={label} className="border-r border-b px-1 py-2 text-center font-bold text-[9px] lg:text-[10px] xl:text-xs leading-[1.15] whitespace-normal break-words [hyphens:auto] align-middle">
                      {label}
                    </th>
                  );
                })}
                <th className="border-b px-1 py-2 text-center font-bold text-[10px] xl:text-xs leading-tight bg-primary/10 break-words">
                  {t('linen.total').toUpperCase()}
                </th>
              </tr>
            </thead>
            <tbody>
              {!housekeepers.length ? (
                <tr>
                  <td colSpan={linenItems.length + 2} className="p-8 text-center text-muted-foreground">
                    {loading ? 'Loading…' : t('linen.noData')}
                  </td>
                </tr>
              ) : (
                <>
                  {housekeepers.map(housekeeper => (
                    <tr key={housekeeper.id} className="even:bg-muted/20 hover:bg-accent/30 transition-colors">
                      <td title={housekeeper.name} className="border-r border-b px-2 py-2 text-xs lg:text-sm font-medium leading-tight break-words [hyphens:auto]">
                        {housekeeper.name}
                      </td>
                      {linenItems.map(item => (
                        <td key={item.id} className="border-r border-b px-1 py-2 text-center text-xs lg:text-sm tabular-nums">
                          {housekeeper.items[item.name] || 0}
                        </td>
                      ))}
                      <td className="border-b px-1 py-2 text-center text-xs lg:text-sm font-bold tabular-nums bg-primary/5">
                        {housekeeper.total}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-accent/80 font-bold">
                    <td className="border-r px-2 py-2 text-xs lg:text-sm leading-tight break-words">
                      {t('linen.total').toUpperCase()}
                    </td>
                    {linenItems.map(item => (
                      <td key={item.id} className="border-r px-1 py-2 text-center text-xs lg:text-sm tabular-nums">
                        {vendorItemTotals[item.name] || 0}
                      </td>
                    ))}
                    <td className="px-1 py-2 text-center bg-primary/10 text-sm lg:text-base tabular-nums">
                      {totalCollected}
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4"><p className="text-xs text-muted-foreground">Room linen</p><p className="text-2xl font-bold mt-1">{totalCollected}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Housekeepers</p><p className="text-2xl font-bold mt-1">{housekeepers.length}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Rooms / cleaning sessions</p><p className="text-2xl font-bold mt-1">{sessions.length}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Public-area towels</p><p className="text-2xl font-bold mt-1">{publicTotal}</p></Card>
      </div>

      <Card className="p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="font-bold text-lg flex items-center gap-2"><UserRound className="h-5 w-5" />Housekeepers</h3>
            <p className="text-sm text-muted-foreground">Open a housekeeper to see exactly what was collected from each room and correct mistakes.</p>
          </div>
          {loading && <Badge variant="outline">Updating…</Badge>}
        </div>

        {!housekeepers.length ? (
          <div className="py-10 text-center text-muted-foreground">{loading ? 'Loading…' : t('linen.noData')}</div>
        ) : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {housekeepers.map(housekeeper => (
              <button
                type="button"
                key={housekeeper.id}
                onClick={() => setSelectedHousekeeperId(housekeeper.id)}
                className="text-left rounded-xl border bg-card p-4 hover:border-primary/50 hover:bg-accent/20 transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{housekeeper.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{housekeeper.roomCount} room session{housekeeper.roomCount === 1 ? '' : 's'}</p>
                  </div>
                  <Badge>{housekeeper.total}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {linenItems.filter(item => (housekeeper.items[item.name] || 0) > 0).slice(0, 5).map(item => (
                    <span key={item.id} className="rounded-full bg-muted px-2 py-1 text-[11px]">
                      {translateLinenItem(item.display_name, t)} <b>{housekeeper.items[item.name]}</b>
                    </span>
                  ))}
                  {housekeeper.total === 0 && <span className="text-xs text-muted-foreground">No linen recorded yet — manager can add it.</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4 sm:p-6">
        <div className="mb-4">
          <h3 className="font-bold text-lg flex items-center gap-2"><DoorOpen className="h-5 w-5" />Room overview</h3>
          <p className="text-sm text-muted-foreground">Open a room to review every housekeeper cleaning session for the selected period.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {rooms.map(room => {
            const total = roomTotals.get(room.id) || 0;
            return (
              <Button key={room.id} size="sm" variant={total ? 'outline' : 'ghost'} className={total ? 'border-primary/40 bg-primary/5' : 'text-muted-foreground bg-muted/30'} onClick={() => setSelectedRoomId(room.id)}>
                {room.room_number}{total > 0 && <Badge className="ml-2 h-5 px-1.5">{total}</Badge>}
              </Button>
            );
          })}
        </div>
      </Card>

      <Card className="p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="font-bold text-lg flex items-center gap-2"><Waves className="h-5 w-5" />Public area towels</h3>
            <p className="text-sm text-muted-foreground">Gym, sauna and jacuzzi remain separate from guest-room linen totals.</p>
          </div>
          <Badge variant="secondary">{publicTotal}</Badge>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          {PUBLIC_AREAS.map(area => {
            const areaRows = publicCounts.filter(row => row.area_type === area.key);
            const areaTotal = areaRows.reduce((sum, row) => sum + row.count, 0);
            return (
              <Card key={area.key} className="p-3 bg-muted/20">
                <div className="flex justify-between items-center"><p className="font-semibold">{area.label}</p><Badge variant="outline">{areaTotal}</Badge></div>
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {towelItems.map(item => {
                    const itemTotal = areaRows.filter(row => row.linen_item_id === item.id).reduce((sum, row) => sum + row.count, 0);
                    return <div key={item.id} className="flex justify-between gap-2"><span>{translateLinenItem(item.display_name, t)}</span><b className="text-foreground">{itemTotal}</b></div>;
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      </Card>

      <Dialog open={!!selectedHousekeeperId} onOpenChange={open => { if (!open) setSelectedHousekeeperId(null); }}>
        <DialogContent className="w-[96vw] max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><UserRound className="h-5 w-5" />{selectedHousekeeperId ? displayPerson(selectedHousekeeperId) : 'Housekeeper'} · dirty linen</DialogTitle>
          </DialogHeader>
          {canCorrect && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
              Manager correction mode is active. Set the correct quantity for a room and save; zero removes the incorrect linen record. Changes synchronize back to the overall totals automatically.
            </div>
          )}
          <div className="space-y-3">
            {selectedHousekeeperSessions.map(renderSessionEditor)}
          </div>
          <div className="pt-2">
            <h4 className="font-semibold text-sm flex items-center gap-2 mb-2"><History className="h-4 w-4" />Recent correction history</h4>
            {!housekeeperAudit.length ? (
              <p className="text-xs text-muted-foreground">No correction history recorded for this selected period.</p>
            ) : (
              <div className="space-y-1.5">
                {housekeeperAudit.map(row => (
                  <div key={row.id} className="rounded-md border px-3 py-2 text-xs flex items-start justify-between gap-3">
                    <div>
                      <p><b>Room {row.room_number || roomById.get(row.room_id)?.room_number || '—'}</b> · {row.linen_item_name || itemById.get(row.linen_item_id)?.display_name || 'Linen'} · {row.old_count ?? 0} → {row.new_count ?? 0}</p>
                      <p className="text-muted-foreground mt-0.5">{row.changed_by_name || 'User'} · {formatDateTime(row.created_at)}</p>
                    </div>
                    <Badge variant="outline" className="text-[10px]">{row.action.toLowerCase()}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedRoomId} onOpenChange={open => { if (!open) setSelectedRoomId(null); }}>
        <DialogContent className="w-[96vw] max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><DoorOpen className="h-5 w-5" />Room {selectedRoomId ? roomById.get(selectedRoomId)?.room_number : ''}</DialogTitle>
          </DialogHeader>
          {!selectedRoomSessions.length ? (
            <div className="py-10 text-center text-muted-foreground"><Shirt className="h-8 w-8 mx-auto mb-2" />No linen or cleaning assignment in this period.</div>
          ) : (
            <div className="space-y-3">{selectedRoomSessions.map(renderSessionEditor)}</div>
          )}
          {selectedRoomSessions.some(session => session.assignment?.supervisor_approved) && (
            <div className="text-xs text-muted-foreground flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" />Supervisor approval remains unchanged when linen quantities are corrected.</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
