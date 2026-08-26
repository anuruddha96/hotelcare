import { useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ChevronRight } from "lucide-react";

export interface MobileMoreItem {
  key: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  render: () => ReactNode;
}

/**
 * Everything analytical, one tap away and nothing rendered until it is opened —
 * so the pricing screen stays fast.
 */
export default function MobileMoreList({ items }: { items: MobileMoreItem[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const active = items.find((i) => i.key === open) ?? null;

  return (
    <div className="space-y-2 pb-6">
      <div className="overflow-hidden rounded-xl border bg-card">
        {items.map((item, i) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setOpen(item.key)}
            className={`flex min-h-[56px] w-full items-center gap-3 px-3 py-3 text-left ${i > 0 ? "border-t" : ""}`}
          >
            <span className="text-muted-foreground">{item.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{item.label}</span>
              {item.description && (
                <span className="block truncate text-[11px] text-muted-foreground">{item.description}</span>
              )}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>

      <Sheet open={!!active} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <SheetContent side="bottom" className="h-[95dvh] p-0">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-base">{active?.label}</SheetTitle>
          </SheetHeader>
          <div className="h-[calc(95dvh-3.5rem)] overflow-y-auto p-3">
            {active?.render()}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
