import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  ACCESS_ROLE_DESCRIPTION, ACCESS_ROLE_LABEL, accessRolesForPermission, effectiveAccessRole, type AccessRole,
} from '@/lib/accessPolicy';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Person = {
  id: string;
  full_name: string | null;
  nickname: string | null;
  role: string;
  access_role: string | null;
  assigned_hotel: string | null;
  job: string | null;
  department: string | null;
  scheduleHotel: string | null;
};

/** Role the work-schedule job points to (same rule as the database backfill). */
export function suggestedAccessRole(job: string | null, department: string | null): AccessRole | null {
  const j = (job ?? '').toLowerCase();
  const d = (department ?? '').toLowerCase();
  if (!j) return null;
  if (j.includes('housekeeping manager')) return 'housekeeping_manager';
  if (d.includes('housekeeping') && j.includes('supervisor')) return 'housekeeping_supervisor';
  if (j.includes('front office manager') || j.includes('reception lead')) return 'manager';
  if (j.includes('receptionist')) return 'reception';
  if (d.includes('housekeeping')) return 'housekeeping';
  if (d.includes('maintenance')) return 'maintenance';
  if (j === 'hr') return 'hr';
  if (j.includes('finance') || j.includes('control')) return 'controlling';
  return null;
}

export function canManageAccessRoles(profile: { role?: string | null; is_super_admin?: boolean | null } | null | undefined): boolean {
  if (!profile) return false;
  return !!profile.is_super_admin || ['admin', 'top_management', 'top_management_manager'].includes(profile.role ?? '');
}

/**
 * Roles & access: which role each person has in HotelCare (their first screen,
 * Mira, schedule scope, review replies). The permission level behind it is
 * not changed here; only roles that fit it are offered.
 */
export default function AccessRolesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { profile } = useAuth();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'review'>('review');
  const [saving, setSaving] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const org = profile?.organization_slug ?? '';

  const load = useCallback(async () => {
    if (!org) return;
    setPeople(null);
    const [profilesRes, staffRes, jobsRes, deptsRes] = await Promise.all([
      db.from('profiles').select('*').eq('organization_slug', org).is('deleted_at', null).order('full_name'),
      db.from('workforce_staff').select('profile_id,job_role_id,department_id,hotel_id,is_active').eq('organization_slug', org).not('profile_id', 'is', null),
      db.from('workforce_job_roles').select('id,name').eq('organization_slug', org),
      db.from('workforce_departments').select('id,name').eq('organization_slug', org),
    ]);
    if (profilesRes.error) { toast.error(profilesRes.error.message); setPeople([]); return; }
    const jobs = new Map<string, string>((jobsRes.data ?? []).map((j: { id: string; name: string }) => [j.id, j.name]));
    const depts = new Map<string, string>((deptsRes.data ?? []).map((d: { id: string; name: string }) => [d.id, d.name]));
    const staff = new Map<string, { job_role_id: string | null; department_id: string | null; hotel_id: string | null }>();
    for (const s of staffRes.data ?? []) if (s.is_active && s.profile_id) staff.set(s.profile_id, s);
    const rows = (profilesRes.data ?? []) as Array<Record<string, unknown>>;
    setMissing(rows.length > 0 && !('access_role' in rows[0]));
    setPeople(rows.map((p) => {
      const link = staff.get(String(p.id));
      return {
        id: String(p.id),
        full_name: (p.full_name as string) ?? null,
        nickname: (p.nickname as string) ?? null,
        role: String(p.role ?? ''),
        access_role: (p.access_role as string) ?? null,
        assigned_hotel: (p.assigned_hotel as string) ?? null,
        job: link?.job_role_id ? jobs.get(link.job_role_id) ?? null : null,
        department: link?.department_id ? depts.get(link.department_id) ?? null : null,
        scheduleHotel: link?.hotel_id ?? null,
      };
    }));
  }, [org]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (people ?? []).filter((p) => {
      if (q && ![p.full_name, p.nickname, p.job, p.department, p.assigned_hotel].some((v) => (v ?? '').toLowerCase().includes(q))) return false;
      if (filter === 'review') {
        const current = effectiveAccessRole(p);
        const suggested = suggestedAccessRole(p.job, p.department);
        // Shared manager level with no explicit role, or the schedule suggests something else.
        return (p.role === 'manager' && !p.access_role) || (!!suggested && suggested !== current && accessRolesForPermission(p.role).includes(suggested));
      }
      return true;
    });
  }, [people, query, filter]);

  const setRole = async (person: Person, value: string) => {
    const next = value === '__derived' ? null : value;
    setSaving(person.id);
    const { data, error } = await db.rpc('set_staff_access_role', { _user_id: person.id, _access_role: next });
    setSaving(null);
    if (error) { toast.error(error.message || 'The role could not be saved'); return; }
    setPeople((list) => (list ?? []).map((p) => (p.id === person.id ? { ...p, access_role: next } : p)));
    toast.success(`${person.nickname || person.full_name}: ${ACCESS_ROLE_LABEL[(data as AccessRole) ?? 'other'] ?? data}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> Roles & access</DialogTitle>
          <DialogDescription>
            A person's role decides their first screen, Mira, which work schedule they see and whether they answer reviews.
            The permission level behind it stays as it is; only roles that fit it are offered.
          </DialogDescription>
        </DialogHeader>

        {missing && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">The database update for roles is not installed yet, so roles cannot be saved.</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search name, job or hotel" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v as 'all' | 'review')} size="sm">
            <ToggleGroupItem value="review">To check</ToggleGroupItem>
            <ToggleGroupItem value="all">Everyone</ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="max-h-[50dvh] overflow-y-auto rounded-lg border">
          {people === null ? (
            <div className="grid place-items-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">{filter === 'review' ? 'Everyone has a role that matches the work schedule.' : 'Nobody matches the search.'}</p>
          ) : (
            <ul className="divide-y">
              {rows.map((person) => {
                const current = effectiveAccessRole(person);
                const options = accessRolesForPermission(person.role);
                const suggested = suggestedAccessRole(person.job, person.department);
                const self = person.id === profile?.id;
                return (
                  <li key={person.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <div className="min-w-[180px] flex-1">
                      <p className="text-sm font-medium">{person.full_name || person.nickname}</p>
                      <p className="text-xs text-muted-foreground">
                        {person.job ? `${person.job}${person.department ? ` · ${person.department}` : ''}` : 'Not in the work schedule'}
                        {(person.scheduleHotel || person.assigned_hotel) && ` · ${person.scheduleHotel || person.assigned_hotel}`}
                      </p>
                    </div>
                    {suggested && suggested !== current && options.includes(suggested) && (
                      <button type="button" disabled={self || saving === person.id || missing} onClick={() => void setRole(person, suggested)}
                        className="inline-flex items-center gap-1 rounded-full border border-primary/40 px-2 py-0.5 text-xs text-primary hover:bg-primary/5 disabled:opacity-50">
                        <Sparkles className="h-3 w-3" /> Schedule says {ACCESS_ROLE_LABEL[suggested]}
                      </button>
                    )}
                    <Select value={person.access_role && options.includes(person.access_role as AccessRole) ? person.access_role : '__derived'}
                      disabled={self || saving === person.id || missing || options.length === 0}
                      onValueChange={(v) => void setRole(person, v)}>
                      <SelectTrigger className="w-[220px]" aria-label={`Role of ${person.full_name || person.nickname}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__derived">{ACCESS_ROLE_LABEL[current]} (from permission level)</SelectItem>
                        {options.map((option) => (
                          <SelectItem key={option} value={option} title={ACCESS_ROLE_DESCRIPTION[option]}>
                            {ACCESS_ROLE_LABEL[option]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {saving === person.id ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : self ? <Badge variant="outline">You</Badge> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">What each role can do</summary>
          <dl className="mt-2 grid gap-1 sm:grid-cols-2">
            {(['top_management', 'controlling', 'hr', 'manager', 'housekeeping_manager', 'housekeeping_supervisor', 'reception', 'housekeeping', 'maintenance'] as AccessRole[]).map((r) => (
              <div key={r}><dt className="inline font-medium text-foreground">{ACCESS_ROLE_LABEL[r]}: </dt><dd className="inline">{ACCESS_ROLE_DESCRIPTION[r]}</dd></div>
            ))}
          </dl>
        </details>
      </DialogContent>
    </Dialog>
  );
}
