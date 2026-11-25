import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Download, Loader2, Printer } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useOperationalHotel } from '@/hooks/useOperationalHotel';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { Header } from '@/components/layout/Header';
import { OperationsNavigation } from '@/components/layout/OperationsNavigation';
import { OperationalPageHeading } from '@/components/layout/OperationalPageHeading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { todayBudapest } from '@/lib/budapestTime';
import { reservationChannel, reservationGuestLabel } from '@/lib/reservations';
import { summarizeReservationNote } from '@/lib/previoReservationNote';
import {
  addDaysIso, channelProduction, dailyOverview, daysBetween, performanceReport, toCsv, type ReportReservation,
} from '@/lib/receptionReports';

import { NtakStatusCard } from '@/components/ntak/NtakStatusCard';
import { VizaStatusCard } from '@/components/frontdesk/VizaStatusCard';

type Tab = 'daily' | 'performance' | 'channels' | 'authority';
const SELECT = 'id,reservation_number,status,check_in_date,check_out_date,room_id,total_amount,balance_due,currency,adults,children,source,pms_channel,ota_name,pms_missing_since,pms_payment_status,pms_guest_name,special_requests,source_reservation_id,guests!reservations_guest_id_fkey(first_name,last_name),rooms:room_id(room_number,room_type)';

function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ReceptionReports() {
  const { user, profile, loading } = useAuth();
  const { t } = useTranslation();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const basePath = `/${organizationSlug || 'rdhotels'}`;
  const { hotelId, hotelKeys, isPortfolio, ready } = useOperationalHotel();
  const today = todayBudapest();
  const [tab, setTab] = useState<Tab>('daily');
  const canViewAuthority = !!profile && (profile.is_super_admin || ['admin', 'top_management', 'top_management_manager'].includes(profile.role));
  const authority = canViewAuthority && tab === 'authority';
  // A role downgrade during a session must not leave the user on a hidden tab.
  useEffect(() => {
    if (!canViewAuthority && tab === 'authority') setTab('daily');
  }, [canViewAuthority, tab]);
  const [day, setDay] = useState(today);
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<ReportReservation[]>([]);
  const [roomCount, setRoomCount] = useState(0);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);

  // One load covers both the day sheet and the period reports.
  const loadFrom = day < from ? day : from;
  const loadTo = day > to ? day : to;
  const keysKey = hotelKeys.join('|');
  useEffect(() => {
    if (authority || !ready || !hotelId || isPortfolio) { setRows([]); setBusy(false); return; }
    let alive = true;
    setBusy(true); setFailed(false);
    const keys = hotelKeys.length ? hotelKeys : [hotelId];
    void Promise.all([
      supabase.from('reservations').select(SELECT).in('hotel_id', keys)
        .gte('check_out_date', loadFrom).lte('check_in_date', loadTo).order('check_in_date').limit(5000),
      supabase.from('rooms').select('id', { count: 'exact', head: true }).in('hotel', keys),
    ]).then(([res, rooms]) => {
      if (!alive) return;
      if (res.error) { setFailed(true); setRows([]); } else setRows((res.data ?? []) as unknown as ReportReservation[]);
      setRoomCount(rooms.count ?? 0);
      setBusy(false);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, hotelId, isPortfolio, keysKey, loadFrom, loadTo, authority]);

  const currency = useMemo(() => rows.find((r) => r.currency)?.currency ?? '', [rows]);
  const money = (value: number | null) => value == null ? '—' : `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`.trim();
  const daily = useMemo(() => dailyOverview(rows, day, roomCount), [rows, day, roomCount]);
  const rangeOk = to >= from && daysBetween(from, to) <= 366;
  const performance = useMemo(() => rangeOk ? performanceReport(rows, from, to, roomCount) : null, [rows, from, to, roomCount, rangeOk]);
  const channels = useMemo(() => rangeOk ? channelProduction(rows, from, to) : [], [rows, from, to, rangeOk]);

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!user) return <Navigate to={`${basePath}/auth`} replace />;

  const exportCsv = () => {
    if (tab === 'daily') {
      const line = (kind: string, r: ReportReservation) => [kind, r.rooms?.room_number ?? '', reservationGuestLabel(r), r.check_in_date, r.check_out_date,
        Number(r.adults ?? 0) + Number(r.children ?? 0), reservationChannel(r).label, Number(r.balance_due ?? 0), summarizeReservationNote(r.special_requests) ?? ''];
      download(`daily-overview-${day}.csv`, toCsv(['Type', 'Room', 'Guest', 'Arrival', 'Departure', 'Guests', 'Channel', 'Balance', 'Notes'], [
        ...daily.arrivals.map((r) => line('Arrival', r)), ...daily.departures.map((r) => line('Departure', r)), ...daily.stayovers.map((r) => line('Stay-over', r)),
      ]));
    } else if (tab === 'performance' && performance) {
      download(`performance-${from}_${to}.csv`, toCsv(['Date', 'Rooms sold', 'Rooms available', 'Occupancy %', 'Revenue', 'ADR', 'RevPAR', 'Arrivals', 'Departures'],
        performance.days.map((d) => [d.date, d.roomsSold, d.roomsAvailable, d.occupancyPercent, d.revenue, d.adr, d.revpar, d.arrivals, d.departures])));
    } else {
      download(`channels-${from}_${to}.csv`, toCsv(['Channel', 'Bookings', 'Room nights', 'Share %', 'Revenue', 'ADR'],
        channels.map((c) => [c.channel, c.bookings, c.roomNights, c.sharePercent, c.revenue, c.adr])));
    }
  };

  const Section = ({ title, items }: { title: string; items: ReportReservation[] }) => (
    <div className="break-inside-avoid">
      <h3 className="px-3 py-2 text-xs font-semibold uppercase tracking-wide bg-muted/50 flex items-center gap-2">{title}<Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{items.length}</Badge></h3>
      {items.length === 0 ? <p className="px-3 py-3 text-xs text-muted-foreground">—</p> : (
        <div className="overflow-x-auto"><table className="w-full text-xs">
          <thead><tr className="text-left text-muted-foreground border-b border-border">
            <th className="px-3 py-1.5 font-medium">{t('pms.res.room')}</th><th className="px-3 py-1.5 font-medium">{t('pms.reservations.guest')}</th>
            <th className="px-3 py-1.5 font-medium">{t('pms.rep.stay')}</th><th className="px-3 py-1.5 font-medium text-right">{t('pms.rep.guests')}</th>
            <th className="px-3 py-1.5 font-medium">{t('pms.reservations.source')}</th><th className="px-3 py-1.5 font-medium text-right">{t('pms.rep.balance')}</th>
            <th className="px-3 py-1.5 font-medium">{t('pms.rep.notes')}</th>
          </tr></thead>
          <tbody className="divide-y divide-border/60">{items.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="px-3 py-1.5 font-semibold whitespace-nowrap">{r.rooms?.room_number ?? <span className="font-normal text-amber-700 dark:text-amber-400">{t('pms.cal.floating')}</span>}</td>
              <td className="px-3 py-1.5"><Link className="hover:underline print:no-underline" to={`${basePath}/reservations/${r.id}`}>{reservationGuestLabel(r)}</Link></td>
              <td className="px-3 py-1.5 whitespace-nowrap">{r.check_in_date.slice(5)} → {r.check_out_date.slice(5)} · {daysBetween(r.check_in_date, r.check_out_date)}{t('pms.cal.nightsShort')}</td>
              <td className="px-3 py-1.5 text-right">{Number(r.adults ?? 0) + Number(r.children ?? 0)}</td>
              <td className="px-3 py-1.5 whitespace-nowrap">{reservationChannel(r).label}</td>
              <td className={`px-3 py-1.5 text-right whitespace-nowrap ${Number(r.balance_due ?? 0) > 0 && r.pms_payment_status !== 'paid' ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>{money(Number(r.balance_due ?? 0))}</td>
              <td className="px-3 py-1.5 text-muted-foreground max-w-[280px]">{summarizeReservationNote(r.special_requests) ?? ''}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );

  const Kpi = ({ label, value }: { label: string; value: string }) => (
    <div className="rounded-lg border border-border bg-card px-3 py-2 min-w-[120px]"><div className="text-[11px] text-muted-foreground">{label}</div><div className="text-lg font-semibold leading-tight">{value}</div></div>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="print:hidden"><Header /></div>
      <main className="container mx-auto px-4 py-6">
        <div className="print:hidden">
          <OperationalPageHeading section="Reception" />
          <div className="mt-4 mb-6"><OperationsNavigation current="reception" /></div>
          <div className="mb-3 flex items-center gap-1.5 overflow-x-auto scrollbar-hide" aria-label="Reception tools">
            <Link to={`${basePath}/reception`}><Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 gap-1.5 text-muted-foreground hover:text-foreground">🛎️ {t('pms.rep.navCalendar')}</Button></Link>
            <Link to={`${basePath}/guests`}><Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 gap-1.5 text-muted-foreground hover:text-foreground">👥 {t('pms.rep.navGuests')}</Button></Link>
            <Button type="button" size="sm" className="h-8 shrink-0 gap-1.5">📊 {t('pms.rep.title')}</Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h1 className="text-xl font-bold">{t('pms.rep.title')}</h1>
            <p className="text-xs text-muted-foreground">{t('pms.rep.subtitle')}</p>
          </div>
          {!authority && <div className="flex items-center gap-2 print:hidden">
            <Button type="button" size="sm" variant="outline" className="h-9 gap-1.5" onClick={exportCsv} disabled={busy}><Download className="h-4 w-4" /> CSV</Button>
            <Button type="button" size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => window.print()}><Printer className="h-4 w-4" /> {t('pms.rep.print')}</Button>
          </div>}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3 print:hidden">
          <div className="flex flex-wrap border border-border rounded-md overflow-hidden" role="tablist">
            {(['daily', 'performance', 'channels', 'authority'] as Tab[]).filter(key => key !== 'authority' || canViewAuthority).map((key) => (
              <Button key={key} data-training={key === "daily" ? "reception-report-daily" : undefined} type="button" size="sm" role="tab" aria-selected={tab === key} variant={tab === key ? 'default' : 'ghost'} className="rounded-none h-9" onClick={() => setTab(key)}>{key === 'authority' ? 'NTAK / VIZA' : t(`pms.rep.tab_${key}`)}</Button>
            ))}
          </div>
          {!authority && (tab === 'daily' ? (
            <div className="flex items-center gap-1">
              <Button type="button" size="sm" variant="outline" className="h-9" onClick={() => setDay(addDaysIso(day, -1))}>‹</Button>
              <Input type="date" className="h-9 w-[150px]" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label={t('pms.rep.date')} />
              <Button type="button" size="sm" variant="outline" className="h-9" onClick={() => setDay(addDaysIso(day, 1))}>›</Button>
              <Button type="button" size="sm" variant="secondary" className="h-9" onClick={() => setDay(today)}>{t('pms.planner.today')}</Button>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-xs">
              <Input type="date" className="h-9 w-[150px]" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label={t('pms.rep.from')} />
              <span>→</span>
              <Input type="date" className="h-9 w-[150px]" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label={t('pms.rep.to')} />
            </div>
          ))}
        </div>

        {authority && ready && hotelId && !isPortfolio && <div key={hotelId} className="grid gap-4">
          <NtakStatusCard hotelId={hotelId} report />
          <VizaStatusCard hotelId={hotelId} report />
        </div>}
        {ready && (!hotelId || isPortfolio) && <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{t(isPortfolio ? 'pms.fd.selectProperty' : 'pms.fd.noPropertyAssigned')}</CardContent></Card>}
        {!authority && failed && <div role="alert" className="rounded-md border border-destructive/50 p-3 text-xs text-destructive">{t('pms.rep.loadFailed')}</div>}
        {!authority && busy && hotelId && <div className="py-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}

        {!busy && !failed && hotelId && tab === 'daily' && (
          <div className="space-y-3" data-training="rep-daily">
            <p className="hidden print:block text-sm font-semibold">{t('pms.rep.tab_daily')} · {day}</p>
            <div className="flex flex-wrap gap-2">
              <Kpi label={t('pms.fd.arrivalsRemaining')} value={String(daily.arrivals.length)} />
              <Kpi label={t('pms.fd.departuresRemaining')} value={String(daily.departures.length)} />
              <Kpi label={t('pms.rep.stayovers')} value={String(daily.stayovers.length)} />
              <Kpi label={t('pms.rep.roomsTonight')} value={`${daily.roomsTonight}/${roomCount}${daily.occupancyPercent != null ? ` · ${daily.occupancyPercent}%` : ''}`} />
              <Kpi label={t('pms.rep.guestsTonight')} value={String(daily.guestsTonight)} />
              <Kpi label={t('pms.rep.toCollect')} value={money(daily.balanceToCollect)} />
            </div>
            <Card><CardContent className="p-0 divide-y divide-border">
              <Section title={t('pms.rep.arrivals')} items={daily.arrivals} />
              <Section title={t('pms.rep.departures')} items={daily.departures} />
              <Section title={t('pms.rep.stayovers')} items={daily.stayovers} />
            </CardContent></Card>
          </div>
        )}

        {!busy && !failed && hotelId && !authority && tab !== 'daily' && !rangeOk && <p className="text-sm text-muted-foreground">{t('pms.rep.badRange')}</p>}

        {!busy && !failed && hotelId && tab === 'performance' && performance && (
          <div className="space-y-3" data-training="rep-performance">
            <p className="hidden print:block text-sm font-semibold">{t('pms.rep.tab_performance')} · {from} → {to}</p>
            <div className="flex flex-wrap gap-2">
              <Kpi label={t('pms.planner.occupancy')} value={performance.totals.occupancyPercent == null ? '—' : `${performance.totals.occupancyPercent}%`} />
              <Kpi label="ADR" value={money(performance.totals.adr)} />
              <Kpi label="RevPAR" value={money(performance.totals.revpar)} />
              <Kpi label={t('pms.rep.revenue')} value={money(performance.totals.revenue)} />
              <Kpi label={t('pms.rep.roomNights')} value={`${performance.totals.roomsSold}/${performance.totals.roomsAvailable}`} />
              <Kpi label={t('pms.rep.avgStay')} value={performance.totals.averageStay == null ? '—' : `${performance.totals.averageStay}${t('pms.cal.nightsShort')}`} />
            </div>
            <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="text-left text-muted-foreground border-b border-border bg-muted/40">
                <th className="px-3 py-2 font-medium">{t('pms.rep.date')}</th><th className="px-3 py-2 font-medium text-right">{t('pms.rep.roomNights')}</th>
                <th className="px-3 py-2 font-medium">{t('pms.planner.occupancy')}</th><th className="px-3 py-2 font-medium text-right">{t('pms.rep.revenue')}</th>
                <th className="px-3 py-2 font-medium text-right">ADR</th><th className="px-3 py-2 font-medium text-right">RevPAR</th>
                <th className="px-3 py-2 font-medium text-right">↓ {t('pms.rep.arrivals')}</th><th className="px-3 py-2 font-medium text-right">↑ {t('pms.rep.departures')}</th>
              </tr></thead>
              <tbody className="divide-y divide-border/60">{performance.days.map((d) => (
                <tr key={d.date} className={d.date === today ? 'bg-primary/5' : undefined}>
                  <td className="px-3 py-1.5 whitespace-nowrap font-medium">{d.date}</td>
                  <td className="px-3 py-1.5 text-right">{d.roomsSold}/{d.roomsAvailable}</td>
                  <td className="px-3 py-1.5"><div className="flex items-center gap-2"><div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden"><div className={`h-full ${(d.occupancyPercent ?? 0) >= 90 ? 'bg-red-500' : (d.occupancyPercent ?? 0) >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, d.occupancyPercent ?? 0)}%` }} /></div>{d.occupancyPercent == null ? '—' : `${d.occupancyPercent}%`}</div></td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">{money(d.revenue)}</td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">{money(d.adr)}</td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">{money(d.revpar)}</td>
                  <td className="px-3 py-1.5 text-right">{d.arrivals}</td><td className="px-3 py-1.5 text-right">{d.departures}</td>
                </tr>
              ))}</tbody>
            </table></div></CardContent></Card>
            <p className="text-[11px] text-muted-foreground">{t('pms.rep.method')}</p>
          </div>
        )}

        {!busy && !failed && hotelId && tab === 'channels' && rangeOk && (
          <div className="space-y-3" data-training="rep-channels">
            <p className="hidden print:block text-sm font-semibold">{t('pms.rep.tab_channels')} · {from} → {to}</p>
            <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="text-left text-muted-foreground border-b border-border bg-muted/40">
                <th className="px-3 py-2 font-medium">{t('pms.reservations.source')}</th><th className="px-3 py-2 font-medium text-right">{t('pms.rep.bookings')}</th>
                <th className="px-3 py-2 font-medium text-right">{t('pms.rep.roomNights')}</th><th className="px-3 py-2 font-medium">{t('pms.rep.share')}</th>
                <th className="px-3 py-2 font-medium text-right">{t('pms.rep.revenue')}</th><th className="px-3 py-2 font-medium text-right">ADR</th>
              </tr></thead>
              <tbody className="divide-y divide-border/60">
                {channels.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">—</td></tr>}
                {channels.map((c) => (
                  <tr key={c.channel}>
                    <td className="px-3 py-1.5 font-medium">{c.channel}</td><td className="px-3 py-1.5 text-right">{c.bookings}</td>
                    <td className="px-3 py-1.5 text-right">{c.roomNights}</td>
                    <td className="px-3 py-1.5"><div className="flex items-center gap-2"><div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: `${c.sharePercent}%` }} /></div>{c.sharePercent}%</div></td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">{money(c.revenue)}</td><td className="px-3 py-1.5 text-right whitespace-nowrap">{money(c.adr)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div></CardContent></Card>
            <p className="text-[11px] text-muted-foreground">{t('pms.rep.method')}</p>
          </div>
        )}
      </main>
    </div>
  );
}
