import { lazy, Suspense, useEffect, useState } from "react";
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

// Optional presentation-only bridge. Its frequent full-grid DOM inspection is
// unnecessary on the unusually large SLNT iOS revenue grid. Do not change the
// core pricing component or behavior for RD Hotels and other organizations.
const CompetitorPricingGridBridge = lazy(() => import("@/components/revenue/CompetitorPricingGridBridge"));
const isIos = /iPad|iPhone|iPod/.test(window.navigator.userAgent);
const isSlntRevenueRoute = () => /^\/slnt\/revenue(?:\/|$)/.test(window.location.pathname);

function OptionalCompetitorBridge() {
  const [skip, setSkip] = useState(() => isIos && isSlntRevenueRoute());

  useEffect(() => {
    if (!isIos) return;
    // Router redirects from /auth to the SLNT workspace without reloading the
    // document. A one-time location check at startup misses that transition.
    // Track the URL without altering BrowserRouter or any shared tenant code.
    const checkRoute = () => setSkip(isSlntRevenueRoute());
    const id = window.setInterval(checkRoute, 400);
    window.addEventListener("popstate", checkRoute);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("popstate", checkRoute);
    };
  }, []);

  if (skip) return null;
  return (
    <Suspense fallback={null}>
      <CompetitorPricingGridBridge />
    </Suspense>
  );
}

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
      <OptionalCompetitorBridge />
    </>
  </ErrorBoundary>,
);
