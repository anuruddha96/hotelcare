import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { effectiveAccessRole } from '@/lib/accessPolicy';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { HOTELS, type AccessLevel, type WorkforceStaff } from '@/lib/workforce/model';
import { localName } from '@/lib/workforce/names';
import { staffContactAvailable, type WorkforceData, type WorkforceProfileOption } from '@/hooks/useWorkforce';

const NONE = '__none';
const CONTRACTS: Array<WorkforceStaff['employment_type']> = ['full_time', 'part_time', 'hourly', 'trainee', 'external'];

interface Props {
  /** The employee to edit, a partial record to add one, or null when closed. */
  staff: Partial<WorkforceStaff> | null;
  data: WorkforceData;
  access: AccessLevel;
  onClose: () => void;
}

/**
 * An employee's details: name, team and job, hotel, contract, leave, phone and
 * e-mail, linked app account. Opened from the Staff tab and by clicking a name
 * in the schedule.
 */
export function WorkforceStaffDialog({ staff, data, access, onClose }: Props) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const hr = effectiveAccessRole(profile) === 'hr';
  const [editing, setEditing] = useState<Partial<WorkforceStaff> | null>(null);
  const [profiles, setProfiles] = useState<WorkforceProfileOption[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setEditing(staff ? { ...staff } : null); }, [staff]);
  useEffect(() => {
    setProfiles([]);
    if (!staff || !profile?.organization_slug) return;
    let active = true;
    void supabase.from('profiles').select('id,full_name,nickname,role,assigned_hotel,access_role,is_super_admin')
      .eq('organization_slug', profile.organization_slug).is('deleted_at', null).order('full_name')
      .then(({ data: rows, error }) => {
        if (!active || error) return;
        setProfiles((rows ?? []).filter(p => !hr || (p.id !== profile.id && !p.is_super_admin && !['admin','top_management','controlling','hr'].includes(effectiveAccessRole(p)))) as WorkforceProfileOption[]);
      });
    return () => { active = false; };
  }, [staff, profile?.id, profile?.organization_slug, hr]);

  const linked = useMemo(() => new Map(data.staff.filter((s) => s.profile_id).map((s) => [s.profile_id!, s.id])), [data.staff]);
  const rolesFor = (deptId?: string | null) => data.jobRoles.filter((r) => r.is_active && (!deptId || r.department_id === deptId));
  const contact = staffContactAvailable();

  const save = async () => {
    if (!editing?.full_name?.trim()) { toast.error(t('wf.sd.enterName')); return; }
    setSaving(true);
    try {
      await data.saveStaff({
        ...editing, full_name: editing.full_name.trim(),
        phone: editing.phone?.trim() || null, email: editing.email?.trim() || null,
      } as WorkforceStaff);
      toast.success(t('wf.s.saved'));
      onClose();
    } catch (err) {
      toast.error((err as { message?: string })?.message ?? t('wf.g.saveFail'));
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={!!staff} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(editing?.id ? 'wf.sd.edit' : 'wf.sd.add')}</DialogTitle>
          <DialogDescription>{t('wf.sd.desc')}</DialogDescription>
        </DialogHeader>
        {editing && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('wf.sd.fullName')}><Input value={editing.full_name ?? ''} onChange={(e) => setEditing({ ...editing, full_name: e.target.value })} /></Field>
            <Field label={t('wf.sd.nickname')}><Input value={editing.nickname ?? ''} onChange={(e) => setEditing({ ...editing, nickname: e.target.value || null })} /></Field>
            <Field label={t('wf.sd.phone')}><Input type="tel" inputMode="tel" maxLength={40} disabled={!contact} value={editing.phone ?? ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field>
            <Field label={t('wf.sd.email')}><Input type="email" maxLength={200} disabled={!contact} value={editing.email ?? ''} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field>
            {!contact && <p className="text-xs text-amber-700 sm:col-span-2">{t('wf.sd.contactLater')}</p>}
            <Field label={t('wf.sd.team')}>
              <Select value={editing.department_id ?? NONE} onValueChange={(v) => setEditing({ ...editing, department_id: v === NONE ? null : v, job_role_id: null })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('wf.g.noDept')}</SelectItem>
                  {data.departments.filter((d) => d.is_active).map((d) => <SelectItem key={d.id} value={d.id}>{localName(d.name, t)}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('wf.sd.job')}>
              <Select value={editing.job_role_id ?? NONE} onValueChange={(v) => setEditing({ ...editing, job_role_id: v === NONE ? null : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('wf.g.noRole')}</SelectItem>
                  {rolesFor(editing.department_id).map((r) => <SelectItem key={r.id} value={r.id}>{localName(r.name, t)}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('wf.sd.base')}>
              <Select value={editing.hotel_id ?? NONE} onValueChange={(v) => setEditing({ ...editing, hotel_id: v === NONE ? null : v })} disabled={access !== 'org'}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('wf.m.company')}</SelectItem>
                  {HOTELS.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('wf.sd.contract')}>
              <Select value={editing.employment_type ?? 'full_time'} onValueChange={(v) => setEditing({ ...editing, employment_type: v as WorkforceStaff['employment_type'] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CONTRACTS.map((k) => <SelectItem key={k} value={k}>{t(`wf.sd.c.${k}`)}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label={t('wf.sd.dailyHours')}><Input type="number" min={0} max={24} step={0.5} value={editing.daily_hours ?? 8} onChange={(e) => setEditing({ ...editing, daily_hours: Number(e.target.value) })} /></Field>
            <Field label={t('wf.sd.leaveDays')}><Input type="number" min={0} max={60} step={0.5} value={editing.annual_leave_days ?? ''} onChange={(e) => setEditing({ ...editing, annual_leave_days: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
            <Field label={t('wf.sd.start')}><Input type="date" value={editing.start_date ?? ''} onChange={(e) => setEditing({ ...editing, start_date: e.target.value || null })} /></Field>
            <Field label={t('wf.sd.end')}><Input type="date" value={editing.end_date ?? ''} onChange={(e) => setEditing({ ...editing, end_date: e.target.value || null })} /></Field>
            <Field label={t('wf.sd.account')}>
              <Select value={editing.profile_id ?? NONE} onValueChange={(v) => setEditing({ ...editing, profile_id: v === NONE ? null : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={NONE}>{t('wf.sd.notLinked')}</SelectItem>
                  {profiles.filter((p) => !linked.has(p.id) || linked.get(p.id) === editing.id).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.full_name ?? p.nickname ?? p.id} {p.role ? `· ${p.role.replace(/_/g, ' ')}` : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('wf.sd.order')}><Input type="number" value={editing.sort_order ?? 0} onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) || 0 })} /></Field>
            <div className="sm:col-span-2"><Field label={t('wf.sd.notes')}><Textarea rows={2} value={editing.notes ?? ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value || null })} /></Field></div>
            {editing.leave_note && <p className="text-xs text-muted-foreground sm:col-span-2">{editing.leave_note}</p>}
            {editing.source_label && <p className="text-xs text-muted-foreground sm:col-span-2">Excel: {editing.source_label}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('wf.g.cancel')}</Button>
          <Button disabled={saving} onClick={() => void save()}>{t('wf.g.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label>{children}</div>;
}
