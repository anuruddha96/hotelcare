import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Building2, CalendarDays, CheckCircle2, Clock3, Loader2, Plus, Sparkles, Trash2, UserRound } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

type PlannedNote = {
  id: string;
  room_id: string;
  start_date: string;
  end_date: string;
  selected_dates: string[] | null;
  instruction_type: string;
  content: string;
  status: string;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

const TYPES = [
  ['general', 'General'], ['baby_bed', 'Baby bed'], ['extra_bed', 'Extra bed'],
  ['towels', 'Towels'], ['linen', 'Linen'], ['vip', 'VIP'], ['maintenance', 'Maintenance'],
  ['cleaning', 'Cleaning'], ['guest_request', 'Guest request'], ['other', 'Other'],
] as const;

function localDate(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function appliesOn(note: PlannedNote, date: string) {
  if (note.status !== 'active') return false;
  if (note.selected_dates?.length) return note.selected_dates.includes(date);
  return note.start_date <= date && note.end_date >= date;
}

function prettyDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function shortDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface Props {
  roomId: string;
  roomNumber: string;
  hotelName: string;
  canEdit: boolean;
  onTodayNotesChange?: (notes: PlannedNote[]) => void;
}

export function RoomPlannedNotesCalendar({ roomId, roomNumber, hotelName, canEdit, onTodayNotesChange }: Props) {
  const { profile } = useAuth();
  const [notes, setNotes] = useState<PlannedNote[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [startDate, setStartDate] = useState(localDate(1));
  const [endDate, setEndDate] = useState(localDate(1));
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [type, setType] = useState('general');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<Record<string, 'saving' | 'saved' | 'error'>>({});
  const [propertyOpen, setPropertyOpen] = useState(false);
  const [propertyLoading, setPropertyLoading] = useState(false);
  const [propertyNotes, setPropertyNotes] = useState<PlannedNote[]>([]);
  const [propertyRoomNumbers, setPropertyRoomNumbers] = useState<Record<string, string>>({});
  const [propertyDate, setPropertyDate] = useState(localDate());
  const timers = useRef<Record<string, number>>({});
  const onTodayNotesChangeRef = useRef(onTodayNotesChange);

  useEffect(() => { onTodayNotesChangeRef.current = onTodayNotesChange; }, [onTodayNotesChange]);

  const loadNames = useCallback(async (rows: PlannedNote[]) => {
    const ids = Array.from(new Set(rows.flatMap((n) => [n.created_by, n.updated_by]).filter(Boolean)));
    if (!ids.length) return;
    const { data: people } = await supabase.from('profiles').select('id, full_name, nickname').in('id', ids);
    if (people?.length) {
      setNames((current) => ({
        ...current,
        ...Object.fromEntries(people.map((p: any) => [p.id, p.full_name || p.nickname || 'HotelCare user'])),
      }));
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('room_planned_notes')
        .select('*')
        .eq('room_id', roomId)
        .neq('status', 'cancelled')
        .gte('end_date', localDate(-31))
        .order('start_date', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      const rows = (data || []) as PlannedNote[];
      setNotes(rows);
      await loadNames(rows);
    } catch (error: any) {
      console.error('Could not load planned room notes', error);
      toast.error(error?.message || 'Could not load planned room notes');
    } finally {
      setLoading(false);
    }
  }, [loadNames, roomId]);

  const loadPropertyCalendar = useCallback(async () => {
    setPropertyLoading(true);
    try {
      const { data: currentRoom, error: roomError } = await (supabase as any)
        .from('rooms')
        .select('hotel')
        .eq('id', roomId)
        .maybeSingle();
      if (roomError) throw roomError;
      const propertyHotel = currentRoom?.hotel || hotelName;
      const { data, error } = await (supabase as any)
        .from('room_planned_notes')
        .select('*')
        .eq('hotel', propertyHotel)
        .eq('status', 'active')
        .gte('end_date', localDate())
        .order('start_date', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(250);
      if (error) throw error;
      const rows = (data || []) as PlannedNote[];
      setPropertyNotes(rows);
      await loadNames(rows);

      const roomIds = Array.from(new Set(rows.map((row) => row.room_id).filter(Boolean)));
      if (!roomIds.length) {
        setPropertyRoomNumbers({});
        return;
      }
      const { data: rooms, error: roomsError } = await (supabase as any)
        .from('rooms')
        .select('id, room_number')
        .in('id', roomIds);
      if (roomsError) throw roomsError;
      setPropertyRoomNumbers(Object.fromEntries((rooms || []).map((room: any) => [room.id, room.room_number])));
    } catch (error: any) {
      console.error('Could not load property room-note calendar', error);
      toast.error(error?.message || 'Could not load the property calendar');
    } finally {
      setPropertyLoading(false);
    }
  }, [hotelName, loadNames, roomId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    onTodayNotesChangeRef.current?.(notes.filter((n) => appliesOn(n, localDate())));
  }, [notes]);
  useEffect(() => () => Object.values(timers.current).forEach((id) => window.clearTimeout(id)), []);
  useEffect(() => {
    if (propertyOpen) void loadPropertyCalendar();
  }, [propertyOpen, loadPropertyCalendar]);

  const upcoming = useMemo(() => notes.filter((n) => n.status === 'active' && n.end_date >= localDate()).slice(0, 20), [notes]);
  const todayNotes = useMemo(() => notes.filter((n) => appliesOn(n, localDate())), [notes]);
  const propertyDayNotes = useMemo(
    () => propertyNotes
      .filter((note) => appliesOn(note, propertyDate))
      .sort((a, b) => String(propertyRoomNumbers[a.room_id] || '').localeCompare(String(propertyRoomNumbers[b.room_id] || ''), undefined, { numeric: true })),
    [propertyDate, propertyNotes, propertyRoomNumbers],
  );

  const toggleQuickDate = (date: string) => {
    setSelectedDates((current) => current.includes(date) ? current.filter((d) => d !== date) : [...current, date].sort());
  };

  const createNote = async () => {
    if (!canEdit || !content.trim() || !profile?.id) return;
    const dates = selectedDates.length ? selectedDates : null;
    const first = dates?.[0] || startDate;
    const last = dates?.[dates.length - 1] || endDate;
    if (last < first) return toast.error('End date must be on or after the start date.');
    setSaving(true);
    try {
      const { error } = await (supabase as any).from('room_planned_notes').insert({
        room_id: roomId,
        hotel: hotelName,
        start_date: first,
        end_date: last,
        selected_dates: dates,
        instruction_type: type,
        content: content.trim(),
        created_by: profile.id,
        updated_by: profile.id,
      });
      if (error) throw error;
      setContent('');
      setSelectedDates([]);
      setStartDate(localDate(1));
      setEndDate(localDate(1));
      setComposerOpen(false);
      toast.success(`Room ${roomNumber}: planned instruction saved`);
      await load();
      if (propertyOpen) await loadPropertyCalendar();
    } catch (error: any) {
      toast.error(error?.message || 'Could not save planned instruction');
    } finally {
      setSaving(false);
    }
  };

  const autosave = (id: string, nextContent: string) => {
    setNotes((current) => current.map((n) => n.id === id ? { ...n, content: nextContent } : n));
    setPropertyNotes((current) => current.map((n) => n.id === id ? { ...n, content: nextContent } : n));
    if (timers.current[id]) window.clearTimeout(timers.current[id]);
    setSaveState((s) => ({ ...s, [id]: 'saving' }));
    timers.current[id] = window.setTimeout(async () => {
      try {
        const { error } = await (supabase as any).from('room_planned_notes').update({
          content: nextContent.trim(),
          updated_by: profile?.id,
        }).eq('id', id);
        if (error) throw error;
        const savedAt = new Date().toISOString();
        setSaveState((s) => ({ ...s, [id]: 'saved' }));
        const applySavedMeta = (current: PlannedNote[]) => current.map((n) => n.id === id ? { ...n, updated_at: savedAt, updated_by: profile?.id || n.updated_by } : n);
        setNotes(applySavedMeta);
        setPropertyNotes(applySavedMeta);
      } catch (error) {
        console.error('Planned note autosave failed', error);
        setSaveState((s) => ({ ...s, [id]: 'error' }));
      }
    }, 700);
  };

  const cancelNote = async (id: string) => {
    if (!canEdit) return;
    const { error } = await (supabase as any).from('room_planned_notes').update({ status: 'cancelled', updated_by: profile?.id }).eq('id', id);
    if (error) return toast.error('Could not remove planned instruction');
    setNotes((current) => current.filter((n) => n.id !== id));
    setPropertyNotes((current) => current.filter((n) => n.id !== id));
    toast.success('Planned instruction removed');
  };

  return (
    <section className="rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50/80 to-white p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <CalendarDays className="h-4 w-4 text-sky-700" />
            <p className="text-sm font-bold text-sky-950">Planned room notes</p>
            <Badge className="bg-gradient-to-r from-fuchsia-600 to-violet-600 text-[9px]"><Sparkles className="mr-1 h-3 w-3" />NEW</Badge>
          </div>
          <p className="mt-1 text-[11px] text-sky-900/70">Room {roomNumber} · {hotelName}. Future instructions stay separate from PMS sync.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="border-sky-300" onClick={() => setPropertyOpen((value) => !value)}>
            <Building2 className="mr-1 h-3.5 w-3.5" />{propertyOpen ? 'Hide property calendar' : 'Property calendar'}
          </Button>
          {canEdit && <Button size="sm" variant="outline" className="border-sky-300" onClick={() => setComposerOpen((v) => !v)}><Plus className="mr-1 h-3.5 w-3.5" />Plan note</Button>}
        </div>
      </div>

      {todayNotes.length > 0 && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-800">Active today</p>
          {todayNotes.map((n) => <p key={n.id} className="mt-1 text-xs font-semibold text-emerald-950">• {n.content}</p>)}
        </div>
      )}

      {propertyOpen && (
        <div className="mt-3 rounded-xl border border-sky-200 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-slate-900">{hotelName} · property room-note calendar</p>
              <p className="text-[10px] text-muted-foreground">Only rooms visible inside this property are returned by HotelCare permissions.</p>
            </div>
            <Input type="date" min={localDate()} value={propertyDate} onChange={(event) => setPropertyDate(event.target.value)} className="h-8 w-[155px] text-xs" />
          </div>
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
            {Array.from({ length: 14 }, (_, index) => localDate(index)).map((date) => (
              <button
                key={date}
                type="button"
                onClick={() => setPropertyDate(date)}
                className={`min-w-[66px] rounded-lg border px-2 py-1.5 text-center text-[10px] font-semibold ${propertyDate === date ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-sky-50'}`}
              >
                <span className="block">{new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</span>
                <span className="block">{shortDate(date)}</span>
              </button>
            ))}
          </div>
          <div className="mt-3 space-y-2">
            {propertyLoading ? (
              <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading property calendar…</div>
            ) : propertyDayNotes.length === 0 ? (
              <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">No planned room instructions for {prettyDate(propertyDate)}.</p>
            ) : propertyDayNotes.map((note) => (
              <div key={`property-${note.id}`} className={`rounded-lg border p-2.5 ${note.room_id === roomId ? 'border-sky-300 bg-sky-50/60' : 'bg-slate-50/70'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="bg-white text-[9px]">Room {propertyRoomNumbers[note.room_id] || '—'}</Badge>
                  <Badge variant="outline" className="bg-white text-[9px]">{TYPES.find(([value]) => value === note.instruction_type)?.[1] || 'General'}</Badge>
                  {note.room_id === roomId && <span className="text-[9px] font-semibold text-sky-700">Current room</span>}
                </div>
                <p className="mt-1.5 text-xs font-medium text-slate-900">{note.content}</p>
                <p className="mt-1 text-[9px] text-muted-foreground">Last saved by {names[note.updated_by] || names[note.created_by] || 'HotelCare user'} · {new Date(note.updated_at).toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {composerOpen && (
        <div className="mt-3 space-y-3 rounded-xl border border-sky-200 bg-white p-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <Select value={type} onValueChange={setType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TYPES.map(([value,label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
            <Input type="date" value={startDate} min={localDate()} onChange={(e) => { setStartDate(e.target.value); if (endDate < e.target.value) setEndDate(e.target.value); setSelectedDates([]); }} />
            <Input type="date" value={endDate} min={startDate} onChange={(e) => { setEndDate(e.target.value); setSelectedDates([]); }} />
          </div>
          <div>
            <p className="mb-1.5 text-[10px] font-semibold text-muted-foreground">Or select individual days</p>
            <div className="flex flex-wrap gap-1.5">{Array.from({length:14},(_,i)=>localDate(i+1)).map((d)=><button type="button" key={d} onClick={()=>toggleQuickDate(d)} className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${selectedDates.includes(d)?'border-sky-600 bg-sky-600 text-white':'border-slate-200 bg-white hover:bg-sky-50'}`}>{shortDate(d)}</button>)}</div>
          </div>
          <Textarea value={content} onChange={(e)=>setContent(e.target.value)} placeholder="Example: Take baby bed out; prepare extra towels; VIP setup…" className="min-h-[72px]" />
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[10px] text-muted-foreground">Creator, edits and timestamps are retained in HotelCare history.</p><Button size="sm" disabled={saving || !content.trim()} onClick={()=>void createNote()}>{saving?<Loader2 className="mr-1 h-3.5 w-3.5 animate-spin"/>:<CheckCircle2 className="mr-1 h-3.5 w-3.5"/>}Save plan</Button></div>
        </div>
      )}

      <div className="mt-3 space-y-2">
        {loading ? <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>Loading room calendar…</div>
        : upcoming.length === 0 ? <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">No upcoming room instructions.</p>
        : upcoming.map((note) => {
          const createdName = names[note.created_by] || (note.created_by === profile?.id ? 'You' : 'HotelCare user');
          const updatedName = names[note.updated_by] || (note.updated_by === profile?.id ? 'You' : createdName);
          return (
            <div key={note.id} className="rounded-xl border bg-white p-2.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                    <Badge variant="outline" className="text-[9px]">{TYPES.find(([v])=>v===note.instruction_type)?.[1] || 'General'}</Badge>
                    <span className="font-semibold text-slate-700">{note.selected_dates?.length ? note.selected_dates.map(prettyDate).join(', ') : note.start_date === note.end_date ? prettyDate(note.start_date) : `${prettyDate(note.start_date)} – ${prettyDate(note.end_date)}`}</span>
                  </div>
                  {canEdit ? <Textarea value={note.content} onChange={(e)=>autosave(note.id,e.target.value)} className="mt-2 min-h-[56px] resize-y text-xs" /> : <p className="mt-2 text-xs font-medium">{note.content}</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-muted-foreground">
                    <span className="flex items-center gap-1"><UserRound className="h-3 w-3"/>Created by {createdName} · {new Date(note.created_at).toLocaleString()}</span>
                    <span className="flex items-center gap-1"><Clock3 className="h-3 w-3"/>Last saved by {updatedName} · {new Date(note.updated_at).toLocaleString()}</span>
                    {saveState[note.id] === 'saving' && <span>Saving…</span>}
                    {saveState[note.id] === 'saved' && <span className="text-emerald-700">✓ Saved automatically</span>}
                    {saveState[note.id] === 'error' && <span className="text-rose-700">Autosave failed — keep this window open and retry</span>}
                  </div>
                </div>
                {canEdit && <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-rose-600" onClick={()=>void cancelNote(note.id)} aria-label="Remove planned instruction"><Trash2 className="h-3.5 w-3.5"/></Button>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
