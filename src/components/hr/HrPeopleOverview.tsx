import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useAccessPolicy } from '@/hooks/useAccessPolicy';
import { useTranslation } from '@/hooks/useTranslation';
import { useWorkforce } from '@/hooks/useWorkforce';
import { todayBudapest } from '@/lib/budapestTime';
import { Input } from '@/components/ui/input';

export function HrPeopleOverview() {
  const { profile } = useAuth();
  const { hrWorkspace } = useAccessPolicy();
  if (!hrWorkspace || !profile?.organization_slug) return null;
  return <EmployeeDirectory key={profile.organization_slug} />;
}

// Phase 1 reads the existing employee master. Editing and account lifecycle
// are intentionally deferred until the server-side authorization in phase 3.
function EmployeeDirectory() {
  const { t } = useTranslation();
  const date = todayBudapest();
  const data = useWorkforce(Number(date.slice(0,4)), Number(date.slice(5,7)));
  const [query, setQuery] = useState('');
  const staff = data.staff.filter(s => s.is_active && [s.full_name, s.nickname].some(name => name?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  return <section className="space-y-4">
    <h2 className="text-xl font-semibold">{t('hr.directory')}</h2>
    <Input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('hr.search')} aria-label={t('hr.search')} className="max-w-md" />
    {data.error ? <p role="alert">{t('hr.error')}</p> : data.loading ? <div role="status" className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-label={t('hr.directory')} /> : staff.length === 0 ? <p>{t('hr.empty')}</p> : <ul className="divide-y rounded-lg border">{staff.map(s => <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-3"><span className="font-medium">{s.full_name}</span><span className="text-sm text-muted-foreground">{t(s.profile_id ? 'hr.linked' : 'hr.unlinked')}</span></li>)}</ul>}
  </section>;
}
