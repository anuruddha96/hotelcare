// A friendly cover for the moment a long-idle tab comes back to life.
//
// Coming back after lunch used to show stale numbers that silently jumped
// around as the refresh landed. Now the page says hello, names the person,
// and holds a calm message until the fresh Previo data is in.

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type Line = { quote: string; by: string };

/** Offline safety net — the live pool lives in `motivational_quotes`. */
const FALLBACK_LINES: Line[] = [
  { quote: "Quality is not an act, it is a habit.", by: "Aristotle" },
  { quote: "Plans are nothing; planning is everything.", by: "Dwight D. Eisenhower" },
  { quote: "It always seems impossible until it's done.", by: "Nelson Mandela" },
  { quote: "You can't manage what you don't measure — so let's go measure.", by: "Peter Drucker" },
  { quote: "Slow is smooth, smooth is fast.", by: "A patient operator" },
];

const GREETINGS = [
  "Welcome back",
  "Good to see you",
  "There you are",
  "Back in the chair",
];

/** Today in Budapest, as a stable seed so everyone sees the same quote. */
function daySeed(): number {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  return Array.from(day).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

export function WelcomeBackOverlay({
  name,
  step,
  progress,
  error,
  onRetry,
}: {
  /** First name of the person returning, when we know it. */
  name?: string | null;
  /** What the refresh is doing right now. */
  step?: string;
  /** 0-100. */
  progress?: number;
  error?: string | null;
  onRetry?: () => void;
}) {
  const [pool, setPool] = useState<Line[]>(FALLBACK_LINES);

  // Pull the shared pool once; the monthly AI refresh keeps it fresh.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("motivational_quotes")
        .select("quote, author")
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(300);
      if (cancelled || !data?.length) return;
      setPool(data.map((r) => ({ quote: r.quote, by: r.author })));
    })();
    return () => { cancelled = true; };
  }, []);

  const pick = useMemo(() => {
    const seed = daySeed();
    return { line: pool[seed % pool.length], greeting: GREETINGS[seed % GREETINGS.length] };
  }, [pool]);
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
            {pick.greeting}{first ? `, ${first}` : ""}
          </h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {error ? "The latest refresh did not finish." : `Fetching the latest prices, pickup and occupancy for you${".".repeat(dots)}`}
        </p>
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
          <div
            className="h-full rounded-full bg-primary transition-all duration-700"
            style={{ width: `${Math.max(8, Math.min(100, progress ?? 20))}%` }}
          />
        </div>
        {step && <p className="mt-2 text-xs text-muted-foreground">{step}</p>}
        {error && onRetry && (
          <Button className="mt-4 w-full" onClick={onRetry}>Try again</Button>
        )}
        <figure className="mt-5 border-t pt-4">
          <blockquote className="text-sm italic">“{pick.line.quote}”</blockquote>
          <figcaption className="mt-1 text-xs text-muted-foreground">— {pick.line.by}</figcaption>
        </figure>
      </div>
    </div>
  );
}

export default WelcomeBackOverlay;
