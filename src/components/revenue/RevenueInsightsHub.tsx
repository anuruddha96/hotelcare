import { useEffect, useMemo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { NewFeatureBadge, useFeatureSeen } from "@/components/common/NewFeatureBadge";
import { useUiPreference } from "@/hooks/useUiPreference";

export interface InsightItem {
  key: string;
  label: string;
  /** Release key used by the "New" badge. */
  featureKey?: string;
  /** Rendered only while the item is open. */
  render: () => ReactNode;
}

export interface InsightSection {
  key: string;
  label: string;
  icon: ReactNode;
  /** The question this section answers, shown under the tabs. */
  question: string;
  items: InsightItem[];
}

interface Prefs {
  section?: string;
  items?: Record<string, string>;
}

/**
 * The analysis area under the price list. Instead of a loose row of buttons and
 * panels, every analysis lives in one of a few sections, each answering one
 * management question. Only the open item is mounted, so the page stays fast.
 */
export default function RevenueInsightsHub({
  sections,
  title,
  preferenceKey = "revenue.insights",
}: {
  sections: InsightSection[];
  title: string;
  preferenceKey?: string;
}) {
  const visible = useMemo(() => sections.filter((s) => s.items.length > 0), [sections]);
  const { value, setValue, ready } = useUiPreference<Prefs>(preferenceKey, {});
  const prefs: Prefs = value && typeof value === "object" ? value : {};
  const { isNew, markSeen } = useFeatureSeen();

  const active = visible.find((s) => s.key === prefs.section) ?? visible[0];
  const activeItem = active?.items.find((i) => i.key === prefs.items?.[active.key]) ?? active?.items[0];

  // Opening a new feature once retires its badge.
  useEffect(() => {
    if (ready && activeItem?.featureKey) markSeen(activeItem.featureKey);
  }, [ready, activeItem?.featureKey, markSeen]);

  if (!active || !activeItem) return null;

  const openSection = (key: string) => setValue({ ...prefs, section: key });
  const openItem = (key: string) => setValue({ ...prefs, section: active.key, items: { ...(prefs.items ?? {}), [active.key]: key } });
  const sectionIsNew = (s: InsightSection) => s.items.some((i) => !!i.featureKey && isNew(i.featureKey));

  return (
    <section aria-label={title} className="min-w-0 rounded-xl border bg-card">
      <div className="border-b px-3 pt-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div role="tablist" aria-label={title} className="-mx-1 mt-2 flex gap-1 overflow-x-auto px-1 pb-0 [scrollbar-width:none]">
          {visible.map((s) => {
            const selected = s.key === active.key;
            return (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`insights-panel-${s.key}`}
                id={`insights-tab-${s.key}`}
                onClick={() => openSection(s.key)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  selected ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {s.icon}
                {s.label}
                <NewFeatureBadge show={sectionIsNew(s)} />
              </button>
            );
          })}
        </div>
      </div>
      <div
        role="tabpanel"
        id={`insights-panel-${active.key}`}
        aria-labelledby={`insights-tab-${active.key}`}
        className="min-w-0 space-y-3 p-3"
      >
        <p className="text-xs text-muted-foreground">{active.question}</p>
        {active.items.length > 1 && (
          <div role="group" aria-label={active.label} className="flex flex-wrap gap-1.5">
            {active.items.map((item) => {
              const selected = item.key === activeItem.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => openItem(item.key)}
                  className={cn(
                    "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    selected ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                  <NewFeatureBadge show={!!item.featureKey && isNew(item.featureKey)} className={selected ? "bg-primary-foreground text-primary" : undefined} />
                </button>
              );
            })}
          </div>
        )}
        <div key={`${active.key}:${activeItem.key}`} className="min-w-0">
          {activeItem.render()}
        </div>
      </div>
    </section>
  );
}
