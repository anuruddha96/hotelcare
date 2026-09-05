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
  "There you are",
  "Back in the chair",
];

/** Today in Budapest, as a stable seed. */
function budapestDay(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function daySeed(): number {
  return Array.from(budapestDay()).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

/* ------------------------------------------------------------------ */
/* Role-aware rotation                                                 */
/* ------------------------------------------------------------------ */

const ROTATION_KEY = "hc.quoteRotation.v2";
type Rotation = { seen: string[] };

function readRotation(audience: QuoteAudience): Rotation {
  try {
    const raw = localStorage.getItem(`${ROTATION_KEY}.${audience}`);
    const parsed = raw ? (JSON.parse(raw) as Rotation) : null;
    if (parsed && Array.isArray(parsed.seen)) return { seen: parsed.seen };
  } catch { /* corrupt or unavailable storage — start a fresh cycle */ }
  return { seen: [] };
}

/**
 * Picks the next quote this role has not seen in the current cycle. Each role
 * audience owns its own history, so a housekeeping session can never inherit a
 * revenue/management quote simply because another user used this device first.
 */
function nextQuote(pool: MotivationalQuote[], audience: QuoteAudience): MotivationalQuote {
  const safePool = pool.length ? pool : quotePoolForAudience("hospitality");
  const { seen } = readRotation(audience);
  let unseen = safePool.filter((line) => !seen.includes(line.id));
  let history = seen;

  if (unseen.length === 0) {
    // Cycle complete: reset, but keep the last line out of the running so the
    // fresh cycle never opens with the quote that just closed the old one.
    const last = seen[seen.length - 1];
    unseen = safePool.filter((line) => line.id !== last);
    history = [];
    if (unseen.length === 0) unseen = safePool;
  }

  const chosen = unseen[Math.floor(Math.random() * unseen.length)];
  try {
    localStorage.setItem(
      `${ROTATION_KEY}.${audience}`,
      JSON.stringify({ seen: [...history, chosen.id].slice(-500) } satisfies Rotation),
    );
  } catch { /* private mode — rotation degrades to random, still no crash */ }
  return chosen;
}

/** Keep simultaneous overlays for the same role on the same line. The cache is
 * separated by audience so switching accounts/roles cannot leak a quote from a
 * different job family. */
const activeLines = new Map<QuoteAudience, { line: MotivationalQuote; shownAt: number }>();
const QUOTE_HOLD_MS = 10_000;

function activeQuoteForAudience(audience: QuoteAudience): MotivationalQuote {
  const current = activeLines.get(audience);
  if (current && Date.now() - current.shownAt < QUOTE_HOLD_MS) return current.line;

  const picked = nextQuote(quotePoolForAudience(audience), audience);
  activeLines.set(audience, { line: picked, shownAt: Date.now() });
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
  /** First name of the person returning, when we know it. */
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

  // Pick from the authenticated user's role pool. During the very first part of
  // session restoration the profile can still be unknown, so we use a neutral
  // hospitality line. As soon as the trusted profile arrives it is replaced by
  // a quote from the correct role pool.
  const [line, setLine] = useState<MotivationalQuote>(() => activeQuoteForAudience(audience));
  useEffect(() => {
    setLine((current) => {
      const rolePool = quotePoolForAudience(audience);
      if (rolePool.some((candidate) => candidate.id === current.id)) return current;
      return activeQuoteForAudience(audience);
    });
  }, [audience]);

  const greeting = useMemo(() => GREETINGS[daySeed() % GREETINGS.length], []);
  const [dots, setDots] = useState(1);
  useEffect(() => {
    const id = window.setInterval(() => setDots((d) => (d % 3) + 1), 600);
    return () => window.clearInterval(id);
  }, []);

  const first = (name ?? "").trim().split(" ")[0];

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
