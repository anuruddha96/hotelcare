import { supabase } from '@/integrations/supabase/client';

/**
 * Lightweight crash reporter.
 *
 * Housekeepers occasionally hit device-specific render crashes (white screen).
 * Without any capture we have no way to see what their phone did, so every
 * caught error is written to `public.client_error_logs` with device info.
 */

let lastAction: string | null = null;
let lastContext: string | null = null;

/** Record what the user was doing, so a crash can be correlated to an action. */
export function setLastAction(action: string, context?: string) {
  lastAction = action;
  lastContext = context ?? null;
}

export function getLastAction() {
  return { lastAction, lastContext };
}

function deviceInfo() {
  const nav: any = typeof navigator !== 'undefined' ? navigator : {};
  let screenSize = '';
  try {
    screenSize = `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio || 1} (screen ${window.screen?.width}x${window.screen?.height})`;
  } catch {
    screenSize = 'unknown';
  }
  let memory = '';
  try {
    const parts: string[] = [];
    if (nav.deviceMemory) parts.push(`deviceMemory=${nav.deviceMemory}GB`);
    if (nav.hardwareConcurrency) parts.push(`cores=${nav.hardwareConcurrency}`);
    const perfMem = (performance as any)?.memory;
    if (perfMem?.usedJSHeapSize) {
      parts.push(`heap=${Math.round(perfMem.usedJSHeapSize / 1048576)}MB/${Math.round(perfMem.jsHeapSizeLimit / 1048576)}MB`);
    }
    memory = parts.join(' ');
  } catch {
    memory = '';
  }
  return {
    user_agent: typeof nav.userAgent === 'string' ? nav.userAgent.slice(0, 500) : null,
    screen_size: screenSize,
    device_memory: memory || null,
  };
}

let reportedRecently = new Set<string>();

export async function reportClientError(
  error: unknown,
  extra?: { componentStack?: string; context?: string; action?: string }
) {
  const err = error instanceof Error ? error : new Error(String(error));
  const message = (err.message || 'Unknown error').slice(0, 1000);

  // Never let the reporter itself break the app.
  try {
    console.error('[clientErrorReporter]', message, err.stack, extra);

    // Simple de-dupe so a render loop doesn't spam the table.
    const key = `${message}|${extra?.context || ''}`;
    if (reportedRecently.has(key)) return;
    reportedRecently.add(key);
    setTimeout(() => reportedRecently.delete(key), 30_000);

    let userId: string | null = null;
    try {
      const { data } = await supabase.auth.getUser();
      userId = data.user?.id ?? null;
    } catch {
      userId = null;
    }

    const route = typeof window !== 'undefined' ? window.location.pathname + window.location.search : null;
    const orgSlug = route ? (route.split('/')[1] || null) : null;

    await supabase.from('client_error_logs' as any).insert({
      user_id: userId,
      organization_slug: orgSlug,
      route,
      last_action: extra?.action ?? lastAction,
      context: extra?.context ?? lastContext,
      error_message: message,
      error_stack: err.stack ? String(err.stack).slice(0, 5000) : null,
      component_stack: extra?.componentStack ? extra.componentStack.slice(0, 5000) : null,
      ...deviceInfo(),
    });
  } catch (reportingError) {
    console.error('[clientErrorReporter] failed to report:', reportingError);
  }
}

/** Attach global handlers for errors that escape React's boundaries. */
export function installGlobalErrorReporting() {
  if (typeof window === 'undefined') return;
  if ((window as any).__hcErrorReportingInstalled) return;
  (window as any).__hcErrorReportingInstalled = true;

  window.addEventListener('error', (event) => {
    if (event?.error || event?.message) {
      void reportClientError(event.error || event.message, { context: 'window.onerror' });
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    void reportClientError(event.reason, { context: 'unhandledrejection' });
  });
}
