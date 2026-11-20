import { Suspense, lazy, useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import ExecutiveResumeRefresh from "@/components/system/ExecutiveResumeRefresh";
import { getSessionSuspension, observeSessionSuspension } from "@/lib/clientSessionGuard";
import { canAccessChannelManager, canAccessLegacyModules } from "@/lib/roleAccess";
import { usePurchaseInvoiceAccess } from "@/hooks/usePurchaseInvoiceAccess";
import { effectiveAccessRole } from "@/lib/accessPolicy";

// Lazy load all pages to keep initial bundle small
const Index = lazy(() => import("./pages/Index"));
const Auth = lazy(() => import("./pages/Auth"));
const PasswordRecovery = lazy(() => import("./pages/PasswordRecovery"));
const OAuthConsent = lazy(() => import("./pages/OAuthConsent"));
const NotFound = lazy(() => import("./pages/NotFound"));
const GuestMinibar = lazy(() => import("./pages/GuestMinibar"));
const InSuiteGuest = lazy(() => import("./pages/InSuiteGuest"));
const InSuiteStaff = lazy(() => import("./pages/InSuiteStaff"));
const FrontDesk = lazy(() => import("./pages/FrontDesk"));
const Reservations = lazy(() => import("./pages/Reservations"));
const ReservationDetail = lazy(() => import("./pages/ReservationDetail"));
const Guests = lazy(() => import("./pages/Guests"));
const GuestDetail = lazy(() => import("./pages/GuestDetail"));
const ChannelManager = lazy(() => import("./pages/ChannelManager"));
const RatesAvailability = lazy(() => import("./pages/RatesAvailability"));
const Revenue = lazy(() => import("./pages/Revenue"));
const RevenueHotelDetail = lazy(() => import("./pages/RevenueHotelDetail"));
const Reputation = lazy(() => import("./pages/Reputation"));
const PriceList = lazy(() => import("./pages/PriceList"));
const Breakfast = lazy(() => import("./pages/Breakfast"));
const BreakfastAuth = lazy(() => import("./pages/BreakfastAuth"));
const PurchaseInvoices = lazy(() => import("./pages/PurchaseInvoices"));
const ParkingTickets = lazy(() => import("./pages/ParkingTickets"));
const TrainingCenterPage = lazy(() => import("./pages/TrainingCenter"));
const ReceptionHome = lazy(() => import("./pages/ReceptionHome"));
const ReceptionReports = lazy(() => import("./pages/ReceptionReports"));
const ReceptionBreakfastUpload = lazy(() => import("./pages/ReceptionBreakfastUpload"));
const AssistantPage = lazy(() => import("./pages/AssistantPage"));
const AssistantInsights = lazy(() => import("./pages/AssistantInsights"));
const Billing = lazy(() => import("./pages/Billing"));
const InvoicingSettings = lazy(() => import("./pages/InvoicingSettings"));
const SessionProtectionAdmin = lazy(() => import("./pages/SessionProtectionAdmin"));
const BookingEngineSettings = lazy(() => import("./pages/BookingEngineSettings"));
// Guests booking from a hotel website: a separate, provider-free app.
const PublicBookingApp = lazy(() => import("./pages/booking/PublicBookingApp"));

// Lazy load non-critical global components
const AssistantLauncher = lazy(() => import("@/components/assistant/AssistantLauncher"));
const TrainingGuideProvider = lazy(() => import("@/contexts/TrainingGuideContext").then(m => ({ default: m.TrainingGuideProvider })));
const GuidedTourProvider = lazy(() => import("@/components/training/GuidedTour").then(m => ({ default: m.GuidedTourProvider })));
const TrainingV2Provider = lazy(() => import("@/components/training/v2/TrainingV2Provider").then(m => ({ default: m.TrainingV2Provider })));
const TrainingOverlay = lazy(() => import("@/components/training").then(m => ({ default: m.TrainingOverlay })));
const TrainingWelcomePrompt = lazy(() => import("@/components/training").then(m => ({ default: m.TrainingWelcomePrompt })));
const BrowserLocationHelpRoot = lazy(() => import("@/components/dashboard/BrowserLocationHelpDialog").then(m => ({ default: m.BrowserLocationHelpRoot })));

// Changing tabs must not silently replace what a manager was reading. Live
// subscriptions, polling and explicit invalidations still update their data.
const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background/50 backdrop-blur-sm">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
  </div>
);

const MIN_WELCOME_DISPLAY_MS = 7000;

function useHeldLoading(loading: boolean, minDisplayMs = MIN_WELCOME_DISPLAY_MS): boolean {
  const [held, setHeld] = useState(loading);
  const shownAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (loading) {
      setHeld(true);
      if (shownAtRef.current === null) shownAtRef.current = Date.now();
      return;
    }

    const shownAt = shownAtRef.current;
    if (shownAt === null) {
      setHeld(false);
      return;
    }

    const elapsed = Date.now() - shownAt;
    const remaining = Math.max(0, minDisplayMs - elapsed);

    if (remaining === 0) {
      setHeld(false);
      shownAtRef.current = null;
      return;
    }

    const id = window.setTimeout(() => {
      setHeld(false);
      shownAtRef.current = null;
    }, remaining);

    return () => window.clearTimeout(id);
  }, [loading, minDisplayMs]);

  return held;
}

const RootRedirect = () => {
  const { user, profile, loading, bootstrapProgress } = useAuth();
  const heldLoading = useHeldLoading(loading);
  if (heldLoading) return <WelcomeBackOverlay context="account" step="Checking your secure session…" progress={bootstrapProgress} />;
  if (!user) return <Navigate to="/auth" replace />;
  if (!profile?.organization_slug) return <Navigate to="/auth" replace />;

  // Hotel Memories top managers are operational managers: they must land on
  // the same dashboard/Housekeeping view as normal managers. Keep the existing
  // revenue-first behaviour untouched for top managers assigned to other hotels.
  const isMemoriesTopManager = profile.role === "top_management_manager" &&
    ["memories-budapest", "Hotel Memories Budapest"].includes(profile.assigned_hotel || "");
  // Controlling and HR have top-management access but their own first screen
  // (Purchase invoices / HR), chosen on the organization page.
  const ownLanding = ["controlling", "hr"].includes(effectiveAccessRole(profile));

  if (!ownLanding && (profile.role === "top_management" || (profile.role === "top_management_manager" && !isMemoriesTopManager)) && profile.assigned_hotel) {
    return <Navigate to={`/${profile.organization_slug}/revenue/${profile.assigned_hotel}`} replace />;
  }
  return <Navigate to={`/${profile.organization_slug}`} replace />;
};

/** Purchase invoices are rolled out per organization by the database (pi_module_access), not by a nickname. */
const PurchaseInvoicesGate = ({ fallback }: { fallback: string }) => {
  const access = usePurchaseInvoiceAccess();
  if (access.loading) return <PageLoader />;
  // Finance admins may open the page while the module is disabled, to enable it (data stays gated by RLS).
  return access.hasAccess || access.isFinanceAdmin ? <PurchaseInvoices /> : <Navigate to={fallback} replace />;
};

const TenantRouter = () => {
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const { user, profile, loading, bootstrapProgress } = useAuth();

  if (!organizationSlug) return <Navigate to="/auth" replace />;

  const heldLoading = useHeldLoading(loading);
  if (heldLoading) return <WelcomeBackOverlay context="account" step="Opening your workspace…" progress={bootstrapProgress} />;

  if (user && !profile?.organization_slug) return <Navigate to="/auth" replace />;

  if (user && profile?.organization_slug !== organizationSlug && !profile?.is_super_admin) {
    return <Navigate to={`/${profile.organization_slug}`} replace />;
  }

  const canUseLegacyModules = canAccessLegacyModules(profile?.nickname);
  const legacyFallback = `/${organizationSlug}`;

  return (
    <TenantProvider organizationSlug={organizationSlug}>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/auth" element={<Auth />} />
                  <Route path="/reset-password" element={<PasswordRecovery />} />
          <Route path="/front-desk" element={<FrontDesk />} />
          <Route path="/reservations" element={<Reservations />} />
          <Route path="/reservations/:id" element={<ReservationDetail />} />
          <Route path="/guests" element={<Guests />} />
          <Route path="/guests/:guestId" element={<GuestDetail />} />
          <Route path="/guests/k/:hotelId/:profileKey" element={<GuestDetail />} />
          <Route path="/channel-manager" element={user && canAccessChannelManager(profile?.role, profile?.nickname) ? <ChannelManager /> : <Navigate to={legacyFallback} replace />} />
          <Route path="/booking-engine" element={<BookingEngineSettings />} />
          <Route path="/rates-availability" element={<RatesAvailability />} />
          <Route path="/revenue" element={<Revenue />} />
          <Route path="/revenue/:hotelId" element={<RevenueHotelDetail />} />
          <Route path="/reputation" element={<Reputation />} />
          <Route path="/price-list" element={<PriceList />} />
          <Route path="/bb" element={<Breakfast />} />
          <Route path="/bb/:hotelCode" element={<Breakfast />} />
          <Route path="/purchase-invoices" element={<PurchaseInvoicesGate fallback={legacyFallback} />} />
          <Route path="/training" element={<TrainingCenterPage />} />
          <Route path="/reception" element={<ReceptionHome />} />
          <Route path="/reception/breakfast-upload" element={<ReceptionBreakfastUpload />} />
          <Route path="/reception/reports" element={<ReceptionReports />} />
          <Route path="/assistant" element={<AssistantPage />} />
          <Route path="/assistant/:threadId" element={<AssistantPage />} />
          <Route path="/assistant-insights" element={<AssistantInsights />} />
          <Route path="/billing" element={<Billing />} />
          <Route path="/admin/invoicing" element={<InvoicingSettings />} />
          <Route path="/admin/session-protection" element={<SessionProtectionAdmin />} />
          <Route path="/insuite" element={<InSuiteStaff />} />
          <Route path="/parking-tickets" element={canUseLegacyModules ? <ParkingTickets /> : <Navigate to={legacyFallback} replace />} />
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
  const suspended = useSyncExternalStore(
    observeSessionSuspension, getSessionSuspension, () => null,
  );

  // Recovery is a standalone authentication screen, not an operational workspace.
  if (location.pathname === '/reset-password') return <>{children}</>;
  if (!user) return <>{children}</>;

  // Unmount the entire operational subtree after 30 minutes without input
  // or after a forced update. React effect cleanup closes polling timers,
  // queries and Realtime channels; a mere modal overlay cannot do this.
  // AuthProvider remains mounted to preserve the signed-in session.
  if (suspended) return null;

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
          <ExecutiveResumeRefresh />
          <ServiceOutageBanner />
          <SystemAnnouncementBanner />
          <BrowserRouter>
            <AuthenticatedShell>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/" element={<RootRedirect />} />
                  <Route path="/auth" element={<Auth />} />
                   <Route path="/reset-password" element={<PasswordRecovery />} />
                  <Route path="/oauth/consent" element={<OAuthConsent />} />
                  <Route path="/suite" element={<InSuiteGuest />} />
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
  if (typeof window !== "undefined" && /^\/book\/[^/]+/.test(window.location.pathname)) {
    return <Suspense fallback={null}><PublicBookingApp /></Suspense>;
  }
  return <MainApp />;
};

export default App;
