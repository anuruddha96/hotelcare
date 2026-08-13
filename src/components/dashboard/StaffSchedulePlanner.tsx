import { useEffect, useMemo, useState } from 'react';
import { addDays, format, startOfDay } from 'date-fns';
import { Check, Clock, Copy, MapPin, Send } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useVenues } from '@/hooks/useVenues';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

type Staff = { id: string; full_name: string; nickname?: string | null };
type Shift = {
  id: string; user_id: string; work_date: string; shift_start: string; shift_end: string;
  status: 'draft' | 'published' | 'off'; notes: string | null;
  staff_schedule_venues?: { venue_id: string }[];
};

export function StaffSchedulePlanner() {
  const { profile } = useAuth();
  const { visibleVenues } = useVenues();
  const [days, setDays] = useState<14 | 30>(14);
  const [start, setStart] = useState(() => format(startOfDay(new Date()), 'yyyy-MM-dd'));
  const [staff, setStaff] = useState<Staff[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [editing, setEditing] = useState<{ user: Staff; date: string } | null>(null);
  const [shiftStart, setShiftStart] = useState('09:00');
  const [shiftEnd, setShiftEnd] = useState('17:00');
  const [status, setStatus] = useState<'draft' | 'published' | 'off'>('draft');
  const [notes, setNotes] = useState('');
  const [venueIds, setVenueIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const dates = useMemo(() => Array.from({ length: days }, (_, i) => format(addDays(new Date(`${start}T12:00:00`), i), 'yyyy-MM-dd')), [days, start]);
  const end = dates[dates.length - 1] ?? start;
  const shiftMap = useMemo(() => new Map(shifts.map((s) => [`${s.user_id}|${s.work_date}`, s])), [shifts]);

  const load = async () => {
    if (!profile?.assigned_hotel || !profile.organization_slug) return;
    const [{ data: staffRows }, { data: shiftRows }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, nickname')
        .eq('organization_slug', profile.organization_slug)
        .eq('assigned_hotel', profile.assigned_hotel)
        .or('role.eq.housekeeping,acts_as_housekeeper.eq.true').order('full_name'),
      (supabase as any).from('staff_schedules')
        .select('id,user_id,work_date,shift_start,shift_end,status,notes,staff_schedule_venues(venue_id)')
        .eq('hotel_id', profile.assigned_hotel).gte('work_date', start).lte('work_date', end),
    ]);
    setStaff((staffRows ?? []) as Staff[]);
    setShifts((shiftRows ?? []) as Shift[]);
  };

  useEffect(() => { void load(); }, [profile?.assigned_hotel, profile?.organization_slug, start, end]);

  const openEditor = (user: Staff, date: string) => {
    const existing = shiftMap.get(`${user.id}|${date}`);
    setEditing({ user, date });
    setShiftStart(existing?.shift_start?.slice(0, 5) ?? '09:00');
    setShiftEnd(existing?.shift_end?.slice(0, 5) ?? '17:00');
    setStatus(existing?.status ?? 'draft');
    setNotes(existing?.notes ?? '');
    setVenueIds(existing?.staff_schedule_venues?.map((v) => v.venue_id) ?? []);
  };

  const save = async () => {
    if (!editing || !profile?.id || !profile.assigned_hotel || !profile.organization_slug) return;
    setSaving(true);
    const payload = {
      organization_slug: profile.organization_slug, hotel_id: profile.assigned_hotel,
      user_id: editing.user.id, work_date: editing.date, shift_start: shiftStart,
      shift_end: shiftEnd, status, notes: notes.trim() || null, created_by: profile.id,
      published_at: status === 'published' ? new Date().toISOString() : null,
      published_by: status === 'published' ? profile.id : null,
    };
    const { data, error } = await (supabase as any).from('staff_schedules').upsert(payload, {
      onConflict: 'organization_slug,hotel_id,user_id,work_date',
    }).select('id').single();
    if (!error && data?.id) {
      await (supabase as any).from('staff_schedule_venues').delete().eq('schedule_id', data.id);
      if (status !== 'off' && venueIds.length) {
        const { error: venueError } = await (supabase as any).from('staff_schedule_venues').insert(
          venueIds.map((venueId) => ({ schedule_id: data.id, venue_id: venueId })),
        );
        if (venueError) toast.error(venueError.message);
      }
    }
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(status === 'published' ? 'Shift published' : status === 'off' ? 'Day marked off' : 'Draft saved');
    setEditing(null);
    await load();
  };

  const publishRange = async () => {
    if (!profile?.id || !profile.assigned_hotel) return;
    const { error } = await (supabase as any).from('staff_schedules').update({
      status: 'published', published_at: new Date().toISOString(), published_by: profile.id,
    }).eq('hotel_id', profile.assigned_hotel).gte('work_date', start).lte('work_date', end).eq('status', 'draft');
    if (error) toast.error(error.message); else { toast.success('Schedule published to staff'); await load(); }
  };

  const copyFirstWeek = async () => {
    if (!profile?.id || !profile.assigned_hotel || !profile.organization_slug) return;
    const sourceDates = dates.slice(0, 7);
    const copies = shifts.filter((s) => sourceDates.includes(s.work_date)).flatMap((s) => {
      const offset = sourceDates.indexOf(s.work_date);
      return dates.slice(7).filter((_, i) => i % 7 === offset).map((target) => ({
        organization_slug: profile.organization_slug, hotel_id: profile.assigned_hotel,
        user_id: s.user_id, work_date: target, shift_start: s.shift_start, shift_end: s.shift_end,
        status: 'draft', notes: s.notes, created_by: profile.id,
      }));
    });
    if (!copies.length) { toast.info('Add shifts to the first week before copying it'); return; }
    const { error } = await (supabase as any).from('staff_schedules').upsert(copies, { onConflict: 'organization_slug,hotel_id,user_id,work_date' });
    if (error) toast.error(error.message); else { toast.success('First week copied as drafts'); await load(); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Staff schedule</h2>
          <p className="text-sm text-muted-foreground">Plan shift times and venue coverage, then publish to staff.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={String(days)} onValueChange={(v) => setDays(v === '30' ? 30 : 14)}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="14">Next 2 weeks</SelectItem><SelectItem value="30">Next month</SelectItem></SelectContent>
          </Select>
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="w-40" />
          <Button variant="outline" onClick={copyFirstWeek}><Copy className="h-4 w-4 mr-1" />Copy week</Button>
          <Button onClick={publishRange}><Send className="h-4 w-4 mr-1" />Publish drafts</Button>
        </div>
      </div>
      <Card>
        <CardContent className="p-0 overflow-auto max-h-[68vh]">
          <table className="w-full min-w-[900px] border-collapse text-xs">
            <thead className="sticky top-0 z-20 bg-background"><tr>
              <th className="sticky left-0 z-30 bg-background border-b border-r p-3 text-left min-w-44">Team member</th>
              {dates.map((date) => <th key={date} className="border-b p-2 min-w-24 text-center"><div>{format(new Date(`${date}T12:00:00`), 'EEE')}</div><div className="text-muted-foreground">{format(new Date(`${date}T12:00:00`), 'MMM d')}</div></th>)}
            </tr></thead>
            <tbody>{staff.map((person) => <tr key={person.id}>
              <th className="sticky left-0 z-10 bg-background border-r border-b p-3 text-left"><div className="font-medium">{person.full_name}</div><div className="text-muted-foreground font-normal">{person.nickname}</div></th>
              {dates.map((date) => {
                const shift = shiftMap.get(`${person.id}|${date}`);
                return <td key={date} className="border-b p-1 align-top">
                  <button type="button" onClick={() => openEditor(person, date)} className="w-full min-h-14 rounded-md border p-1.5 text-left hover:bg-muted/60 transition-colors">
                    {!shift ? <span className="text-muted-foreground">＋ Add</span> : shift.status === 'off' ? <Badge variant="secondary">Off</Badge> : <>
                      <div className="font-medium flex items-center gap-1"><Clock className="h-3 w-3" />{shift.shift_start.slice(0,5)}–{shift.shift_end.slice(0,5)}</div>
                      <div className="mt-1"><Badge variant={shift.status === 'published' ? 'default' : 'outline'} className="text-[9px]">{shift.status}</Badge></div>
                    </>}
                  </button>
                </td>;
              })}
            </tr>)}</tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editing?.user.full_name} · {editing?.date}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Start</Label><Input type="time" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} disabled={status === 'off'} /></div>
            <div><Label>End</Label><Input type="time" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)} disabled={status === 'off'} /></div>
          </div>
          <div><Label>Status</Label><Select value={status} onValueChange={(v) => setStatus(v as typeof status)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="draft">Draft</SelectItem><SelectItem value="published">Published</SelectItem><SelectItem value="off">Off</SelectItem></SelectContent></Select></div>
          {status !== 'off' && <div className="space-y-2"><Label className="flex items-center gap-1"><MapPin className="h-4 w-4" />Venues</Label><div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto rounded-md border p-2">{visibleVenues.map((venue) => <label key={venue.id} className="flex items-center gap-2 text-sm"><Checkbox checked={venueIds.includes(venue.id)} onCheckedChange={(checked) => setVenueIds((old) => checked ? [...old, venue.id] : old.filter((id) => id !== venue.id))} />{venue.name}</label>)}</div></div>}
          <div><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional shift note" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : <><Check className="h-4 w-4 mr-1" />Save shift</>}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}