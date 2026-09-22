import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

/** UI guard is deliberately fail-closed and does not mount data-fetching children.
 * It is NOT a substitute for work_schedule_can_manage and schedule-table RLS. */
export function WorkScheduleAccessGate({ children }: { children: ReactNode }) {
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const { user, profile, loading } = useAuth();
  const [permission, setPermission] = useState<{ key: string; allowed: boolean } | null>(null);
  const key = `${user?.id ?? ''}/${profile?.id ?? ''}/${profile?.organization_slug ?? ''}/${organizationSlug ?? ''}`;

  useEffect(() => {
    let active = true;
    setPermission(null);
    if (loading) return () => { active = false; };
    if (!user || !profile || organizationSlug !== 'rdhotels' ||
        profile.organization_slug !== organizationSlug) {
      setPermission({ key, allowed: false });
      return () => { active = false; };
    }
    void supabase.rpc('work_schedule_pilot_has_access' as any,
      { p_organization_slug: organizationSlug }).then(({ data, error }) => {
      if (active) setPermission({ key, allowed: !error && data === true });
    }, () => {
      if (active) setPermission({ key, allowed: false });
    });
    return () => { active = false; };
  }, [key, loading, organizationSlug]);

  if (loading) return <div className="p-8" role="status">Checking schedule access…</div>;
  if (!user || !profile) return <Navigate to={`/${organizationSlug || 'rdhotels'}/auth`} replace />;
  if (!permission || permission.key !== key) return <div className="p-8" role="status">Verifying authorized account…</div>;
  if (!permission.allowed) return <div className="p-8" role="alert">Work schedules are not enabled for this account or organization.</div>;
  return <>{children}</>;
}
