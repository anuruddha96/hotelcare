import * as React from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface HelpTooltipProps {
  hint?: string;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}

export function HelpTooltip({ hint, children, side = "bottom" }: HelpTooltipProps) {
  if (!hint) return <>{children}</>;

  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side={side}
          className="max-w-[220px] text-xs font-normal bg-popover text-popover-foreground border shadow-md"
        >
          {hint}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
