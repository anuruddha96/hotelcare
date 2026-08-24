import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { TranslationProvider } from "@/hooks/useTranslation";
import { TenantProvider } from "@/contexts/TenantContext";
import { LiveSyncProvider } from "@/contexts/LiveSyncContext";
import { RealtimeNotificationProvider } from "@/components/dashboard/RealtimeNotificationProvider";
import { LocationPermissionBoot } from "@/components/dashboard/LocationPermissionBoot";
import { WelcomeBackOverlay } from "@/components/revenue/WelcomeBackOverlay";
import { PointerEventsGuard } from "@/components/system/PointerEventsGuard";
import { ServiceOutageBanner } from "@/components/system/ServiceOutageBanner";
import { SystemAnnouncementBanner } from "@/components/system/SystemAnnouncementBanner";


// Lazy load all pages to keep initial bundle small
const Index = lazy(() => import("./pages/Index"));
const Auth = lazy(() => import("./pages/Auth"));
const NotFound = lazy(() => import("./pages/NotFound"));
const GuestMinibar = lazy(() => import("./pages/GuestMinibar"));
const FrontDesk = lazy(() => import("./pages/FrontDesk"));
const Reservations = lazy(() => import("./pages/Reservations"));
const ReservationDetail = lazy(() => import("./pages/ReservationDetail"));
const Guests = lazy(() => import("./pages/Guests"));
const GuestDetail = lazy(() => import("./pages/GuestDetail"));
const ChannelManager = lazy(() => import("./pages/ChannelManager"));
const Revenue = lazy(() => import("./pages/Revenue"));
const RevenueHotelDetail = lazy(() => import("./pages/RevenueHotelDetail"));
const Breakfast = lazy(() => import("./pages/Breakfast"));
const BreakfastAuth = lazy(() => import("./pages/BreakfastAuth"));
const PurchaseInvoices = lazy(() => import("./pages/PurchaseInvoices"));
const TrainingCenterPage = lazy(() => import("./pages/TrainingCenter"));
const ReceptionHome = lazy(() => import("./pages/ReceptionHome"));
const AssistantPage = lazy(() => import("./pages/AssistantPage"));
const AssistantInsights = lazy(() => import("./pages/AssistantInsights"));
const Billing = lazy(() => import("./pages/Billing"));

// Lazy load non-critical global components
const AssistantLauncher = lazy(() => import("@/components/assistant/AssistantLauncher"));
const TrainingGuideProvider = lazy(() => import("@/contexts/TrainingGuideContext").then(m => ({ default: m.TrainingGuideProvider })));
const GuidedTourProvider = lazy(() => import("@/components/training/GuidedTour").then(m => ({ default: m.GuidedTourProvider })));
const TrainingV2Provider = lazy(() => import("@/components/training/v2/TrainingV2Provider").then(m => ({ default: m.TrainingV2Provider })));
const TrainingOverlay = lazy(() => import("@/components/training").then(m => ({ default: m.TrainingOverlay })));
const TrainingWelcomePrompt = lazy(() => import("@/components/training").then(m => ({ default: m.TrainingWelcomePrompt })));
const BrowserLocationHelpRoot = lazy(() => import("@/components/dashboard/BrowserLocationHelpDialog").then(m => ({ default: m.BrowserLocationHelpRoot })));

const queryClient = new QueryClient();

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background/50 backdrop-blur-sm">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
  </div>
);

const RootRedirect = () => {
  const { user, profile, loading, bootstrapProgress } = useAuth();
  if (loading) return <WelcomeBackOverlay context="account" step="Checking your secure session…" progress={bootstrapProgress} />;
  if (!user) return <Navigate to="/auth" replace />;
  if (!profile?.organization_slug) return <Navigate to="/auth" replace />;
  if ((profile.role === "top_management" || profile.role === "top_management_manager") && profile.assigned_hotel) {
    return <Navigate to={`/${profile.organization_slug}/revenue/${profile.assigned_hotel}`} replace />;
  }
  return <Navigate to={`/${profile.organization_slug}`} replace />;
};

const TenantRouter = () => {
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const { user, profile, loading, bootstrapProgress } = useAuth();
  
  if (!organizationSlug) {
    return <Navigate to="/auth" replace />;
  }

  if (loading) return <WelcomeBackOverlay context="account" step="Opening your workspace…" progress={bootstrapProgress} />;

  if (user && !profile?.organization_slug) {
    return <Navigate to="/auth" replace />;
  }

  if (
    user &&
    profile?.organization_slug !== organizationSlug &&
    !profile?.is_super_admin
  ) {
    return <Navigate to={`/${profile.organization_slug}`} replace />;
  }

  return (
    <TenantProvider organizationSlug={organizationSlug}>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/front-desk" element={<FrontDesk />} />
          <Route path="/reservations" element={<Reservations />} />
          <Route path="/reservations/:id" element={<ReservationDetail />} />
          <Route path="/guests" element={<Guests />} />
          <Route path="/guests/:guestId" element={<GuestDetail />} />
          <Route path="/channel-manager" element={<ChannelManager />} />
          <Route path="/revenue" element={<Revenue />} />
          <Route path="/revenue/:hotelId" element={<RevenueHotelDetail />} />
          <Route path="/bb" element={<Breakfast />} />
          <Route path="/bb/:hotelCode" element={<Breakfast />} />
          <Route path="/purchase-invoices" element={<PurchaseInvoices />} />
          <Route path="/training" element={<TrainingCenterPage />} />
          <Route path="/reception" element={<ReceptionHome />} />
          <Route path="/assistant" element={<AssistantPage />} />
          <Route path="/assistant/:threadId" element={<AssistantPage />} />
          <Route path="/assistant-insights" element={<AssistantInsights />} />
          <Route path="/billing" element={<Billing />} />
        </Routes>
        <AssistantLauncher />
      </Suspense>
    </TenantProvider>
  );
};

const PublicBreakfastApp = () => (
  <TranslationProvider>
    <TooltipProvider>
      <Toaster />
      <ServiceOutageBanner />
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/bb" element={<Breakfast />} />
            <Route path="/bb/auth" element={<BreakfastAuth />} />
            <Route path="/bb/org/:orgSlug" element={<Breakfast />} />
            <Route path="/bb/org/:orgSlug/:hotelCode" element={<Breakfast />} />
            <Route path="/bb/:hotelCode" element={<Breakfast />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </TranslationProvider>
);

const AuthenticatedShell = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const location = useLocation();
  
  if (!user) return <>{children}</>;

  const isRevenueRoute = /\/revenue(?:\/|$)/.test(location.pathname);

  if (isRevenueRoute) return (
    <LiveSyncProvider>
      <RealtimeNotificationProvider>{children}</RealtimeNotificationProvider>
    </LiveSyncProvider>
  );

  return (
    <LiveSyncProvider>
      <Suspense fallback={null}>
        <TrainingGuideProvider>
          <GuidedTourProvider>
            <RealtimeNotificationProvider>
              <TrainingV2Provider>
                <TrainingOverlay />
                <TrainingWelcomePrompt />
                <BrowserLocationHelpRoot />
                <LocationPermissionBoot />
                {children}
              </TrainingV2Provider>
            </RealtimeNotificationProvider>
          </GuidedTourProvider>
        </TrainingGuideProvider>
      </Suspense>
    </LiveSyncProvider>
  );
};

const MainApp = () => (
  <QueryClientProvider client={queryClient}>
    <TranslationProvider>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <PointerEventsGuard />
          <ServiceOutageBanner />
          <SystemAnnouncementBanner />
          <BrowserRouter>

            <AuthenticatedShell>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/" element={<RootRedirect />} />
                  <Route path="/auth" element={<Auth />} />
                  <Route path="/:organizationSlug/:hotelSlug/minibar/:roomToken" element={<GuestMinibar />} />
                  <Route path="/:organizationSlug/minibar/:roomToken" element={<GuestMinibar />} />
                  <Route path="/:organizationSlug/*" element={<TenantRouter />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </AuthenticatedShell>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </TranslationProvider>
  </QueryClientProvider>
);

const App = () => {
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/bb")) {
    return <PublicBreakfastApp />;
  }
  return <MainApp />;
};

export default App;
