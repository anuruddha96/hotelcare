import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { TranslationProvider } from "@/hooks/useTranslation";
import { TenantProvider } from "@/contexts/TenantContext";
import { TrainingGuideProvider } from "@/contexts/TrainingGuideContext";
import { RealtimeNotificationProvider } from "@/components/dashboard/RealtimeNotificationProvider";
import { TrainingOverlay, TrainingWelcomePrompt } from "@/components/training";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import GuestMinibar from "./pages/GuestMinibar";
import FrontDesk from "./pages/FrontDesk";
import Reservations from "./pages/Reservations";
import ReservationDetail from "./pages/ReservationDetail";
import Guests from "./pages/Guests";
import GuestDetail from "./pages/GuestDetail";
import ChannelManager from "./pages/ChannelManager";
import Revenue from "./pages/Revenue";
import RevenueHotelDetail from "./pages/RevenueHotelDetail";
import Breakfast from "./pages/Breakfast";

const queryClient = new QueryClient();

// Tenant Router Component - handles organization-specific routing
const TenantRouter = () => {
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  
  if (!organizationSlug) {
    return <Navigate to="/rdhotels" replace />;
  }

  return (
    <TenantProvider organizationSlug={organizationSlug}>
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
      </Routes>
    </TenantProvider>
  );
};

// Public /bb page must NOT mount Auth/Notification providers,
// so a logged-in manager doesn't get unrelated alerts on the public screen.
const PublicBreakfastApp = () => (
  <TranslationProvider>
    <TooltipProvider>
      <Toaster />
      <BrowserRouter>
        <Routes>
          <Route path="/bb" element={<Breakfast />} />
          <Route path="/bb/:hotelCode" element={<Breakfast />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </TranslationProvider>
);

const MainApp = () => (
  <QueryClientProvider client={queryClient}>
    <TranslationProvider>
      <AuthProvider>
        <TrainingGuideProvider>
          <RealtimeNotificationProvider>
            <TooltipProvider>
              <Toaster />
              <TrainingOverlay />
              <TrainingWelcomePrompt />
              <BrowserRouter>
                <Routes>
                  {/* Legacy routes - redirect to rdhotels organization */}
                  <Route path="/" element={<Navigate to="/rdhotels" replace />} />
                  <Route path="/auth" element={<Navigate to="/rdhotels/auth" replace />} />

                  {/* Guest minibar - public, no auth needed */}
                  <Route path="/:organizationSlug/:hotelSlug/minibar/:roomToken" element={<GuestMinibar />} />
                  <Route path="/:organizationSlug/minibar/:roomToken" element={<GuestMinibar />} />

                  {/* Multi-tenant routes */}
                  <Route path="/:organizationSlug/*" element={<TenantRouter />} />

                  {/* Catch-all */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </BrowserRouter>
            </TooltipProvider>
          </RealtimeNotificationProvider>
        </TrainingGuideProvider>
      </AuthProvider>
    </TranslationProvider>
  </QueryClientProvider>
);

const App = () => {
  // Route /bb completely outside the authenticated app shell so the public
  // breakfast screen never subscribes to manager/admin realtime channels.
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/bb")) {
    return <PublicBreakfastApp />;
  }
  return <MainApp />;
};

export default App;
