import { useState } from "react";
import { Check, ClipboardCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export type ActionProposal = {
  kind: "action_proposal";
  action: string;
  title: string;
  hotelId: string;
  hotelName?: string;
  reason?: string;
  fields: { label: string; value: string }[];
  input: Record<string, unknown>;
};

export function isActionProposal(value: unknown): value is ActionProposal {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as any).kind === "action_proposal" &&
    Array.isArray((value as any).fields)
  );
}

/** What the assistant wants to do. Nothing is written until Confirm. */
export default function ActionConfirmCard({ proposal }: { proposal: ActionProposal }) {
  const [state, setState] = useState<"idle" | "saving" | "done" | "dismissed">("idle");
  const [summary, setSummary] = useState("");

  const confirm = async () => {
    setState("saving");
    const { data, error } = await supabase.functions.invoke("assistant-apply-action", {
      body: { kind: proposal.action, input: proposal.input },
    });
    const failure = (error as any)?.message || (data as any)?.error;
    if (failure || !(data as any)?.ok) {
      setState("idle");
      toast.error(typeof failure === "string" ? failure : "That could not be completed");
      return;
    }
    setSummary((data as any).summary ?? "Done");
    setState("done");
    toast.success((data as any).summary ?? "Done");
  };

  return (
    <div className="mt-3 rounded-xl border bg-card p-3 text-card-foreground">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-primary" />
        <p className="text-sm font-semibold">{proposal.title}</p>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{proposal.hotelName ?? proposal.hotelId}</p>

      {proposal.reason && <p className="mt-2 text-sm">{proposal.reason}</p>}

      <dl className="mt-2 space-y-1">
        {proposal.fields.map((field) => (
          <div key={field.label} className="flex flex-wrap gap-x-2 text-sm">
            <dt className="text-muted-foreground">{field.label}</dt>
            <dd className="font-medium">{field.value}</dd>
          </div>
        ))}
      </dl>

      {state === "done" ? (
        <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-primary">
          <Check className="h-4 w-4" /> {summary}
        </p>
      ) : state === "dismissed" ? (
        <p className="mt-3 text-sm text-muted-foreground">Dismissed — nothing was changed.</p>
      ) : (
        <div className="mt-3 flex gap-2">
          <Button size="sm" className="gap-1.5" disabled={state === "saving"} onClick={confirm}>
            <Check className="h-3.5 w-3.5" />
            {state === "saving" ? "Working…" : "Confirm"}
          </Button>
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setState("dismissed")}>
            <X className="h-3.5 w-3.5" /> Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
