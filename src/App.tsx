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
      </Routes>
    </TenantProvider>
  );
};

const App = () => (
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

export default App;
