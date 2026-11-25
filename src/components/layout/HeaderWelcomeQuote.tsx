import { useSyncExternalStore } from "react";
import { Quote } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTranslation } from "@/hooks/useTranslation";
import { displayedWelcomeQuote, subscribeDisplayedWelcomeQuote } from "@/lib/welcomeQuoteDisplay";

export function HeaderWelcomeQuote({ userId }: { userId: string | null }) {
  const line = useSyncExternalStore(subscribeDisplayedWelcomeQuote, () => displayedWelcomeQuote(userId), () => null);
  const { language } = useTranslation();
  const label = language === "hu" ? "Mai gondolat" : language === "es" ? "Reflexión de hoy" : "Welcome quote";
  if (!line) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} title={label} className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Quote className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="hidden min-w-0 max-w-[180px] 2xl:block">
            <span className="block truncate text-[11px] font-medium text-foreground">“{line.quote_text}”</span>
            <span className="block truncate text-[10px] text-muted-foreground">— {line.author}</span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="z-[70] w-80 max-w-[calc(100vw-2rem)]">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">{label}</p>
        <figure>
          <blockquote className="text-sm leading-relaxed text-foreground">“{line.quote_text}”</blockquote>
          <figcaption className="mt-2 text-xs text-muted-foreground">— {line.author}</figcaption>
        </figure>
      </PopoverContent>
    </Popover>
  );
}
