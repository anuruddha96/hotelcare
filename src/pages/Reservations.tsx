import { Navigate, useParams } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { PMSNavigation } from '@/components/layout/PMSNavigation';
import { PMSFrontDeskWorkspace } from '@/components/pms/PMSFrontDeskWorkspace';
import { useAuth } from '@/hooks/useAuth';

export default function Reservations() {
  const { user, loading } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const basePath = `/${organizationSlug || 'rdhotels'}`;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to={`${basePath}/auth`} replace />;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <PMSNavigation />
      <main className="w-full px-2 sm:px-4 py-3 sm:py-4">
        <PMSFrontDeskWorkspace />
      </main>
    </div>
  );
}
