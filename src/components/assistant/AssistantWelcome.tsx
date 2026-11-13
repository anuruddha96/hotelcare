import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, BellRing, CheckCircle2, Lightbulb } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAssistantContext } from "@/hooks/useAssistantContext";
import { greeting, starterPrompts } from "@/lib/assistant/starters";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import hotelCareMark from "@/assets/hotelcare-logo-mark.png";

type PriorityCard = {
  id: string;
  tone: "priority" | "opportunity" | "good";
  area: string;
  title: string;
  detail: string;
  prompt: string;
};

const TONE = {
  priority: { label: "Priority", icon: BellRing, chip: "bg-destructive/10 text-destructive", ring: "hover:border-destructive/40" },
  opportunity: { label: "Opportunity", icon: Lightbulb, chip: "bg-amber-500/15 text-amber-700 dark:text-amber-400", ring: "hover:border-amber-500/50" },
  good: { label: "On track", icon: CheckCircle2, chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", ring: "hover:border-emerald-500/50" },
} as const;

const CACHE_MINUTES = 10;

/** Live "where should I start" cards. Computed by fixed rules; no AI usage. */
function usePriorities(enabled: boolean, hotelId: string | null) {
  const { user } = useAuth();
  const [cards, setCards] = useState<PriorityCard[] | null>(null);
  const [hotelName, setHotelName] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !user) return;
    let cancelled = false;
    const key = `hc-assistant-priorities:${user.id}:${hotelId ?? ""}`;
    try {
      const cached = JSON.parse(sessionStorage.getItem(key) ?? "null");
      if (cached && Date.now() - cached.at < CACHE_MINUTES * 60_000) {
        setCards(cached.cards);
        setHotelName(cached.hotelName ?? null);
        return;
      }
    } catch {
      // A broken cache entry only means one extra request.
    }
    setCards(null);
    supabase.functions
      .invoke("assistant-priorities", { body: { hotelId } })
      .then(({ data, error }) => {
        if (cancelled) return;
        const next: PriorityCard[] = !error && Array.isArray((data as any)?.cards) ? (data as any).cards : [];
        const name = (data as any)?.hotel?.name ?? null;
        setCards(next);
        setHotelName(name);
        try {
          sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), cards: next, hotelName: name }));
        } catch {
          // Storage can be unavailable (private mode); the cards still show.
        }
      })
      .catch(() => {
        if (!cancelled) setCards([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, hotelId, user]);

  return { cards, hotelName };
}

/**
 * Opening screen of a conversation. In the full workspace it leads with what
 * needs attention today; in the side panel it stays a compact list of starters.
 */
export default function AssistantWelcome({
  workspace = false,
  disabled = false,
  onAsk,
}: {
  workspace?: boolean;
  disabled?: boolean;
  onAsk: (text: string) => void;
}) {
  const { profile } = useAuth();
  const { page } = useAssistantContext();
  const starters = useMemo(() => starterPrompts(profile?.role, page.module), [profile?.role, page.module]);
  const { cards, hotelName } = usePriorities(workspace, page.hotelId ?? profile?.assigned_hotel ?? null);

  if (!workspace) {
    return (
      <div className="mx-auto w-full max-w-md space-y-5 px-2 py-6">
        <div className="flex items-center gap-3">
          <img src={hotelCareMark} alt="" className="h-11 w-11 rounded-xl" />
          <div>
            <p className="text-lg font-semibold leading-tight">{greeting(profile?.full_name)}</p>
            <p className="text-sm text-muted-foreground">
              {profile?.assigned_hotel ? `${profile.assigned_hotel} · ` : ""}
              How can I help?
            </p>
          </div>
        </div>
        <div className="grid gap-2">
          {starters.map((starter) => (
            <button
              key={starter.prompt}
              type="button"
              disabled={disabled}
              className="rounded-xl border bg-card px-3.5 py-3 text-left transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-60"
              onClick={() => onAsk(starter.prompt)}
            >
              <span className="block text-sm font-medium">{starter.label}</span>
              <span className="block text-xs text-muted-foreground">{starter.prompt}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const loading = cards === null;
  return (
    <div className="mx-auto w-full max-w-2xl px-3 pb-6 pt-8 sm:pt-14">
      <div className="flex items-center gap-3">
        <img src={hotelCareMark} alt="" className="h-10 w-10 rounded-xl" />
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{greeting(profile?.full_name)}</h2>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Check what's happening{hotelName ? ` at ${hotelName}` : " across your hotels"}, make decisions, and ask Mira to handle tasks within your access.
      </p>

      {(loading || (cards?.length ?? 0) > 0) && (
        <section className="mt-7" aria-label="Where to start">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Live priorities</h3>
          <div className="grid gap-2">
            {loading
              ? [0, 1, 2].map((row) => <Skeleton key={row} className="h-[68px] w-full rounded-xl" />)
              : cards!.map((card) => {
                  const tone = TONE[card.tone] ?? TONE.opportunity;
                  const Icon = tone.icon;
                  return (
                    <button
                      key={card.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => onAsk(card.prompt)}
                      className={cn(
                        "group flex w-full items-start gap-3 rounded-xl border bg-card px-3.5 py-3 text-left transition-colors disabled:opacity-60",
                        tone.ring,
                      )}
                    >
                      <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg", tone.chip)}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{tone.label}</span>
                        </span>
                        <span className="block text-sm font-medium leading-snug">{card.title}</span>
                        <span className="block text-xs text-muted-foreground">{card.detail}</span>
                      </span>
                      <ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  );
                })}
          </div>
        </section>
      )}

      <section className="mt-6" aria-label="Suggestions">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Try asking</h3>
        <div className="flex flex-wrap gap-2">
          {starters.map((starter) => (
            <button
              key={starter.prompt}
              type="button"
              disabled={disabled}
              title={starter.prompt}
              onClick={() => onAsk(starter.prompt)}
              className="rounded-full border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-60"
            >
              {starter.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
