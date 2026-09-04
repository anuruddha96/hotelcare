import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { AlertTriangle, Building2, CheckCircle2, Clock, Eye, Hourglass, MapPin, PauseCircle, Plus, User, Wrench } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { hasManagerPowers } from '@/lib/roleAccess';
import { MaintenanceIssueDialog } from './MaintenanceIssueDialog';

interface MaintenanceTicket {
  id: string;
  ticket_number: string;
  title: string;
  description: string;
  room_number: string;
  hotel: string | null;
  priority: string;
  status: 'open' | 'in_progress' | 'completed';
  created_at: string;
  updated_at: string;
  assigned_to: string | null;
  attachment_urls: string[] | null;
  completion_photos: string[] | null;
  pending_supervisor_approval: boolean | null;
  on_hold: boolean | null;
  hold_reason: string | null;
  resolution_text: string | null;
  source: string | null;
  assignment_method: string | null;
  created_by_profile?: { full_name: string; nickname?: string | null } | null;
  assigned_to_profile?: { full_name: string; nickname?: string | null } | null;
}

const textByLanguage: Record<string, Record<string, string>> = {
  en: {
    title: 'Maintenance', subtitle: 'One live maintenance queue shared with Housekeeping and the main Maintenance module.',
    report: 'Report issue', active: 'Active', progress: 'In progress', hold: 'Pending / on hold', approval: 'Awaiting approval', done: 'Done', all: 'All',
    noItems: 'No maintenance tickets in this view.', reportedBy: 'Reported by', assignedTo: 'Assigned to', unassigned: 'Unassigned',
    noDuty: 'No maintenance staff was signed in when this was reported.', issue: 'Issue', holdReason: 'Pending reason', resolution: 'Resolution', attachments: 'Attachments',
    created: 'Created', source: 'Source', auto: 'Auto-routed', manual: 'Manual', housekeeping: 'Housekeeping', statusOpen: 'Open', statusProgress: 'In progress', statusDone: 'Done',
  },
  hu: {
    title: 'Karbantartás', subtitle: 'Egy közös, élő karbantartási sor a Takarítás és a fő Karbantartás modul számára.',
    report: 'Hiba jelentése', active: 'Aktív', progress: 'Folyamatban', hold: 'Függőben / várakozik', approval: 'Jóváhagyásra vár', done: 'Kész', all: 'Összes',
    noItems: 'Nincs karbantartási jegy ebben a nézetben.', reportedBy: 'Jelentette', assignedTo: 'Hozzárendelve', unassigned: 'Nincs kiosztva',
    noDuty: 'A jelentéskor nem volt bejelentkezett karbantartó.', issue: 'Hiba', holdReason: 'Várakozás oka', resolution: 'Megoldás', attachments: 'Mellékletek',
    created: 'Létrehozva', source: 'Forrás', auto: 'Automatikus', manual: 'Kézi', housekeeping: 'Takarítás', statusOpen: 'Nyitott', statusProgress: 'Folyamatban', statusDone: 'Kész',
  },
};

export function MaintenancePhotosManagement() {
  const { language } = useTranslation();
  const c = textByLanguage[language] || textByLanguage.en;
  const { profile } = useAuth();
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'active' | 'progress' | 'hold' | 'approval' | 'done' | 'all'>('active');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const canCreate = hasManagerPowers(profile?.role);

  const fetchTickets = useCallback(async () => {
    if (!profile?.organization_slug) return;
    setLoading(true);
    try {
      const hotelKeys = await resolveHotelKeys(profile.assigned_hotel);
      let query = (supabase as any)
        .from('tickets')
        .select(`
          id, ticket_number, title, description, room_number, hotel, priority, status,
          created_at, updated_at, assigned_to, attachment_urls, completion_photos,
          pending_supervisor_approval, on_hold, hold_reason, resolution_text,
          source, assignment_method,
          created_by_profile:profiles!tickets_created_by_fkey(full_name, nickname),
          assigned_to_profile:profiles!tickets_assigned_to_fkey(full_name, nickname)
        `)
        .eq('department', 'maintenance')
        .eq('organization_slug', profile.organization_slug)
        .order('created_at', { ascending: false })
        .limit(300);
      if (hotelKeys.length) query = query.in('hotel', hotelKeys);
      const { data, error } = await query;
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

  const visibleTickets = useMemo(() => tickets.filter(ticket => {
    if (filter === 'all') return true;
    if (filter === 'done') return ticket.status === 'completed';
    if (filter === 'approval') return !!ticket.pending_supervisor_approval;
    if (filter === 'hold') return !!ticket.on_hold;
    if (filter === 'progress') return ticket.status === 'in_progress' && !ticket.on_hold && !ticket.pending_supervisor_approval;
    return ticket.status !== 'completed' && !ticket.on_hold && !ticket.pending_supervisor_approval;
  }), [tickets, filter]);

  const counts = useMemo(() => ({
    active: tickets.filter(t => t.status !== 'completed' && !t.on_hold && !t.pending_supervisor_approval).length,
    progress: tickets.filter(t => t.status === 'in_progress' && !t.on_hold && !t.pending_supervisor_approval).length,
    hold: tickets.filter(t => t.on_hold).length,
    approval: tickets.filter(t => t.pending_supervisor_approval).length,
    done: tickets.filter(t => t.status === 'completed').length,
  }), [tickets]);

  const statusLabel = (ticket: MaintenanceTicket) => {
    if (ticket.pending_supervisor_approval) return c.approval;
    if (ticket.on_hold) return c.hold;
    if (ticket.status === 'in_progress') return c.statusProgress;
    if (ticket.status === 'completed') return c.statusDone;
    return c.statusOpen;
  };

  const statusClass = (ticket: MaintenanceTicket) => {
    if (ticket.pending_supervisor_approval) return 'bg-blue-100 text-blue-800 border-blue-200';
    if (ticket.on_hold) return 'bg-amber-100 text-amber-800 border-amber-200';
    if (ticket.status === 'in_progress') return 'bg-violet-100 text-violet-800 border-violet-200';
    if (ticket.status === 'completed') return 'bg-green-100 text-green-800 border-green-200';
    return 'bg-slate-100 text-slate-800 border-slate-200';
  };

  const priorityClass = (priority: string) => priority === 'urgent'
    ? 'bg-red-100 text-red-800 border-red-200'
    : priority === 'high'
      ? 'bg-orange-100 text-orange-800 border-orange-200'
      : priority === 'low'
        ? 'bg-green-50 text-green-700 border-green-200'
        : 'bg-yellow-50 text-yellow-800 border-yellow-200';

  return (
    <div className="space-y-4 p-2 sm:p-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold flex items-center gap-2"><Wrench className="h-5 w-5 text-primary" />{c.title}</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{c.subtitle}</p>
        </div>
        {canCreate && <Button onClick={() => setIsAddDialogOpen(true)} className="h-10"><Plus className="h-4 w-4 mr-2" />{c.report}</Button>}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">{c.active}</div><div className="text-xl font-bold">{counts.active}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">{c.progress}</div><div className="text-xl font-bold">{counts.progress}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">{c.hold}</div><div className="text-xl font-bold">{counts.hold}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">{c.approval}</div><div className="text-xl font-bold">{counts.approval}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">{c.done}</div><div className="text-xl font-bold">{counts.done}</div></CardContent></Card>
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
        <TabsList className="w-full h-auto flex flex-wrap justify-start gap-1 bg-muted/50 p-1">
          <TabsTrigger value="active">{c.active}</TabsTrigger>
          <TabsTrigger value="progress">{c.progress}</TabsTrigger>
          <TabsTrigger value="hold">{c.hold}</TabsTrigger>
          <TabsTrigger value="approval">{c.approval}</TabsTrigger>
          <TabsTrigger value="done">{c.done}</TabsTrigger>
          <TabsTrigger value="all">{c.all}</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
      ) : visibleTickets.length === 0 ? (
        <Card><CardContent className="py-12 text-center"><CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-muted-foreground" /><p className="text-muted-foreground">{c.noItems}</p></CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {visibleTickets.map(ticket => (
            <Card key={ticket.id} className="border-l-4 border-l-primary/70 shadow-sm">
              <CardHeader className="pb-2 p-3 sm:p-4">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <CardTitle className="text-base sm:text-lg">Room {ticket.room_number} · {ticket.title}</CardTitle>
                      <Badge variant="outline" className={priorityClass(ticket.priority)}>{ticket.priority.toUpperCase()}</Badge>
                      <Badge variant="outline" className={statusClass(ticket)}>{statusLabel(ticket)}</Badge>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground mt-1.5">
                      <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{ticket.hotel || '—'}</span>
                      <span>·</span><span>{ticket.ticket_number}</span>
                      <span>·</span><span className="flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(ticket.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-3 sm:p-4 pt-0 space-y-3">
                <div className="rounded-lg bg-muted/45 p-3">
                  <div className="text-xs font-semibold text-muted-foreground mb-1 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />{c.issue}</div>
                  <p className="text-sm whitespace-pre-wrap">{ticket.description}</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                  <div className="rounded-lg border p-2.5"><div className="text-[11px] text-muted-foreground">{c.reportedBy}</div><div className="font-semibold flex items-center gap-1"><User className="h-3.5 w-3.5" />{ticket.created_by_profile?.full_name || 'Unknown'}</div></div>
                  <div className="rounded-lg border p-2.5"><div className="text-[11px] text-muted-foreground">{c.assignedTo}</div><div className="font-semibold">{ticket.assigned_to_profile?.full_name || c.unassigned}</div></div>
                  <div className="rounded-lg border p-2.5"><div className="text-[11px] text-muted-foreground">{c.source}</div><div className="font-semibold">{ticket.source?.startsWith('housekeeping') ? c.housekeeping : ticket.assignment_method?.startsWith('auto') ? c.auto : c.manual}</div></div>
                </div>

                {!ticket.assigned_to && ticket.assignment_method === 'unassigned_no_staff_on_duty' && (
                  <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex gap-2"><Hourglass className="h-4 w-4 shrink-0" />{c.noDuty}</div>
                )}
                {ticket.on_hold && ticket.hold_reason && (
                  <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex gap-2"><PauseCircle className="h-4 w-4 shrink-0" /><span><strong>{c.holdReason}:</strong> {ticket.hold_reason.replace(/_/g, ' ')}</span></div>
                )}
                {ticket.resolution_text && (
                  <div className="text-xs text-green-800 bg-green-50 border border-green-200 rounded-lg p-2.5"><strong>{c.resolution}:</strong> {ticket.resolution_text}</div>
                )}

                {!!ticket.attachment_urls?.length && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-muted-foreground">{c.attachments} ({ticket.attachment_urls.length})</div>
                    <div className="flex gap-2 flex-wrap">
                      {ticket.attachment_urls.map((url, idx) => (
                        <Dialog key={`${ticket.id}-${idx}`}>
                          <DialogTrigger asChild>
                            <Button variant="outline" size="sm"><Eye className="h-3.5 w-3.5 mr-1" />{idx + 1}</Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-4xl">
                            {url.startsWith('http') ? <img src={url} alt={`Maintenance attachment ${idx + 1}`} className="max-h-[80vh] w-auto mx-auto" /> : <p className="text-sm break-all">{url}</p>}
                          </DialogContent>
                        </Dialog>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <MaintenanceIssueDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        roomId={null}
        roomNumber="General"
        onIssueReported={() => { setIsAddDialogOpen(false); void fetchTickets(); }}
      />
    </div>
  );
}
