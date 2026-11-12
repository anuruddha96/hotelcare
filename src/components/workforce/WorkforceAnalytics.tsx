import { useEffect, useMemo, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { fetchAllRows, type WorkforceData } from '@/hooks/useWorkforce';
import { formatHours, hotelShort, matchesStaffSearch, pad2, type WorkforceKind } from '@/lib/workforce/model';
import { WORKING_KINDS } from '@/lib/workforce/cellParser';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
type Row = { staff_id: string; work_date: string; kind: WorkforceKind; worked_minutes: number; extra_minutes: number; hotel_id: string | null; status: string };
type GroupBy = 'department' | 'role' | 'hotel' | 'staff';

interface Totals {
  key: string; label: string; people: Set<string>; minutes: number; extra: number; shifts: number; nights: number;
  leave: number; sick: number; unpaid: number; absent: number; drafts: number;
}
const emptyTotals = (key: string, label: string): Totals => ({ key, label, people: new Set(), minutes: 0, extra: 0, shifts: 0, nights: 0, leave: 0, sick: 0, unpaid: 0, absent: 0, drafts: 0 });
function add(t: Totals, r: Row) {
  t.people.add(r.staff_id);
  t.minutes += r.worked_minutes ?? 0;
  if (WORKING_KINDS.has(r.kind)) { t.shifts++; t.extra += r.extra_minutes ?? 0; }
  if (r.kind === 'night') t.nights++;
  if (r.kind === 'leave') t.leave++;
  if (r.kind === 'half_leave') t.leave += 0.5;
  if (r.kind === 'sick') t.sick++;
  if (r.kind === 'unpaid_leave') t.unpaid++;
  if (r.kind === 'absent') t.absent++;
  if (r.status === 'draft') t.drafts++;
}
const sickRate = (t: Totals) => (t.shifts + t.sick ? (100 * t.sick) / (t.shifts + t.sick) : 0);

export function WorkforceAnalytics({ data, year, month }: { data: WorkforceData; year: number; month: number }) {
  const [fromMonth, setFromMonth] = useState(`${year}-${pad2(month)}`);
  const [toMonth, setToMonth] = useState(`${year}-${pad2(month)}`);
  const [groupBy, setGroupBy] = useState<GroupBy>('department');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => { setFromMonth(`${year}-${pad2(month)}`); setToMonth(`${year}-${pad2(month)}`); }, [year, month]);

  const from = `${fromMonth}-01`;
  const [ty, tm] = toMonth.split('-').map(Number);
  const to = new Date(Date.UTC(ty, tm, 0)).toISOString().slice(0, 10);

  useEffect(() => {
    if (from > to) return;
    let cancelled = false;
    setLoading(true);
    fetchAllRows<Row>((a, b) => db.from('workforce_entries').select('staff_id,work_date,kind,worked_minutes,extra_minutes,hotel_id,status')
      .gte('work_date', from).lte('work_date', to).order('work_date').order('staff_id').range(a, b))
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((err) => toast.error(err?.message ?? 'Could not load analytics'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to]);

  const staffById = useMemo(() => new Map(data.staff.map((s) => [s.id, s])), [data.staff]);
  const deptName = useMemo(() => new Map(data.departments.map((d) => [d.id, d.name])), [data.departments]);
  const roleName = useMemo(() => new Map(data.jobRoles.map((r) => [r.id, r.name])), [data.jobRoles]);

  const { total, groups, months } = useMemo(() => {
    const total = emptyTotals('all', 'All');
    const groups = new Map<string, Totals>();
    const months = new Map<string, Totals>();
    for (const r of rows) {
      const s = staffById.get(r.staff_id);
      let key: string, label: string;
      switch (groupBy) {
        case 'department': key = s?.department_id ?? 'none'; label = deptName.get(key) ?? 'No department'; break;
        case 'role': key = s?.job_role_id ?? 'none'; label = roleName.get(key) ?? 'No role'; break;
        case 'hotel': key = r.hotel_id ?? 'company'; label = hotelShort(r.hotel_id); break;
        default: key = r.staff_id; label = s?.full_name ?? 'Unknown';
      }
      if (!groups.has(key)) groups.set(key, emptyTotals(key, label));
      add(groups.get(key)!, r);
      add(total, r);
      const m = r.work_date.slice(0, 7);
      if (!months.has(m)) months.set(m, emptyTotals(m, m));
      add(months.get(m)!, r);
    }
    return { total, groups: [...groups.values()].sort((a, b) => b.minutes - a.minutes), months: [...months.values()].sort((a, b) => a.key.localeCompare(b.key)) };
  }, [rows, groupBy, staffById, deptName, roleName]);

  const visibleGroups = groupBy === 'staff'
    ? groups.filter((g) => { const s = staffById.get(g.key); return matchesStaffSearch([g.label, s?.nickname, deptName.get(s?.department_id ?? ''), roleName.get(s?.job_role_id ?? '')], query); })
    : groups;

  const exportXlsx = async () => {
    const XLSX = await import('xlsx');
    const header = ['Group', 'People', 'Hours', 'Extra hours', 'Shifts', 'Nights', 'Leave days', 'Sick days', 'Sick rate %', 'Unpaid days', 'Unexcused', 'Drafts'];
    const body = visibleGroups.map((g) => [g.label, g.people.size, Math.round(g.minutes / 6) / 10, Math.round(g.extra / 6) / 10, g.shifts, g.nights, g.leave, g.sick, Math.round(sickRate(g) * 10) / 10, g.unpaid, g.absent, g.drafts]);
    if (groupBy === 'staff') {
      header.splice(1, 0, 'Department', 'Role', 'Base hotel', 'Daily hours');
      visibleGroups.forEach((g, i) => { const s = staffById.get(g.key); body[i].splice(1, 0, deptName.get(s?.department_id ?? '') ?? '', roleName.get(s?.job_role_id ?? '') ?? '', hotelShort(s?.hotel_id), s?.daily_hours ?? ''); });
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...body]), 'Summary');
    XLSX.writeFile(wb, `work-hours_${fromMonth}_${toMonth}_${groupBy}.xlsx`);
  };

  const chartData = groups.slice(0, 12).map((g) => ({ name: g.label, hours: Math.round(g.minutes / 60) }));
  const monthData = months.map((m) => ({ name: m.key, hours: Math.round(m.minutes / 60), sick: m.sick, leave: m.leave }));
  const tile = (label: string, value: string, hint?: string) => (
    <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-semibold tabular-nums">{value}</p>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</CardContent></Card>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-xs">From<Input type="month" value={fromMonth} onChange={(e) => e.target.value && setFromMonth(e.target.value)} className="w-40" /></label>
        <label className="space-y-1 text-xs">To<Input type="month" value={toMonth} onChange={(e) => e.target.value && setToMonth(e.target.value)} className="w-40" /></label>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={() => { setFromMonth(`${year}-01`); setToMonth(`${year}-${pad2(month)}`); }}>Year to date</Button>
          <Button variant="outline" size="sm" onClick={() => { const d = new Date(Date.UTC(year, month - 3, 1)); setFromMonth(`${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`); setToMonth(`${year}-${pad2(month)}`); }}>Last 3 months</Button>
        </div>
        <label className="space-y-1 text-xs">Group by
          <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="department">Department</SelectItem><SelectItem value="role">Job role</SelectItem>
              <SelectItem value="hotel">Hotel worked at</SelectItem><SelectItem value="staff">Employee</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <Button variant="outline" className="ml-auto" onClick={() => void exportXlsx()} disabled={!rows.length}><Download className="mr-1 h-4 w-4" />Export for payroll</Button>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tile('People scheduled', String(total.people.size))}
        {tile('Hours', formatHours(total.minutes), 'gross, breaks not deducted')}
        {tile('Avg hours / person', total.people.size ? formatHours(total.minutes / total.people.size) : '0')}
        {tile('Leave days', String(total.leave))}
        {tile('Sick days', String(total.sick), `${sickRate(total).toFixed(1)}% sick rate`)}
        {tile('Night shifts', String(total.nights), total.drafts ? `${total.drafts} draft days` : undefined)}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Hours by {groupBy === 'staff' ? 'employee (top 12)' : groupBy === 'hotel' ? 'hotel' : groupBy}</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip formatter={(v: number) => [`${v} h`, 'Hours']} cursor={{ fill: 'hsl(var(--muted))' }} />
                <Bar dataKey="hours" fill="#2563eb" radius={[0, 4, 4, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Hours per month</CardTitle><CardDescription>Selected period</CardDescription></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthData} margin={{ left: 0, right: 8 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip formatter={(v: number, k: string) => [k === 'hours' ? `${v} h` : `${v} days`, k === 'hours' ? 'Hours' : k]} cursor={{ fill: 'hsl(var(--muted))' }} />
                <Bar dataKey="hours" fill="#2563eb" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base">Breakdown</CardTitle>
          {groupBy === 'staff' && <Input className="max-w-xs" placeholder="Search employee, role, department…" value={query} onChange={(e) => setQuery(e.target.value)} />}
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{groupBy === 'staff' ? 'Employee' : 'Group'}</TableHead>
                {groupBy !== 'staff' && <TableHead className="text-right">People</TableHead>}
                <TableHead className="text-right">Hours</TableHead><TableHead className="text-right">Extra h</TableHead>
                <TableHead className="text-right">Shifts</TableHead><TableHead className="text-right">Nights</TableHead>
                <TableHead className="text-right">Leave</TableHead><TableHead className="text-right">Sick</TableHead>
                <TableHead className="text-right">Sick %</TableHead><TableHead className="text-right">Unpaid</TableHead><TableHead className="text-right">Unexcused</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleGroups.map((g) => (
                <TableRow key={g.key}>
                  <TableCell className="font-medium">{g.label}</TableCell>
                  {groupBy !== 'staff' && <TableCell className="text-right tabular-nums">{g.people.size}</TableCell>}
                  <TableCell className="text-right tabular-nums">{formatHours(g.minutes)}</TableCell>
                  <TableCell className="text-right tabular-nums">{g.extra ? formatHours(g.extra) : ''}</TableCell>
                  <TableCell className="text-right tabular-nums">{g.shifts}</TableCell>
                  <TableCell className="text-right tabular-nums">{g.nights || ''}</TableCell>
                  <TableCell className="text-right tabular-nums">{g.leave || ''}</TableCell>
                  <TableCell className="text-right tabular-nums">{g.sick || ''}</TableCell>
                  <TableCell className="text-right tabular-nums">{g.sick ? sickRate(g).toFixed(1) : ''}</TableCell>
                  <TableCell className="text-right tabular-nums">{g.unpaid || ''}</TableCell>
                  <TableCell className="text-right tabular-nums">{g.absent || ''}</TableCell>
                </TableRow>
              ))}
              {!visibleGroups.length && <TableRow><TableCell colSpan={11} className="py-8 text-center text-muted-foreground">{loading ? 'Loading…' : 'No schedule data in this period.'}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
