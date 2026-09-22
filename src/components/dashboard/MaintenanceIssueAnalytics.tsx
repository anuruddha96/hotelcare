import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { type MaintenanceMetricRow, summarizeMaintenanceIssues } from '@/lib/maintenanceIssueMetrics';
import { Download, RefreshCw } from 'lucide-react';

type ReportRow = MaintenanceMetricRow & { ticket_number: string; title: string; priority: string; hotel: string; assigned_to: string | null };
type Period = '7' | '30' | '90';

function csvCell(value: unknown): string {
  const raw = String(value ?? '');
  // Spreadsheet programs may interpret external ticket text as formulas.
  const safe = /^[\s]*[=+@-]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function MaintenanceIssueAnalytics() {
  const { profile } = useAuth();
  const [period, setPeriod] = useState<Period>('30');
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const scope = `${profile?.organization_slug || ''}:${profile?.assigned_hotel || ''}:${period}`;

  const fetchReport = useCallback(async () => {
    setError(null);
    setLoading(true);
    setRows([]);
    if (!profile?.organization_slug || !profile.assigned_hotel) {
      setError('Select a hotel to see maintenance analytics.');
      setLoading(false);
      return;
    }
    try {
      const hotels = await resolveHotelKeys(profile.assigned_hotel);
      if (!hotels.length) throw new Error('The selected hotel could not be resolved.');
      const since = new Date(Date.now() - Number(period) * 86400000).toISOString();
      const dataRows: ReportRow[] = [];
      // No .limit(300) undercount: paginate all records in this date cohort.
      for (let offset = 0; ; offset += 1000) {
        if (offset >= 20000) throw new Error('More than 20,000 issues found. Reporting requires a narrower date range.');
        const { data, error: queryError } = await (supabase as any).from('tickets')
          .select('id, ticket_number, title, priority, hotel, assigned_to, status, pending_supervisor_approval, supervisor_approved, on_hold, room_number, created_at, closed_at, sla_due_date, attachment_urls, completion_photos')
          .eq('organization_slug', profile.organization_slug).eq('department', 'maintenance')
          .in('hotel', hotels).gte('created_at', since)
          .order('created_at', { ascending: false }).range(offset, offset + 999);
        if (queryError) throw queryError;
        dataRows.push(...((data || []) as ReportRow[]));
        if ((data || []).length < 1000) break;
      }
      setRows(dataRows);
    } catch (reason: any) {
      setError(reason?.message || 'Maintenance reporting is unavailable.');
    } finally { setLoading(false); }
  }, [scope, profile?.organization_slug, profile?.assigned_hotel, period]);

  useEffect(() => { void fetchReport(); }, [fetchReport, revision]);
  const metrics = useMemo(() => summarizeMaintenanceIssues(rows), [rows]);
  const exportCsv = () => {
    if (!rows.length || error) return;
    const columns = ['ticket_number','hotel','room_number','title','priority','status','pending_supervisor_approval','supervisor_approved','on_hold','created_at','closed_at','sla_due_date','assigned_to'] as const;
    const csv = [columns.map(csvCell).join(','), ...rows.map(row => columns.map(col => csvCell(row[col])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `maintenance-issues-${period}d.csv`;
    anchor.click(); URL.revokeObjectURL(url);
  };
  return <Card><CardContent className="space-y-3 p-3 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-sm font-bold">Maintenance issues · Analytics & reporting</h3>
        <p className="text-xs text-muted-foreground">Hotel-scoped; cohort by issue creation date. Work completed and supervisor approval are separate measures.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs" htmlFor="maintenance-report-period">Period</label>
        <select id="maintenance-report-period" className="rounded border bg-background p-1.5 text-sm" value={period} onChange={event => setPeriod(event.target.value as Period)}>
          <option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option>
        </select>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => setRevision(n => n+1)}><RefreshCw className="mr-1 h-3.5 w-3.5" />Refresh</Button>
        <Button variant="outline" size="sm" disabled={loading || !!error || !rows.length} onClick={exportCsv}><Download className="mr-1 h-3.5 w-3.5" />CSV</Button>
      </div>
    </div>
    {loading ? <p role="status" className="text-sm">Loading issue analytics…</p> : error ? <p role="alert" className="text-sm text-red-700">{error}</p> : <>
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 lg:grid-cols-8">
        {([['Created',metrics.total],['Open',metrics.open],['In progress',metrics.inProgress],['On hold',metrics.onHold],['Awaiting approval',metrics.awaitingApproval],['Work done',metrics.completed],['Supervisor approved',metrics.approved],['Overdue active',metrics.overdue]] as const).map(([label,number]) =>
          <div key={label} className="rounded-md border p-2"><div className="text-xs text-muted-foreground">{label}</div><div className="text-xl font-bold">{number}</div></div>)}
      </div>
      <p className="text-xs text-muted-foreground">Average completed-issue time: {metrics.averageHours === null ? 'Not available' : `${metrics.averageHours.toFixed(1)} hours`} · No photo evidence: {metrics.missingEvidence} · Repeated rooms: {metrics.repeatedRooms.slice(0, 5).map(([room,count]) => `${room} (${count})`).join(', ') || 'None'}.</p>
    </>}
  </CardContent></Card>;
}
