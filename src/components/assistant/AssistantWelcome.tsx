import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, BellRing, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Lightbulb, Mic, Pause, Play, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAssistantContext } from "@/hooks/useAssistantContext";
import { greeting, starterPrompts } from "@/lib/assistant/starters";
import { capabilitiesFor } from "@/lib/accessPolicy";
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

const REFRESH_MS = 90_000;
const CACHE_MS = 120_000;

/** Role-filtered real data from assistant-priorities; rotating the display never triggers AI calls. */
function usePriorities(enabled: boolean, hotelId: string | null) {
  const { user } = useAuth();
  const [cards, setCards] = useState<PriorityCard[] | null>(null);
  const [hotelName, setHotelName] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !user) return;
    let cancelled = false;
    const key = `hc-assistant-priorities:${user.id}:${hotelId ?? ""}`;
    try {
      const cached = JSON.parse(sessionStorage.getItem(key) ?? "null");
      if (cached && Date.now() - cached.at < CACHE_MS) {
        setCards(cached.cards);
        setHotelName(cached.hotelName ?? null);
        setUpdatedAt(cached.updatedAt ?? null);
      } else {
        setCards(null);
      }
    } catch { setCards(null); }

    const refresh = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("assistant-priorities", { body: { hotelId } });
        if (cancelled) return;
        if (error || !Array.isArray((data as any)?.cards)) return;
        const next = (data as any).cards as PriorityCard[];
        const name = (data as any)?.hotel?.name ?? null;
        const time = (data as any)?.generatedAt ?? new Date().toISOString();
        setCards(next);
        setHotelName(name);
        setUpdatedAt(time);
        try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), cards: next, hotelName: name, updatedAt: time })); } catch { /* private mode */ }
      } catch { if (!cancelled) setCards((current) => current ?? []); }
    };
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, REFRESH_MS);
    const onFocus = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [enabled, hotelId, user?.id]);

  return { cards, hotelName, updatedAt };
}

export default function AssistantWelcome({
  workspace = false, disabled = false, onAsk, onVoice, voiceSupported = false,
}: {
  workspace?: boolean;
  disabled?: boolean;
  onAsk: (text: string) => void;
  onVoice?: () => void;
  voiceSupported?: boolean;
}) {
  const { profile } = useAuth();
  const { page } = useAssistantContext();
  const revenueAllowed = capabilitiesFor(profile).revenueRead;
  const starters = useMemo(() => starterPrompts(profile?.role, page.module, revenueAllowed), [profile?.role, page.module, revenueAllowed]);
  const { cards, hotelName, updatedAt } = usePriorities(workspace, page.hotelId ?? profile?.assigned_hotel ?? null);
  const [rotation, setRotation] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [paused, setPaused] = useState(false);
  const count = cards?.length ?? 0;
  const windowSize = Math.min(3, count);
  useEffect(() => { setRotation(0); setExpanded(false); }, [page.hotelId, profile?.assigned_hotel]);
  useEffect(() => {
    if (count <= windowSize || expanded || paused) return;
    const timer = window.setInterval(() => setRotation((index) => (index + 1) % count), 6500);
    return () => window.clearInterval(timer);
  }, [count, windowSize, expanded, paused]);

  const visibleCards = useMemo(() => {
    if (!cards) return [];
    if (expanded || count <= windowSize) return cards;
    return Array.from({ length: windowSize }, (_, i) => cards[(rotation + i) % count]);
  }, [cards, count, expanded, rotation, windowSize]);

  if (!workspace) {
    return (
      <div className="mx-auto w-full max-w-md space-y-5 px-2 py-6">
        <div className="flex items-center gap-3">
          <img src={hotelCareMark} alt="" className="h-11 w-11 rounded-xl" />
          <div>
            <p className="text-lg font-semibold leading-tight">{greeting(profile?.full_name)}</p>
            <p className="text-sm text-muted-foreground">Ask Mira about your hotel, or give her a task.</p>
          </div>
        </div>
        {onVoice && <button type="button" onClick={onVoice} disabled={disabled || !voiceSupported} className="flex w-full items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3 text-left text-sm font-medium text-primary disabled:opacity-50"><Mic className="h-5 w-5" /> Tap to speak instead of typing <ArrowUpRight className="ml-auto h-4 w-4" /></button>}
        <div className="grid gap-2">
          {starters.map((starter) => (
            <button key={starter.prompt} type="button" disabled={disabled}
              className="rounded-xl border bg-card px-3.5 py-3 text-left transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-60"
              onClick={() => onAsk(starter.prompt)}>
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
    <div className="mx-auto w-full max-w-3xl space-y-6 px-3 pb-8 pt-6 sm:px-6 sm:pt-10">
      <section aria-label="Meet Mira" className="space-y-3">
        <div className="flex items-center gap-3">
          <img src={hotelCareMark} alt="" className="h-10 w-10 rounded-xl" />
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{greeting(profile?.full_name)}</h2>
        </div>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Mira is your AI operator. Ask about {hotelName || "your authorized hotels"}, review live priorities, and prepare actions within your role.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {onVoice && (
            <button type="button" onClick={onVoice} disabled={disabled || !voiceSupported}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50">
              <Mic className="h-4 w-4" /> Try Mira with your voice
            </button>
          )}
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Sparkles className="h-3.5 w-3.5" /> Ask, check, and prepare real hotel tasks</span>
        </div>
      </section>

      {(loading || count > 0) && (
        <section aria-label="Live hotel priorities" className="space-y-2">
          <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Live priorities</h3>
              {count > 0 && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums">{count}</span>}
            </div>
            {count > windowSize && (
              <div className="flex items-center gap-1">
                <button type="button" aria-label="Previous priorities" className="rounded-lg p-1.5 hover:bg-muted" onClick={() => setRotation((n) => (n + count - 1) % count)}><ChevronLeft className="h-4 w-4" /></button>
                <button type="button" aria-label="Next priorities" className="rounded-lg p-1.5 hover:bg-muted" onClick={() => setRotation((n) => (n + 1) % count)}><ChevronRight className="h-4 w-4" /></button>
                <button type="button" aria-label={paused ? "Resume priority rotation" : "Pause priority rotation"} className="rounded-lg p-1.5 hover:bg-muted" onClick={() => setPaused((value) => !value)}>{paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}</button>
                <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium hover:bg-muted" onClick={() => setExpanded((value) => !value)}>
                  {expanded ? "Show fewer" : "View all"} {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
              </div>
            )}
          </div>
          <div className="grid gap-2" aria-live="off">
            {loading ? [0, 1, 2].map((row) => <Skeleton key={row} className="h-[86px] w-full rounded-xl" />) :
              visibleCards.map((card) => {
                const tone = TONE[card.tone] ?? TONE.opportunity;
                const Icon = tone.icon;
                const cta = card.area === "maintenance" ? "Review tickets" : card.area === "revenue" ? "Review rates" : card.area === "reputation" ? "Review replies" : card.area === "housekeeping" ? "Check progress" : "View details";
                return (
                  <button key={card.id} type="button" disabled={disabled} onClick={() => onAsk(card.prompt)}
                    className={cn("group flex w-full items-start gap-3 rounded-xl border bg-card px-3 py-3 text-left transition-colors disabled:opacity-60 sm:px-4", tone.ring)}>
                    <span className={cn("mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg", tone.chip)}><Icon className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{tone.label}</span>
                      <span className="block text-sm font-semibold leading-snug break-words">{card.title}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{card.detail}</span>
                    </span>
                    <span className="mt-1 hidden shrink-0 items-center gap-1 text-xs font-medium text-primary group-hover:underline sm:inline-flex">{cta}<ArrowUpRight className="h-3.5 w-3.5" /></span>
                    <ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-primary sm:hidden" />
                  </button>
                );
              })}
          </div>
          <p className="text-[11px] text-muted-foreground">{updatedAt ? `Checked ${new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. ` : ""}Cards open a review in Mira; changes still require permission and confirmation.</p>
        </section>
      )}

      <section aria-label="Suggested questions" className="space-y-2 pb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Try asking Mira</h3>
        <div className="flex flex-wrap gap-2">
          {starters.map((starter) => (
            <button key={starter.prompt} type="button" disabled={disabled} title={starter.prompt} onClick={() => onAsk(starter.prompt)}
              className="rounded-full border bg-card px-3 py-2 text-left text-xs font-medium leading-snug transition-colors hover:border-primary/40 hover:bg-accent disabled:opacity-60 sm:text-sm">
              {starter.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
