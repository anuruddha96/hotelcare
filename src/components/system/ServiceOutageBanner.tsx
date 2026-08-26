// A calm, honest banner for the window where our data gateway is unreachable.
//
// It polls a tiny REST call. When the gateway answers with a 5xx (or not at
// all), everyone — signed in or on the login page — sees that we know and
// that the team is on it. It disappears by itself the moment service returns.

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

const HEALTH_URL = "https://pcmszqqklkolvvlabohq.supabase.co/rest/v1/";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjbXN6cXFrbGtvbHZ2bGFib2hxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4NjgxMDEsImV4cCI6MjA2OTQ0NDEwMX0.1PrIMW4wOXdmDNW6SrlBJa68H0k20n68hHy9PYOEvVo";

async function gatewayIsDown(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    const res = await fetch(HEALTH_URL, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
      signal: controller.signal,
    });
    window.clearTimeout(timer);
    return res.status >= 500;
  } catch {
    return true;
  }
}

// Turned off: the provider outage is over, so nobody should see this notice.
// Flip to true to bring the health polling and banner back.
const ENABLED = false;

export function ServiceOutageBanner() {
  const [down, setDown] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!ENABLED) return;
    let cancelled = false;
    const check = async () => {
      const isDown = await gatewayIsDown();
      if (cancelled) return;
      setDown(isDown);
      if (!isDown) setDismissed(false);
    };
    void check();
    const id = window.setInterval(check, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (!down || dismissed) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[100] border-b border-destructive/30 bg-destructive/10 backdrop-blur-sm">
      <div className="mx-auto flex max-w-4xl items-start gap-3 px-4 py-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="flex-1 text-xs leading-relaxed text-foreground sm:text-sm">
          <span className="font-semibold">Service disruption:</span> our data
          service provider is currently having an outage, so signing in and
          loading data may fail. Our team is working on it and the app will
          recover automatically — no action needed.
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss outage notice"
          className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default ServiceOutageBanner;
