import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { installGlobalErrorReporting } from '@/lib/clientErrorReporter'

installGlobalErrorReporting();

// A tab left open across a deploy keeps pointing at code chunks that no longer
// exist, so the next lazy route fails with "Importing a module script failed"
// and the app appears stuck on the loading card. Recover automatically by
// reloading once (guarded so a genuine failure can never loop).
const RELOAD_FLAG = 'chunk_reload_at';
const recoverFromStaleChunk = (message: string) => {
  if (!/dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch dynamically/i.test(message)) return;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0);
    if (Date.now() - last < 30000) return;
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch { /* storage blocked — still worth one reload */ }
  window.location.reload();
};

window.addEventListener('vite:preloadError', (e) => recoverFromStaleChunk(String((e as any)?.payload?.message ?? 'dynamically imported module')));
window.addEventListener('error', (e) => recoverFromStaleChunk(String(e?.message ?? '')));
window.addEventListener('unhandledrejection', (e) => recoverFromStaleChunk(String((e as PromiseRejectionEvent)?.reason?.message ?? '')));

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
