import { useState } from "react";
import { AlertTriangle, Check, ClipboardCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { edgeFunctionError } from "@/lib/edgeFunctionError";

const NOT_COMPLETED = "HotelCare could not complete this. Nothing was changed.";

/**
 * The reason HotelCare gave. supabase-js hides a non-2xx body behind
 * "Edge Function returned a non-2xx status code", which tells nobody anything.
 */
export async function actionFailureMessage(error: unknown, data: unknown): Promise<string> {
  const message = error
    ? await edgeFunctionError(error, NOT_COMPLETED)
    : String((data as { error?: unknown } | null)?.error ?? "").trim() || NOT_COMPLETED;
  return /non-2xx|failed to send a request/i.test(message) ? NOT_COMPLETED : message;
}

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
  const [failure, setFailure] = useState<string | null>(null);

  const confirm = async () => {
    setState("saving");
    setFailure(null);
    const { data, error } = await supabase.functions.invoke("assistant-apply-action", {
      body: { kind: proposal.action, input: proposal.input },
    });
    if (error || !(data as any)?.ok) {
      const message = await actionFailureMessage(error, data);
      setState("idle");
      setFailure(message);
      toast.error(message);
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

      {proposal.action === "adjust_revenue_prices" && state === "idle" && (
        <p className="mt-2 text-xs text-muted-foreground">
          Not published yet. This is a relative adjustment to the latest live prices;
          the safe publishing queue will confirm the result.
        </p>
      )}
      {failure && state === "idle" && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{failure}</span>
        </p>
      )}
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
            {state === "saving" ? "Checking & queuing…" : proposal.action === "adjust_revenue_prices" ? "Approve & queue" : "Confirm"}
          </Button>
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setState("dismissed")}>
            <X className="h-3.5 w-3.5" /> Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
