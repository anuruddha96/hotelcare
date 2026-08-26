import { useState, type ReactNode } from "react";
import { CalendarDays, LayoutGrid, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

export type MobileTab = "prices" | "today" | "more";

/**
 * The phone shell for Revenue Management.
 *
 * One job per screen: change prices, read today, or dig into the analysis.
 * Everything analytical lives behind "More" so the pricing screen paints fast
 * and stays thumb-sized. Desktop never renders this.
 */
export default function MobileRevenueShell({
  header, prices, today, more,
}: {
  header: ReactNode;
  prices: ReactNode;
  today: ReactNode;
  more: ReactNode;
}) {
  const [tab, setTab] = useState<MobileTab>("prices");

  const items: Array<{ key: MobileTab; label: string; icon: ReactNode }> = [
    { key: "prices", label: "Prices", icon: <CalendarDays className="h-5 w-5" /> },
    { key: "today", label: "Today", icon: <Sun className="h-5 w-5" /> },
    { key: "more", label: "More", icon: <LayoutGrid className="h-5 w-5" /> },
  ];

  return (
    <div className="min-h-screen bg-background pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
      {header}
      <div className="px-3 pt-2">
        {tab === "prices" && prices}
        {tab === "today" && today}
        {tab === "more" && more}
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 pb-[env(safe-area-inset-bottom)]"
        aria-label="Revenue sections"
      >
        <div className="grid grid-cols-3">
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              onClick={() => setTab(it.key)}
              aria-current={tab === it.key ? "page" : undefined}
              className={cn(
                "flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors",
                tab === it.key ? "text-primary" : "text-muted-foreground",
              )}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
