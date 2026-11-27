import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, Loader2, Users, Clock, CalendarDays, Moon, HeartPulse, Timer, BarChart3, CircleAlert, FileClock } from 'lucide-react';
import { WorkforceManagementCharts } from './WorkforceManagementCharts';
import { managementAnalytics, PROPERTY_COLORS } from '@/lib/workforce/managementAnalytics';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { fetchAllRows, type WorkforceData } from '@/hooks/useWorkforce';
import { formatHours, hotelShort, matchesStaffSearch, pad2, type WorkforceKind } from '@/lib/workforce/model';
import { employeeReport, monthsBetween, weekdayCoverage, type EmployeeReportRow, type ReportFlag } from '@/lib/workforce/report';
import { WORKING_KINDS } from '@/lib/workforce/cellParser';
import { isPublicHoliday } from '@/lib/workforce/holidays';
import { WorkforceStaffOverview } from './WorkforceStaffOverview';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
type Row = { staff_id: string; work_date: string; kind: WorkforceKind; worked_minutes: number; extra_minutes: number; hotel_id: string | null; status: string; start_time: string | null; end_time: string | null };
const FLAG_LABEL: Record<ReportFlag, string> = { overtime: 'Overtime', under: 'Under hours', long_run: '7+ days in a row', sick: '3+ sick days', absent: 'Unexcused absence', drafts: 'Not published' };
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const signed = (minutes: number | null) => (minutes == null ? '' : minutes === 0 ? '0' : `${minutes > 0 ? '+' : '−'}${formatHours(Math.abs(minutes))}`);
type GroupBy = 'department' | 'role' | 'hotel' | 'base' | 'contract' | 'staff';
const CONTRACT: Record<string, string> = { full_time: 'Full time', part_time: 'Part time', hourly: 'Hourly / casual', trainee: 'Trainee', external: 'External / on call' };

interface Totals {
  key: string; label: string; people: Set<string>; minutes: number; extra: number; shifts: number; nights: number;
  leave: number; sick: number; unpaid: number; absent: number; drafts: number; holiday: number;
}
const emptyTotals = (key: string, label: string): Totals => ({ key, label, people: new Set(), minutes: 0, extra: 0, shifts: 0, nights: 0, leave: 0, sick: 0, unpaid: 0, absent: 0, drafts: 0, holiday: 0 });
function add(t: Totals, r: Row) {
  t.people.add(r.staff_id);
  t.minutes += r.worked_minutes ?? 0;
  if (WORKING_KINDS.has(r.kind)) { t.shifts++; t.extra += r.extra_minutes ?? 0; if (isPublicHoliday(r.work_date)) t.holiday++; }
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
  const {profile}=useAuth();
  const org=profile?.organization_slug;
  const scope=profile?.id+'|'+org+'|'+profile?.assigned_hotel;
  const [loaded,setRows]=useState<{key:string;rows:Row[]}|null>(null);
  const [loadError,setLoadError]=useState(false);
  const [risk,setRisk]=useState<ReportFlag|null>(null);
  const [refresh,setRefresh]=useState(0);
  const [hotel, setHotel] = useState('all');
  const [department, setDepartment] = useState('all');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [personQuery, setPersonQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => { setFromMonth(`${year}-${pad2(month)}`); setToMonth(`${year}-${pad2(month)}`); }, [year, month]);

  const from = `${fromMonth}-01`;
  const [ty, tm] = toMonth.split('-').map(Number);
  const to = new Date(Date.UTC(ty, tm, 0)).toISOString().slice(0, 10);

  const loadKey=scope+'|'+from+'|'+to+'|'+refresh;
  const allRows=loaded?.key===loadKey?loaded.rows:[];
  useEffect(() => {
    setRows(null);setLoadError(false);
    if (!org || !profile?.id || from > to) {setLoading(false);return;}
    let cancelled = false;
    setLoading(true);
    fetchAllRows<Row>((a, b) => db.from('workforce_entries').select('staff_id,work_date,kind,worked_minutes,extra_minutes,hotel_id,status,start_time,end_time')
      .eq('organization_slug',org).gte('work_date', from).lte('work_date', to).order('work_date').order('staff_id').range(a, b))
      .then((r) => { if (!cancelled) setRows({key:loadKey,rows:r}); })
      .catch((err) => {if(!cancelled){setLoadError(true);toast.error(err?.message ?? 'Could not load analytics');}})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to, org, profile?.id, loadKey]);

  const staffById = useMemo(() => new Map(data.staff.map((s) => [s.id, s])), [data.staff]);
  const deptName = useMemo(() => new Map(data.departments.map((d) => [d.id, d.name])), [data.departments]);
  const roleName = useMemo(() => new Map(data.jobRoles.map((r) => [r.id, r.name])), [data.jobRoles]);

  // The report is for one team when a hotel or department is chosen.
  const inScope = useMemo(() => {
    const ids = new Set<string>();
    for (const s of data.staff) {
      if (hotel !== 'all' && (s.hotel_id ?? 'company') !== hotel) continue;
      if (department !== 'all' && s.department_id !== department) continue;
      ids.add(s.id);
    }
    return ids;
  }, [data.staff, hotel, department]);
  const rows = useMemo(() => allRows.filter((r) => inScope.has(r.staff_id)), [allRows, inScope]);
  const baseProperties=useMemo(()=>[...new Set(data.staff.map(s=>s.hotel_id??'company'))].map(key=>({key,name:hotelShort(key==='company'?null:key),color:PROPERTY_COLORS[key]??'#64748b'})).sort((a,b)=>a.name.localeCompare(b.name)),[data.staff]);
  const scopedStaff=useMemo(()=>data.staff.filter(s=>inScope.has(s.id)),[data.staff,inScope]);
  const scopedData=useMemo(()=>({...data,staff:scopedStaff}),[data,scopedStaff]);
  const report = useMemo(() => employeeReport(rows, data.staff.filter((s) => inScope.has(s.id)), monthsBetween(fromMonth, toMonth)), [rows, data.staff, inScope, fromMonth, toMonth]);
  const dashboard=useMemo(()=>managementAnalytics(rows,scopedStaff,report,fromMonth,toMonth,deptName),[rows,scopedStaff,report,fromMonth,toMonth,deptName]);
  const coverage = useMemo(() => weekdayCoverage(rows).map((c) => ({ name: WEEKDAYS[c.weekday], people: c.average })), [rows]);
  const overtime = report.reduce((n, r) => n + Math.max(0, r.balanceMinutes ?? 0), 0);
  const under = report.reduce((n, r) => n + Math.min(0, r.balanceMinutes ?? 0), 0);
  const attention = report.filter((r) => r.flags.some((f) => f !== 'drafts')).length;
  const leaveLeft = (id: string) => { const s = staffById.get(id); return s?.annual_leave_days == null ? null : s.annual_leave_days - (data.leaveUsed.get(id) ?? 0); };
  const reportRows = report
    .filter((r) => risk ? r.flags.includes(risk) : !attentionOnly || r.flags.some((f) => f !== 'drafts'))
    .filter((r) => { const s = staffById.get(r.staffId); return matchesStaffSearch([s?.full_name, s?.nickname, deptName.get(s?.department_id ?? ''), roleName.get(s?.job_role_id ?? ''), hotelShort(s?.hotel_id)], personQuery); })
    .sort((a, b) => (deptName.get(staffById.get(a.staffId)?.department_id ?? '') ?? '').localeCompare(deptName.get(staffById.get(b.staffId)?.department_id ?? '') ?? '')
      || (staffById.get(a.staffId)?.full_name ?? '').localeCompare(staffById.get(b.staffId)?.full_name ?? ''));
  const reportLine = (r: EmployeeReportRow) => {
    const s = staffById.get(r.staffId);
    return [s?.full_name ?? '', deptName.get(s?.department_id ?? '') ?? '', roleName.get(s?.job_role_id ?? '') ?? '', hotelShort(s?.hotel_id), CONTRACT[s?.employment_type ?? ''] ?? '',
      r.daysWorked, r.dayShifts, r.nights, r.weekendShifts, r.holidayShifts, Math.round(r.minutes / 6) / 10,
      r.normMinutes == null ? '' : Math.round(r.normMinutes / 6) / 10, r.balanceMinutes == null ? '' : Math.round(r.balanceMinutes / 6) / 10,
      r.leaveDays, r.sickDays, r.unpaidDays, r.absentDays, leaveLeft(r.staffId) ?? '', r.longestRun, r.drafts, r.flags.map((f) => FLAG_LABEL[f]).join(', ')];
  };

  const { total, groups } = useMemo(() => {
    const total = emptyTotals('all', 'All');
    const groups = new Map<string, Totals>();
    for (const r of rows) {
      const s = staffById.get(r.staff_id);
      let key: string, label: string;
      switch (groupBy) {
        case 'department': key = s?.department_id ?? 'none'; label = deptName.get(key) ?? 'No department'; break;
        case 'role': key = s?.job_role_id ?? 'none'; label = roleName.get(key) ?? 'No role'; break;
        case 'hotel': key = r.hotel_id ?? 'company'; label = hotelShort(r.hotel_id); break;
        case 'base': key = s?.hotel_id ?? 'company'; label = hotelShort(s?.hotel_id); break;
        case 'contract': key = s?.employment_type ?? 'full_time'; label = CONTRACT[key] ?? key; break;
        default: key = r.staff_id; label = s?.full_name ?? 'Unknown';
      }
      if (!groups.has(key)) groups.set(key, emptyTotals(key, label));
      add(groups.get(key)!, r);
      add(total, r);
    }
    return { total, groups: [...groups.values()].sort((a, b) => b.minutes - a.minutes) };
  }, [rows, groupBy, staffById, deptName, roleName]);

  const visibleGroups = groupBy === 'staff'
    ? groups.filter((g) => { const s = staffById.get(g.key); return matchesStaffSearch([g.label, s?.nickname, deptName.get(s?.department_id ?? ''), roleName.get(s?.job_role_id ?? '')], query); })
    : groups;

  const exportXlsx = async () => {
    const XLSX = await import('xlsx');
    const header = ['Group', 'People', 'Hours', 'Extra hours', 'Shifts', 'Nights', 'Holiday shifts', 'Leave days', 'Sick days', 'Sick rate %', 'Unpaid days', 'Unexcused', 'Drafts'];
    const body = visibleGroups.map((g) => [g.label, g.people.size, Math.round(g.minutes / 6) / 10, Math.round(g.extra / 6) / 10, g.shifts, g.nights, g.holiday, g.leave, g.sick, Math.round(sickRate(g) * 10) / 10, g.unpaid, g.absent, g.drafts]);
    if (groupBy === 'staff') {
      header.splice(1, 0, 'Department', 'Role', 'Base hotel', 'Daily hours');
      visibleGroups.forEach((g, i) => { const s = staffById.get(g.key); body[i].splice(1, 0, deptName.get(s?.department_id ?? '') ?? '', roleName.get(s?.job_role_id ?? '') ?? '', hotelShort(s?.hotel_id), s?.daily_hours ?? ''); });
    }
    const wb = XLSX.utils.book_new();
    const employees = [['Employee', 'Department', 'Job', 'Base hotel', 'Contract', 'Days worked', 'Day shifts', 'Nights', 'Weekend shifts', 'Holiday shifts', 'Hours', 'Norm hours', 'Over / under', 'Leave days', 'Sick days', 'Unpaid days', 'Unexcused', 'Leave left (year)', 'Longest run (days)', 'Unpublished days', 'To check'], ...reportRows.map(reportLine)];
    const sheet = XLSX.utils.aoa_to_sheet(employees);
    sheet['!cols'] = [{ wch: 28 }, { wch: 20 }, { wch: 22 }, { wch: 12 }, { wch: 16 }, ...Array.from({ length: 15 }, () => ({ wch: 11 })), { wch: 36 }];
    XLSX.utils.book_append_sheet(wb, sheet, 'Employees');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...body]), 'Summary');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Weekday', 'Average people working'], ...coverage.map((c) => [c.name, c.people])]), 'Coverage');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Date','Scheduled gross hours','People scheduled','Day shifts','Night shifts','Leave days','Sick days','Drafts'],...dashboard.daily.map(d=>[d.date,d.hours??'',d.people??'',d.day??'',d.night??'',d.leave??'',d.sick??'',d.drafts??''])]),'Daily plan');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Recorded work property','Scheduled hours','Unique working staff'],...dashboard.properties.map(p=>[p.name,p.hours,p.people])]),'Properties');
    const scope = [hotel === 'all' ? null : hotelShort(hotel === 'company' ? null : hotel), department === 'all' ? null : deptName.get(department)].filter(Boolean).join('_').replace(/[^\w-]+/g, '-');
    XLSX.writeFile(wb, `work-schedule-report_${fromMonth}_${toMonth}${scope ? `_${scope}` : ''}.xlsx`);
  };

  const metricStyles=[
    'border-teal-200 bg-teal-50 text-teal-950 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-100',
    'border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100',
    'border-indigo-200 bg-indigo-50 text-indigo-950 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-100',
    'border-violet-200 bg-violet-50 text-violet-950 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100',
    'border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100',
    'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100',
  ];
  const tile=(label:string,value:string,hint:string|undefined,tone:number,Icon:typeof Users)=>(
    <Card className={'shadow-sm '+metricStyles[tone]}><CardContent className="flex items-start justify-between gap-2 p-3 sm:p-4"><div className="min-w-0"><p className="text-xs font-medium opacity-85">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>{hint&&<p className="mt-1 text-xs opacity-80">{hint}</p>}</div><Icon className="h-5 w-5 shrink-0 opacity-80" aria-hidden="true"/></CardContent></Card>
  );
  const inspectRisk=(flag:ReportFlag)=>{setRisk(flag);setAttentionOnly(false);setPersonQuery('');document.getElementById('workforce-employee-report')?.scrollIntoView?.({behavior:'smooth',block:'start'});};
  const ready=!!org&&!!profile?.id&&from<=to&&!loading&&!data.loading&&!data.error&&!loadError&&loaded?.key===loadKey;

  return (
    <div className="space-y-4 pb-8"><div className="rounded-xl border bg-card p-3 shadow-sm sm:p-4"><div className="mb-3"><h2 className="text-lg font-bold">Staff management analytics</h2><p className="text-sm text-muted-foreground">Schedule-based planning · includes unpublished changes · not actual attendance or payroll.</p></div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-xs">From<Input type="month" value={fromMonth} onChange={(e) => e.target.value && setFromMonth(e.target.value)} className="w-40" /></label>
        <label className="space-y-1 text-xs">To<Input type="month" value={toMonth} onChange={(e) => e.target.value && setToMonth(e.target.value)} className="w-40" /></label>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={() => { setFromMonth(`${year}-01`); setToMonth(`${year}-${pad2(month)}`); }}>Year to date</Button>
          <Button variant="outline" size="sm" onClick={() => { const d = new Date(Date.UTC(year, month - 3, 1)); setFromMonth(`${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`); setToMonth(`${year}-${pad2(month)}`); }}>Last 3 months</Button>
        </div>
        <label className="space-y-1 text-xs">Base hotel
          <Select value={hotel} onValueChange={setHotel}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All hotels</SelectItem>
              {baseProperties.map(h=><SelectItem key={h.key} value={h.key}>{h.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1 text-xs">Department
          <Select value={department} onValueChange={setDepartment}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {data.departments.filter((d) => d.is_active).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1 text-xs">Group by
          <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="department">Department</SelectItem><SelectItem value="role">Job role</SelectItem>
              <SelectItem value="hotel">Hotel worked at</SelectItem><SelectItem value="base">Base hotel</SelectItem>
              <SelectItem value="contract">Contract type</SelectItem><SelectItem value="staff">Employee</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <Button variant="outline" className="ml-auto" onClick={() => void exportXlsx()} disabled={!ready||!rows.length}><Download className="mr-1 h-4 w-4" />Export report (Excel)</Button>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div></div>
      {!ready ? <Card><CardContent className="p-6 text-sm text-muted-foreground" role="status">{from>to?"Choose a valid date range.":loadError||data.error?<div className="flex flex-wrap items-center gap-3"><span>Analytics could not be loaded. No report is displayed.</span><Button variant="outline" size="sm" onClick={()=>{setRefresh(x=>x+1);void data.reload();}}>Retry</Button></div>:"Loading authorized schedule data…"}</CardContent></Card> : <>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {tile('People scheduled',String(total.people.size),'Unique staff with schedule entries',0,Users)}
        {tile('Scheduled gross hours',formatHours(total.minutes),'Breaks not deducted',1,Clock)}
        {tile('Avg hours / person',total.people.size?formatHours(total.minutes/total.people.size):'0',undefined,1,BarChart3)}
        {tile('Leave days',String(total.leave),undefined,3,CalendarDays)}
        {tile('Sick days',String(total.sick),sickRate(total).toFixed(1)+'% sick rate',4,HeartPulse)}
        {tile('Night shifts',String(report.reduce((n,r)=>n+r.nights,0)),total.holiday?total.holiday+' shifts on public holidays':undefined,2,Moon)}
        {tile('Above norm',formatHours(overtime)+' h',formatHours(-under)+' h below norm elsewhere',5,Timer)}
        {tile('Absence rate',(total.shifts+total.leave+total.sick+total.unpaid+total.absent?100*(total.leave+total.sick+total.unpaid+total.absent)/(total.shifts+total.leave+total.sick+total.unpaid+total.absent):0).toFixed(1)+'%','Includes planned leave',4,HeartPulse)}
        {tile('To check',String(attention),'People with review flags',5,CircleAlert)}
        {tile('Not published',String(total.drafts),'Draft schedule entries',5,FileClock)}
      </div>
      <WorkforceManagementCharts analytics={dashboard} coverage={coverage} onRisk={inspectRisk} onProperty={setHotel} baseProperties={baseProperties}/>

      <Card id="workforce-employee-report" className="scroll-mt-24 shadow-sm" data-training="wf-employee-report">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <div>
            <CardTitle className="text-base">Employee report</CardTitle>
            <CardDescription>One line per person for the period: worked against the norm, nights, weekends, holidays, absences. This is the first sheet of the Excel export.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={attentionOnly ? 'default' : 'outline'} onClick={() => {setRisk(null);setAttentionOnly((v) => !v);}}><AlertTriangle className="mr-1 h-4 w-4" />To check only · {attention}</Button>
            {risk&&<Button size="sm" variant="secondary" onClick={()=>setRisk(null)}>{FLAG_LABEL[risk]} · Clear</Button>}
            <Input className="h-9 w-56" placeholder="Search employee, job, hotel…" value={personQuery} onChange={(e) => setPersonQuery(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent className="max-h-[520px] overflow-auto p-0">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>Employee</TableHead><TableHead>Team · hotel</TableHead>
                <TableHead className="text-right">Days</TableHead><TableHead className="text-right">Nights</TableHead>
                <TableHead className="text-right" title="Shifts on Saturday or Sunday">Weekend</TableHead><TableHead className="text-right" title="Shifts on public holidays">Holiday</TableHead>
                <TableHead className="text-right">Hours</TableHead><TableHead className="text-right" title="Working days of the period × daily hours">Norm</TableHead>
                <TableHead className="text-right" title="Hours plus paid leave and sick days, against the norm">Over / under</TableHead>
                <TableHead className="text-right">Leave</TableHead><TableHead className="text-right">Sick</TableHead>
                <TableHead className="text-right" title="Annual leave still available this year">Leave left</TableHead>
                <TableHead>To check</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reportRows.map((r) => {
                const s = staffById.get(r.staffId);
                const left = leaveLeft(r.staffId);
                return (
                  <TableRow key={r.staffId} className="odd:bg-muted/20">
                    <TableCell className="font-medium">{s?.full_name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{roleName.get(s?.job_role_id ?? '') ?? deptName.get(s?.department_id ?? '') ?? ''} · {hotelShort(s?.hotel_id)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.daysWorked}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.nights || ''}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.weekendShifts || ''}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.holidayShifts || ''}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatHours(r.minutes)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{r.normMinutes == null ? '—' : formatHours(r.normMinutes)}</TableCell>
                    <TableCell className={`text-right font-medium tabular-nums ${(r.balanceMinutes ?? 0) > 0 ? 'text-amber-700 dark:text-amber-400' : (r.balanceMinutes ?? 0) < 0 ? 'text-sky-700 dark:text-sky-400' : ''}`}>{signed(r.balanceMinutes)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.leaveDays || ''}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.sickDays || ''}</TableCell>
                    <TableCell className={`text-right tabular-nums ${left != null && left < 0 ? 'font-semibold text-red-600' : ''}`}>{left ?? ''}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {r.flags.map((f) => <span key={f} className={`rounded-full px-1.5 py-0.5 text-[10px] ${f === 'drafts' ? 'bg-muted text-muted-foreground' : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'}`}>{FLAG_LABEL[f]}</span>)}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!reportRows.length && <TableRow><TableCell colSpan={13} className="py-8 text-center text-muted-foreground">{loading ? 'Loading…' : 'Nobody to show for this period and filter.'}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <WorkforceStaffOverview data={scopedData} rows={rows} />

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
                <TableHead className="text-right">Shifts</TableHead><TableHead className="text-right">Nights</TableHead><TableHead className="text-right" title="Shifts on public holidays">Holiday</TableHead>
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
                  <TableCell className="text-right tabular-nums">{g.holiday || ''}</TableCell>
                  <TableCell className="text-right tabular-nums">{g.leave || ''}</TableCell>
                  <TableCell className="text-right tabular-nums">{g.sick || ''}</TableCell>
                  <TableCell className="text-right tabular-nums">{g.sick ? sickRate(g).toFixed(1) : ''}</TableCell>
                  <TableCell className="text-right tabular-nums">{g.unpaid || ''}</TableCell>
                  <TableCell className="text-right tabular-nums">{g.absent || ''}</TableCell>
                </TableRow>
              ))}
              {!visibleGroups.length && <TableRow><TableCell colSpan={12} className="py-8 text-center text-muted-foreground">{loading ? 'Loading…' : 'No schedule data in this period.'}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      </>}
    </div>
  );
}
