import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { getSignedPhotoUrls } from '@/lib/storageUrls';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock3,
  Eye,
  RefreshCw,
  User,
  UserCheck,
  Wrench,
} from 'lucide-react';

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
  title: string;
  subtitle: string;
  active: string;
  noActive: string;
  room: string;
  hotel: string;
  reportedBy: string;
  assignedTo: string;
  unassigned: string;
  noDuty: string;
  waitingCheckIn: string;
  open: string;
  inProgress: string;
  pending: string;
  priority: string;
  attachments: string;
  refresh: string;
  source: string;
  housekeeping: string;
  reception: string;
  manual: string;
  informationOnly: string;
};

const copies: Record<string, Copy> = {
  en: {
    title: 'Forwarded Maintenance',
    subtitle: 'Active maintenance requests already forwarded from Housekeeping, Reception or management.',
    active: 'active',
    noActive: 'No active forwarded maintenance requests for this hotel.',
    room: 'Room', hotel: 'Hotel', reportedBy: 'Reported by', assignedTo: 'Assigned to', unassigned: 'Unassigned',
    noDuty: 'No maintenance member is signed in', waitingCheckIn: 'This request will be assigned automatically when maintenance checks in.',
    open: 'Open', inProgress: 'In progress', pending: 'Pending / on hold', priority: 'Priority', attachments: 'Attachments', refresh: 'Refresh',
    source: 'Source', housekeeping: 'Housekeeping', reception: 'Reception / management', manual: 'Manual entry',
    informationOnly: 'For visibility only — final approval is requested after maintenance submits the completed repair.',
  },
  hu: {
    title: 'Továbbított karbantartás',
    subtitle: 'Aktív karbantartási kérések, amelyeket a Takarítás, Recepció vagy a vezetőség már továbbított.',
    active: 'aktív',
    noActive: 'Nincs aktív továbbított karbantartási kérés ehhez a hotelhez.',
    room: 'Szoba', hotel: 'Hotel', reportedBy: 'Jelentette', assignedTo: 'Hozzárendelve', unassigned: 'Nincs kiosztva',
    noDuty: 'Nincs bejelentkezett karbantartó', waitingCheckIn: 'A kérés automatikusan kiosztásra kerül, amikor a karbantartó bejelentkezik.',
    open: 'Nyitott', inProgress: 'Folyamatban', pending: 'Függőben / várakozik', priority: 'Prioritás', attachments: 'Mellékletek', refresh: 'Frissítés',
    source: 'Forrás', housekeeping: 'Takarítás', reception: 'Recepció / vezetőség', manual: 'Kézi rögzítés',
    informationOnly: 'Csak tájékoztatás — a végső jóváhagyás akkor szükséges, amikor a karbantartó befejezettként beküldi a javítást.',
  },
  es: {
    title: 'Mantenimiento reenviado',
    subtitle: 'Solicitudes de mantenimiento activas ya reenviadas desde Limpieza, Recepción o gerencia.',
    active: 'activas', noActive: 'No hay solicitudes de mantenimiento activas reenviadas para este hotel.',
    room: 'Habitación', hotel: 'Hotel', reportedBy: 'Reportado por', assignedTo: 'Asignado a', unassigned: 'Sin asignar',
    noDuty: 'No hay personal de mantenimiento conectado', waitingCheckIn: 'La solicitud se asignará automáticamente cuando mantenimiento inicie sesión.',
    open: 'Abierto', inProgress: 'En curso', pending: 'Pendiente / en pausa', priority: 'Prioridad', attachments: 'Adjuntos', refresh: 'Actualizar',
    source: 'Origen', housekeeping: 'Limpieza', reception: 'Recepción / gerencia', manual: 'Entrada manual',
    informationOnly: 'Solo para visibilidad; la aprobación final se solicita cuando mantenimiento envía la reparación terminada.',
  },
  vi: {
    title: 'Bảo trì đã chuyển tiếp',
    subtitle: 'Các yêu cầu bảo trì đang hoạt động đã được chuyển từ Buồng phòng, Lễ tân hoặc quản lý.',
    active: 'đang hoạt động', noActive: 'Không có yêu cầu bảo trì đang hoạt động cho khách sạn này.',
    room: 'Phòng', hotel: 'Khách sạn', reportedBy: 'Người báo', assignedTo: 'Đã giao cho', unassigned: 'Chưa giao',
    noDuty: 'Chưa có nhân viên bảo trì đăng nhập', waitingCheckIn: 'Yêu cầu sẽ tự động được giao khi nhân viên bảo trì đăng nhập.',
    open: 'Mở', inProgress: 'Đang xử lý', pending: 'Đang chờ / tạm dừng', priority: 'Ưu tiên', attachments: 'Tệp đính kèm', refresh: 'Làm mới',
    source: 'Nguồn', housekeeping: 'Buồng phòng', reception: 'Lễ tân / quản lý', manual: 'Nhập thủ công',
    informationOnly: 'Chỉ để theo dõi — phê duyệt cuối cùng sẽ được yêu cầu sau khi bảo trì gửi công việc đã hoàn tất.',
  },
  mn: {
    title: 'Шилжүүлсэн засвар үйлчилгээ',
    subtitle: 'Өрөө үйлчилгээ, Ресепшн эсвэл удирдлагаас аль хэдийн шилжүүлсэн идэвхтэй засварын хүсэлтүүд.',
    active: 'идэвхтэй', noActive: 'Энэ зочид буудалд идэвхтэй шилжүүлсэн засварын хүсэлт алга.',
    room: 'Өрөө', hotel: 'Зочид буудал', reportedBy: 'Мэдээлсэн', assignedTo: 'Хуваарилсан', unassigned: 'Хуваарилаагүй',
    noDuty: 'Засварын ажилтан нэвтрээгүй байна', waitingCheckIn: 'Засварын ажилтан нэвтрэхэд хүсэлт автоматаар хуваарилагдана.',
    open: 'Нээлттэй', inProgress: 'Явагдаж байна', pending: 'Хүлээгдэж / түр зогссон', priority: 'Чухал байдал', attachments: 'Хавсралт', refresh: 'Шинэчлэх',
    source: 'Эх үүсвэр', housekeeping: 'Өрөө үйлчилгээ', reception: 'Ресепшн / удирдлага', manual: 'Гараар оруулсан',
    informationOnly: 'Зөвхөн харагдац — засварын ажилтан ажлыг дуусган илгээсний дараа эцсийн зөвшөөрөл хүснэ.',
  },
  az: {
    title: 'Yönləndirilmiş texniki xidmət',
    subtitle: 'Housekeeping, Resepsiya və ya rəhbərlikdən artıq yönləndirilmiş aktiv texniki xidmət sorğuları.',
    active: 'aktiv', noActive: 'Bu otel üçün aktiv yönləndirilmiş texniki xidmət sorğusu yoxdur.',
    room: 'Otaq', hotel: 'Otel', reportedBy: 'Bildirən', assignedTo: 'Təyin edildi', unassigned: 'Təyin edilməyib',
    noDuty: 'Giriş etmiş texniki işçi yoxdur', waitingCheckIn: 'Texniki işçi giriş etdikdə sorğu avtomatik təyin olunacaq.',
    open: 'Açıq', inProgress: 'İcradadır', pending: 'Gözləmədə / dayandırılıb', priority: 'Prioritet', attachments: 'Əlavələr', refresh: 'Yenilə',
    source: 'Mənbə', housekeeping: 'Housekeeping', reception: 'Resepsiya / rəhbərlik', manual: 'Əl ilə daxil edilib',
    informationOnly: 'Yalnız məlumat üçün — yekun təsdiq texniki işçi təmiri tamamlayıb göndərdikdən sonra tələb olunur.',
  },
  tl: {
    title: 'Na-forward na Maintenance',
    subtitle: 'Mga aktibong maintenance request na na-forward na mula Housekeeping, Reception o management.',
    active: 'aktibo', noActive: 'Walang aktibong na-forward na maintenance request para sa hotel na ito.',
    room: 'Kuwarto', hotel: 'Hotel', reportedBy: 'Iniulat ni', assignedTo: 'Naka-assign kay', unassigned: 'Hindi naka-assign',
    noDuty: 'Walang maintenance staff na naka-sign in', waitingCheckIn: 'Awtomatikong maa-assign ang request kapag nag-sign in ang maintenance.',
    open: 'Bukas', inProgress: 'Ginagawa', pending: 'Pending / naka-hold', priority: 'Priority', attachments: 'Mga attachment', refresh: 'I-refresh',
    source: 'Pinagmulan', housekeeping: 'Housekeeping', reception: 'Reception / management', manual: 'Manual entry',
    informationOnly: 'Para sa visibility lamang — hihingin ang final approval kapag naisumite na ng maintenance ang natapos na repair.',
  },
  uk: {
    title: 'Передані заявки на ремонт',
    subtitle: 'Активні заявки на ремонт, уже передані з Housekeeping, рецепції або керівництва.',
    active: 'активні', noActive: 'Для цього готелю немає активних переданих заявок на ремонт.',
    room: 'Кімната', hotel: 'Готель', reportedBy: 'Повідомив', assignedTo: 'Призначено', unassigned: 'Не призначено',
    noDuty: 'Немає технічного працівника, який увійшов у систему', waitingCheckIn: 'Заявка буде автоматично призначена після входу технічного працівника.',
    open: 'Відкрита', inProgress: 'У роботі', pending: 'Очікує / призупинена', priority: 'Пріоритет', attachments: 'Вкладення', refresh: 'Оновити',
    source: 'Джерело', housekeeping: 'Housekeeping', reception: 'Рецепція / керівництво', manual: 'Ручне введення',
    informationOnly: 'Лише для відстеження — фінальне схвалення буде потрібне після подання завершеного ремонту.',
  },
  ru: {
    title: 'Переданные заявки на ремонт',
    subtitle: 'Активные заявки на ремонт, уже переданные из Housekeeping, рецепции или руководства.',
    active: 'активные', noActive: 'Для этого отеля нет активных переданных заявок на ремонт.',
    room: 'Комната', hotel: 'Отель', reportedBy: 'Сообщил', assignedTo: 'Назначено', unassigned: 'Не назначено',
    noDuty: 'Нет вошедшего сотрудника техслужбы', waitingCheckIn: 'Заявка будет автоматически назначена после входа сотрудника техслужбы.',
    open: 'Открыта', inProgress: 'В работе', pending: 'Ожидает / приостановлена', priority: 'Приоритет', attachments: 'Вложения', refresh: 'Обновить',
    source: 'Источник', housekeeping: 'Housekeeping', reception: 'Рецепция / руководство', manual: 'Ручной ввод',
    informationOnly: 'Только для контроля — финальное одобрение потребуется после отправки завершённого ремонта.',
  },
};

interface ForwardedMaintenanceApprovalsProps {
  hideWhenEmpty?: boolean;
}

export function ForwardedMaintenanceApprovals({
  hideWhenEmpty = false,
}: ForwardedMaintenanceApprovalsProps = {}) {
  const { profile } = useAuth();
  const { language } = useTranslation();
  const c = copies[language] || copies.en;
  const [tickets, setTickets] = useState<ActiveMaintenanceTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string[]>>({});

  const loadAttachments = useCallback(async (rows: ActiveMaintenanceTicket[]) => {
    const resolved: Record<string, string[]> = {};
    for (const ticket of rows) {
      const direct: string[] = [];
      const privatePaths: string[] = [];
      for (const value of ticket.attachment_urls || []) {
        if (/^https?:\/\//i.test(value)) direct.push(value);
        else privatePaths.push(value);
      }
      const signed = privatePaths.length
        ? await getSignedPhotoUrls(privatePaths, 'ticket-attachments')
        : [];
      resolved[ticket.id] = [...direct, ...signed];
    }
    setAttachmentUrls(resolved);
  }, []);

  const fetchTickets = useCallback(async () => {
    if (!profile?.organization_slug) {
      setTickets([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const hotelKeys = await resolveHotelKeys(profile.assigned_hotel);
      let query = (supabase as any)
        .from('tickets')
        .select(`
          id, ticket_number, title, description, room_number, hotel, priority, status,
          created_at, updated_at, assigned_to, attachment_urls, on_hold, hold_reason,
          source, assignment_method,
          created_by_profile:profiles!tickets_created_by_fkey(full_name, nickname, role),
          assigned_to_profile:profiles!tickets_assigned_to_fkey(full_name, nickname)
        `)
        .eq('department', 'maintenance')
        .eq('organization_slug', profile.organization_slug)
        .neq('status', 'completed')
        .or('pending_supervisor_approval.eq.false,pending_supervisor_approval.is.null')
        .neq('source', 'housekeeping_legacy_backfill')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(100);

      if (hotelKeys.length) query = query.in('hotel', hotelKeys);

      const { data, error } = await query;
      if (error) throw error;
      const rows = (data || []) as ActiveMaintenanceTicket[];
      setTickets(rows);
      void loadAttachments(rows);
    } catch (error) {
      console.error('[ForwardedMaintenanceApprovals] load failed:', error);
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [profile?.organization_slug, profile?.assigned_hotel, loadAttachments]);

  useEffect(() => {
    void fetchTickets();
    if (!profile?.id) return;
    const channel = supabase
      .channel(`supervisor-forwarded-maintenance-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, (payload: any) => {
        const row = payload.new || payload.old;
        if (row?.department === 'maintenance') void fetchTickets();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchTickets, profile?.id]);

  const statusLabel = (ticket: ActiveMaintenanceTicket) => ticket.on_hold
    ? c.pending
    : ticket.status === 'in_progress'
      ? c.inProgress
      : c.open;

  const sourceLabel = (ticket: ActiveMaintenanceTicket) => {
    if (ticket.source?.startsWith('housekeeping')) return c.housekeeping;
    if (ticket.source === 'manual') return c.reception;
    return c.manual;
  };

  const priorityClass = (priority: string) => priority === 'urgent'
    ? 'bg-red-100 text-red-800 border-red-200'
    : priority === 'high'
      ? 'bg-orange-100 text-orange-800 border-orange-200'
      : priority === 'low'
        ? 'bg-green-100 text-green-800 border-green-200'
        : 'bg-yellow-100 text-yellow-800 border-yellow-200';

  const sortedTickets = useMemo(() => {
    const rank = { urgent: 0, high: 1, medium: 2, low: 3 };
    return [...tickets].sort((a, b) => {
      const p = rank[a.priority] - rank[b.priority];
      if (p !== 0) return p;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  }, [tickets]);

  if (hideWhenEmpty && !loading && sortedTickets.length === 0) return null;

  return (
    <section id="forwarded-maintenance-approvals" className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Wrench className="h-5 w-5 text-primary" />
              {c.title}
            </h2>
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

      {loading ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">…</CardContent></Card>
      ) : sortedTickets.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <CheckCircle2 className="h-9 w-9 mx-auto mb-2 text-green-600" />
            <p className="text-sm text-muted-foreground">{c.noActive}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {sortedTickets.map(ticket => (
            <Card key={ticket.id} className="border-l-4 border-l-primary/70 shadow-sm">
              <CardHeader className="p-3 sm:p-4 pb-2">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base sm:text-lg flex items-center gap-2 flex-wrap">
                      <span>{c.room} {ticket.room_number}</span>
                      <Badge variant="outline" className={priorityClass(ticket.priority)}>{ticket.priority.toUpperCase()}</Badge>
                      <Badge variant="secondary">{statusLabel(ticket)}</Badge>
                    </CardTitle>
                    <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground mt-1.5">
                      <span>{ticket.ticket_number}</span>
                      <span>·</span>
                      <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{ticket.hotel || '—'}</span>
                      <span>·</span>
                      <span className="flex items-center gap-1"><Clock3 className="h-3 w-3" />{new Date(ticket.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-3 sm:p-4 pt-0 space-y-3">
                <div className="rounded-lg bg-muted/50 p-3">
                  <div className="text-xs font-semibold text-muted-foreground mb-1 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" /> {ticket.title}
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{ticket.description}</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                  <div className="rounded-lg border p-2.5">
                    <div className="text-[11px] text-muted-foreground flex items-center gap-1"><User className="h-3 w-3" />{c.reportedBy}</div>
                    <div className="font-semibold truncate">{ticket.created_by_profile?.full_name || '—'}</div>
                  </div>
                  <div className="rounded-lg border p-2.5">
                    <div className="text-[11px] text-muted-foreground flex items-center gap-1"><UserCheck className="h-3 w-3" />{c.assignedTo}</div>
                    <div className="font-semibold truncate">{ticket.assigned_to_profile?.full_name || c.unassigned}</div>
                  </div>
                  <div className="rounded-lg border p-2.5">
                    <div className="text-[11px] text-muted-foreground">{c.source}</div>
                    <div className="font-semibold truncate">{sourceLabel(ticket)}</div>
                  </div>
                </div>

                {!ticket.assigned_to && (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 p-2.5 text-xs">
                    <strong>{c.noDuty}.</strong> {c.waitingCheckIn}
                  </div>
                )}

                {!!attachmentUrls[ticket.id]?.length && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-muted-foreground">{c.attachments} ({attachmentUrls[ticket.id].length})</div>
                    <div className="flex gap-2 flex-wrap">
                      {attachmentUrls[ticket.id].map((url, index) => (
                        <Dialog key={`${ticket.id}-${index}`}>
                          <DialogTrigger asChild>
                            <Button variant="outline" size="sm"><Eye className="h-3.5 w-3.5 mr-1" />{index + 1}</Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-4xl">
                            <img src={url} alt={`Maintenance attachment ${index + 1}`} className="max-h-[80vh] w-auto mx-auto" />
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
    </section>
  );
}
