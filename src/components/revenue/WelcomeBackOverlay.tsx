// A friendly cover for the moment a long-idle tab comes back to life.
//
// Coming back after lunch used to show stale numbers that silently jumped
// around as the refresh landed. Now the page says hello, names the person,
// and holds a calm message until the fresh Previo data is in.

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import {
  quoteAudienceForRole,
  quotePoolForAudience,
  type MotivationalQuote,
  type QuoteAudience,
} from "@/lib/roleMotivationalQuotes";

const GREETINGS = [
  "Welcome back",
  "Good to see you",
  "Good to have you back",
  "Back in the chair",
  "Ready when you are",
  "Picking up where you left off",
];

/* ------------------------------------------------------------------ */
/* User + role-aware rotation                                          */
/* ------------------------------------------------------------------ */

const ROTATION_KEY = "hc.quoteRotation.v3";
const GREETING_KEY = "hc.greetingRotation.v2";
type Rotation = { seen: string[] };

function readRotation(viewerKey: string): Rotation {
  try {
    const raw = localStorage.getItem(`${ROTATION_KEY}.${viewerKey}`);
    const parsed = raw ? (JSON.parse(raw) as Rotation) : null;
    if (parsed && Array.isArray(parsed.seen)) return { seen: parsed.seen };
  } catch { /* corrupt or unavailable storage — start a fresh cycle */ }
  return { seen: [] };
}

/**
 * Picks the next quote this user has not seen in the current role cycle.
 * The history is user + role scoped so shared devices do not make one person's
 * quote rotation feel repetitive because another colleague used the same role.
 */
function nextQuote(pool: MotivationalQuote[], viewerKey: string): MotivationalQuote {
  const safePool = pool.length ? pool : quotePoolForAudience("hospitality");
  const { seen } = readRotation(viewerKey);
  let unseen = safePool.filter((line) => !seen.includes(line.id));
  let history = seen;

  if (unseen.length === 0) {
    // Cycle complete: reset, but keep the final quote out of the first draw so
    // a new cycle can never immediately repeat the line that just finished it.
    const last = seen[seen.length - 1];
    unseen = safePool.filter((line) => line.id !== last);
    history = [];
    if (unseen.length === 0) unseen = safePool;
  }

  const chosen = unseen[Math.floor(Math.random() * unseen.length)];
  try {
    localStorage.setItem(
      `${ROTATION_KEY}.${viewerKey}`,
      JSON.stringify({ seen: [...history, chosen.id].slice(-500) } satisfies Rotation),
    );
  } catch { /* private mode — rotation degrades to random, still no crash */ }
  return chosen;
}

function nextGreeting(viewerKey: string): string {
  const key = `${GREETING_KEY}.${viewerKey}`;
  let previous = "";
  try {
    previous = localStorage.getItem(key) ?? "";
  } catch { /* storage unavailable */ }

  const available = GREETINGS.filter((greeting) => greeting !== previous);
  const pool = available.length ? available : GREETINGS;
  const chosen = pool[Math.floor(Math.random() * pool.length)];

  try {
    localStorage.setItem(key, chosen);
  } catch { /* storage unavailable */ }
  return chosen;
}

/** Keep simultaneous overlays for the same user/role on the same line so the
 * quote does not flicker if the app briefly remounts during bootstrap. */
const activeLines = new Map<string, { line: MotivationalQuote; shownAt: number }>();
const QUOTE_HOLD_MS = 10_000;

function activeQuoteForAudience(audience: QuoteAudience, viewerKey: string): MotivationalQuote {
  const current = activeLines.get(viewerKey);
  if (current && Date.now() - current.shownAt < QUOTE_HOLD_MS) return current.line;

  const picked = nextQuote(quotePoolForAudience(audience), viewerKey);
  activeLines.set(viewerKey, { line: picked, shownAt: Date.now() });
  return picked;
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
  /** Human name supplied by a caller, used only if the profile name is unavailable. */
  name?: string | null;
  /** What the refresh is doing right now. */
  step?: string;
  /** 0-100. */
  progress?: number;
  error?: string | null;
  onRetry?: () => void;
  onSignOut?: () => void;
  context?: "account" | "revenue";
}) {
  const { profile } = useAuth();
  const audience = useMemo(() => quoteAudienceForRole(profile?.role), [profile?.role]);
  const viewerKey = useMemo(
    () => `${audience}.${profile?.id ?? "pending"}`,
    [audience, profile?.id],
  );

  // During the first part of session restoration the profile can still be
  // unknown, so a neutral hospitality line is shown. Once the trusted profile
  // arrives, the overlay immediately switches to that user's role-specific pool.
  const [line, setLine] = useState<MotivationalQuote>(() => activeQuoteForAudience(audience, viewerKey));
  useEffect(() => {
    setLine(activeQuoteForAudience(audience, viewerKey));
  }, [audience, viewerKey]);

  // Unlike the old day-seeded greeting, this avoids showing "Back in the chair"
  // every time the same person opens the workspace during one day.
  const greeting = useMemo(() => nextGreeting(viewerKey), [viewerKey]);
  const [dots, setDots] = useState(1);
  useEffect(() => {
    const id = window.setInterval(() => setDots((d) => (d % 3) + 1), 600);
    return () => window.clearInterval(id);
  }, []);

  // Always prefer the person's proper profile name. `nickname` is also used as
  // a login/username in some accounts, so it must never be shown as the welcome name.
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
        <figure className="mt-5 border-t pt-4">
          <blockquote className="text-sm italic">“{line.quote}”</blockquote>
          <figcaption className="mt-1 text-xs text-muted-foreground">— {line.by}</figcaption>
        </figure>
      </div>
    </div>
  );
}

export default WelcomeBackOverlay;
