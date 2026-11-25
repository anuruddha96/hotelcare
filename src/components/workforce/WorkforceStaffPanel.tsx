import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, UserCheck, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { hotelShort, matchesStaffSearch, type AccessLevel, type WorkforceStaff } from '@/lib/workforce/model';
import type { WorkforceData, WorkforceProfileOption } from '@/hooks/useWorkforce';
import { WorkforceStaffDialog } from './WorkforceStaffDialog';

const EMPLOYMENT: Record<WorkforceStaff['employment_type'], string> = {
  full_time: 'Full time', part_time: 'Part time', hourly: 'Hourly', trainee: 'Trainee', external: 'External / on call',
};

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
  const profileName = useMemo(() => new Map(profiles.map((p) => [p.id, p.full_name ?? p.nickname ?? 'Account'])), [profiles]);

  const rows = data.staff
    .filter((s) => showInactive || s.is_active)
    .filter((s) => department === 'all' || s.department_id === department)
    .filter((s) => matchesStaffSearch([s.full_name, s.nickname, deptName.get(s.department_id ?? ''), roleName.get(s.job_role_id ?? ''), hotelShort(s.hotel_id), s.notes, EMPLOYMENT[s.employment_type], s.profile_id ? profileName.get(s.profile_id) : null], query));

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

      <WorkforceStaffDialog staff={editing} data={data} access={access} onClose={() => setEditing(null)} />
    </div>
  );
}

