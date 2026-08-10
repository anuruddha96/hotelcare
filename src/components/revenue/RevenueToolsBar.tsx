import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export interface RevenueTool {
  key: string;
  label: string;
  icon: ReactNode;
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
  const active = tools.find((t) => t.key === open) ?? null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {tools.map((t) => (
          <Button
            key={t.key}
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setOpen(t.key)}
          >
            {t.icon}
            {t.label}
          </Button>
        ))}
      </div>

      <Sheet open={!!active} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col p-4">
          <SheetHeader className="pb-2">
            <SheetTitle className="text-base">{active?.label}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
            {active?.render()}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
