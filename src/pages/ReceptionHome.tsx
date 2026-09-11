import { Navigate, Link, useParams } from 'react-router-dom';
import { CalendarDays, CarFront, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Header } from '@/components/layout/Header';
import { PMSNavigation } from '@/components/layout/PMSNavigation';
import { UnifiedReceptionWorkspace } from '@/components/frontdesk/UnifiedReceptionWorkspace';
import { Button } from '@/components/ui/button';

export default function ReceptionHome() {
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
      <PMSNavigation />
      <main className="w-full px-2 sm:px-4 py-3 sm:py-4">
        <div className="mb-3 flex items-center gap-1.5 overflow-x-auto scrollbar-hide" aria-label="Reception tools">
          <Button type="button" size="sm" className="h-8 shrink-0 gap-1.5">
            <CalendarDays className="h-4 w-4" />
            Calendar & reservations
          </Button>
          <Link to={`${basePath}/guests`}>
            <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 gap-1.5 text-muted-foreground hover:text-foreground">
              <Users className="h-4 w-4" />
              Guest directory
            </Button>
          </Link>
          <Link to={`${basePath}/parking-tickets`}>
            <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 gap-1.5 text-muted-foreground hover:text-foreground">
              <CarFront className="h-4 w-4" />
              Parking tickets
            </Button>
          </Link>
        </div>
        <UnifiedReceptionWorkspace breakfastUploadPath={`${basePath}/reception/breakfast-upload`} />
      </main>
    </div>
  );
}
