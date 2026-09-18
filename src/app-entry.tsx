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
import CompetitorPricingGridBridge from "@/components/revenue/CompetitorPricingGridBridge";

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
      <CompetitorPricingGridBridge />
    </>
  </ErrorBoundary>,
);
