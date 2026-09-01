import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./styles/revenue-grid-performance.css";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { installGlobalErrorReporting } from "@/lib/clientErrorReporter";

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
    <App />
  </ErrorBoundary>,
);