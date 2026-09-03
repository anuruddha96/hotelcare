import { createRoot } from "react-dom/client";
import "@/lib/pms-reception-translations";
import "@/lib/pms-unified-reception-translations";
import App from "./App.tsx";
import "./index.css";
import "./styles/revenue-grid-performance.css";
import "./styles/training-mobile-safe.css";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { installGlobalErrorReporting } from "@/lib/clientErrorReporter";
import CompetitorPricingGridBridge from "@/components/revenue/CompetitorPricingGridBridge";

installGlobalErrorReporting();

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
