import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { NewFeatureBadge, useFeatureSeen } from "@/components/common/NewFeatureBadge";
import { useTranslation } from "@/hooks/useTranslation";
import { useIsMobile } from "@/hooks/use-mobile";

export interface RevenueTool {
  key: string;
  label: string;
  icon: ReactNode;
  /** Release key used by the "New" badge; omit for older tools. */
  featureKey?: string;
  /** Rendered lazily, only while the panel is open. */
  render: () => ReactNode;
}

/**
 * One quiet row of buttons under the price list. Everything that is not a
 * chart or the price list itself lives behind these, so the main page stays
 * readable and each tool gets a full side panel to work in.
 */
export default function RevenueToolsBar({ tools }: { tools: RevenueTool[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const { language } = useTranslation();
  const active = tools.find((t) => t.key === open) ?? null;
  const { isNew, markSeen } = useFeatureSeen();

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {tools.map((t) => (
          <Button
            key={t.key}
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setOpen(t.key);
              if (t.featureKey) markSeen(t.featureKey);
            }}
          >
            {t.icon}
            {t.label}
            <NewFeatureBadge show={!!t.featureKey && isNew(t.featureKey)} />
          </Button>
        ))}
      </div>


      <Sheet open={!!active} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side={isMobile ? "bottom" : "right"} className={isMobile
          ? "h-[94dvh] max-h-[94dvh] w-full max-w-full min-w-0 flex flex-col gap-2 overflow-hidden rounded-t-xl border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          : "h-full w-full max-w-2xl min-w-0 flex flex-col gap-2 overflow-hidden bg-background p-4"}>
          {/* Own close button: the sheet's corner X can sit under a toast on mobile. */}
          <SheetHeader className="shrink-0 border-b pb-2 pr-10">
            <div className="flex items-center justify-between gap-2">
              <SheetTitle className="text-base">{active?.label}</SheetTitle>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 gap-1 px-2 text-muted-foreground"
                onClick={() => setOpen(null)}
              >
                <X className="h-4 w-4" />
                {language === "hu" ? "Bezárás" : "Close"}
              </Button>
            </div>
          </SheetHeader>
          <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain px-1 pb-5" style={{ WebkitOverflowScrolling: "touch" }}>
            {active?.render()}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
