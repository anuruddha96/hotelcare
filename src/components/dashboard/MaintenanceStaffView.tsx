import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { todayBudapest } from '@/lib/budapestTime';
import { getSignedPhotoUrls } from '@/lib/storageUrls';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { mergeCompletionPhotos, validateCompletionFiles, MAX_COMPLETION_PHOTOS } from '@/lib/maintenanceCompletionPhotos';
import { maintenanceStaffLanguageOverrides } from '@/lib/maintenanceStaffLanguageOverrides';
import { MaintenanceTicketLanguagePanel } from './MaintenanceTicketLanguagePanel';
import { MaintenanceIssueEvidence } from './MaintenanceIssueEvidence';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertTriangle, Building2, Camera, CheckCircle2, Clock3, Eye, MessageSquare, PauseCircle, Play, RefreshCw, Wrench, X } from 'lucide-react';
import { toast } from 'sonner';

type Ticket = {
  id: string; ticket_number: string; title: string; description: string; room_number: string; hotel: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent'; status: 'open' | 'in_progress' | 'completed';
  created_at: string; updated_at: string; attachment_urls: string[] | null; completion_photos: string[] | null;
  pending_supervisor_approval: boolean | null; on_hold: boolean | null; hold_reason: string | null; resolution_text: string | null;
  created_by_profile?: { full_name: string; role?: string } | null;
};
type Copy = Record<string, string>;
const EN: Copy = {
  title: 'My Maintenance Tasks', subtitle: 'Work only on tickets assigned to you for this hotel.', signedIn: 'Signed in', notSignedIn: 'Sign in before starting work',
  active: 'Active', approval: 'Awaiting approval', done: 'Done', noTasks: 'No maintenance tasks assigned to you.', room: 'Room', hotel: 'Hotel',
  attachments: 'Attachments', start: 'Start work', note: 'Add note', hold: 'Pending / hold', resume: 'Resume work', complete: 'Complete work',
  statusOpen: 'Open', statusProgress: 'In progress', statusHold: 'Pending', statusApproval: 'Awaiting approval', statusDone: 'Done',
  holdReason: 'Why is this pending?', parts: 'Waiting for parts', purchase: 'Purchase in progress', access: 'Waiting for room access', approvalReason: 'Waiting for approval', contractor: 'External contractor needed', other: 'Other',
  pendingDetails: 'Add details so the supervisor knows what is blocking the repair.', saveHold: 'Save pending reason', cancel: 'Cancel', saveNote: 'Save note', notePlaceholder: 'Write an update for the supervisor…',
  resolutionPlaceholder: 'Describe the repair and what was done…', photoRequired: 'Add at least one completion photo before submitting.', submitApproval: 'Submit for supervisor approval',
  workStarted: 'Work started', holdSaved: 'Ticket marked pending', resumed: 'Work resumed', noteSaved: 'Note added', submitted: 'Submitted for supervisor approval', failed: 'Action failed', refresh: 'Refresh',
};
const HU: Copy = {
  ...EN, title: 'Karbantartási feladataim', subtitle: 'Csak az Önhöz rendelt, ehhez a hotelhez tartozó jegyeken dolgozzon.', signedIn: 'Bejelentkezve', notSignedIn: 'A munka megkezdése előtt jelentkezzen be',
  active: 'Aktív', approval: 'Jóváhagyásra vár', done: 'Kész', noTasks: 'Nincs Önhöz rendelt karbantartási feladat.', room: 'Szoba',
  attachments: 'Mellékletek', start: 'Munka indítása', note: 'Jegyzet', hold: 'Függőben', resume: 'Munka folytatása', complete: 'Munka befejezése',
  statusOpen: 'Nyitott', statusProgress: 'Folyamatban', statusHold: 'Függőben', statusApproval: 'Jóváhagyásra vár', statusDone: 'Kész',
  holdReason: 'Miért van függőben?', parts: 'Alkatrészre vár', purchase: 'Beszerzés folyamatban', access: 'Szobahozzáférésre vár', approvalReason: 'Jóváhagyásra vár', contractor: 'Külső szakember szükséges', other: 'Egyéb',
  pendingDetails: 'Írjon részleteket, hogy a felügyelő lássa, mi akadályozza a javítást.', saveHold: 'Függő ok mentése', cancel: 'Mégse', saveNote: 'Jegyzet mentése', notePlaceholder: 'Írjon frissítést a felügyelőnek…',
  resolutionPlaceholder: 'Írja le a javítást és az elvégzett munkát…', photoRequired: 'A beküldés előtt adjon hozzá legalább egy befejezési fotót.', submitApproval: 'Beküldés felügyelői jóváhagyásra',
  workStarted: 'Munka elkezdve', holdSaved: 'Jegy függőben', resumed: 'Munka folytatva', noteSaved: 'Jegyzet hozzáadva', submitted: 'Jóváhagyásra beküldve', failed: 'A művelet sikertelen', refresh: 'Frissítés',
};
const translations: Record<string, Copy> = {
  en: EN, hu: HU,
  es: { ...EN, title: 'Mis tareas de mantenimiento', active: 'Activos', approval: 'Pendiente de aprobación', done: 'Hecho', start: 'Iniciar trabajo', note: 'Añadir nota', complete: 'Completar', refresh: 'Actualizar' },
  vi: { ...EN, title: 'Công việc bảo trì của tôi', active: 'Đang hoạt động', approval: 'Chờ duyệt', done: 'Hoàn tất', start: 'Bắt đầu', note: 'Thêm ghi chú', refresh: 'Làm mới' },
  mn: { ...EN, title: 'Миний засварын ажлууд', active: 'Идэвхтэй', approval: 'Зөвшөөрөл хүлээж байна', done: 'Дууссан', note: 'Тэмдэглэл', refresh: 'Шинэчлэх' },
  az: { ...EN, title: 'Texniki xidmət tapşırıqlarım', active: 'Aktiv', approval: 'Təsdiq gözləyir', done: 'Tamamlandı', note: 'Qeyd əlavə et' },
  tl: { ...EN, title: 'Mga Maintenance Task Ko', active: 'Aktibo', approval: 'Naghihintay ng approval', done: 'Tapos', note: 'Magdagdag ng note' },
  uk: { ...EN, title: 'Мої завдання з техобслуговування', active: 'Активні', approval: 'Очікує схвалення', done: 'Готово', note: 'Додати нотатку' },
  ru: { ...EN, title: 'Мои задачи po техобслуживанию', active: 'Активные', approval: 'Ожидает одобрения', done: 'Готово', note: 'Добавить заметку' },
  si: EN,
};
const HOLD_REASONS = [
  ['parts_pending', 'parts'], ['purchase_in_progress', 'purchase'], ['waiting_for_access', 'access'],
  ['waiting_for_approval', 'approvalReason'], ['external_contractor', 'contractor'], ['other', 'other'],
] as const;

const PHOTO_PAGE_SIZE = 500;
const SELECT_FIELDS = `
  id, ticket_number, title, description, room_number, hotel, priority, status, created_at, updated_at,
  attachment_urls, completion_photos, pending_supervisor_approval, on_hold, hold_reason, resolution_text,
  created_by_profile:profiles!tickets_created_by_fkey(full_name, role)
`;

export function MaintenanceStaffView() {
  const { user, profile } = useAuth();
  const { language } = useTranslation();
  const c: Copy = { ...(translations[language] || EN), ...(maintenanceStaffLanguageOverrides[language] || {}) };
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [completed, setCompleted] = useState<Ticket[]>([]);
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'active' | 'approval' | 'done'>('active');
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string[]>>({});
  const [historyRevision, setHistoryRevision] = useState<Record<string, number>>({});
  const previouslyAwaiting = useRef<Set<string>>(new Set());
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [dialog, setDialog] = useState<'note' | 'hold' | 'complete' | null>(null);
  const [note, setNote] = useState('');
  const [holdReason, setHoldReason] = useState('');
  const [holdDetails, setHoldDetails] = useState('');
  const [resolution, setResolution] = useState('');
  const [completionFiles, setCompletionFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const uploadedPathsRef = useRef<Map<string, string>>(new Map());
  const [isSubmittingCompletion, setIsSubmittingCompletion] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const paths = completionFiles.map(file => URL.createObjectURL(file));
    setPreviews(paths);
    return () => paths.forEach(path => URL.revokeObjectURL(path));
  }, [completionFiles]);

  const loadAttachmentUrls = useCallback(async (rows: Ticket[]) => {
    const map: Record<string, string[]> = {};
    for (const ticket of rows) {
      const direct: string[] = [];
      const privatePaths: string[] = [];
      for (const value of ticket.attachment_urls || []) {
        if (value.startsWith('http://') || value.startsWith('https://')) direct.push(value);
        else privatePaths.push(value);
      }
      const signed = privatePaths.length ? await getSignedPhotoUrls(privatePaths, 'ticket-attachments') : [];
      map[ticket.id] = [...direct, ...signed];
    }
    setAttachmentUrls(map);
  }, []);

  const refresh = useCallback(async () => {
    if (!user?.id || !profile?.organization_slug || !profile.assigned_hotel) {
      setTickets([]); setCompleted([]); setLoading(false);
      setLoadError('Unable to verify your assigned hotel.'); return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const keys = await resolveHotelKeys(profile.assigned_hotel);
      if (!keys.length) throw new Error('Your hotel could not be verified.');
      const ownOrg = profile.organization_slug;
      const loadPageSet = async (done: boolean): Promise<Ticket[]> => {
        const rows: Ticket[] = [];
        for (let offset = 0; offset < 50000; offset += PHOTO_PAGE_SIZE) {
          let query = (supabase as any).from('tickets').select(SELECT_FIELDS)
            .eq('assigned_to', user.id).eq('organization_slug', ownOrg)
            .eq('department', 'maintenance').in('hotel', keys);
          query = done
            ? query.eq('status', 'completed').or('pending_supervisor_approval.is.null,pending_supervisor_approval.eq.false')
            : query.or('status.neq.completed,pending_supervisor_approval.eq.true');
          const { data, error } = await query.order('created_at', { ascending: false }).range(offset, offset + PHOTO_PAGE_SIZE - 1);
          if (error) throw error;
          rows.push(...((data || []) as Ticket[]));
          if ((data || []).length < PHOTO_PAGE_SIZE) return rows;
        }
        throw new Error('Maintenance issue history exceeds the safe page limit. Contact an administrator.');
      };
      const today = todayBudapest();
      const [attendance, currentDuty, activeRows, completedRows] = await Promise.all([
        supabase.from('staff_attendance').select('id').eq('user_id', user.id).eq('work_date', today).eq('status', 'checked_in').limit(1),
        (supabase as any).rpc('current_property_duty'),
        loadPageSet(false), loadPageSet(true),
      ]);
      if (attendance.error) throw attendance.error;
      // An authorized, unexpired server duty session is an explicit clock-in
      // for the selected duty venue, independently of home-hotel attendance.
      const activeDuty = !currentDuty.error && currentDuty.data
        && currentDuty.data.organization_slug === ownOrg
        && currentDuty.data.expires_at && Date.parse(currentDuty.data.expires_at) > Date.now()
        && keys.includes(currentDuty.data.hotel_id);
      setSignedIn(Boolean(attendance.data?.length || activeDuty));
      for (const ticket of activeRows) {
        if (previouslyAwaiting.current.has(ticket.id) && !ticket.pending_supervisor_approval && ticket.status === 'in_progress') {
          toast.info(language === 'hu' ? `Javítás visszaküldve: ${ticket.ticket_number}. Nézze meg az előzményeket.` : `Repair returned for correction: ${ticket.ticket_number}. Check ticket history.`);
          setHistoryRevision(prev => ({ ...prev, [ticket.id]: (prev[ticket.id] || 0) + 1 }));
        }
      }
      previouslyAwaiting.current = new Set(activeRows.filter(ticket => ticket.pending_supervisor_approval).map(ticket => ticket.id));
      setTickets(activeRows);
      setCompleted(completedRows);
      void loadAttachmentUrls([...activeRows, ...completedRows]);
    } catch (error) {
      console.error('Maintenance task load failed:', error);
      setLoadError(error instanceof Error ? error.message : c.failed);
      setTickets([]); setCompleted([]); setSignedIn(false);
    } finally { setLoading(false); }
  }, [user?.id, profile?.organization_slug, profile?.assigned_hotel, loadAttachmentUrls, c.failed, language]);

  useEffect(() => {
    void refresh();
    if (!user?.id) return;
    const channel = supabase.channel(`maintenance-staff-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets', filter: `assigned_to=eq.${user.id}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_attendance', filter: `user_id=eq.${user.id}` }, () => void refresh())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [refresh, user?.id]);

  const addComment = async (ticketId: string, content: string) => {
    if (!user?.id || !content.trim()) return;
    const { error } = await supabase.from('comments').insert({ ticket_id: ticketId, user_id: user.id, content: content.trim() });
    if (error) throw error;
    setHistoryRevision(prev => ({ ...prev, [ticketId]: (prev[ticketId] || 0) + 1 }));
  };

  const startWork = async (ticket: Ticket) => {
    if (!signedIn) { toast.error(c.notSignedIn); return; }
    const { error } = await supabase.from('tickets').update({ status: 'in_progress', on_hold: false, hold_reason: null, updated_at: new Date().toISOString() }).eq('id', ticket.id).eq('assigned_to', user?.id);
    if (error) { toast.error(c.failed); return; }
    await addComment(ticket.id, `▶ ${c.workStarted}`).catch(console.error);
    toast.success(c.workStarted); void refresh();
  };

  const saveNote = async () => {
    if (!selected || !note.trim()) return;
    try { await addComment(selected.id, note); toast.success(c.noteSaved); setNote(''); setDialog(null); } catch { toast.error(c.failed); }
  };

  const saveHold = async () => {
    if (!selected || !holdReason) return;
    try {
      const { error } = await supabase.from('tickets').update({ status: 'in_progress', on_hold: true, hold_reason: holdReason, updated_at: new Date().toISOString() }).eq('id', selected.id).eq('assigned_to', user?.id);
      if (error) throw error;
      const label = c[HOLD_REASONS.find(([value]) => value === holdReason)?.[1] || 'other'];
      await addComment(selected.id, `⏸ ${label}${holdDetails.trim() ? ` — ${holdDetails.trim()}` : ''}`);
      toast.success(c.holdSaved); setHoldReason(''); setHoldDetails(''); setDialog(null); void refresh();
    } catch { toast.error(c.failed); }
  };

  const resumeWork = async (ticket: Ticket) => {
    if (!signedIn) { toast.error(c.notSignedIn); return; }
    const { error } = await supabase.from('tickets').update({ on_hold: false, hold_reason: null, status: 'in_progress', updated_at: new Date().toISOString() }).eq('id', ticket.id).eq('assigned_to', user?.id);
    if (error) { toast.error(c.failed); return; }
    await addComment(ticket.id, `▶ ${c.resumed}`).catch(console.error); toast.success(c.resumed); void refresh();
  };

  const submitCompletion = async () => {
    if (isSubmittingCompletion) return;
    if (!selected || !resolution.trim() || !user?.id || !profile?.organization_slug) { toast.error(c.photoRequired); return; }
    const invalid = validateCompletionFiles(completionFiles);
    if (invalid) { toast.error(invalid); return; }
    setIsSubmittingCompletion(true);
    setUploadProgress(0);
    try {
      const uploaded: string[] = [];
      for (let index = 0; index < completionFiles.length; index++) {
        const file = completionFiles[index];
        const signature = `${selected.id}:${file.name}:${file.size}:${file.lastModified}`;
        let path = uploadedPathsRef.current.get(signature);
        if (!path) {
          const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
          path = `${selected.id}/completion-${crypto.randomUUID()}.${ext}`;
          const { error: uploadError } = await supabase.storage.from('ticket-attachments').upload(path, file, { upsert: false, contentType: file.type });
          if (uploadError) throw uploadError;
          uploadedPathsRef.current.set(signature, path);
        }
        uploaded.push(path);
        setUploadProgress(index + 1);
      }
      // Read the canonical current record before appending. Never overwrite
      // photos from a prior repair or another technician's latest update.
      const { data: latest, error: readError } = await supabase.from('tickets')
        .select('completion_photos,updated_at')
        .eq('id', selected.id).eq('assigned_to', user.id)
        .eq('organization_slug', profile.organization_slug)
        .eq('department', 'maintenance').single();
      if (readError || !latest) throw readError || new Error('Maintenance issue was not available.');
      const { error, data: updated } = await supabase.from('tickets').update({
        status: 'in_progress', resolution_text: resolution.trim(),
        completion_photos: mergeCompletionPhotos(latest.completion_photos, uploaded),
        pending_supervisor_approval: true,
        on_hold: false, hold_reason: null, updated_at: new Date().toISOString(),
      }).eq('id', selected.id).eq('assigned_to', user.id)
        .eq('organization_slug', profile.organization_slug)
        .eq('updated_at', latest.updated_at)
        .select('id').single();
      if (error || !updated) throw error || new Error('The issue changed while uploading. Refresh and retry.');
      try { await addComment(selected.id, `✅ ${c.submitted}: ${resolution.trim()} (${uploaded.length} photos)`); }
      catch (commentError) { console.warn('Repair submitted, but the history comment could not be added:', commentError); }
      toast.success(c.submitted);
      setResolution(''); setCompletionFiles([]); uploadedPathsRef.current.clear();
      setDialog(null); void refresh();
    } catch (error) {
      console.error(error);
      toast.error(language === 'hu'
        ? `Nem sikerült befejezni. ${uploadProgress} fotó feltöltve; ismételje meg a beküldést.`
        : `Submission incomplete. Uploaded photos are retained for retry. Please retry.`);
    } finally { setIsSubmittingCompletion(false); }
  };

  const filtered = activeTab === 'approval' ? tickets.filter(t => t.pending_supervisor_approval) : activeTab === 'done' ? completed : tickets.filter(t => !t.pending_supervisor_approval);
  const counts = { active: tickets.filter(t => !t.pending_supervisor_approval).length, approval: tickets.filter(t => t.pending_supervisor_approval).length, done: completed.length };
  const status = (ticket: Ticket) => ticket.pending_supervisor_approval ? c.statusApproval : ticket.on_hold ? c.statusHold : ticket.status === 'in_progress' ? c.statusProgress : ticket.status === 'completed' ? c.statusDone : c.statusOpen;
  const statusClass = (ticket: Ticket) => ticket.pending_supervisor_approval ? 'bg-blue-100 text-blue-800 border-blue-200' : ticket.on_hold ? 'bg-amber-100 text-amber-800 border-amber-200' : ticket.status === 'in_progress' ? 'bg-violet-100 text-violet-800 border-violet-200' : ticket.status === 'completed' ? 'bg-green-100 text-green-800 border-green-200' : 'bg-slate-100 text-slate-800 border-slate-200';
  const priorityClass = (p: string) => p === 'urgent' ? 'bg-red-100 text-red-800' : p === 'high' ? 'bg-orange-100 text-orange-800' : p === 'low' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800';

  return (
    <div className="space-y-4 px-2 sm:px-0 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-xl sm:text-2xl font-bold flex items-center gap-2"><Wrench className="h-5 w-5" />{c.title}</h2><p className="text-sm text-muted-foreground">{c.subtitle}</p></div>
        <Button size="sm" variant="outline" onClick={() => {
          setHistoryRevision(prev => {
            const next = { ...prev };
            for (const ticket of [...tickets, ...completed]) next[ticket.id] = (next[ticket.id] || 0) + 1;
            return next;
          });
          void refresh();
        }}><RefreshCw className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">{c.refresh}</span></Button>
      </div>
      <div className={`rounded-lg border p-3 flex items-center gap-2 text-sm ${signedIn ? 'bg-green-50 border-green-200 text-green-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
        {signedIn ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}<strong>{signedIn ? c.signedIn : c.notSignedIn}</strong>
      </div>
      {loadError && <div role="alert" className="rounded-md border border-red-300 p-3 text-sm text-red-700">{loadError} <Button variant="outline" size="sm" onClick={() => void refresh()}>Retry</Button></div>}
      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => setActiveTab('active')} className={`rounded-xl border p-3 text-left ${activeTab === 'active' ? 'border-primary bg-primary/5' : ''}`}><div className="text-xs text-muted-foreground">{c.active}</div><div className="text-xl font-bold">{counts.active}</div></button>
        <button onClick={() => setActiveTab('approval')} className={`rounded-xl border p-3 text-left ${activeTab === 'approval' ? 'border-primary bg-primary/5' : ''}`}><div className="text-xs text-muted-foreground">{c.approval}</div><div className="text-xl font-bold">{counts.approval}</div></button>
        <button onClick={() => setActiveTab('done')} className={`rounded-xl border p-3 text-left ${activeTab === 'done' ? 'border-primary bg-primary/5' : ''}`}><div className="text-xs text-muted-foreground">{c.done}</div><div className="text-xl font-bold">{counts.done}</div></button>
      </div>
      {loadError ? null : loading ? <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div> : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center"><CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-muted-foreground" /><p className="text-muted-foreground">{c.noTasks}</p></CardContent></Card>
      ) : <div className="space-y-3">{filtered.map(ticket => (
        <Card key={ticket.id} className={`overflow-hidden border-l-4 ${ticket.priority === 'urgent' ? 'border-l-red-500' : ticket.priority === 'high' ? 'border-l-orange-500' : 'border-l-primary/60'}`}>
          <CardHeader className="p-3 pb-2">
            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><CardTitle className="text-lg flex items-center gap-2 flex-wrap"><span>{c.room} {ticket.room_number}</span><Badge className={priorityClass(ticket.priority)}>{ticket.priority.toUpperCase()}</Badge><Badge variant="outline" className={statusClass(ticket)}>{status(ticket)}</Badge></CardTitle><div className="text-xs text-muted-foreground mt-1">{ticket.ticket_number}</div></div></div>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-3">
            <div className="rounded-lg bg-muted/50 p-2 text-xs"><div className="text-muted-foreground flex items-center gap-1"><Building2 className="h-3 w-3" />{c.hotel}</div><div className="font-semibold break-words">{ticket.hotel || '—'}</div></div>
            <MaintenanceTicketLanguagePanel ticket={ticket} language={language} reporterFallback={ticket.created_by_profile?.full_name} revision={historyRevision[ticket.id] || 0} />
            {ticket.on_hold && ticket.hold_reason && <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 p-2.5 text-xs flex gap-2"><PauseCircle className="h-4 w-4 shrink-0" />{c[HOLD_REASONS.find(([v]) => v === ticket.hold_reason)?.[1] || 'other']}</div>}
            <MaintenanceIssueEvidence originalPhotos={ticket.attachment_urls} completionPhotos={ticket.completion_photos} />
            {!!attachmentUrls[ticket.id]?.length && <div className="space-y-1.5"><div className="text-xs font-semibold text-muted-foreground">{c.attachments} ({attachmentUrls[ticket.id].length})</div><div className="flex gap-2 flex-wrap">{attachmentUrls[ticket.id].map((url, idx) => <Dialog key={idx}><DialogTrigger asChild><Button size="sm" variant="outline"><Eye className="h-3.5 w-3.5 mr-1" />{idx + 1}</Button></DialogTrigger><DialogContent className="max-w-4xl"><img src={url} alt={`Attachment ${idx + 1}`} className="max-h-[80vh] w-auto mx-auto" /></DialogContent></Dialog>)}</div></div>}
            {activeTab !== 'done' && <div className="grid grid-cols-2 sm:flex gap-2">
              {ticket.status === 'open' && !ticket.pending_supervisor_approval && <Button onClick={() => void startWork(ticket)} disabled={!signedIn} className="h-10"><Play className="h-4 w-4 mr-1" />{c.start}</Button>}
              {ticket.status === 'in_progress' && !ticket.on_hold && !ticket.pending_supervisor_approval && <Button variant="outline" onClick={() => { setSelected(ticket); setDialog('hold'); }}><PauseCircle className="h-4 w-4 mr-1" />{c.hold}</Button>}
              {ticket.on_hold && !ticket.pending_supervisor_approval && <Button onClick={() => void resumeWork(ticket)} disabled={!signedIn}><Play className="h-4 w-4 mr-1" />{c.resume}</Button>}
              {!ticket.pending_supervisor_approval && <Button variant="outline" onClick={() => { setSelected(ticket); setDialog('note'); }}><MessageSquare className="h-4 w-4 mr-1" />{c.note}</Button>}
              {ticket.status === 'in_progress' && !ticket.on_hold && !ticket.pending_supervisor_approval && <Button onClick={() => { setSelected(ticket); setResolution(ticket.resolution_text || ''); setCompletionFiles([]); uploadedPathsRef.current.clear(); if (fileRef.current) fileRef.current.value = ''; setDialog('complete'); }} className="bg-green-600 hover:bg-green-700"><CheckCircle2 className="h-4 w-4 mr-1" />{c.complete}</Button>}
            </div>}
            <div className="text-[11px] text-muted-foreground flex items-center gap-1"><Clock3 className="h-3 w-3" />{new Date(ticket.updated_at || ticket.created_at).toLocaleString()}</div>
          </CardContent>
        </Card>
      ))}</div>}
      <Dialog open={dialog === 'note'} onOpenChange={(open) => !open && setDialog(null)}><DialogContent><DialogHeader><DialogTitle>{c.note}</DialogTitle></DialogHeader><Textarea value={note} onChange={e => setNote(e.target.value)} placeholder={c.notePlaceholder} rows={4} /><div className="grid grid-cols-2 gap-2"><Button variant="outline" onClick={() => setDialog(null)}>{c.cancel}</Button><Button onClick={() => void saveNote()} disabled={!note.trim()}>{c.saveNote}</Button></div></DialogContent></Dialog>
      <Dialog open={dialog === 'hold'} onOpenChange={(open) => !open && setDialog(null)}><DialogContent><DialogHeader><DialogTitle>{c.holdReason}</DialogTitle></DialogHeader><Select value={holdReason} onValueChange={setHoldReason}><SelectTrigger><SelectValue placeholder={c.holdReason} /></SelectTrigger><SelectContent>{HOLD_REASONS.map(([value, key]) => <SelectItem key={value} value={value}>{c[key]}</SelectItem>)}</SelectContent></Select><Textarea value={holdDetails} onChange={e => setHoldDetails(e.target.value)} placeholder={c.pendingDetails} rows={3} /><div className="grid grid-cols-2 gap-2"><Button variant="outline" onClick={() => setDialog(null)}>{c.cancel}</Button><Button onClick={() => void saveHold()} disabled={!holdReason}>{c.saveHold}</Button></div></DialogContent></Dialog>
      <Dialog open={dialog === 'complete'} onOpenChange={(next) => { if (!next && !isSubmittingCompletion) setDialog(null); }}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-lg max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader><DialogTitle>{c.complete}</DialogTitle></DialogHeader>
          <Textarea value={resolution} onChange={e => setResolution(e.target.value)} placeholder={c.resolutionPlaceholder} rows={4} disabled={isSubmittingCompletion} />
          <p className="text-xs text-muted-foreground">{language === 'hu'
            ? 'Az eredeti hibafotókat megtartjuk. Válasszon több javítás utáni fotót vagy készítsen képeket.'
            : 'Original issue photos are preserved. Take or choose multiple after-repair photos.'}</p>
          <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" aria-label={c.photoRequired} onChange={e => {
            const next = [...completionFiles, ...Array.from(e.currentTarget.files || [])];
            const invalid = validateCompletionFiles(next);
            if (invalid) { toast.error(invalid); e.currentTarget.value = ''; return; }
            setCompletionFiles(next);
            e.currentTarget.value = '';
          }} />
          <Button type="button" variant="outline" disabled={isSubmittingCompletion} className="h-auto min-h-11 w-full min-w-0 justify-start whitespace-normal py-2 text-left" onClick={() => fileRef.current?.click()}>
            <Camera className="mr-2 h-4 w-4 shrink-0" /><span>{language === 'hu' ? 'Fotók készítése / kiválasztása' : 'Take or choose photos'} ({completionFiles.length}/{MAX_COMPLETION_PHOTOS})</span>
          </Button>
          {completionFiles.length ? <div className="grid grid-cols-3 gap-2" aria-label={language === 'hu' ? 'Kiválasztott fotók' : 'Selected photos'}>
            {completionFiles.map((file, index) => <div key={`${file.name}-${file.lastModified}-${index}`} className="relative rounded border p-1">
              {previews[index] && <img src={previews[index]} alt={`${language === 'hu' ? 'Befejezési fotó' : 'Completion photo'} ${index + 1}`} className="h-20 w-full object-cover" />}
              <p className="truncate text-[10px]">{file.name}</p>
              <Button type="button" variant="outline" size="sm" disabled={isSubmittingCompletion} aria-label={`${language === 'hu' ? 'Fotó eltávolítása' : 'Remove photo'} ${index + 1}`}
                onClick={() => { setCompletionFiles(files => files.filter((_, i) => i !== index)); }} className="absolute right-1 top-1 h-6 w-6 p-0"><X className="h-3 w-3" /></Button>
            </div>)}
          </div> : <p className="text-xs text-amber-700" role="status">{c.photoRequired}</p>}
          {isSubmittingCompletion && <p role="status" className="text-xs">{language === 'hu' ? 'Fotók feltöltése' : 'Uploading photos'}: {uploadProgress}/{completionFiles.length}</p>}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button type="button" className="h-auto min-h-11 w-full min-w-0 whitespace-normal py-2" variant="outline" disabled={isSubmittingCompletion} onClick={() => setDialog(null)}>{c.cancel}</Button>
            <Button type="button" className="h-auto min-h-11 w-full min-w-0 whitespace-normal break-words bg-green-600 py-2 text-center leading-snug hover:bg-green-700"
              onClick={() => void submitCompletion()} disabled={isSubmittingCompletion || !resolution.trim() || completionFiles.length === 0}>
              <CheckCircle2 className="mr-1 h-4 w-4 shrink-0" />{isSubmittingCompletion ? (language === 'hu' ? 'Beküldés…' : 'Submitting…') : c.submitApproval}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
