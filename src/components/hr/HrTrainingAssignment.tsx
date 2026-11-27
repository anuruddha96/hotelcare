import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useAccessPolicy } from '@/hooks/useAccessPolicy';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { txt, useTrainingV2 } from '@/components/training/v2/TrainingV2Provider';
import { curriculaForOrganization } from '@/components/training/v2/curricula';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { effectiveAccessRole } from '@/lib/accessPolicy';

type Employee = { id: string; full_name: string | null; role: string; access_role?: string | null; is_super_admin?: boolean | null };
export function HrTrainingAssignment() {
  const { profile } = useAuth();
  const { hrWorkspace } = useAccessPolicy();
  const { t } = useTranslation();
  const { lang } = useTrainingV2();
  const [loaded, setEmployees] = useState<{owner:string;employees:Employee[]}|null>(null);
  const owner=profile?.id+'|'+profile?.organization_slug;
  const employees=loaded?.owner===owner?loaded.employees:[];
  const catalogue=curriculaForOrganization(profile?.organization_slug);
  const [employee, setEmployee] = useState('');
  const [guide, setGuide] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setEmployees(null); setEmployee(''); setGuide(''); setFailed(false);
    if (!hrWorkspace || !profile?.organization_slug) return;
    let active = true;
    void supabase.from('profiles').select('id,full_name,role,access_role,is_super_admin').eq('organization_slug', profile.organization_slug).is('deleted_at', null).order('full_name').then(({data,error}) => {
      if (!active) return;
      if (error) { setFailed(true); return; }
      setEmployees({owner,employees:((data || []) as Employee[]).filter(p => p.id !== profile.id && !p.is_super_admin && !['admin','top_management','top_management_manager','hr','control_finance'].includes(p.role) && !['admin','top_management','controlling','hr'].includes(effectiveAccessRole(p)))});
    });
    return () => { active = false; };
  }, [hrWorkspace, profile?.id, profile?.organization_slug, owner]);
  if (!hrWorkspace) return null;
  const assign = async () => {
    if (!employees.some(e=>e.id===employee) || !catalogue.some(c=>c.slug===guide) || !window.confirm(t('hr.training.confirm'))) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('training-admin-action', { body: { action: 'reset', userIds: [employee], curriculumSlugs: [guide] } });
      if (error || !data?.ok) throw new Error('training action failed');
      toast.success(t('hr.training.done')); setGuide('');
    } catch { toast.error(t('hr.training.error')); } finally { setBusy(false); }
  };
  return <section className="mx-auto max-w-2xl space-y-4 px-4 pb-8 sm:px-6">
    <h2 className="text-xl font-semibold">{t('hr.training.assign')}</h2>
    {failed && <p role="alert">{t('hr.error')}</p>}
    <label className="block space-y-1"><span>{t('hr.training.employee')}</span><select className="block w-full min-h-12 rounded-md border bg-background px-3" value={employee} onChange={e => setEmployee(e.target.value)}><option value="">{t('hr.training.employee')}</option>{employees.map(e => <option key={e.id} value={e.id}>{e.full_name || e.id}</option>)}</select></label>
    <label className="block space-y-1"><span>{t('hr.training.guide')}</span><select className="block w-full min-h-12 rounded-md border bg-background px-3" value={guide} onChange={e => setGuide(e.target.value)}><option value="">{t('hr.training.guide')}</option>{catalogue.map(c => <option key={c.slug} value={c.slug}>{txt(c.name, lang)}</option>)}</select></label>
    <Button disabled={busy || !employees.some(e=>e.id===employee) || !catalogue.some(c=>c.slug===guide) || failed} onClick={() => void assign()}>{t('hr.training.restart')}</Button>
  </section>;
}
