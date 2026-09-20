// Calm welcome screen for session restoration and revenue refreshes.
// Show an authentic, role-matched thought long enough to read, without trapping
// people when their workspace is ready or hiding retry/sign-out on failure.
import { useEffect, useMemo, useState } from "react";
import { BookOpen, ArrowRight, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import {
  quoteAudienceForRole,
  quoteAudienceLabel,
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

const ROTATION_KEY = "hc.quoteRotation.v4";
const GREETING_KEY = "hc.greetingRotation.v2";
type Rotation = { seen: string[] };

function readRotation(viewerKey: string): Rotation {
  try {
    const raw = localStorage.getItem(`${ROTATION_KEY}.${viewerKey}`);
    const parsed = raw ? (JSON.parse(raw) as Rotation) : null;
    if (parsed && Array.isArray(parsed.seen)) return { seen: parsed.seen };
  } catch { /* Storage disabled or corrupt: still show a quote. */ }
  return { seen: [] };
}

function nextQuote(pool: MotivationalQuote[], viewerKey: string): MotivationalQuote {
  const safePool = pool.length ? pool : quotePoolForAudience("hospitality");
  const { seen } = readRotation(viewerKey);
  let unseen = safePool.filter((line) => !seen.includes(line.id));
  let history = seen;

  if (!unseen.length) {
    // Keep the last quote out of the next cycle to prevent back-to-back repeats.
    const last = seen[seen.length - 1];
    unseen = safePool.filter((line) => line.id !== last);
    history = [];
    if (!unseen.length) unseen = safePool;
  }

  const chosen = unseen[Math.floor(Math.random() * unseen.length)];
  try {
    localStorage.setItem(
      `${ROTATION_KEY}.${viewerKey}`,
      JSON.stringify({ seen: [...history, chosen.id].slice(-500) } satisfies Rotation),
    );
  } catch { /* Private mode: selection still works. */ }
  return chosen;
}

function nextGreeting(viewerKey: string): string {
  const key = `${GREETING_KEY}.${viewerKey}`;
  let previous = "";
  try { previous = localStorage.getItem(key) ?? ""; } catch { /* No storage. */ }
  const available = GREETINGS.filter((greeting) => greeting !== previous);
  const pool = available.length ? available : GREETINGS;
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  try { localStorage.setItem(key, chosen); } catch { /* No storage. */ }
  return chosen;
}

// Root redirect and tenant routes can remount the overlay during one login.
// Retain the same quote so a new quotation does not replace one mid-read.
const activeLines = new Map<string, { line: MotivationalQuote; shownAt: number }>();
const QUOTE_HOLD_MS = 30_000;

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
  onContinue,
  ready = false,
  context = "revenue",
}: {
  name?: string | null;
  step?: string;
  progress?: number;
  error?: string | null;
  onRetry?: () => void;
  onSignOut?: () => void;
  /** Offered only once actual loading completes; never bypasses an error. */
  onContinue?: () => void;
  ready?: boolean;
  context?: "account" | "revenue";
}) {
  const { profile } = useAuth();
  const audience = useMemo(() => quoteAudienceForRole(profile?.role), [profile?.role]);
  const viewerKey = useMemo(
    () => `${audience}.${profile?.id ?? "pending"}`,
    [audience, profile?.id],
  );

  // The profile may arrive after the session starts. Immediately select a
  // correctly matched quote once its trusted role becomes available.
  const [line, setLine] = useState<MotivationalQuote>(() => activeQuoteForAudience(audience, viewerKey));
  useEffect(() => {
    setLine(activeQuoteForAudience(audience, viewerKey));
  }, [audience, viewerKey]);

  const greeting = useMemo(() => nextGreeting(viewerKey), [viewerKey]);
  const [dots, setDots] = useState(1);
  const [showTakeaway, setShowTakeaway] = useState(false);
  useEffect(() => {
    if (error || ready) return;
    const id = window.setInterval(() => setDots((value) => (value % 3) + 1), 600);
    return () => window.clearInterval(id);
  }, [error, ready]);
  useEffect(() => {
    setShowTakeaway(false);
    const id = window.setTimeout(() => setShowTakeaway(true), 900);
    return () => window.clearTimeout(id);
  }, [line.id]);

  // A nickname can be a login name, not a person's name.
  const displayName = profile?.full_name?.trim() || name?.trim() || "";
  const first = displayName.split(/\s+/)[0] ?? "";
  const canContinue = Boolean(ready && onContinue && !error);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/85 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome back to HotelCare"
    >
      <div className="mx-4 w-full max-w-md rounded-xl border bg-card p-6 shadow-lg">
        <div className="flex items-center gap-3">
          {ready && !error
            ? <Sparkles aria-hidden="true" className="h-5 w-5 text-primary motion-safe:animate-pulse" />
            : <Loader2 aria-hidden="true" className={`h-5 w-5 text-primary ${error ? "" : "motion-safe:animate-spin"}`} />}
          <h2 className="text-lg font-semibold">
            {greeting}{first ? `, ${first}` : ""}
          </h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground" role="status">
          {error
            ? error
            : ready
              ? "Your workspace is ready. Enjoy today's thought before you go."
              : context === "account"
                ? "Securely preparing your workspace"
                : "Fetching the latest prices, pickup and occupancy for you"}
          {!error && !ready && <span aria-hidden="true">{".".repeat(dots)}</span>}
        </p>
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-primary/15"
          role="progressbar"
          aria-label="Workspace preparation"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={ready ? 100 : Math.max(0, Math.min(100, progress ?? 20))}
        >
          <div
            className="h-full rounded-full bg-primary transition-all duration-700 motion-reduce:transition-none"
            style={{ width: `${ready ? 100 : Math.max(8, Math.min(100, progress ?? 20))}%` }}
          />
        </div>
        {step && !ready && <p className="mt-2 text-xs text-muted-foreground">{step}</p>}
        {(onRetry || onSignOut) && (
          <div className="mt-4 flex gap-2">
            {onRetry && <Button className="flex-1" onClick={onRetry}>Try again</Button>}
            {onSignOut && <Button className="flex-1" variant="outline" onClick={onSignOut}>Sign out</Button>}
          </div>
        )}
        <figure className="mt-5 border-t pt-4" aria-label="Thought for today">
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
              <BookOpen aria-hidden="true" className="h-3.5 w-3.5" /> Thought for today
            </span>
            <span className="text-[11px] text-muted-foreground">{quoteAudienceLabel(audience)}</span>
          </div>
          <blockquote key={line.id} className="text-[15px] font-medium italic leading-relaxed motion-safe:animate-fade-in">
            “{line.quote}”
          </blockquote>
          <figcaption className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>— {line.by}</span>
            <a
              href={line.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 underline underline-offset-2 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              aria-label={`Read the source of this quotation by ${line.by}`}
            >
              Source
            </a>
          </figcaption>
          <div
            className={`mt-4 rounded-lg bg-primary/5 px-3 py-2.5 transition-all duration-700 motion-reduce:transition-none ${showTakeaway ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"}`}
            aria-hidden={!showTakeaway}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">Put it into practice</p>
            <p className="mt-1 text-sm leading-relaxed text-foreground">{line.takeaway}</p>
          </div>
        </figure>
        {canContinue && (
          <div className="mt-5 flex items-center justify-between gap-3 border-t pt-4">
            <span className="text-xs text-muted-foreground">Take a moment to read, or continue now.</span>
            <Button onClick={onContinue} className="shrink-0 gap-1.5">
              Open workspace <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default WelcomeBackOverlay;
