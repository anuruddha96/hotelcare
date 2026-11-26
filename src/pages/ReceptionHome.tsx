import { Navigate, Link, useParams } from 'react-router-dom';
import { CalendarDays, Users } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { Header } from '@/components/layout/Header';
import { OperationsNavigation } from '@/components/layout/OperationsNavigation';
import { OperationalPageHeading } from '@/components/layout/OperationalPageHeading';
import { UnifiedReceptionWorkspace } from '@/components/frontdesk/UnifiedReceptionWorkspace';
import { Button } from '@/components/ui/button';

export default function ReceptionHome() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const basePath = `/${organizationSlug || 'rdhotels'}`;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to={`${basePath}/auth`} replace />;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="w-full min-w-0 px-3 pt-4 pb-28 sm:px-4 lg:px-6">
        <OperationalPageHeading section={t('reception.home.section')} />
        <div className="mt-3 mb-4">
          <OperationsNavigation current="reception" />
        </div>
        <div className="mb-3 flex items-center gap-1.5 overflow-x-auto scrollbar-hide" aria-label={t('reception.home.tools')}>
          <Button type="button" size="sm" className="h-8 shrink-0 gap-1.5">
            🛎️ {t('pms.rep.navCalendar')}
          </Button>
          <Link to={`${basePath}/guests`}>
            <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 gap-1.5 text-muted-foreground hover:text-foreground">
              👥 {t('pms.rep.navGuests')}
            </Button>
          </Link>
          <Link to={`${basePath}/reception/reports`}>
            <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 gap-1.5 text-muted-foreground hover:text-foreground">
              📊 {t('pms.rep.title')}
            </Button>
          </Link>
        </div>
        <UnifiedReceptionWorkspace breakfastUploadPath={`${basePath}/reception/breakfast-upload`} />
      </main>
    </div>
  );
}
