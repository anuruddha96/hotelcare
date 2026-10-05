import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { todayBudapest } from '@/lib/budapestTime';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { sortMaintenanceTickets } from '@/lib/maintenanceQueue';
import { getSignedPhotoUrls } from '@/lib/storageUrls';
import { maintenanceStaffLanguageOverrides } from '@/lib/maintenanceStaffLanguageOverrides';
import { MaintenanceTicketLanguagePanel } from './MaintenanceTicketLanguagePanel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertTriangle, Building2, Camera, CheckCircle2, Clock3, Eye, MessageSquare, PauseCircle, Play, RefreshCw, User, Wrench } from 'lucide-react';
import { toast } from 'sonner';

type Ticket = {
  id: string; ticket_number: string; title: string; description: string; room_number: string; hotel: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent'; status: 'open' | 'in_progress' | 'completed';
  created_at: string; updated_at: string; sla_due_date: string | null; attachment_urls: string[] | null; completion_photos: string[] | null;
  pending_supervisor_approval: boolean | null; on_hold: boolean | null; hold_reason: string | null; resolution_text: string | null;
  assigned_to: string | null;
  created_by_profile?: { full_name: string; role?: string } | null;
  assigned_to_profile?: { full_name: string } | null;
};
type Copy = Record<string, string>;
const EN: Copy = {
  title: 'Maintenance Team Tasks', subtitle: 'All maintenance tickets for this hotel are shared with the property maintenance team. Assignment shows the owner, but teammates can assist and update the same ticket.', signedIn: 'Attendance checked in', notSignedIn: 'Check in under Work Status before starting maintenance work',
  active: 'Active', approval: 'Awaiting approval', done: 'Done', noTasks: 'No maintenance tasks in this section.', room: 'Room', hotel: 'Hotel',
  attachments: 'Issue photos', completionPhotos: 'Completion photos', start: 'Start work', note: 'Add note', hold: 'Pending / hold', resume: 'Resume work', complete: 'Complete work',
  statusOpen: 'Open', statusProgress: 'In progress', statusHold: 'Pending', statusApproval: 'Awaiting approval', statusDone: 'Done',
  holdReason: 'Why is this pending?', parts: 'Waiting for parts', purchase: 'Purchase in progress', access: 'Waiting for room access', approvalReason: 'Waiting for approval', contractor: 'External contractor needed', other: 'Other',
  pendingDetails: 'Add details so the supervisor knows what is blocking the repair.', saveHold: 'Save pending reason', cancel: 'Cancel', saveNote: 'Save note', notePlaceholder: 'Write an update for the supervisor…',
  resolutionPlaceholder: 'Describe the repair and what was done…', photoOptional: 'Completion photo (optional).', photoInvalid: 'Choose an image file.', photoSkipped: 'Photo could not be uploaded. The work will be submitted without it.', submitApproval: 'Submit for supervisor approval',
  approvalHint: 'Submitted. No further action is needed unless a supervisor returns the repair for correction.',
  assignedTo: 'Assigned to', unassigned: 'Unassigned', sharedTicket: 'Shared property ticket',
  workStarted: 'Work started', holdSaved: 'Ticket marked pending', resumed: 'Work resumed', noteSaved: 'Note added', submitted: 'Submitted for supervisor approval', failed: 'Action failed', refresh: 'Refresh', retry: 'Retry', loadFailed: 'Maintenance tasks could not be loaded. Your last visible list has been kept.',
};
const HU: Copy = {
  ...EN, title: 'Karbantartási csapat feladatai', subtitle: 'A hotel összes karbantartási jegye közös a helyszíni karbantartó csapat számára. A hozzárendelés mutatja a felelőst, de a csapattársak is segíthetnek és frissíthetik ugyanazt a jegyet.', signedIn: 'Munkaidő: bejelentkezve', notSignedIn: 'Karbantartási munka indítása előtt jelentkezzen be a Munkaidő menüben',
  active: 'Aktív', approval: 'Jóváhagyásra vár', done: 'Kész', noTasks: 'Ebben a részben nincs karbantartási feladat.', room: 'Szoba',
  attachments: 'Hibafotók', completionPhotos: 'Befejezési fotók', start: 'Munka indítása', note: 'Jegyzet', hold: 'Függőben', resume: 'Munka folytatása', complete: 'Munka befejezése',
  statusOpen: 'Nyitott', statusProgress: 'Folyamatban', statusHold: 'Függőben', statusApproval: 'Jóváhagyásra vár', statusDone: 'Kész',
  holdReason: 'Miért van függőben?', parts: 'Alkatrészre vár', purchase: 'Beszerzés folyamatban', access: 'Szobahozzáférésre vár', approvalReason: 'Jóváhagyásra vár', contractor: 'Külső szakember szükséges', other: 'Egyéb',
  pendingDetails: 'Írjon részleteket, hogy a felügyelő lássa, mi akadályozza a javítást.', saveHold: 'Függő ok mentése', cancel: 'Mégse', saveNote: 'Jegyzet mentése', notePlaceholder: 'Írjon frissítést a felügyelőnek…',
  resolutionPlaceholder: 'Írja le a javítást és az elvégzett munkát…', photoOptional: 'Befejezési fotó (opcionális).', photoInvalid: 'Válasszon képfájlt.', photoSkipped: 'A fotót nem sikerült feltölteni. A munka fotó nélkül kerül beküldésre.', submitApproval: 'Beküldés felügyelői jóváhagyásra',
  approvalHint: 'Beküldve. Nincs további teendő, kivéve ha a felügyelő javításra visszaküldi.',
  assignedTo: 'Hozzárendelve', unassigned: 'Nincs hozzárendelve', sharedTicket: 'Közös hotelfeladat',
  workStarted: 'Munka elkezdve', holdSaved: 'Jegy függőben', resumed: 'Munka folytatva', noteSaved: 'Jegyzet hozzáadva', submitted: 'Jóváhagyásra beküldve', failed: 'A művelet sikertelen', refresh: 'Frissítés', retry: 'Újra', loadFailed: 'A karbantartási feladatok betöltése sikertelen. Az előző lista megmaradt.',
};
const translations: Record<string, Copy> = {
  en: EN, hu: HU,
  es: { ...EN, title: 'Mis tareas de mantenimiento', active: 'Activos', approval: 'Pendiente de aprobación', done: 'Hecho', start: 'Iniciar trabajo', note: 'Añadir nota', complete: 'Completar', refresh: 'Actualizar' },
  vi: { ...EN, title: 'Công việc bảo trì của tôi', active: 'Đang hoạt động', approval: 'Chờ duyệt', done: 'Hoàn tất', start: 'Bắt đầu', note: 'Thêm ghi chú', refresh: 'Làm mới' },
  mn: { ...EN, title: 'Миний засварын ажлууд', active: 'Идэвхтэй', approval: 'Зөвшөөрөл хүлээж байна', done: 'Дууссан', note: 'Тэмдэглэл', refresh: 'Шинэчлэх' },
  az: { ...EN, title: 'Texniki xidmət tapşırıqlarım', active: 'Aktiv', approval: 'Təsdiq gözləyir', done: 'Tamamlandı', note: 'Qeyd əlavə et' },
  tl: { ...EN, title: 'Mga Maintenance Task Ko', active: 'Aktibo', approval: 'Naghihintay ng approval', done: 'Tapos', note: 'Magdagdag ng note' },
  uk: { ...EN, title: 'Мої завдання з техобслуговування', active: 'Активні', approval: 'Очікує схвалення', done: 'Готово', note: 'Додати нотатку' },
  ru: { ...EN, title: 'Мои задачи по техобслуживанию', active: 'Активные', approval: 'Ожидает одобрения', done: 'Готово', note: 'Добавить заметку' },
  si: EN,
};
const HOLD_REASONS = [
  ['parts_pending', 'parts'], ['purchase_in_progress', 'purchase'], ['waiting_for_access', 'access'],
  ['waiting_for_approval', 'approvalReason'], ['external_contractor', 'contractor'], ['other', 'other'],
] as const;

export function MaintenanceStaffView() {
  const { user, profile } = useAuth();
  const { language } = useTranslation();
  const c: Copy = { ...(translations[language] || EN), ...(maintenanceStaffLanguageOverrides[language] || {}) };
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [completed, setCompleted] = useState<Ticket[]>([]);
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [activeTab, setActiveTab] = useState<'active' | 'approval' | 'done'>('active');
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string[]>>({});
  const [completionPhotoUrls, setCompletionPhotoUrls] = useState<Record<string, string[]>>({});
  const [historyRevision, setHistoryRevision] = useState<Record<string, number>>({});
  const [busyTicketId, setBusyTicketId] = useState<string | null>(null);
  const previouslyAwaiting = useRef<Set<string>>(new Set());
  const hotelScopeRef = useRef<Set<string>>(new Set());
  const hasLoadedRef = useRef(false);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [dialog, setDialog] = useState<'note' | 'hold' | 'complete' | null>(null);
  const [note, setNote] = useState('');
  const [holdReason, setHoldReason] = useState('');
  const [holdDetails, setHoldDetails] = useState('');
  const [resolution, setResolution] = useState('');
  const [completionFile, setCompletionFile] = useState<File | null>(null);
  const [isSubmittingCompletion, setIsSubmittingCompletion] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const signValues = useCallback(async (values: string[] | null) => {
    const direct: string[] = [];
    const privatePaths: string[] = [];
    for (const value of values || []) {
      if (value.startsWith('http://') || value.startsWith('https://')) direct.push(value);
      else privatePaths.push(value);
    }
    const signed = privatePaths.length ? await getSignedPhotoUrls(privatePaths, 'ticket-attachments') : [];
    return [...direct, ...signed];
  }, []);

  const loadVisiblePhotoUrls = useCallback(async (rows: Ticket[]) => {
    if (!rows.length) return;
    const entries = await Promise.all(rows.map(async ticket => {
      const [attachments, completionPhotos] = await Promise.all([
        signValues(ticket.attachment_urls),
        signValues(ticket.completion_photos),
      ]);
      return { id: ticket.id, attachments, completionPhotos };
    }));
    setAttachmentUrls(prev => ({ ...prev, ...Object.fromEntries(entries.map(entry => [entry.id, entry.attachments])) }));
    setCompletionPhotoUrls(prev => ({ ...prev, ...Object.fromEntries(entries.map(entry => [entry.id, entry.completionPhotos])) }));
  }, [signValues]);

  const refresh = useCallback(async () => {
    if (!user?.id || !profile?.assigned_hotel || !profile.organization_slug) {
      setTickets([]);
      setCompleted([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (hasLoadedRef.current) setRefreshing(true); else setLoading(true);
    setLoadError(false);
    try {
      const hotelKeys = Array.from(new Set([
        profile.assigned_hotel,
        ...(await resolveHotelKeys(profile.assigned_hotel)),
      ].filter(Boolean)));
      hotelScopeRef.current = new Set(hotelKeys);
      const today = todayBudapest();
      const ticketSelect = `
        id, ticket_number, title, description, room_number, hotel, priority, status, created_at, updated_at, sla_due_date,
        attachment_urls, completion_photos, pending_supervisor_approval, on_hold, hold_reason, resolution_text, assigned_to,
        created_by_profile:profiles!tickets_created_by_fkey(full_name, role)
      `;
      const [
        { data: attendance },
        { data: activeData, error: activeError },
        { data: completedData, error: completedError },
        { data: teamData, error: teamError },
      ] = await Promise.all([
        supabase.from('staff_attendance').select('id').eq('user_id', user.id).eq('work_date', today).eq('status', 'checked_in').limit(1),
        (supabase as any).from('tickets').select(ticketSelect)
          .eq('organization_slug', profile.organization_slug)
          .eq('department', 'maintenance')
          .in('hotel', hotelKeys)
          .neq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(250),
        (supabase as any).from('tickets').select(ticketSelect)
          .eq('organization_slug', profile.organization_slug)
          .eq('department', 'maintenance')
          .in('hotel', hotelKeys)
          .eq('status', 'completed')
          .or('pending_supervisor_approval.is.null,pending_supervisor_approval.eq.false')
          .order('closed_at', { ascending: false })
          .limit(30),
        (supabase as any).rpc('get_maintenance_property_teammates'),
      ]);
      if (activeError || completedError || teamError) throw activeError || completedError || teamError;
      setSignedIn(!!attendance?.length);
      const teamById = new Map<string, string>(
        ((teamData || []) as Array<{ id: string; full_name: string }>).map(member => [member.id, member.full_name]),
      );
      const attachAssignee = (rows: unknown[]) => (rows as Ticket[]).map(ticket => ({
        ...ticket,
        assigned_to_profile: ticket.assigned_to && teamById.has(ticket.assigned_to)
          ? { full_name: teamById.get(ticket.assigned_to)! }
          : null,
      }));
      const activeRows = sortMaintenanceTickets(attachAssignee(activeData || []) as Ticket[]);
      const completedRows = attachAssignee(completedData || []) as Ticket[];
      for (const ticket of activeRows) {
        if (previouslyAwaiting.current.has(ticket.id) && !ticket.pending_supervisor_approval && ticket.status === 'in_progress') {
          toast.info(language === 'hu' ? `Javítás visszaküldve: ${ticket.ticket_number}. Nézze meg az előzményeket.` : `Repair returned for correction: ${ticket.ticket_number}. Check ticket history.`);
          setHistoryRevision(prev => ({ ...prev, [ticket.id]: (prev[ticket.id] || 0) + 1 }));
        }
      }
      previouslyAwaiting.current = new Set(activeRows.filter(ticket => ticket.pending_supervisor_approval).map(ticket => ticket.id));
      setTickets(activeRows);
      setCompleted(completedRows);
      hasLoadedRef.current = true;
    } catch (error) {
      console.error('Maintenance task load failed:', error);
      setLoadError(true);
      toast.error(c.failed);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, profile?.assigned_hotel, profile?.organization_slug, c.failed, language]);

  useEffect(() => {
    void refresh();
    if (!user?.id) return;
    const channel = supabase.channel(`maintenance-staff-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, (event: any) => {
        const record = event.new || event.old;
        if (
          record?.department === 'maintenance'
          && record?.organization_slug === profile?.organization_slug
          && (!record?.hotel || hotelScopeRef.current.has(record.hotel))
        ) void refresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_attendance', filter: `user_id=eq.${user.id}` }, () => void refresh())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [refresh, user?.id]);

  const filtered = useMemo(() => {
    if (activeTab === 'approval') return sortMaintenanceTickets(tickets.filter(ticket => ticket.pending_supervisor_approval));
    if (activeTab === 'done') return completed;
    return sortMaintenanceTickets(tickets.filter(ticket => !ticket.pending_supervisor_approval));
  }, [activeTab, tickets, completed]);

  useEffect(() => { void loadVisiblePhotoUrls(filtered); }, [filtered, loadVisiblePhotoUrls]);

  const addComment = async (ticketId: string, content: string) => {
    if (!user?.id || !content.trim()) return;
    const { error } = await supabase.from('comments').insert({ ticket_id: ticketId, user_id: user.id, content: content.trim() });
    if (error) throw error;
    setHistoryRevision(prev => ({ ...prev, [ticketId]: (prev[ticketId] || 0) + 1 }));
  };

  const runTeamAction = async (
    ticket: Ticket,
    action: 'start' | 'hold' | 'resume' | 'submit',
    note: string | null = null,
    actionHoldReason: string | null = null,
    completionPhoto: string | null = null,
  ) => {
    const { error } = await (supabase as any).rpc('work_maintenance_ticket', {
      p_ticket_id: ticket.id,
      p_action: action,
      p_note: note,
      p_expected_updated_at: ticket.updated_at,
      p_hold_reason: actionHoldReason,
      p_completion_photo: completionPhoto,
    });
    if (error) throw error;
    setHistoryRevision(prev => ({ ...prev, [ticket.id]: (prev[ticket.id] || 0) + 1 }));
  };

  const startWork = async (ticket: Ticket) => {
    if (!signedIn) { toast.error(c.notSignedIn); return; }
    if (busyTicketId) return;
    setBusyTicketId(ticket.id);
    try {
      await runTeamAction(ticket, 'start');
      toast.success(c.workStarted); void refresh();
    } catch { toast.error(c.failed); }
    finally { setBusyTicketId(null); }
  };

  const openDialog = (ticket: Ticket, next: 'note' | 'hold' | 'complete') => {
    setSelected(ticket);
    if (next === 'note') setNote('');
    if (next === 'hold') { setHoldReason(''); setHoldDetails(''); }
    if (next === 'complete') {
      setResolution(ticket.resolution_text || '');
      setCompletionFile(null);
      if (fileRef.current) fileRef.current.value = '';
    }
    setDialog(next);
  };

  const closeDialog = () => {
    if (isSubmittingCompletion || busyTicketId) return;
    setDialog(null);
    setSelected(null);
    setNote('');
    setHoldReason('');
    setHoldDetails('');
    setResolution('');
    setCompletionFile(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const saveNote = async () => {
    if (!selected || !note.trim() || busyTicketId) return;
    setBusyTicketId(selected.id);
    try {
      await addComment(selected.id, note);
      toast.success(c.noteSaved);
      setNote('');
      setDialog(null);
      setSelected(null);
    } catch { toast.error(c.failed); }
    finally { setBusyTicketId(null); }
  };

  const saveHold = async () => {
    if (!selected || !holdReason || busyTicketId) return;
    if (!signedIn) { toast.error(c.notSignedIn); return; }
    setBusyTicketId(selected.id);
    try {
      await runTeamAction(selected, 'hold', holdDetails.trim() || null, holdReason);
      toast.success(c.holdSaved);
      setHoldReason(''); setHoldDetails(''); setDialog(null); setSelected(null); void refresh();
    } catch { toast.error(c.failed); }
    finally { setBusyTicketId(null); }
  };

  const resumeWork = async (ticket: Ticket) => {
    if (!signedIn) { toast.error(c.notSignedIn); return; }
    if (busyTicketId) return;
    setBusyTicketId(ticket.id);
    try {
      await runTeamAction(ticket, 'resume');
      toast.success(c.resumed); void refresh();
    } catch { toast.error(c.failed); }
    finally { setBusyTicketId(null); }
  };

  const submitCompletion = async () => {
    if (isSubmittingCompletion) return;
    if (!signedIn) { toast.error(c.notSignedIn); return; }
    if (!selected || !resolution.trim() || !user?.id) return;
    if (completionFile && !completionFile.type.startsWith('image/')) { toast.error(c.photoInvalid); return; }

    setIsSubmittingCompletion(true);
    let uploadedPath: string | null = null;
    try {
      if (completionFile) {
        const ext = completionFile.name.split('.').pop() || 'jpg';
        const path = `${selected.id}/completion-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('ticket-attachments')
          .upload(path, completionFile, { upsert: false });

        if (uploadError) {
          console.error('Optional completion photo upload failed:', uploadError);
          toast.warning(c.photoSkipped);
        } else {
          uploadedPath = path;
        }
      }

      await runTeamAction(selected, 'submit', resolution.trim(), null, uploadedPath);
      toast.success(c.submitted);
      setResolution(''); setCompletionFile(null); setDialog(null); setSelected(null); void refresh();
    } catch (error) {
      console.error(error);
      if (uploadedPath) await supabase.storage.from('ticket-attachments').remove([uploadedPath]).catch(() => undefined);
      toast.error(c.failed);
    }
    finally { setIsSubmittingCompletion(false); }
  };

  const counts = {
    active: tickets.filter(ticket => !ticket.pending_supervisor_approval).length,
    approval: tickets.filter(ticket => ticket.pending_supervisor_approval).length,
    done: completed.length,
  };
  const status = (ticket: Ticket) => ticket.pending_supervisor_approval ? c.statusApproval : ticket.on_hold ? c.statusHold : ticket.status === 'in_progress' ? c.statusProgress : ticket.status === 'completed' ? c.statusDone : c.statusOpen;
  const statusClass = (ticket: Ticket) => ticket.pending_supervisor_approval ? 'bg-blue-100 text-blue-800 border-blue-200' : ticket.on_hold ? 'bg-amber-100 text-amber-800 border-amber-200' : ticket.status === 'in_progress' ? 'bg-violet-100 text-violet-800 border-violet-200' : ticket.status === 'completed' ? 'bg-green-100 text-green-800 border-green-200' : 'bg-slate-100 text-slate-800 border-slate-200';
  const priorityClass = (priority: string) => priority === 'urgent' ? 'bg-red-100 text-red-800' : priority === 'high' ? 'bg-orange-100 text-orange-800' : priority === 'low' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800';

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-2 sm:px-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-xl font-bold sm:text-2xl"><Wrench className="h-5 w-5 shrink-0" />{c.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{c.subtitle}</p>
        </div>
        <Button size="sm" variant="outline" disabled={refreshing} aria-label={c.refresh} onClick={() => {
          setHistoryRevision(prev => {
            const next = { ...prev };
            for (const ticket of [...tickets, ...completed]) next[ticket.id] = (next[ticket.id] || 0) + 1;
            return next;
          });
          void refresh();
        }}><RefreshCw className={`h-4 w-4 sm:mr-1 ${refreshing ? 'animate-spin' : ''}`} /><span className="hidden sm:inline">{c.refresh}</span></Button>
      </div>

      <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${signedIn ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`} role="status">
        {signedIn ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}<strong>{signedIn ? c.signedIn : c.notSignedIn}</strong>
      </div>

      {loadError && <div role="alert" className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between">
        <span>{c.loadFailed}</span><Button type="button" size="sm" variant="outline" disabled={refreshing} onClick={() => void refresh()}>{c.retry}</Button>
      </div>}

      <div className="grid grid-cols-3 gap-2" role="tablist" aria-label={c.title}>
        {(['active', 'approval', 'done'] as const).map(tab => <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)}
          className={`min-w-0 rounded-xl border p-2.5 text-left transition sm:p-3 ${activeTab === tab ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'hover:bg-muted/40'}`}>
          <div className="truncate text-[11px] text-muted-foreground sm:text-xs">{c[tab]}</div><div className="text-lg font-bold sm:text-xl">{counts[tab]}</div>
        </button>)}
      </div>

      {activeTab === 'approval' && counts.approval > 0 && <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">{c.approvalHint}</div>}

      {loading ? <div className="flex justify-center py-12" aria-busy="true"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" /></div> : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center"><CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground" /><p className="text-muted-foreground">{c.noTasks}</p></CardContent></Card>
      ) : <div className="space-y-3">{filtered.map(ticket => {
        const busy = busyTicketId === ticket.id || isSubmittingCompletion && selected?.id === ticket.id;
        return <Card key={ticket.id} className={`overflow-hidden border-l-4 ${ticket.priority === 'urgent' ? 'border-l-red-500' : ticket.priority === 'high' ? 'border-l-orange-500' : 'border-l-primary/60'}`}>
          <CardHeader className="p-3 pb-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><CardTitle className="flex flex-wrap items-center gap-2 text-base sm:text-lg"><span>{c.room} {ticket.room_number}</span><Badge className={priorityClass(ticket.priority)}>{ticket.priority.toUpperCase()}</Badge><Badge variant="outline" className={statusClass(ticket)}>{status(ticket)}</Badge></CardTitle><div className="mt-1 text-xs text-muted-foreground">{ticket.ticket_number}</div></div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-3 pt-0">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-lg bg-muted/50 p-2 text-xs"><div className="flex items-center gap-1 text-muted-foreground"><Building2 className="h-3 w-3" />{c.hotel}</div><div className="break-words font-semibold">{ticket.hotel || '—'}</div></div>
              <div className="rounded-lg bg-muted/50 p-2 text-xs">
                <div className="flex items-center gap-1 text-muted-foreground"><User className="h-3 w-3" />{c.assignedTo}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span className="break-words font-semibold">{ticket.assigned_to_profile?.full_name || c.unassigned}</span>
                  {ticket.assigned_to && ticket.assigned_to !== user?.id && <Badge variant="outline" className="text-[10px]">{c.sharedTicket}</Badge>}
                </div>
              </div>
            </div>
            <MaintenanceTicketLanguagePanel ticket={ticket} language={language} reporterFallback={ticket.created_by_profile?.full_name} revision={historyRevision[ticket.id] || 0} />
            {ticket.on_hold && ticket.hold_reason && <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800"><PauseCircle className="h-4 w-4 shrink-0" />{c[HOLD_REASONS.find(([value]) => value === ticket.hold_reason)?.[1] || 'other']}</div>}

            {!!attachmentUrls[ticket.id]?.length && <div className="space-y-1.5"><div className="text-xs font-semibold text-muted-foreground">{c.attachments} ({attachmentUrls[ticket.id].length})</div><div className="flex flex-wrap gap-2">{attachmentUrls[ticket.id].map((url, idx) => <Dialog key={`${ticket.id}-issue-${idx}`}><DialogTrigger asChild><Button type="button" size="sm" variant="outline" aria-label={`${c.attachments} ${idx + 1}`}><Eye className="mr-1 h-3.5 w-3.5" />{idx + 1}</Button></DialogTrigger><DialogContent className="w-[calc(100vw-1rem)] max-w-4xl"><img src={url} alt={`${c.attachments} ${idx + 1}`} loading="lazy" className="mx-auto max-h-[80dvh] w-auto rounded" /></DialogContent></Dialog>)}</div></div>}
            {!!completionPhotoUrls[ticket.id]?.length && <div className="space-y-1.5"><div className="text-xs font-semibold text-muted-foreground">{c.completionPhotos} ({completionPhotoUrls[ticket.id].length})</div><div className="flex flex-wrap gap-2">{completionPhotoUrls[ticket.id].map((url, idx) => <Dialog key={`${ticket.id}-completion-${idx}`}><DialogTrigger asChild><Button type="button" size="sm" variant="outline" aria-label={`${c.completionPhotos} ${idx + 1}`}><Camera className="mr-1 h-3.5 w-3.5" />{idx + 1}</Button></DialogTrigger><DialogContent className="w-[calc(100vw-1rem)] max-w-4xl"><img src={url} alt={`${c.completionPhotos} ${idx + 1}`} loading="lazy" className="mx-auto max-h-[80dvh] w-auto rounded" /></DialogContent></Dialog>)}</div></div>}

            {activeTab !== 'done' && <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              {ticket.status === 'open' && !ticket.pending_supervisor_approval && <Button onClick={() => void startWork(ticket)} disabled={!signedIn || busy} className="min-h-11"><Play className="mr-1 h-4 w-4" />{c.start}</Button>}
              {ticket.status === 'in_progress' && !ticket.on_hold && !ticket.pending_supervisor_approval && <Button variant="outline" onClick={() => openDialog(ticket, 'hold')} disabled={!signedIn || busy} className="min-h-11"><PauseCircle className="mr-1 h-4 w-4" />{c.hold}</Button>}
              {ticket.on_hold && !ticket.pending_supervisor_approval && <Button onClick={() => void resumeWork(ticket)} disabled={!signedIn || busy} className="min-h-11"><Play className="mr-1 h-4 w-4" />{c.resume}</Button>}
              {!ticket.pending_supervisor_approval && <Button variant="outline" onClick={() => openDialog(ticket, 'note')} disabled={busy} className="min-h-11"><MessageSquare className="mr-1 h-4 w-4" />{c.note}</Button>}
              {ticket.status === 'in_progress' && !ticket.on_hold && !ticket.pending_supervisor_approval && <Button onClick={() => openDialog(ticket, 'complete')} disabled={!signedIn || busy} className="min-h-11 bg-green-600 hover:bg-green-700"><CheckCircle2 className="mr-1 h-4 w-4" />{c.complete}</Button>}
            </div>}
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><Clock3 className="h-3 w-3" />{new Date(ticket.updated_at || ticket.created_at).toLocaleString()}</div>
          </CardContent>
        </Card>;
      })}</div>}

      <Dialog open={dialog === 'note'} onOpenChange={open => !open && closeDialog()}><DialogContent className="w-[calc(100vw-1rem)] max-w-lg"><DialogHeader><DialogTitle>{c.note}</DialogTitle></DialogHeader><Textarea value={note} onChange={event => setNote(event.target.value)} placeholder={c.notePlaceholder} rows={4} disabled={!!busyTicketId} /><div className="grid grid-cols-2 gap-2"><Button variant="outline" onClick={closeDialog} disabled={!!busyTicketId}>{c.cancel}</Button><Button onClick={() => void saveNote()} disabled={!note.trim() || !!busyTicketId}>{c.saveNote}</Button></div></DialogContent></Dialog>
      <Dialog open={dialog === 'hold'} onOpenChange={open => !open && closeDialog()}><DialogContent className="w-[calc(100vw-1rem)] max-w-lg"><DialogHeader><DialogTitle>{c.holdReason}</DialogTitle></DialogHeader><Select value={holdReason} onValueChange={setHoldReason} disabled={!!busyTicketId}><SelectTrigger><SelectValue placeholder={c.holdReason} /></SelectTrigger><SelectContent>{HOLD_REASONS.map(([value, key]) => <SelectItem key={value} value={value}>{c[key]}</SelectItem>)}</SelectContent></Select><Textarea value={holdDetails} onChange={event => setHoldDetails(event.target.value)} placeholder={c.pendingDetails} rows={3} disabled={!!busyTicketId} /><div className="grid grid-cols-2 gap-2"><Button variant="outline" onClick={closeDialog} disabled={!!busyTicketId}>{c.cancel}</Button><Button onClick={() => void saveHold()} disabled={!holdReason || !!busyTicketId}>{c.saveHold}</Button></div></DialogContent></Dialog>
      <Dialog open={dialog === 'complete'} onOpenChange={next => { if (!next) closeDialog(); }}>
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-1rem)] max-w-lg overflow-y-auto p-4 sm:p-6">
          <DialogHeader><DialogTitle>{c.complete}</DialogTitle></DialogHeader>
          <Textarea value={resolution} onChange={event => setResolution(event.target.value)} placeholder={c.resolutionPlaceholder} rows={4} disabled={isSubmittingCompletion} />
          <p className="text-xs text-muted-foreground">{language === 'hu'
            ? 'A befejezési fotó opcionális. Ha szeretne, készítsen képet vagy válasszon a galériából.'
            : 'A completion photo is optional. Add one from the camera or gallery if useful.'}</p>
          <input ref={fileRef} type="file" accept="image/*" className="sr-only" aria-label={c.photoOptional} onChange={event => {
            const file = event.currentTarget.files?.[0] || null;
            if (file && !file.type.startsWith('image/')) { toast.error(c.photoInvalid); event.currentTarget.value = ''; setCompletionFile(null); return; }
            setCompletionFile(file);
          }} />
          <Button type="button" variant="outline" disabled={isSubmittingCompletion} className="h-auto min-h-11 w-full min-w-0 justify-start whitespace-normal break-all py-2 text-left" onClick={() => fileRef.current?.click()}>
            <Camera className="mr-2 h-4 w-4 shrink-0" /><span className="min-w-0 flex-1">{completionFile
              ? `${language === 'hu' ? 'Kiválasztott fotó' : 'Selected photo'}: ${completionFile.name}`
              : language === 'hu' ? 'Opcionális fotó készítése / kiválasztása' : 'Take or choose optional completion photo'}</span>
          </Button>
          {!completionFile && <p className="text-xs text-muted-foreground" role="status">{c.photoOptional}</p>}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button type="button" className="h-auto min-h-11 w-full min-w-0 whitespace-normal py-2" variant="outline" disabled={isSubmittingCompletion} onClick={closeDialog}>{c.cancel}</Button>
            <Button type="button" className="h-auto min-h-11 w-full min-w-0 whitespace-normal break-words bg-green-600 py-2 text-center leading-snug hover:bg-green-700"
              onClick={() => void submitCompletion()} disabled={isSubmittingCompletion || !signedIn || !resolution.trim()}>
              <CheckCircle2 className="mr-1 h-4 w-4 shrink-0" />{isSubmittingCompletion ? (language === 'hu' ? 'Beküldés…' : 'Submitting…') : c.submitApproval}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
