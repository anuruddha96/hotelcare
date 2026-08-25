import { useState } from "react";
import { ArrowRight, Check, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export type AutomationProposal = {
  kind: "automation_change_proposal";
  ruleId: string;
  hotelId: string;
  hotelName?: string;
  currency?: string;
  reason?: string;
  diff: { field: string; label: string; from: unknown; to: unknown }[];
};

export function isAutomationProposal(value: unknown): value is AutomationProposal {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as any).kind === "automation_change_proposal" &&
    Array.isArray((value as any).diff)
  );
}

function show(value: unknown) {
  if (value === true) return "On";
  if (value === false) return "Off";
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

/** Before → after diff the assistant proposed. Nothing changes until Apply. */
export default function AutomationChangeCard({ proposal }: { proposal: AutomationProposal }) {
  const [state, setState] = useState<"idle" | "saving" | "applied" | "dismissed">("idle");

  const apply = async () => {
    setState("saving");
    const changes: Record<string, unknown> = {};
    for (const row of proposal.diff) changes[row.field] = row.to;
    const { data, error } = await supabase.functions.invoke("assistant-apply-automation-change", {
      body: {
        hotel_id: proposal.hotelId,
        rule_id: proposal.ruleId,
        reason: proposal.reason ?? "",
        changes,
      },
    });
    const failure = (error as any)?.message || (data as any)?.error;
    if (failure || !(data as any)?.ok) {
      setState("idle");
      toast.error(typeof failure === "string" ? failure : "The change could not be applied");
      return;
    }
    setState("applied");
    toast.success("Automation updated");
  };

  return (
    <div className="mt-3 rounded-xl border bg-card p-3 text-card-foreground">
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="h-4 w-4 text-primary" />
        <p className="text-sm font-semibold">Proposed automation change</p>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {proposal.hotelName ?? proposal.hotelId}
        {proposal.currency ? ` · ${proposal.currency}` : ""}
      </p>

      {proposal.reason && <p className="mt-2 text-sm">{proposal.reason}</p>}

      <ul className="mt-2 space-y-1.5">
        {proposal.diff.map((row) => (
          <li key={row.field} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="font-medium tabular-nums">{show(row.from)}</span>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-semibold tabular-nums text-primary">{show(row.to)}</span>
          </li>
        ))}
      </ul>

      {state === "applied" ? (
        <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-primary">
          <Check className="h-4 w-4" /> Applied to the automation rules
        </p>
      ) : state === "dismissed" ? (
        <p className="mt-3 text-sm text-muted-foreground">Dismissed — nothing was changed.</p>
      ) : (
        <div className="mt-3 flex gap-2">
          <Button size="sm" className="gap-1.5" disabled={state === "saving"} onClick={apply}>
            <Check className="h-3.5 w-3.5" />
            {state === "saving" ? "Applying…" : "Apply"}
          </Button>
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setState("dismissed")}>
            <X className="h-3.5 w-3.5" /> Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}
