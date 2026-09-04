import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Shirt, Download, DoorOpen, Clock3, ShieldCheck, UserRound, Waves } from 'lucide-react';
import { DateRangeFilter } from './DateRangeFilter';
import { toast } from 'sonner';
import { DateRange } from 'react-day-picker';
import { getLocalDateString } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { translateLinenItem } from '@/lib/linen-item-i18n';
import { resolveHotelKeys } from '@/lib/hotelKeys';

interface LinenItem {
  id: string;
  name: string;
  display_name: string;
  sort_order: number;
}

interface RoomRow {
  id: string;
  room_number: string;
  hotel: string;
}

interface LinenCountRow {
  id: string;
  housekeeper_id: string;
  room_id: string;
  assignment_id: string | null;
  linen_item_id: string;
  count: number;
  work_date: string;
  created_at: string;
  updated_at?: string;
}

interface AssignmentRow {
  id: string;
  room_id: string;
  assigned_to: string;
  assignment_date: string;
  completed_at: string | null;
  supervisor_approved: boolean | null;
  supervisor_approved_by: string | null;
  supervisor_approved_at: string | null;
}

interface ProfileRow {
  id: string;
  full_name: string;
  nickname: string | null;
}

interface PublicAreaCountRow {
  id: string;
  housekeeper_id: string;
  task_id: string | null;
  area_type: 'gym' | 'sauna' | 'jacuzzi';
  hotel: string;
  linen_item_id: string;
  count: number;
  work_date: string;
  created_at: string;
  updated_at: string;
}

interface HousekeeperData {
  housekeeper_id: string;
  housekeeper_name: string;
  items: Record<string, number>;
  total: number;
}

interface RoomSession {
  key: string;
  workDate: string;
  housekeeperId: string;
  housekeeperName: string;
  assignment: AssignmentRow | null;
  items: Array<{ item: LinenItem | undefined; count: number }>;
  total: number;
}

const PUBLIC_AREAS: Array<{ key: 'gym' | 'sauna' | 'jacuzzi'; label: string; icon: string }> = [
  { key: 'gym', label: 'Gym', icon: '🏋️' },
  { key: 'sauna', label: 'Sauna', icon: '♨️' },
  { key: 'jacuzzi', label: 'Jacuzzi', icon: '🫧' },
];

const csvCell = (value: unknown) => {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const naturalRoomSort = (a: RoomRow, b: RoomRow) =>
  a.room_number.localeCompare(b.room_number, undefined, { numeric: true, sensitivity: 'base' });

export function SimplifiedDirtyLinenManagement() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [isNarrow, setIsNarrow] = useState<boolean>(
    typeof window !== 'undefined' ? window.innerWidth < 1024 : false,
  );
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(),
    to: new Date(),
  });
  const [allLinenItems, setAllLinenItems] = useState<LinenItem[]>([]);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [roomCounts, setRoomCounts] = useState<LinenCountRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [publicCounts, setPublicCounts] = useState<PublicAreaCountRow[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setIsNarrow(window.innerWidth < 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const fetchLinenItems = async () => {
      const { data, error } = await supabase
        .from('dirty_linen_items')
        .select('id, name, display_name, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (error) {
        console.error('Error fetching linen items:', error);
        return;
      }
      setAllLinenItems((data || []) as LinenItem[]);
    };
    void fetchLinenItems();
  }, []);

  const fetchData = useCallback(async () => {
    if (!dateRange?.from || !profile?.assigned_hotel) {
      setRooms([]);
      setRoomCounts([]);
      setAssignments([]);
      setProfiles([]);
      setPublicCounts([]);
      return;
    }

    const startDate = getLocalDateString(dateRange.from);
    const endDate = getLocalDateString(dateRange.to || dateRange.from);
    setLoadingDetails(true);

    try {
      const hotelKeys = await resolveHotelKeys(profile.assigned_hotel);
      if (hotelKeys.length === 0) return;

      const { data: roomRows, error: roomError } = await supabase
        .from('rooms')
        .select('id, room_number, hotel')
        .in('hotel', hotelKeys)
        .order('room_number', { ascending: true });
      if (roomError) throw roomError;

      const hotelRooms = ((roomRows || []) as RoomRow[]).sort(naturalRoomSort);
      const roomIds = hotelRooms.map(room => room.id);

      let countRows: LinenCountRow[] = [];
      let assignmentRows: AssignmentRow[] = [];

      if (roomIds.length > 0) {
        const { data: countsData, error: countsError } = await supabase
          .from('dirty_linen_counts')
          .select('id, housekeeper_id, room_id, assignment_id, linen_item_id, count, work_date, created_at, updated_at')
          .in('room_id', roomIds)
          .gte('work_date', startDate)
          .lte('work_date', endDate)
          .gt('count', 0);
        if (countsError) throw countsError;
        countRows = (countsData || []) as LinenCountRow[];

        const { data: assignmentData, error: assignmentError } = await supabase
          .from('room_assignments')
          .select('id, room_id, assigned_to, assignment_date, completed_at, supervisor_approved, supervisor_approved_by, supervisor_approved_at')
          .in('room_id', roomIds)
          .gte('assignment_date', startDate)
          .lte('assignment_date', endDate);
        if (assignmentError) throw assignmentError;
        assignmentRows = (assignmentData || []) as AssignmentRow[];
      }

      const { data: publicData, error: publicError } = await (supabase as any)
        .from('dirty_linen_public_area_counts')
        .select('id, housekeeper_id, task_id, area_type, hotel, linen_item_id, count, work_date, created_at, updated_at')
        .in('hotel', hotelKeys)
        .gte('work_date', startDate)
        .lte('work_date', endDate)
        .gt('count', 0);
      if (publicError) throw publicError;
      const publicRows = (publicData || []) as PublicAreaCountRow[];

      const profileIds = new Set<string>();
      countRows.forEach(row => profileIds.add(row.housekeeper_id));
      publicRows.forEach(row => profileIds.add(row.housekeeper_id));
      assignmentRows.forEach(row => {
        if (row.assigned_to) profileIds.add(row.assigned_to);
        if (row.supervisor_approved_by) profileIds.add(row.supervisor_approved_by);
      });

      let profileRows: ProfileRow[] = [];
      if (profileIds.size > 0) {
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('id, full_name, nickname')
          .in('id', Array.from(profileIds));
        if (profileError) throw profileError;
        profileRows = (profileData || []) as ProfileRow[];
      }

      setRooms(hotelRooms);
      setRoomCounts(countRows);
      setAssignments(assignmentRows);
      setProfiles(profileRows);
      setPublicCounts(publicRows);
    } catch (error) {
      console.error('Error fetching dirty linen report:', error);
      toast.error(t('common.error'));
    } finally {
      setLoadingDetails(false);
    }
  }, [dateRange?.from, dateRange?.to, profile?.assigned_hotel, t]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!profile?.id || !dateRange?.from) return;
    const channel = (supabase as any)
      .channel(`dirty-linen-management-live-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dirty_linen_counts' }, () => { void fetchData(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_assignments' }, () => { void fetchData(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dirty_linen_public_area_counts' }, () => { void fetchData(); })
      .subscribe();

    return () => { (supabase as any).removeChannel(channel); };
  }, [profile?.id, fetchData, dateRange?.from]);

  const itemById = useMemo(
    () => new Map(allLinenItems.map(item => [item.id, item])),
    [allLinenItems],
  );

  const profileById = useMemo(
    () => new Map(profiles.map(person => [person.id, person])),
    [profiles],
  );

  const assignmentById = useMemo(
    () => new Map(assignments.map(assignment => [assignment.id, assignment])),
    [assignments],
  );

  const assignmentByFallbackKey = useMemo(() => {
    const map = new Map<string, AssignmentRow>();
    assignments.forEach(assignment => {
      map.set(`${assignment.room_id}|${assignment.assigned_to}|${assignment.assignment_date}`, assignment);
    });
    return map;
  }, [assignments]);

  const displayPerson = useCallback((id?: string | null) => {
    if (!id) return '—';
    const person = profileById.get(id);
    return person?.nickname || person?.full_name || 'Unknown user';
  }, [profileById]);

  const housekeeperData = useMemo<HousekeeperData[]>(() => {
    const map = new Map<string, { items: Record<string, number>; total: number }>();
    roomCounts.forEach(row => {
      const item = itemById.get(row.linen_item_id);
      if (!item) return;
      if (!map.has(row.housekeeper_id)) map.set(row.housekeeper_id, { items: {}, total: 0 });
      const target = map.get(row.housekeeper_id)!;
      target.items[item.name] = (target.items[item.name] || 0) + row.count;
      target.total += row.count;
    });

    return Array.from(map.entries())
      .map(([housekeeper_id, data]) => ({
        housekeeper_id,
        housekeeper_name: displayPerson(housekeeper_id),
        items: data.items,
        total: data.total,
      }))
      .sort((a, b) => a.housekeeper_name.localeCompare(b.housekeeper_name));
  }, [roomCounts, itemById, displayPerson]);

  const itemTotals = useMemo(() => {
    const totals = new Map<string, number>();
    allLinenItems.forEach(item => totals.set(item.name, 0));
    roomCounts.forEach(row => {
      const item = itemById.get(row.linen_item_id);
      if (!item) return;
      totals.set(item.name, (totals.get(item.name) || 0) + row.count);
    });
    return totals;
  }, [allLinenItems, roomCounts, itemById]);

  const roomGrandTotal = useMemo(
    () => roomCounts.reduce((sum, row) => sum + row.count, 0),
    [roomCounts],
  );

  const roomTotals = useMemo(() => {
    const map = new Map<string, number>();
    roomCounts.forEach(row => map.set(row.room_id, (map.get(row.room_id) || 0) + row.count));
    return map;
  }, [roomCounts]);

  const towelItems = useMemo(
    () => allLinenItems.filter(item => item.name.includes('towel')),
    [allLinenItems],
  );

  const publicBreakdown = useMemo(() => {
    const map = new Map<string, Map<string, Map<string, number>>>();
    publicCounts.forEach(row => {
      if (!map.has(row.housekeeper_id)) map.set(row.housekeeper_id, new Map());
      const byArea = map.get(row.housekeeper_id)!;
      if (!byArea.has(row.area_type)) byArea.set(row.area_type, new Map());
      const byItem = byArea.get(row.area_type)!;
      byItem.set(row.linen_item_id, (byItem.get(row.linen_item_id) || 0) + row.count);
    });
    return map;
  }, [publicCounts]);

  const publicRows = useMemo(() => {
    return Array.from(publicBreakdown.keys())
      .map(housekeeperId => ({
        housekeeperId,
        name: displayPerson(housekeeperId),
        total: publicCounts
          .filter(row => row.housekeeper_id === housekeeperId)
          .reduce((sum, row) => sum + row.count, 0),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [publicBreakdown, publicCounts, displayPerson]);

  const publicGrandTotal = useMemo(
    () => publicCounts.reduce((sum, row) => sum + row.count, 0),
    [publicCounts],
  );

  const allHousekeeperCount = useMemo(() => {
    const ids = new Set<string>();
    roomCounts.forEach(row => ids.add(row.housekeeper_id));
    publicCounts.forEach(row => ids.add(row.housekeeper_id));
    return ids.size;
  }, [roomCounts, publicCounts]);

  const overallTotal = roomGrandTotal + publicGrandTotal;

  const getAreaItemCount = (housekeeperId: string, area: string, itemId: string) =>
    publicBreakdown.get(housekeeperId)?.get(area)?.get(itemId) || 0;

  const getAreaTotal = (housekeeperId: string, area: string) => {
    const itemMap = publicBreakdown.get(housekeeperId)?.get(area);
    if (!itemMap) return 0;
    return Array.from(itemMap.values()).reduce((sum, count) => sum + count, 0);
  };

  const getAssignmentForCount = useCallback((row: LinenCountRow) => {
    if (row.assignment_id && assignmentById.has(row.assignment_id)) {
      return assignmentById.get(row.assignment_id)!;
    }
    return assignmentByFallbackKey.get(`${row.room_id}|${row.housekeeper_id}|${row.work_date}`) || null;
  }, [assignmentById, assignmentByFallbackKey]);

  const getRoomSessions = useCallback((roomId: string): RoomSession[] => {
    const map = new Map<string, RoomSession>();
    roomCounts.filter(row => row.room_id === roomId).forEach(row => {
      const assignment = getAssignmentForCount(row);
      const key = assignment?.id || `${row.work_date}|${row.housekeeper_id}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          workDate: row.work_date,
          housekeeperId: row.housekeeper_id,
          housekeeperName: displayPerson(row.housekeeper_id),
          assignment,
          items: [],
          total: 0,
        });
      }
      const session = map.get(key)!;
      const existing = session.items.find(entry => entry.item?.id === row.linen_item_id);
      if (existing) existing.count += row.count;
      else session.items.push({ item: itemById.get(row.linen_item_id), count: row.count });
      session.total += row.count;
    });

    return Array.from(map.values()).sort((a, b) => {
      const aTime = a.assignment?.completed_at || `${a.workDate}T00:00:00`;
      const bTime = b.assignment?.completed_at || `${b.workDate}T00:00:00`;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });
  }, [roomCounts, getAssignmentForCount, displayPerson, itemById]);

  const selectedRoom = rooms.find(room => room.id === selectedRoomId) || null;
  const selectedRoomSessions = selectedRoom ? getRoomSessions(selectedRoom.id) : [];

  const exportToCSV = () => {
    if (!dateRange?.from) return;
    const startDate = getLocalDateString(dateRange.from);
    const endDate = getLocalDateString(dateRange.to || dateRange.from);
    const lines: string[] = [];

    lines.push(csvCell('ROOM LINEN SUMMARY'));
    lines.push([
      csvCell(t('linen.housekeepers')),
      ...allLinenItems.map(item => csvCell(item.display_name)),
      csvCell(t('linen.total')),
    ].join(','));
    housekeeperData.forEach(hk => {
      lines.push([
        csvCell(hk.housekeeper_name),
        ...allLinenItems.map(item => csvCell(hk.items[item.name] || 0)),
        csvCell(hk.total),
      ].join(','));
    });
    lines.push([
      csvCell(t('linen.total').toUpperCase()),
      ...allLinenItems.map(item => csvCell(itemTotals.get(item.name) || 0)),
      csvCell(roomGrandTotal),
    ].join(','));

    lines.push('');
    lines.push(csvCell('ROOM DETAIL'));
    lines.push([
      'Date', 'Room', 'Housekeeper', 'Cleaning finished', 'Approved by', 'Approved at', 'Items', 'Total',
    ].map(csvCell).join(','));
    rooms.forEach(room => {
      getRoomSessions(room.id).forEach(session => {
        const assignment = session.assignment;
        const itemText = session.items
          .map(entry => `${entry.item?.display_name || 'Unknown'}: ${entry.count}`)
          .join('; ');
        lines.push([
          csvCell(session.workDate),
          csvCell(room.room_number),
          csvCell(session.housekeeperName),
          csvCell(formatDateTime(assignment?.completed_at)),
          csvCell(assignment?.supervisor_approved ? displayPerson(assignment.supervisor_approved_by) : 'Pending approval'),
          csvCell(assignment?.supervisor_approved ? formatDateTime(assignment.supervisor_approved_at) : '—'),
          csvCell(itemText),
          csvCell(session.total),
        ].join(','));
      });
    });

    lines.push('');
    lines.push(csvCell('PUBLIC AREA TOWELS'));
    const publicHeaders = ['Housekeeper'];
    PUBLIC_AREAS.forEach(area => {
      towelItems.forEach(item => publicHeaders.push(`${area.label} - ${item.display_name}`));
      publicHeaders.push(`${area.label} - Total`);
    });
    publicHeaders.push('Total');
    lines.push(publicHeaders.map(csvCell).join(','));
    publicRows.forEach(row => {
      const values: unknown[] = [row.name];
      PUBLIC_AREAS.forEach(area => {
        towelItems.forEach(item => values.push(getAreaItemCount(row.housekeeperId, area.key, item.id)));
        values.push(getAreaTotal(row.housekeeperId, area.key));
      });
      values.push(row.total);
      lines.push(values.map(csvCell).join(','));
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dirty-linen-${startDate}-to-${endDate}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const renderMobileSummary = () => (
    <div className="space-y-3">
      {housekeeperData.length === 0 ? (
        <div className="p-8 text-center text-muted-foreground">{t('linen.noData')}</div>
      ) : (
        <>
          {housekeeperData.map(hk => (
            <Card key={hk.housekeeper_id} className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-sm">{hk.housekeeper_name}</h4>
                <Badge variant="default" className="text-xs">{hk.total} total</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {allLinenItems.map(item => {
                  const count = hk.items[item.name] || 0;
                  return (
                    <div key={item.id} className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm">
                      <span className="text-muted-foreground truncate mr-2">{translateLinenItem(item.display_name, t)}</span>
                      <span className={`font-semibold ${count > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>{count}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
          <Card className="p-4 border-primary/30 bg-primary/5">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-bold text-sm">{t('linen.total').toUpperCase()}</h4>
              <Badge variant="default" className="text-xs bg-primary">{roomGrandTotal}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {allLinenItems.map(item => (
                <div key={item.id} className="flex items-center justify-between p-2 bg-primary/10 rounded text-sm">
                  <span className="text-muted-foreground truncate mr-2">{translateLinenItem(item.display_name, t)}</span>
                  <span className="font-bold">{itemTotals.get(item.name) || 0}</span>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );

  const renderDesktopSummary = () => (
    <div className="w-full overflow-hidden rounded-md border">
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col className="w-[12%]" />
          {allLinenItems.map(item => <col key={item.id} />)}
          <col className="w-[7%]" />
        </colgroup>
        <thead>
          <tr className="bg-muted/80">
            <th className="border-r border-b px-2 py-2 text-left text-[10px] xl:text-xs font-bold leading-tight break-words [hyphens:auto]">
              {t('linen.housekeepers')}
            </th>
            {allLinenItems.map(item => {
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
          {housekeeperData.length === 0 ? (
            <tr><td colSpan={allLinenItems.length + 2} className="p-8 text-center text-muted-foreground">{t('linen.noData')}</td></tr>
          ) : (
            <>
              {housekeeperData.map(hk => (
                <tr key={hk.housekeeper_id} className="even:bg-muted/20 hover:bg-accent/30 transition-colors">
                  <td title={hk.housekeeper_name} className="border-r border-b px-2 py-2 text-xs lg:text-sm font-medium leading-tight break-words [hyphens:auto]">
                    {hk.housekeeper_name}
                  </td>
                  {allLinenItems.map(item => (
                    <td key={item.id} className="border-r border-b px-1 py-2 text-center text-xs lg:text-sm tabular-nums">
                      {hk.items[item.name] || 0}
                    </td>
                  ))}
                  <td className="border-b px-1 py-2 text-center text-xs lg:text-sm font-bold tabular-nums bg-primary/5">{hk.total}</td>
                </tr>
              ))}
              <tr className="bg-accent/80 font-bold">
                <td className="border-r px-2 py-2 text-xs lg:text-sm">{t('linen.total').toUpperCase()}</td>
                {allLinenItems.map(item => (
                  <td key={item.id} className="border-r px-1 py-2 text-center text-xs lg:text-sm tabular-nums">{itemTotals.get(item.name) || 0}</td>
                ))}
                <td className="px-1 py-2 text-center bg-primary/10 text-sm lg:text-base tabular-nums">{roomGrandTotal}</td>
              </tr>
            </>
          )}
        </tbody>
      </table>
    </div>
  );

  const renderPublicAreaReport = () => (
    <Card className="p-4 sm:p-6 overflow-hidden">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <div className="flex items-center gap-2">
            <Waves className="h-5 w-5 text-primary" />
            <h3 className="font-bold text-lg">Public area towels</h3>
          </div>
          <p className="text-sm text-muted-foreground mt-1">Gym, sauna and jacuzzi collections are kept separate from guest rooms.</p>
        </div>
        <Badge variant="secondary" className="text-sm">{publicGrandTotal} towels</Badge>
      </div>

      {isMobile || isNarrow ? (
        <div className="space-y-3">
          {PUBLIC_AREAS.map(area => {
            const areaTotal = publicCounts.filter(row => row.area_type === area.key).reduce((sum, row) => sum + row.count, 0);
            return (
              <Card key={area.key} className="p-3 bg-muted/20">
                <div className="flex items-center justify-between mb-3">
                  <div className="font-semibold flex items-center gap-2"><span>{area.icon}</span>{area.label}</div>
                  <Badge variant="outline">{areaTotal}</Badge>
                </div>
                {publicRows.filter(row => getAreaTotal(row.housekeeperId, area.key) > 0).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No towels recorded.</p>
                ) : (
                  <div className="space-y-2">
                    {publicRows.filter(row => getAreaTotal(row.housekeeperId, area.key) > 0).map(row => (
                      <div key={row.housekeeperId} className="rounded-md bg-background border p-2">
                        <div className="flex justify-between gap-2 text-sm font-medium mb-1">
                          <span>{row.name}</span><span>{getAreaTotal(row.housekeeperId, area.key)}</span>
                        </div>
                        <div className="flex gap-2 flex-wrap text-xs text-muted-foreground">
                          {towelItems.map(item => (
                            <span key={item.id}>{translateLinenItem(item.display_name, t)}: <b className="text-foreground">{getAreaItemCount(row.housekeeperId, area.key, item.id)}</b></span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr className="bg-muted/80 text-xs">
                <th className="w-[22%] text-left px-3 py-2 border-r">Housekeeper</th>
                {PUBLIC_AREAS.map(area => <th key={area.key} className="px-2 py-2 border-r last:border-r-0">{area.icon} {area.label}</th>)}
                <th className="w-[10%] px-2 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {publicRows.length === 0 ? (
                <tr><td colSpan={5} className="py-8 text-center text-sm text-muted-foreground">No public-area towels recorded for this period.</td></tr>
              ) : publicRows.map(row => (
                <tr key={row.housekeeperId} className="border-t even:bg-muted/20">
                  <td className="px-3 py-2 text-sm font-medium border-r">{row.name}</td>
                  {PUBLIC_AREAS.map(area => (
                    <td key={area.key} className="px-2 py-2 text-center border-r align-middle">
                      {getAreaTotal(row.housekeeperId, area.key) === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="text-[11px] leading-relaxed">
                          {towelItems.map(item => (
                            <span key={item.id} className="inline-block mr-2 last:mr-0">
                              {item.name === 'small_towel' ? 'Small' : item.name === 'big_towel' ? 'Big' : item.display_name}: <b>{getAreaItemCount(row.housekeeperId, area.key, item.id)}</b>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-center font-bold tabular-nums">{row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold">{t('linen.management')}</h2>
          <p className="text-muted-foreground">{t('linen.collectionSummary')} · live room and public-area detail</p>
        </div>
        <Button onClick={exportToCSV} variant="outline" disabled={overallTotal === 0}>
          <Download className="h-4 w-4 mr-2" />
          <span className="truncate">{t('linen.exportCsv')}</span>
        </Button>
      </div>

      <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />

      <Card className="p-4 sm:p-6 overflow-hidden">
        <div className="mb-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="flex items-center gap-3 p-3 sm:p-4 bg-primary/5 rounded-lg">
            <Shirt className="h-7 w-7 text-primary shrink-0" />
            <div><p className="text-xs text-muted-foreground">Total collected</p><p className="text-xl sm:text-2xl font-bold">{overallTotal}</p></div>
          </div>
          <div className="p-3 sm:p-4 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground">Guest rooms</p><p className="text-xl sm:text-2xl font-bold">{roomGrandTotal}</p>
          </div>
          <div className="p-3 sm:p-4 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground">Public areas</p><p className="text-xl sm:text-2xl font-bold">{publicGrandTotal}</p>
          </div>
          <div className="p-3 sm:p-4 bg-secondary/50 rounded-lg flex items-center">
            <Badge variant="secondary" className="text-sm px-3 py-2">{allHousekeeperCount} housekeepers</Badge>
          </div>
        </div>
        {(isMobile || isNarrow) ? renderMobileSummary() : renderDesktopSummary()}
      </Card>

      <Card className="p-4 sm:p-6 overflow-hidden">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div>
            <div className="flex items-center gap-2">
              <DoorOpen className="h-5 w-5 text-primary" />
              <h3 className="font-bold text-lg">Rooms</h3>
            </div>
            <p className="text-sm text-muted-foreground mt-1">Tap any room to see exactly who collected each item, when cleaning finished, and who approved it.</p>
          </div>
          {loadingDetails && <Badge variant="outline">Updating…</Badge>}
        </div>

        {rooms.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No rooms found for this property.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {rooms.map(room => {
              const total = roomTotals.get(room.id) || 0;
              return (
                <Button
                  key={room.id}
                  variant={total > 0 ? 'outline' : 'ghost'}
                  size="sm"
                  className={`h-9 gap-1.5 ${total > 0 ? 'border-primary/40 bg-primary/5' : 'text-muted-foreground bg-muted/30'}`}
                  onClick={() => setSelectedRoomId(room.id)}
                >
                  <span className="font-semibold">{room.room_number}</span>
                  {total > 0 && <Badge className="h-5 min-w-5 px-1.5 text-[10px]">{total}</Badge>}
                </Button>
              );
            })}
          </div>
        )}
      </Card>

      {renderPublicAreaReport()}

      <Dialog open={!!selectedRoomId} onOpenChange={open => { if (!open) setSelectedRoomId(null); }}>
        <DialogContent className="w-[96vw] max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DoorOpen className="h-5 w-5" /> Room {selectedRoom?.room_number || ''}
            </DialogTitle>
          </DialogHeader>

          {!selectedRoom || selectedRoomSessions.length === 0 ? (
            <div className="py-10 text-center">
              <Shirt className="h-9 w-9 mx-auto text-muted-foreground mb-3" />
              <p className="font-medium">No dirty linen recorded</p>
              <p className="text-sm text-muted-foreground mt-1">There is no collection for this room in the selected date range.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {selectedRoomSessions.map(session => {
                const assignment = session.assignment;
                const approved = !!assignment?.supervisor_approved;
                return (
                  <Card key={session.key} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold flex items-center gap-1.5"><UserRound className="h-4 w-4" />{session.housekeeperName}</p>
                        <p className="text-xs text-muted-foreground mt-1">{session.workDate}</p>
                      </div>
                      <Badge variant="secondary">{session.total} items</Badge>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md bg-muted/50 p-2.5">
                        <p className="text-muted-foreground flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> Cleaning finished</p>
                        <p className="font-medium mt-1">{assignment?.completed_at ? formatDateTime(assignment.completed_at) : 'Not finished yet'}</p>
                      </div>
                      <div className="rounded-md bg-muted/50 p-2.5">
                        <p className="text-muted-foreground flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Approval</p>
                        <p className="font-medium mt-1">{approved ? displayPerson(assignment?.supervisor_approved_by) : 'Pending approval'}</p>
                        {approved && assignment?.supervisor_approved_at && <p className="text-[10px] text-muted-foreground mt-0.5">{formatDateTime(assignment.supervisor_approved_at)}</p>}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      {session.items
                        .sort((a, b) => (a.item?.sort_order || 999) - (b.item?.sort_order || 999))
                        .map(entry => (
                          <div key={entry.item?.id || 'unknown'} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                            <span>{entry.item ? translateLinenItem(entry.item.display_name, t) : 'Unknown item'}</span>
                            <span className="font-bold tabular-nums">{entry.count}</span>
                          </div>
                        ))}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
