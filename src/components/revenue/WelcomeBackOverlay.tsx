// Calm, original welcome layout. A signed-in employee is assigned exactly one
// curated quote from the database; a quote is NEVER replayed after assignment.
// Quote retrieval is non-blocking: login, refresh and retry must keep working.
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { readLegacyQuoteHistory } from "@/lib/welcomeQuoteHistory";

const GREETINGS = [
  "Welcome back",
  "Good to see you",
  "Good to have you back",
  "Back in the chair",
  "Ready when you are",
  "Picking up where you left off",
];

const GREETING_KEY = "hc.greetingRotation.v2";
type ClaimedQuote = { quote_key: string; quote_text: string; author: string };
type QuoteResult = { status: "ready"; quote: ClaimedQuote } | { status: "exhausted" | "error" };

// React's Strict Mode and router redirects can mount the same loader twice
// before a request finishes. Share ONLY in-flight claims, not resolved quotes:
// a separate welcome must receive a different quote, even seconds later.
const pendingClaims = new Map<string, Promise<QuoteResult>>();

function claimOnce(userId: string): Promise<QuoteResult> {
  const existing = pendingClaims.get(userId);
  if (existing) return existing;

  const request: Promise<QuoteResult> = (async () => {
    try {
      // Import prior v3/v4 local rotations for this user across all roles.
      // From now on the permanent, per-user database is the source of truth.
      const { data, error } = await supabase.rpc(
        "claim_welcome_quote" as never,
        { p_seen_keys: readLegacyQuoteHistory(userId) } as never,
      );
      if (error) throw error;
      const candidate: unknown = Array.isArray(data) ? data[0] : null;
      if (!candidate) return { status: "exhausted" };
      if (typeof candidate !== "object" ||
          !("quote_key" in candidate) || typeof candidate.quote_key !== "string" ||
          !("quote_text" in candidate) || typeof candidate.quote_text !== "string" ||
          !("author" in candidate) || typeof candidate.author !== "string") {
        throw new Error("Unexpected welcome quotation response");
      }
      return { status: "ready", quote: candidate as ClaimedQuote };
    } catch (error) {
      // Never display an unsynchronized local fallback: that could show a
      // previously seen quote on a different phone or after clearing storage.
      console.warn("Welcome quotation unavailable; workspace remains accessible.", error);
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
  name,
  step,
  progress,
  error,
  onRetry,
  onSignOut,
  context = "revenue",
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
  // Do not show a generic quote and then swap it for a role-specific one.
  // A profile must belong to the authenticated user before requesting a quote.
  const viewerId = user?.id && profile?.id === user.id ? user.id : null;
  const [line, setLine] = useState<ClaimedQuote | null>(null);
  const [quoteStatus, setQuoteStatus] = useState<"idle" | "loading" | "ready" | "exhausted" | "error">("idle");
  useEffect(() => {
    let active = true;
    setLine(null);
    if (!viewerId) {
      setQuoteStatus("idle");
      return () => { active = false; };
    }
    setQuoteStatus("loading");
    void claimOnce(viewerId).then((result) => {
      if (!active) return;
      setLine(result.status === "ready" ? result.quote : null);
      setQuoteStatus(result.status);
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
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/85 backdrop-blur-sm animate-fade-in"
      role="status"
      aria-live="polite"
    >
      <div className="mx-4 w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <div className="flex items-center gap-3">
          <Loader2 className={`h-5 w-5 text-primary ${error ? "" : "animate-spin"}`} />
          <h2 className="text-lg font-semibold">
            {greeting}{first ? `, ${first}` : ""}
          </h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {error
            ? error
            : context === "account"
              ? `Securely preparing your workspace${".".repeat(dots)}`
              : `Fetching the latest prices, pickup and occupancy for you${".".repeat(dots)}`}
        </p>
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
          <div
            className="h-full rounded-full bg-primary transition-all duration-700"
            style={{ width: `${Math.max(8, Math.min(100, progress ?? 20))}%` }}
          />
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
        {quoteStatus === "exhausted" && (
          <p className="mt-5 border-t pt-4 text-xs text-muted-foreground">
            You have seen every quote in your collection. New thoughts will appear as they are added.
          </p>
        )}
      </div>
    </div>
  );
}

export default WelcomeBackOverlay;
