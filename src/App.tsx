import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useParams } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { TranslationProvider } from "@/hooks/useTranslation";
import { TenantProvider } from "@/contexts/TenantContext";
import { TrainingGuideProvider } from "@/contexts/TrainingGuideContext";
import { RealtimeNotificationProvider } from "@/components/dashboard/RealtimeNotificationProvider";
import { TrainingOverlay, TrainingWelcomePrompt } from "@/components/training";
import { WebsiteLanguageProvider } from "@/contexts/WebsiteLanguageContext";
import WebsiteHome from "./pages/website/WebsiteHome";
import WebsiteAbout from "./pages/website/WebsiteAbout";
import WebsiteContact from "./pages/website/WebsiteContact";
import WebsiteTeam from "./pages/website/WebsiteTeam";
import WebsiteCareers from "./pages/website/WebsiteCareers";
import WebsiteNotFound from "./pages/website/WebsiteNotFound";
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
import BreakfastAuth from "./pages/BreakfastAuth";

const queryClient = new QueryClient();

// Single language provider wrapping all public website routes
const WebsiteWrapper = () => (
  <WebsiteLanguageProvider>
    <Outlet />
  </WebsiteLanguageProvider>
);

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
          <Route path="/bb/auth" element={<BreakfastAuth />} />
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
                  {/* Public marketing website — single language provider */}
                  <Route element={<WebsiteWrapper />}>
                    <Route path="/" element={<WebsiteHome />} />
                    <Route path="/about-us" element={<WebsiteAbout />} />
                    <Route path="/contact" element={<WebsiteContact />} />
                    <Route path="/team" element={<WebsiteTeam />} />
                    <Route path="/join-our-team" element={<WebsiteCareers />} />
                    <Route path="/404" element={<WebsiteNotFound />} />
                  </Route>

                  {/* Legacy admin auth redirect */}
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
