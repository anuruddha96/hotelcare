import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, UserCheck, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { HOTELS, hotelShort, matchesStaffSearch, type AccessLevel, type WorkforceStaff } from '@/lib/workforce/model';
import type { WorkforceData, WorkforceProfileOption } from '@/hooks/useWorkforce';

const EMPLOYMENT: Record<WorkforceStaff['employment_type'], string> = {
  full_time: 'Full time', part_time: 'Part time', hourly: 'Hourly', trainee: 'Trainee', external: 'External / on call',
};
const NONE = '__none';

interface Props {
  data: WorkforceData;
  access: AccessLevel;
  currentHotel: string | null;
  today: string;
}

export function WorkforceStaffPanel({ data, access, currentHotel, today }: Props) {
  const [query, setQuery] = useState('');
  const [department, setDepartment] = useState('all');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Partial<WorkforceStaff> | null>(null);
  const [profiles, setProfiles] = useState<WorkforceProfileOption[]>([]);

  useEffect(() => {
    void supabase.from('profiles').select('id,full_name,nickname,role,assigned_hotel').order('full_name')
      .then(({ data: rows }) => setProfiles((rows ?? []) as WorkforceProfileOption[]));
  }, []);

  const deptName = useMemo(() => new Map(data.departments.map((d) => [d.id, d.name])), [data.departments]);
  const roleName = useMemo(() => new Map(data.jobRoles.map((r) => [r.id, r.name])), [data.jobRoles]);
  const linked = useMemo(() => new Map(data.staff.filter((s) => s.profile_id).map((s) => [s.profile_id!, s.id])), [data.staff]);
  const profileName = useMemo(() => new Map(profiles.map((p) => [p.id, p.full_name ?? p.nickname ?? 'Account'])), [profiles]);

  const rows = data.staff
    .filter((s) => showInactive || s.is_active)
    .filter((s) => department === 'all' || s.department_id === department)
    .filter((s) => matchesStaffSearch([s.full_name, s.nickname, deptName.get(s.department_id ?? ''), roleName.get(s.job_role_id ?? ''), hotelShort(s.hotel_id), s.notes, EMPLOYMENT[s.employment_type], s.profile_id ? profileName.get(s.profile_id) : null], query));

  const save = async () => {
    if (!editing?.full_name?.trim()) { toast.error('Enter a name'); return; }
    try {
      await data.saveStaff({ ...editing, full_name: editing.full_name.trim() } as WorkforceStaff);
      toast.success(editing.id ? 'Employee updated' : 'Employee added');
      setEditing(null);
    } catch (err) {
      toast.error((err as { message?: string })?.message ?? 'Could not save');
    }
  };

  const toggleActive = async (s: WorkforceStaff) => {
    try {
      await data.saveStaff({ id: s.id, full_name: s.full_name, is_active: !s.is_active, end_date: s.is_active ? today : null });
      toast.success(s.is_active ? `${s.full_name} moved to former staff. History is kept.` : `${s.full_name} is active again`);
    } catch (err) { toast.error((err as { message?: string })?.message ?? 'Could not update'); }
  };

  const newStaff = (): Partial<WorkforceStaff> => ({
    full_name: '', employment_type: 'full_time', daily_hours: 8, is_active: true,
    hotel_id: access === 'property' ? currentHotel : null, sort_order: 0, start_date: today,
  });
  const rolesFor = (deptId?: string | null) => data.jobRoles.filter((r) => r.is_active && (!deptId || r.department_id === deptId));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search name, role, department, hotel, notes…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Select value={department} onValueChange={setDepartment}>
          <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {data.departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm"><Switch checked={showInactive} onCheckedChange={setShowInactive} />Former staff</label>
        <Button onClick={() => setEditing(newStaff())}><Plus className="mr-1 h-4 w-4" />Add employee</Button>
      </div>
      <p className="text-xs text-muted-foreground">{rows.length} shown · {data.staff.filter((s) => s.is_active).length} active · {data.staff.filter((s) => s.profile_id).length} linked to an app account</p>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead><TableHead>Department / role</TableHead><TableHead>Base</TableHead>
              <TableHead>Contract</TableHead><TableHead className="text-right">Leave / yr</TableHead><TableHead>App account</TableHead><TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => (
              <TableRow key={s.id} className={s.is_active ? '' : 'opacity-60'}>
                <TableCell className="cursor-pointer" onClick={() => setEditing({ ...s })}>
                  <div className="font-medium">{s.full_name}</div>
                  {s.nickname && <div className="text-xs text-muted-foreground">“{s.nickname}”</div>}
                </TableCell>
                <TableCell>
                  <div>{deptName.get(s.department_id ?? '') ?? '—'}</div>
                  <div className="text-xs text-muted-foreground">{roleName.get(s.job_role_id ?? '') ?? 'No role'}</div>
                </TableCell>
                <TableCell>{hotelShort(s.hotel_id)}</TableCell>
                <TableCell>{EMPLOYMENT[s.employment_type]} · {s.daily_hours} h/day</TableCell>
                <TableCell className="text-right tabular-nums">{s.annual_leave_days ?? '—'}</TableCell>
                <TableCell>{s.profile_id ? <Badge variant="secondary">{profileName.get(s.profile_id) ?? 'Linked'}</Badge> : <span className="text-xs text-muted-foreground">Not linked</span>}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => void toggleActive(s)} title={s.is_active ? 'Move to former staff' : 'Reactivate'}>
                    {s.is_active ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No employees match.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Edit employee' : 'Add employee'}</DialogTitle>
            <DialogDescription>Employees do not need an app login. Link an account so they see their own schedule in the app.</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Full name"><Input value={editing.full_name ?? ''} onChange={(e) => setEditing({ ...editing, full_name: e.target.value })} /></Field>
              <Field label="Nickname (shown in the grid)"><Input value={editing.nickname ?? ''} onChange={(e) => setEditing({ ...editing, nickname: e.target.value || null })} /></Field>
              <Field label="Department">
                <Select value={editing.department_id ?? NONE} onValueChange={(v) => setEditing({ ...editing, department_id: v === NONE ? null : v, job_role_id: null })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No department</SelectItem>
                    {data.departments.filter((d) => d.is_active).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Job role">
                <Select value={editing.job_role_id ?? NONE} onValueChange={(v) => setEditing({ ...editing, job_role_id: v === NONE ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No role</SelectItem>
                    {rolesFor(editing.department_id).map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Base hotel">
                <Select value={editing.hotel_id ?? NONE} onValueChange={(v) => setEditing({ ...editing, hotel_id: v === NONE ? null : v })} disabled={access === 'property'}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Company / outlets</SelectItem>
                    {HOTELS.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Contract">
                <Select value={editing.employment_type ?? 'full_time'} onValueChange={(v) => setEditing({ ...editing, employment_type: v as WorkforceStaff['employment_type'] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(EMPLOYMENT).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Daily hours (for days without times)"><Input type="number" min={0} max={24} step={0.5} value={editing.daily_hours ?? 8} onChange={(e) => setEditing({ ...editing, daily_hours: Number(e.target.value) })} /></Field>
              <Field label="Annual leave days"><Input type="number" min={0} max={60} step={0.5} value={editing.annual_leave_days ?? ''} onChange={(e) => setEditing({ ...editing, annual_leave_days: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
              <Field label="Start date"><Input type="date" value={editing.start_date ?? ''} onChange={(e) => setEditing({ ...editing, start_date: e.target.value || null })} /></Field>
              <Field label="End date"><Input type="date" value={editing.end_date ?? ''} onChange={(e) => setEditing({ ...editing, end_date: e.target.value || null })} /></Field>
              <Field label="App account">
                <Select value={editing.profile_id ?? NONE} onValueChange={(v) => setEditing({ ...editing, profile_id: v === NONE ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={NONE}>Not linked</SelectItem>
                    {profiles.filter((p) => !linked.has(p.id) || linked.get(p.id) === editing.id).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.full_name ?? p.nickname ?? p.id} {p.role ? `· ${p.role.replace(/_/g, ' ')}` : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Order in the grid"><Input type="number" value={editing.sort_order ?? 0} onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) || 0 })} /></Field>
              <div className="sm:col-span-2"><Field label="Notes (HR)"><Textarea rows={2} value={editing.notes ?? ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value || null })} /></Field></div>
              {editing.leave_note && <p className="text-xs text-muted-foreground sm:col-span-2">{editing.leave_note}</p>}
              {editing.source_label && <p className="text-xs text-muted-foreground sm:col-span-2">Excel columns: {editing.source_label}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => void save()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label>{children}</div>;
}
