import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { getSignedPhotoUrls } from '@/lib/storageUrls';
import { canManageMaintenance } from './MaintenanceManagerControls';
import { MaintenanceAutoTranslation } from './MaintenanceAutoTranslation';
import { Building2, CheckCircle2, Clock3, ExternalLink, Eye, RefreshCw, User, UserCheck, Wrench } from 'lucide-react';

type ActiveMaintenanceTicket = {
  id: string;
  ticket_number: string;
  title: string;
  description: string;
  room_number: string;
  hotel: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'completed';
  created_at: string;
  updated_at: string;
  assigned_to: string | null;
  attachment_urls: string[] | null;
  on_hold: boolean | null;
  hold_reason: string | null;
  source: string | null;
  assignment_method: string | null;
  created_by_profile?: { full_name: string; nickname?: string | null; role?: string | null } | null;
  assigned_to_profile?: { full_name: string; nickname?: string | null } | null;
};

type Copy = {
  title: string; subtitle: string; active: string; noActive: string; room: string;
  reportedBy: string; assignedTo: string; unassigned: string; noDuty: string;
  waitingCheckIn: string; open: string; inProgress: string; pending: string;
  attachments: string; refresh: string; source: string; housekeeping: string;
  reception: string; manual: string; informationOnly: string; openIssue: string;
  updated: string; loadError: string;
};

const english: Copy = {
  title: 'Forwarded Maintenance',
  subtitle: 'Active maintenance requests already forwarded from Housekeeping, Reception or management.',
  active: 'active', noActive: 'No active forwarded maintenance requests for this hotel.',
  room: 'Room', reportedBy: 'Reported by', assignedTo: 'Assigned to', unassigned: 'Unassigned',
  noDuty: 'No maintenance member is signed in', waitingCheckIn: 'This request will be assigned automatically when maintenance checks in.',
  open: 'Open', inProgress: 'In progress', pending: 'Pending / on hold', attachments: 'Attachments', refresh: 'Refresh',
  source: 'Source', housekeeping: 'Housekeeping', reception: 'Reception / management', manual: 'Manual entry',
  informationOnly: 'For visibility only — final approval is requested after maintenance submits the completed repair.',
  openIssue: 'Open maintenance issue', updated: 'Updated', loadError: 'Maintenance requests could not be loaded. Retry.',
};
const copies: Record<string, Copy> = {
  en: english,
  hu: {
    title: 'Továbbított karbantartás', subtitle: 'Aktív karbantartási kérések, amelyeket a Takarítás, Recepció vagy a vezetőség már továbbított.',
    active: 'aktív', noActive: 'Nincs aktív továbbított karbantartási kérés ehhez a hotelhez.',
    room: 'Szoba', reportedBy: 'Jelentette', assignedTo: 'Hozzárendelve', unassigned: 'Nincs kiosztva',
    noDuty: 'Nincs bejelentkezett karbantartó', waitingCheckIn: 'A kérés automatikusan kiosztásra kerül, amikor a karbantartó bejelentkezik.',
    open: 'Nyitott', inProgress: 'Folyamatban', pending: 'Függőben / várakozik', attachments: 'Mellékletek', refresh: 'Frissítés',
    source: 'Forrás', housekeeping: 'Takarítás', reception: 'Recepció / vezetőség', manual: 'Kézi rögzítés',
    informationOnly: 'Csak tájékoztatás — a végső jóváhagyás akkor szükséges, amikor a karbantartó befejezettként beküldi a javítást.',
    openIssue: 'Karbantartási hiba megnyitása', updated: 'Frissítve', loadError: 'A karbantartási kérések nem tölthetők be. Próbálja újra.',
  },
  es: { ...english, title: 'Mantenimiento reenviado', subtitle: 'Solicitudes de mantenimiento activas ya reenviadas desde Limpieza, Recepción o gerencia.', active: 'activas', room: 'Habitación', openIssue: 'Abrir incidencia', updated: 'Actualizado' },
  vi: { ...english, title: 'Bảo trì đã chuyển tiếp', subtitle: 'Yêu cầu bảo trì đang hoạt động đã chuyển từ Buồng phòng, Lễ tân hoặc quản lý.', active: 'đang hoạt động', room: 'Phòng', openIssue: 'Mở sự cố', updated: 'Cập nhật' },
  mn: { ...english, title: 'Шилжүүлсэн засвар үйлчилгээ', active: 'идэвхтэй', room: 'Өрөө', openIssue: 'Засварын хүсэлт нээх' },
  az: { ...english, title: 'Yönləndirilmiş texniki xidmət', active: 'aktiv', room: 'Otaq', openIssue: 'Texniki problemi aç' },
  tl: { ...english, title: 'Na-forward na Maintenance', active: 'aktibo', room: 'Kuwarto', openIssue: 'Buksan ang isyu' },
  uk: { ...english, title: 'Передані заявки на ремонт', active: 'активні', room: 'Кімната', openIssue: 'Відкрити заявку' },
  ru: { ...english, title: 'Переданные заявки на ремонт', active: 'активные', room: 'Комната', openIssue: 'Открыть заявку', updated: 'Обновлено' },
};

interface ForwardedMaintenanceApprovalsProps { hideWhenEmpty?: boolean }

export function ForwardedMaintenanceApprovals({ hideWhenEmpty = false }: ForwardedMaintenanceApprovalsProps = {}) {
  const { profile } = useAuth();
  const { language } = useTranslation();
  const navigate = useNavigate();
  const c = copies[language] || copies.en;
  const [tickets, setTickets] = useState<ActiveMaintenanceTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string[]>>({});
  const requestId = useRef(0);

  const loadAttachments = useCallback(async (rows: ActiveMaintenanceTicket[], revision: number) => {
    const resolved: Record<string, string[]> = {};
    for (const ticket of rows) {
      const direct: string[] = [];
      const paths: string[] = [];
      for (const value of ticket.attachment_urls || []) {
        if (/^https?:\/\//i.test(value)) direct.push(value);
        else paths.push(value);
      }
      const signed = paths.length ? await getSignedPhotoUrls(paths, 'ticket-attachments') : [];
      resolved[ticket.id] = [...direct, ...signed];
    }
    if (revision === requestId.current) setAttachmentUrls(resolved);
  }, []);

  const fetchTickets = useCallback(async () => {
    const revision = ++requestId.current;
    setLoading(true);
    setLoadError(false);
    if (!profile?.organization_slug || !profile.assigned_hotel || !canManageMaintenance(profile.role)) {
      setTickets([]); setAttachmentUrls({}); setLoading(false); return;
    }
    try {
      const hotelKeys = await resolveHotelKeys(profile.assigned_hotel);
      if (!hotelKeys.length) throw new Error('Selected hotel unavailable');
      const { data, error } = await (supabase as any).from('tickets')
        .select(`id, ticket_number, title, description, room_number, hotel, priority, status,
          created_at, updated_at, assigned_to, attachment_urls, on_hold, hold_reason,
          source, assignment_method,
          created_by_profile:profiles!tickets_created_by_fkey(full_name, nickname, role),
          assigned_to_profile:profiles!tickets_assigned_to_fkey(full_name, nickname)`)
        .eq('department', 'maintenance')
        .eq('organization_slug', profile.organization_slug)
        .in('hotel', hotelKeys)
        .neq('status', 'completed')
        .or('pending_supervisor_approval.eq.false,pending_supervisor_approval.is.null')
        .neq('source', 'housekeeping_legacy_backfill')
        .order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      if (revision !== requestId.current) return;
      const rows = (data || []) as ActiveMaintenanceTicket[];
      setTickets(rows);
      void loadAttachments(rows, revision);
    } catch (error) {
      console.error('[ForwardedMaintenanceApprovals] load failed:', error);
      if (revision === requestId.current) { setTickets([]); setAttachmentUrls({}); setLoadError(true); }
    } finally { if (revision === requestId.current) setLoading(false); }
  }, [profile?.organization_slug, profile?.assigned_hotel, profile?.role, loadAttachments]);

  useEffect(() => {
    void fetchTickets();
    if (!profile?.id || !profile.organization_slug) return;
    const channel = supabase.channel(`supervisor-forwarded-maintenance-${profile.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'tickets',
        filter: `organization_slug=eq.${profile.organization_slug}`,
      }, (payload: any) => {
        const row = payload.new || payload.old;
        if (row?.department === 'maintenance') void fetchTickets();
      }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [fetchTickets, profile?.id, profile?.organization_slug]);

  const sortedTickets = useMemo(() => {
    const rank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
    return [...tickets].sort((a, b) => (rank[a.priority] ?? 4) - (rank[b.priority] ?? 4) ||
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [tickets]);
  const statusLabel = (ticket: ActiveMaintenanceTicket) => ticket.on_hold ? c.pending : ticket.status === 'in_progress' ? c.inProgress : c.open;
  const sourceLabel = (ticket: ActiveMaintenanceTicket) => ticket.source?.startsWith('housekeeping') ? c.housekeeping : ticket.source === 'manual' ? c.reception : c.manual;
  const priorityClass = (priority: string) => priority === 'urgent' ? 'bg-red-100 text-red-800 border-red-200' :
    priority === 'high' ? 'bg-orange-100 text-orange-800 border-orange-200' : priority === 'low' ? 'bg-green-100 text-green-800 border-green-200' : 'bg-yellow-100 text-yellow-800 border-yellow-200';

  if (hideWhenEmpty && !loading && !loadError && sortedTickets.length === 0) return null;
  return <section id="forwarded-maintenance-approvals" className="space-y-3">
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Wrench className="h-5 w-5 text-primary" />{c.title}</h2>
          <Badge variant="outline">{tickets.length} {c.active}</Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-1">{c.subtitle}</p>
        <p className="text-xs text-muted-foreground mt-1">{c.informationOnly}</p>
      </div>
      <Button variant="outline" size="sm" onClick={() => void fetchTickets()} disabled={loading}>
        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        <span className="hidden sm:inline ml-1">{c.refresh}</span>
      </Button>
    </div>
    {loadError ? <Card><CardContent className="py-6 text-sm text-destructive" role="alert">{c.loadError}
      <Button variant="outline" size="sm" className="ml-2" onClick={() => void fetchTickets()}>{c.refresh}</Button>
    </CardContent></Card> : loading ? <Card><CardContent className="py-8 text-center text-muted-foreground">…</CardContent></Card> :
      sortedTickets.length === 0 ? <Card><CardContent className="py-8 text-center">
        <CheckCircle2 className="h-9 w-9 mx-auto mb-2 text-green-600" />
        <p className="text-sm text-muted-foreground">{c.noActive}</p>
      </CardContent></Card> : <div className="grid gap-3">
        {sortedTickets.map(ticket => <Card key={ticket.id} className="border-l-4 border-l-primary/70 shadow-sm">
          <CardHeader className="p-3 sm:p-4 pb-2">
            <CardTitle className="text-base sm:text-lg flex items-center gap-2 flex-wrap">
              <span>{c.room} {ticket.room_number}</span>
              <Badge variant="outline" className={priorityClass(ticket.priority)}>{ticket.priority.toUpperCase()}</Badge>
              <Badge variant="secondary">{statusLabel(ticket)}</Badge>
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground mt-1.5">
              <span>{ticket.ticket_number}</span><span>·</span>
              <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{ticket.hotel || '—'}</span><span>·</span>
              <span className="flex items-center gap-1"><Clock3 className="h-3 w-3" />{c.updated}: {new Date(ticket.updated_at).toLocaleString()}</span>
            </div>
          </CardHeader>
          <CardContent className="p-3 sm:p-4 pt-0 space-y-3">
            <MaintenanceAutoTranslation ticketId={ticket.id} revision={ticket.updated_at}
              fields={{ title: ticket.title, description: ticket.description, hold: ticket.hold_reason }} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
              <div className="rounded-lg border p-2.5"><div className="text-[11px] text-muted-foreground flex items-center gap-1"><User className="h-3 w-3" />{c.reportedBy}</div>
                <div className="font-semibold truncate">{ticket.created_by_profile?.full_name || '—'}</div></div>
              <div className="rounded-lg border p-2.5"><div className="text-[11px] text-muted-foreground flex items-center gap-1"><UserCheck className="h-3 w-3" />{c.assignedTo}</div>
                <div className="font-semibold truncate">{ticket.assigned_to_profile?.full_name || c.unassigned}</div></div>
              <div className="rounded-lg border p-2.5"><div className="text-[11px] text-muted-foreground">{c.source}</div>
                <div className="font-semibold truncate">{sourceLabel(ticket)}</div></div>
            </div>
            {!ticket.assigned_to && <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 p-2.5 text-xs">
              <strong>{c.noDuty}.</strong> {c.waitingCheckIn}
            </div>}
            {!!attachmentUrls[ticket.id]?.length && <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">{c.attachments} ({attachmentUrls[ticket.id].length})</div>
              <div className="flex gap-2 flex-wrap">{attachmentUrls[ticket.id].map((url, index) => <Dialog key={`${ticket.id}-${index}`}>
                <DialogTrigger asChild><Button variant="outline" size="sm"><Eye className="h-3.5 w-3.5 mr-1" />{index + 1}</Button></DialogTrigger>
                <DialogContent className="max-w-4xl"><img src={url} alt={`Maintenance attachment ${index + 1}`} className="max-h-[80vh] w-auto mx-auto" /></DialogContent>
              </Dialog>)}</div>
            </div>}
            <Button type="button" className="w-full sm:w-auto min-h-11" onClick={() => {
              if (!profile?.organization_slug || !profile.assigned_hotel || !canManageMaintenance(profile.role)) return;
              navigate(`/${encodeURIComponent(profile.organization_slug)}?tab=tickets&maintenanceIssue=${encodeURIComponent(ticket.id)}`);
            }}><ExternalLink className="h-4 w-4 mr-2" />{c.openIssue}</Button>
          </CardContent>
        </Card>)}
      </div>}
  </section>;
}
