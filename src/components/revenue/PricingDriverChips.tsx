import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import type { PriceResult } from "@/lib/revenuePricing";

export default function PricingDriverChips({ result }: { result: PriceResult }) {
  return (
    <div className="rounded border bg-muted/20 p-3 space-y-2 text-xs">
      <div className="font-semibold text-sm flex items-center justify-between">
        <span>Pricing drivers</span>
        <span className="text-muted-foreground">€{result.basePriceEur} → €{result.finalRate}</span>
      </div>
      <TooltipProvider delayDuration={150}>
        <ul className="space-y-1">
          {result.drivers.map((d, i) => {
            const positive = d.kind === "base" ? null : d.effectEur > 0.5;
            const negative = d.effectEur < -0.5;
            const Icon = d.kind === "base" ? ArrowRight : positive ? ArrowUp : negative ? ArrowDown : ArrowRight;
            const colour =
              d.kind === "base" ? "text-foreground" :
              positive ? "text-emerald-600" :
              negative ? "text-red-600" : "text-muted-foreground";
            return (
              <li key={i} className="flex items-center justify-between gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Icon className={`h-3.5 w-3.5 shrink-0 ${colour}`} />
                      <span className="truncate">{d.label}</span>
                      <span className="text-muted-foreground truncate">· {d.detail}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="left"><span className="font-mono text-[10px]">{d.source}</span></TooltipContent>
                </Tooltip>
                <span className={`font-mono ${colour}`}>
                  {d.kind === "base" ? `€${Math.round(d.effectEur)}` :
                    `${d.effectEur >= 0 ? "+" : ""}€${Math.round(d.effectEur)}`}
                </span>
              </li>
            );
          })}
        </ul>
      </TooltipProvider>
      <div className="flex items-center justify-between border-t pt-2 mt-1">
        <span className="font-semibold text-sm">Suggested</span>
        <span className="font-bold text-base">€{result.finalRate}</span>
      </div>
    </div>
  );
}
