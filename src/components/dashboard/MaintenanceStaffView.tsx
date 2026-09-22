import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { todayBudapest } from '@/lib/budapestTime';
import { getSignedPhotoUrls } from '@/lib/storageUrls';
import { maintenanceStaffLanguageOverrides } from '@/lib/maintenanceStaffLanguageOverrides';
import { MaintenanceTicketLanguagePanel } from './MaintenanceTicketLanguagePanel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertTriangle, Building2, Camera, CheckCircle2, Clock3, Eye, MessageSquare, PauseCircle, Play, RefreshCw, Wrench } from 'lucide-react';
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
  resolutionPlaceholder: 'Describe the repair and what was done…', photoRequired: 'Add one completion photo before submitting.', submitApproval: 'Submit for supervisor approval',
  workStarted: 'Work started', holdSaved: 'Ticket marked pending', resumed: 'Work resumed', noteSaved: 'Note added', submitted: 'Submitted for supervisor approval', failed: 'Action failed', refresh: 'Refresh',
};
const HU: Copy = {
  ...EN, title: 'Karbantartási feladataim', subtitle: 'Csak az Önhöz rendelt, ehhez a hotelhez tartozó jegyeken dolgozzon.', signedIn: 'Bejelentkezve', notSignedIn: 'A munka megkezdése előtt jelentkezzen be',
  active: 'Aktív', approval: 'Jóváhagyásra vár', done: 'Kész', noTasks: 'Nincs Önhöz rendelt karbantartási feladat.', room: 'Szoba',
  attachments: 'Mellékletek', start: 'Munka indítása', note: 'Jegyzet', hold: 'Függőben', resume: 'Munka folytatása', complete: 'Munka befejezése',
  statusOpen: 'Nyitott', statusProgress: 'Folyamatban', statusHold: 'Függőben', statusApproval: 'Jóváhagyásra vár', statusDone: 'Kész',
  holdReason: 'Miért van függőben?', parts: 'Alkatrészre vár', purchase: 'Beszerzés folyamatban', access: 'Szobahozzáférésre vár', approvalReason: 'Jóváhagyásra vár', contractor: 'Külső szakember szükséges', other: 'Egyéb',
  pendingDetails: 'Írjon részleteket, hogy a felügyelő lássa, mi akadályozza a javítást.', saveHold: 'Függő ok mentése', cancel: 'Mégse', saveNote: 'Jegyzet mentése', notePlaceholder: 'Írjon frissítést a felügyelőnek…',
  resolutionPlaceholder: 'Írja le a javítást és az elvégzett munkát…', photoRequired: 'A beküldés előtt adjon hozzá egy befejezési fotót.', submitApproval: 'Beküldés felügyelői jóváhagyásra',
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
  ru: { ...EN, title: 'Мои задачи по техобслуживанию', active: 'Активные', approval: 'Ожидает одобрения', done: 'Готово', note: 'Добавить заметку' },
  si: EN,
};
const HOLD_REASONS = [
  ['parts_pending', 'parts'], ['purchase_in_progress', 'purchase'], ['waiting_for_access', 'access'],
  ['waiting_for_approval', 'approvalReason'], ['external_contractor', 'contractor'], ['other', 'other'],
] as const;

export function MaintenanceStaffView() {
  const { user } = useAuth();
  const { language } = useTranslation();
  const c: Copy = { ...(translations[language] || EN), ...(maintenanceStaffLanguageOverrides[language] || {}) };
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [completed, setCompleted] = useState<Ticket[]>([]);
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);
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
  const [completionFile, setCompletionFile] = useState<File | null>(null);
  const [isSubmittingCompletion, setIsSubmittingCompletion] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
    if (!user?.id) return;
    setLoading(true);
    try {
      const today = todayBudapest();
      const [{ data: attendance }, { data: activeData, error: activeError }, { data: completedData, error: completedError }] = await Promise.all([
        supabase.from('staff_attendance').select('id').eq('user_id', user.id).eq('work_date', today).eq('status', 'checked_in').limit(1),
        (supabase as any).from('tickets').select(`
          id, ticket_number, title, description, room_number, hotel, priority, status, created_at, updated_at,
          attachment_urls, completion_photos, pending_supervisor_approval, on_hold, hold_reason, resolution_text,
          created_by_profile:profiles!tickets_created_by_fkey(full_name, role)
        `).eq('assigned_to', user.id).eq('department', 'maintenance').or('status.neq.completed,pending_supervisor_approval.eq.true').order('priority', { ascending: false }).order('created_at', { ascending: false }),
        (supabase as any).from('tickets').select(`
          id, ticket_number, title, description, room_number, hotel, priority, status, created_at, updated_at,
          attachment_urls, completion_photos, pending_supervisor_approval, on_hold, hold_reason, resolution_text,
          created_by_profile:profiles!tickets_created_by_fkey(full_name, role)
        `).eq('assigned_to', user.id).eq('department', 'maintenance').eq('status', 'completed').or('pending_supervisor_approval.is.null,pending_supervisor_approval.eq.false').order('closed_at', { ascending: false }).limit(30),
      ]);
      if (activeError || completedError) throw activeError || completedError;
      setSignedIn(!!attendance?.length);
      const activeRows = (activeData || []) as Ticket[];
      const completedRows = (completedData || []) as Ticket[];
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
      toast.error(c.failed);
    } finally { setLoading(false); }
  }, [user?.id, loadAttachmentUrls, c.failed, language]);

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
    if (!selected || !resolution.trim() || !completionFile || !user?.id) { toast.error(c.photoRequired); return; }
    if (!completionFile.type.startsWith('image/')) { toast.error(c.photoRequired); return; }
    setIsSubmittingCompletion(true);
    try {
      const ext = completionFile.name.split('.').pop() || 'jpg';
      const path = `${selected.id}/completion-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('ticket-attachments').upload(path, completionFile, { upsert: false });
      if (uploadError) throw uploadError;
      const { error } = await supabase.from('tickets').update({
        status: 'in_progress', resolution_text: resolution.trim(), completion_photos: [path], pending_supervisor_approval: true,
        on_hold: false, hold_reason: null, updated_at: new Date().toISOString(),
      }).eq('id', selected.id).eq('assigned_to', user.id);
      if (error) throw error;
      await addComment(selected.id, `✅ ${c.submitted}: ${resolution.trim()}`);
      toast.success(c.submitted); setResolution(''); setCompletionFile(null); setDialog(null); void refresh();
    } catch (error) { console.error(error); toast.error(c.failed); }
    finally { setIsSubmittingCompletion(false); }
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
      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => setActiveTab('active')} className={`rounded-xl border p-3 text-left ${activeTab === 'active' ? 'border-primary bg-primary/5' : ''}`}><div className="text-xs text-muted-foreground">{c.active}</div><div className="text-xl font-bold">{counts.active}</div></button>
        <button onClick={() => setActiveTab('approval')} className={`rounded-xl border p-3 text-left ${activeTab === 'approval' ? 'border-primary bg-primary/5' : ''}`}><div className="text-xs text-muted-foreground">{c.approval}</div><div className="text-xl font-bold">{counts.approval}</div></button>
        <button onClick={() => setActiveTab('done')} className={`rounded-xl border p-3 text-left ${activeTab === 'done' ? 'border-primary bg-primary/5' : ''}`}><div className="text-xs text-muted-foreground">{c.done}</div><div className="text-xl font-bold">{counts.done}</div></button>
      </div>
      {loading ? <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div> : filtered.length === 0 ? (
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
            {!!attachmentUrls[ticket.id]?.length && <div className="space-y-1.5"><div className="text-xs font-semibold text-muted-foreground">{c.attachments} ({attachmentUrls[ticket.id].length})</div><div className="flex gap-2 flex-wrap">{attachmentUrls[ticket.id].map((url, idx) => <Dialog key={idx}><DialogTrigger asChild><Button size="sm" variant="outline"><Eye className="h-3.5 w-3.5 mr-1" />{idx + 1}</Button></DialogTrigger><DialogContent className="max-w-4xl"><img src={url} alt={`Attachment ${idx + 1}`} className="max-h-[80vh] w-auto mx-auto" /></DialogContent></Dialog>)}</div></div>}
            {activeTab !== 'done' && <div className="grid grid-cols-2 sm:flex gap-2">
              {ticket.status === 'open' && !ticket.pending_supervisor_approval && <Button onClick={() => void startWork(ticket)} disabled={!signedIn} className="h-10"><Play className="h-4 w-4 mr-1" />{c.start}</Button>}
              {ticket.status === 'in_progress' && !ticket.on_hold && !ticket.pending_supervisor_approval && <Button variant="outline" onClick={() => { setSelected(ticket); setDialog('hold'); }}><PauseCircle className="h-4 w-4 mr-1" />{c.hold}</Button>}
              {ticket.on_hold && !ticket.pending_supervisor_approval && <Button onClick={() => void resumeWork(ticket)} disabled={!signedIn}><Play className="h-4 w-4 mr-1" />{c.resume}</Button>}
              {!ticket.pending_supervisor_approval && <Button variant="outline" onClick={() => { setSelected(ticket); setDialog('note'); }}><MessageSquare className="h-4 w-4 mr-1" />{c.note}</Button>}
              {ticket.status === 'in_progress' && !ticket.on_hold && !ticket.pending_supervisor_approval && <Button onClick={() => { setSelected(ticket); setResolution(ticket.resolution_text || ''); setCompletionFile(null); if (fileRef.current) fileRef.current.value = ''; setDialog('complete'); }} className="bg-green-600 hover:bg-green-700"><CheckCircle2 className="h-4 w-4 mr-1" />{c.complete}</Button>}
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
            ? 'A hibabejelentés mellékletei nem helyettesítik a javítás utáni fotót. Készítsen képet, vagy válassza ki a galériából.'
            : 'Issue attachments show the original problem. Add a separate after-repair photo using the camera or gallery.'}</p>
          <input ref={fileRef} type="file" accept="image/*" className="sr-only" aria-label={c.photoRequired} onChange={e => {
            const file = e.currentTarget.files?.[0] || null;
            if (file && !file.type.startsWith('image/')) { toast.error(c.photoRequired); e.currentTarget.value = ''; setCompletionFile(null); return; }
            setCompletionFile(file);
          }} />
          <Button type="button" variant="outline" disabled={isSubmittingCompletion} className="h-auto min-h-11 w-full min-w-0 justify-start whitespace-normal break-all py-2 text-left" onClick={() => fileRef.current?.click()}>
            <Camera className="mr-2 h-4 w-4 shrink-0" /><span className="min-w-0 flex-1">{completionFile
              ? `${language === 'hu' ? 'Kiválasztott fotó' : 'Selected photo'}: ${completionFile.name}`
              : language === 'hu' ? 'Befejezési fotó készítése / kiválasztása' : 'Take or choose completion photo'}</span>
          </Button>
          {!completionFile && <p className="text-xs text-amber-700" role="status">{c.photoRequired}</p>}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button type="button" className="h-auto min-h-11 w-full min-w-0 whitespace-normal py-2" variant="outline" disabled={isSubmittingCompletion} onClick={() => setDialog(null)}>{c.cancel}</Button>
            <Button type="button" className="h-auto min-h-11 w-full min-w-0 whitespace-normal break-words bg-green-600 py-2 text-center leading-snug hover:bg-green-700"
              onClick={() => void submitCompletion()} disabled={isSubmittingCompletion || !resolution.trim() || !completionFile}>
              <CheckCircle2 className="mr-1 h-4 w-4 shrink-0" />{isSubmittingCompletion ? (language === 'hu' ? 'Beküldés…' : 'Submitting…') : c.submitApproval}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
