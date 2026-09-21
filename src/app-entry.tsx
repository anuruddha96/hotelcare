import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "@/lib/pms-reception-translations";
import "@/lib/pms-unified-reception-translations";
import App from "./App.tsx";
import "./index.css";
import "./styles/revenue-grid-performance.css";
import "./styles/revenue-grid-row-separation.css";
import "./styles/rate-calendar-input.css";
import "./styles/rate-calendar-month-layout.css";
import "./styles/training-mobile-safe.css";
import "./styles/housekeeping-dnd-mobile.css";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { installGlobalErrorReporting } from "@/lib/clientErrorReporter";
import { installRateCalendarInputPolicy } from "@/lib/rateCalendarInputPolicy";
import { installRateCalendarMonthNav } from "@/lib/rateCalendarMonthNav";

// This optional presentation bridge polls and decorates every pricing-grid
// column every 850 ms. On the unusually large SLNT rate grid, running it while
// mobile Safari is bootstrapping can exhaust its tab process. The underlying
// demand data, room rates and pricing tools remain fully available without it.
// Load the bridge after the app, and omit it ONLY on SLNT's iOS revenue route.
// RD Hotels and all other tenants retain their existing behavior.
const CompetitorPricingGridBridge = lazy(() => import("@/components/revenue/CompetitorPricingGridBridge"));
const isSlntIosRevenue = /^\/slnt\/revenue(?:\/|$)/.test(window.location.pathname)
  && /iPad|iPhone|iPod/.test(window.navigator.userAgent);

installGlobalErrorReporting();
// Install before the grid mounts, so a hover cannot start its legacy edge
// animation. Both enhancers are restricted to the Rate & Pickup card.
installRateCalendarInputPolicy();
installRateCalendarMonthNav();

const root = document.getElementById("root");

if (!root) {
  throw new Error("Application root element was not found");
}

createRoot(root).render(
  <ErrorBoundary
    variant="fullscreen"
    context="app-root"
    fallbackTitle="The app hit an unexpected problem"
    fallbackMessage="Your work is saved. Tap Reload to continue."
  >
    <>
      <App />
      {!isSlntIosRevenue && (
        <Suspense fallback={null}>
          <CompetitorPricingGridBridge />
        </Suspense>
      )}
    </>
  </ErrorBoundary>,
);
