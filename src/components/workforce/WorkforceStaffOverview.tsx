import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { WorkforceData } from '@/hooks/useWorkforce';
import { HOTELS, hotelShort, matchesStaffSearch } from '@/lib/workforce/model';
import { WORKING_KINDS, type WorkforceKind } from '@/lib/workforce/cellParser';

type Row = { staff_id: string; work_date: string; kind: WorkforceKind };
const CONTRACT: Record<string, string> = { full_time: 'Full time', part_time: 'Part time', hourly: 'Hourly / casual', trainee: 'Trainee', external: 'External / on call' };

/** Who works where: headcount, contracts, joiners and leavers, leave balances. */
export function WorkforceStaffOverview({ data, rows }: { data: WorkforceData; rows: Row[] }) {
  const [query, setQuery] = useState('');
  const active = data.staff.filter((s) => s.is_active);
  const bases = [...HOTELS.map((h) => h.id), null];
  const deptName = useMemo(() => new Map(data.departments.map((d) => [d.id, d.name])), [data.departments]);
  const roleName = useMemo(() => new Map(data.jobRoles.map((r) => [r.id, r.name])), [data.jobRoles]);

  const matrix = useMemo(() => {
    const rowsOut = data.departments.map((d) => ({
      id: d.id, name: d.name,
      cells: bases.map((b) => active.filter((s) => s.department_id === d.id && (s.hotel_id ?? null) === b).length),
    }));
    const none = active.filter((s) => !s.department_id);
    if (none.length) rowsOut.push({ id: 'none', name: 'No department', cells: bases.map((b) => none.filter((s) => (s.hotel_id ?? null) === b).length) });
    return rowsOut.filter((r) => r.cells.some(Boolean));
  }, [data.departments, active]); // eslint-disable-line react-hooks/exhaustive-deps

  const contracts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of active) m.set(s.employment_type, (m.get(s.employment_type) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [active]);

  // Movement by month: first and last month a person appears in the selected period.
  const movement = useMemo(() => {
    const months = new Map<string, Set<string>>();
    const span = new Map<string, { first: string; last: string }>();
    for (const r of rows) {
      if (!WORKING_KINDS.has(r.kind)) continue;
      const m = r.work_date.slice(0, 7);
      if (!months.has(m)) months.set(m, new Set());
      months.get(m)!.add(r.staff_id);
      const sp = span.get(r.staff_id);
      if (!sp) span.set(r.staff_id, { first: m, last: m });
      else { if (m < sp.first) sp.first = m; if (m > sp.last) sp.last = m; }
    }
    const keys = [...months.keys()].sort();
    const inactive = new Set(data.staff.filter((s) => !s.is_active).map((s) => s.id));
    return keys.map((m, i) => ({
      month: m,
      working: months.get(m)!.size,
      joined: i === 0 ? null : [...span.values()].filter((x) => x.first === m).length,
      left: i === keys.length - 1 ? null : [...span].filter(([id, x]) => x.last === m && inactive.has(id)).length,
    }));
  }, [rows, data.staff]);

  const balances = active
    .filter((s) => s.annual_leave_days != null)
    .map((s) => ({ s, used: data.leaveUsed.get(s.id) ?? 0, left: (s.annual_leave_days ?? 0) - (data.leaveUsed.get(s.id) ?? 0) }))
    .filter(({ s }) => matchesStaffSearch([s.full_name, s.nickname, deptName.get(s.department_id ?? ''), roleName.get(s.job_role_id ?? ''), hotelShort(s.hotel_id)], query))
    .sort((a, b) => b.left - a.left);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Active staff by department and base hotel</CardTitle>
          <CardDescription>{active.length} active employees · {data.staff.length - active.length} former</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Department</TableHead>
                {bases.map((b) => <TableHead key={b ?? 'company'} className="text-right">{hotelShort(b)}</TableHead>)}
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matrix.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  {r.cells.map((n, i) => <TableCell key={i} className="text-right tabular-nums">{n || ''}</TableCell>)}
                  <TableCell className="text-right font-medium tabular-nums">{r.cells.reduce((a, b) => a + b, 0)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-medium">Total</TableCell>
                {bases.map((b, i) => <TableCell key={i} className="text-right font-medium tabular-nums">{matrix.reduce((a, r) => a + r.cells[i], 0) || ''}</TableCell>)}
                <TableCell className="text-right font-semibold tabular-nums">{active.length}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <p className="px-4 py-3 text-xs text-muted-foreground">
            Contracts: {contracts.map(([k, n]) => `${CONTRACT[k] ?? k} ${n}`).join(' · ') || '—'}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Headcount movement</CardTitle>
          <CardDescription>People with at least one working day, and first / last month seen in the selected period</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Month</TableHead><TableHead className="text-right">Working</TableHead><TableHead className="text-right">New</TableHead><TableHead className="text-right">Left</TableHead></TableRow></TableHeader>
            <TableBody>
              {movement.map((m) => (
                <TableRow key={m.month}>
                  <TableCell>{new Date(`${m.month}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.working}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.joined ?? '–'}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.left ?? '–'}</TableCell>
                </TableRow>
              ))}
              {!movement.length && <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">Choose a longer period (e.g. Year to date).</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <div>
            <CardTitle className="text-base">Annual leave balances</CardTitle>
            <CardDescription>Entitlement minus leave taken this calendar year up to the month shown on the Schedule tab</CardDescription>
          </div>
          <Input className="max-w-xs" placeholder="Search employee, department…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </CardHeader>
        <CardContent className="max-h-96 overflow-auto p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Department</TableHead><TableHead>Base</TableHead><TableHead className="text-right">Entitled</TableHead><TableHead className="text-right">Taken</TableHead><TableHead className="text-right">Left</TableHead></TableRow></TableHeader>
            <TableBody>
              {balances.map(({ s, used, left }) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.full_name}</TableCell>
                  <TableCell>{deptName.get(s.department_id ?? '') ?? '—'}</TableCell>
                  <TableCell>{hotelShort(s.hotel_id)}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.annual_leave_days}</TableCell>
                  <TableCell className="text-right tabular-nums">{used}</TableCell>
                  <TableCell className={`text-right font-medium tabular-nums ${left < 0 ? 'text-red-600' : ''}`}>{left}</TableCell>
                </TableRow>
              ))}
              {!balances.length && <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">No leave entitlements recorded yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
