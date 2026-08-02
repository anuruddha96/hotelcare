import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { installGlobalErrorReporting } from '@/lib/clientErrorReporter'

installGlobalErrorReporting();

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary
    variant="fullscreen"
    context="app-root"
    fallbackTitle="The app hit an unexpected problem"
    fallbackMessage="Your work is saved. Tap Reload to continue."
  >
    <App />
  </ErrorBoundary>
);
