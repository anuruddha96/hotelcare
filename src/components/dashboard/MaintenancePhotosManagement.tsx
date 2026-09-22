import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { AlertTriangle, Building2, CheckCircle2, Clock, Eye, Hourglass, PauseCircle, Plus, RefreshCw, User, Wrench } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { hasManagerPowers } from '@/lib/roleAccess';
import { MaintenanceIssueDialog } from './MaintenanceIssueDialog';
import { MaintenanceIssueEvidence } from './MaintenanceIssueEvidence';
import { MaintenanceIssueAnalytics } from './MaintenanceIssueAnalytics';
import { canManageMaintenance, MaintenanceManagerControls, type ManagerMaintenanceTicket } from './MaintenanceManagerControls';

interface MaintenanceTicket extends ManagerMaintenanceTicket {
  title: string;
  description: string;
  hotel: string | null;
  priority: string;
  created_at: string;
  assigned_to: string | null;
  attachment_urls: string[] | null;
  completion_photos: string[] | null;
  hold_reason: string | null;
  source: string | null;
  assignment_method: string | null;
  created_by_profile?: { full_name: string; nickname?: string | null } | null;
  assigned_to_profile?: { full_name: string; nickname?: string | null } | null;
}

const textByLanguage: Record<string, Record<string, string>> = {
  en: {
    title: 'Maintenance issues', subtitle: 'One live maintenance queue shared with Housekeeping and the main Maintenance module.',
    report: 'Report issue', active: 'Active', progress: 'In progress', hold: 'Pending / on hold', approval: 'Awaiting approval', done: 'Done', all: 'All',
    noItems: 'No maintenance issues in this view.', reportedBy: 'Reported by', assignedTo: 'Assigned to', unassigned: 'Unassigned',
    noDuty: 'No maintenance staff was signed in when this was reported. Managers can record a manual resolution below.',
    issue: 'Issue', holdReason: 'Pending reason', resolution: 'Resolution', attachments: 'Attachments', refresh: 'Refresh',
    source: 'Source', auto: 'Auto-routed', manual: 'Manual', housekeeping: 'Housekeeping',
    statusOpen: 'Open', statusProgress: 'In progress', statusDone: 'Done',
  },
  hu: {
    title: 'Karbantartási hibák', subtitle: 'Egy közös, élő karbantartási sor a Takarítás és a fő Karbantartás modul számára.',
    report: 'Hiba jelentése', active: 'Aktív', progress: 'Folyamatban', hold: 'Függőben / várakozik', approval: 'Jóváhagyásra vár', done: 'Kész', all: 'Összes',
    noItems: 'Nincs karbantartási hiba ebben a nézetben.', reportedBy: 'Jelentette', assignedTo: 'Hozzárendelve', unassigned: 'Nincs kiosztva',
    noDuty: 'A jelentéskor nem volt bejelentkezett karbantartó. A vezetők alább rögzíthetik a kézi megoldást.',
    issue: 'Hiba', holdReason: 'Várakozás oka', resolution: 'Megoldás', attachments: 'Mellékletek', refresh: 'Frissítés',
    source: 'Forrás', auto: 'Automatikus', manual: 'Kézi', housekeeping: 'Takarítás',
    statusOpen: 'Nyitott', statusProgress: 'Folyamatban', statusDone: 'Kész',
  },
};

type Filter = 'active' | 'progress' | 'hold' | 'approval' | 'done' | 'all';

export function MaintenancePhotosManagement() {
  const { language } = useTranslation();
  const c = textByLanguage[language] || textByLanguage.en;
  const { profile } = useAuth();
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('active');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const canCreate = hasManagerPowers(profile?.role);
  const canManage = canManageMaintenance(profile?.role);

  const fetchTickets = useCallback(async () => {
    // Never broaden a hotel-scoped query when the current hotel cannot be resolved.
    if (!profile?.organization_slug || !profile.assigned_hotel) {
      setTickets([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const hotelKeys = await resolveHotelKeys(profile.assigned_hotel);
      if (!hotelKeys.length) {
        setTickets([]);
        return;
      }
      const { data, error } = await (supabase as any).from('tickets')
        .select(`
          id, ticket_number, title, description, room_number, hotel, priority, status,
          created_at, updated_at, assigned_to, attachment_urls, completion_photos,
          pending_supervisor_approval, on_hold, hold_reason, resolution_text, sla_due_date,
          source, assignment_method,
          created_by_profile:profiles!tickets_created_by_fkey(full_name, nickname),
          assigned_to_profile:profiles!tickets_assigned_to_fkey(full_name, nickname)
        `)
        .eq('department', 'maintenance')
        .eq('organization_slug', profile.organization_slug)
        .in('hotel', hotelKeys)
        .order('created_at', { ascending: false })
        .limit(300);
      if (error) throw error;
      setTickets((data || []) as MaintenanceTicket[]);
    } catch (error) {
      console.error('Failed to load maintenance tickets:', error);
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [profile?.organization_slug, profile?.assigned_hotel]);

  useEffect(() => {
    void fetchTickets();
    const channel = supabase
      .channel(`housekeeping-maintenance-${profile?.id || 'anon'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, (payload: any) => {
        const row = payload.new || payload.old;
        if (row?.department === 'maintenance') void fetchTickets();
      })
      .subscribe();
    const onCreated = () => void fetchTickets();
    window.addEventListener('maintenance-ticket-created', onCreated);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener('maintenance-ticket-created', onCreated);
    };
  }, [fetchTickets, profile?.id]);

  const visibleTickets = useMemo(() => tickets.filter((ticket) => {
    if (filter === 'all') return true;
    if (filter === 'done') return ticket.status === 'completed';
    if (filter === 'approval') return !!ticket.pending_supervisor_approval;
    if (filter === 'hold') return !!ticket.on_hold && ticket.status !== 'completed';
    if (filter === 'progress') return ticket.status === 'in_progress' && !ticket.on_hold && !ticket.pending_supervisor_approval;
    return ticket.status !== 'completed' && !ticket.on_hold && !ticket.pending_supervisor_approval;
  }), [tickets, filter]);

  const counts = useMemo(() => ({
    active: tickets.filter((t) => t.status !== 'completed' && !t.on_hold && !t.pending_supervisor_approval).length,
    progress: tickets.filter((t) => t.status === 'in_progress' && !t.on_hold && !t.pending_supervisor_approval).length,
    hold: tickets.filter((t) => t.status !== 'completed' && t.on_hold).length,
    approval: tickets.filter((t) => t.pending_supervisor_approval).length,
    done: tickets.filter((t) => t.status === 'completed').length,
  }), [tickets]);

  const statusLabel = (ticket: MaintenanceTicket) => {
    if (ticket.pending_supervisor_approval) return c.approval;
    if (ticket.status === 'completed') return c.statusDone;
    if (ticket.on_hold) return c.hold;
    return ticket.status === 'in_progress' ? c.statusProgress : c.statusOpen;
  };

  const statusClass = (ticket: MaintenanceTicket) => {
    if (ticket.pending_supervisor_approval) return 'bg-blue-100 text-blue-800 border-blue-200';
    if (ticket.status === 'completed') return 'bg-green-100 text-green-800 border-green-200';
    if (ticket.on_hold) return 'bg-amber-100 text-amber-800 border-amber-200';
    return ticket.status === 'in_progress'
      ? 'bg-violet-100 text-violet-800 border-violet-200'
      : 'bg-slate-100 text-slate-800 border-slate-200';
  };

  const priorityClass = (priority: string) => priority === 'urgent'
    ? 'bg-red-100 text-red-800 border-red-200'
    : priority === 'high' ? 'bg-orange-100 text-orange-800 border-orange-200'
      : priority === 'low' ? 'bg-green-50 text-green-700 border-green-200'
        : 'bg-yellow-50 text-yellow-800 border-yellow-200';

  return (
    <div className="space-y-4 p-2 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold sm:text-2xl"><Wrench className="h-5 w-5 text-primary" />{c.title}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{c.subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void fetchTickets()}><RefreshCw className="mr-1 h-4 w-4" />{c.refresh}</Button>
          {canCreate && <Button onClick={() => setIsAddDialogOpen(true)} className="min-h-10"><Plus className="mr-2 h-4 w-4" />{c.report}</Button>}
        </div>
      </div>

      <MaintenanceIssueAnalytics />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {([
          ['active', counts.active], ['progress', counts.progress], ['hold', counts.hold],
          ['approval', counts.approval], ['done', counts.done],
        ] as const).map(([key, count]) => (
          <Card key={key}><CardContent className="p-3"><div className="text-xs text-muted-foreground">{c[key]}</div><div className="text-xl font-bold">{count}</div></CardContent></Card>
        ))}
      </div>

      <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-muted/50 p-1">
          {(['active', 'progress', 'hold', 'approval', 'done', 'all'] as const).map((key) => (
            <TabsTrigger key={key} value={key}>{c[key]}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {loading ? <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" /></div>
        : visibleTickets.length === 0 ? (
          <Card><CardContent className="py-12 text-center"><CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground" /><p className="text-muted-foreground">{c.noItems}</p></CardContent></Card>
        ) : <div className="grid gap-3">{visibleTickets.map((ticket) => (
          <Card key={ticket.id} className="border-l-4 border-l-primary/70 shadow-sm">
            <CardHeader className="p-3 pb-2 sm:p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-base sm:text-lg">Room {ticket.room_number} · {ticket.title}</CardTitle>
                    <Badge variant="outline" className={priorityClass(ticket.priority)}>{ticket.priority.toUpperCase()}</Badge>
                    <Badge variant="outline" className={statusClass(ticket)}>{statusLabel(ticket)}</Badge>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{ticket.hotel || '—'}</span>
                    <span>·</span><span>{ticket.ticket_number}</span><span>·</span>
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(ticket.created_at).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 p-3 pt-0 sm:p-4 sm:pt-0">
              <div className="rounded-lg bg-muted/45 p-3">
                <div className="mb-1 flex items-center gap-1 text-xs font-semibold text-muted-foreground"><AlertTriangle className="h-3.5 w-3.5" />{c.issue}</div>
                <p className="whitespace-pre-wrap text-sm">{ticket.description}</p>
              </div>
              <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                <div className="rounded-lg border p-2.5"><div className="text-[11px] text-muted-foreground">{c.reportedBy}</div><div className="flex items-center gap-1 font-semibold"><User className="h-3.5 w-3.5" />{ticket.created_by_profile?.full_name || 'Unknown'}</div></div>
                <div className="rounded-lg border p-2.5"><div className="text-[11px] text-muted-foreground">{c.assignedTo}</div><div className="font-semibold">{ticket.assigned_to_profile?.full_name || c.unassigned}</div></div>
                <div className="rounded-lg border p-2.5"><div className="text-[11px] text-muted-foreground">{c.source}</div><div className="font-semibold">{ticket.source?.startsWith('housekeeping') ? c.housekeeping : ticket.assignment_method?.startsWith('auto') ? c.auto : c.manual}</div></div>
              </div>
              {ticket.status !== 'completed' && !ticket.assigned_to && ticket.assignment_method === 'unassigned_no_staff_on_duty' && (
                <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800"><Hourglass className="h-4 w-4 shrink-0" />{c.noDuty}</div>
              )}
              {ticket.on_hold && ticket.hold_reason && ticket.status !== 'completed' && (
                <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800"><PauseCircle className="h-4 w-4 shrink-0" /><span><strong>{c.holdReason}:</strong> {ticket.hold_reason.replace(/_/g, ' ')}</span></div>
              )}
              {ticket.resolution_text && <div className="rounded-lg border border-green-200 bg-green-50 p-2.5 text-xs text-green-800"><strong>{c.resolution}:</strong> {ticket.resolution_text}</div>}
              <MaintenanceIssueEvidence originalPhotos={ticket.attachment_urls} completionPhotos={ticket.completion_photos} />
              {canManage && <MaintenanceManagerControls ticket={ticket} language={language} onUpdated={() => void fetchTickets()} />}
            </CardContent>
          </Card>
        ))}</div>}

      <MaintenanceIssueDialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}
        roomId={null} roomNumber="General"
        onIssueReported={() => { setIsAddDialogOpen(false); void fetchTickets(); }} />
    </div>
  );
}
