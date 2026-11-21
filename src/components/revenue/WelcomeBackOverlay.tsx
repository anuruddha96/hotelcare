// Calm, original welcome layout: show at most one previously unseen thought.
// The database, not a device's local storage, owns lifetime seen-history.
// Quote retrieval/refill NEVER blocks entering the workspace.
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { readLegacyQuoteHistory } from "@/lib/welcomeQuoteHistory";

const GREETINGS = [
  "Welcome back", "Good to see you", "Good to have you back",
  "Back in the chair", "Ready when you are", "Picking up where you left off",
];

const GREETING_KEY = "hc.greetingRotation.v2";
const LOW_STOCK_THRESHOLD = 35;
type ClaimedQuote = { quote_key: string; quote_text: string; author: string };
type QuoteResult = { status: "ready"; quote: ClaimedQuote } | { status: "exhausted" | "error" };

// React Strict Mode or router redirects may mount the loader twice while a
// request is running. Deduplicate only in-flight claims, never reuse a quote
// already delivered in a prior visit.
const pendingClaims = new Map<string, Promise<QuoteResult>>();

function validatedQuote(data: unknown): ClaimedQuote | null {
  const candidate: unknown = Array.isArray(data) ? data[0] : null;
  if (!candidate) return null;
  if (typeof candidate !== "object" ||
      !("quote_key" in candidate) || typeof candidate.quote_key !== "string" ||
      !("quote_text" in candidate) || typeof candidate.quote_text !== "string" ||
      !("author" in candidate) || typeof candidate.author !== "string") {
    throw new Error("Unexpected welcome quote response");
  }
  return candidate as ClaimedQuote;
}

async function askForRefill(mode: "exhausted" | "low_stock"): Promise<boolean> {
  try {
    const { data, error } = await supabase.functions.invoke("welcome-quote-refill", {
      body: { mode },
    });
    return !error && data?.ok === true && Number(data?.inserted || 0) > 0;
  } catch (error) {
    console.warn("Welcome quote refill unavailable; login continues.", error);
    return false;
  }
}

function claimOnce(userId: string): Promise<QuoteResult> {
  const existing = pendingClaims.get(userId);
  if (existing) return existing;
  const request: Promise<QuoteResult> = (async () => {
    try {
      // Import previous browser histories once, then rely on permanent per-user
      // database impressions across roles, devices, hotels and future logins.
      const { data, error } = await supabase.rpc(
        "claim_welcome_quote" as never,
        { p_seen_keys: readLegacyQuoteHistory(userId) } as never,
      );
      if (error) throw error;
      let quote = validatedQuote(data);
      if (!quote) {
        // No more blank 'you have seen everything' message. Refill the database
        // using the protected server worker, then claim ONE new quote if ready.
        if (await askForRefill("exhausted")) {
          const retried = await supabase.rpc(
            "claim_welcome_quote" as never,
            { p_seen_keys: readLegacyQuoteHistory(userId) } as never,
          );
          if (retried.error) throw retried.error;
          quote = validatedQuote(retried.data);
        }
      }
      if (!quote) return { status: "exhausted" };

      // Replenish proactively near the end of this person's role-specific pool.
      // Run outside the UI flow so a slow OpenAI request cannot delay login.
      void Promise.resolve(supabase.rpc("welcome_quote_remaining" as never)).then(({ data: left, error: countError }) => {
        if (!countError && typeof left === "number" && left <= LOW_STOCK_THRESHOLD) {
          void askForRefill("low_stock");
        }
      }).catch(() => { /* Stock monitoring must never affect login. */ });
      return { status: "ready", quote };
    } catch (error) {
      // Never show a random local fallback: it could repeat a quote after
      // clearing the browser or when a staff member changes devices.
      console.warn("Welcome quote unavailable; workspace remains accessible.", error);
      return { status: "error" };
    }
  })();
  pendingClaims.set(userId, request);
  void request.finally(() => {
    if (pendingClaims.get(userId) === request) pendingClaims.delete(userId);
  });
  return request;
}

function nextGreeting(viewerKey: string): string {
  const key = `${GREETING_KEY}.${viewerKey}`;
  let previous = "";
  try { previous = localStorage.getItem(key) ?? ""; } catch { /* Storage unavailable. */ }
  const available = GREETINGS.filter((greeting) => greeting !== previous);
  const chosen = (available.length ? available : GREETINGS)[Math.floor(Math.random() * (available.length || GREETINGS.length))];
  try { localStorage.setItem(key, chosen); } catch { /* Storage unavailable. */ }
  return chosen;
}

export function WelcomeBackOverlay({
  name, step, progress, error, onRetry, onSignOut, context = "revenue",
}: {
  name?: string | null;
  step?: string;
  progress?: number;
  error?: string | null;
  onRetry?: () => void;
  onSignOut?: () => void;
  context?: "account" | "revenue";
}) {
  const { user, profile } = useAuth();
  const viewerId = user?.id && profile?.id === user.id ? user.id : null;
  const [line, setLine] = useState<ClaimedQuote | null>(null);
  useEffect(() => {
    let active = true;
    setLine(null);
    if (!viewerId) return () => { active = false; };
    void claimOnce(viewerId).then((result) => {
      if (active) setLine(result.status === "ready" ? result.quote : null);
    });
    return () => { active = false; };
  }, [viewerId]);

  const greeting = useMemo(() => nextGreeting(viewerId ?? "pending"), [viewerId]);
  const [dots, setDots] = useState(1);
  useEffect(() => {
    const id = window.setInterval(() => setDots((count) => (count % 3) + 1), 600);
    return () => window.clearInterval(id);
  }, []);

  const displayName = profile?.full_name?.trim() || name?.trim() || "";
  const first = displayName.split(/\s+/)[0] ?? "";
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/85 backdrop-blur-sm animate-fade-in"
      role="status" aria-live="polite">
      <div className="mx-4 w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <div className="flex items-center gap-3">
          <Loader2 className={`h-5 w-5 text-primary ${error ? "" : "animate-spin"}`} />
          <h2 className="text-lg font-semibold">{greeting}{first ? `, ${first}` : ""}</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {error ? error : context === "account"
            ? `Securely preparing your workspace${".".repeat(dots)}`
            : `Fetching the latest prices, pickup and occupancy for you${".".repeat(dots)}`}
        </p>
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
          <div className="h-full rounded-full bg-primary transition-all duration-700"
            style={{ width: `${Math.max(8, Math.min(100, progress ?? 20))}%` }} />
        </div>
        {step && <p className="mt-2 text-xs text-muted-foreground">{step}</p>}
        {(onRetry || onSignOut) && (
          <div className="mt-4 flex gap-2">
            {onRetry && <Button className="flex-1" onClick={onRetry}>Try again</Button>}
            {onSignOut && <Button className="flex-1" variant="outline" onClick={onSignOut}>Sign out</Button>}
          </div>
        )}
        {line && (
          <figure className="mt-5 border-t pt-4">
            <blockquote className="text-sm italic">“{line.quote_text}”</blockquote>
            <figcaption className="mt-1 text-xs text-muted-foreground">— {line.author}</figcaption>
          </figure>
        )}
      </div>
    </div>
  );
}

export default WelcomeBackOverlay;
